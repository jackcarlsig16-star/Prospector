// node --test api/sales/partnerApolloCheck.test.mjs  (react-scripts' Jest only runs src/)
// partner-add-research-v1 Stage 3 - the single-partner Apollo people check
// against fixture Apollo (fetch stubbed for api.apollo.io only; the real
// apolloClient allowlist + counter run) and an in-memory Supabase: 0 real
// Apollo calls, 0 Claude.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { installApolloFixture, apolloFixtureCalls } from './testing/apolloFixture.mjs';
import { checkPartnerApollo, CHECK_MAX_CALLS, enrichText } from './partnerApolloCheck.js';

const B = randomUUID(), U = randomUUID();
const G = { two: randomUUID(), none: randomUUID(), empty: randomUUID(), big: randomUUID() };
const TODAY = '2026-10-19'; // a Monday
const person = (i, title) => ({ id: `c${i}`, first_name: `Person${i}`, last_name: 'Zz', title });
const restore = installApolloFixture({
  'acc-two': [person(1, 'VP Partnerships'), person(2, 'Benefits Director')],
  'acc-empty': [],
  'acc-big': Array.from({ length: 250 }, (_, i) => person(100 + i, 'Analyst')),
});
test.after(() => restore());

const seed = () => fakeSupabase({
  sales_goals: [
    { id: G.two, business_id: B, goal_type: 'partnership', name: 'Two People Co' },
    { id: G.none, business_id: B, goal_type: 'partnership', name: 'Nowhere Co' },
    { id: G.empty, business_id: B, goal_type: 'partnership', name: 'Empty Co' },
    { id: G.big, business_id: B, goal_type: 'partnership', name: 'Big Co' },
  ],
  partner_domains: [
    { id: randomUUID(), business_id: B, goal_id: G.two, domain: 'twopeople.example', confirmed: true },
    { id: randomUUID(), business_id: B, goal_id: G.none, domain: 'nowhere.example', confirmed: true },
    { id: randomUUID(), business_id: B, goal_id: G.empty, domain: 'empty.example', confirmed: true },
    { id: randomUUID(), business_id: B, goal_id: G.empty, domain: 'twopeople.example', confirmed: false },
    { id: randomUUID(), business_id: B, goal_id: G.big, domain: 'big.example', confirmed: true },
  ],
  sales_raw_snapshots: [{ business_id: B, entity: 'accounts', captured_at: '2026-10-19T06:00:00Z', payload: [
    { id: 'acc-two', name: 'Two People Co', domain: 'twopeople.example' },
    { id: 'acc-empty', name: 'Empty Co', domain: 'empty.example' },
    { id: 'acc-big', name: 'Big Co', domain: 'big.example' },
  ] }],
  partner_contacts: [], sales_week_goals: [], sales_week_report: [], sales_email_messages: [], sales_email_activity: [],
});
const check = (supabase, goalId) => checkPartnerApollo(supabase, { businessId: B, goalId, userId: U, today: TODAY });
const calls = () => apolloFixtureCalls.splice(0);

test('an account with 2 contacts -> 2 partner_contacts rows (source apollo, no email, no phone), 1 call, no to-do', async () => {
  const supabase = seed(); calls();
  const r = await check(supabase, G.two);
  assert.equal(r.status, 'found');
  assert.deepEqual(r.people, [{ name: 'Person1 Zz', title: 'VP Partnerships' }, { name: 'Person2 Zz', title: 'Benefits Director' }]);
  assert.equal(r.calls, 1);
  assert.deepEqual(calls(), ['POST /contacts/search']);
  const rows = supabase.db.partner_contacts;
  assert.equal(rows.length, 2);
  assert.ok(rows.every(c => c.goal_id === G.two && c.source === 'apollo' && c.email === null && !JSON.stringify(c).match(/phone/i)));
  assert.equal(supabase.db.sales_week_goals.length, 0);
});

test('checking again upserts the same 2 people (no duplicates)', async () => {
  const supabase = seed();
  await check(supabase, G.two);
  const r = await check(supabase, G.two);
  assert.equal(r.inserted, 0);
  assert.equal(r.updated, 2);
  assert.equal(supabase.db.partner_contacts.length, 2);
});

test('no Apollo account for the confirmed domain -> ONE enrich to-do, 0 calls', async () => {
  const supabase = seed(); calls();
  const r = await check(supabase, G.none);
  assert.equal(r.status, 'no_account');
  assert.equal(r.calls, 0);
  assert.deepEqual(calls(), []);
  assert.equal(r.todo_created, true);
  const [t] = supabase.db.sales_week_goals;
  assert.deepEqual([t.kind, t.status, t.text, t.owner_user_id, t.link_type, t.link_id, t.due_date, t.week_start, t.category],
    ['todo', 'open', 'Enrich Nowhere Co in Apollo: not in Apollo yet', U, 'partner', G.none, '2026-10-21', '2026-10-19', 'Apollo']);
});

