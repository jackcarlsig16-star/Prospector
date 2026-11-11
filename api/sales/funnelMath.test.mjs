// node --test api/sales/funnelMath.test.mjs
// email-funnel-v1 Stage 1: the one funnel function over a fixture - R1 the delivered table is the denominator (the
// engaged-only messages table never is), R2 the two rates with the record / name join, R3 cohort opens / clicks /
// replies (bot opens and scanner clicks out, excluded reply classes out), R4 a 3-day visit window attributes to its
// last day with window_days, the day rows' sides_present, the route (windows, custom window, ready gate, 400s) and
// the day writer (idempotent). Invented people and companies; ids only, no addresses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { funnelContext, funnelWindow, funnelDay, windowRange, trend30, STEPS, WINDOW_KEYS, FUNNEL_SINCE, VISITS_SINCE } from './funnelMath.js';
import { loadFunnel, writeFunnelDays } from './funnelRoutes.js';
import { deliveredRows, writeDelivered } from './emailCounts.js';

const B = '00000000-0000-4000-8000-0000000000b1';
const NOW = Date.parse('2026-11-10T16:00:00Z'); // Tue Nov 10, 08:00 PST
const TODAY = '2026-11-10';
const d = (id, contact, day, at, account = null) => ({ business_id: B, apollo_message_id: id, contact_id: contact, account_id: account, mailbox: 'box@example.test', delivered_at: at, delivered_day: day, sequence_id: 's1', step: 1 });
const DELIVERED = [
  d('m1', 'c1', '2026-11-09', '2026-11-09T15:00:00Z'),            // prospect c1 -> opportunity o1 "Acme"
  d('m2', 'c2', '2026-11-09', '2026-11-09T15:10:00Z'),            // prospect c2, company text "Beta Co" - no record
  d('m3', 'c3', '2026-11-09', '2026-11-09T15:20:00Z', 'a3'),      // no prospect row; account a3 -> sequenced "Gamma"
  d('m4', 'c4', '2026-11-06', '2026-11-06T15:00:00Z', 'a4'),      // account a4 -> opportunity o4 by apollo_account_id "Delta"
  d('m5', 'c5', '2026-11-06', '2026-11-06T15:30:00Z'),            // nothing to join: unresolved
  d('m6', 'c1', '2026-11-04', '2026-11-04T15:00:00Z'),            // c1 again (one person twice in the week)
  d('m7', 'c7', '2026-10-28', '2026-10-28T15:00:00Z', 'a7'),      // account a7 -> sequenced "Eta"
];
const MESSAGES = [
  { business_id: B, apollo_message_id: 'm1', delivered_at: '2026-11-09T15:00:00Z', replied: true, reply_class: 'follow_up_question', replied_at: '2026-11-09T20:00:00Z', replied_seen_at: null },
  { business_id: B, apollo_message_id: 'm2', delivered_at: '2026-11-09T15:10:00Z', replied: true, reply_class: 'not_interested', replied_at: null, replied_seen_at: '2026-11-10T14:00:00Z' },
  { business_id: B, apollo_message_id: 'm6', delivered_at: '2026-11-04T15:00:00Z', replied: true, reply_class: null, replied_at: '2026-11-05T10:00:00Z', replied_seen_at: null },
  // An engaged message the delivered table does not hold (an older week never backfilled): never a denominator.
  { business_id: B, apollo_message_id: 'old', delivered_at: '2026-10-01T15:00:00Z', replied: true, reply_class: 'willing_to_meet', replied_at: '2026-10-02T10:00:00Z', replied_seen_at: null },
];
const ev = (id, msg, event, at, extra = {}) => ({ id, business_id: B, apollo_message_id: msg, event, occurred_at: at, user_agent: null, tracking_service: null, ...extra });
const EVENTS = [
  ev('e1', 'm1', 'open', '2026-11-09T15:00:30Z'),                               // 30 s after delivery: a bot open
  ev('e2', 'm1', 'open', '2026-11-09T17:00:00Z'),                               // a person
  ev('e3', 'm1', 'click', '2026-11-09T15:01:00Z'),                              // 60 s: a scanner click
  ev('e4', 'm4', 'click', '2026-11-07T15:00:00Z'),                              // a day later: a person
  ev('e5', 'm3', 'open', '2026-11-09T18:00:00Z', { tracking_service: 'proofpoint' }), // a tracking service: bot
  ev('e6', 'm7', 'open', '2026-10-29T12:00:00Z'),
  ev('e7', 'old', 'open', '2026-10-01T18:00:00Z'),
];
const PROSPECTS = [
  { business_id: B, contact_id: 'c1', name: 'Pat Lee', company: 'Acme', opportunity_id: 'o1', goal_id: null },
  { business_id: B, contact_id: 'c2', name: 'Sam Roe', company: 'Beta Co', opportunity_id: null, goal_id: null },
];
const OPPS = [{ id: 'o1', business_id: B, organization: 'Acme', apollo_account_id: null }, { id: 'o4', business_id: B, organization: 'Delta', apollo_account_id: 'a4' }];
const SEQUENCED = [{ business_id: B, account_id: 'a3', name: 'Gamma' }, { business_id: B, account_id: 'a7', name: 'Eta' }];
const PEOPLE = [
  { id: 'p1', business_id: B, name: 'Pat Lee', company_name: 'Acme', opportunity_id: null, target_id: null, apollo_person_id: null, created_at: '2026-11-09T19:00:00Z', source_kind: 'web_visit', archived_at: null }, // merges with c1 by name + company
  { id: 'p2', business_id: B, name: 'Gale Finch', company_name: 'Gamma', opportunity_id: null, target_id: null, apollo_person_id: 'c3', created_at: '2026-11-08T19:00:00Z', source_kind: 'web_visit', archived_at: null }, // merges with c3 by Apollo id
  { id: 'p3', business_id: B, name: 'Nobody Known', company_name: 'Zeta', opportunity_id: null, target_id: null, apollo_person_id: null, created_at: '2026-11-09T19:00:00Z', source_kind: 'web_visit', archived_at: null },
];
const v = (id, key, from, to, pulled, match = null) => ({ id, business_id: B, company_key: key, pulled_on: pulled, seen_from: from, seen_to: to, matched_type: match ? match.split(':')[0] : null, matched_id: match ? match.split(':')[1] : null, visits_7d: 1 });
const VISITS = [
  v('v1', 'acme', '2026-11-09', '2026-11-10', '2026-11-10', 'opportunity:o1'),  // Mon Nov 9
  v('v2', 'gamma', '2026-11-06', '2026-11-09', '2026-11-09'),                   // Fri-Sun -> attributed Sun Nov 8, window_days 3
  v('v3', 'delta', '2026-11-04', '2026-11-05', '2026-11-05'),                   // Wed Nov 4
  v('v4', 'eta', '2026-10-13', '2026-10-27', '2026-10-27'),                     // the backfill: hidden
  v('v5', 'eta', '2026-10-28', '2026-10-29', '2026-10-29'),                     // Wed Oct 28
];
const RUNS = [{ id: 'run-bf', business_id: B, la_date: '2026-10-27', kind: 'backfill', status: 'ok', window_start: '2026-10-13', window_end: '2026-10-27' }];
const CAL = [
  { id: 'ce1', business_id: B, graph_id: 'g1', ical_uid: 'i1', external_domains: ['other.test'], start_at: '2026-11-12T17:00:00Z', is_cancelled: false, created_at_graph: '2026-11-09T18:00:00Z' },
  { id: 'ce2', business_id: B, graph_id: 'g2', ical_uid: 'i1', external_domains: ['other.test'], start_at: '2026-11-12T17:00:00Z', is_cancelled: false, created_at_graph: '2026-11-09T18:00:00Z' }, // the same meeting on the other calendar
  { id: 'ce3', business_id: B, graph_id: 'g3', ical_uid: 'i3', external_domains: ['other.test'], start_at: '2026-11-11T17:00:00Z', is_cancelled: true, created_at_graph: '2026-11-09T18:00:00Z' },
  { id: 'ce4', business_id: B, graph_id: 'g4', ical_uid: 'i4', external_domains: ['other.test'], start_at: '2026-11-05T17:00:00Z', is_cancelled: false, created_at_graph: '2026-11-03T18:00:00Z' },
  { id: 'ce5', business_id: B, graph_id: 'g5', ical_uid: 'i5', external_domains: [], start_at: '2026-11-09T17:00:00Z', is_cancelled: false, created_at_graph: '2026-11-09T18:00:00Z' }, // internal
];
const ROWS = { delivered: DELIVERED, messages: MESSAGES, events: EVENTS, prospects: PROSPECTS, partnerContacts: [], opportunities: OPPS, targets: [], partners: [], sequenced: SEQUENCED, people: PEOPLE, visits: VISITS, runs: RUNS, calEvents: CAL };
const pick = (w, keys) => Object.fromEntries(keys.map(k => [k, w[k]]));

