import test from 'node:test';
import assert from 'node:assert/strict';
import { meetingEventsByDay } from './weekStripRoutes.js';

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
