import { scoreProspect, huddleSignals, isAutomated, visitSignal } from './heatScore.js';
import { SCANNER_CLICK_WITHIN_SECONDS } from './nextBestAction.js';
import { replyAt } from './replyTime.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { visitIndex } from './visitJoin.js';

// people-v2 Stage 1 (P5) - the per-person email summary behind Pipeline › People, materialised in sales_person_activity
// and refreshed by the Apollo activity sync and the partner-contacts sync (api/sales/sync.js) - never on page load, never
// a cron. One person = ONE function over their message + activity rows: the Huddle's own score and band (heatScore.js
// scoreProspect + huddleSignals, imported, so the numbers equal the Huddle's to the digit) and the counts the table shows
// - human opens only (isAutomated: the Huddle's bot / scanner rule), scanner clicks out. Keys: prospect:<contact_id>
// (sales_prospect_state), contact:<id> (a partner contact whose Apollo contact id carries messages), person:<id> (a
// sales_people row with a visit signal - heat-size-v1). Nothing here reads or writes an address.
// heat-size-v1 Stage 1: the company's latest web_visits row (visitJoin, the People table's own join) and the person's
// identification date go into the one score through heatScore.visitSignal - the visit points live in heatScore.js alone.
export const CHUNK = 200;
const MISSING_TABLE = e => ['42P01', 'PGRST205'].includes(e?.code) || /sales_person_activity.*does not exist|relation .* does not exist|Could not find the table .*sales_person_activity|sales_person_activity.*schema cache/i.test(String(e?.message || ''));
export const isMigrationPending = MISSING_TABLE;
const last = xs => { const v = xs.filter(Boolean).sort(); return v.length ? v[v.length - 1] : null; };

// visit: the company's latest web_visits row | null; identifiedAt: the person's sales_people created_at when they were
// identified from a visit (source_kind 'web_visit'), else null.
export function summarizePerson(messages = [], events = [], now = Date.now(), visit = null, identifiedAt = null) {
  const deliveredById = new Map(messages.map(m => [m.apollo_message_id, m.delivered_at]));
  const oc = events.filter(e => e.event === 'open' || e.event === 'click');
  const tagged = oc.map(e => ({ ...e, automated: isAutomated(e, deliveredById.get(e.apollo_message_id), SCANNER_CLICK_WITHIN_SECONDS) }));
  const real = tagged.filter(e => !e.automated);
  const scored = scoreProspect(messages, events, visitSignal({ visit, identifiedAt, now }), now);
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
    why: scored.why,
  };
}

// Pure: one row per person who has a message, an activity row or a visit signal (a silent person has no row - the
// table reads 0). opportunities / targets / partners: id + name so a company with no matched visit row still joins by
// name; visits: web_visits rows (the latest pull per company wins, visitJoin).
export function buildPersonActivity({ prospects = [], partnerContacts = [], salesPeople = [], messages = [], events = [], visits = [], opportunities = [], targets = [], partners = [], now = Date.now() }) {
  const by = (rows, key) => { const m = new Map(); for (const r of rows) { if (!m.has(r[key])) m.set(r[key], []); m.get(r[key]).push(r); } return m; };
  const msgsBy = by(messages, 'contact_id'), eventsBy = by(events, 'contact_id');
  const opp = new Map(opportunities.map(o => [o.id, o])), tgt = new Map(targets.map(t => [t.id, t])), goal = new Map(partners.map(g => [g.id, g]));
  const ref = (type, row) => (row ? { type, id: row.id, name: row.organization || row.name || '' } : null);
  const visitOf = visitIndex(visits);
  const computed_at = new Date(now).toISOString();
  const rows = [];
  const push = (key, source_table, contactId, company, identifiedAt = null) => {
    const msgs = contactId ? msgsBy.get(contactId) || [] : [], evs = contactId ? eventsBy.get(contactId) || [] : [];
    const visit = visitOf(company);
    if (!msgs.length && !evs.length && !visitSignal({ visit, identifiedAt, now })) return;
    const { why, ...summary } = summarizePerson(msgs, evs, now, visit, identifiedAt);
    rows.push({ person_key: key, source_table, contact_id: contactId, ...summary, computed_at });
  };
  for (const p of prospects) push(`prospect:${p.contact_id}`, 'sales_prospect_state', p.contact_id, p.opportunity_id ? ref('employer', opp.get(p.opportunity_id)) : p.goal_id ? ref('partner', goal.get(p.goal_id)) : p.company ? { type: 'account', id: null, name: p.company } : null);
  for (const c of partnerContacts) if (c.apollo_contact_id) push(`contact:${c.id}`, 'partner_contacts', c.apollo_contact_id, ref('partner', goal.get(c.goal_id)));
  for (const p of salesPeople) {
    if (p.archived_at) continue;
    const company = p.company_type === 'employer' && p.opportunity_id ? ref('employer', opp.get(p.opportunity_id)) : p.target_id ? ref('target', tgt.get(p.target_id)) : p.company_name ? { type: 'parked', id: null, name: p.company_name } : null;
    push(`person:${p.id}`, 'sales_people', null, company, p.source_kind === 'web_visit' ? p.created_at || null : null);
  }
  return rows;
}

