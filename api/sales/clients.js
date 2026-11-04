import { getSupabase } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { hasPii, cleanText } from './scrubText.js';
import { laDateString } from './laDate.js';
import { compareStages } from './pipelineStages.js';
import { updateOpportunity } from './pipelineRoutes.js';
import { validateSource, sourceOf, logSource, SOURCE_FIELDS } from './leadSource.js';
import { editSource } from './sourceRoutes.js';
import { contactAction } from './outreachRoutes.js';
import { todoOn } from './companyPanel.js';
import { ownerOrCaller, employerOwner } from './companyFields.js';
import { findOpportunity } from './opportunityMatch.js';
import { normalizeDomain } from '../../src/constants/partnerDomains.js';
import { CLIENT_STATUSES, CLIENT_STAGE, CLIENT_STATUS_LABEL, APOLLO_STAGE_HINT } from '../../src/constants/clients.js';

// homelover-clients-v1 C1-C5 - an employer becomes a Client (status, dates, eligible lives, Apollo ids). Status drives
// the stage one way, through the PATCH /opportunities/:id path (so the stage trigger logs it); moving the stage by hand
// never clears client fields. Make client also stops that company's Prospector campaign contacts (Apollo sequences are
// only warned about - Apollo is read-only) and adds "Send agreement" once. Every change is a sales_client_events row
// whose meta.undo holds the exact prior row; Undo puts it back and adds an 'undo' row (rows are never deleted).
// No field here ever holds an email address or phone number.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const APOLLO_ID = /^[A-Za-z0-9_-]{1,80}$/;
const err = (status, error, extra = {}) => Object.assign(new Error(error), { status, extra });
const must = r => { if (r.error) throw err(500, r.error.message); return r.data; };
const reply = (status, body) => ({ status, body });
const send = (res, r) => res.status(r.status).json(r.body);
const caught = (label, e) => {
  if (!e.status || e.status >= 500) console.error(`[clients/${label}]`, e.message);
  return reply(e.status || 500, { error: e.message, ...(e.extra || {}) });
};

export const UNDO_WINDOW_MS = 2 * 60e3;
import { CLIENT_COLS } from './clientCols.js';
export { CLIENT_COLS };
// Every column a client change may write - the Undo snapshot.
const TOUCHED = [...CLIENT_COLS, 'stage', 'covered_lives', 'expected_launch', 'apollo_account_id', 'champion', 'notes', 'domain', 'domain_source', 'domain_at', ...SOURCE_FIELDS, 'source_set_by', 'source_set_at', 'updated_at'];
const ROW_COLS = `id, business_id, organization, owner, owner_team, co_owner_name, archived_at, created_at, ${TOUCHED.join(', ')}`;
const pick = (row, keys) => Object.fromEntries(keys.map(k => [k, row?.[k] ?? null]));
export const SEND_AGREEMENT = 'Send agreement';

const TEXT = { eligible_added_note: 200, primary_contact_name: 120, primary_contact_title: 160, hq_city: 80, hq_state: 40, notes: 500, organization: 160 };
const INTS = ['eligible_now', 'eligible_added'];
const DATES = ['expected_signing_date', 'launch_date', 'signed_date'];
const IDS = ['apollo_account_id', 'apollo_deal_id', 'apollo_org_id'];
const MAKE_KEYS = ['opportunity_id', 'domain', 'status', 'source', ...Object.keys(TEXT), ...INTS, ...DATES, ...IDS];

