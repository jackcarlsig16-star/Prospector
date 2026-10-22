import { getSupabase } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { laDateString } from './laDate.js';
import { cleanText } from './scrubText.js';
import { ImportRefused } from './masterImport.js';
import { applyPartnerSignal, SignalError } from './partnerSignals.js';
import { insertCompanyRecord } from './companyPanel.js';
import { importContacts, MAPPABLE } from './outreachImport.js';
import { STEP_OFFSETS, STOP_STATUSES, DAILY_CAP, addSendDays, bookDay, gapAfter, stepAfter, spreadStarts } from './outreachSchedule.js';

// seif-campaign-v1 Stage 2 - outreach campaigns run from Prospector, sent
// from the sender's own mailbox (Prospector never sends). A campaign has
// up to four tracks (segment x warmth), each with its steps; contacts move
// queued (not scheduled) -> active (next step due on next_due_date) -> a
// stop status. Every contact change writes one sales_outreach_events row
// whose meta.prev / meta.next let Undo put it back. Addresses never leave
// the server: CONTACT_COLS has no email, and no response, log or error text
// carries one.

export const CAMPAIGN_STATUSES = ['draft', 'active', 'paused', 'done'];
export const SEGMENTS = ['consultant_broker', 'corporate'];
export const WARMTHS = ['warm', 'cold'];
export const SET_STATUSES = ['meeting', 'not_interested', 'opted_out', 'bounced'];
export const PROMOTE_TO = ['partner', 'employer', 'target'];
export const CONTACT_ACTIONS = ['sent', 'skip', 'stop', 'replied', 'status', 'pause', 'resume', 'promote', 'undo'];
export const UNDO_WINDOW_MS = 10 * 60e3;
export const PROMOTE_CHANNEL = 'partner_referral';
const STEP_COUNT = STEP_OFFSETS.length;
const SUBJECT_MAX = 200, BODY_MAX = 5000, NAME_MAX = 120, NOTE_MAX = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAMPAIGN_COLS = 'id, business_id, name, sender_user_id, owner_user_ids, status, created_by, created_at, updated_at';
export const CONTACT_COLS = 'id, campaign_id, name, title, company, segment, warmth, track_id, owner_user_id, status, current_step, next_due_date, last_sent_at, replied_at, goal_id, opportunity_id, target_id, conflict, notes, import_row, created_at, updated_at';
const STATE_COLS = ['status', 'current_step', 'next_due_date', 'last_sent_at', 'replied_at'];
const EVENT_COLS = ['id', 'kind', 'step_no', 'at', 'source'];
const SEG_LABEL = { consultant_broker: 'Consultants / brokers', corporate: 'Corporate' };
const err = (status, error) => Object.assign(new Error(error), { status });
const must = r => { if (r.error) throw err(500, r.error.message); return r.data; };
const reply = (status, body) => ({ status, body });
const send = (res, r) => res.status(r.status).json(r.body);
const pick = (row, cols) => Object.fromEntries(cols.map(c => [c, row[c] ?? null]));
// What leaves the server about a contact: the listed columns, whatever a query returned.
export const publicContact = row => pick(row, CONTACT_COLS.split(', '));
const first = n => String(n || '').trim().split(/\s+/)[0] || '';
const caught = (label, e) => {
  if (e instanceof ImportRefused) return reply(400, { error: `File refused: ${e.message}`, refused: true });
  if (!e.status || e.status >= 500) console.error(`[campaigns/${label}]`, e.message);
  return reply(e.status || 500, { error: e.message });
};

async function members(supabase, businessId) {
  const rows = must(await supabase.from('business_members').select('user_id, name').eq('business_id', businessId).not('user_id', 'is', null));
  return new Map(rows.map(m => [m.user_id, m.name || '']));
}
const checkMember = (team, id, label) => { if (id != null && !team.has(id)) throw err(400, `${label} must be a member of this workspace`); };

