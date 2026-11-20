import { selectAllPages } from '../lib/selectAllPages.js';
import { companyJoin } from './funnelMath.js';
import { isAutomated } from './heatScore.js';
import { SCANNER_CLICK_WITHIN_SECONDS } from './nextBestAction.js';
import { replyAt } from './replyTime.js';
import { normName } from './normName.js';

// FIX touch-truth T1 - the ONE touch reader. touchesFor(sb, businessId, record | records[]) ->
//   { count, last: { at, kind, by, what } | null, kinds: { <kind>: n }, last_signal: { at, kind } | null }
// (an array in -> an array out, same order). record = { type: partner | employer | target, id }, or { name } for a
// company with no record (its Apollo emails only, by the join's name rule).
// OURS (count, last): every Apollo email (sales_email_delivered through funnelMath's K3 join, plus the engaged-only
// sales_email_messages rows that predate that table), Outlook mail we sent to an employer's / target's domain (a
// partner's Outlook mail already lands as its touch events), a partner's touch / note / status events, an employer's
// stage moves, done to-dos, call notes tied to the record (a to-do made from the call, or the target the call created),
// people marked contacted / booked.
// THEIRS (kinds.open / click / reply, last_signal): human opens and clicks, replies, site visits. Never summed with ours.
// `by` is a member's user id (callers turn it into a first name); `what` is a source word, never free text - a to-do's
// text can name a person. No address leaves this file: a sending mailbox is read only to find its owner's user id.
export const OUR_KINDS = ['email', 'call', 'meeting', 'linkedin', 'note', 'todo', 'stage', 'contacted'];
export const THEIR_KINDS = ['open', 'click', 'reply'];
export const RECORD_TYPES = ['partner', 'employer', 'target'];
const REACHED = ['contacted', 'booked'];
// The words every reader prints for a kind (the email, the window, the scores' channel, Scout).
export const TOUCH_KIND_WORD = { email: 'email', call: 'call', meeting: 'meeting', linkedin: 'LinkedIn', note: 'note', todo: 'to-do', stage: 'stage moved', contacted: 'marked contacted' };
export const TOUCHES_LEGEND = 'Touches count our emails (Apollo), calls, notes, to-dos and stage moves; opens and visits are theirs.';
const PARTNER_KIND = { email: 'email', call: 'call', meeting: 'meeting', linkedin: 'linkedin', event: 'note', other: 'note' };
// A stage move or a status written in the same request as a to-do is that to-do, not a second touch.
const SAME_ACT_MS = 10e3;
const CHUNK = 100;
const keyOfRecord = r => (RECORD_TYPES.includes(r?.type) && r.id ? `${r.type}:${r.id}` : r?.name ? `name:${normName(r.name)}` : null);
const noon = date => `${String(date).slice(0, 10)}T20:00:00.000Z`;

const all = (sb, b, table, cols, build = q => q, order = 'id') => selectAllPages(() => build(sb.from(table).select(cols).eq('business_id', b)).order(order));
async function byIn(sb, b, table, cols, col, ids, order = 'id', build = q => q) {
  const list = [...new Set(ids.filter(Boolean))], out = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(...await all(sb, b, table, cols, q => build(q).in(col, list.slice(i, i + CHUNK)), order));
  return out;
}
const DELIVERED = 'apollo_message_id, contact_id, account_id, mailbox, delivered_at';
const MESSAGES = 'apollo_message_id, contact_id, delivered_at, replied, replied_at, replied_seen_at';
const ACTIVITY = 'id, apollo_message_id, contact_id, event, occurred_at, user_agent, tracking_service';
const TODOS = 'id, status, link_type, link_id, completed_at, owner_user_id, source_note_id';
const OUTLOOK = 'graph_id, internet_message_id, user_id, occurred_at, external_domains';
const VISITS = 'id, matched_type, matched_id, last_visit, pulled_on';

