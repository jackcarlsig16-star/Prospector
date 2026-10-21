// node --test api/sales/dashboardRoutes.test.mjs  (react-scripts' Jest only runs src/)
// sales-ia-v2 Stage 6 - the Dashboard route: the 13 series, the range, the owner /
// team filters and the credits meter, against the in-memory Supabase. 0 network,
// 0 Claude, 0 Apollo. Made-up company names; no people's emails or phones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { buildDashboard, parseDashboardQuery, loadDashboard, weeksBetween, ownerMatcher } from './dashboardRoutes.js';

const B = randomUUID(), OTHER = randomUUID(), JACK = randomUUID(), CY = randomUUID();
const TODAY = '2026-10-21'; // a Wednesday; this week starts Oct 19
const members = [{ user_id: JACK, name: 'Jack Zz' }, { user_id: CY, name: 'Cyrus Yy' }];
const P = { lake: randomUUID(), north: randomUUID(), live: randomUUID() }, O = { mill: randomUUID(), river: randomUUID() };
const partners = [
  { id: P.lake, name: 'Lakeshore Mutual', category: '3. Brokers', pipeline_status: 'meeting_set', owner_user_id: JACK, owner_team: 'homelover', channel: 'manual' },
  { id: P.north, name: 'Northwind Benefits', category: '3. Brokers', pipeline_status: 'first_email_sent', owner_user_id: CY, owner_team: 'both', channel: 'import' },
  { id: P.live, name: 'Current Co', category: '1. Current partners', pipeline_status: 'live', owner_user_id: null, owner_team: 'upside', channel: 'partner_referral' },
];
const opportunities = [
  { id: O.mill, organization: 'Old Mill Union', stage: 'meeting', owner: 'Jack', owner_team: 'homelover', channel: 'call_note', covered_lives: 1200 },
  { id: O.river, organization: 'Riverbend Schools', stage: 'contacted', owner: 'Cyrus Yy', owner_team: 'upside', channel: 'scout', covered_lives: 800 },
];
const targets = [{ id: randomUUID(), name: 'Zeta Labs', status: 'researching', owner_team: null, channel: 'scout' }];
const visits = [
  { pulled_on: '2026-10-20', company_key: 'acme', priority: 'P1' }, { pulled_on: '2026-10-20', company_key: 'bolt', priority: 'P3' },
  { pulled_on: '2026-10-21', company_key: 'acme', priority: 'P1' }, { pulled_on: '2026-10-21', company_key: 'cove', priority: 'P2' }, { pulled_on: '2026-10-21', company_key: 'dune', priority: 'P2' },
];
const signals = [
  { source: 'scout', status: 'new', created_at: '2026-10-20T15:00:00Z' }, { source: 'scout', status: 'accepted', created_at: '2026-10-19T15:00:00Z' },
  { source: 'web_visit', status: 'dismissed', created_at: '2026-10-21T15:00:00Z' }, { source: 'web_visit', status: 'new', created_at: '2026-09-01T15:00:00Z' },
];
const emails = [
  { day: '2026-10-14', delivered: 100, hard_bounced: 3, spam_blocked: 2, opened: 40, clicked: 5, replied: 4 },
  { day: '2026-10-20', delivered: 50, hard_bounced: 0, spam_blocked: 0, opened: 20, clicked: 2, replied: 3 },
  { day: '2026-10-21', delivered: 10, hard_bounced: 0, spam_blocked: 0, opened: 1, clicked: 0, replied: 1 },
];
const partnerEvents = [
  { id: 'e1', goal_id: P.lake, event: 'status', to_status: 'meeting_set', at: '2026-10-20T18:00:00Z', meta: {} },
  { id: 'e2', goal_id: P.north, event: 'status', to_status: 'meeting_set', at: '2026-10-15T18:00:00Z', meta: {} },
  { id: 'e3', goal_id: P.north, event: 'undo', to_status: null, at: '2026-10-15T18:10:00Z', meta: { undid: 'e2' } },
  { id: 'e4', goal_id: P.lake, event: 'status', to_status: 'replied', at: '2026-10-20T12:00:00Z', meta: {} },
];
const oppEvents = [
  { id: 'o1', opportunity_id: O.mill, event_type: 'stage_change', to_stage: 'meeting', changed_at: '2026-10-16T18:00:00Z' },
  { id: 'o2', opportunity_id: O.river, event_type: 'stage_change', to_stage: 'contacted', changed_at: '2026-10-16T18:00:00Z' },
];
const weekRows = [
  { id: 't1', kind: 'todo', status: 'open', owner_user_id: JACK, week_start: '2026-10-19', steps: [] },
  { id: 't2', kind: 'todo', status: 'done', owner_user_id: JACK, week_start: '2026-10-19', steps: [] },
  { id: 't3', kind: 'todo', status: 'open', owner_user_id: JACK, week_start: '2026-10-19', steps: [{ done: true }] },
  { id: 't4', kind: 'todo', status: 'open', owner_user_id: CY, week_start: '2026-10-19', steps: [] },
  { id: 't5', kind: 'todo', status: 'dropped', owner_user_id: CY, week_start: '2026-10-19', steps: [] },
  { id: 't6', kind: 'todo', status: 'open', owner_user_id: CY, week_start: '2026-10-19', prospect_contact_id: 'pc1', steps: [] },
];
const waiting = [
  { id: 'w1', kind: 'waiting', status: 'open', due_date: '2026-10-15' }, { id: 'w2', kind: 'waiting', status: 'open', due_date: '2026-10-30' }, { id: 'w3', kind: 'waiting', status: 'open', due_date: null },
];
const input = { today: TODAY, days: 30, members, partners, opportunities, targets, visits, signals, emails, partnerEvents, oppEvents, weekRows, waiting, creditsUsed: 134, firstPull: '2026-10-20' };

