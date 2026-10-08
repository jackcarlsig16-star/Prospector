// microsoft-connect-v1 Stage 3 - what the Outlook read layer (microsoft_messages /
// microsoft_events) means for partners. Jack, 2026-10-08: TOUCHES ARE FACTS,
// STAGE MOVES ARE PROPOSALS. A sent mail (or a reply inside a thread we
// started) to a matched partner always records an email touch, stage "none",
// dated on the mail's LA day - no OK needed - unless a touch for the same
// partner + contact within a LA day either side already exists (Jack,
// 2026-10-08: a mail sent Oct 6 and logged by hand Oct 7 is one touch). The stage move is the separate
// proposal: Sent and in-thread Replied may auto-apply (daily step), a cold
// reply or a meeting waits for an OK. Keys live in event meta
// (outlook_touch_key for the fact, outlook_key for the move) so nothing
// repeats, even after an undo.
import { selectAllPages } from '../lib/selectAllPages.js';
import { getSupabase, addDays } from './goalsShared.js';
import { hasRole } from '../lib/requireAuth.js';
import { laDateString } from './laDate.js';
import { isBehind, KEYS_MAX } from './partnerApolloTouches.js';
import { applyPartnerSignal, SignalError } from './partnerSignals.js';

export const SENT = 'first_email_sent', REPLIED = 'replied', MEETING = 'meeting_set';
export const TARGET_RANK = { [SENT]: 1, [REPLIED]: 2, [MEETING]: 3 };
// Jack, 2026-10-08: these never count as a reply - skipped and counted.
export const AUTO_SUBJECT_PREFIXES = ['automatic reply', 'out of office', 'undeliverable', 'delivery status notification'];
export const AUTO_SENDER_PREFIXES = ['postmaster@', 'noreply@', 'no-reply@', 'mailer-daemon@'];
export const NEEDS_OK = { cold_reply: 'reply outside a thread we started - needs Jack', meeting: 'meeting from the calendar - needs Jack' };

export const messageKey = m => `outlook:${m.internet_message_id || m.graph_id}`;
export const eventKey = e => `event:${e.ical_uid || e.graph_id}`;
export const touchKeyOf = moveKey => moveKey.replace(/^outlook:/, 'touch:');
export const personKey = c => `person:${c.goal_id}:${c.email}`;

export const isAutoMessage = m => {
  const subject = String(m.subject || '').trim().toLowerCase();
  return AUTO_SUBJECT_PREFIXES.some(p => subject.startsWith(p)) || (m.external_emails || []).some(e => AUTO_SENDER_PREFIXES.some(p => e.startsWith(p)));
};

// Confirmed domain first, then a known contact's address. Two partners on
// one message is ambiguous and never guessed.
export function buildIndex({ domains, contacts }) {
  const byDomain = new Map(), byEmail = new Map(), nameByEmail = new Map();
  for (const d of domains) if (d.confirmed !== false) byDomain.set(d.domain, d.goal_id);
  for (const c of contacts) if (c.email) { byEmail.set(c.email.toLowerCase(), c.goal_id); if (c.name) nameByEmail.set(c.email.toLowerCase(), c.name); }
  return { byDomain, byEmail, nameByEmail };
}

export function matchPartner(row, index) {
  const viaDomain = [...new Set((row.external_domains || []).map(d => index.byDomain.get(d)).filter(Boolean))];
  if (viaDomain.length > 1) return { ambiguous: viaDomain };
  if (viaDomain.length === 1) return { goal_id: viaDomain[0], via: 'domain', matched: (row.external_domains || []).find(d => index.byDomain.get(d) === viaDomain[0]) };
  const viaEmail = [...new Set((row.external_emails || []).map(e => index.byEmail.get(e)).filter(Boolean))];
  if (viaEmail.length > 1) return { ambiguous: viaEmail };
  if (viaEmail.length === 1) return { goal_id: viaEmail[0], via: 'email', matched: (row.external_emails || []).find(e => index.byEmail.get(e) === viaEmail[0]) };
  return null;
}

