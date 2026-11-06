import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSequenceSteps } from './sequenceSteps.js';
import { buildEmailPulse, mailboxTiles, weekdaysIn, CAP_WARN } from './pulseMath.js';
import { headcountLine } from './attentionRoutes.js';
import { nameMailboxes } from './trendRoutes.js';

// dashboard-v3 Stage 4 - the Sequences table's per-step rows, the email Pulse, the mailbox tiles, the headcount line.
const row = (sequence_id, step, mailbox, over = {}) => ({ day: '2026-11-03', sequence_id, step, mailbox, delivered: 10, hard_bounced: 1, spam_blocked: 0, opened: 2, replied: 1, ...over });
const rows = [
  row('s1', 1, 'a@x', { delivered: 100, hard_bounced: 4, spam_blocked: 1, opened: 20, replied: 2 }), row('s1', 1, 'a@x', { day: '2026-11-04', delivered: 50, hard_bounced: 0, opened: 5, replied: 0 }),
  row('s1', 2, 'a@x', { delivered: 60, hard_bounced: 2, opened: 6, replied: 0 }), row('s1', 3, 'a@x', { delivered: 20, hard_bounced: 0, opened: 1, replied: 1 }),
  row('s2', 1, 'b@x', { delivered: 30 }), row('s2', 1, 'brad@elsewhere', { delivered: 5 }),
  row('', 0, 'a@x', { delivered: 40 }),
];
const owned = new Set(['a@x', 'b@x']);
const labels = new Map([['a@x', 'Jack'], ['b@x', 'Cyrus']]);

test('buildSequenceSteps: per-step sums over every day = the lifetime totals; rates per step; a sequence sent from a foreign mailbox is not own; the no-sequence rows are skipped', () => {
  const r = buildSequenceSteps(rows, { owned, labels });
  const s1 = r.sequences.s1;
  assert.equal(s1.own, true); assert.equal(s1.sender_label, 'Jack'); assert.deepEqual(s1.mailboxes, ['Jack']);
  assert.deepEqual(s1.steps.map(s => [s.step, s.messages, s.delivered, s.opened, s.replied]), [[1, 155, 150, 25, 2], [2, 62, 60, 6, 0], [3, 20, 20, 1, 1]]);
  assert.equal(s1.steps[0].open_rate, 25 / 150); assert.equal(s1.steps[0].bounce_rate, 5 / 155); assert.equal(s1.steps[2].reply_rate, 1 / 20);
  // per-step sums = lifetime: every stored row of s1 is in exactly one step
  const lifetime = rows.filter(x => x.sequence_id === 's1').reduce((n, x) => n + x.delivered, 0);
  assert.equal(s1.steps.reduce((n, s) => n + s.delivered, 0), lifetime); assert.equal(s1.delivered, lifetime); assert.equal(s1.messages, 237);
  assert.equal(r.sequences.s2.own, false); // brad@elsewhere sent part of it
  assert.equal(r.sequences.s2.sender_label, 'Cyrus'); assert.deepEqual(r.sequences.s2.mailboxes, ['Cyrus', 'Mailbox']);
  assert.equal(r.sequences[''], undefined);
  assert.deepEqual(r.totals, { messages: 237, delivered: 230 }); // own only
  assert.ok(!JSON.stringify(r).includes('@'), 'no address in the payload');
});

test('mailboxTiles + weekdaysIn: sends per weekday against the cap, ≥ 95 % = at capacity, 0 = idle, a connection problem = reconnect; sorted by name', () => {
  assert.equal(weekdaysIn('2026-11-02', '2026-11-05'), 4); assert.equal(weekdaysIn('2026-10-26', '2026-11-01'), 5);
  const counts = [
    ...Array.from({ length: 4 }, (_, i) => row('s1', 1, 'a@x', { day: `2026-11-0${2 + i}`, delivered: 48, hard_bounced: 0 })), // 192 over 4 weekdays = 48 / day
    row('s2', 1, 'b@x', { day: '2026-11-03', delivered: 30, spam_blocked: 2 }),
  ];
  const tiles = mailboxTiles(counts, [{ key: 'mailbox:jack', email: 'a@x', label: 'Jack', cap: 50, problem: null }, { key: 'mailbox:cyrus', email: 'b@x', label: 'Cyrus', cap: null, problem: null }, { key: 'mailbox:mailbox-1', email: 'c@x', label: 'Mailbox 1', cap: 50, problem: null }, { key: 'mailbox:seif', email: 'd@x', label: 'Seif', cap: 50, problem: 'Needs re-auth' }], '2026-11-02', '2026-11-05');
  assert.deepEqual(tiles.map(t => [t.label, t.sent, t.status, t.per_weekday, t.cap]), [['Cyrus', 33, 'healthy', 33 / 4, 50], ['Jack', 192, 'at_capacity', 48, 50], ['Mailbox 1', 0, 'idle', 0, 50], ['Seif', 0, 'reconnect', 0, 50]]);
  assert.equal(CAP_WARN, 0.95);
  assert.equal(tiles[0].spam_rate, 2 / 33); assert.equal(tiles[1].delivered_rate, 1);
});

