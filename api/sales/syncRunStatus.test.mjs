// node --test api/sales/syncRunStatus.test.mjs  (huddle-live-feed-v1 Stage 2)
import test from 'node:test';
import assert from 'node:assert/strict';
import { asReported, isDeadRun, STUCK_TEXT, finalStatus } from './syncRunStatus.js';

const NOW = Date.parse('2026-10-07T20:00:00Z');
const run = (minAgo, extra) => ({ status: 'running', started_at: new Date(NOW - minAgo * 60e3).toISOString(), finished_at: null, ...extra });

test('running over 30 min is reported failed; under 30 min stays running', () => {
  assert.equal(asReported(run(31), NOW).status, 'error');
  assert.equal(asReported(run(31), NOW).error_text, STUCK_TEXT);
  assert.equal(asReported(run(29), NOW).status, 'running');
  assert.equal(asReported(run(90, { status: 'success' }), NOW).status, 'success');
});

test('dead runs (stuck, stale lock, marked stuck) never count toward manual limits', () => {
  assert.equal(isDeadRun(run(31), NOW), true);
  assert.equal(isDeadRun(run(5, { status: 'error', error_text: 'stale lock' }), NOW), true);
  assert.equal(isDeadRun(run(5, { status: 'error', error_text: STUCK_TEXT }), NOW), true);
  assert.equal(isDeadRun(run(5), NOW), false, 'a fresh running sync still counts');
  assert.equal(isDeadRun(run(5, { status: 'error', error_text: 'apollo 500' }), NOW), false, 'a real failure that called Apollo still counts');
});

test('FIX loop-quickfixes Q5: every metrics adapter failed = error; some = partial; a cap stop = partial; none = success', () => {
  const adapterNames = ['sequences', 'accounts', 'prospects', 'mailboxes'];
  const all = Object.fromEntries(adapterNames.map(n => [n, 'apollo 500']));
  assert.equal(finalStatus({ adapterErrors: all, stoppedForCap: false, adapterNames }), 'error');
  assert.equal(finalStatus({ adapterErrors: { ...all, activity: 'x' }, stoppedForCap: true, adapterNames }), 'error');
  assert.equal(finalStatus({ adapterErrors: { sequences: 'x' }, stoppedForCap: false, adapterNames }), 'partial');
  assert.equal(finalStatus({ adapterErrors: { activity: 'call_cap' }, stoppedForCap: false, adapterNames }), 'partial');
  assert.equal(finalStatus({ adapterErrors: {}, stoppedForCap: true, adapterNames }), 'partial');
  assert.equal(finalStatus({ adapterErrors: {}, stoppedForCap: false, adapterNames }), 'success');
});
