import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExplorer, bucketsOf, defaultRange, stableColor, laDayOf, LAYER_IDS, BAND } from './explorerMath.js';
import { mailboxLabels, parseExplorerQuery, cleanState } from './explorerRoutes.js';

// dashboard-v3 Stage 3 - the Explorer's series math over fixtures: every layer from its rows, week and day rollups
// across the LA DST change (Nov 1 2026), splits with stable colors, notes, the query parser.
const TODAY = '2026-11-05';
const day = (d, over = {}) => ({ day: d, mailbox: 'a@x', sequence_id: 's1', delivered: 10, hard_bounced: 0, spam_blocked: 0, opened: 2, replied: 0, ...over });
const counts = [
  day('2026-10-26', { delivered: 100, hard_bounced: 4, spam_blocked: 1, opened: 10, replied: 1 }),
  day('2026-10-28', { delivered: 50, opened: 5, mailbox: 'b@x', sequence_id: 's2' }),
  day('2026-11-01', { delivered: 20, opened: 1, replied: 1 }), // Sunday Nov 1 = the DST day, still the week of Oct 26
  day('2026-11-02', { delivered: 60, hard_bounced: 2, opened: 6 }),
  day('2026-11-04', { delivered: 40, opened: 2, mailbox: 'b@x', sequence_id: 's2' }),
];
const deliveredAt = new Map([['m1', '2026-11-02T10:00:00Z'], ['m2', '2026-10-27T10:00:00Z']]);
const opens = [
  { apollo_message_id: 'm1', sender: 'a@x', sequence_id: 's1', occurred_at: '2026-11-03T12:00:00Z', user_agent: 'Mozilla', tracking_service: null }, // human
  { apollo_message_id: 'm1', sender: 'a@x', sequence_id: 's1', occurred_at: '2026-11-03T12:30:00Z', user_agent: 'generic linux', tracking_service: null }, // bot
  { apollo_message_id: 'm2', sender: 'b@x', sequence_id: 's2', occurred_at: '2026-10-28T12:00:00Z', user_agent: 'Mozilla', tracking_service: null }, // human
];
const events = [
  { graph_id: 'a', ical_uid: 'u1', user_id: 'jack', external_domains: ['acme.example'], start_at: '2026-11-04T15:00:00Z', created_at_graph: '2026-11-03T09:00:00Z', is_cancelled: false },
  { graph_id: 'b', ical_uid: 'u1', user_id: 'cyrus', external_domains: ['acme.example'], start_at: '2026-11-04T15:00:00Z', created_at_graph: '2026-11-03T09:00:00Z', is_cancelled: false }, // same meeting on Cyrus's calendar
  { graph_id: 'c', ical_uid: 'u2', user_id: 'jack', external_domains: ['hub.example'], start_at: '2026-11-09T20:30:00Z', created_at_graph: '2026-11-01T08:30:00Z', is_cancelled: false }, // 01:30 PDT Nov 1
  { graph_id: 'd', ical_uid: 'u3', user_id: 'jack', external_domains: ['z.example'], start_at: '2026-11-09T20:30:00Z', created_at_graph: '2026-11-02T07:30:00Z', is_cancelled: false }, // 23:30 PST Nov 1
  { graph_id: 'e', ical_uid: 'u4', user_id: 'jack', external_domains: ['z.example'], start_at: '2026-11-09T20:30:00Z', created_at_graph: '2026-11-02T08:30:00Z', is_cancelled: false }, // 00:30 PST Nov 2
  { graph_id: 'f', ical_uid: 'u5', user_id: 'jack', external_domains: [], start_at: '2026-11-04T16:00:00Z', created_at_graph: '2026-11-03T09:00:00Z', is_cancelled: false }, // internal
];
const visits = [
  { pulled_on: '2026-10-27', company_key: 'x' }, { pulled_on: '2026-10-27', company_key: 'y' }, { pulled_on: '2026-10-29', company_key: 'x' },
  { pulled_on: '2026-11-03', company_key: 'x' }, { pulled_on: '2026-11-04', company_key: 'z' },
];
const people = [{ first_touch_at: '2026-11-02T18:00:00Z', owner_user_id: 'jack' }, { first_touch_at: '2026-10-27T18:00:00Z', owner_user_id: 'cyrus' }, { first_touch_at: '2026-10-01T18:00:00Z', owner_user_id: 'jack' }];
const members = [{ user_id: 'jack', first: 'Jack', color: '#6F8CF0' }, { user_id: 'cyrus', first: 'Cyrus', color: '#C97626' }];
const mailboxOwner = new Map([['a@x', 'jack'], ['b@x', 'cyrus']]);
const mailboxes = mailboxLabels(['a@x', 'b@x'], mailboxOwner, members);
const sequences = [{ id: 's1', name: 'Fitness Employers', cohort: 'Fitness' }, { id: 's2', name: 'Retail HR', cohort: 'Retail' }];
const base = { today: TODAY, from: '2026-10-26', to: TODAY, counts, opens, deliveredAt, events, visits, people, members, mailboxOwner, mailboxes, sequences, firstPull: '2026-10-20' };
const byLayer = r => Object.fromEntries(r.series.map(s => [s.split_key === 'team' ? s.layer : `${s.layer}:${s.split_key}`, s.values]));
const pct = v => v.map(x => (x == null ? null : Math.round(x * 1000) / 1000));