// A Make-client body -> { v } (cleaned, absent keys left out) or { error }.
export function validateClient(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'send the client fields' };
  const bad = Object.keys(body).find(k => !MAKE_KEYS.includes(k));
  if (bad) return { error: `unknown field: ${bad}` };
  const v = {};
  if (!CLIENT_STATUSES.includes(body.status)) return { error: `status must be one of ${CLIENT_STATUSES.join('|')}` };
  v.status = body.status;
  if (body.opportunity_id != null) {
    if (!UUID.test(String(body.opportunity_id))) return { error: 'opportunity_id must be an employer id' };
    v.opportunity_id = body.opportunity_id;
  }
  for (const [k, max] of Object.entries(TEXT)) {
    if (body[k] == null || body[k] === '') continue;
    if (typeof body[k] !== 'string' || body[k].trim().length > max) return { error: `${k} must be text up to ${max} characters` };
    if (hasPii(body[k])) return { error: `${k} can't hold an email address or phone number` };
    v[k] = body[k].trim().replace(/\s+/g, ' ');
  }
  for (const k of INTS) {
    if (body[k] == null || body[k] === '') continue;
    if (!Number.isInteger(body[k]) || body[k] < 0 || body[k] > 10_000_000) return { error: `${k} must be a whole number of people` };
    v[k] = body[k];
  }
  for (const k of DATES) {
    if (body[k] == null || body[k] === '') continue;
    if (typeof body[k] !== 'string' || !DATE.test(body[k]) || Number.isNaN(Date.parse(`${body[k]}T12:00:00Z`))) return { error: `${k} must be a YYYY-MM-DD date` };
    v[k] = body[k];
  }
  for (const k of IDS) {
    if (body[k] == null || body[k] === '') continue;
    if (typeof body[k] !== 'string' || !APOLLO_ID.test(body[k])) return { error: `${k} must be an Apollo id (letters, digits, - or _)` };
    v[k] = body[k];
  }
  if (body.domain != null && body.domain !== '') {
    const d = typeof body.domain === 'string' && !hasPii(body.domain) ? normalizeDomain(body.domain) : null;
    if (!d || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return { error: 'domain must look like company.com' };
    v.domain = d;
  }
  if (body.source != null) {
    const s = validateSource(body.source);
    if (s.error) return { error: `source: ${s.error}` };
    // Only the fields sent change: an absent office / route in / note keeps the record's own.
    v.source = Object.fromEntries(Object.keys(body.source).filter(k => SOURCE_FIELDS.includes(k)).map(k => [k, s.source[k] ?? null]));
  }
  if (!v.opportunity_id && !v.organization) return { error: 'name the employer (opportunity_id) or give organization (+ domain)' };
  return { v };
}

async function rowOr404(supabase, businessId, id) {
  if (!UUID.test(id || '')) throw err(404, 'employer not found');
  const row = must(await supabase.from('sales_opportunities').select(ROW_COLS).eq('business_id', businessId).eq('id', id).maybeSingle());
  if (!row || row.archived_at) throw err(404, 'employer not found');
  return row;
}

// Add › Client: the employer this domain (else this exact name) already is, or a new one - idempotent on domain. A new
// employer needs its domain (so the next call finds it); the connector may name a known one without it.
async function resolveEmployer(supabase, { businessId, userId, v, now }) {
  if (v.opportunity_id) return { row: await rowOr404(supabase, businessId, v.opportunity_id), created: false };
  const byDomain = v.domain ? must(await supabase.from('sales_opportunities').select('id').eq('business_id', businessId).eq('domain', v.domain).is('archived_at', null).limit(3)) : [];
  if (byDomain.length > 1) throw err(409, `${v.domain} matches ${byDomain.length} employers - open the right one and use Make client there`, { code: 'ambiguous_domain' });
  if (byDomain.length === 1) return { row: await rowOr404(supabase, businessId, byDomain[0].id), created: false };
  const byName = await findOpportunity(supabase, businessId, { name: v.organization });
  if (byName) return { row: await rowOr404(supabase, businessId, byName.id), created: false };
  if (!v.domain) throw err(400, `${v.organization} isn't in the pipeline yet - give its website domain to add it`);
  const who = await ownerOrCaller(supabase, businessId, null, userId);
  if (who.error) throw err(400, who.error);
  const ins = must(await supabase.from('sales_opportunities').insert({
    business_id: businessId, organization: v.organization, stage: 'target', source: 'manual', channel: 'manual',
    domain: v.domain, domain_source: 'manual', domain_at: now.toISOString(), ...employerOwner(who.person),
  }).select('id').single());
  return { row: await rowOr404(supabase, businessId, ins.id), created: true };
}

