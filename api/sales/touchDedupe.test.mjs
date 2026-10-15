// node --test api/sales/touchDedupe.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { touchDedupe } from './touchDedupe.js';

// Midday LA on Oct 12 2026 (PDT, UTC-7).
const OCT12 = '2026-10-12T19:00:00Z';
const events = [
  { event: 'touch', goal_id: 'p1', at: OCT12, contact_names: ['Pat Example'], touch_type: 'email', source: 'outlook' },
  { event: 'status', goal_id: 'p1', at: OCT12, contact_names: ['Status Only'] },
  { event: 'touch', goal_id: 'p2', at: OCT12, contact_names: [], touch_type: 'call', source: 'manual' },
];

test('a named touch a LA day either side is a hit, any case; two days off is not', () => {
  const d = touchDedupe(events);
  assert.deepEqual(d.prior('p1', 'pat example', null, '2026-10-13'), { source: 'outlook', date: '2026-10-12' });
  assert.deepEqual(d.prior('p1', 'Pat Example', null, '2026-10-11'), { source: 'outlook', date: '2026-10-12' });
  assert.equal(d.prior('p1', 'Pat Example', null, '2026-10-14'), null);
  assert.equal(d.prior('p2', 'Pat Example', null, '2026-10-12'), null);
  assert.equal(d.prior('p1', 'Status Only', null, '2026-10-12'), null);
});

test('the address counts as the contact when the name misses', () => {
  const d = touchDedupe([{ ...events[0], contact_names: ['pat@test-broker.example'] }]);
  assert.ok(d.prior('p1', 'Someone Else', 'PAT@test-broker.example', '2026-10-12'));
});

test('a nameless touch falls back to partner + touch_type in the same window', () => {
  const d = touchDedupe(events);
  assert.deepEqual(d.priorOfType('p2', 'call', '2026-10-13'), { source: 'manual', date: '2026-10-12' });
  assert.equal(d.priorOfType('p2', 'email', '2026-10-12'), null);
  assert.equal(d.priorOfType('p1', 'call', '2026-10-12'), null);
  assert.equal(d.priorOfType('p2', 'call', '2026-10-15'), null);
});