test('an account with 0 contacts -> ONE enrich to-do "no people found"; a dismissed domain is ignored', async () => {
  const supabase = seed();
  const r = await check(supabase, G.empty);
  assert.equal(r.status, 'no_people');
  assert.equal(r.calls, 1);
  assert.equal(supabase.db.partner_contacts.length, 0, 'the confirmed=false twopeople.example row is not used');
  assert.equal(supabase.db.sales_week_goals.length, 1);
  assert.equal(supabase.db.sales_week_goals[0].text, enrichText('Empty Co', 'no_people'));
});

test('a second check never makes a second open enrich to-do; once it is done, a new one can be made', async () => {
  const supabase = seed();
  await check(supabase, G.none);
  const again = await check(supabase, G.none);
  assert.equal(again.todo_created, false);
  assert.equal(supabase.db.sales_week_goals.length, 1);
  supabase.db.sales_week_goals[0].status = 'done';
  const third = await check(supabase, G.none);
  assert.equal(third.todo_created, true);
  assert.equal(supabase.db.sales_week_goals.filter(t => t.status === 'open').length, 1);
});

test('the call counter never exceeds 2: 250 people stop at 2 pages (200 stored, truncated)', async () => {
  const supabase = seed(); calls();
  const r = await check(supabase, G.big);
  assert.equal(CHECK_MAX_CALLS, 2);
  assert.equal(r.calls, 2);
  assert.equal(calls().length, 2);
  assert.equal(r.truncated, true);
  assert.equal(supabase.db.partner_contacts.length, 200);
});

test('unknown partner -> 404, no call', async () => {
  const supabase = seed(); calls();
  await assert.rejects(check(supabase, randomUUID()), e => e.status === 404);
  assert.deepEqual(calls(), []);
});

// sales-ia-v2 Stage 3 (P4) - the same check for an employer (by Apollo id or
// name) and a target (by name): people come back as names + titles, nothing
// is stored, and the enrich to-do links to the record.
import { checkCompanyApollo, CHECK_TYPES } from './partnerApolloCheck.js';
const E = { linked: randomUUID(), byName: randomUUID(), none: randomUUID() }, T = { two: randomUUID(), none: randomUUID() };
const seed2 = () => {
  const sb = seed();
  sb.db.sales_opportunities = [
    { id: E.linked, business_id: B, organization: 'Renamed Co', apollo_account_id: 'acc-two', archived_at: null },
    { id: E.byName, business_id: B, organization: 'Big Co', apollo_account_id: null, archived_at: null },
    { id: E.none, business_id: B, organization: 'Nowhere Employer', apollo_account_id: null, archived_at: null },
  ];
  sb.db.sales_targets = [{ id: T.two, business_id: B, name: 'two people co' }, { id: T.none, business_id: B, name: 'Unknown Target' }];
  return sb;
};
const company = (sb, type, id) => checkCompanyApollo(sb, { businessId: B, type, id, userId: U, today: TODAY });

test('employer with an Apollo id -> its people (names + titles), nothing stored, 1 call; an employer matched by name reads that account; a target by name too', async () => {
  const sb = seed2(); calls();
  const r = await company(sb, 'employer', E.linked);
  assert.equal(r.status, 'found'); assert.deepEqual(r.people, [{ name: 'Person1 Zz', title: 'VP Partnerships' }, { name: 'Person2 Zz', title: 'Benefits Director' }]);
  assert.equal(r.calls, 1); assert.deepEqual(calls(), ['POST /contacts/search']);
  assert.equal(sb.db.partner_contacts.length, 0); assert.equal(sb.db.sales_week_goals.length, 0);
  assert.equal(JSON.stringify(r).includes('@'), false);
  const big = await company(sb, 'employer', E.byName);
  assert.equal(big.status, 'found'); assert.equal(big.account.name, 'Big Co'); assert.equal(big.calls, 2); assert.equal(big.truncated, true);
  const t = await company(sb, 'target', T.two);
  assert.equal(t.status, 'found'); assert.equal(t.people.length, 2);
});

test('no account for an employer / target -> ONE enrich to-do linked to the opportunity / target; a partner goes through the partner check; bad type 400, unknown 404', async () => {
  const sb = seed2(); calls();
  const e = await company(sb, 'employer', E.none);
  assert.equal(e.status, 'no_account'); assert.equal(e.todo_created, true); assert.deepEqual(calls(), []);
  const t = await company(sb, 'target', T.none);
  assert.equal(t.status, 'no_account'); assert.equal(t.todo_created, true);
  assert.deepEqual(sb.db.sales_week_goals.map(x => [x.link_type, x.link_id, x.text]), [['opportunity', E.none, enrichText('Nowhere Employer', 'no_account')], ['target', T.none, enrichText('Unknown Target', 'no_account')]]);
  assert.equal((await company(sb, 'employer', E.none)).todo_created, false);
  const p = await company(sb, 'partner', G.two);
  assert.equal(p.status, 'found'); assert.equal(sb.db.partner_contacts.length, 2, 'partners still store their people');
  await assert.rejects(company(sb, 'visitor', 'x'), e => e.status === 400);
  await assert.rejects(company(sb, 'employer', randomUUID()), e => e.status === 404);
  assert.deepEqual(CHECK_TYPES, ['partner', 'employer', 'target']);
});
