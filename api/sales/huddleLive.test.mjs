// node --test api/sales/huddleLive.test.mjs  (huddle-live-feed-v1)
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLiveRows, matchesFilter } from './huddleLive.js';

// Wed Oct 7 2026, 1pm LA.
const NOW = Date.parse('2026-10-07T20:00:00Z');
const D = '2026-10-05T15:00:00Z'; // delivered Mon 8am LA
const after = s => new Date(Date.parse(D) + s * 1000).toISOString();
const prospect = (id, extra) => ({ contact_id: id, name: `P ${id}`, company: `Co ${id}`, owner: 'jack', status: 'new', ...extra });
const msg = (id, contact, extra) => ({ apollo_message_id: id, contact_id: contact, sequence_id: 's1', step: 1, delivered_at: D, replied: false, ...extra });
const ev = (id, msgId, contact, event, at, extra) => ({ id, apollo_message_id: msgId, contact_id: contact, event, occurred_at: at, step: null, user_agent: null, tracking_service: null, ...extra });
const base = extra => ({ prospects: [], messages: [], events: [], flags: [], members: [{ user_id: 'u-cy', name: 'Cyrus K' }], statusEvents: [], seqById: new Map([['s1', { id: 's1', name: 'Car Rental' }]]), oppById: new Map(), now: NOW, ...extra });

test('one row per person, real opens counted from events, bot opens and scanner clicks excluded', () => {
  const rows = buildLiveRows(base({
    prospects: [prospect('a'), prospect('b'), prospect('c')],
    messages: [msg('m1', 'a'), msg('m2', 'a', { step: 2, delivered_at: '2026-10-06T15:00:00Z' }), msg('m3', 'b'), msg('m4', 'c')],
    events: [
      ev(1, 'm1', 'a', 'open', after(30)), // bot: within 60s
      ev(2, 'm1', 'a', 'open', '2026-10-05T18:00:00Z'),
      ev(3, 'm2', 'a', 'open', '2026-10-07T13:08:00Z'),
      ev(4, 'm2', 'a', 'click', '2026-10-07T13:10:00Z'),
      ev(5, 'm3', 'b', 'open', '2026-10-06T18:00:00Z', { tracking_service: 'apple' }), // bot
      ev(6, 'm3', 'b', 'click', after(90)), // scanner
    ],
  }));
  assert.equal(rows.length, 2, 'c has no activity - no row');
  const [a, b] = rows;
  assert.equal(a.contact_id, 'a');
  assert.equal(a.real_opens, 2); assert.equal(a.bot_opens, 1); assert.equal(a.human_clicks, 1);
  assert.equal(a.last_activity_at, '2026-10-07T13:10:00Z'); assert.equal(a.last_activity_kind, 'click');
  assert.equal(a.step, 2); assert.equal(a.sequence.name, 'Car Rental'); assert.equal(a.sent, 2);
  assert.equal(a.open_steps, 'steps 1–2');
  assert.match(a.insight, /^Opened 2× since Mon, across steps 1–2 · clicked once$/);
  assert.equal(a.next_step.id, 'follow_up_clicked');
  assert.equal(b.bot_only, true); assert.equal(b.real_opens, 0); assert.equal(b.scanner_clicks, 1);
  assert.match(b.insight, /automated/);
});