// The read set. only = one record: the six small join tables whole (the K3 join needs every record to resolve a
// message the same way the funnel does), the message-level tables narrowed to that record. No only = the workspace.
export async function loadTouchRows(sb, b, only = null) {
  const [opportunities, targets, partners, prospects, partnerContacts, sequenced, mailboxes] = await Promise.all([
    all(sb, b, 'sales_opportunities', 'id, organization, apollo_account_id, domain'),
    all(sb, b, 'sales_targets', 'id, name, apollo_account_id, employer_id, domain, source_note_id'),
    all(sb, b, 'sales_goals', 'id, name, last_touch_at', q => q.eq('goal_type', 'partnership')),
    all(sb, b, 'sales_prospect_state', 'contact_id, company, opportunity_id, goal_id, status, updated_at', q => q, 'contact_id'),
    all(sb, b, 'partner_contacts', 'id, apollo_contact_id, goal_id'),
    all(sb, b, 'sales_sequenced_accounts', 'account_id, name', q => q, 'account_id'),
    sb.from('sales_mailbox_owners').select('mailbox_email, user_id').eq('business_id', b).then(r => r.data || []),
  ]);
  const join = { opportunities, targets, partners, prospects, partnerContacts, sequenced, mailboxes };
  const notesFor = async (todos, targetRows) => {
    const ids = [...todos.map(t => t.source_note_id), ...targetRows.map(t => t.source_note_id)];
    return byIn(sb, b, 'sales_call_notes', 'id, call_date, created_by', 'id', ids);
  };
  if (!only) {
    const [delivered, messages, events, todos, oppEvents, partnerEvents, outlook, visits] = await Promise.all([
      all(sb, b, 'sales_email_delivered', DELIVERED, q => q, 'apollo_message_id'),
      all(sb, b, 'sales_email_messages', MESSAGES, q => q, 'apollo_message_id'),
      all(sb, b, 'sales_email_activity', ACTIVITY),
      all(sb, b, 'sales_week_goals', TODOS, q => q.eq('kind', 'todo').in('link_type', RECORD_TYPES)),
      all(sb, b, 'sales_opportunity_events', 'id, opportunity_id, changed_at', q => q.eq('event_type', 'stage_change')),
      all(sb, b, 'sales_partner_events', 'id, goal_id, event, at, touch_type, by_user, meta', q => q.in('event', ['touch', 'note', 'status'])),
      all(sb, b, 'microsoft_messages', OUTLOOK, q => q.eq('direction', 'sent')),
      all(sb, b, 'web_visits', VISITS, q => q.not('matched_id', 'is', null)),
    ]);
    return { ...join, delivered, messages, events, todos, oppEvents, partnerEvents, outlook, visits, notes: await notesFor(todos, targets) };
  }
  const { type = null, id = null } = only;
  const rec = (type === 'employer' ? opportunities : type === 'target' ? targets : partners).find(r => String(r.id) === String(id)) || null;
  const nameKey = normName(rec?.organization || rec?.name || (type ? '' : only.name) || '');
  const sameName = n => !!nameKey && normName(n || '') === nameKey;
  const accounts = [rec?.apollo_account_id, ...(type === 'employer' ? targets.filter(t => t.employer_id === id).map(t => t.apollo_account_id) : []), ...sequenced.filter(a => sameName(a.name)).map(a => a.account_id)];
  const contacts = [
    ...prospects.filter(p => (type === 'employer' && p.opportunity_id === id) || (type === 'partner' && p.goal_id === id) || sameName(p.company)).map(p => p.contact_id),
    ...(type === 'partner' ? partnerContacts.filter(c => c.goal_id === id).map(c => c.apollo_contact_id) : []),
  ];
  const [byAccount, byContact] = await Promise.all([
    byIn(sb, b, 'sales_email_delivered', DELIVERED, 'account_id', accounts, 'apollo_message_id'),
    byIn(sb, b, 'sales_email_delivered', DELIVERED, 'contact_id', contacts, 'apollo_message_id'),
  ]);
  const delivered = [...new Map([...byAccount, ...byContact].map(d => [d.apollo_message_id, d])).values()];
  const people = [...contacts, ...delivered.map(d => d.contact_id)];
  const domain = type === 'partner' ? null : String(rec?.domain || '').trim().toLowerCase() || null;
  const [messages, events, todos, oppEvents, partnerEvents, outlook, visits] = await Promise.all([
    byIn(sb, b, 'sales_email_messages', MESSAGES, 'contact_id', people, 'apollo_message_id'),
    byIn(sb, b, 'sales_email_activity', ACTIVITY, 'contact_id', people),
    type ? all(sb, b, 'sales_week_goals', TODOS, q => q.eq('kind', 'todo').eq('link_type', type).eq('link_id', String(id))) : [],
    type === 'employer' ? all(sb, b, 'sales_opportunity_events', 'id, opportunity_id, changed_at', q => q.eq('event_type', 'stage_change').eq('opportunity_id', id)) : [],
    type === 'partner' ? all(sb, b, 'sales_partner_events', 'id, goal_id, event, at, touch_type, by_user, meta', q => q.eq('goal_id', id).in('event', ['touch', 'note', 'status'])) : [],
    domain ? all(sb, b, 'microsoft_messages', OUTLOOK, q => q.eq('direction', 'sent').contains('external_domains', [domain])) : [],
    type ? all(sb, b, 'web_visits', VISITS, q => q.eq('matched_type', type).eq('matched_id', id)) : [],
  ]);
  return { ...join, delivered, messages, events, todos, oppEvents, partnerEvents, outlook, visits, notes: await notesFor(todos, type === 'target' && rec ? [rec] : []) };
}

