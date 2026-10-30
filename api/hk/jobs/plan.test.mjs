// node --test api/hk/jobs/plan.test.mjs
// hkos-daily-check-v1 Stage 1 - the due planner on invented rows. 0 network, 0 DB, 0 Claude. Addresses appear only on
// contact fixtures and never in an item or a skip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dueFollowups, dueDms, planCounts, isQuietDay, isPastDigestTime, isDigestDay, ranToday, statsStale, cronExprFor, chicagoDay, dayIn } from './plan.js';

const NOW = new Date('2026-10-27T15:00:00Z'); // Tuesday 10:00 Chicago
const SAT = new Date('2026-10-31T15:00:00Z');
const SETTINGS = { bump_after_days: 5, dm_after_days: 9, final_after_days: 14, max_email_touches: 3, quiet_weekends: true, timezone: 'America/Chicago', digest_time: '07:30', digest_days: 'weekdays', stats_confirmed_at: null };
const daysAgo = n => new Date(NOW.getTime() - n * 86400e3).toISOString();
const brand = (id, over = {}) => ({ id, name: `Zz ${id}`, status: 'sent', relationship: 'prospect', owner_user_id: 'u-jack', owner_hint: null, owner_unclear: false, next_due_at: daysAgo(1), archived_at: null, challenge_idea: null, ...over });
const touch = (brand_id, kind, state, sentDaysAgo, over = {}) => ({ id: `t-${brand_id}-${kind}`, brand_id, channel: 'email', kind, state, sent_at: state === 'sent' ? daysAgo(sentDaysAgo) : null, drafted_at: daysAgo(sentDaysAgo), subject: `HumanKind x Zz ${brand_id} - idea`, gmail_thread_id: `th-${brand_id}`, challenge_concept: 'juice after the run', ...over });
const contact = (brand_id, email = 'ana@zz.invalid') => ({ id: `c-${brand_id}`, brand_id, email, is_primary: true });
const run = o => dueFollowups({ settings: SETTINGS, now: NOW, ...o });
const reasons = r => r.skipped.map(s => s.reason);
const hasAt = v => JSON.stringify(v).includes('@');

test('a cold sent 6 days ago with next_due_at in the past is due a bump, carrying the prior touch, thread, concept and contact presence only', () => {
  const r = run({ brands: [brand('a')], touches: [touch('a', 'cold', 'sent', 6)], contacts: [contact('a')] });
  assert.equal(r.quiet, false);
  assert.deepEqual(r.items, [{ brand_id: 'a', brand_name: 'Zz a', owner_user_id: 'u-jack', kind: 'bump', prior_touch_id: 't-a-cold', prior_subject: 'HumanKind x Zz a - idea', prior_thread_id: 'th-a', contact_id: 'c-a', has_email: true, challenge_concept: 'juice after the run' }]);
  assert.ok(!hasAt(r));
});

test('a logged outside Emailed (Log activity) after the cold does not move the sequence: the bump is still drafted on the cold', () => {
  const r = run({ brands: [brand('a')], touches: [touch('a', 'cold', 'sent', 6), touch('a', 'outside', 'sent', 1, { gmail_thread_id: null, subject: 'Emailed' })], contacts: [contact('a')] });
  assert.deepEqual(r.items.map(i => [i.kind, i.prior_touch_id, i.prior_thread_id]), [['bump', 't-a-cold', 'th-a']]);
  assert.deepEqual(r.skipped, []);
});

test('not due yet: next_due_at in the future, or the days not elapsed even when next_due_at says so', () => {
  assert.deepEqual(reasons(run({ brands: [brand('a', { next_due_at: new Date(NOW.getTime() + 2 * 86400e3).toISOString() })], touches: [touch('a', 'cold', 'sent', 3)] })), ['not_due']);
  assert.deepEqual(reasons(run({ brands: [brand('a')], touches: [touch('a', 'cold', 'sent', 3)] })), ['days_not_elapsed']);
  assert.deepEqual(reasons(run({ brands: [brand('a', { next_due_at: null })], touches: [touch('a', 'cold', 'sent', 9)] })), ['no_due_date']);
});