test('reply wins: newest-first by reply seen time, handled when flagged or contacted after the reply', () => {
  const rows = buildLiveRows(base({
    prospects: [prospect('a'), prospect('r', { owner: 'cyrus' })],
    messages: [msg('m1', 'a'), msg('m9', 'r', { replied: true, reply_class: 'willing_to_meet', replied_seen_at: '2026-10-07T13:08:00Z' })],
    events: [ev(1, 'm1', 'a', 'open', '2026-10-07T12:00:00Z')],
    statusEvents: [{ contact_id: 'r', changed_at: '2026-10-06T10:00:00Z' }],
  }));
  assert.deepEqual(rows.map(r => r.contact_id), ['r', 'a']);
  const r = rows[0];
  assert.equal(r.replied, true); assert.equal(r.handled, false, 'contacted before the reply does not count');
  assert.equal(r.next_step.label, 'Book meeting');
  assert.match(r.insight, /^Replied \(willing to meet\) — seen today 6:08 am at sync · not yet handled$/);
  // Stage 4a: an exact Outlook time replaces the sync time and drops the label.
  const exact = buildLiveRows(base({ prospects: [prospect('r')], messages: [msg('m9', 'r', { replied: true, reply_class: 'willing_to_meet', replied_seen_at: '2026-10-07T13:08:00Z', replied_at: '2026-10-07T09:45:00Z' })] }))[0];
  assert.equal(exact.reply_seen_at, '2026-10-07T09:45:00Z'); assert.equal(exact.reply_exact, true);
  assert.match(exact.insight, /^Replied \(willing to meet\) — replied today 2:45 am · not yet handled$/);
  assert.deepEqual(exact.timeline.filter(t => t.kind === 'reply').map(t => [t.at, t.seen_at_sync]), [['2026-10-07T09:45:00Z', false]]);
  const flagged = buildLiveRows(base({ prospects: [prospect('r')], messages: [msg('m9', 'r', { replied: true, replied_seen_at: '2026-10-07T13:08:00Z' })], flags: [{ id: 'g1', owner_user_id: 'u-cy', prospect_contact_id: 'r' }] }))[0];
  assert.equal(flagged.handled, true); assert.deepEqual(flagged.flag, { goal_id: 'g1', owner_user_id: 'u-cy', owner_name: 'Cyrus K' });
});

test('filters: since-window drill rule, opened 2+, flagged to me', () => {
  const rows = buildLiveRows(base({
    prospects: [prospect('a'), prospect('b'), prospect('f')],
    messages: [msg('m1', 'a'), msg('m2', 'b'), msg('m3', 'f')],
    events: [
      ev(1, 'm1', 'a', 'open', '2026-10-05T18:00:00Z'), ev(2, 'm1', 'a', 'open', '2026-10-07T18:00:00Z'),
      ev(3, 'm2', 'b', 'open', '2026-10-05T18:00:00Z'), ev(4, 'm2', 'b', 'open', '2026-10-05T19:00:00Z'), ev(5, 'm2', 'b', 'click', '2026-10-05T19:05:00Z'),
      ev(6, 'm3', 'f', 'open', '2026-10-07T18:00:00Z'),
    ],
    flags: [{ id: 'g1', owner_user_id: 'u-cy', prospect_contact_id: 'f' }],
  }));
  const since = '2026-10-07T00:00:00Z';
  const pick = (f, o) => rows.filter(r => matchesFilter(r, f, o)).map(r => r.contact_id).sort();
  assert.deepEqual(pick('opened2', {}), ['a', 'b']);
  assert.deepEqual(pick('opened2', { sinceIso: since }), ['a'], 'b opened twice but not since');
  assert.deepEqual(pick('clicked', {}), ['b']);
  assert.deepEqual(pick('clicked', { sinceIso: since }), []);
  assert.deepEqual(pick('flagged_me', { userId: 'u-cy' }), ['f']);
  assert.deepEqual(pick('flagged_me', { userId: 'u-jack' }), []);
  const f = rows.find(r => r.contact_id === 'f');
  assert.equal(f.insight, 'Opened once, on step 1');
});

test('closed = unsubscribed or a not-interested/unsubscribe reply; other replies stay open', () => {
  const rows = buildLiveRows(base({
    prospects: [prospect('u', { email_unsubscribed: true }), prospect('n'), prospect('w')],
    messages: [msg('m1', 'u'), msg('m2', 'n', { replied: true, reply_class: 'not_interested', replied_seen_at: '2026-10-06T18:00:00Z' }), msg('m3', 'w', { replied: true, reply_class: 'willing_to_meet', replied_seen_at: '2026-10-06T19:00:00Z' })],
    events: [ev(1, 'm1', 'u', 'open', '2026-10-06T20:00:00Z')],
  }));
  assert.deepEqual(Object.fromEntries(rows.map(r => [r.contact_id, r.closed])), { u: true, n: true, w: false });
});