// Pure: the read set -> key 'type:id' -> { ours: [{ at, kind, by, what }], theirs: [{ at, kind }] }.
export function touchIndex(rows) {
  const { opportunities = [], targets = [], partners = [], delivered = [], messages = [], events = [], prospects = [], todos = [], oppEvents = [], partnerEvents = [], outlook = [], visits = [], notes = [], mailboxes = [] } = rows;
  const { companyOf, keyOf } = companyJoin(rows);
  const by = new Map();
  const slot = key => { if (!by.has(key)) by.set(key, { ours: [], theirs: [] }); return by.get(key); };
  const ours = (key, at, kind, who = null, what = null) => { if (key && at) slot(key).ours.push({ at, kind, by: who || null, what }); };
  const theirs = (key, at, kind) => { if (key && at) slot(key).theirs.push({ at, kind }); };
  // A message to a company with no record is kept under its name, so a "Not in Prospector" row still says it was emailed.
  const recordKey = row => { const c = companyOf(row); return c ? keyOf(c) : null; };

  const senderOf = new Map(mailboxes.map(m => [String(m.mailbox_email || '').toLowerCase(), m.user_id]));
  const sent = new Map();
  for (const d of delivered) sent.set(d.apollo_message_id, { key: recordKey(d), at: d.delivered_at, by: senderOf.get(d.mailbox) || null });
  for (const m of messages) if (m.delivered_at && !sent.has(m.apollo_message_id)) sent.set(m.apollo_message_id, { key: recordKey({ account_id: null, contact_id: m.contact_id }), at: m.delivered_at, by: null });
  const apolloKeys = new Set();
  for (const s of sent.values()) { ours(s.key, s.at, 'email', s.by, 'Apollo'); if (s.key) apolloKeys.add(s.key); }
  for (const e of events) {
    if (e.event !== 'open' && e.event !== 'click') continue;
    const s = sent.get(e.apollo_message_id);
    if (!s || isAutomated(e, s.at, SCANNER_CLICK_WITHIN_SECONDS)) continue;
    theirs(s.key, e.occurred_at, e.event);
  }
  for (const m of messages) if (m.replied) theirs(sent.get(m.apollo_message_id)?.key, replyAt(m) || m.delivered_at, 'reply');

  const byDomain = new Map();
  for (const o of opportunities) if (o.domain) byDomain.set(String(o.domain).toLowerCase(), `employer:${o.id}`);
  for (const t of targets) if (t.domain && !byDomain.has(String(t.domain).toLowerCase())) byDomain.set(String(t.domain).toLowerCase(), `target:${t.id}`);
  const mailed = new Set();
  for (const m of outlook) {
    const id = m.internet_message_id || m.graph_id;
    for (const key of new Set((m.external_domains || []).map(d => byDomain.get(String(d).toLowerCase())).filter(Boolean))) {
      if (mailed.has(`${id}|${key}`)) continue;
      mailed.add(`${id}|${key}`);
      ours(key, m.occurred_at, 'email', m.user_id, 'Outlook');
    }
  }

  for (const e of partnerEvents) {
    const key = `partner:${e.goal_id}`;
    // A touch the Apollo hook wrote for a send the delivered rows already count.
    if (e.event === 'touch' && e.meta?.apollo_key && apolloKeys.has(key)) continue;
    ours(key, e.at, e.event === 'touch' ? PARTNER_KIND[e.touch_type] || 'note' : e.event === 'note' ? 'note' : 'stage', e.by_user);
  }
  // A partner stamped by the sheet import (or by hand before events existed) has a last touch and no event for it.
  for (const g of partners) {
    if (!g.last_touch_at) continue;
    const day = String(g.last_touch_at).slice(0, 10);
    if (!(by.get(`partner:${g.id}`)?.ours || []).some(t => String(t.at).slice(0, 10) >= day)) ours(`partner:${g.id}`, g.last_touch_at, 'note', null, 'logged');
  }
  for (const e of oppEvents) ours(`employer:${e.opportunity_id}`, e.changed_at, 'stage');
  const noteById = new Map(notes.map(n => [n.id, n]));
  const called = new Set();
  const call = (key, noteId) => {
    const n = noteById.get(noteId);
    if (!n || called.has(`${noteId}|${key}`)) return;
    called.add(`${noteId}|${key}`);
    ours(key, noon(n.call_date), 'call', n.created_by, 'call note');
  };
  for (const t of todos) {
    if (!RECORD_TYPES.includes(t.link_type) || !t.link_id) continue;
    const key = `${t.link_type}:${t.link_id}`;
    if (t.status === 'done' && t.completed_at) ours(key, t.completed_at, 'todo', t.owner_user_id);
    if (t.source_note_id) call(key, t.source_note_id);
  }
  for (const t of targets) if (t.source_note_id) call(`target:${t.id}`, t.source_note_id);
  for (const p of prospects) if (REACHED.includes(p.status)) ours(recordKey({ account_id: null, contact_id: p.contact_id }), p.updated_at, 'contacted');
  for (const v of visits) if (v.matched_type && v.matched_id) theirs(`${v.matched_type}:${v.matched_id}`, v.last_visit ? noon(v.last_visit) : v.pulled_on ? noon(v.pulled_on) : null, 'visit');
  return by;
}

const EMPTY_KINDS = () => Object.fromEntries([...OUR_KINDS, ...THEIR_KINDS].map(k => [k, 0]));
const latest = list => list.reduce((best, t) => (!best || String(t.at) > String(best.at) ? t : best), null);
export function summarize(entry) {
  const kinds = EMPTY_KINDS();
  if (!entry) return { count: 0, last: null, kinds, last_signal: null };
  const todoTimes = entry.ours.filter(t => t.kind === 'todo').map(t => Date.parse(t.at));
  const mine = entry.ours.filter(t => !(['stage', 'contacted'].includes(t.kind) && todoTimes.some(ms => Math.abs(ms - Date.parse(t.at)) <= SAME_ACT_MS)));
  for (const t of mine) kinds[t.kind]++;
  for (const t of entry.theirs) if (t.kind in kinds) kinds[t.kind]++;
  return { count: mine.length, last: latest(mine), kinds, last_signal: latest(entry.theirs) };
}

export async function touchesFor(sb, businessId, records) {
  const many = Array.isArray(records);
  const index = touchIndex(await loadTouchRows(sb, businessId, many ? null : records));
  const one = r => summarize(index.get(keyOfRecord(r)) || null);
  return many ? records.map(one) : one(records);
}
