// node --test api/sales/syncRunStatus.test.mjs  (huddle-live-feed-v1 Stage 2)
import test from 'node:test';
import assert from 'node:assert/strict';
import { asReported, isDeadRun, STUCK_TEXT } from './syncRunStatus.js';

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
