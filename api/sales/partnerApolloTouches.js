// partner-360-v1 Stage 4 - stage moves proposed from what Apollo data we
// already store: a contact's sequence_added_at -> Sent, a stored reply by
// contact id -> Replied. Step 1 is the dry run only: nothing here writes.
// Dedupe keys live in the event's meta.apollo_key once a move is applied, so
// a re-run skips it even after an undo (an undone move was rejected, not lost).
import { selectAllPages } from '../lib/selectAllPages.js';
import { getSupabase } from './goalsShared.js';
import { hasRole } from '../lib/requireAuth.js';
import { laDateString } from './laDate.js';
import { PIPELINE_STATUS_IDS } from '../../src/constants/partnerPipeline.js';

export const SENT = 'first_email_sent', REPLIED = 'replied';
// Apollo never recorded when the reply arrived; replied_seen_at is the sync
// that first saw it. The label travels with the date so the UI can't drop it.
export const DATE_LABELS = { [SENT]: 'in sequence since', [REPLIED]: 'seen at sync' };

const rank = status => PIPELINE_STATUS_IDS.indexOf(status || 'not_started');
export const isBehind = (current, target) => rank(current) < rank(target);

export const sentKey = c => `sent:${c.apollo_contact_id}:${c.sequence_added_at}`;
export const replyKey = m => `reply:${m.apollo_message_id}`;

const earliest = (rows, field) => rows.slice().sort((a, b) => Date.parse(a[field]) - Date.parse(b[field]))[0];

// One proposal per partner: the furthest target it is behind. A partner
// behind both Sent and Replied gets Replied only - Sent would resurface as
// "not behind" next run, never as a duplicate.
export function proposeMoves({ partners, contacts, messages, events, now = new Date() }) {
  const applied = new Set(events.map(e => e.meta?.apollo_key).filter(Boolean));
  const contactsByGoal = new Map();
  for (const c of contacts) { if (!contactsByGoal.has(c.goal_id)) contactsByGoal.set(c.goal_id, []); contactsByGoal.get(c.goal_id).push(c); }
  const repliesByContact = new Map();
  for (const m of messages) { if (!m.replied) continue; if (!repliesByContact.has(m.contact_id)) repliesByContact.set(m.contact_id, []); repliesByContact.get(m.contact_id).push(m); }

  const proposed = [], skipped = [];
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
        candidate = { ...base, to: REPLIED, key: replyKey(first.m), contact_name: first.c.name, apollo_contact_id: first.c.apollo_contact_id, apollo_message_id: first.m.apollo_message_id,
          source_at: first.m.replied_seen_at, date: laDateString(new Date(first.m.replied_seen_at)), date_label: DATE_LABELS[REPLIED],
          reason: `reply from ${first.c.name} (${DATE_LABELS[REPLIED]} ${laDateString(new Date(first.m.replied_seen_at))})${seen.length > 1 ? `, +${seen.length - 1} more` : ''}` };
      }
    }
    if (!candidate && sequenced.length) {
      const first = earliest(sequenced, 'sequence_added_at');
      candidate = { ...base, to: SENT, key: sentKey(first), contact_name: first.name, apollo_contact_id: first.apollo_contact_id, apollo_message_id: null,
        source_at: first.sequence_added_at, date: laDateString(new Date(first.sequence_added_at)), date_label: DATE_LABELS[SENT],
        reason: `${first.name} ${DATE_LABELS[SENT]} ${laDateString(new Date(first.sequence_added_at))}${sequenced.length > 1 ? `, +${sequenced.length - 1} more in sequence` : ''}` };
    }
    if (!candidate) continue;
    if (candidate.date > laDateString(now)) { skipped.push({ ...candidate, reason: `${candidate.reason} - date is in the future` }); continue; }
    if (p.pipeline_status === 'paused') { skipped.push({ ...candidate, reason: `${candidate.reason} - partner is paused` }); continue; }
    if (!isBehind(p.pipeline_status, candidate.to)) { skipped.push({ ...candidate, reason: `${candidate.reason} - already at or past ${candidate.to} (${base.from})` }); continue; }
    if (applied.has(candidate.key)) { skipped.push({ ...candidate, reason: `${candidate.reason} - already applied (${candidate.key})` }); continue; }
    proposed.push(candidate);
  }
  proposed.sort((a, b) => a.partner.localeCompare(b.partner));
  return { proposed, skipped };
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

// GET /goals/partners/apollo-touches - the dry run. A GET passes salesGate
// at viewer level, but this lists who replied to whom, so members only.
export async function apolloTouchesDryRunRoute(req, res) {
  const businessId = req.params.businessId;
  if (!hasRole(req, businessId, 'member')) return res.status(403).json({ error: 'You need member access to this workspace' });
  try {
    const inputs = await loadApolloTouchInputs(getSupabase(), businessId);
    const { proposed, skipped } = proposeMoves(inputs);
    res.json({
      dry_run: true, computed_at: new Date().toISOString(), proposed, skipped,
      counts: { partners: inputs.partners.length, apollo_contacts: inputs.contacts.length, replies: inputs.messages.length, applied_before: inputs.events.length, proposed: proposed.length, skipped: skipped.length },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
