// node --test api/hk/syncRules.test.mjs
// hkos-gmail-connect-v1 Stage 1 - the sync classifier over invented metadata (example.invalid domains). 0 network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, nextDueAt, statusAfterSend, counts, NEW_THREAD_SCAN_MAX } from './syncRules.js';

const OWN = ['humankindcollective.app', 'humankind.test'];
const touch = (over = {}) => ({ id: 't1', brand_id: 'b1', kind: 'cold', gmail_thread_id: 'th1', gmail_message_id: '<draft-1@mail>', gmail_draft_id: 'd1', state: 'drafted', ...over });
const msg = (over = {}) => ({ id: 'm1', threadId: 'th1', labelIds: ['SENT'], messageIdHeader: '<sent-1@mail>', from: { name: 'Jack', email: 'jack@humankind.test', domain: 'humankind.test' }, date: '2026-10-26T18:00:00Z', snippet: 'hello', ...over });
const SETTINGS = { bump_after_days: 5, final_after_days: 14 };

test('a: a SENT message on a tracked thread with a new Message-ID and the draft gone = sent; status by kind', () => {
  const c = classify({ touches: [touch()], messages: [msg()], drafts: [], ownDomains: OWN });
  assert.equal(c.sent.length, 1); assert.deepEqual([c.sent[0].touch.id, c.sent[0].status, c.sent[0].sent_at], ['t1', 'sent', '2026-10-26T18:00:00Z']);
  assert.equal(classify({ touches: [touch({ kind: 'bump' })], messages: [msg()], ownDomains: OWN }).sent[0].status, 'bumped');
  assert.equal(classify({ touches: [touch({ kind: 'final' })], messages: [msg()], ownDomains: OWN }).sent[0].status, 'final_sent');
});

test('a: the draft still present in users.drafts.list is NOT a send; the draft\'s own Message-ID is NOT a send', () => {
  assert.equal(classify({ touches: [touch()], messages: [msg()], drafts: [{ id: 'd1' }], ownDomains: OWN }).sent.length, 0);
  assert.equal(classify({ touches: [touch()], messages: [msg({ messageIdHeader: '<draft-1@mail>' })], drafts: [], ownDomains: OWN }).sent.length, 0);
  assert.equal(classify({ touches: [touch({ state: 'sent' })], messages: [msg()], ownDomains: OWN }).sent.length, 0, 'already sent touches stay sent');
});

test('b: an inbound message on a tracked thread from a foreign domain is a reply; own-domain mail on the thread is ignored; duplicates once', () => {
  const inbound = msg({ id: 'm2', labelIds: ['INBOX'], from: { name: 'Sam', email: 'sam@brand.invalid', domain: 'brand.invalid' }, messageIdHeader: '<r1@brand>' });
  const c = classify({ touches: [touch({ state: 'sent' })], messages: [inbound, inbound, msg({ id: 'm3', labelIds: ['INBOX'], from: { name: 'Pete', email: 'pete@humankindcollective.app', domain: 'humankindcollective.app' } })], ownDomains: OWN });
  assert.equal(c.replies.length, 1); assert.deepEqual([c.replies[0].brand_id, c.replies[0].touch.id], ['b1', 't1']);
  assert.equal(c.ignored, 1, 'own-domain mail ignored');
  assert.equal(classify({ touches: [touch({ state: 'sent' })], replies: [{ gmail_message_id: 'm2' }], messages: [inbound], ownDomains: OWN }).replies.length, 0, 'already stored');
});

test('c: an untracked INBOX thread from a tracked brand domain is a new thread; only on a small delta; never from own or unknown domains', () => {
  const m = msg({ id: 'm9', threadId: 'th-new', labelIds: ['INBOX'], from: { name: 'Lee', email: 'lee@brand.invalid', domain: 'brand.invalid' } });
  const brands = { 'brand.invalid': 'b1' };
  const c = classify({ touches: [], messages: [m], brandsByDomain: brands, ownDomains: OWN });
  assert.deepEqual([c.newThreads.length, c.newThreads[0].brand_id, c.skippedNewThreadScan], [1, 'b1', false]);
  const big = classify({ touches: [], messages: [m], brandsByDomain: brands, ownDomains: OWN, historyEvents: NEW_THREAD_SCAN_MAX + 1 });
  assert.deepEqual([big.newThreads.length, big.skippedNewThreadScan, big.ignored], [0, true, 1]);
  assert.equal(classify({ touches: [], messages: [m], brandsByDomain: {}, ownDomains: OWN }).newThreads.length, 0, 'unknown domain');
  assert.equal(classify({ touches: [], messages: [msg({ id: 'm10', threadId: 'th-x', labelIds: ['INBOX'], from: { domain: 'humankind.test' } })], brandsByDomain: { 'humankind.test': 'b9' }, ownDomains: OWN }).newThreads.length, 0, 'own domain never a new thread');
  assert.equal(classify({ touches: [], messages: [msg({ id: 'm11', threadId: 'th-y', labelIds: ['SENT'], from: { domain: 'brand.invalid' } })], brandsByDomain: brands, ownDomains: OWN }).newThreads.length, 0, 'sent mail is not a new inbound thread');
});

test('d: everything else is ignored and counted; discarded touches do not track their thread', () => {
  const c = classify({ touches: [touch({ state: 'discarded' })], messages: [msg(), msg({ id: 'm5', threadId: 'other', labelIds: ['INBOX'], from: { domain: 'random.invalid' } })], ownDomains: OWN });
  assert.deepEqual([c.sent.length, c.replies.length, c.newThreads.length, c.ignored], [0, 0, 0, 2]);
});

test('next due: cold = sent + bump days, bump = sent + (final - bump) days, final = none; settings drive the numbers', () => {
  assert.equal(nextDueAt('cold', '2026-10-26T18:00:00Z', SETTINGS), '2026-10-31T18:00:00.000Z');
  assert.equal(nextDueAt('bump', '2026-10-26T18:00:00Z', SETTINGS), '2026-11-04T18:00:00.000Z');
  assert.equal(nextDueAt('final', '2026-10-26T18:00:00Z', SETTINGS), null);
  assert.equal(nextDueAt('cold', '2026-10-26T18:00:00Z', { bump_after_days: 3, final_after_days: 10 }), '2026-10-29T18:00:00.000Z');
  assert.equal(nextDueAt('cold', '2026-10-26T18:00:00Z'), '2026-10-31T18:00:00.000Z', 'defaults 5 / 14');
  assert.deepEqual(['cold', 'bump', 'final', 'reply'].map(statusAfterSend), ['sent', 'bumped', 'final_sent', null]);
});

test('counts are numbers only', () => {
  const c = classify({ touches: [touch()], messages: [msg()], ownDomains: OWN, historyEvents: 7 });
  const k = counts(c, { labels_called: 2 });
  assert.deepEqual(k, { history_events: 7, sent_detected: 1, replies: 0, new_threads: 0, skipped: 0, labels_called: 2 });
  assert.ok(!JSON.stringify(k).includes('@'));
});
