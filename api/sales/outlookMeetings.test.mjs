import test from 'node:test';
import assert from 'node:assert/strict';
import { countOutlookMeetings } from './outlookMeetings.js';

// Week of Mon Oct 5 2026 (LA): starts 2026-10-05T07:00Z, ends 2026-10-12T07:00Z.
const WEEK = '2026-10-05', NOW = new Date('2026-10-09T12:00:00Z');
const domains = [{ goal_id: 'acme', domain: 'acme.com', confirmed: true }, { goal_id: 'beta', domain: 'beta.io', confirmed: true }];
let n = 0;
const ev = (domainsOf, over = {}) => ({ graph_id: `g${++n}`, ical_uid: over.ical_uid ?? `ical${n}`, external_domains: domainsOf, subject: 'Intro', start_at: '2026-10-07T17:00:00Z', end_at: '2026-10-07T17:30:00Z', is_cancelled: false, created_at_graph: '2026-10-06T09:00:00Z', ...over });

test('held = ended in the LA week and already over; booked = created in the week; same meeting on two calendars counts once', () => {
  const r = countOutlookMeetings({ weekStart: WEEK, now: NOW, domains, events: [
    ev(['acme.com'], { ical_uid: 'shared' }),
    ev(['acme.com'], { ical_uid: 'shared' }),
    ev(['beta.io'], { start_at: '2026-10-10T17:00:00Z', end_at: '2026-10-10T17:30:00Z', created_at_graph: '2026-09-30T09:00:00Z' }),
    ev(['beta.io'], { start_at: '2026-10-12T06:00:00Z', end_at: '2026-10-12T06:30:00Z', created_at_graph: '2026-10-11T23:30:00Z' }),
    ev(['acme.com'], { start_at: '2026-10-12T08:00:00Z', end_at: '2026-10-12T08:30:00Z', created_at_graph: '2026-10-12T07:30:00Z' }),
    ev(['acme.com'], { start_at: '2026-10-05T06:00:00Z', end_at: '2026-10-05T06:30:00Z', created_at_graph: '2026-10-04T09:00:00Z' }),
  ] });
  assert.equal(r.counts.held, 1, 'shared meeting once; Oct 10 future vs now; Oct 12 06:00Z is still Sun Oct 11 LA but in the future; Oct 12 08:00Z is next week; Oct 5 06:00Z is Sun Oct 4 LA');
  assert.equal(r.counts.booked, 2, 'shared once (Oct 6) + the one created Oct 11 23:30Z (Sun LA); Sep 30 and Oct 12 07:30Z (Mon next week) out; Oct 4 out');
  assert.deepEqual(r.held.map(h => [h.goal_id, h.domain, h.key]), [['acme', 'acme.com', 'shared']]);
  assert.deepEqual(r.booked.map(h => h.goal_id), ['acme', 'beta']);
});

test('never guessed: unmatched and ambiguous skipped, no contact-email fallback, cancelled count for neither, no created time -> never booked', () => {
  const r = countOutlookMeetings({ weekStart: WEEK, now: NOW, domains, events: [
    ev(['nowhere.org']),
    ev(['acme.com', 'beta.io']),
    ev(['acme.com'], { is_cancelled: true }),
    ev(['acme.com'], { created_at_graph: null }),
    { graph_id: 'x', ical_uid: null, external_domains: ['acme.com'], external_emails: ['amy@acme.com'], start_at: '2026-10-07T17:00:00Z', end_at: '2026-10-07T17:30:00Z', is_cancelled: false, created_at_graph: null },
  ] });
  assert.deepEqual(r.counts, { held: 2, booked: 0, cancelled: 1, ambiguous: 1, unmatched: 1, no_created_time: 2 });
  assert.equal(r.held[1].key, 'x', 'no iCalUId -> graph id is the key');
  const viaEmailOnly = countOutlookMeetings({ weekStart: WEEK, now: NOW, domains: [], events: [ev(['acme.com'])] });
  assert.equal(viaEmailOnly.counts.unmatched, 1);
});