test('weeks: the default range is 8 Monday weeks + this one; buckets by week / day; the DST day lands on its LA date', () => {
  assert.deepEqual(defaultRange(TODAY), { from: '2026-09-07', to: TODAY });
  assert.deepEqual(bucketsOf('week', '2026-10-26', TODAY), ['2026-10-26', '2026-11-02']);
  assert.equal(bucketsOf('day', '2026-10-26', TODAY).length, 11);
  assert.equal(laDayOf('2026-11-01T08:30:00Z'), '2026-11-01'); // 01:30 PDT
  assert.equal(laDayOf('2026-11-02T07:30:00Z'), '2026-11-01'); // 23:30 PST
  assert.equal(laDayOf('2026-11-02T08:30:00Z'), '2026-11-02'); // 00:30 PST
});

test('every layer by week, team: counts and rates from the rows (human opens × share, visitors null without a pull, meetings deduped across calendars, first-touched)', () => {
  const r = buildExplorer({ ...base, layers: LAYER_IDS, by: 'week', split: 'team' });
  assert.deepEqual(r.labels, [{ key: '2026-10-26', label: 'Oct 26', current: false }, { key: '2026-11-02', label: 'Nov 2', current: true }]);
  const v = byLayer(r);
  assert.deepEqual(v.sent, [175, 102]); // (100+4+1) + 50 + 20 · (60+2) + 40
  assert.deepEqual(pct(v.delivered_rate), [170 / 175, 100 / 102].map(x => Math.round(x * 1000) / 1000));
  assert.deepEqual(pct(v.hard_bounce_rate), [Math.round((4 / 175) * 1000) / 1000, Math.round((2 / 102) * 1000) / 1000]);
  assert.deepEqual(pct(v.spam_rate), [Math.round((1 / 175) * 1000) / 1000, 0]);
  assert.deepEqual(pct(v.reply_rate), [Math.round((2 / 170) * 1000) / 1000, 0]);
  // Human opens: Oct 26 week = 16 / 170 × share 1 (one human open); Nov 2 week = 8 / 100 × 1/2.
  assert.deepEqual(pct(v.human_open_rate), [Math.round((16 / 170) * 1000) / 1000, 0.04]);
  assert.deepEqual(v.visitors, [2, 2]);
  assert.deepEqual(v.meetings, [2, 2]); // u2 + u3 booked on Nov 1 (both sides of the DST change); u1 once (Nov 3) + u4 (00:30 PST Nov 2) this week
  assert.deepEqual(v.first_touched, [1, 1]);
  assert.deepEqual(r.notes, { meetings: 'Outlook', first_touched: 'partners' });
  assert.equal(r.band, BAND);
  assert.equal(r.series.find(s => s.layer === 'sent').color, '#8FA8FF');
  assert.equal(r.series.find(s => s.layer === 'sent').kind, 'count');
  assert.equal(r.series.find(s => s.layer === 'reply_rate').kind, 'rate');
});

test('by day: the same rows per LA day; a day without a pull is null; a count day without sends is 0, a rate null', () => {
  const r = buildExplorer({ ...base, layers: ['sent', 'visitors', 'reply_rate', 'meetings'], by: 'day', split: 'team' });
  const v = byLayer(r);
  const i = d => r.labels.findIndex(l => l.key === d);
  assert.equal(v.sent[i('2026-10-26')], 105); assert.equal(v.sent[i('2026-10-27')], 0); assert.equal(v.sent[i('2026-11-01')], 20);
  assert.equal(v.reply_rate[i('2026-10-27')], null); assert.equal(v.reply_rate[i('2026-11-01')], 0.05);
  assert.equal(v.visitors[i('2026-10-27')], 2); assert.equal(v.visitors[i('2026-10-28')], null);
  assert.deepEqual([v.meetings[i('2026-11-01')], v.meetings[i('2026-11-02')], v.meetings[i('2026-11-03')]], [2, 1, 1]);
  assert.equal(r.labels[r.labels.length - 1].current, true);
});