// The person a row names: the matched contact, else the first external
// address at the matched domain. Name = partner_contacts (how Jack logs
// people), else Graph's display name, else the address.
function personOf(row, match, index) {
  const emails = row.external_emails || [], names = row.external_names || [];
  let i = match.via === 'email' ? emails.indexOf(match.matched) : emails.findIndex(e => e.endsWith('@' + match.matched));
  if (i < 0) i = 0;
  const email = emails[i] || null;
  const name = (email && index.nameByEmail.get(email)) || names[i] || '';
  return { email, name, contact: name || email || '?', label: name ? `${name} <${email}>` : (email || '?') };
}

const dateOf = iso => laDateString(new Date(iso));
const norm = s => String(s || '').trim().toLowerCase();

// One proposal per partner: the furthest target it is behind. Auto = safe
// for the daily step (a sent mail, or a reply inside a thread we started);
// everything else waits for an OK (held). Also returns the touches the facts
// would record (after dedupe) and the people a Sent mail would add.
export function proposeOutlookMoves({ partners, domains, contacts, messages, events, partnerEvents, mailboxOwners = [], now = new Date() }) {
  const index = buildIndex({ domains, contacts });
  const partnerById = new Map(partners.map(p => [p.id, p]));
  const domainsByGoal = new Map();
  for (const d of domains) if (d.confirmed !== false) { if (!domainsByGoal.has(d.goal_id)) domainsByGoal.set(d.goal_id, new Set()); domainsByGoal.get(d.goal_id).add(d.domain); }
  const known = new Set(contacts.filter(c => c.email).map(c => `${c.goal_id}:${c.email.toLowerCase()}`));
  const ownerByMailbox = new Map(mailboxOwners.map(o => [o.mailbox_email, o.user_id]));
  const settled = new Map(partnerEvents.filter(e => e.meta?.outlook_key).map(e => [e.meta.outlook_key, e.meta.dismissed ? 'dismissed' : 'applied']));
  const recordedTouches = new Set(partnerEvents.filter(e => e.meta?.outlook_touch_key).map(e => e.meta.outlook_touch_key));
  // Existing touches by partner + contact (name or address) + LA day, with the source.
  const existingTouch = new Map();
  for (const e of partnerEvents) {
    if (e.event !== 'touch' || !e.at) continue;
    for (const c of e.contact_names || []) existingTouch.set(`${e.goal_id}|${norm(c)}|${dateOf(e.at)}`, { source: e.source || 'manual', date: dateOf(e.at) });
  }
  const priorTouch = (goalId, contact, email, date) => {
    for (const d of [date, addDays(date, -1), addDays(date, 1)]) {
      const hit = existingTouch.get(`${goalId}|${norm(contact)}|${d}`) || (email && existingTouch.get(`${goalId}|${norm(email)}|${d}`));
      if (hit) return hit;
    }
    return null;
  };
  const ourThreads = new Set(messages.filter(m => m.direction === 'sent' && m.conversation_id).map(m => m.conversation_id));
  const today = laDateString(now);
  const counts = { messages: messages.length, events: events.length, skipped_auto: 0, unmatched: 0, ambiguous: 0, cancelled: 0 };
  const candidates = [], people = new Map();
  const touches = { would_record: [], skipped_manual: [], already: 0, duplicates: 0 };
  const seenTouch = new Set();

  const touchFor = (base, direction) => {
    const key = touchKeyOf(base.key);
    const t = { key, move_key: base.key, goal_id: base.goal_id, partner: base.partner, contact: base.person_contact, person: base.person, person_email: base.person_email, date: base.date, source_at: base.source_at, by_user: base.by_user, mailbox: base.mailbox, direction, internet_message_id: base.internet_message_id };
    if (recordedTouches.has(key)) { touches.already++; return; }
    const slot = `${t.goal_id}|${norm(t.contact)}|${t.date}`;
    const prior = priorTouch(t.goal_id, t.contact, t.person_email, t.date);
    if (prior) { touches.skipped_manual.push({ ...t, reason: `${prior.source === 'manual' ? 'logged by hand' : 'already recorded'}: ${t.contact} on ${prior.date}${prior.date !== t.date ? ` (mail ${t.date})` : ''}` }); return; }
    if (seenTouch.has(slot)) { touches.duplicates++; return; }
    seenTouch.add(slot);
    touches.would_record.push({ ...t, reason: `${direction === 'sent' ? 'emailed' : 'reply from'} ${t.person} on ${t.date}` });
  };

  for (const m of messages) {
    if (m.direction === 'received' && isAutoMessage(m)) { counts.skipped_auto++; continue; }
    const match = matchPartner(m, index);
    if (!match) { counts.unmatched++; continue; }
    if (match.ambiguous) { counts.ambiguous++; continue; }
    const p = partnerById.get(match.goal_id);
    if (!p) continue;
    const person = personOf(m, match, index);
    const base = { goal_id: p.id, partner: p.name, from: p.pipeline_status || 'not_started', key: messageKey(m), source_at: m.occurred_at, date: dateOf(m.occurred_at), internet_message_id: m.internet_message_id || null,
      person: person.label, person_email: person.email, person_name: person.name, person_contact: person.contact, subject: m.subject || '', by_user: ownerByMailbox.get(m.mailbox_email) || null, mailbox: m.mailbox_email, via: match.via };
    if (m.direction === 'sent') {
      candidates.push({ ...base, to: SENT, auto: true, reason: `sent to ${person.label} on ${base.date}` });
      touchFor(base, 'sent');
      const mine = domainsByGoal.get(p.id) || new Set();
      for (let i = 0; i < (m.external_emails || []).length; i++) {
        const email = m.external_emails[i];
        if (!mine.has(email.slice(email.lastIndexOf('@') + 1)) || known.has(`${p.id}:${email}`)) continue;
        const prev = people.get(`${p.id}:${email}`);
        if (!prev || base.date < prev.first_seen) people.set(`${p.id}:${email}`, { key: personKey({ goal_id: p.id, email }), goal_id: p.id, partner: p.name, email, name: (m.external_names || [])[i] || prev?.name || '', first_seen: base.date, source_key: base.key });
      }
    } else {
      const inThread = !!(m.conversation_id && ourThreads.has(m.conversation_id));
      candidates.push({ ...base, to: REPLIED, auto: inThread, reason: `reply from ${person.label} on ${base.date}${inThread ? '' : ' (not in a thread we started)'}`, hold_reason: inThread ? null : NEEDS_OK.cold_reply });
      if (inThread) touchFor(base, 'received');
    }
  }
  for (const e of events) {
    if (e.is_cancelled) { counts.cancelled++; continue; }
    const match = matchPartner(e, index);
    if (!match) { counts.unmatched++; continue; }
    if (match.ambiguous) { counts.ambiguous++; continue; }
    const p = partnerById.get(match.goal_id);
    if (!p) continue;
    const person = personOf(e, match, index);
    const start = dateOf(e.start_at);
    // A touch can't be dated in the future; a meeting booked for next week is
    // dated today and the meeting day travels in the reason + meta.
    candidates.push({ goal_id: p.id, partner: p.name, from: p.pipeline_status || 'not_started', key: eventKey(e), to: MEETING, auto: false, source_at: e.start_at, date: start > today ? today : start, meeting_date: start, ical_uid: e.ical_uid || null,
      person: person.label, person_email: person.email, person_name: person.name, person_contact: person.contact, subject: e.subject || '', by_user: ownerByMailbox.get(e.mailbox_email) || null, mailbox: e.mailbox_email, via: match.via,
      reason: `meeting "${e.subject || '(no subject)'}" with ${person.label} on ${start}`, hold_reason: NEEDS_OK.meeting });
  }

  // Per partner: furthest target it is behind; among equals the earliest.
  const byGoal = new Map();
  for (const c of candidates) { if (!byGoal.has(c.goal_id)) byGoal.set(c.goal_id, []); byGoal.get(c.goal_id).push(c); }
  const proposed = [], held = [], skipped = [];
  for (const [goalId, list] of byGoal) {
    const p = partnerById.get(goalId);
    const settledReason = c => `already ${settled.get(c.key)} (${c.key})`;
    const open = list.filter(c => !settled.has(c.key));
    for (const c of list.filter(c => settled.has(c.key))) skipped.push({ ...c, reason: `${c.reason} - ${settledReason(c)}` });
    if (p.pipeline_status === 'paused') { for (const c of open) skipped.push({ ...c, reason: `${c.reason} - partner is paused` }); continue; }
    const behind = open.filter(c => isBehind(p.pipeline_status, c.to));
    for (const c of open.filter(c => !isBehind(p.pipeline_status, c.to))) skipped.push({ ...c, reason: `${c.reason} - already at or past ${c.to} (${c.from})` });
    if (!behind.length) continue;
    behind.sort((a, b) => TARGET_RANK[b.to] - TARGET_RANK[a.to] || a.source_at.localeCompare(b.source_at));
    const pick = behind[0];
    for (const c of behind.slice(1)) skipped.push({ ...c, reason: `${c.reason} - ${pick.key} covers this partner this run` });
    (pick.auto ? proposed : held).push(pick);
  }
  const byName = (a, b) => a.partner.localeCompare(b.partner) || a.source_at.localeCompare(b.source_at);
  proposed.sort(byName); held.sort(byName); skipped.sort(byName); touches.would_record.sort(byName); touches.skipped_manual.sort(byName);
  const wouldAdd = [...people.values()].sort((a, b) => a.partner.localeCompare(b.partner) || a.email.localeCompare(b.email));
  return { proposed, held, skipped, people: wouldAdd, touches,
    counts: { ...counts, candidates: candidates.length, proposed: proposed.length, held: held.length, skipped: skipped.length, people: wouldAdd.length, touches: touches.would_record.length, touches_skipped_manual: touches.skipped_manual.length, touches_already: touches.already, touches_duplicates: touches.duplicates } };
}