test('after a bump (status bumped) the final is due once final_after_days - bump_after_days have passed; a final is never followed', () => {
  const bumped = brand('b', { status: 'bumped' });
  const t = [touch('b', 'cold', 'sent', 16), touch('b', 'bump', 'sent', 10)];
  assert.equal(run({ brands: [bumped], touches: t }).items[0]?.kind, 'final');
  assert.deepEqual(reasons(run({ brands: [bumped], touches: [touch('b', 'cold', 'sent', 12), touch('b', 'bump', 'sent', 6)] })), ['days_not_elapsed']);
  const done = brand('c', { status: 'final_sent' });
  const r = run({ brands: [done], touches: [touch('c', 'cold', 'sent', 30), touch('c', 'bump', 'sent', 20), touch('c', 'final', 'sent', 10)] });
  assert.deepEqual(r.items, []); assert.deepEqual(reasons(r), ['final_done']);
  const stillBumped = brand('d', { status: 'bumped' });
  assert.deepEqual(reasons(run({ brands: [stillBumped], touches: [touch('d', 'cold', 'sent', 40), touch('d', 'bump', 'sent', 30), touch('d', 'final', 'sent', 20)] })), ['final_done'], 'the last sent kind decides, not the status');
});

test('a reply since the last sent touch stops the sequence', () => {
  const r = run({ brands: [brand('a')], touches: [touch('a', 'cold', 'sent', 6)], replies: [{ id: 'r1', brand_id: 'a', received_at: daysAgo(2) }] });
  assert.deepEqual(r.items, []); assert.deepEqual(reasons(r), ['replied']);
  const old = run({ brands: [brand('a')], touches: [touch('a', 'cold', 'sent', 6)], replies: [{ id: 'r0', brand_id: 'a', received_at: daysAgo(20) }] });
  assert.equal(old.items.length, 1, 'a reply before the cold went out does not count');
});

test('a drafted touch of that kind already waiting in Gmail -> skip (never a duplicate draft)', () => {
  const r = run({ brands: [brand('a')], touches: [touch('a', 'cold', 'sent', 6), touch('a', 'bump', 'drafted', 1, { gmail_draft_id: 'd-a' })] });
  assert.deepEqual(r.items, []); assert.deepEqual(reasons(r), ['draft_exists']);
  assert.equal(run({ brands: [brand('a')], touches: [touch('a', 'cold', 'sent', 6), touch('a', 'bump', 'discarded', 1)] }).items.length, 1, 'a discarded one does not block');
});

test('owner rules: owner_hint only (Pete not signed in) -> owner_missing; no owner at all -> unowned', () => {
  assert.deepEqual(reasons(run({ brands: [brand('a', { owner_user_id: null, owner_hint: 'pete' })], touches: [touch('a', 'cold', 'sent', 6)] })), ['owner_missing']);
  assert.deepEqual(reasons(run({ brands: [brand('a', { owner_user_id: null })], touches: [touch('a', 'cold', 'sent', 6)] })), ['unowned']);
});

test('blocked: sponsor / founding partner / do-not-contact never get a follow-up; canContact blocks on max touches and passed', () => {
  for (const rel of ['sponsor', 'founding_partner', 'do_not_contact']) assert.deepEqual(reasons(run({ brands: [brand('a', { relationship: rel })], touches: [touch('a', 'cold', 'sent', 6)] })), ['not_prospect'], rel);
  assert.deepEqual(reasons(run({ brands: [brand('a', { status: 'bumped' })], touches: [touch('a', 'cold', 'sent', 16), touch('a', 'bump', 'sent', 10)], maxEmailTouches: 2 })), ['blocked:max_touches']);
  assert.deepEqual(run({ brands: [brand('a', { status: 'passed' }), brand('b', { status: 'candidate' }), brand('c', { status: 'replied' })], touches: [touch('a', 'cold', 'sent', 6), touch('c', 'cold', 'sent', 6)] }).items, []);
  assert.deepEqual(reasons(run({ brands: [brand('a', { status: 'bumped', owner_unclear: true })], touches: [touch('a', 'cold', 'sent', 16), touch('a', 'bump', 'sent', 10)] })), ['blocked:owner_unclear']);
});

test('quiet weekends: nothing is due on a Saturday unless quiet_weekends is off', () => {
  const r = run({ brands: [brand('a')], touches: [touch('a', 'cold', 'sent', 6)], now: SAT });
  assert.equal(r.quiet, true); assert.deepEqual(r.items, []); assert.deepEqual(reasons(r), ['quiet_weekend']);
  assert.equal(run({ brands: [brand('a')], touches: [touch('a', 'cold', 'sent', 6)], now: SAT, settings: { ...SETTINGS, quiet_weekends: false } }).items.length, 1);
  assert.equal(isQuietDay(SAT, SETTINGS), true); assert.equal(isQuietDay(NOW, SETTINGS), false); assert.equal(isQuietDay(SAT, { ...SETTINGS, quiet_weekends: false }), false);
});

test('a brand with no contact email is still due (the runner makes it a "no contact" item); an archived brand is ignored', () => {
  const r = run({ brands: [brand('a'), brand('z', { archived_at: daysAgo(1) })], touches: [touch('a', 'cold', 'sent', 6), touch('z', 'cold', 'sent', 6)], contacts: [{ id: 'c-a', brand_id: 'a', email: null, is_primary: true }] });
  assert.deepEqual(r.items.map(i => [i.brand_id, i.has_email, i.contact_id]), [['a', false, null]]);
});