const withLine = (notes, label, value) => {
  const kept = String(notes || '').split('\n').filter(l => !l.startsWith(`${label}: `));
  return [...kept.filter((l, i) => l || i < kept.length - 1), `${label}: ${value}`].join('\n').replace(/^\n+/, '').slice(0, 4000);
};

// Stage per C2: forward only (from a side lane too); same or behind stays where it is.
async function stageFor(supabase, { businessId, userId, row, status, now }) {
  const to = CLIENT_STAGE[status];
  const cmp = compareStages(row.stage, to);
  if (cmp === 'same' || cmp === 'back') return { before: row.stage, after: row.stage };
  const r = await updateOpportunity(supabase, { businessId, id: row.id, userId, body: { stage: to }, now });
  if (r.status !== 200) throw err(r.status, r.body.error);
  return { before: row.stage, after: to };
}

// The company's Prospector campaign contacts still running -> the existing per-contact stop (outreachRoutes.js).
async function stopOutreach(supabase, { businessId, userId, id, now }) {
  const live = must(await supabase.from('sales_outreach_contacts').select('id, status, current_step, next_due_date, last_sent_at, replied_at, updated_at')
    .eq('business_id', businessId).eq('opportunity_id', id).in('status', ['queued', 'active']));
  const stopped = [];
  for (const c of live) {
    const r = await contactAction(supabase, { businessId, id: c.id, action: 'stop', userId, now });
    if (r.status !== 200) throw err(r.status, r.body.error);
    stopped.push({ id: c.id, prev: pick(c, ['status', 'current_step', 'next_due_date', 'last_sent_at', 'replied_at']), prev_updated_at: c.updated_at, next_status: r.body.contact.status });
  }
  return stopped;
}

// People of this company already synced from Apollo sequences (sales_prospect_state linked by opportunity_id). No Apollo call.
async function inApolloSequences(supabase, { businessId, id }) {
  return must(await supabase.from('sales_prospect_state').select('contact_id, status').eq('business_id', businessId).eq('opportunity_id', id))
    .filter(p => p.status !== 'dead').length;
}

async function logClient(supabase, { businessId, id, kind, from, to, userId, via, meta = {}, now }) {
  return must(await supabase.from('sales_client_events').insert({
    business_id: businessId, opportunity_id: id, kind, from_status: from ?? null, to_status: to ?? null, by_user: userId, via, meta, at: now.toISOString(),
  }).select('id').single());
}

const publicClient = row => ({
  id: row.id, name: row.organization, domain: row.domain || null, stage: row.stage, owner_team: row.owner_team || null,
  ...pick(row, CLIENT_COLS), status_label: CLIENT_STATUS_LABEL[row.client_status] || null, apollo_stage_hint: APOLLO_STAGE_HINT[row.client_status] || null,
  launch_date: row.expected_launch || null, covered_lives: row.covered_lives ?? null, apollo_account_id: row.apollo_account_id || null,
});

