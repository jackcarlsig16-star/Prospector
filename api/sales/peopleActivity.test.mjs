// node --test api/sales/peopleActivity.test.mjs
// people-v2 Stage 1 - the merge rule (P2) and GET goals/people/activity over an invented workspace: one row per person,
// the summary joined by key / Apollo id, company visits by matched record or by name, buyer titles, the identified
// date, the window, the chip counts, the sort, no address in the output, 503 until the migration ran.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { mergePeople, nameKey } from './peopleMerge.js';
import { peopleRows, buildPeopleTable, windowOf, peopleActivity, isBuyerTitle } from './peopleActivityRoutes.js';

const B = '00000000-0000-4000-8000-0000000000b1';
const NOW = Date.parse('2026-11-06T18:00:00Z'); // Fri Nov 6, 10:00 PST
const O = '00000000-0000-4000-8000-00000000e001', T = '00000000-0000-4000-8000-00000000e002', G = '00000000-0000-4000-8000-00000000e003';
const prospects = [
  { business_id: B, contact_id: 'cA', name: 'Ana Buyer', title: 'VP People', company: 'Acme Health', opportunity_id: O, goal_id: null, status: 'new', owner: 'jack', email: 'hidden@acme.example' },
  { business_id: B, contact_id: 'cB', name: 'Bo Ops', title: 'Ops Lead', company: 'Quarry Labs', opportunity_id: null, goal_id: null, status: 'new', owner: null, email: null },
  { business_id: B, contact_id: 'cD', name: 'Dee Same', title: null, company: 'Harbor Lane', opportunity_id: null, goal_id: G, status: 'contacted', owner: null, email: null },
];
const salesPeople = [
  { id: 'sp1', business_id: B, company_type: 'target', target_id: T, opportunity_id: null, name: 'Bo Ops', title: 'Head of Ops', source_kind: 'web_visit', visit_id: null, upload_id: null, archived_at: null, created_at: '2026-11-02T15:00:00Z', company_name: null },
  { id: 'sp2', business_id: B, company_type: 'employer', target_id: null, opportunity_id: O, name: 'Eve Hand', title: 'Benefits Manager', source_kind: null, visit_id: null, upload_id: null, archived_at: null, created_at: '2026-10-20T15:00:00Z', company_name: null },
  { id: 'sp3', business_id: B, company_type: 'target', target_id: T, opportunity_id: null, name: 'Gone Person', title: null, source_kind: 'web_visit', visit_id: null, upload_id: null, archived_at: '2026-11-01T00:00:00Z', created_at: '2026-10-30T15:00:00Z', company_name: null },
  { id: 'sp4', business_id: B, company_type: 'target', target_id: T, opportunity_id: null, name: 'Bo Ops', title: null, source_kind: null, visit_id: null, upload_id: 'up1', archived_at: null, created_at: '2026-10-25T15:00:00Z', company_name: null },
];
const partnerContacts = [
  { id: 'pc1', business_id: B, goal_id: G, name: 'Dee Same', title: 'Partner Lead', email: 'dee@harbor.example', apollo_contact_id: 'cD', last_activity_at: '2026-11-04T10:00:00Z' },
  { id: 'pc2', business_id: B, goal_id: G, name: 'Bo Ops', title: null, email: null, apollo_contact_id: null, last_activity_at: null },
];
const opportunities = [{ id: O, business_id: B, organization: 'Acme Health', stage: 'contacted', owner_user_id: 'u1', archived_at: null, employees: 5000, employees_source: 'apollo' }];
const targets = [{ id: T, business_id: B, name: 'Quarry Labs', status: 'researching', owner_user_id: null, employees: null, employees_source: null }];
const partners = [{ id: G, business_id: B, name: 'Harbor Lane', pipeline_status: 'replied', owner_user_id: 'u2', goal_type: 'partnership' }];
const activity = [
  { business_id: B, person_key: 'prospect:cA', contact_id: 'cA', sent: 3, opened_h: 2, bot_opens: 1, clicked: 1, replied: 1, last_sent_at: '2026-11-03T12:00:00Z', last_open_at: '2026-11-04T12:00:00Z', last_click_at: '2026-11-04T13:00:00Z', last_reply_at: '2026-11-05T09:00:00Z', reply_class: 'follow_up_question', heat: 150, heat_band: 'hot', computed_at: '2026-11-06T13:00:00Z' },
  { business_id: B, person_key: 'prospect:cB', contact_id: 'cB', sent: 1, opened_h: 0, bot_opens: 2, clicked: 0, replied: 0, last_sent_at: '2026-09-20T12:00:00Z', last_open_at: null, last_click_at: null, last_reply_at: null, reply_class: null, heat: 0, heat_band: 'cold', computed_at: '2026-11-06T13:00:00Z' },
  { business_id: B, person_key: 'prospect:cD', contact_id: 'cD', sent: 2, opened_h: 1, bot_opens: 0, clicked: 0, replied: 0, last_sent_at: '2026-11-01T12:00:00Z', last_open_at: '2026-11-02T12:00:00Z', last_click_at: null, last_reply_at: null, reply_class: null, heat: null, heat_band: null, computed_at: '2026-11-06T13:00:00Z' },
];
const visits = [
  { id: 'v1', business_id: B, company_key: 'acme health', company_name: 'Acme Health', matched_type: 'opportunity', matched_id: O, visits_7d: 6, last_visit: '2026-11-05', seen_to: '2026-11-06', top_paths: [{ path: '/pricing' }], pulled_on: '2026-11-06' },
  { id: 'v0', business_id: B, company_key: 'acme health', company_name: 'Acme Health', matched_type: 'opportunity', matched_id: O, visits_7d: 2, last_visit: '2026-10-20', seen_to: '2026-10-21', top_paths: [], pulled_on: '2026-10-21' },
  { id: 'v2', business_id: B, company_key: 'quarry labs', company_name: 'Quarry Labs', matched_type: null, matched_id: null, visits_7d: 1, last_visit: '2026-10-22', seen_to: '2026-10-23', top_paths: ['/'], pulled_on: '2026-10-23' },
];
const settings = [{ business_id: B, buyer_titles: ['vp people', 'benefits'] }];