export async function loadOutlookTouchInputs(supabase, businessId) {
  const [partners, domains, contacts, messages, events, partnerEvents, mailboxOwners] = await Promise.all([
    selectAllPages(() => supabase.from('sales_goals').select('id, name, pipeline_status, first_email_at, last_touch_at')
      .eq('business_id', businessId).eq('goal_type', 'partnership').is('archived_at', null).order('id')),
    selectAllPages(() => supabase.from('partner_domains').select('goal_id, domain, confirmed').eq('business_id', businessId).eq('confirmed', true).order('id')),
    selectAllPages(() => supabase.from('partner_contacts').select('goal_id, email, name').eq('business_id', businessId).not('email', 'is', null).order('id')),
    selectAllPages(() => supabase.from('microsoft_messages').select('graph_id, internet_message_id, conversation_id, direction, mailbox_email, external_emails, external_names, external_domains, subject, occurred_at')
      .eq('business_id', businessId).order('occurred_at').order('id')),
    selectAllPages(() => supabase.from('microsoft_events').select('graph_id, ical_uid, mailbox_email, organizer_email, external_emails, external_names, external_domains, subject, start_at, is_cancelled')
      .eq('business_id', businessId).order('start_at').order('id')),
    // Every touch (any source, for the dedupe) plus every outlook-sourced event (keys).
    selectAllPages(() => supabase.from('sales_partner_events').select('goal_id, event, source, contact_names, at, meta').eq('business_id', businessId).or('event.eq.touch,source.eq.outlook').order('id')),
    selectAllPages(() => supabase.from('sales_mailbox_owners').select('mailbox_email, user_id').eq('business_id', businessId).order('mailbox_email')),
  ]);
  return { partners, domains, contacts, messages, events, partnerEvents, mailboxOwners };
}

