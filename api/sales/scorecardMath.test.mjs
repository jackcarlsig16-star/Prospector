import test from 'node:test';
import assert from 'node:assert/strict';
import { humanShare, humanOpenRate, countExternalMeetings } from './scorecardMath.js';

// dashboard-v3 Stage 1 - the scorecard's redefined numbers, pure.
test('humanShare: the one bot rule (tracking service, generic linux, open within 60 s of delivery; Gmail proxy is human); no opens = null', () => {
  const deliveredAt = new Map([['m1', '2026-11-03T10:00:00Z'], ['m2', '2026-11-03T10:00:00Z']]);
  const opens = [
    { apollo_message_id: 'm1', occurred_at: '2026-11-03T10:00:20Z', user_agent: 'Mozilla', tracking_service: null }, // 20 s after delivery = bot
    { apollo_message_id: 'm1', occurred_at: '2026-11-03T12:00:00Z', user_agent: 'Mozilla', tracking_service: null }, // human
    { apollo_message_id: 'm2', occurred_at: '2026-11-03T10:00:05Z', user_agent: 'Gmail', tracking_service: null }, // Gmail proxy = human
    { apollo_message_id: 'm2', occurred_at: '2026-11-04T10:00:00Z', user_agent: 'generic linux', tracking_service: null }, // bot UA
    { apollo_message_id: 'm2', occurred_at: '2026-11-04T11:00:00Z', user_agent: 'Mozilla', tracking_service: 'proofpoint' }, // scanner
  ];
  assert.equal(humanShare(opens, deliveredAt), 2 / 5);
  assert.equal(humanShare([], deliveredAt), null);
});

test('humanOpenRate = Apollo open rate × human share; null without deliveries or without a share', () => {
  assert.equal(humanOpenRate({ delivered: 200, opened: 20, share: 0.5 }), 0.05);
  assert.equal(humanOpenRate({ delivered: 0, opened: 0, share: 0.5 }), null);
  assert.equal(humanOpenRate({ delivered: 200, opened: 20, share: null }), null);
});

test('countExternalMeetings: ≥ 1 external domain, booked (created) inside the week, dedup by iCalUId, cancelled and internal skipped, start when no created time; next = the next upcoming start', () => {
  const weekStartMs = Date.parse('2026-11-02T08:00:00Z'), weekEndMs = Date.parse('2026-11-09T08:00:00Z');
  const now = Date.parse('2026-11-05T20:00:00Z');
  const events = [
    { graph_id: 'a', ical_uid: 'u1', external_domains: ['acme.example'], start_at: '2026-11-04T15:00:00Z', created_at_graph: '2026-11-03T09:00:00Z', is_cancelled: false },
    { graph_id: 'b', ical_uid: 'u1', external_domains: ['acme.example'], start_at: '2026-11-04T15:00:00Z', created_at_graph: '2026-11-03T09:00:00Z', is_cancelled: false }, // same meeting, Cyrus's calendar
    { graph_id: 'c', ical_uid: 'u2', external_domains: [], start_at: '2026-11-04T16:00:00Z', created_at_graph: '2026-11-03T09:00:00Z', is_cancelled: false }, // internal
    { graph_id: 'd', ical_uid: 'u3', external_domains: ['hub.example'], start_at: '2026-11-09T20:30:00Z', created_at_graph: '2026-10-30T09:00:00Z', is_cancelled: false }, // booked last week, happens next week
    { graph_id: 'e', ical_uid: 'u4', external_domains: ['x.example'], start_at: '2026-11-06T10:00:00Z', created_at_graph: null, is_cancelled: false }, // no created time -> by start
    { graph_id: 'f', ical_uid: 'u5', external_domains: ['y.example'], start_at: '2026-11-05T10:00:00Z', created_at_graph: '2026-11-04T10:00:00Z', is_cancelled: true },
  ];
  const r = countExternalMeetings({ events, weekStartMs, weekEndMs, now });
  assert.equal(r.booked, 2);
  assert.equal(r.next_at, '2026-11-06T10:00:00.000Z');
  assert.deepEqual(countExternalMeetings({ events: [], weekStartMs, weekEndMs, now }), { booked: 0, next_at: null });
});
