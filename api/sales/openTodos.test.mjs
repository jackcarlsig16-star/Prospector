// node --test api/sales/openTodos.test.mjs  (react-scripts' Jest only runs src/)
// FIX actions-all-weeks-v1 - the one "open to-do" read: any week_start, owner narrowing, flags / done / dropped /
// all-steps-ticked out, due-date groups, the 500 cap, and the parity Needs attention <-> Actions <-> Dashboard get from it.
// In-memory Supabase; 0 network, 0 Claude, 0 Apollo. Made-up names; no addresses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { openTodosFor, todoGroup, todoCounts, weekEndOf, TODO_CAP } from './openTodos.js';
import { listActions } from './actionsRoutes.js';
import { attention } from './attentionRoutes.js';
import { loadDashboard } from './dashboardRoutes.js';

const B = randomUUID(), JACK = randomUUID(), CY = randomUUID();
const TODAY = '2026-11-05'; // a Thursday; this week = Nov 2 .. Nov 8
const NOW = new Date(`${TODAY}T19:00:00Z`);
const todo = (id, extra) => ({ id, business_id: B, kind: 'todo', status: 'open', owner_user_id: JACK, week_start: '2026-11-02', due_date: null, created_at: '2026-11-01T10:00:00Z', ...extra });
const rows = [
  todo('this-week-due', { due_date: '2026-11-06' }),
  todo('old-week-overdue', { week_start: '2026-09-28', due_date: '2026-10-01', created_at: '2026-09-28T10:00:00Z' }),
  todo('old-week-nodate', { week_start: '2026-10-05', created_at: '2026-10-05T10:00:00Z' }),
  todo('next-week', { week_start: '2026-11-09', due_date: '2026-11-12' }),
  todo('cyrus-overdue', { owner_user_id: CY, due_date: '2026-11-01' }),
  todo('unowned-nodate', { owner_user_id: null, created_at: '2026-11-03T10:00:00Z' }),
  todo('done', { status: 'done', due_date: '2026-10-01' }),
  todo('dropped', { status: 'dropped', due_date: '2026-10-01' }),
  todo('ticked', { week_start: '2026-10-12', due_date: '2026-10-13' }),
  todo('flag', { prospect_contact_id: 'pc1', due_date: '2026-10-01' }),
  { id: 'waiting', business_id: B, kind: 'waiting', status: 'open', due_date: '2026-10-01' },
  { id: 'commitment', business_id: B, kind: 'commitment', status: 'open', plan_id: 'pl', week_start: '2026-11-02', owner_user_id: JACK },
];
const seed = () => fakeSupabase({
  business_members: [{ business_id: B, user_id: JACK, name: 'Jack Zz', created_at: '2026-10-01' }, { business_id: B, user_id: CY, name: 'Cyrus Yy', created_at: '2026-10-02' }],
  sales_week_goals: rows,
  sales_week_goal_steps: [{ id: 's1', business_id: B, goal_id: 'ticked', done: true }, { id: 's2', business_id: B, goal_id: 'this-week-due', done: false }],
  sales_goals: [], sales_opportunities: [], sales_targets: [], sales_suggestions: [], sales_signals: [], sales_partner_events: [], sales_opportunity_events: [],
  sales_sequenced_accounts: [], partner_domains: [], sales_call_notes: [], web_visits: [], sales_sync_runs: [], microsoft_grants: [], microsoft_sync_runs: [],
  visit_pull_runs: [], sales_tidy_runs: [], research_runs: [], sales_settings: [], sales_people: [], apollo_credit_spend: [], sales_email_daily_counts: [],
  sales_outreach_campaigns: [], sales_outreach_tracks: [], sales_outreach_steps: [], sales_outreach_events: [], sales_outreach_contacts: [], partner_contacts: [],
  sales_email_messages: [], microsoft_messages: [], microsoft_events: [], sales_mailbox_owners: [],
});

