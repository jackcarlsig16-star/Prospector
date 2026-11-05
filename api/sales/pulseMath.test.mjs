import test from 'node:test';
import assert from 'node:assert/strict';
import { windows, buildPulse, weeksIn, upcomingExternal, PERIODS, METRICS } from './pulseMath.js';

// dashboard-v3 Stage 2 - Home's Pulse, pure: the windows per period, every number from stored rows, deltas by direction.
const TODAY = '2026-11-05'; // a Thursday; this week = Nov 2-5, last week = Oct 26 - Nov 1
const NOW = Date.parse('2026-11-05T20:00:00Z');

test('windows: five of a kind, oldest first, the last one partial for this week / month / 90 days; last week is whole', () => {
  assert.deepEqual(windows('this_week', TODAY).map(w => `${w.from}..${w.to}`), ['2026-10-05..2026-10-11', '2026-10-12..2026-10-18', '2026-10-19..2026-10-25', '2026-10-26..2026-11-01', '2026-11-02..2026-11-05']);
  assert.deepEqual(windows('last_week', TODAY).slice(-1).map(w => `${w.from}..${w.to}`), ['2026-10-26..2026-11-01']);
  assert.deepEqual(windows('4_weeks', TODAY).slice(-2).map(w => `${w.from}..${w.to}`), ['2026-09-14..2026-10-11', '2026-10-12..2026-11-05']);
  assert.deepEqual(windows('month', TODAY).slice(-2).map(w => `${w.from}..${w.to}`), ['2026-10-01..2026-10-31', '2026-11-01..2026-11-05']);
  assert.deepEqual(windows('90_days', TODAY).slice(-1).map(w => `${w.from}..${w.to}`), ['2026-08-08..2026-11-05']);
  assert.equal(PERIODS.length, 5);
  assert.throws(() => windows('year', TODAY), /unknown period/);
  assert.equal(weeksIn('2026-11-05'), 1); assert.equal(weeksIn('2026-11-09'), 2); assert.equal(weeksIn('2026-11-01'), 1); assert.equal(weeksIn('2026-11-30'), 5);
});

const day = (d, over = {}) => ({ day: d, mailbox: 'a', delivered: 10, hard_bounced: 0, spam_blocked: 0, opened: 2, replied: 0, ...over });
const counts = [
  day('2026-10-26', { delivered: 100, hard_bounced: 4, opened: 10, replied: 1 }), day('2026-10-28', { delivered: 50, opened: 5 }),
  day('2026-11-02', { delivered: 60, hard_bounced: 2, opened: 6, replied: 0 }), day('2026-11-04', { delivered: 40, opened: 2 }),
  day('2026-09-15', { delivered: 10, replied: 3 }),
];
const deliveredAt = new Map([['m1', '2026-11-02T10:00:00Z'], ['m2', '2026-10-27T10:00:00Z']]);
const opens = [
  { apollo_message_id: 'm1', occurred_at: '2026-11-03T12:00:00Z', user_agent: 'Mozilla', tracking_service: null }, // human, this week
  { apollo_message_id: 'm1', occurred_at: '2026-11-03T12:30:00Z', user_agent: 'generic linux', tracking_service: null }, // bot, this week
  { apollo_message_id: 'm2', occurred_at: '2026-10-28T12:00:00Z', user_agent: 'Mozilla', tracking_service: null }, // human, last week
];
const events = [
  { graph_id: 'a', ical_uid: 'u1', external_domains: ['acme.example'], start_at: '2026-11-04T15:00:00Z', created_at_graph: '2026-11-03T09:00:00Z', is_cancelled: false },
  { graph_id: 'b', ical_uid: 'u2', external_domains: ['hub.example'], start_at: '2026-11-09T20:30:00Z', created_at_graph: '2026-10-30T09:00:00Z', is_cancelled: false }, // booked last week, upcoming
  { graph_id: 'c', ical_uid: 'u3', external_domains: [], start_at: '2026-11-12T20:30:00Z', created_at_graph: '2026-11-01T09:00:00Z', is_cancelled: false }, // internal
  { graph_id: 'd', ical_uid: 'u2', external_domains: ['hub.example'], start_at: '2026-11-09T20:30:00Z', created_at_graph: '2026-10-30T09:00:00Z', is_cancelled: false }, // same meeting, other calendar
];
const visits = [
  { pulled_on: '2026-10-27', company_key: 'x' }, { pulled_on: '2026-10-27', company_key: 'y' }, { pulled_on: '2026-10-29', company_key: 'x' },
  { pulled_on: '2026-11-03', company_key: 'x' }, { pulled_on: '2026-11-04', company_key: 'z' }, { pulled_on: '2026-11-04', company_key: 'q' },
];
const people = [{ first_touch_at: '2026-11-02T18:00:00Z' }, { first_touch_at: '2026-11-04T18:00:00Z' }, { first_touch_at: '2026-10-27T18:00:00Z' }, { first_touch_at: '2026-09-01T18:00:00Z' }];