async function campaignOr404(supabase, businessId, id) {
  if (!UUID.test(id || '')) throw err(404, 'campaign not found');
  const row = must(await supabase.from('sales_outreach_campaigns').select(CAMPAIGN_COLS).eq('business_id', businessId).eq('id', id).maybeSingle());
  if (!row) throw err(404, 'campaign not found');
  return row;
}
export async function tracksOf(supabase, campaignIds) {
  if (!campaignIds.length) return [];
  const tracks = must(await supabase.from('sales_outreach_tracks').select('*').in('campaign_id', campaignIds));
  const steps = tracks.length ? must(await supabase.from('sales_outreach_steps').select('*').in('track_id', tracks.map(t => t.id))) : [];
  return tracks.map(t => ({ ...t, steps: steps.filter(s => s.track_id === t.id).sort((a, b) => a.step_no - b.step_no) })).sort((a, b) => a.sort - b.sort);
}
const contactsOf = (supabase, businessId, campaignId) => selectAllPages(() => {
  const q = supabase.from('sales_outreach_contacts').select(CONTACT_COLS).eq('business_id', businessId);
  return (campaignId ? q.eq('campaign_id', campaignId) : q).order('id');
});
const eventsOf = (supabase, businessId) => selectAllPages(() => supabase.from('sales_outreach_events').select('id, contact_id, kind, step_no, at, source, by_user, meta').eq('business_id', businessId).order('id'));

// Header counts (B7) for one campaign's contacts + their events.
export function campaignCounts(contacts, events, tracks = []) {
  const ids = new Set(contacts.map(c => c.id));
  const ev = events.filter(e => ids.has(e.contact_id));
  const sentContacts = new Set(ev.filter(e => e.kind === 'sent').map(e => e.contact_id));
  const sentByStep = {};
  for (const e of ev) if (e.kind === 'sent' && e.step_no) sentByStep[e.step_no] = (sentByStep[e.step_no] || 0) + 1;
  const replied = c => c.replied_at != null;
  const byStatus = contacts.reduce((o, c) => ({ ...o, [c.status]: (o[c.status] || 0) + 1 }), {});
  // The rate counts replies from people who were sent a step: a reply logged before any send isn't a response to one.
  const per = list => {
    const sentTo = list.filter(c => sentContacts.has(c.id));
    const replies = sentTo.filter(replied).length;
    return { contacts: list.length, sent: sentTo.length, replies, reply_rate: sentTo.length ? Math.round((replies / sentTo.length) * 100) : null };
  };
  return {
    contacts: contacts.length, by_status: byStatus, sent_by_step: sentByStep, sent_contacts: sentContacts.size,
    replies: contacts.filter(replied).length, meetings: byStatus.meeting || 0,
    promoted: new Set(ev.filter(e => e.kind === 'promoted').map(e => e.contact_id)).size,
    reply_rate: per(contacts).reply_rate,
    by_track: tracks.map(t => ({ track_id: t.id, name: t.name, ...per(contacts.filter(c => c.track_id === t.id)) })),
  };
}

// GET /goals/campaigns -> { campaigns: [{ ...campaign, counts }] }
export async function listCampaigns(supabase, { businessId }) {
  try {
    const campaigns = must(await supabase.from('sales_outreach_campaigns').select(CAMPAIGN_COLS).eq('business_id', businessId).order('created_at', { ascending: false }));
    const [contacts, events, tracks] = await Promise.all([contactsOf(supabase, businessId), eventsOf(supabase, businessId), tracksOf(supabase, campaigns.map(c => c.id))]);
    return reply(200, { campaigns: campaigns.map(c => ({ ...c, counts: campaignCounts(contacts.filter(x => x.campaign_id === c.id), events, tracks.filter(t => t.campaign_id === c.id)) })) });
  } catch (e) { return caught('list', e); }
}