test('windowRange: yesterday / 7 d / 30 d / this week / last week / since Oct 26, on LA days', () => {
  assert.deepEqual(windowRange('yesterday', TODAY), { from: '2026-11-09', to: '2026-11-09' });
  assert.deepEqual(windowRange('7d', TODAY), { from: '2026-11-04', to: '2026-11-10' });
  assert.deepEqual(windowRange('30d', TODAY), { from: '2026-10-12', to: '2026-11-10' });
  assert.deepEqual(windowRange('this_week', TODAY), { from: '2026-11-09', to: '2026-11-10' });
  assert.deepEqual(windowRange('last_week', TODAY), { from: '2026-11-02', to: '2026-11-08' });
  assert.deepEqual(windowRange('since', TODAY), { from: FUNNEL_SINCE, to: TODAY });
  assert.equal(windowRange('nope', TODAY), null);
  assert.deepEqual(WINDOW_KEYS, ['yesterday', '7d', '30d', 'this_week', 'last_week', 'since']);
});

test('yesterday: the denominator is the delivered table (3 rows; the engaged-only "old" message never counts); companies by record / name; a bot open and a scanner click out; the not-interested reply out; the same-day visit and the name-merged identified person in; one external meeting (its twin on the other calendar once, the cancelled one never)', () => {
  const w = funnelWindow(funnelContext(ROWS), '2026-11-09', '2026-11-09');
  assert.deepEqual(pick(w, STEPS), { delivered: 3, human_opens: 1, human_clicks: 0, companies_visited: 1, people_identified: 1, replies: 1, meetings: 1 });
  assert.deepEqual(pick(w, ['people_emailed', 'companies_emailed', 'companies_no_record', 'companies_unresolved']), { people_emailed: 3, companies_emailed: 3, companies_no_record: 2, companies_unresolved: 0 });
  assert.deepEqual(w.company_rate, { n: 1, d: 3, rate: 1 / 3 });
  assert.deepEqual(w.person_rate, { n: 1, d: 3, rate: 1 / 3 });
  assert.deepEqual(w.companies_visited_names, ['Acme']);
  assert.deepEqual(w.replies_by_class, { follow_up_question: 1, not_interested: 1 });
  assert.equal(w.replies_excluded, 1);
  assert.equal(w.shares.human_opens, 1 / 3);
  for (const s of STEPS) assert.ok(w[s] <= w.delivered, `${s} <= delivered`);
});