test('mergePeople: the same Apollo contact id is one person (sources listed, the richer title kept, has_email if any); the same name at the same company is one person; the same name at another company stays apart', () => {
  const rows = peopleRows({ prospects, salesPeople, partnerContacts, opportunities, targets, partners });
  assert.equal(rows.length, 3 + 3 + 2, 'the archived person is out');
  const merged = mergePeople(rows);
  const by = Object.fromEntries(merged.map(m => [`${m.name}@${m.company?.name}`, m]));
  assert.deepEqual(by['Dee Same@Harbor Lane'].sources, ['prospect', 'contact']);
  assert.deepEqual([by['Dee Same@Harbor Lane'].title, by['Dee Same@Harbor Lane'].has_email, by['Dee Same@Harbor Lane'].last_touch_at], ['Partner Lead', true, '2026-11-04T10:00:00Z']);
  assert.deepEqual(by['Bo Ops@Quarry Labs'].sources, ['prospect', 'visitor', 'upload'], 'the prospect (a bare company name) + the visitor + the upload at Quarry Labs are one person');
  assert.deepEqual([by['Bo Ops@Quarry Labs'].company.type, by['Bo Ops@Quarry Labs'].company.id, by['Bo Ops@Quarry Labs'].identified_at], ['target', T, '2026-11-02T15:00:00Z'], 'the linked company and the identified date come from the visitor row');
  assert.deepEqual(by['Bo Ops@Harbor Lane'].sources, ['contact'], 'the same name at another company is another person');
  assert.equal(merged.length, 5);
  assert.equal(nameKey('Bo Ops', 'Quarry Labs'), nameKey(' bo  ops ', 'QUARRY LABS'));
  assert.equal(nameKey('Bo Ops', ''), null);
});