test('splits: person = member colors (mailbox owner / calendar / partner owner), mailbox = owner first name never the address, sequence by name, cohort by palette; visitors stay one team-wide series; colors stable across reads', () => {
  const person = buildExplorer({ ...base, layers: ['sent', 'meetings', 'first_touched', 'visitors'], split: 'person' });
  const p = Object.fromEntries(person.series.map(s => [`${s.layer}:${s.split_key}`, s]));
  assert.deepEqual(p['sent:jack'].values, [125, 62]); assert.equal(p['sent:jack'].color, '#6F8CF0'); assert.equal(p['sent:jack'].label, 'Jack · Sent');
  assert.deepEqual(p['sent:cyrus'].values, [50, 40]); assert.equal(p['sent:cyrus'].color, '#C97626');
  assert.deepEqual(p['meetings:jack'].values, [2, 2]); assert.deepEqual(p['meetings:cyrus'].values, [0, 1]);
  assert.deepEqual(p['first_touched:jack'].values, [0, 1]); assert.deepEqual(p['first_touched:cyrus'].values, [1, 0]);
  assert.equal(p['visitors:team'].label, 'Visitors · team-wide'); assert.deepEqual(p['visitors:team'].values, [2, 2]);
  const mailbox = buildExplorer({ ...base, layers: ['sent'], split: 'mailbox' });
  assert.deepEqual(mailbox.series.map(s => s.label), ['Jack · Sent', 'Cyrus · Sent']);
  assert.ok(mailbox.series.every(s => !/@/.test(s.label)));
  assert.equal(mailbox.series[0].color, stableColor('a@x'));
  assert.deepEqual(mailbox.series.map(s => s.split_key), ['mailbox:jack', 'mailbox:cyrus']);
  assert.equal(stableColor('a@x'), stableColor('a@x'));
  assert.deepEqual(mailboxLabels(['a@x', 'c@x', 'z@x'], new Map([['a@x', 'jack'], ['c@x', 'jack']]), members).map(m => m.label), ['Jack 1', 'Jack 2', 'Mailbox 1']);
  const seq = buildExplorer({ ...base, layers: ['sent', 'human_open_rate'], split: 'sequence' });
  assert.deepEqual(seq.series.map(s => s.label), ['Fitness Employers · Sent', 'Retail HR · Sent', 'Fitness Employers · Human opens %', 'Retail HR · Human opens %']);
  assert.deepEqual(seq.series[0].values, [125, 62]);
  const cohort = buildExplorer({ ...base, layers: ['sent'], split: 'cohort' });
  assert.deepEqual(cohort.series.map(s => [s.label, s.color]), [['Fitness · Sent', '#E07A5F'], ['Retail · Sent', '#6C9BD2']]);
  const wide = buildExplorer({ ...base, from: '2026-10-19', layers: ['visitors'] });
  assert.equal(wide.notes.visitors, 'from Oct 20');
});

test('parseExplorerQuery: defaults (Home layers, 8 weeks + this week), validation; cleanState keeps only known values', () => {
  assert.deepEqual(parseExplorerQuery({}, TODAY), { layers: ['sent', 'human_open_rate', 'reply_rate', 'visitors'], by: 'week', split: 'team', from: '2026-09-07', to: TODAY });
  assert.equal(parseExplorerQuery({ layers: 'sent,nope' }, TODAY).error, 'unknown layer nope');
  assert.equal(parseExplorerQuery({ by: 'month' }, TODAY).error, 'by must be week|day');
  assert.equal(parseExplorerQuery({ from: '2026-11-06' }, TODAY).error, 'from must not be after to');
  assert.equal(parseExplorerQuery({ from: '2025-01-01' }, TODAY).error, 'at most 400 days');
  assert.deepEqual(cleanState({ layers: ['visitors', 'x'], show: 'table', by: 'day', split: 'cohort', height: 'tall' }), { layers: ['visitors'], show: 'table', by: 'day', split: 'cohort', height: 'tall' });
  assert.deepEqual(cleanState({}).layers, ['sent', 'human_open_rate', 'visitors', 'reply_rate']);
});