test('last 7 d: one person twice is one person; the unresolved message counts in delivered and nowhere else; a Fri-Sun window attributes to Sunday (in the 7-day window, not in "yesterday"); a visit two days BEFORE the email still counts (same window, no order); the Apollo-id merge; the replies cohort = messages delivered in the window', () => {
  const w = funnelWindow(funnelContext(ROWS), '2026-11-04', '2026-11-10');
  assert.deepEqual(pick(w, STEPS), { delivered: 6, human_opens: 1, human_clicks: 1, companies_visited: 3, people_identified: 2, replies: 2, meetings: 1 });
  assert.deepEqual(pick(w, ['people_emailed', 'companies_emailed', 'companies_no_record', 'companies_unresolved']), { people_emailed: 5, companies_emailed: 4, companies_no_record: 2, companies_unresolved: 1 });
  assert.deepEqual(w.companies_visited_names, ['Acme', 'Delta', 'Gamma']);
  assert.deepEqual(w.company_rate, { n: 3, d: 4, rate: 0.75 });
  assert.deepEqual(w.person_rate, { n: 2, d: 5, rate: 0.4 });
});

test('last 30 d: the Oct 28 message, its human open and its live Oct 28 visit count; the hidden backfill row (Oct 13-27) never makes a visit day; the Nov 3 meeting joins', () => {
  const w = funnelWindow(funnelContext(ROWS), '2026-10-12', '2026-11-10');
  assert.deepEqual(pick(w, STEPS), { delivered: 7, human_opens: 2, human_clicks: 1, companies_visited: 4, people_identified: 2, replies: 2, meetings: 2 });
  const before = funnelWindow(funnelContext(ROWS), '2026-10-12', '2026-10-27');
  assert.deepEqual(pick(before, ['delivered', 'companies_visited']), { delivered: 0, companies_visited: 0 });
  const empty = funnelWindow(funnelContext(ROWS), '2026-09-01', '2026-09-30');
  assert.equal(empty.company_rate.rate, null);
  assert.equal(empty.shares.human_opens, null);
});