export async function dryRun(supabase, businessId, now = new Date()) {
  const inputs = await loadOutlookTouchInputs(supabase, businessId);
  const out = proposeOutlookMoves({ ...inputs, now });
  return { dry_run: true, computed_at: now.toISOString(), ...out, counts: { ...out.counts, partners: inputs.partners.length, confirmed_domains: inputs.domains.length, contacts: inputs.contacts.length, settled_before: inputs.partnerEvents.filter(e => e.meta?.outlook_key).length } };
}

async function recordTouch(supabase, businessId, t, now) {
  const { event } = await applyPartnerSignal(supabase, {
    businessId, goalId: t.goal_id, byUser: t.by_user, now, source: 'outlook',
    signal: { type: 'touch', touch_type: 'email', date: t.date, move_to: 'none', contacts: [String(t.contact).slice(0, 80)], note: t.direction === 'received' ? 'Reply received (Outlook)' : null },
    meta: { outlook_touch_key: t.key, internet_message_id: t.internet_message_id, source_at: t.source_at, mailbox: t.mailbox, direction: t.direction },
  });
  return { key: t.key, goal_id: t.goal_id, partner: t.partner, contact: t.contact, date: t.date, direction: t.direction, event_id: event.id };
}

// A sent mail to a new address at the partner's confirmed domain becomes a
// partner_contacts row (source outlook). Same by-hand upsert as the Apollo
// sync: the (goal_id, email) unique index is partial.
async function addPeople(supabase, businessId, people) {
  const added = [];
  for (const p of people) {
    const { data: prev, error: rErr } = await supabase.from('partner_contacts').select('id').eq('business_id', businessId).eq('goal_id', p.goal_id).ilike('email', p.email).maybeSingle();
    if (rErr) throw new Error(`partner contacts: read failed: ${rErr.message}`);
    if (prev) continue;
    const { data, error } = await supabase.from('partner_contacts').insert({ business_id: businessId, goal_id: p.goal_id, name: (p.name || p.email).slice(0, 120), email: p.email, source: 'outlook',
      first_seen: `${p.first_seen}T19:00:00Z`, last_activity_at: `${p.first_seen}T19:00:00Z`, last_activity_type: 'email' }).select('id').single();
    if (error) throw new Error(`partner contacts: insert failed: ${error.message}`);
    added.push({ ...p, id: data.id });
  }
  return added;
}