// POST /goals/clients { opportunity_id | organization + domain, status, ... , source? } -> { client, created, updated, stage,
// contacts_stopped, todo_id, warnings, event_id }. via = 'panel' | 'connector' (the connector passes its own).
// partnerless: the connector may record a partner referral whose partner isn't in Prospector yet (the source note names
// it). A call that changes nothing writes nothing (unchanged: true, event_id null).
export async function makeClient(supabase, { businessId, userId, body = {}, via = 'panel', partnerless = false, now = new Date() }) {
  try {
    const { v, error } = validateClient(body);
    if (error) return reply(400, { error });
    const today = laDateString(now);
    const { row: found, created } = await resolveEmployer(supabase, { businessId, userId, v, now });
    const prior = pick(found, TOUCHED);
    const src = { ...sourceOf(found), ...(v.source || {}) };
    if (!src.source_kind) return reply(400, { error: 'pick a source - who brought this client in' });
    if (src.source_kind === 'partner_referral' && !src.source_partner_id && !partnerless) return reply(400, { error: 'Partner referral needs the partner picked' });
    const sourceChanged = !!v.source && SOURCE_FIELDS.some(k => (src[k] ?? null) !== (found[k] ?? null));
    if (sourceChanged) {
      const r = await editSource(supabase, { businessId, type: 'employer', id: found.id, userId, body: src, now });
      if (r.status !== 200) throw err(r.status, r.body.error);
    }
    const row = sourceChanged ? await rowOr404(supabase, businessId, found.id) : found;
    const warnings = [];
    const patch = {
      client_status: v.status, client_since: row.client_since || today,
      ...(v.status === 'signed' || v.status === 'launched' ? { signed_date: v.signed_date || row.signed_date || today } : v.signed_date ? { signed_date: v.signed_date } : {}),
      ...pick(v, ['eligible_now', 'eligible_added', 'eligible_added_note', 'expected_signing_date', 'apollo_account_id', 'apollo_deal_id', 'apollo_org_id'].filter(k => k in v)),
      ...(v.launch_date ? { expected_launch: v.launch_date } : {}),
      ...(v.eligible_now != null && row.covered_lives == null ? { covered_lives: v.eligible_now } : {}),
    };
    if (v.primary_contact_name) {
      const champ = [v.primary_contact_name, v.primary_contact_title].filter(Boolean).join(', ');
      if (!row.champion) patch.champion = champ;
      else if (row.champion !== champ) warnings.push('a champion is already set - kept');
    }
    let notes = row.notes;
    if (v.hq_city || v.hq_state) notes = withLine(notes, 'HQ', [v.hq_city, v.hq_state].filter(Boolean).join(', '));
    if (v.notes) notes = withLine(notes, 'Client note', cleanText(v.notes, 500));
    if (notes !== row.notes) patch.notes = notes;
    if (v.domain && !row.domain) Object.assign(patch, { domain: v.domain, domain_source: 'manual', domain_at: now.toISOString() });
    const changed = Object.keys(patch).some(k => (row[k] ?? null) !== (patch[k] ?? null));
    if (changed) {
      const moved = must(await supabase.from('sales_opportunities').update({ ...patch, updated_at: now.toISOString() })
        .eq('business_id', businessId).eq('id', row.id).eq('updated_at', row.updated_at).select('id'));
      if (!moved.length) throw err(409, `${row.organization} changed while saving - reload`);
    }
    const stage = await stageFor(supabase, { businessId, userId, row, status: v.status, now });
    const stopped = await stopOutreach(supabase, { businessId, userId, id: row.id, now });
    const sequenced = await inApolloSequences(supabase, { businessId, id: row.id });
    if (sequenced) warnings.push(`${sequenced} ${sequenced === 1 ? 'person is' : 'people are'} in Apollo sequences - stop them in Apollo`);
    if (row.owner_team === 'upside') warnings.push('Upside-owned account');
    let todoId = null;
    if (v.status === 'verbal_yes') {
      const open = must(await supabase.from('sales_week_goals').select('id').eq('business_id', businessId).eq('kind', 'todo').eq('link_type', 'opportunity').eq('link_id', row.id).eq('text', SEND_AGREEMENT).in('status', ['open', 'done']).limit(1));
      if (!open.length) todoId = (await todoOn(supabase, { businessId, userId, type: 'employer', id: row.id, text: SEND_AGREEMENT, today, now })).id;
    }
    const after = await rowOr404(supabase, businessId, row.id);
    if (!changed && !sourceChanged && !stopped.length && !todoId && stage.after === stage.before) {
      return reply(200, { client: publicClient(after), created: false, updated: true, unchanged: true, stage, contacts_stopped: 0, todo_id: null, warnings, event_id: null });
    }
    const ev = await logClient(supabase, {
      businessId, id: row.id, kind: prior.client_status ? 'status' : 'made_client', from: prior.client_status, to: v.status, userId, via, now,
      meta: { undo: { prior, set: pick(after, TOUCHED), created, source_changed: sourceChanged, contacts: stopped, todo_id: todoId } },
    });
    return reply(created ? 201 : 200, {
      client: publicClient(after), created, updated: !created, stage, contacts_stopped: stopped.length, todo_id: todoId, warnings, event_id: ev.id,
    });
  } catch (e) { return caught('make', e); }
}