test('buildDashboard: the 13 series over 30 days, team-wide', () => {
  const d = buildDashboard(input);
  assert.equal(d.from, '2026-09-22');
  assert.equal(d.week_start, '2026-10-19');
  assert.deepEqual(d.pipeline_by_stage.map(s => `${s.id}:${s.count}`), ['target:0', 'contacted:1', 'responded:0', 'meeting:1', 'proposal_pilot:0', 'verbal:0', 'contract:0', 'launched:0'], 'every main stage, side lanes only when used');
  assert.deepEqual(d.covered_lives_by_stage.find(s => s.id === 'meeting').lives, 1200);
  const byOwner = Object.fromEntries(d.partners_by_status_owner.map(r => [r.name, r.counts]));
  assert.equal(byOwner['Jack Zz'].meeting_set, 1); assert.equal(byOwner['Cyrus Yy'].first_email_sent, 1); assert.equal(byOwner.Unassigned.live, 1);
  assert.deepEqual(d.partners_by_category, [{ category: '3. Brokers', count: 2 }, { category: '1. Current partners', count: 1 }]);
  const v = Object.fromEntries(d.visitors_per_day.map(x => [x.day, x.companies]));
  assert.equal(v['2026-10-19'], null, 'a day without a pull is unknown, not zero'); assert.equal(v['2026-10-20'], 2); assert.equal(v['2026-10-21'], 3);
  assert.deepEqual(d.visitors_by_priority_day.at(-1), { day: TODAY, P1: 1, P2: 2, P3: 0, P4: 0 });
  assert.equal(d.history_start, '2026-10-20'); assert.equal(d.history_days, 2); assert.equal(d.history_full, false);
  const wk = Object.fromEntries(d.outreach_per_week.map(w => [w.week_start, w]));
  assert.equal(d.outreach_per_week.length, 5, 'Mondays Sep 21 .. Oct 19');
  assert.deepEqual(wk['2026-10-12'], { week_start: '2026-10-12', sent: 105, opened: 40, clicked: 5, replied: 4 }, 'sent = delivered + bounced + spam blocked');
  assert.deepEqual(wk['2026-10-19'], { week_start: '2026-10-19', sent: 60, opened: 21, clicked: 2, replied: 4 });
  const rm = Object.fromEntries(d.replies_meetings_per_week.map(w => [w.week_start, w]));
  assert.deepEqual(rm['2026-10-19'], { week_start: '2026-10-19', replies: 4, meetings: 1 }, 'the partner move to Meeting set this week');
  assert.deepEqual(rm['2026-10-12'], { week_start: '2026-10-12', replies: 4, meetings: 1 }, 'the employer move to Meeting counts; the undone partner move does not');
  assert.deepEqual(d.signals_by_channel, [{ source: 'scout', label: 'Scout', new: 1, accepted: 1, dismissed: 0 }, { source: 'web_visit', label: 'Website', new: 0, accepted: 0, dismissed: 1 }], 'the September signal is outside the range');
  const ch = Object.fromEntries(d.companies_by_channel_stage.map(r => [r.channel, r.bands]));
  assert.equal(ch.scout.gray, 2, 'Riverbend (contacted) + the researching target'); assert.equal(ch.manual.yellow, 1); assert.equal(ch.partner_referral.green, 1); assert.equal(ch.call_note.yellow, 1);
  assert.deepEqual(d.todos_per_owner.map(r => [r.name, r.done, r.open]), [['Jack Zz', 2, 1], ['Cyrus Yy', 0, 1]], 'all-steps-done counts as done; dropped and flags are out');
  assert.deepEqual(d.waiting, { open: 3, overdue: 1 });
  assert.deepEqual(d.credits, { used: 134, cap: 500, month: '2026-10', all_businesses: true });
});