test('buildPulse this week: every metric from the rows, the window before it, a five-point series, deltas with direction', () => {
  const p = buildPulse({ period: 'this_week', today: TODAY, now: NOW, counts, opens, deliveredAt, events, visits, people, goal: { goal: 100, unit: 'people', carried: false }, synced_at: '2026-11-05T17:00:00Z', apollo_calls: 21, credits: { used: 0, cap: 500 } });
  assert.equal(p.from, '2026-11-02'); assert.equal(p.to, '2026-11-05'); assert.deepEqual(p.prev, { from: '2026-10-26', to: '2026-11-01' });
  assert.deepEqual(Object.keys(p.metrics), METRICS);
  const m = p.metrics;
  // Sent = delivered + hard bounced + spam blocked, by send date; last week 100+4+50 = 154, this week 60+2+40 = 102.
  assert.deepEqual([m.sent.value, m.sent.prev, m.sent.delta], [102, 154, -52]);
  assert.equal(Math.round(m.sent.delta_pct * 1000), -338);
  assert.deepEqual(m.sent.series, [0, 0, 0, 154, 102]);
  assert.equal(m.sent.kind, 'count'); assert.equal(m.sent.better, 'up');
  // Delivered rate = delivered / sent: 100/102 vs 150/154 (points delta, no pct).
  assert.equal(m.delivered_rate.value, 100 / 102); assert.equal(m.delivered_rate.prev, 150 / 154); assert.equal(m.delivered_rate.delta_pct, null); assert.equal(m.delivered_rate.kind, 'rate');
  // Human opens = Apollo open rate (8/100) × human share of the window's opens (1 of 2); last week 15/150 × 1/1.
  assert.equal(m.human_open_rate.value, 0.08 * 0.5); assert.equal(m.human_open_rate.prev, 0.1); assert.equal(m.human_open_rate.apollo_open_rate, 0.08); assert.equal(m.human_open_rate.human_share, 0.5);
  // Replies = replied / delivered; "ever" sums every stored row.
  assert.equal(m.reply_rate.value, 0); assert.equal(m.reply_rate.prev, 1 / 150); assert.equal(m.reply_rate.ever, 4); assert.equal(m.reply_rate.replied, 0); assert.equal(m.reply_rate.delivered, 100);
  // Meetings = external events booked in the window (a this week, b last week, c internal, d = b again); upcoming = b, next Nov 9.
  assert.deepEqual([m.meetings.value, m.meetings.prev, m.meetings.delta], [1, 1, 0]);
  assert.equal(m.meetings.upcoming, 1); assert.equal(m.meetings.next_at, '2026-11-09T20:30:00.000Z');
  // Visitors = companies seen by pulls in the window (x, z, q = 3 over 2 pull days; last week x, y = 2); a window without a pull is null.
  assert.deepEqual([m.visitors.value, m.visitors.prev, m.visitors.pulled_days], [3, 2, 2]);
  assert.deepEqual(m.visitors.series, [null, null, null, 2, 3]); assert.equal(m.visitors.scope, 'team');
  // First-touched = people whose first touch falls in the window, against the month goal.
  assert.deepEqual([m.first_touched.value, m.first_touched.prev, m.first_touched.goal, m.first_touched.unit, m.first_touched.weeks_in], [2, 1, 100, 'people', 1]);
  assert.equal(p.apollo_calls, 21); assert.equal(p.synced_at, '2026-11-05T17:00:00Z'); assert.equal(p.label, 'This week');
});

test('buildPulse month + empty rows: the month windows, nulls where nothing is stored (never zero rates), no goal', () => {
  const p = buildPulse({ period: 'month', today: TODAY, now: NOW, counts, opens, deliveredAt, events, visits, people });
  assert.equal(p.from, '2026-11-01'); assert.deepEqual(p.prev, { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual([p.metrics.sent.value, p.metrics.sent.prev], [102, 154]);
  assert.equal(p.metrics.first_touched.goal, null); assert.equal(p.metrics.first_touched.source, 'people first-touched · month goal');
  const e = buildPulse({ period: 'this_week', today: TODAY, now: NOW });
  assert.deepEqual([e.metrics.sent.value, e.metrics.sent.prev, e.metrics.sent.delta, e.metrics.sent.delta_pct], [0, 0, 0, null]);
  assert.deepEqual([e.metrics.delivered_rate.value, e.metrics.human_open_rate.value, e.metrics.reply_rate.value, e.metrics.visitors.value, e.metrics.visitors.delta], [null, null, null, null, null]);
  assert.deepEqual([e.metrics.meetings.value, e.metrics.meetings.upcoming, e.metrics.meetings.next_at], [0, 0, null]);
  assert.deepEqual(upcomingExternal(events, NOW), { upcoming: 1, next_at: '2026-11-09T20:30:00.000Z' });
});
