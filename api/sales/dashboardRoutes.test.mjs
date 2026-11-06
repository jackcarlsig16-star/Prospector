// node --test api/sales/dashboardRoutes.test.mjs  (react-scripts' Jest only runs src/)
// dashboard-v3 Stage 5 - GET goals/dashboard = the Home small cards: employers by stage, partners by status (six groups)
// and by owner, open to-dos per owner, waiting-on, covered lives vs its goal; the owner filter; the read against the
// in-memory Supabase. 0 network, 0 Claude, 0 Apollo. Made-up names; no emails or phones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { buildHomeCards, loadDashboard, ownerMatcher } from './dashboardRoutes.js';
import { PARTNER_STATUS_GROUPS } from '../../src/constants/homeCards.js';

const B = randomUUID(), JACK = randomUUID(), CY = randomUUID();
const TODAY = '2026-11-05';
const members = [{ user_id: JACK, name: 'Jack Zz' }, { user_id: CY, name: 'Cyrus Yy' }];
const partner = (status, owner) => ({ id: randomUUID(), pipeline_status: status, owner_user_id: owner });
const partners = [
  partner('not_started', JACK), partner('not_started', CY), partner(null, null), partner('researching', JACK), partner('first_email_sent', CY),
  partner('in_sequence', JACK), partner('replied', CY), partner('meeting_set', JACK), partner('proposal_pilot', JACK), partner('live', CY), partner('paused', JACK),
];
const opp = (stage, owner, covered_lives = 0) => ({ id: randomUUID(), stage, owner, covered_lives });
const opportunities = [
  opp('target', 'Jack'), opp('target', 'Cyrus Yy'), opp('contacted', 'Jack'), opp('nurture', 'Jack'), opp('verbal', 'Jack', 390), opp('meeting', 'Cyrus', 150), opp('on_hold', null), opp('lost', 'Jack', 50),
];
const todos = [
  { id: 't1', owner_user_id: JACK, due_date: '2026-10-15' }, { id: 't2', owner_user_id: JACK, due_date: '2026-11-20' }, { id: 't3', owner_user_id: JACK, due_date: null },
  { id: 't4', owner_user_id: CY, due_date: null }, { id: 't5', owner_user_id: null, due_date: '2026-11-01' },
];
const waiting = [
  { id: 'w1', kind: 'waiting', status: 'open', due_date: '2026-10-30' }, { id: 'w2', kind: 'waiting', status: 'open', due_date: null }, { id: 'w3', kind: 'waiting', status: 'done', due_date: '2026-10-01' },
];
const input = { today: TODAY, members, partners, opportunities, todos, waiting, livesGoal: 1000 };

test('buildHomeCards: every main stage (a side lane only when used, Lost included), the six partner groups, owners with Unassigned, to-dos split overdue, waiting-on, lives = stage Meeting or later vs the goal', () => {
  const d = buildHomeCards(input);
  assert.deepEqual(d.employers.by_stage.map(s => `${s.id}:${s.count}`), ['target:2', 'contacted:1', 'responded:0', 'meeting:1', 'proposal_pilot:0', 'verbal:1', 'contract:0', 'launched:0', 'lost:1', 'nurture:1', 'on_hold:1']);
  assert.equal(d.employers.total, 8);
  assert.deepEqual(d.partners.by_status.map(s => `${s.id}:${s.count}`), ['not_started:3', 'working:3', 'replied:1', 'meeting:1', 'pilot_live:2', 'paused:1']);
  assert.deepEqual(d.partners.by_status.map(s => s.label), PARTNER_STATUS_GROUPS.map(g => g.label));
  assert.equal(d.partners.total, 11);
  assert.deepEqual(d.partners.by_owner.map(r => [r.name, r.count]), [['Jack Zz', 6], ['Cyrus Yy', 4], ['Unassigned', 1]]);
  assert.deepEqual(d.todos.per_owner.map(r => [r.name, r.open, r.overdue]), [['Jack Zz', 3, 1], ['Cyrus Yy', 1, 0], ['Unassigned', 1, 1]]);
  assert.deepEqual([d.todos.open, d.todos.overdue], [5, 2]);
  assert.deepEqual(d.waiting, { open: 2, overdue: 1, scope: 'team' });
  assert.deepEqual(d.lives, { value: 540, goal: 1000, metric: 'covered_lives_pipeline' }, 'verbal 390 + meeting 150; the lost 50 and anything before Meeting are out');
  assert.equal(JSON.stringify(d).includes('@'), false);
});

test('owner filter: partners by owner id, employers by the typed owner name (full or first), to-dos that owner only; waiting-on stays team-wide; Unassigned row only when it has rows', () => {
  const d = buildHomeCards({ ...input, owner: JACK });
  assert.deepEqual(d.employers.by_stage.filter(s => s.count).map(s => `${s.id}:${s.count}`), ['target:1', 'contacted:1', 'verbal:1', 'lost:1', 'nurture:1']);
  assert.deepEqual(d.partners.by_owner, [{ owner_user_id: JACK, name: 'Jack Zz', count: 6 }]);
  assert.deepEqual(d.partners.by_status.map(s => s.count), [1, 2, 0, 1, 1, 1]);
  assert.deepEqual(d.todos.per_owner, [{ owner_user_id: JACK, name: 'Jack Zz', open: 3, overdue: 1 }]);
  assert.deepEqual(d.waiting, { open: 2, overdue: 1, scope: 'team' });
  assert.equal(d.lives.value, 390);
  const c = buildHomeCards({ ...input, owner: CY, livesGoal: null });
  assert.equal(c.employers.by_stage.find(s => s.id === 'target').count, 1, 'the full name matches too');
  assert.deepEqual(c.lives, { value: 150, goal: null, metric: 'covered_lives_pipeline' });
  assert.ok(ownerMatcher(members, JACK)('  jack ')); assert.equal(ownerMatcher(members, 'nobody')('Jack'), false);
  const empty = buildHomeCards({ ...input, partners: [], opportunities: [], todos: [], waiting: [] });
  assert.deepEqual(empty.partners.by_owner.map(r => r.name), ['Jack Zz', 'Cyrus Yy'], 'no Unassigned row without rows');
  assert.equal(empty.employers.total, 0); assert.equal(empty.lives.value, 0);
});