test('range 7: weeks and days shrink; weeksBetween starts on the Monday of the first day', () => {
  const d = buildDashboard({ ...input, days: 7 });
  assert.equal(d.from, '2026-10-15');
  assert.equal(d.visitors_per_day.length, 7);
  assert.deepEqual(d.outreach_per_week.map(w => w.week_start), ['2026-10-12', '2026-10-19']);
  assert.deepEqual(weeksBetween('2026-10-15', '2026-10-21'), ['2026-10-12', '2026-10-19']);
  assert.equal(d.signals_by_channel[0].accepted, 1, 'Oct 19 is inside the last 7 days');
});

test('owner filter: partners by owner id, employers by the typed owner name, to-dos and meetings follow; team-wide series unchanged', () => {
  const d = buildDashboard({ ...input, owner: JACK });
  assert.deepEqual(d.pipeline_by_stage.find(s => s.id === 'contacted').count, 0, "Riverbend is Cyrus's");
  assert.deepEqual(d.partners_by_status_owner.map(r => r.name), ['Jack Zz']);
  assert.deepEqual(d.partners_by_category, [{ category: '3. Brokers', count: 1 }]);
  assert.deepEqual(d.todos_per_owner, [{ owner_user_id: JACK, name: 'Jack Zz', done: 2, open: 1 }]);
  const rm = Object.fromEntries(d.replies_meetings_per_week.map(w => [w.week_start, w.meetings]));
  assert.equal(rm['2026-10-12'], 1, "Jack's employer meeting"); assert.equal(rm['2026-10-19'], 1, "Jack's partner meeting");
  assert.equal(d.visitors_per_day.at(-1).companies, 3, 'visitors stay team-wide');
  assert.equal(d.companies_by_channel_stage.some(r => r.channel === 'scout' && r.bands.gray), false, 'targets have no owner, so an owner filter drops them');
  const c = buildDashboard({ ...input, owner: CY });
  assert.equal(c.pipeline_by_stage.find(s => s.id === 'contacted').count, 1, 'the full name matches too');
  assert.ok(ownerMatcher(members, JACK)('  jack ')); assert.equal(ownerMatcher(members, 'nobody')('Jack'), false);
});