// POST /goals/clients/:id/signed { expect_status, signed_date? } and /launched { expect_status, launch_date? } (C4).
export async function markClient(supabase, { businessId, userId, id, to, body = {}, via = 'panel', now = new Date() }) {
  try {
    if (to !== 'signed' && to !== 'launched') return reply(400, { error: 'to must be signed|launched' });
    const dateKey = to === 'signed' ? 'signed_date' : 'launch_date';
    const date = body[dateKey] ?? null;
    if (date != null && (typeof date !== 'string' || !DATE.test(date))) return reply(400, { error: `${dateKey} must be a YYYY-MM-DD date` });
    const row = await rowOr404(supabase, businessId, id);
    if (!row.client_status) return reply(409, { error: `${row.organization} isn't a client yet - use Make client` });
    if (body.expect_status !== row.client_status) return reply(409, { error: 'This changed elsewhere - refresh', code: 'stale_status' });
    if (row.client_status === to) return reply(409, { error: `${row.organization} is already ${CLIENT_STATUS_LABEL[to].toLowerCase()}` });
    if (to === 'signed' && row.client_status === 'launched') return reply(409, { error: `${row.organization} is already launched` });
    const today = laDateString(now);
    const patch = to === 'signed'
      ? { client_status: 'signed', signed_date: date || today }
      : { client_status: 'launched', expected_launch: date || today, signed_date: row.signed_date || date || today };
    const prior = pick(row, TOUCHED);
    const moved = must(await supabase.from('sales_opportunities').update({ ...patch, updated_at: now.toISOString() })
      .eq('business_id', businessId).eq('id', id).eq('client_status', row.client_status).select('id'));
    if (!moved.length) return reply(409, { error: 'This changed elsewhere - refresh', code: 'stale_status' });
    const stage = await stageFor(supabase, { businessId, userId, row, status: to, now });
    const after = await rowOr404(supabase, businessId, id);
    const ev = await logClient(supabase, { businessId, id, kind: to, from: row.client_status, to, userId, via, now, meta: { undo: { prior, set: pick(after, TOUCHED), created: false, source_changed: false, contacts: [], todo_id: null } } });
    return reply(200, { client: publicClient(after), stage, event_id: ev.id });
  } catch (e) { return caught(`mark/${to}`, e); }
}

// Anything tied to this employer besides Make client's own to-do: people, prospects, campaign contacts, files, visits,
// research, to-dos, a partner's link.
async function linkedSince(supabase, { businessId, id, ownTodoId }) {
  const count = async q => must(await q).length;
  const hits = await Promise.all([
    count(supabase.from('sales_people').select('id').eq('business_id', businessId).eq('opportunity_id', id).limit(1)),
    count(supabase.from('sales_prospect_state').select('contact_id').eq('business_id', businessId).eq('opportunity_id', id).limit(1)),
    count(supabase.from('sales_outreach_contacts').select('id').eq('business_id', businessId).eq('opportunity_id', id).limit(1)),
    count(supabase.from('sales_client_files').select('id').eq('business_id', businessId).eq('opportunity_id', id).limit(1)),
    count(supabase.from('web_visits').select('id').eq('business_id', businessId).eq('matched_type', 'opportunity').eq('matched_id', id).limit(1)),
    count(supabase.from('research_runs').select('id').eq('business_id', businessId).eq('entity_type', 'employer').eq('entity_id', id).limit(1)),
    count(supabase.from('sales_goals').select('id').eq('business_id', businessId).eq('linked_opportunity_id', id).limit(1)),
    supabase.from('sales_week_goals').select('id').eq('business_id', businessId).eq('link_type', 'opportunity').eq('link_id', id).limit(5).then(r => must(r).filter(t => t.id !== ownTodoId).length),
  ]);
  return hits.some(n => n > 0);
}

