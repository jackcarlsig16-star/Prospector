// partner-360-v1 Stage 4 - stage moves proposed from what Apollo data we
// already store: a contact's sequence_added_at -> Sent, a stored reply by
// contact id -> Replied. The dry run proposes; Jack OKs keys; apply writes
// each approved move through applyPartnerSignal as a touch "from Apollo".
// Dedupe keys live in the event's meta.apollo_key once a move is applied, so
// a re-run skips it even after an undo (an undone move was rejected, not lost).
import { selectAllPages } from '../lib/selectAllPages.js';
import { getSupabase } from './goalsShared.js';
import { hasRole } from '../lib/requireAuth.js';
import { laDateString } from './laDate.js';
import { applyPartnerSignal, SignalError } from './partnerSignals.js';
import { PIPELINE_STATUS_IDS } from '../../src/constants/partnerPipeline.js';

export const SENT = 'first_email_sent', REPLIED = 'replied';
// Apollo never recorded when the reply arrived; replied_seen_at is the sync
// that first saw it. The label travels with the date so the UI can't drop it.
export const DATE_LABELS = { [SENT]: 'in sequence since', [REPLIED]: 'seen at sync' };
// Jack, 2026-10-08: enrollment in a paused sequence doesn't prove step 1 went
// out. A partner whose sequenced contacts are ALL paused is held, never proposed.
export const HELD_REASON = 'enrolled, paused — needs Jack';
export const KEYS_MAX = 50;

const rank = status => PIPELINE_STATUS_IDS.indexOf(status || 'not_started');
export const isBehind = (current, target) => rank(current) < rank(target);

export const sentKey = c => `sent:${c.apollo_contact_id}:${c.sequence_added_at}`;
export const replyKey = m => `reply:${m.apollo_message_id}`;

const earliest = (rows, field) => rows.slice().sort((a, b) => Date.parse(a[field]) - Date.parse(b[field]))[0];

function sentCandidate(base, first, count) {
  const date = laDateString(new Date(first.sequence_added_at));
  return { ...base, to: SENT, key: sentKey(first), contact_name: first.name, apollo_contact_id: first.apollo_contact_id, apollo_message_id: null,
    source_at: first.sequence_added_at, date, date_label: DATE_LABELS[SENT],
    reason: `${first.name} ${DATE_LABELS[SENT]} ${date}${count > 1 ? `, +${count - 1} more in sequence` : ''}` };
}

// One proposal per partner: the furthest target it is behind. A partner
// behind both Sent and Replied gets Replied only - Sent would resurface as
// "not behind" next run, never as a duplicate.
export function proposeMoves({ partners, contacts, messages, events, now = new Date() }) {
  const applied = new Set(events.map(e => e.meta?.apollo_key).filter(Boolean));
  const contactsByGoal = new Map();
  for (const c of contacts) { if (!contactsByGoal.has(c.goal_id)) contactsByGoal.set(c.goal_id, []); contactsByGoal.get(c.goal_id).push(c); }
  const repliesByContact = new Map();
  for (const m of messages) { if (!m.replied) continue; if (!repliesByContact.has(m.contact_id)) repliesByContact.set(m.contact_id, []); repliesByContact.get(m.contact_id).push(m); }

  const proposed = [], skipped = [], held = [];
  for (const p of partners) {
    const people = (contactsByGoal.get(p.id) || []).filter(c => c.apollo_contact_id);
    const base = { goal_id: p.id, partner: p.name, from: p.pipeline_status || 'not_started' };
    const replies = people.flatMap(c => (repliesByContact.get(c.apollo_contact_id) || []).map(m => ({ m, c })));
    const sequenced = people.filter(c => c.sequence_added_at);
    if (!replies.length && !sequenced.length) continue;

    let candidate = null;
    if (replies.length) {
      const seen = replies.filter(r => r.m.replied_seen_at);
      if (!seen.length) skipped.push({ ...base, to: REPLIED, reason: `${replies.length} stored reply with no replied_seen_at` });
      else {
        const first = earliest(seen.map(r => ({ ...r, replied_seen_at: r.m.replied_seen_at })), 'replied_seen_at');
        const date = laDateString(new Date(first.m.replied_seen_at));
        candidate = { ...base, to: REPLIED, key: replyKey(first.m), contact_name: first.c.name, apollo_contact_id: first.c.apollo_contact_id, apollo_message_id: first.m.apollo_message_id,
          source_at: first.m.replied_seen_at, date, date_label: DATE_LABELS[REPLIED],
          reason: `reply from ${first.c.name} (${DATE_LABELS[REPLIED]} ${date})${seen.length > 1 ? `, +${seen.length - 1} more` : ''}` };
      }
    }
    if (!candidate && sequenced.length) {
      const unpaused = sequenced.filter(c => c.sequence_status !== 'paused');
      if (unpaused.length) candidate = sentCandidate(base, earliest(unpaused, 'sequence_added_at'), sequenced.length);
      else {
        candidate = sentCandidate(base, earliest(sequenced, 'sequence_added_at'), sequenced.length);
        if (isBehind(p.pipeline_status, SENT) && p.pipeline_status !== 'paused' && !applied.has(candidate.key)) {
          held.push({ ...candidate, reason: `${HELD_REASON} (${sequenced.length} paused)` });
          continue;
        }
      }
    }
    if (!candidate) continue;
    if (candidate.date > laDateString(now)) { skipped.push({ ...candidate, reason: `${candidate.reason} - date is in the future` }); continue; }
    if (p.pipeline_status === 'paused') { skipped.push({ ...candidate, reason: `${candidate.reason} - partner is paused` }); continue; }
    if (!isBehind(p.pipeline_status, candidate.to)) { skipped.push({ ...candidate, reason: `${candidate.reason} - already at or past ${candidate.to} (${base.from})` }); continue; }
    if (applied.has(candidate.key)) { skipped.push({ ...candidate, reason: `${candidate.reason} - already applied (${candidate.key})` }); continue; }
    proposed.push(candidate);
  }
  const byName = (a, b) => a.partner.localeCompare(b.partner);
  proposed.sort(byName); held.sort(byName);
  return { proposed, skipped, held };
}

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

