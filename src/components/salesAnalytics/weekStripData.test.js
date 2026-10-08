import { rangeTotals, tileValues, sparkWeeks, buildStrip, formatDelta, compareRange } from './weekStripData';

// overview-home-v1 Stage 1: strip numbers are range sums of stored rows.
const row = (day, mailbox, delivered, hard_bounced, spam_blocked, opened, replied) => ({ day, mailbox, delivered, hard_bounced, spam_blocked, opened, clicked: 0, replied });
const data = {
  emailRows: [
    row('2026-09-29', 'a@x', 100, 2, 3, 10, 1), row('2026-09-29', 'b@x', 50, 0, 1, 5, 0), row('2026-10-02', 'a@x', 40, 1, 0, 4, 1),
    row('2026-10-06', 'a@x', 200, 4, 1, 15, 0), row('2026-10-07', 'b@x', 100, 0, 0, 5, 2),
  ],
  days: [
    { day: '2026-09-30', tracked_delivered: 20, tracked_opens: 10, tracked_bot_opens: 5, tracked_replies: 1, tracked_real_replies: 1, meetings: 0 },
    { day: '2026-10-06', tracked_delivered: 30, tracked_opens: 8, tracked_bot_opens: 2, tracked_replies: 2, tracked_real_replies: 1, meetings: 2 },
    { day: '2026-10-08', tracked_delivered: 0, tracked_opens: 0, tracked_bot_opens: 0, tracked_replies: 0, tracked_real_replies: 0, meetings: 1 },
  ],
  manualMeetings: [{ week_start: '2026-09-28', actual: 1 }, { week_start: '2026-10-05', actual: 4 }],
};
const thisWeek = { from: '2026-10-05', to: '2026-10-08' };
const lastWeek = { from: '2026-09-28', to: '2026-10-04' };

test('this week: sent = delivered + hard bounced + spam blocked; rates over the right denominators; human est from the tracked share', () => {
  const v = tileValues(rangeTotals(data, thisWeek.from, thisWeek.to));
  expect(v.sent).toBe(305);
  expect(v.delivered_rate).toBeCloseTo(300 / 305);
  expect(v.bounce_rate).toBeCloseTo(4 / 305);
  expect(v.spam_blocked).toBe(1);
  expect(v.open_rate).toBeCloseTo(20 / 300);
  expect(v.reply_rate).toBeCloseTo(2 / 300);
  expect(v.meetings).toBe(3);
  expect(v.detail.human_share).toBeCloseTo(0.75);
  expect(v.detail.human_open_rate).toBeCloseTo((20 / 300) * 0.75);
  expect(v.detail.tracked_real_replies).toBe(1);
  expect(v.detail.manual_meetings).toBe(4);
});

test('an empty range has null rates, zero counts and no manual meetings', () => {
  const v = tileValues(rangeTotals(data, '2026-08-03', '2026-08-09'));
  expect(v.sent).toBe(0);
  expect(v.open_rate).toBeNull();
  expect(v.detail.human_share).toBeNull();
  expect(v.detail.manual_meetings).toBeNull();
});

test('sparkline weeks: 8 LA Mondays ending with the week of `to`', () => {
  const weeks = sparkWeeks('2026-10-08');
  expect(weeks).toHaveLength(8);
  expect(weeks[0]).toBe('2026-08-17');
  expect(weeks[7]).toBe('2026-10-05');
});

test('buildStrip: deltas vs the previous period colored by goodDirection; off when compare is off', () => {
  const on = buildStrip(data, { period: thisWeek, prevPeriod: lastWeek, compareEnabled: true });
  const by = id => on.find(t => t.id === id);
  expect(by('sent').delta).toBe(305 - 197);
  expect(by('sent').deltaGood).toBe(true);
  expect(by('bounce_rate').delta).toBeCloseTo(4 / 305 - 3 / 197);
  expect(by('bounce_rate').deltaGood).toBe(true);
  expect(by('spam_blocked').delta).toBe(1 - 4);
  expect(by('spam_blocked').deltaGood).toBe(true);
  expect(by('meetings').delta).toBe(3);
  expect(by('sent').points.map(p => p.y).slice(-2)).toEqual([197, 305]);
  const off = buildStrip(data, { period: thisWeek, prevPeriod: lastWeek, compareEnabled: false });
  expect(off.every(t => t.delta === null && t.deltaGood === null)).toBe(true);
});

test('formatDelta: points for percents, counts for numbers', () => {
  expect(formatDelta(0.0123, 'percent')).toBe('▲ 1.2 pts');
  expect(formatDelta(-12, 'number')).toBe('▼ 12');
  expect(formatDelta(null, 'number')).toBe('—');
});

test('compareRange: this week compares to the same weekdays of last week; other presets keep the header window', () => {
  expect(compareRange({ from: '2026-10-05', to: '2026-10-08' }, { from: '2026-10-01', to: '2026-10-04' }, 'this_week')).toEqual({ from: '2026-09-28', to: '2026-10-01' });
  expect(compareRange({ from: '2026-09-28', to: '2026-10-04' }, { from: '2026-09-21', to: '2026-09-27' }, 'last_week')).toEqual({ from: '2026-09-21', to: '2026-09-27' });
});

test('a delta that rounds to 0.0 pts, or a count that did not move, is no change: delta 0, no direction', () => {
  const flat = { emailRows: [{ day: '2026-09-29', mailbox: 'a', delivered: 300, hard_bounced: 4, spam_blocked: 0, opened: 0, clicked: 0, replied: 2 }, { day: '2026-10-06', mailbox: 'a', delivered: 299, hard_bounced: 4, spam_blocked: 0, opened: 0, clicked: 0, replied: 2 }], days: [], manualMeetings: [] };
  const by = id => buildStrip(flat, { period: { from: '2026-10-05', to: '2026-10-08' }, prevPeriod: { from: '2026-09-28', to: '2026-10-01' }, compareEnabled: true }).find(t => t.id === id);
  expect(by('reply_rate').delta).toBe(0);
  expect(by('reply_rate').deltaGood).toBeNull();
  expect(by('meetings').delta).toBe(0);
  expect(by('meetings').deltaGood).toBeNull();
  expect(by('sent').delta).toBe(-1);
  expect(by('sent').deltaGood).toBe(false);
});