// POST /goals/clients/undo { event_id } - the caller's own change, within 2 minutes, only while the row still holds what
// that change wrote. Puts back the exact prior row (values + updated_at), the stopped campaign contacts and drops the
// to-do; an employer this Make client created is deleted, or archived once anything links to it (ruling 3).
export async function undoClient(supabase, { businessId, userId, body = {}, via = 'panel', now = new Date() }) {
  try {
    if (!UUID.test(body.event_id || '')) return reply(400, { error: 'event_id is required' });
    const ev = must(await supabase.from('sales_client_events').select('id, opportunity_id, kind, by_user, at, meta').eq('business_id', businessId).eq('id', body.event_id).maybeSingle());
    if (!ev || !ev.meta?.undo) return reply(404, { error: 'nothing to undo' });
    if (ev.by_user !== userId) return reply(409, { error: 'only the person who made the change can undo it' });
    if (now - Date.parse(ev.at) > UNDO_WINDOW_MS) return reply(409, { error: 'too long ago to undo' });
    const done = must(await supabase.from('sales_client_events').select('id, meta').eq('business_id', businessId).eq('opportunity_id', ev.opportunity_id).eq('kind', 'undo'));
    if (done.some(d => d.meta?.undoes === ev.id)) return reply(409, { error: 'already undone' });
    const u = ev.meta.undo;
    const row = await rowOr404(supabase, businessId, ev.opportunity_id);
    if (TOUCHED.some(k => (row[k] ?? null) !== (u.set[k] ?? null))) return reply(409, { error: `${row.organization} changed since - reload` });
    for (const c of u.contacts || []) {
      const back = must(await supabase.from('sales_outreach_contacts').update({ ...c.prev, updated_at: c.prev_updated_at })
        .eq('business_id', businessId).eq('id', c.id).eq('status', c.next_status).select('id'));
      if (!back.length) continue;
      must(await supabase.from('sales_outreach_events').insert({ contact_id: c.id, business_id: businessId, at: now.toISOString(), source: 'manual', kind: 'status', by_user: userId, meta: { undone: true, prev: { status: c.next_status }, next: c.prev } }));
    }
    if (u.todo_id) must(await supabase.from('sales_week_goals').update({ status: 'dropped', updated_at: now.toISOString() }).eq('business_id', businessId).eq('id', u.todo_id).eq('status', 'open'));
    // Ruling 3 (Nov 3): delete only an employer THIS call created, inside the window, with nothing linked to it since
    // (the contacted-undo guard); otherwise put the prior row back and archive it.
    const fresh = u.created && now - Date.parse(row.created_at) <= UNDO_WINDOW_MS;
    if (fresh && !(await linkedSince(supabase, { businessId, id: row.id, ownTodoId: u.todo_id }))) {
      must(await supabase.from('sales_source_events').delete().eq('business_id', businessId).eq('record_type', 'employer').eq('record_id', row.id));
      must(await supabase.from('sales_opportunities').delete().eq('business_id', businessId).eq('id', row.id));
      return reply(200, { undone: ev.id, deleted: { type: 'employer', id: row.id } });
    }
    const restored = must(await supabase.from('sales_opportunities').update(u.created ? { ...u.prior, archived_at: now.toISOString() } : u.prior)
      .eq('business_id', businessId).eq('id', row.id).eq('updated_at', row.updated_at).select(ROW_COLS));
    if (u.created) {
      if (!restored.length) return reply(409, { error: `${row.organization} changed since - reload` });
      await logClient(supabase, { businessId, id: row.id, kind: 'undo', from: row.client_status, to: null, userId, via, now, meta: { undoes: ev.id, archived: true } });
      return reply(200, { undone: ev.id, archived: { type: 'employer', id: row.id } });
    }
    if (!restored.length) return reply(409, { error: `${row.organization} changed since - reload` });
    if (u.source_changed) await logSource(supabase, { businessId, type: 'employer', id: row.id, from: row, to: restored[0], reason: 'undo', byUser: userId, at: now });
    await logClient(supabase, { businessId, id: row.id, kind: 'undo', from: row.client_status, to: u.prior.client_status, userId, via, now, meta: { undoes: ev.id } });
    return reply(200, { undone: ev.id, client: restored[0].client_status ? publicClient(restored[0]) : null });
  } catch (e) { return caught('undo', e); }
}