test('DMs: a cold sent dm_after_days ago with no reply and no Instagram DM yet -> DM text due; an existing DM or a reply stops it', () => {
  const b = brand('a');
  assert.deepEqual(dueDms({ brands: [b], touches: [touch('a', 'cold', 'sent', 10)], settings: SETTINGS, now: NOW }).items, [{ brand_id: 'a', brand_name: 'Zz a', owner_user_id: 'u-jack', kind: 'dm_text', domain: null }]);
  assert.deepEqual(dueDms({ brands: [b], touches: [touch('a', 'cold', 'sent', 5)], settings: SETTINGS, now: NOW }).items, []);
  const dm = dueDms({ brands: [b], touches: [touch('a', 'cold', 'sent', 10), { id: 'dm', brand_id: 'a', channel: 'ig_dm', kind: 'dm_text', state: 'drafted' }], settings: SETTINGS, now: NOW });
  assert.deepEqual(dm.items, []); assert.deepEqual(dm.skipped.map(s => s.reason), ['dm_exists']);
  assert.deepEqual(dueDms({ brands: [b], touches: [touch('a', 'cold', 'sent', 10)], replies: [{ brand_id: 'a', received_at: daysAgo(1) }], settings: SETTINGS, now: NOW }).skipped.map(s => s.reason), ['replied']);
  assert.equal(dueDms({ brands: [b], touches: [touch('a', 'cold', 'sent', 10)], settings: SETTINGS, now: SAT }).quiet, true);
  assert.deepEqual(dueDms({ brands: [brand('s', { relationship: 'sponsor' })], touches: [touch('s', 'cold', 'sent', 10)], settings: SETTINGS, now: NOW }).items, []);
});

test('stats staleness: never confirmed or older than 14 days -> stale', () => {
  assert.equal(statsStale({ stats_confirmed_at: null }, NOW), true);
  assert.equal(statsStale({ stats_confirmed_at: daysAgo(3) }, NOW), false);
  assert.equal(statsStale({ stats_confirmed_at: daysAgo(20) }, NOW), true);
});

test('clock helpers: Chicago day, past digest time, digest days, ran today (an error day frees the guard), cron expression', () => {
  assert.equal(chicagoDay(new Date('2026-10-28T03:30:00Z')), '2026-10-27', '22:30 Chicago is still the 27th');
  assert.equal(dayIn(new Date('2026-10-28T03:30:00Z'), 'UTC'), '2026-10-28');
  assert.equal(isPastDigestTime(NOW, SETTINGS), true);
  assert.equal(isPastDigestTime(new Date('2026-10-27T12:00:00Z'), SETTINGS), false, '07:00 Chicago is before 07:30');
  assert.equal(isPastDigestTime(new Date('2026-10-27T12:30:00Z'), SETTINGS), true);
  assert.equal(isDigestDay(NOW, SETTINGS), true); assert.equal(isDigestDay(SAT, SETTINGS), false); assert.equal(isDigestDay(SAT, { ...SETTINGS, digest_days: 'daily' }), true);
  assert.equal(ranToday([{ status: 'ok', chicago_day: '2026-10-27' }], NOW, SETTINGS), true);
  assert.equal(ranToday([{ status: 'error', chicago_day: '2026-10-27' }], NOW, SETTINGS), false);
  assert.equal(ranToday([{ status: 'ok', chicago_day: '2026-10-26' }], NOW, SETTINGS), false);
  assert.equal(ranToday([{ status: 'running', started_at: '2026-10-27T13:00:00Z' }], NOW, SETTINGS), true);
  assert.equal(cronExprFor(SETTINGS), '30 7 * * 1-5'); assert.equal(cronExprFor({ digest_time: '06:05', digest_days: 'daily' }), '5 6 * * *');
});

test('planCounts: numbers only, reasons tallied', () => {
  const follow = run({ brands: [brand('a'), brand('b', { owner_user_id: null, owner_hint: 'pete' })], touches: [touch('a', 'cold', 'sent', 6), touch('b', 'cold', 'sent', 6)], contacts: [contact('a')] });
  const dms = dueDms({ brands: [brand('a')], touches: [touch('a', 'cold', 'sent', 10)], settings: SETTINGS, now: NOW });
  assert.deepEqual(planCounts(follow, dms), { due_bump: 1, due_final: 0, due_dm: 1, without_contact: 0, quiet: false, skipped: { owner_missing: 1 } });
  assert.ok(!hasAt(planCounts(follow, dms)));
});