// The facts: every touch the dry run would record, plus the people. No OK.
// Used by the daily step (Step 3) and by POST /record.
export async function recordOutlookTouches(supabase, businessId, { now = new Date() } = {}) {
  const dry = await dryRun(supabase, businessId, now);
  const recorded = [], refused = [];
  for (const t of dry.touches.would_record) {
    try { recorded.push(await recordTouch(supabase, businessId, t, now)); }
    catch (e) { if (!(e instanceof SignalError)) throw e; refused.push({ key: t.key, partner: t.partner, reason: e.message }); }
  }
  const people = await addPeople(supabase, businessId, dry.people);
  return { recorded, refused, people, skipped_manual: dry.touches.skipped_manual.length, already: dry.touches.already, duplicates: dry.touches.duplicates };
}

// Only keys the dry run proposes (or holds, when a member OKs by hand) RIGHT
// NOW are applied. A mail move first records its fact touch if the dry run
// still lists it, then moves the stage with `expect` = the stage the screen
// showed (409 if a teammate moved it since). A meeting move is one meeting
// touch dated as the dry run says, carrying the meeting day.
export async function applyOutlookMoves(supabase, { businessId, keys, byUser, now = new Date(), includeHeld = false, dry = null }) {
  dry = dry || await dryRun(supabase, businessId, now);
  const byKey = list => new Map(list.filter(m => m.key).map(m => [m.key, m]));
  const open = byKey(dry.proposed), heldBy = byKey(dry.held), skippedBy = byKey(dry.skipped);
  const touchBy = new Map(dry.touches.would_record.map(t => [t.move_key, t]));
  const applied = [], refused = [];
  for (const key of keys) {
    const m = open.get(key) || (includeHeld ? heldBy.get(key) : null);
    if (!m) {
      refused.push({ key, reason: heldBy.has(key) ? heldBy.get(key).hold_reason || heldBy.get(key).reason : skippedBy.has(key) ? skippedBy.get(key).reason : 'not proposed by the current dry run' });
      continue;
    }
    try {
      let touchEventId = null;
      if (touchBy.has(key)) touchEventId = (await recordTouch(supabase, businessId, touchBy.get(key), now)).event_id;
      const meta = { outlook_key: m.key, internet_message_id: m.internet_message_id || null, ical_uid: m.ical_uid || null, source_at: m.source_at, meeting_date: m.meeting_date || null, person: m.person, mailbox: m.mailbox, touch_event_id: touchEventId };
      const signal = m.to === MEETING
        ? { type: 'touch', touch_type: 'meeting', date: m.date, move_to: MEETING, expect: m.from, contacts: [String(m.person_contact).slice(0, 80)], note: m.meeting_date !== m.date ? `Meeting on ${m.meeting_date} (Outlook calendar)` : null }
        : { type: 'status', to: m.to, expect: m.from };
      const { event } = await applyPartnerSignal(supabase, { businessId, goalId: m.goal_id, byUser, now, source: 'outlook', signal, meta });
      applied.push({ key, goal_id: m.goal_id, partner: m.partner, from: m.from, to: m.to, date: m.date, person: m.person, person_name: m.person_name || null, reason: m.reason, event_id: event.id, touch_event_id: touchEventId, held_ok: !open.has(key) });
    } catch (e) {
      if (!(e instanceof SignalError)) throw e;
      refused.push({ key, partner: m.partner, reason: e.message });
    }
  }
  return { applied, refused };
}