test('openTodosFor: every open to-do whatever its week_start; done / dropped / ticked / flags out; steps attached; owner narrows', async () => {
  const s = seed();
  const all = await openTodosFor(s, B);
  assert.deepEqual(new Set(all.rows.map(r => r.id)), new Set(['this-week-due', 'old-week-overdue', 'old-week-nodate', 'next-week', 'cyrus-overdue', 'unowned-nodate']));
  assert.equal(all.total, 6);
  assert.deepEqual(all.rows.find(r => r.id === 'this-week-due').steps, [{ goal_id: 'this-week-due', done: false }], 'steps came from their table');
  const mine = await openTodosFor(s, B, JACK);
  assert.deepEqual(mine.rows.map(r => r.id), ['old-week-overdue', 'this-week-due', 'next-week', 'old-week-nodate'], 'dated first by due date, then undated newest first');
  assert.deepEqual(todoCounts(mine.rows, TODAY), { open: 4, overdue: 1, nodate: 1 });
});

test('todoGroup: today = due today or earlier, week = through this LA Sunday, later, nodate', () => {
  assert.equal(weekEndOf(TODAY), '2026-11-08');
  assert.deepEqual(['2026-10-01', TODAY, '2026-11-08', '2026-11-09', null].map(d => todoGroup(d, TODAY)), ['today', 'today', 'week', 'later', 'nodate']);
  assert.deepEqual([todoGroup('2026-11-08', '2026-11-08'), todoGroup('2026-11-09', '2026-11-08')], ['today', 'later'], 'on a Sunday the week ends that day; Monday is Later');
});

test('cap: TODO_CAP rows per list - dated rows first, undated newest first - and total says how many there were', async () => {
  const many = [];
  for (let i = 0; i < TODO_CAP + 30; i++) many.push(todo(`t${i}`, { due_date: i < 20 ? `2026-10-${String(1 + (i % 28)).padStart(2, '0')}` : null, created_at: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00Z` }));
  const s = fakeSupabase({ sales_week_goals: many, sales_week_goal_steps: [] });
  const r = await openTodosFor(s, B, JACK);
  assert.equal(r.total, TODO_CAP + 30);
  assert.equal(r.rows.length, TODO_CAP);
  assert.equal(r.rows.filter(x => x.due_date).length, 20, 'every dated row is kept');
  const undated = r.rows.filter(x => !x.due_date);
  assert.ok(undated.every((x, i) => i === 0 || undated[i - 1].created_at >= x.created_at), 'undated rows newest first');
  const cut = many.filter(x => !x.due_date && !r.rows.some(k => k.id === x.id));
  assert.equal(cut.length, 30);
  assert.ok(cut.every(c => undated.every(u => u.created_at >= c.created_at)), 'the oldest undated rows are the ones cut');
});

test('parity by construction: Needs attention overdue = the overdue to-dos on Actions for the same person = the Dashboard row', async () => {
  const s = seed();
  const dry = { apollo: async () => ({ held: [] }), outlook: async () => ({ held: [] }) };
  const att = await attention(s, { businessId: B, userId: JACK, now: NOW.getTime(), dry, fresh: true });
  const act = await listActions(s, B, NOW);
  const mineOnActions = act.items.filter(i => i.kind === 'todo' && i.owner_user_id === JACK);
  assert.equal(mineOnActions.length, 4, 'all of my open to-dos, 3 weeks of them');
  assert.equal(att.counts.overdue_todos, mineOnActions.filter(i => i.overdue).length);
  assert.equal(att.counts.overdue_todos, 1);
  assert.deepEqual(act.groups, { today: 5, week: 1, later: 1, nodate: 2 }, 'today = the overdue waiting row, the flag, the Focus row, two overdue to-dos (mine from September, Cyrus\'s); nodate = mine from October + the unowned one');
  const dash = await loadDashboard(s, B, { days: 30, owner: null, team: null }, NOW);
  const jack = dash.todos_per_owner.find(r => r.owner_user_id === JACK);
  assert.deepEqual([jack.open, jack.overdue, jack.nodate], [4, att.counts.overdue_todos, 1]);
  assert.deepEqual(dash.todos_per_owner.map(r => [r.name, r.open]), [['Jack Zz', 4], ['Cyrus Yy', 1], ['Unassigned', 1]]);
  assert.equal(act.items.filter(i => i.kind === 'focus').length, 1, 'Focus 5 still reads this week');
});