// Every column scoreProspect reads (num_opens / last_opened_at / last_clicked_at feed the open points) - the Huddle selects *.
const MESSAGE_COLS = 'apollo_message_id,contact_id,sequence_id,step,delivered_at,replied,reply_class,replied_seen_at,replied_at,num_opens,num_clicks,last_opened_at,last_clicked_at,bounced';
const EVENT_COLS = 'id,apollo_message_id,contact_id,step,event,occurred_at,user_agent,tracking_service';

// Rewrites the workspace's rows (upsert) and drops keys that no longer have activity. -> { rows, removed } or
// { pending: true } when the migration has not run yet (the sync records that and carries on).
export async function writePersonActivity(supabase, businessId, { now = Date.now() } = {}) {
  const all = (table, cols, build = x => x) => selectAllPages(() => build(supabase.from(table).select(cols).eq('business_id', businessId)).order('id'));
  const [prospects, partnerContacts, salesPeople, opportunities, targets, partners, visits, messages, events] = await Promise.all([
    selectAllPages(() => supabase.from('sales_prospect_state').select('contact_id, company, opportunity_id, goal_id').eq('business_id', businessId).order('contact_id')),
    all('partner_contacts', 'id, apollo_contact_id, goal_id'),
    all('sales_people', 'id, company_type, opportunity_id, target_id, company_name, source_kind, created_at, archived_at'),
    all('sales_opportunities', 'id, organization'),
    all('sales_targets', 'id, name'),
    all('sales_goals', 'id, name', x => x.eq('goal_type', 'partnership')),
    all('web_visits', 'id, company_key, matched_type, matched_id, visits_7d, unique_visitors_7d, last_visit, seen_to, pulled_on'),
    selectAllPages(() => supabase.from('sales_email_messages').select(MESSAGE_COLS).eq('business_id', businessId).order('apollo_message_id')),
    selectAllPages(() => supabase.from('sales_email_activity').select(EVENT_COLS).eq('business_id', businessId).order('id')),
  ]);
  const rows = buildPersonActivity({ prospects, partnerContacts, salesPeople, opportunities, targets, partners, visits, messages, events, now }).map(r => ({ business_id: businessId, ...r }));
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

// people-v2 Stage 2 (P4) - one person's email timeline for the pinned detail card: sent / open / click / reply rows,
// newest first, each open or click flagged automated by the Huddle's own rule (so the card and the counts agree).
export function timelineFor(messages = [], events = []) {
  const deliveredById = new Map(messages.map(m => [m.apollo_message_id, m.delivered_at]));
  const stepById = new Map(messages.map(m => [m.apollo_message_id, m.step]));
  const rows = [
    ...events.filter(e => e.event === 'open' || e.event === 'click').map(e => ({ kind: e.event, at: e.occurred_at, step: e.step ?? stepById.get(e.apollo_message_id) ?? null, automated: isAutomated(e, deliveredById.get(e.apollo_message_id), SCANNER_CLICK_WITHIN_SECONDS), message_id: e.apollo_message_id })),
    ...messages.filter(m => m.replied).map(m => ({ kind: 'reply', at: replyAt(m) || m.delivered_at || null, step: m.step ?? null, automated: false, seen_at_sync: !m.replied_at, reply_class: m.reply_class || null, message_id: m.apollo_message_id })),
    ...messages.filter(m => m.delivered_at).map(m => ({ kind: 'sent', at: m.delivered_at, step: m.step ?? null, automated: false, subject: m.subject || null, message_id: m.apollo_message_id })),
  ];
  return rows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}