const STATUS_ORDER = Object.fromEntries(CLIENT_STATUSES.map((s, i) => [s, i]));

// GET /goals/clients -> { clients: [...], totals: { by_status, eligible_now, eligible_added } } (C5).
export async function listClients(supabase, { businessId }) {
  try {
    const rows = await selectAllPages(() => supabase.from('sales_opportunities').select(`${ROW_COLS}`).eq('business_id', businessId).is('archived_at', null).not('client_status', 'is', null).order('id'));
    const ids = [...new Set(rows.map(r => r.source_partner_id).filter(Boolean))];
    const [partners, files] = await Promise.all([
      ids.length ? must(await supabase.from('sales_goals').select('id, name').eq('business_id', businessId).in('id', ids)) : [],
      rows.length ? selectAllPages(() => supabase.from('sales_client_files').select('id, opportunity_id').eq('business_id', businessId).is('archived_at', null).order('id')) : [],
    ]);
    const pname = new Map(partners.map(p => [p.id, p.name]));
    const fileCount = files.reduce((m, f) => m.set(f.opportunity_id, (m.get(f.opportunity_id) || 0) + 1), new Map());
    const clients = rows.map(r => ({
      ...publicClient(r), owner: (r.owner || '').split(' ')[0] || null, files: fileCount.get(r.id) || 0,
      referred_by: r.source_kind === 'partner_referral' ? (r.source_partner_id ? { id: r.source_partner_id, name: pname.get(r.source_partner_id) || 'A removed partner' } : { id: null, name: null }) : null,
      source_kind: r.source_kind || null,
    })).sort((a, b) => STATUS_ORDER[a.client_status] - STATUS_ORDER[b.client_status] || String(a.launch_date || '9999').localeCompare(String(b.launch_date || '9999')) || a.name.localeCompare(b.name));
    const byStatus = Object.fromEntries(CLIENT_STATUSES.map(s => [s, clients.filter(c => c.client_status === s).length]));
    return reply(200, { clients, totals: { clients: clients.length, by_status: byStatus, eligible_now: clients.reduce((n, c) => n + (c.eligible_now || 0), 0), eligible_added: clients.reduce((n, c) => n + (c.eligible_added || 0), 0) } });
  } catch (e) { return caught('list', e); }
}

const ctx = req => ({ businessId: req.params.businessId, userId: req.auth.user.id, id: req.params.id, body: req.body || {} });
export async function makeClientRoute(req, res) { send(res, await makeClient(getSupabase(), ctx(req))); }
export async function markSignedRoute(req, res) { send(res, await markClient(getSupabase(), { ...ctx(req), to: 'signed' })); }
export async function markLaunchedRoute(req, res) { send(res, await markClient(getSupabase(), { ...ctx(req), to: 'launched' })); }
export async function undoClientRoute(req, res) { send(res, await undoClient(getSupabase(), ctx(req))); }
export async function listClientsRoute(req, res) { send(res, await listClients(getSupabase(), ctx(req))); }