test('day rows (F3 / R4): Sun Nov 8 is visits-only with window_days 3 (the Fri-Sun pull), Mon Nov 9 both, Sat Nov 7 none, Wed Nov 4 both (its email + the Delta visit), Fri Nov 6 email-only; every step <= delivered', () => {
  const ctx = funnelContext(ROWS);
  const row = day => funnelDay(ctx, day);
  assert.deepEqual(pick(row('2026-11-08'), ['delivered', 'sides_present', 'window_days', 'companies_visited']), { delivered: 0, sides_present: 'visits', window_days: 3, companies_visited: 0 });
  assert.deepEqual(pick(row('2026-11-09'), ['delivered', 'sides_present', 'window_days', 'companies_visited', 'people_identified', 'replies']), { delivered: 3, sides_present: 'both', window_days: 1, companies_visited: 1, people_identified: 1, replies: 1 });
  assert.equal(row('2026-11-07').sides_present, 'none');
  assert.deepEqual(pick(row('2026-11-04'), ['delivered', 'sides_present', 'companies_visited']), { delivered: 1, sides_present: 'both', companies_visited: 0 });
  assert.deepEqual(pick(row('2026-11-06'), ['delivered', 'sides_present']), { delivered: 2, sides_present: 'email' });
  for (const day of ['2026-11-04', '2026-11-06', '2026-11-09']) for (const s of STEPS) assert.ok(row(day)[s] <= row(day).delivered);
  assert.equal(trend30([], TODAY), null, 'no arrow until 60 email-side days');
  const sixty = []; for (let i = 0; i < 60; i++) { const dd = new Date(Date.parse(`${TODAY}T00:00:00Z`) - i * 864e5).toISOString().slice(0, 10); sixty.push({ day: dd, sides_present: 'email', companies_emailed: 10, companies_visited: i < 30 ? 2 : 1 }); }
  assert.deepEqual(trend30(sixty, TODAY), { now: 0.2, prior: 0.1, arrow: '▲' });
});

const seed = (extra = {}) => fakeSupabase({ sales_email_delivered: DELIVERED, sales_email_messages: MESSAGES, sales_email_activity: EVENTS, sales_prospect_state: PROSPECTS, sales_opportunities: OPPS, sales_sequenced_accounts: SEQUENCED, sales_people: PEOPLE, web_visits: VISITS, visit_pull_runs: RUNS, microsoft_events: CAL, sales_funnel_days: [], ...extra });