export async function loadApolloTouchInputs(supabase, businessId) {
  const [partners, contacts, events] = await Promise.all([
    selectAllPages(() => supabase.from('sales_goals').select('id, name, pipeline_status, first_email_at, last_touch_at')
      .eq('business_id', businessId).eq('goal_type', 'partnership').is('archived_at', null).order('id')),
    selectAllPages(() => supabase.from('partner_contacts').select('goal_id, apollo_contact_id, name, sequence_added_at, sequence_status')
      .eq('business_id', businessId).not('apollo_contact_id', 'is', null).order('id')),
    selectAllPages(() => supabase.from('sales_partner_events').select('goal_id, meta').eq('business_id', businessId).eq('source', 'apollo').order('id')),
  ]);
  const ids = [...new Set(contacts.map(c => c.apollo_contact_id))];
  const messages = [];
  for (const part of chunk(ids, 150)) {
    messages.push(...await selectAllPages(() => supabase.from('sales_email_messages').select('apollo_message_id, contact_id, replied, replied_seen_at')
      .eq('business_id', businessId).eq('replied', true).in('contact_id', part).order('apollo_message_id')));
  }
  return { partners, contacts, messages, events };
}

export async function dryRun(supabase, businessId) {
  const inputs = await loadApolloTouchInputs(supabase, businessId);
  const { proposed, skipped, held } = proposeMoves(inputs);
  return {
    dry_run: true, computed_at: new Date().toISOString(), proposed, held, skipped,
    counts: { partners: inputs.partners.length, apollo_contacts: inputs.contacts.length, replies: inputs.messages.length, applied_before: inputs.events.length, proposed: proposed.length, held: held.length, skipped: skipped.length },
  };
}

// Only keys the dry run proposes RIGHT NOW are applied - a key that went
// stale (partner moved, undone before, held) is refused with the reason.
// Each move is an email touch dated on the source day with the stage the
// screen showed as `expect`, so a teammate's click in between is a 409.
export async function applyApolloTouches(supabase, { businessId, keys, byUser, now = new Date() }) {
  const { proposed, held, skipped } = await dryRun(supabase, businessId);
  const byKey = list => new Map(list.filter(m => m.key).map(m => [m.key, m]));
  const open = byKey(proposed), heldBy = byKey(held), skippedBy = byKey(skipped);
  const applied = [], refused = [];
  for (const key of keys) {
    const m = open.get(key);
    if (!m) {
      refused.push({ key, reason: heldBy.has(key) ? heldBy.get(key).reason : skippedBy.has(key) ? skippedBy.get(key).reason : 'not proposed by the current dry run' });
      continue;
    }
    try {
      const { event } = await applyPartnerSignal(supabase, {
        businessId, goalId: m.goal_id, byUser, now, source: 'apollo',
        signal: { type: 'touch', touch_type: 'email', date: m.date, move_to: m.to, expect: m.from, contacts: [m.contact_name.slice(0, 80)] },
        meta: { apollo_key: m.key, apollo_contact_id: m.apollo_contact_id, apollo_message_id: m.apollo_message_id, source_at: m.source_at, date_label: m.date_label },
      });
      applied.push({ key, goal_id: m.goal_id, partner: m.partner, from: m.from, to: m.to, date: m.date, event_id: event.id });
    } catch (e) {
      if (!(e instanceof SignalError)) throw e;
      refused.push({ key, partner: m.partner, reason: e.message });
    }
  }
  return { applied, refused };
}

// GET /goals/partners/apollo-touches - the dry run. A GET passes salesGate
// at viewer level, but this lists who replied to whom, so members only.
export async function apolloTouchesDryRunRoute(req, res) {
  const businessId = req.params.businessId;
  if (!hasRole(req, businessId, 'member')) return res.status(403).json({ error: 'You need member access to this workspace' });
  try {
    res.json(await dryRun(getSupabase(), businessId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// POST /goals/partners/apollo-touches/apply  body { keys: [...] }
export async function apolloTouchesApplyRoute(req, res) {
  const keys = req.body?.keys;
  if (!Array.isArray(keys) || !keys.length || keys.length > KEYS_MAX || !keys.every(k => typeof k === 'string' && k.length <= 200)) {
    return res.status(400).json({ error: `keys must be a list of 1 to ${KEYS_MAX} strings` });
  }
  try {
    res.json(await applyApolloTouches(getSupabase(), { businessId: req.params.businessId, keys: [...new Set(keys)], byUser: req.auth.user.id }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
