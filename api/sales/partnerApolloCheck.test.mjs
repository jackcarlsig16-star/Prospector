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