test('buildPeopleTable: counts from the summary (by key, or by Apollo id for a merged contact), visits by matched record or by name (the latest pull), buyer, identified, last email + last touch, heat pending, chip counts, the sort, no address', () => {
  const rows = peopleRows({ prospects, salesPeople, partnerContacts, opportunities, targets, partners });
  const t = buildPeopleTable({ rows, activity, visits, buyerTitles: settings[0].buyer_titles, window: windowOf('all', '2026-11-06'), now: NOW });
  assert.deepEqual([t.n, t.total, t.heat_rule, t.heat_pending, t.computed_at], [5, 5, { hot: 40, warm: 10, fade: { fresh: 7, mid: 0.5, old: 30, floor: 0.25 } }, 1, '2026-11-06T13:00:00Z']);
  assert.deepEqual(t.rows.map(r => r.name), ['Ana Buyer', 'Bo Ops', 'Dee Same', 'Bo Ops', 'Eve Hand'], 'heat desc, then last email, then name');
  const ana = t.rows[0];
  assert.deepEqual([ana.emails, ana.last_email, ana.heat, ana.heat_band, ana.visits, ana.buyer, ana.has_email, ana.identified_at, ana.last_touch_at, ana.sources, ana.source],
    [{ sent: 3, opened: 2, clicked: 1, replied: 1, bot_opens: 1 }, { at: '2026-11-05T09:00:00Z', what: 'replied', reply_class: 'follow_up_question' }, 150, 'hot', { visits_7d: 6, last_visit: '2026-11-05', top_page: '/pricing', seen_to: '2026-11-06' }, true, true, null, '2026-11-05T09:00:00Z', ['Apollo'], 'Apollo']);
  assert.deepEqual([ana.company.name, ana.company.stage, ana.company.owner_user_id, ana.company.employees, ana.company.employees_source], ['Acme Health', 'contacted', 'u1', 5000, 'apollo'], 'heat-size-v1 R6: the company carries its headcount + source');
  const bo = t.rows.find(r => r.name === 'Bo Ops' && r.company.name === 'Quarry Labs');
  assert.deepEqual([bo.emails.sent, bo.emails.bot_opens, bo.heat_band, bo.visits.visits_7d, bo.visits.top_page, bo.identified_at, bo.buyer, bo.last_email.what], [1, 2, 'cold', 1, '/', '2026-11-02', false, 'sent'], 'visits by company name when no record is matched');
  assert.deepEqual([bo.company.employees, bo.company.employees_source], [null, null], 'an unknown headcount is null, never blank or 0');
  const parked = t.rows.find(r => r.company?.type === 'account' || r.company?.type === 'parked');
  if (parked) assert.deepEqual([parked.company.employees, parked.company.employees_source], [null, null]);
  const dee = t.rows.find(r => r.name === 'Dee Same');
  assert.deepEqual([dee.emails.sent, dee.heat, dee.heat_band, dee.last_email.what, dee.last_touch_at, dee.has_email], [2, null, null, 'opened', '2026-11-04T10:00:00Z', true], 'heat pending reads null; the partner touch is the last touch');
  const eve = t.rows.find(r => r.name === 'Eve Hand');
  assert.deepEqual([eve.source, eve.emails.sent, eve.heat, eve.buyer, eve.visits.visits_7d], ['Typed', 0, null, true, 6]);
  assert.deepEqual(t.counts, { opened: 2, clicked: 1, replied: 1, sent: 3, identified: 1, visited_7d: 2, buyer: 2, hot: 1, needs_touch: 3 }, 'visited 7 d = the two at Acme (Quarry was seen Oct 23); needs a touch = Bo (Sep 20), Bo @ Harbor and Eve (never)');
  assert.ok(!/@|hidden|harbor\.example/.test(JSON.stringify(t)), 'no address, no email host');
});

test('the window keeps the rows with a signal, an identified date or a company visit inside it; 7 d from Nov 6 = Oct 31', () => {
  const rows = peopleRows({ prospects, salesPeople, partnerContacts, opportunities, targets, partners });
  const w7 = buildPeopleTable({ rows, activity, visits, buyerTitles: [], window: windowOf('7', '2026-11-06'), now: NOW });
  assert.deepEqual(windowOf('7', '2026-11-06'), { id: '7', label: 'last 7 days', since: '2026-10-31', until: '2026-11-06' });
  assert.deepEqual(w7.rows.map(r => `${r.name}@${r.company?.name}`).sort(), ['Ana Buyer@Acme Health', 'Bo Ops@Quarry Labs', 'Dee Same@Harbor Lane', 'Eve Hand@Acme Health'], 'Bo Ops @ Harbor Lane (no signal, no visit) is out; Eve is in through Acme\'s visit this week');
  assert.deepEqual([w7.n, w7.total], [4, 5]);
  const w30 = buildPeopleTable({ rows, activity, visits, buyerTitles: [], window: windowOf('30', '2026-11-06'), now: NOW });
  assert.equal(w30.n, 4);
  assert.equal(windowOf('junk', '2026-11-06').id, 'all');
  assert.ok(isBuyerTitle('VP People & Culture', ['vp people']) && !isBuyerTitle(null, ['vp people']) && !isBuyerTitle('Engineer', ['vp people']));
});

test('peopleActivity (route): 200 with the table from the fake workspace; 503 migration_pending when the summary table is missing', async () => {
  const seed = { sales_prospect_state: prospects, sales_people: salesPeople, partner_contacts: partnerContacts, sales_opportunities: opportunities, sales_targets: targets, sales_goals: partners, web_visits: visits, sales_settings: settings, sales_person_activity: activity };
  const r = await peopleActivity(fakeSupabase(seed), B, { window: '30', now: NOW });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.n, r.body.total, r.body.window.id, r.body.rows[0].name, r.body.counts.hot, r.body.history_since], [4, 5, '30', 'Ana Buyer', 1, null], 'history_since is null until a day row exists');
  assert.ok(!/@/.test(JSON.stringify(r.body)));
  const db = fakeSupabase(seed);
  const base = db.from.bind(db);
  db.from = t => (t === 'sales_person_activity' ? { select: () => ({ eq: () => ({ order: () => ({ range: async () => ({ data: null, error: { code: '42P01', message: 'relation "public.sales_person_activity" does not exist' } }) }) }) }) } : base(t));
  const p = await peopleActivity(db, B, { window: 'all', now: NOW });
  assert.deepEqual([p.status, p.body.migration_pending], [503, true]);
  assert.match(p.body.error, /20261106_people_v2_stage1\.sql/);
});
