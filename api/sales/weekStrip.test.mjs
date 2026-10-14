import test from 'node:test';
import assert from 'node:assert/strict';
import { meetingEventsByDay, weekStripCounts } from './weekStripRoutes.js';

// overview-home-v1 Stage 1: a meeting counts once, on the LA day of the event
// that moved the partner into Meeting; undone moves and undo rows do not.
test('meetings per day: status and touch moves into meeting_set, minus undone', () => {
  const events = [
    { id: '1', event: 'status', from_status: 'replied', to_status: 'meeting_set', at: '2026-10-06T19:00:00Z' },
    { id: '2', event: 'touch', from_status: 'in_sequence', to_status: 'meeting_set', at: '2026-10-07T03:00:00Z' }, // Oct 6, 8pm LA
    { id: '3', event: 'status', from_status: 'replied', to_status: 'meeting_set', at: '2026-10-08T19:00:00Z' },
    { id: '4', event: 'undo', from_status: 'meeting_set', to_status: 'replied', at: '2026-10-08T19:30:00Z', meta: { undid: '3' } },
    { id: '5', event: 'touch', from_status: 'meeting_set', to_status: 'meeting_set', at: '2026-10-08T20:00:00Z' },
    { id: '6', event: 'status', from_status: 'meeting_set', to_status: 'proposal_pilot', at: '2026-10-08T21:00:00Z' },
  ];
  assert.deepEqual([...meetingEventsByDay(events)], [['2026-10-06', 2]]);
});

// weekly-plan-v1: the counting loop is a pure function so the planner reads
// last week the same way the strip does.
test('week strip counts: per LA day and per sender, auto-replies and bot opens split out, nothing before from', () => {
  const out = weekStripCounts({
    from: '2026-10-05',
    delivered: [
      { apollo_message_id: 'm0', sender: 'jack@x.ai', delivered_at: '2026-10-04T18:00:00Z' },
      { apollo_message_id: 'm1', sender: 'jack@x.ai', delivered_at: '2026-10-05T18:00:00Z' },
      { apollo_message_id: 'm2', sender: 'cyrus@x.ai', delivered_at: '2026-10-06T02:00:00Z' }, // Oct 5, 7pm LA
    ],
    opens: [{ apollo_message_id: 'm1', sender: 'jack@x.ai', occurred_at: '2026-10-05T18:00:05Z' }],
    replies: [
      { sender: 'jack@x.ai', reply_class: 'willing_to_meet', replied_at: '2026-10-06T17:00:00Z' },
      { sender: 'jack@x.ai', reply_class: 'out_of_office', replied_seen_at: '2026-10-06T18:00:00Z' },
    ],
    events: [{ id: 'e1', event: 'status', from_status: 'replied', to_status: 'meeting_set', at: '2026-10-06T19:00:00Z' }],
    deliveredAt: new Map([['m1', '2026-10-05T18:00:00Z']]),
  });
  assert.deepEqual(out.days, [
    { day: '2026-10-05', tracked_delivered: 2, tracked_opens: 1, tracked_bot_opens: 1, tracked_replies: 0, tracked_real_replies: 0, meetings: 0 },
    { day: '2026-10-06', tracked_delivered: 0, tracked_opens: 0, tracked_bot_opens: 0, tracked_replies: 2, tracked_real_replies: 1, meetings: 1 },
  ]);
  assert.deepEqual(out.senders.map(s => [s.day, s.sender, s.tracked_delivered, s.tracked_real_replies]), [
    ['2026-10-05', 'cyrus@x.ai', 1, 0], ['2026-10-05', 'jack@x.ai', 1, 0], ['2026-10-06', 'jack@x.ai', 0, 1],
  ]);
});
