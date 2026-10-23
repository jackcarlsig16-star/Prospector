import test from 'node:test';
import assert from 'node:assert/strict';
import { pageloadSkip, PAGELOAD_FRESH_HOURS } from './sync.js';

// FIX people-apollo-visibility-v1 F3b - the daily first-load sync's guards (runs = non-test, newest first).
const NOW = Date.parse('2026-10-23T16:00:00Z'); // 9:00 LA
const h = n => new Date(NOW - n * 3600e3).toISOString();
const run = (trigger, status, hoursAgo, extra = {}) => ({ trigger, status, started_at: h(hoursAgo), finished_at: status === 'running' ? null : h(hoursAgo - 0.02), error_text: null, ...extra });

test('runs when the last good sync is older than 20 h and nothing ran today or in the last 10 min', () => {
  assert.equal(pageloadSkip([run('manual', 'success', 30)], NOW), null);
  assert.equal(pageloadSkip([], NOW), null);
  assert.equal(PAGELOAD_FRESH_HOURS, 20);
});

test('skips: already ran today (a failed one may retry), fresh sync, cooldown', () => {
  assert.equal(pageloadSkip([run('pageload', 'success', 2), run('manual', 'success', 30)], NOW), 'already ran today');
  assert.equal(pageloadSkip([run('pageload', 'running', 0.05)], NOW), 'already ran today');
  assert.equal(pageloadSkip([run('pageload', 'error', 2, { error_text: 'Apollo 500' }), run('manual', 'success', 30)], NOW), null, 'a failed page-load run retries');
  assert.equal(pageloadSkip([run('manual', 'partial', 19)], NOW), `synced under ${PAGELOAD_FRESH_HOURS} h ago`);
  assert.equal(pageloadSkip([run('manual', 'error', 0.1, { error_text: 'Apollo 500' }), run('manual', 'success', 30)], NOW), 'another sync started in the last 10 min');
  // A page-load run from yesterday (LA) doesn't count as today.
  assert.equal(pageloadSkip([run('pageload', 'success', 21)], NOW), null);
});

test('a dead run (stale lock) is ignored by every guard', () => {
  assert.equal(pageloadSkip([run('pageload', 'error', 0.1, { error_text: 'stale lock' }), run('cron', 'success', 40)], NOW), null);
});