test('loadDashboard: reads the live tables (partnership goals, open opportunities, open to-dos with their steps, open waiting rows, the latest lives goal on or before today) and builds the cards', async () => {
  const s = fakeSupabase({
    business_members: [{ business_id: B, user_id: JACK, name: 'Jack Zz', created_at: '2026-10-01' }, { business_id: B, user_id: CY, name: 'Cyrus Yy', created_at: '2026-10-02' }],
    sales_goals: [
      { id: 'g1', business_id: B, goal_type: 'partnership', pipeline_status: 'replied', owner_user_id: JACK, archived_at: null },
      { id: 'g2', business_id: B, goal_type: 'partnership', pipeline_status: 'live', owner_user_id: null, archived_at: null },
      { id: 'g3', business_id: B, goal_type: 'partnership', pipeline_status: 'live', owner_user_id: JACK, archived_at: '2026-10-01T00:00:00Z' },
      { id: 'g4', business_id: B, goal_type: 'other', pipeline_status: 'live', owner_user_id: JACK, archived_at: null },
    ],
    sales_opportunities: [
      { id: 'o1', business_id: B, stage: 'verbal', owner: 'Jack', covered_lives: 390, archived_at: null },
      { id: 'o2', business_id: B, stage: 'target', owner: 'Cyrus', covered_lives: 0, archived_at: null },
      { id: 'o3', business_id: B, stage: 'launched', owner: 'Jack', covered_lives: 999, archived_at: '2026-10-01T00:00:00Z' },
    ],
    sales_week_goals: [
      { id: 't1', business_id: B, kind: 'todo', status: 'open', owner_user_id: JACK, due_date: '2026-10-01', prospect_contact_id: null, week_start: '2026-09-28', created_at: '2026-09-20T00:00:00Z' },
      { id: 't2', business_id: B, kind: 'todo', status: 'open', owner_user_id: JACK, due_date: null, prospect_contact_id: null, week_start: '2026-11-02', created_at: '2026-11-01T00:00:00Z' },
      { id: 't3', business_id: B, kind: 'todo', status: 'open', owner_user_id: CY, due_date: null, prospect_contact_id: null, week_start: '2026-11-02', created_at: '2026-11-01T00:00:00Z' },
      { id: 't4', business_id: B, kind: 'todo', status: 'done', owner_user_id: CY, due_date: null, prospect_contact_id: null, week_start: '2026-11-02', created_at: '2026-11-01T00:00:00Z' },
      { id: 'w1', business_id: B, kind: 'waiting', status: 'open', owner_user_id: null, due_date: '2026-10-30', prospect_contact_id: null, week_start: '2026-10-26', created_at: '2026-10-20T00:00:00Z' },
    ],
    sales_week_goal_steps: [{ id: 's1', business_id: B, goal_id: 't3', done: true }],
    sales_metric_targets: [
      { business_id: B, period: 'week', period_start: '2026-10-05', metric_key: 'covered_lives_pipeline', goal: 800 },
      { business_id: B, period: 'week', period_start: '2026-11-02', metric_key: 'covered_lives_pipeline', goal: 1000 },
      { business_id: B, period: 'week', period_start: '2026-12-07', metric_key: 'covered_lives_pipeline', goal: 2000 },
      { business_id: B, period: 'week', period_start: '2026-11-02', metric_key: 'sequences_running', goal: 12 },
    ],
  });
  const d = await loadDashboard(s, B, { owner: null }, new Date(`${TODAY}T19:00:00Z`));
  assert.equal(d.today, TODAY);
  assert.deepEqual(d.partners.by_status.filter(x => x.count).map(x => `${x.id}:${x.count}`), ['replied:1', 'pilot_live:1'], 'archived and non-partnership goals out');
  assert.deepEqual(d.partners.by_owner.map(r => [r.name, r.count]), [['Jack Zz', 1], ['Cyrus Yy', 0], ['Unassigned', 1]]);
  assert.deepEqual(d.employers.by_stage.filter(x => x.count).map(x => `${x.id}:${x.count}`), ['target:1', 'verbal:1'], 'the archived opportunity is out');
  assert.deepEqual(d.todos.per_owner.map(r => [r.name, r.open, r.overdue]), [['Jack Zz', 2, 1], ['Cyrus Yy', 0, 0]], "Cyrus's open to-do has every step ticked, the done one is done; a member keeps a row");
  assert.deepEqual(d.waiting, { open: 1, overdue: 1, scope: 'team' });
  assert.deepEqual(d.lives, { value: 390, goal: 1000, metric: 'covered_lives_pipeline' }, 'the latest goal on or before today, not December');
});