// Dismiss = a note on the partner carrying the key, so the dry run treats it
// like an applied move (never proposed or held again) without moving anything.
export async function dismissOutlookMove(supabase, { businessId, key, byUser, now = new Date() }) {
  const dry = await dryRun(supabase, businessId, now);
  const h = dry.held.find(x => x.key === key) || dry.proposed.find(x => x.key === key);
  if (!h) throw new SignalError('that key is not proposed or held right now', 409);
  const { event } = await applyPartnerSignal(supabase, {
    businessId, goalId: h.goal_id, byUser, now, source: 'outlook',
    signal: { type: 'note', note: `Dismissed Outlook move to ${h.to}: ${h.reason}` },
    meta: { outlook_key: key, dismissed: true, source_at: h.source_at },
  });
  return { dismissed: { key, goal_id: h.goal_id, partner: h.partner, event_id: event.id } };
}

// The daily step, after every real Outlook sync (manual or piggyback): the
// facts first (touches + people), then every move the dry run calls auto
// (Sent, in-thread Replied) by nobody (by_user null = "automatic" in
// Activity); held moves (cold replies, meetings) only ever wait for an OK.
// One microsoft_sync_runs row under folder 'moves' carries the counts and
// the moves it made, so the panel can show the last run and offer Undo.
// Like every microsoft_sync_runs row: counts and names, never an address.
export async function runDailyOutlookMoves(supabase, businessId, { userId, trigger = 'manual', now = new Date() } = {}) {
  const t0 = Date.now();
  const { data: run, error: runErr } = await supabase.from('microsoft_sync_runs').insert({ business_id: businessId, user_id: userId, folder: 'moves', trigger, dry_run: false }).select('id').single();
  if (runErr) throw new Error(runErr.message);
  let counts = {}, error = null;
  try {
    const rec = await recordOutlookTouches(supabase, businessId, { now });
    const dry = await dryRun(supabase, businessId, now);
    const keys = dry.proposed.map(m => m.key);
    const ap = keys.length ? await applyOutlookMoves(supabase, { businessId, keys, byUser: null, now, dry }) : { applied: [], refused: [] };
    counts = {
      recorded: rec.recorded.length, people: rec.people.length, skipped_manual: rec.skipped_manual, already: rec.already, duplicates: rec.duplicates, touch_refused: rec.refused.length,
      applied: ap.applied.length, refused: ap.refused.length, held: dry.held.length,
      recorded_touches: rec.recorded.map(t => ({ key: t.key, goal_id: t.goal_id, partner: t.partner, contact: /@/.test(t.contact) ? null : t.contact, date: t.date, direction: t.direction, event_id: t.event_id })),
      people_added: rec.people.map(p => ({ goal_id: p.goal_id, partner: p.partner, name: p.name, id: p.id })),
      applied_moves: ap.applied.map(a => ({ key: a.key, goal_id: a.goal_id, partner: a.partner, from: a.from, to: a.to, date: a.date, person: a.person_name, event_id: a.event_id })),
      refused_moves: ap.refused.map(r => ({ key: r.key, partner: r.partner || null, reason: r.reason })),
      held_moves: dry.held.map(h => ({ key: h.key, goal_id: h.goal_id, partner: h.partner, to: h.to, date: h.date, reason: h.hold_reason })),
    };
  } catch (e) {
    error = String(e.message || e).slice(0, 500);
  }
  await supabase.from('microsoft_sync_runs').update({ seen: (counts.recorded || 0) + (counts.skipped_manual || 0) + (counts.already || 0) + (counts.duplicates || 0), stored: (counts.recorded || 0) + (counts.applied || 0), counts, error, duration_ms: Date.now() - t0, finished_at: new Date().toISOString() }).eq('id', run.id);
  console.log(`[outlook/moves] business=${businessId} trigger=${trigger} recorded=${counts.recorded ?? 0} people=${counts.people ?? 0} by_hand=${counts.skipped_manual ?? 0} applied=${counts.applied ?? 0} refused=${counts.refused ?? 0} held=${counts.held ?? 0}${error ? ' error=' + error : ''} ${Date.now() - t0}ms`);
  return { run_id: run.id, error, ...counts };
}