// POST /goals/campaigns { name, sender_user_id?, owner_user_ids? } -> 201 { campaign, tracks }
// Four tracks (segment x warmth), each with steps 1-3 at the D6 offsets and
// empty subject/body for the team to write.
export async function createCampaign(supabase, { businessId, userId, body }) {
  try {
    const name = cleanText(body?.name, NAME_MAX);
    if (!name) return reply(400, { error: 'name is required' });
    const team = await members(supabase, businessId);
    const sender = body?.sender_user_id ?? null;
    const owners = body?.owner_user_ids ?? [];
    if (!Array.isArray(owners) || owners.some(o => typeof o !== 'string')) return reply(400, { error: 'owner_user_ids must be a list of user ids' });
    checkMember(team, sender, 'sender_user_id');
    owners.forEach(o => checkMember(team, o, 'owner_user_ids'));
    const campaign = must(await supabase.from('sales_outreach_campaigns').insert({ business_id: businessId, name, sender_user_id: sender, owner_user_ids: [...new Set(owners)], status: 'draft', created_by: userId }).select(CAMPAIGN_COLS).single());
    const who = first(team.get(sender));
    const trackRows = SEGMENTS.flatMap(segment => WARMTHS.map(warmth => ({ segment, warmth })))
      .map((t, i) => ({ campaign_id: campaign.id, segment: t.segment, warmth: t.warmth, sort: i, name: `${SEG_LABEL[t.segment]} · ${t.warmth === 'warm' ? (who ? `knows ${who}` : 'warm') : (who ? `doesn't know ${who}` : 'cold')}` }));
    const tracks = must(await supabase.from('sales_outreach_tracks').insert(trackRows).select('*'));
    must(await supabase.from('sales_outreach_steps').insert(tracks.flatMap(t => STEP_OFFSETS.map((day_offset, i) => ({ track_id: t.id, step_no: i + 1, day_offset, subject: '', body: '', created_by: userId })))).select('id'));
    return reply(201, { campaign, tracks: await tracksOf(supabase, [campaign.id]) });
  } catch (e) { return caught('create', e); }
}

// GET /goals/campaigns/:id -> { campaign, tracks (with steps), contacts (no addresses), counts }
export async function getCampaign(supabase, { businessId, id }) {
  try {
    const campaign = await campaignOr404(supabase, businessId, id);
    const [tracks, contacts, events] = await Promise.all([tracksOf(supabase, [id]), contactsOf(supabase, businessId, id), eventsOf(supabase, businessId)]);
    return reply(200, { campaign, tracks, contacts: contacts.map(c => ({ ...publicContact(c), has_email: true })), counts: campaignCounts(contacts, events, tracks) });
  } catch (e) { return caught('get', e); }
}

// PATCH /goals/campaigns/:id { name?, sender_user_id?, owner_user_ids? }
export async function updateCampaign(supabase, { businessId, id, body = {} }) {
  try {
    const campaign = await campaignOr404(supabase, businessId, id);
    const team = await members(supabase, businessId);
    const patch = {};
    for (const k of Object.keys(body)) if (!['name', 'sender_user_id', 'owner_user_ids'].includes(k)) return reply(400, { error: `unknown field: ${k}` });
    if ('name' in body) { patch.name = cleanText(body.name, NAME_MAX); if (!patch.name) return reply(400, { error: 'name is required' }); }
    if ('sender_user_id' in body) { checkMember(team, body.sender_user_id, 'sender_user_id'); patch.sender_user_id = body.sender_user_id; }
    if ('owner_user_ids' in body) {
      if (!Array.isArray(body.owner_user_ids) || body.owner_user_ids.some(o => typeof o !== 'string')) return reply(400, { error: 'owner_user_ids must be a list of user ids' });
      body.owner_user_ids.forEach(o => checkMember(team, o, 'owner_user_ids'));
      patch.owner_user_ids = [...new Set(body.owner_user_ids)];
    }
    const rows = must(await supabase.from('sales_outreach_campaigns').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', campaign.id).eq('updated_at', campaign.updated_at).select(CAMPAIGN_COLS));
    if (!rows.length) return reply(409, { error: `${campaign.name} changed since - reload` });
    return reply(200, { campaign: pick(rows[0], CAMPAIGN_COLS.split(', ')) });
  } catch (e) { return caught('update', e); }
}

// PATCH /goals/campaigns/:id/steps/:stepId { subject?, body?, day_offset? } (B2)
// Merge fields: {first_name} {company} {title}.
export async function updateStep(supabase, { businessId, id, stepId, userId, body = {} }) {
  try {
    await campaignOr404(supabase, businessId, id);
    if (!UUID.test(stepId || '')) return reply(404, { error: 'step not found' });
    const step = must(await supabase.from('sales_outreach_steps').select('*').eq('id', stepId).maybeSingle());
    const track = step && must(await supabase.from('sales_outreach_tracks').select('id, campaign_id').eq('id', step.track_id).maybeSingle());
    if (!step || track?.campaign_id !== id) return reply(404, { error: 'step not found' });
    const patch = {};
    for (const k of Object.keys(body)) if (!['subject', 'body', 'day_offset'].includes(k)) return reply(400, { error: `unknown field: ${k}` });
    if ('subject' in body) { if (typeof body.subject !== 'string' || body.subject.length > SUBJECT_MAX) return reply(400, { error: `subject must be text up to ${SUBJECT_MAX} characters` }); patch.subject = body.subject.replace(/\s+/g, ' ').trim(); }
    if ('body' in body) { if (typeof body.body !== 'string' || body.body.length > BODY_MAX) return reply(400, { error: `body must be text up to ${BODY_MAX} characters` }); patch.body = body.body.replace(/\r\n/g, '\n').trim(); }
    if ('day_offset' in body) {
      if (!Number.isInteger(body.day_offset) || body.day_offset < 0 || body.day_offset > 60) return reply(400, { error: 'day_offset must be a whole number from 0 to 60' });
      if (step.step_no === 1 && body.day_offset !== 0) return reply(400, { error: 'step 1 is always day 0' });
      patch.day_offset = body.day_offset;
    }
    const rows = must(await supabase.from('sales_outreach_steps').update({ ...patch, created_by: step.created_by || userId, updated_at: new Date().toISOString() }).eq('id', step.id).eq('updated_at', step.updated_at).select('*'));
    if (!rows.length) return reply(409, { error: 'this step changed since - reload' });
    return reply(200, { step: rows[0] });
  } catch (e) { return caught('step', e); }
}

// POST /goals/campaigns/:id/import { file, dryRun (default true), mapping?, include?, defaults?, owner_user_id? }
export async function importRoute(supabase, { businessId, id, userId, body = {} }) {
  try {
    const campaign = await campaignOr404(supabase, businessId, id);
    if (campaign.status === 'done') return reply(409, { error: `${campaign.name} is finished - start a new campaign` });
    const { file, dryRun, mapping = {}, include = [], defaults = {}, owner_user_id: owner = null } = body;
    if (mapping === null || typeof mapping !== 'object' || Array.isArray(mapping)) return reply(400, { error: `mapping must be { field: column } with fields ${MAPPABLE.join('|')}` });
    if (!Array.isArray(include) || include.some(n => !Number.isInteger(n))) return reply(400, { error: 'include must be a list of sheet row numbers' });
    if (defaults.segment != null && !SEGMENTS.includes(defaults.segment)) return reply(400, { error: `defaults.segment must be one of ${SEGMENTS.join('|')}` });
    if (defaults.warmth != null && !WARMTHS.includes(defaults.warmth)) return reply(400, { error: `defaults.warmth must be one of ${WARMTHS.join('|')}` });
    const team = await members(supabase, businessId);
    checkMember(team, owner, 'owner_user_id');
    const tracks = await tracksOf(supabase, [id]);
    const ownerUserId = owner || campaign.sender_user_id || userId;
    return reply(200, await importContacts(supabase, { businessId, campaign, tracks, file, dryRun: dryRun !== false, mapping, include, defaults, ownerUserId }));
  } catch (e) { return caught('import', e); }
}

// Sends already due per day for the sender's active contacts, across every
// campaign this sender sends for (the D6 cap is per mailbox).
export async function senderLoad(supabase, businessId, campaign) {
  const campaigns = must(await supabase.from('sales_outreach_campaigns').select('id, sender_user_id').eq('business_id', businessId));
  const same = campaigns.filter(c => (campaign.sender_user_id ? c.sender_user_id === campaign.sender_user_id : c.id === campaign.id)).map(c => c.id);
  const rows = await selectAllPages(() => supabase.from('sales_outreach_contacts').select('id, campaign_id, next_due_date').eq('business_id', businessId).eq('status', 'active').in('campaign_id', same).order('id'));
  const load = new Map();
  for (const r of rows) if (r.next_due_date) load.set(r.next_due_date, (load.get(r.next_due_date) || 0) + 1);
  return load;
}

// Writes one contact's change and its event; the update only lands if the
// contact still has the state the caller saw (a teammate's click or an
// Outlook match in between = 409).
export async function changeContact(supabase, { contact, patch, event, now }) {
  const prev = pick(contact, STATE_COLS);
  const rows = must(await supabase.from('sales_outreach_contacts').update({ ...patch, updated_at: now.toISOString() })
    .eq('id', contact.id).eq('status', contact.status).eq('current_step', contact.current_step).select(CONTACT_COLS));
  if (!rows.length) throw err(409, `${contact.name} changed since - reload`);
  const ev = must(await supabase.from('sales_outreach_events').insert({
    contact_id: contact.id, business_id: contact.business_id, at: now.toISOString(), source: 'manual', ...event,
    meta: { ...(event.meta || {}), prev, next: pick(rows[0], STATE_COLS) },
  }).select(EVENT_COLS.join(', ')).single());
  return { contact: publicContact(rows[0]), event: pick(ev, EVENT_COLS) };
}

// The next step after `stepNo` was sent (or skipped) today: its due day per
// the track's offsets and the sender's cap, or done after the last step.
export function advancePatch(steps, stepNo, today, load) {
  const next = stepAfter(steps, stepNo);
  if (next == null) return { status: 'done', next_due_date: null };
  return { status: 'active', current_step: next, next_due_date: bookDay(addSendDays(today, gapAfter(steps, stepNo)), load) };
}

// POST /goals/campaigns/:id/:action (activate | pause | resume | done)
// activate: draft/active -> active; schedules every queued contact that has a
// track, starts spread from today under the cap. Every track holding queued
// contacts needs its step 1 written first. resume: paused -> active, overdue
// sends re-spread from today.
export async function campaignAction(supabase, { businessId, id, action, now = new Date() }) {
  try {
    const campaign = await campaignOr404(supabase, businessId, id);
    const today = laDateString(now);
    const setStatus = async (to, from) => {
      const rows = must(await supabase.from('sales_outreach_campaigns').update({ status: to, updated_at: now.toISOString() }).eq('id', campaign.id).in('status', from).select(CAMPAIGN_COLS));
      if (!rows.length) throw err(409, `${campaign.name} changed since - reload`);
      return rows[0];
    };
    const reschedule = async (contacts, from) => {
      const load = await senderLoad(supabase, businessId, campaign);
      for (const c of contacts) if (c.status === 'active' && c.next_due_date) load.set(c.next_due_date, Math.max(0, (load.get(c.next_due_date) || 1) - 1));
      const due = spreadStarts(contacts, from, load);
      // One write per (day, status): ~5 for a 180-person start at 40 a day, not 180.
      const groups = new Map();
      for (const c of contacts) { const key = `${due[c.id]}|${c.status}`; groups.set(key, [...(groups.get(key) || []), c.id]); }
      let moved = 0;
      for (const [key, ids] of groups) {
        const [day, status] = key.split('|');
        const rows = must(await supabase.from('sales_outreach_contacts').update({ status: 'active', next_due_date: day, updated_at: now.toISOString() })
          .in('id', ids).eq('status', status).select('id'));
        moved += rows.length;
      }
      return moved;
    };
    if (action === 'activate') {
      if (!['draft', 'active'].includes(campaign.status)) return reply(409, { error: `${campaign.name} is ${campaign.status} - resume it instead` });
      const [contacts, tracks] = await Promise.all([contactsOf(supabase, businessId, id), tracksOf(supabase, [id])]);
      const queued = contacts.filter(c => c.status === 'queued' && c.track_id).sort((a, b) => (a.import_row ?? 0) - (b.import_row ?? 0));
      const unwritten = tracks.filter(t => queued.some(c => c.track_id === t.id) && !t.steps.some(s => s.step_no === 1 && s.subject && s.body));
      if (unwritten.length) return reply(409, { error: `Write step 1 first for: ${unwritten.map(t => t.name).join(', ')}` });
      const updated = campaign.status === 'draft' ? await setStatus('active', ['draft']) : campaign;
      const scheduled = await reschedule(queued, today);
      return reply(200, { campaign: updated, scheduled, no_track: contacts.filter(c => c.status === 'queued' && !c.track_id).length, cap: DAILY_CAP });
    }
    if (action === 'pause') return reply(200, { campaign: await setStatus('paused', ['active']) });
    if (action === 'resume') {
      const updated = await setStatus('active', ['paused']);
      const overdue = (await contactsOf(supabase, businessId, id)).filter(c => c.status === 'active' && c.next_due_date && c.next_due_date < today);
      return reply(200, { campaign: updated, rescheduled: await reschedule(overdue, today) });
    }
    if (action === 'done') return reply(200, { campaign: await setStatus('done', ['draft', 'active', 'paused']) });
    return reply(400, { error: 'action must be one of activate|pause|resume|done' });
  } catch (e) { return caught(action, e); }
}

async function contactOr404(supabase, businessId, id) {
  if (!UUID.test(id || '')) throw err(404, 'contact not found');
  const row = must(await supabase.from('sales_outreach_contacts').select(`${CONTACT_COLS}, business_id`).eq('business_id', businessId).eq('id', id).maybeSingle());
  if (!row) throw err(404, 'contact not found');
  return row;
}
const expectStep = (contact, body) => {
  if (contact.status !== 'active') throw err(409, `${contact.name} isn't waiting on a send (${contact.status}) - reload`);
  if (body?.step_no != null && body.step_no !== contact.current_step) throw err(409, `${contact.name} is on step ${contact.current_step} now - reload`);
};
const LINK = { partner: 'goal_id', employer: 'opportunity_id', target: 'target_id' };

// Promote (B5): the contact's company -> a partner (consultant / broker), an
// employer (corporate) or a target, with the campaign as its lead source
// (lead-source-v1: kind campaign, the campaign, the sender) and channel partner_referral.
// A company already in Pipeline is linked, never duplicated, and keeps its
// owner; a new partner's owner goes through the Assign signal. The person is
// added to a partner as a contact without an address.
async function promote(supabase, { contact, campaign, body, userId, team, now }) {
  const to = body?.to ?? (contact.segment === 'corporate' ? 'employer' : 'partner');
  if (!PROMOTE_TO.includes(to)) throw err(400, `to must be one of ${PROMOTE_TO.join('|')}`);
  const owner = body?.owner_user_id ?? null;
  checkMember(team, owner, 'owner_user_id');
  const name = cleanText(contact.company, 160);
  if (!name) throw err(400, `${contact.name} has no company to promote`);
  const evidence = `From campaign "${campaign.name}": ${[contact.name, contact.title].filter(Boolean).join(', ')}`;
  // lead-source-v1: the campaign is the source, its sender the person (replaces the old "(referred by …)" text).
  const out = await insertCompanyRecord(supabase, {
    businessId: contact.business_id, userId, name, to, kind: contact.segment === 'corporate' ? 'employer' : 'partner',
    channel: PROMOTE_CHANNEL, evidence, now, noteMeta: { from_campaign_contact_id: contact.id },
    source: { source_kind: 'campaign', source_campaign_id: campaign.id, source_person: team.get(campaign.sender_user_id) || null },
  });
  const rec = out.created || out.already;
  if (rec.type === 'partner') {
    if (owner && out.created) {
      try { await applyPartnerSignal(supabase, { businessId: contact.business_id, goalId: rec.id, signal: { type: 'assign', owner_user_id: owner }, byUser: userId, now }); }
      catch (e) { if (!(e instanceof SignalError && e.status === 409)) throw e; }
    }
    const { error } = await supabase.from('partner_contacts').insert({ business_id: contact.business_id, goal_id: rec.id, name: contact.name.slice(0, 120), title: contact.title ? contact.title.slice(0, 160) : null, source: 'manual', created_by: userId });
    if (error && error.code !== '23505') throw err(500, error.message);
  } else if (rec.type === 'employer' && owner && out.created) {
    must(await supabase.from('sales_opportunities').update({ owner: team.get(owner) || null, updated_at: now.toISOString() }).eq('id', rec.id).select('id'));
  }
  return { record: { type: rec.type, id: rec.id, name: rec.name }, created: !!out.created, patch: { [LINK[rec.type]]: rec.id } };
}

// POST /goals/campaign-contacts/:id/:action
//   sent { step_no }    the step went out (by hand); next step booked or done
//   skip { step_no }    move past this step without sending it
//   stop                no more steps (status done)
//   replied             they answered: steps stop, a Reply row appears
//   status { status }   meeting | not_interested | opted_out | bounced
//   pause / resume      take the contact off the schedule / back on from today
//   promote { to?, owner_user_id? }   company -> Pipeline (B5)
//   undo { event_id }   the caller's own latest change, within 10 minutes
export async function contactAction(supabase, { businessId, id, action, userId, body = {}, now = new Date() }) {
  try {
    if (!CONTACT_ACTIONS.includes(action)) return reply(400, { error: `action must be one of ${CONTACT_ACTIONS.join('|')}` });
    const contact = await contactOr404(supabase, businessId, id);
    const campaign = await campaignOr404(supabase, businessId, contact.campaign_id);
    const today = laDateString(now);
    const steps = async () => (contact.track_id ? (await tracksOf(supabase, [campaign.id])).find(t => t.id === contact.track_id)?.steps || [] : []);
    const done = r => reply(200, r);
    if (action === 'sent' || action === 'skip') {
      expectStep(contact, body);
      const patch = advancePatch(await steps(), contact.current_step, today, await senderLoad(supabase, businessId, campaign));
      if (action === 'sent') patch.last_sent_at = now.toISOString();
      return done(await changeContact(supabase, { contact, now, patch, event: action === 'sent'
        ? { kind: 'sent', step_no: contact.current_step, by_user: userId }
        : { kind: 'status', step_no: contact.current_step, by_user: userId, meta: { skipped: true } } }));
    }
    if (action === 'stop') {
      if (!['queued', 'active'].includes(contact.status)) return reply(409, { error: `${contact.name} has no steps left to stop (${contact.status})` });
      return done(await changeContact(supabase, { contact, now, patch: { status: 'done', next_due_date: null }, event: { kind: 'status', by_user: userId, meta: { stopped: true } } }));
    }
    if (action === 'replied') {
      if (!['queued', 'active', 'done'].includes(contact.status)) return reply(409, { error: `${contact.name} is already ${contact.status.replace('_', ' ')}` });
      return done(await changeContact(supabase, { contact, now, patch: { status: 'replied', replied_at: now.toISOString(), next_due_date: null }, event: { kind: 'replied', by_user: userId } }));
    }
    if (action === 'status') {
      const to = body?.status;
      if (!SET_STATUSES.includes(to)) return reply(400, { error: `status must be one of ${SET_STATUSES.join('|')}` });
      if (contact.status === to) return reply(409, { error: `${contact.name} is already ${to.replace('_', ' ')}` });
      return done(await changeContact(supabase, { contact, now, patch: { status: to, next_due_date: null }, event: { kind: to === 'bounced' ? 'bounced' : 'status', by_user: userId, meta: { to } } }));
    }
    if (action === 'pause') {
      if (contact.status !== 'active') return reply(409, { error: `${contact.name} isn't scheduled (${contact.status})` });
      return done(await changeContact(supabase, { contact, now, patch: { status: 'queued', next_due_date: null }, event: { kind: 'status', by_user: userId, meta: { paused: true } } }));
    }
    if (action === 'resume') {
      if (contact.status !== 'queued') return reply(409, { error: `${contact.name} isn't paused (${contact.status})` });
      if (!contact.track_id) return reply(409, { error: `${contact.name} has no track - set segment and warmth first` });
      if (campaign.status !== 'active') return reply(409, { error: `${campaign.name} isn't active - activate it first` });
      const due = bookDay(today, await senderLoad(supabase, businessId, campaign));
      return done(await changeContact(supabase, { contact, now, patch: { status: 'active', next_due_date: due }, event: { kind: 'status', by_user: userId, meta: { resumed: true } } }));
    }
    if (action === 'promote') {
      const prior = must(await supabase.from('sales_outreach_events').select('id').eq('contact_id', contact.id).eq('kind', 'promoted').limit(1));
      if (prior.length) return reply(409, { error: `${contact.name} was already promoted` });
      const team = await members(supabase, businessId);
      const p = await promote(supabase, { contact, campaign, body, userId, team, now });
      const r = await changeContact(supabase, { contact, now, patch: p.patch, event: { kind: 'promoted', by_user: userId, meta: { record: p.record, created: p.created } } });
      return reply(p.created ? 201 : 200, { ...r, record: p.record, created: p.created });
    }
    return done(await undoContact(supabase, { contact, userId, body, now }));
  } catch (e) { return caught(`contact/${action}`, e); }
}

// Undo the caller's own latest change on this contact (not a promote - the
// new record stays; unlink it from the record itself). Refused when someone
// or something (an Outlook match) changed the contact since.
async function undoContact(supabase, { contact, userId, body, now }) {
  const events = must(await supabase.from('sales_outreach_events').select('id, kind, at, by_user, meta').eq('contact_id', contact.id).order('at', { ascending: false }).limit(1));
  const ev = events[0];
  if (!ev || ev.id !== body?.event_id) throw err(409, `${contact.name} changed since - reload`);
  if (ev.by_user !== userId) throw err(409, 'only the person who made the change can undo it');
  if (ev.kind === 'promoted') throw err(409, 'a promote is undone from the Pipeline record');
  if (now - Date.parse(ev.at) > UNDO_WINDOW_MS) throw err(409, 'too long ago to undo');
  const next = ev.meta?.next || {};
  if (STATE_COLS.some(c => (contact[c] ?? null) !== (next[c] ?? null))) throw err(409, `${contact.name} changed since - reload`);
  const rows = must(await supabase.from('sales_outreach_contacts').update({ ...ev.meta.prev, updated_at: now.toISOString() })
    .eq('id', contact.id).eq('status', contact.status).eq('current_step', contact.current_step).select(CONTACT_COLS));
  if (!rows.length) throw err(409, `${contact.name} changed since - reload`);
  must(await supabase.from('sales_outreach_events').delete().eq('id', ev.id));
  return { contact: publicContact(rows[0]), undone: ev.id };
}

const merge = (text, c) => String(text || '').replace(/\{(first_name|company|title)\}/g, (_, k) => (k === 'first_name' ? first(c.name) : c[k] || ''));

// GET /goals/campaign-contacts/:id/draft -> { step_no, subject, body } for
// Copy email: the contact's current step with the merge fields filled in.
export async function contactDraft(supabase, { businessId, id }) {
  try {
    const contact = await contactOr404(supabase, businessId, id);
    if (!contact.track_id) return reply(409, { error: `${contact.name} has no track - set segment and warmth first` });
    const track = (await tracksOf(supabase, [contact.campaign_id])).find(t => t.id === contact.track_id);
    const step = track?.steps.find(s => s.step_no === contact.current_step);
    if (!step) return reply(404, { error: `step ${contact.current_step} not found` });
    return reply(200, { step_no: step.step_no, subject: merge(step.subject, contact), body: merge(step.body, contact) });
  } catch (e) { return caught('draft', e); }
}

// The campaign rows Actions shows (B4/B5), for active campaigns only: a send
// due today or overdue, and a reply nobody has acted on yet (status still
// replied and never promoted - Mark meeting / Not interested / Opted out
// change the status, Promote leaves a promoted event).
export async function campaignActionRows(supabase, businessId, today) {
  const campaigns = must(await supabase.from('sales_outreach_campaigns').select('id, name, status').eq('business_id', businessId).eq('status', 'active'));
  if (!campaigns.length) return { sends: [], replies: [], campaigns: new Map(), tracks: new Map() };
  const ids = campaigns.map(c => c.id);
  const [rows, tracks] = await Promise.all([
    selectAllPages(() => supabase.from('sales_outreach_contacts').select(CONTACT_COLS).eq('business_id', businessId).in('status', ['active', 'replied']).in('campaign_id', ids).order('id')),
    tracksOf(supabase, ids),
  ]);
  const replied = rows.filter(r => r.status === 'replied');
  const promoted = replied.length ? new Set(must(await supabase.from('sales_outreach_events').select('contact_id').eq('business_id', businessId).eq('kind', 'promoted').in('contact_id', replied.map(r => r.id))).map(e => e.contact_id)) : new Set();
  return {
    sends: rows.filter(r => r.status === 'active' && r.next_due_date && r.next_due_date <= today),
    replies: replied.filter(r => !promoted.has(r.id)),
    campaigns: new Map(campaigns.map(c => [c.id, c])), tracks: new Map(tracks.map(t => [t.id, t])),
  };
}

// GET /goals/campaigns/summary -> B8: { due_today, overdue, replies_waiting, campaigns: [{ id, name, status, sent, replies, meetings }] }
export async function campaignSummary(supabase, { businessId, now = new Date() }) {
  try {
    const today = laDateString(now);
    const campaigns = must(await supabase.from('sales_outreach_campaigns').select(CAMPAIGN_COLS).eq('business_id', businessId).neq('status', 'draft'));
    const [contacts, events, rows] = await Promise.all([contactsOf(supabase, businessId), eventsOf(supabase, businessId), campaignActionRows(supabase, businessId, today)]);
    return reply(200, {
      today, due_today: rows.sends.filter(r => r.next_due_date === today).length, overdue: rows.sends.filter(r => r.next_due_date < today).length,
      replies_waiting: rows.replies.length,
      campaigns: campaigns.map(c => {
        const k = campaignCounts(contacts.filter(x => x.campaign_id === c.id), events);
        return { id: c.id, name: c.name, status: c.status, contacts: k.contacts, sent: k.sent_contacts, replies: k.replies, meetings: k.meetings };
      }),
    });
  } catch (e) { return caught('summary', e); }
}

const ctx = req => ({ businessId: req.params.businessId, userId: req.auth.user.id, id: req.params.id, body: req.body || {} });
export async function listCampaignsRoute(req, res) { send(res, await listCampaigns(getSupabase(), ctx(req))); }
export async function createCampaignRoute(req, res) { send(res, await createCampaign(getSupabase(), ctx(req))); }
export async function getCampaignRoute(req, res) { send(res, await getCampaign(getSupabase(), ctx(req))); }
export async function updateCampaignRoute(req, res) { send(res, await updateCampaign(getSupabase(), ctx(req))); }
export async function updateStepRoute(req, res) { send(res, await updateStep(getSupabase(), { ...ctx(req), stepId: req.params.stepId })); }
export async function importCampaignRoute(req, res) { send(res, await importRoute(getSupabase(), ctx(req))); }
export async function campaignActionRoute(req, res) { send(res, await campaignAction(getSupabase(), { ...ctx(req), action: req.params.action })); }
export async function contactActionRoute(req, res) { send(res, await contactAction(getSupabase(), { ...ctx(req), action: req.params.action })); }
export async function contactDraftRoute(req, res) { send(res, await contactDraft(getSupabase(), ctx(req))); }
export async function campaignSummaryRoute(req, res) { send(res, await campaignSummary(getSupabase(), ctx(req))); }
