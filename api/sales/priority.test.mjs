import test from 'node:test';
import assert from 'node:assert/strict';
import { itemUrgency, BANDS, BAND_ORDER } from './priority.js';

// actions-v2 REV2 A2 - the band per kind (audit §D: U1 now · U2 today · U3 this week · U4 housekeeping).
const T = '2026-10-23';

test('bands in order: now, today, this week, housekeeping', () => {
  assert.deepEqual(BANDS.map(b => b[0]), ['now', 'today', 'week', 'housekeeping']);
  assert.ok(BAND_ORDER.now < BAND_ORDER.today && BAND_ORDER.week < BAND_ORDER.housekeeping);
});

test('Now: replies (Apollo reply_task, campaign reply), overdue waiting, fresh flags, anything overdue', () => {
  assert.equal(itemUrgency('tidy', { tidy_kind: 'reply_task' }), 'now');
  assert.equal(itemUrgency('campaign', { campaign_action: 'reply' }), 'now');
  assert.equal(itemUrgency('waiting', { overdue: true }), 'now');
  assert.equal(itemUrgency('waiting', {}), 'now');
  assert.equal(itemUrgency('flag', { flag_age_days: 2 }), 'now');
  assert.equal(itemUrgency('todo', { overdue: true, due_date: '2026-10-20', today: T }), 'now');
  assert.equal(itemUrgency('campaign', { campaign_action: 'send', overdue: true }), 'now');
});

test('Today: interest follow-up, visited-no-touch, stale follow-up, nudge, campaign sends, Focus 5, to-dos due today', () => {
  for (const k of ['interest_follow_up', 'visited_no_touch', 'follow_up', 'nudge']) assert.equal(itemUrgency('tidy', { tidy_kind: k }), 'today', k);
  assert.equal(itemUrgency('campaign', { campaign_action: 'send' }), 'today');
  assert.equal(itemUrgency('focus', {}), 'today');
  assert.equal(itemUrgency('todo', { due_date: T, today: T }), 'today');
});

test('This week: website + Scout signals, research or drop, check co-owner, to-dos due later', () => {
  assert.equal(itemUrgency('signal', { source: 'web_visit' }), 'week');
  assert.equal(itemUrgency('signal', { source: 'scout' }), 'week');
  assert.equal(itemUrgency('tidy', { tidy_kind: 'research_or_drop' }), 'week');
  assert.equal(itemUrgency('tidy', { tidy_kind: 'check_co_owner' }), 'week');
  assert.equal(itemUrgency('todo', { due_date: '2026-10-24', today: T }), 'week');
  assert.equal(itemUrgency('todo', { due_date: '2026-11-03', today: T }), 'week');
});

test('Housekeeping: set a date, duplicate, flag going cold, undated to-dos, flags 5+ days old, unknown kinds', () => {
  for (const k of ['set_a_date', 'duplicate', 'flag_cold', 'something_new']) assert.equal(itemUrgency('tidy', { tidy_kind: k }), 'housekeeping', k);
  assert.equal(itemUrgency('todo', { due_date: null, today: T }), 'housekeeping');
  assert.equal(itemUrgency('flag', { flag_age_days: 5 }), 'housekeeping');
  assert.equal(itemUrgency('mystery', {}), 'housekeeping');
});