// The last daily step: its counts, and whether each applied move can still be
// undone (still the latest event on its partner) or already was.
export async function lastOutlookRun(supabase, businessId) {
  const { data: runs, error } = await supabase.from('microsoft_sync_runs').select('id, started_at, finished_at, trigger, counts, error')
    .eq('business_id', businessId).eq('folder', 'moves').order('started_at', { ascending: false }).limit(1);
  if (error) throw new Error(`outlook moves: read runs failed: ${error.message}`);
  const run = runs?.[0];
  if (!run) return null;
  const c = run.counts || {};
  const goalIds = [...new Set((c.applied_moves || []).map(a => a.goal_id))];
  const events = goalIds.length ? await selectAllPages(() => supabase.from('sales_partner_events').select('id, goal_id, event, recorded_at, meta')
    .eq('business_id', businessId).in('goal_id', goalIds).order('recorded_at', { ascending: false }).order('id', { ascending: false })) : [];
  const undone = new Set(events.filter(e => e.event === 'undo').map(e => e.meta?.undid).filter(Boolean));
  const latest = new Map();
  for (const e of events) if (!latest.has(e.goal_id)) latest.set(e.goal_id, e.id);
  return {
    at: run.started_at, trigger: run.trigger, error: run.error,
    recorded: c.recorded ?? 0, people: c.people ?? 0, skipped_manual: c.skipped_manual ?? 0, refused: c.refused ?? 0, held: c.held ?? 0,
    recorded_touches: c.recorded_touches || [], people_added: c.people_added || [],
    applied: (c.applied_moves || []).map(a => ({ ...a, undone: undone.has(a.event_id), undoable: !undone.has(a.event_id) && latest.get(a.goal_id) === a.event_id })),
    refused_moves: c.refused_moves || [], held_moves: c.held_moves || [],
  };
}

const memberOnly = (req, res) => { if (hasRole(req, req.params.businessId, 'member')) return true; res.status(403).json({ error: 'You need member access to this workspace' }); return false; };

// GET /goals/partners/outlook-touches - the dry run (members: it lists who wrote to whom).
export async function outlookTouchesDryRunRoute(req, res) {
  if (!memberOnly(req, res)) return;
  try {
    const supabase = getSupabase();
    const [dry, last] = await Promise.all([dryRun(supabase, req.params.businessId), lastOutlookRun(supabase, req.params.businessId)]);
    res.json({ ...dry, last_run: last });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// POST /goals/partners/outlook-touches/apply  body { keys: [...], include_held?: true }
export async function outlookTouchesApplyRoute(req, res) {
  const keys = req.body?.keys;
  if (!Array.isArray(keys) || !keys.length || keys.length > KEYS_MAX || !keys.every(k => typeof k === 'string' && k.length <= 300)) {
    return res.status(400).json({ error: `keys must be a list of 1 to ${KEYS_MAX} strings` });
  }
  try { res.json(await applyOutlookMoves(getSupabase(), { businessId: req.params.businessId, keys: [...new Set(keys)], byUser: req.auth.user.id, includeHeld: req.body.include_held === true })); }
  catch (e) { res.status(500).json({ error: e.message }); }
}

// POST /goals/partners/outlook-touches/dismiss  body { key }
export async function outlookTouchesDismissRoute(req, res) {
  const key = req.body?.key;
  if (typeof key !== 'string' || !key || key.length > 300) return res.status(400).json({ error: 'key is required' });
  try { res.json(await dismissOutlookMove(getSupabase(), { businessId: req.params.businessId, key, byUser: req.auth.user.id })); }
  catch (e) { res.status(e instanceof SignalError ? e.status : 500).json({ error: e.message }); }
}

// POST /goals/partners/outlook-touches/record - record the fact touches + people now.
export async function outlookTouchesRecordRoute(req, res) {
  if (!memberOnly(req, res)) return;
  try { res.json(await recordOutlookTouches(getSupabase(), req.params.businessId)); }
  catch (e) { res.status(500).json({ error: e.message }); }
}