test('the route: windows by key + a custom send window, the series, since / visits_since, ready = false until delivered reaches Oct 26 (then true), 400 on an unknown key or a bad custom window; another workspace sees nothing', async () => {
  const db = seed();
  const r = await loadFunnel(db, B, { windows: ['yesterday', '7d', '30d', 'this_week', 'last_week'], custom: { from: '2026-11-06', to: '2026-11-08' }, now: NOW });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body.windows), ['yesterday', '7d', '30d', 'this_week', 'last_week', 'window']);
  assert.deepEqual(pick(r.body.windows.yesterday, STEPS), { delivered: 3, human_opens: 1, human_clicks: 0, companies_visited: 1, people_identified: 1, replies: 1, meetings: 1 });
  assert.deepEqual(pick(r.body.windows.window, ['from', 'to', 'delivered', 'companies_visited']), { from: '2026-11-06', to: '2026-11-08', delivered: 2, companies_visited: 0 });
  assert.deepEqual(pick(r.body, ['today', 'since', 'visits_since', 'delivered_since', 'ready']), { today: TODAY, since: FUNNEL_SINCE, visits_since: VISITS_SINCE, delivered_since: '2026-10-28', ready: false });
  assert.deepEqual(r.body.series, []);
  assert.equal(r.body.trend_30d, null);
  assert.ok(r.body.wording.company.startsWith('Company rate:') && r.body.wording.person.startsWith('Person rate:') && r.body.wording.cohort === 'of emails sent that day/week, so far');
  assert.equal((await loadFunnel(db, B, { windows: ['fortnight'], now: NOW })).status, 400);
  assert.equal((await loadFunnel(db, B, { custom: false, now: NOW })).status, 400);
  const ready = await loadFunnel(seed({ sales_email_delivered: [...DELIVERED, d('m0', 'c9', '2026-10-26', '2026-10-26T15:00:00Z')] }), B, { now: NOW });
  assert.deepEqual(pick(ready.body, ['delivered_since', 'ready']), { delivered_since: '2026-10-26', ready: true });
  const other = await loadFunnel(db, '00000000-0000-4000-8000-0000000000b2', { now: NOW });
  assert.deepEqual(pick(other.body.windows['7d'], ['delivered', 'companies_emailed']), { delivered: 0, companies_emailed: 0 });
  assert.ok(!JSON.stringify(r.body).includes('@'));
});

test('writeFunnelDays: one row per LA day from Oct 20 through today (22), sides counted, idempotent, the route then serves the series', async () => {
  const db = seed();
  const w = await writeFunnelDays(db, B, { now: NOW });
  assert.deepEqual(pick(w, ['rows', 'from', 'to']), { rows: 22, from: VISITS_SINCE, to: TODAY });
  assert.deepEqual(w.sides, { none: 17, both: 3, email: 1, visits: 1 });
  const again = await writeFunnelDays(db, B, { now: NOW });
  assert.equal(again.rows, 22);
  assert.equal(db.db.sales_funnel_days.length, 22);
  const r = await loadFunnel(db, B, { now: NOW, days: 30 });
  assert.equal(r.body.series.length, 22);
  assert.deepEqual(pick(r.body.series.find(x => x.day === '2026-11-08'), ['sides_present', 'window_days']), { sides_present: 'visits', window_days: 3 });
});

test('deliveredRows + writeDelivered: one row per delivered message with the LA day, the lowercase sending mailbox, the step; rows without a contact or a completion time are skipped; a re-run upserts, never doubles', async () => {
  const msgs = [
    { id: 'x1', contact_id: 'c1', account_id: 'a1', from_email: 'Box@Example.test', completed_at: '2026-11-09T07:30:00Z', emailer_campaign_id: 'seq1', campaign_position: 2 },
    { id: 'x1', contact_id: 'c1', account_id: 'a1', from_email: 'Box@Example.test', completed_at: '2026-11-09T07:30:00Z', emailer_campaign_id: 'seq1', campaign_position: 2 },
    { id: 'x2', contact_id: 'c2', completed_at: '2026-11-10T03:30:00Z' }, // 03:30 Z = Nov 9 LA
    { id: 'x3', contact_id: null, completed_at: '2026-11-09T07:30:00Z' },
    { id: 'x4', contact_id: 'c4', completed_at: null },
  ];
  const rows = deliveredRows(msgs);
  assert.deepEqual(rows, [
    { apollo_message_id: 'x1', contact_id: 'c1', account_id: 'a1', mailbox: 'box@example.test', delivered_at: '2026-11-09T07:30:00Z', delivered_day: '2026-11-08', sequence_id: 'seq1', step: 2 },
    { apollo_message_id: 'x2', contact_id: 'c2', account_id: null, mailbox: 'unknown', delivered_at: '2026-11-10T03:30:00Z', delivered_day: '2026-11-09', sequence_id: '', step: 0 },
  ]);
  const db = fakeSupabase({ sales_email_delivered: [] });
  assert.equal(await writeDelivered({ supabase: db, businessId: B, rows }), 2);
  assert.equal(await writeDelivered({ supabase: db, businessId: B, rows }), 2);
  assert.equal(db.db.sales_email_delivered.length, 2);
  assert.ok(db.db.sales_email_delivered.every(r => r.business_id === B));
});