test('subject line: on each sent item and on the row (the latest activity\'s message)', () => {
  const [r] = buildLiveRows(base({
    prospects: [prospect('s')],
    messages: [msg('m1', 's', { subject: 'Step one subject' }), msg('m2', 's', { step: 2, delivered_at: '2026-10-06T15:00:00Z', subject: 'Re: step two' })],
    events: [ev(1, 'm2', 's', 'open', '2026-10-07T13:00:00Z')],
  }));
  assert.equal(r.subject, 'Re: step two');
  assert.deepEqual(r.timeline.filter(t => t.kind === 'sent').map(t => t.subject), ['Re: step two', 'Step one subject']);
});

test('P5: Not a fit, Booked and Not now are closed (kept, flagged); snoozed = Not now until snooze_until passes; status labels; heat_7d', () => {
  const rows = buildLiveRows(base({
    prospects: [prospect('a', { status: 'dead' }), prospect('b', { status: 'not_now', snooze_until: '2026-10-08' }), prospect('c', { status: 'not_now', snooze_until: '2026-10-07' }), prospect('d', { status: 'not_now', snooze_until: null }), prospect('e', { status: 'booked' }), prospect('f', { status: 'claimed' })],
    messages: [msg('m1', 'a'), msg('m2', 'b'), msg('m3', 'c'), msg('m4', 'd'), msg('m5', 'e'), msg('m6', 'f')],
    events: [...['a', 'b', 'c', 'd', 'e', 'f'].map((c, i) => ev(i + 1, `m${i + 1}`, c, 'open', '2026-10-06T18:00:00Z')), ev(9, 'm6', 'f', 'click', '2026-09-20T18:00:00Z'), ev(10, 'm6', 'f', 'open', after(10))],
  }));
  assert.deepEqual(rows.map(r => r.contact_id), ['a', 'b', 'c', 'd', 'e', 'f'], 'closed and snoozed rows stay in the build (the route drops them unless show_closed)');
  const by = Object.fromEntries(rows.map(r => [r.contact_id, r]));
  assert.deepEqual(Object.fromEntries(rows.map(r => [r.contact_id, r.closed])), { a: true, b: true, c: true, d: true, e: true, f: false });
  assert.deepEqual(Object.fromEntries(rows.map(r => [r.contact_id, r.snoozed])), { a: false, b: true, c: false, d: true, e: false, f: false }, 'b until tomorrow and d with no date are snoozed; c passed today');
  assert.deepEqual(Object.fromEntries(rows.map(r => [r.contact_id, r.status_label])), { a: 'Not a fit', b: 'Not now', c: 'Not now', d: 'Not now', e: 'Booked', f: 'Active' });
  assert.deepEqual([by.a.not_a_fit, by.a.real_opens, by.b.snooze_until], [true, 1, '2026-10-08'], 'opens still count');
  assert.equal(by.f.heat_7d, 1, 'the click 17 days ago and the bot open do not count; the real open on Oct 6 does');
});

test('Restore puts back the status before Not a fit (newest dead event), else new', () => {
  const rows = buildLiveRows(base({
    prospects: [prospect('a', { status: 'dead' }), prospect('b', { status: 'dead' }), prospect('c', { status: 'dead' }), prospect('d')],
    messages: ['a', 'b', 'c', 'd'].map((c, i) => msg(`m${i}`, c)),
    events: ['a', 'b', 'c', 'd'].map((c, i) => ev(i + 1, `m${i}`, c, 'open', '2026-10-06T18:00:00Z')),
    deadEvents: [
      { id: 1, contact_id: 'a', from_value: 'new', changed_at: '2026-10-01T00:00:00Z' },
      { id: 2, contact_id: 'a', from_value: 'contacted', changed_at: '2026-10-05T00:00:00Z' },
      { id: 3, contact_id: 'b', from_value: 'dead', changed_at: '2026-10-05T00:00:00Z' },
    ],
  }));
  assert.deepEqual(rows.map(r => [r.contact_id, r.restore_status]), [['a', 'contacted'], ['b', 'new'], ['c', 'new'], ['d', null]]);
});
