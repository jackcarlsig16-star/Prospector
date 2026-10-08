// first-touch-people-v1 - people first-touched, next to partners first-touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { partnerWeekMetrics, peopleFirstTouchedInWeek } from './partnerMetrics.js';

// Wed Oct 7 2026, 1pm LA.
const NOW = Date.parse('2026-10-07T20:00:00Z');
const data = (partners, events, contacts = []) => {
  const undone = new Set(events.filter(e => e.event === 'undo').map(e => e.meta?.undid));
  const group = rows => { const m = new Map(); for (const r of rows) { if (!m.has(r.goal_id)) m.set(r.goal_id, []); m.get(r.goal_id).push(r); } return m; };
  return { partners, events, undone, byGoal: group([...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))), contactsByGoal: group(contacts) };
};
const partners = [
  { id: 'g1', name: 'BenefitHub', owner_user_id: 'jack', pipeline_status: 'first_email_sent', known_contacts: 'Sheet Only (champion)' },
  { id: 'g2', name: 'Domuso', owner_user_id: 'cyrus', pipeline_status: 'in_sequence', known_contacts: null },
];
const touch = (id, goal_id, names, at, extra = {}) => ({ id, goal_id, event: 'touch', touch_type: 'email', contact_names: names, at, source: 'manual', from_status: null, to_status: null, ...extra });

test('2 people on one partner on Sep 30 -> people 2, partners 1; the same person again Oct 1 -> still 1 person', () => {
  const d = data(partners, [
    touch('e1', 'g1', ['Lisa Park', 'Ken'], '2026-09-30T19:00:00Z', { from_status: 'not_started', to_status: 'first_email_sent' }),
    touch('e2', 'g1', ['lisa park'], '2026-10-01T19:00:00Z'),
  ]);
  const w = partnerWeekMetrics(d, '2026-09-28', null, NOW);
  assert.equal(w.people_first_touched.value, 2);
  assert.equal(w.partners_first_touched.value, 1);
  assert.equal(partnerWeekMetrics(d, '2026-10-05', null, NOW).people_first_touched.value, 0);
  assert.deepEqual(peopleFirstTouchedInWeek(d, '2026-09-28', null).map(p => [p.name, p.partner, p.source]), [['Ken', 'BenefitHub', 'logged'], ['Lisa Park', 'BenefitHub', 'logged']]);
});

test('an Apollo sequence start counts in its own week; an Apollo-written touch is tagged apollo; sheet-only names never count', () => {
  const d = data(partners, [touch('e1', 'g2', ['Auto Reply'], '2026-10-06T19:00:00Z', { source: 'apollo' })],
    [{ id: 'c1', goal_id: 'g2', name: 'Seq Person', source: 'apollo', sequence_added_at: '2026-08-27T15:00:00Z' }, { id: 'c2', goal_id: 'g2', name: 'Quiet', source: 'apollo', sequence_added_at: null }]);
  assert.deepEqual(peopleFirstTouchedInWeek(d, '2026-08-24', null).map(p => [p.name, p.source]), [['Seq Person', 'apollo']]);
  assert.deepEqual(peopleFirstTouchedInWeek(d, '2026-10-05', null).map(p => [p.name, p.source]), [['Auto Reply', 'apollo']]);
  // the Apollo-written email is a real touch for the partner too; the sequence start alone is not
  assert.equal(partnerWeekMetrics(d, '2026-10-05', null, NOW).partners_first_touched.value, 1);
  assert.equal(partnerWeekMetrics(d, '2026-08-24', null, NOW).partners_first_touched.value, 0);
  assert.equal(peopleFirstTouchedInWeek(d, '2026-09-28', null).length, 0);
});

test('owner filter follows the partner; an undone touch and an Event touch do not count', () => {
  const d = data(partners, [
    touch('e1', 'g1', ['Lisa Park'], '2026-10-05T19:00:00Z'),
    touch('e2', 'g2', ['Gone'], '2026-10-06T19:00:00Z'),
    { id: 'e3', goal_id: 'g2', event: 'undo', meta: { undid: 'e2' }, at: '2026-10-06T19:01:00Z' },
    touch('e4', 'g2', ['Booth'], '2026-10-06T20:00:00Z', { touch_type: 'event' }),
  ]);
  assert.equal(partnerWeekMetrics(d, '2026-10-05', 'jack', NOW).people_first_touched.value, 1);
  assert.equal(partnerWeekMetrics(d, '2026-10-05', 'cyrus', NOW).people_first_touched.value, 0);
  assert.equal(partnerWeekMetrics(d, '2026-10-05', null, NOW).people_first_touched.value, 1);
});
