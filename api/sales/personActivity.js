import { scoreProspect, huddleSignals, isAutomated } from './heatScore.js';
import { SCANNER_CLICK_WITHIN_SECONDS } from './nextBestAction.js';
import { replyAt } from './replyTime.js';
import { selectAllPages } from '../lib/selectAllPages.js';

// people-v2 Stage 1 (P5) - the per-person email summary behind Pipeline › People, materialised in sales_person_activity
// and refreshed by the Apollo activity sync and the partner-contacts sync (api/sales/sync.js) - never on page load, never
// a cron. One person = ONE function over their message + activity rows: the Huddle's own score and band (heatScore.js
// scoreProspect + huddleSignals, imported, so the numbers equal the Huddle's to the digit) and the counts the table shows
// - human opens only (isAutomated: the Huddle's bot / scanner rule), scanner clicks out. Keys: prospect:<contact_id>
// (sales_prospect_state), contact:<id> (a partner contact whose Apollo contact id carries messages). Nothing here reads
// or writes an address.
export const CHUNK = 200;
const MISSING_TABLE = e => ['42P01', 'PGRST205'].includes(e?.code) || /sales_person_activity.*does not exist|relation .* does not exist|Could not find the table .*sales_person_activity|sales_person_activity.*schema cache/i.test(String(e?.message || ''));
export const isMigrationPending = MISSING_TABLE;
const last = xs => { const v = xs.filter(Boolean).sort(); return v.length ? v[v.length - 1] : null; };

export function summarizePerson(messages = [], events = [], now = Date.now()) {
  const deliveredById = new Map(messages.map(m => [m.apollo_message_id, m.delivered_at]));
  const oc = events.filter(e => e.event === 'open' || e.event === 'click');
  const tagged = oc.map(e => ({ ...e, automated: isAutomated(e, deliveredById.get(e.apollo_message_id), SCANNER_CLICK_WITHIN_SECONDS) }));
  const real = tagged.filter(e => !e.automated);
  const scored = scoreProspect(messages, events);
  const sig = huddleSignals(messages, events, scored, now, SCANNER_CLICK_WITHIN_SECONDS);
  const replies = messages.filter(m => m.replied);
  const latestReply = [...replies].sort((a, b) => String(replyAt(b) || b.delivered_at || '').localeCompare(String(replyAt(a) || a.delivered_at || '')))[0] || null;
  return {
    sent: messages.filter(m => m.delivered_at).length,
    opened_h: real.filter(e => e.event === 'open').length,
    bot_opens: tagged.filter(e => e.event === 'open' && e.automated).length,
    clicked: real.filter(e => e.event === 'click').length,
    replied: replies.length,
    last_sent_at: last(messages.map(m => m.delivered_at)),
    last_open_at: last(real.filter(e => e.event === 'open').map(e => e.occurred_at)),
    last_click_at: last(real.filter(e => e.event === 'click').map(e => e.occurred_at)),
    last_reply_at: latestReply ? replyAt(latestReply) || latestReply.delivered_at || null : null,
    reply_class: latestReply?.reply_class || null,
    heat: scored.score,
    heat_band: sig.heat_band,
    last_signal_at: scored.last_signal_at,
  };
}

// Pure: one row per person who has a message or an activity row (a silent person has no row - the table reads 0).
export function buildPersonActivity({ prospects = [], partnerContacts = [], messages = [], events = [], now = Date.now() }) {
  const by = (rows, key) => { const m = new Map(); for (const r of rows) { if (!m.has(r[key])) m.set(r[key], []); m.get(r[key]).push(r); } return m; };
  const msgsBy = by(messages, 'contact_id'), eventsBy = by(events, 'contact_id');
  const computed_at = new Date(now).toISOString();
  const rows = [];
  const push = (key, source_table, contactId) => {
    const msgs = msgsBy.get(contactId) || [], evs = eventsBy.get(contactId) || [];
    if (!msgs.length && !evs.length) return;
    rows.push({ person_key: key, source_table, contact_id: contactId, ...summarizePerson(msgs, evs, now), computed_at });
  };
  for (const p of prospects) push(`prospect:${p.contact_id}`, 'sales_prospect_state', p.contact_id);
  for (const c of partnerContacts) if (c.apollo_contact_id) push(`contact:${c.id}`, 'partner_contacts', c.apollo_contact_id);
  return rows;
}

// Every column scoreProspect reads (num_opens / last_opened_at / last_clicked_at feed the open points) - the Huddle selects *.
const MESSAGE_COLS = 'apollo_message_id,contact_id,sequence_id,step,delivered_at,replied,reply_class,replied_seen_at,replied_at,num_opens,num_clicks,last_opened_at,last_clicked_at,bounced';
const EVENT_COLS = 'id,apollo_message_id,contact_id,step,event,occurred_at,user_agent,tracking_service';

// Rewrites the workspace's rows (upsert) and drops keys that no longer have activity. -> { rows, removed } or
// { pending: true } when the migration has not run yet (the sync records that and carries on).
export async function writePersonActivity(supabase, businessId, { now = Date.now() } = {}) {
  const [prospects, partnerContacts, messages, events] = await Promise.all([
    selectAllPages(() => supabase.from('sales_prospect_state').select('contact_id').eq('business_id', businessId).order('contact_id')),
    selectAllPages(() => supabase.from('partner_contacts').select('id, apollo_contact_id').eq('business_id', businessId).order('id')),
    selectAllPages(() => supabase.from('sales_email_messages').select(MESSAGE_COLS).eq('business_id', businessId).order('apollo_message_id')),
    selectAllPages(() => supabase.from('sales_email_activity').select(EVENT_COLS).eq('business_id', businessId).order('id')),
  ]);
  const rows = buildPersonActivity({ prospects, partnerContacts, messages, events, now }).map(r => ({ business_id: businessId, ...r }));
  let existing;
  try { existing = await selectAllPages(() => supabase.from('sales_person_activity').select('person_key').eq('business_id', businessId).order('person_key')); }
  catch (e) { if (MISSING_TABLE(e)) return { pending: true, rows: rows.length, removed: 0 }; throw e; }
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from('sales_person_activity').upsert(rows.slice(i, i + CHUNK), { onConflict: 'business_id,person_key' });
    if (error) { if (MISSING_TABLE(error)) return { pending: true, rows: rows.length, removed: 0 }; throw new Error(error.message); }
  }
  const keep = new Set(rows.map(r => r.person_key));
  const stale = existing.map(r => r.person_key).filter(k => !keep.has(k));
  for (let i = 0; i < stale.length; i += CHUNK) {
    const { error } = await supabase.from('sales_person_activity').delete().eq('business_id', businessId).in('person_key', stale.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
  }
  return { rows: rows.length, removed: stale.length };
}