test('team filter: exact team plus "both" rows; the Unassigned owner row only when it has partners', () => {
  const hl = buildDashboard({ ...input, team: 'homelover' });
  assert.deepEqual(hl.partners_by_status_owner.map(r => r.name), ['Jack Zz', 'Cyrus Yy'], 'Northwind is "both", so it stays under HomeLover');
  assert.equal(hl.pipeline_by_stage.find(s => s.id === 'contacted').count, 0);
  assert.equal(hl.companies_by_channel_stage.some(r => r.channel === 'scout'), false, 'the untagged target drops under a team filter');
  const up = buildDashboard({ ...input, team: 'upside' });
  assert.deepEqual(up.partners_by_status_owner.map(r => r.name), ['Jack Zz', 'Cyrus Yy', 'Unassigned'], 'every member keeps a row (stable groups); Unassigned appears because Current Co is Upside');
  assert.equal(Object.values(up.partners_by_status_owner[0].counts).some(Boolean), false, 'Jack has no Upside partners');
  assert.equal(up.covered_lives_by_stage.find(s => s.id === 'contacted').lives, 800);
});

test('parseDashboardQuery: 30 by default, only 7 | 30 | 90, team must be a known owner team', () => {
  assert.deepEqual(parseDashboardQuery({}), { days: 30, owner: null, team: null });
  assert.deepEqual(parseDashboardQuery({ days: '90', owner: JACK, team: 'both' }), { days: 90, owner: JACK, team: 'both' });
  assert.match(parseDashboardQuery({ days: '14' }).error, /7\|30\|90/);
  assert.match(parseDashboardQuery({ team: 'acme' }).error, /homelover/);
});

test('loadDashboard: reads only this workspace (credits across all), archived rows out, steps attached', async () => {
  const sb = fakeSupabase({
    business_members: members.map(m => ({ business_id: B, ...m, created_at: '2026-10-01' })),
    sales_goals: [...partners.map(p => ({ business_id: B, goal_type: 'partnership', archived_at: null, ...p })), { id: randomUUID(), business_id: B, goal_type: 'partnership', archived_at: '2026-10-01', name: 'Gone', pipeline_status: 'live', category: '3. Brokers' }, { id: randomUUID(), business_id: OTHER, goal_type: 'partnership', archived_at: null, name: 'Elsewhere', pipeline_status: 'live' }],
    sales_opportunities: opportunities.map(o => ({ business_id: B, archived_at: null, ...o })),
    sales_targets: targets.map(t => ({ business_id: B, ...t })),
    web_visits: visits.map(v => ({ id: randomUUID(), business_id: B, ...v })),
    sales_signals: signals.map(s => ({ id: randomUUID(), business_id: B, ...s })),
    sales_email_daily_counts: emails.map(e => ({ business_id: B, mailbox: 'm', sequence_id: '', step: 0, ...e })), // no id column on this table
    sales_partner_events: partnerEvents.map(e => ({ business_id: B, ...e })),
    sales_opportunity_events: oppEvents.map(e => ({ business_id: B, ...e })),
    sales_week_goals: [...weekRows, ...waiting].map(r => ({ business_id: B, ...r })),
    sales_week_goal_steps: [{ id: 's1', business_id: B, goal_id: 't3', done: true }],
    apollo_credit_spend: [{ business_id: B, la_month: '2026-10', credits: 100 }, { business_id: OTHER, la_month: '2026-10', credits: 34 }, { business_id: B, la_month: '2026-09', credits: 400 }],
  });
  const d = await loadDashboard(sb, B, { days: 30, owner: null, team: null }, new Date('2026-10-21T19:00:00Z'));
  assert.equal(d.today, TODAY);
  assert.equal(d.partners_by_category.reduce((n, c) => n + c.count, 0), 3, 'the archived and the other workspace\'s partners are out');
  assert.deepEqual(d.credits, { used: 134, cap: 500, month: '2026-10', all_businesses: true }, 'credits sum every workspace for this LA month');
  assert.deepEqual(d.todos_per_owner.map(r => [r.name, r.done, r.open]), [['Jack Zz', 2, 1], ['Cyrus Yy', 0, 1]], 'steps came from their own table');
  assert.equal(d.history_start, '2026-10-20');
});