test('buildEmailPulse: this week compares to the same weekdays of last week; hard bounce and spam are better down; mailbox tiles and the spam top mailbox ride along', () => {
  const counts = [
    row('s1', 1, 'a@x', { day: '2026-10-26', delivered: 100, hard_bounced: 2, spam_blocked: 1 }), row('s1', 1, 'a@x', { day: '2026-10-30', delivered: 60, hard_bounced: 0, spam_blocked: 0 }), // Fri of last week: outside the same-weekday compare
    row('s1', 1, 'a@x', { day: '2026-11-02', delivered: 80, hard_bounced: 1, spam_blocked: 0 }), row('s2', 1, 'b@x', { day: '2026-11-04', delivered: 40, hard_bounced: 0, spam_blocked: 3 }),
  ];
  const p = buildEmailPulse({ period: 'this_week', today: '2026-11-05', now: Date.parse('2026-11-05T20:00:00Z'), counts, mailboxes: [{ key: 'mailbox:jack', email: 'a@x', label: 'Jack', cap: 50, problem: null }, { key: 'mailbox:cyrus', email: 'b@x', label: 'Cyrus', cap: 50, problem: null }] });
  assert.deepEqual([p.from, p.to, p.prev], ['2026-11-02', '2026-11-05', { from: '2026-10-26', to: '2026-10-29' }]);
  assert.deepEqual([p.metrics.sent.value, p.metrics.sent.prev, p.metrics.sent.delta], [124, 103, 21]); // prev = Oct 26-29 only (the Friday row is out)
  assert.equal(p.metrics.sent.series[3], 163); // the sparkline still shows the whole previous week
  assert.equal(p.metrics.hard_bounce_rate.better, 'down'); assert.equal(p.metrics.spam_blocks.better, 'down');
  assert.equal(p.metrics.spam_blocks.value, 3); assert.equal(p.metrics.spam_blocks.top_mailbox, 'Cyrus');
  assert.equal(p.metrics.sent.mailboxes, 2); assert.equal(p.metrics.sent.delivered, 120);
  assert.equal(p.mailboxes.length, 2); assert.equal(p.mailboxes[1].label, 'Jack'); assert.equal(p.mailboxes[1].sent, 81);
  const m = buildEmailPulse({ period: 'month', today: '2026-11-05', now: Date.parse('2026-11-05T20:00:00Z'), counts, mailboxes: [] });
  assert.deepEqual(m.prev, { from: '2026-10-01', to: '2026-10-31' }); assert.equal(m.metrics.sent.prev, 163);
});

test('headcountLine carries the count of sequenced companies without a headcount', () => {
  const l = headcountLine({ visitor_filters: { headcount: { last_line: 'filled 3' } } }, 0, 500, 140);
  assert.equal(l.missing_headcount, 140); assert.equal(l.status, 'ok'); assert.equal(l.line, 'filled 3');
  assert.equal(headcountLine({}, 0, 500).missing_headcount, null);
});

test('nameMailboxes: every text field and affected label says the owner, never the address; scope_key keeps the dismissal key', () => {
  const labels = new Map([['cyrus@x', 'Cyrus'], ['jack@x', 'Jack']]);
  const [r] = nameMailboxes([{ id: 'R6', scope_key: 'cyrus@x', severity: 'warn', title: 'cyrus@x: at capacity', evidence: '49.8 sent per weekday', cause: 'c', action: 'Reconnect jack@x then sync', affected: [{ type: 'mailbox', id: 'cyrus@x', label: 'cyrus@x' }] }], labels);
  assert.equal(r.title, 'Cyrus: at capacity'); assert.equal(r.action, 'Reconnect Jack then sync'); assert.equal(r.affected[0].label, 'Cyrus'); assert.equal(r.scope_key, 'cyrus@x');
  assert.ok(!/@/.test(JSON.stringify({ ...r, scope_key: null, affected: r.affected.map(a => ({ ...a, id: null })) })));
});
