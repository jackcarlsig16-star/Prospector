// node --test api/hk/jobs/cron.test.mjs - FIX hk-cron-minute-tick: the minute tick walked minute by minute across both
// US DST changes (Nov 1 2026, Mar 14 2027) with a fake clock fires every expected slot exactly once - none skipped,
// none doubled. 0 network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { wallMinute, matchesMinute, hkRegistrations, startMinuteTick } from './cron.js';

const TZ = 'America/Chicago';
const wallKey = d => { const w = wallMinute(d, TZ), day = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d); return `${day} ${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`; };

// Runs the real tick over [fromIso, toIso) with an injected clock; returns { job: [wall times fired] }.
async function walk(fromIso, toIso, { stallAt = null } = {}) {
  let t = Date.parse(fromIso), pending = null;
  const fired = {};
  const rec = job => async () => { (fired[job] ||= []).push(wallKey(new Date(t))); return { skipped: 'test' }; };
  const regs = hkRegistrations([{ businessId: 'hk', settings: { digest_time: '07:30', digest_days: 'weekdays', timezone: TZ } }], { jobs: { gmailSyncAll: rec('sync'), dailyCheck: rec('daily'), researchSweep: rec('sweep') } });
  const tick = startMinuteTick(regs, { log: () => {}, now: () => new Date(t), setTimer: (fn, ms) => { pending = { fn, at: t + ms }; return 1; }, clearTimer: () => {} });
  while (pending && pending.at < Date.parse(toIso)) {
    const p = pending; pending = null;
    t = stallAt && p.at > Date.parse(stallAt) && t < Date.parse(stallAt) ? p.at + 4 * 60e3 : p.at; // a 4-minute event-loop stall
    p.fn();
    await new Promise(r => setImmediate(r));
  }
  tick.stop();
  return fired;
}
const days = (from, n) => Array.from({ length: n }, (_, i) => new Date(Date.parse(from) + i * 864e5 + 12 * 36e5)).map(d => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d));
const expected = (dayList, weekdays) => ({
  sync: dayList.flatMap(d => Array.from({ length: 16 }, (_, i) => `${d} ${String(7 + i).padStart(2, '0')}:00`)),
  daily: dayList.filter(d => weekdays.includes(d)).map(d => `${d} 07:30`),
  sweep: dayList.map(d => `${d} 06:30`),
});

test('matcher: numbers, ranges, lists, * against the wall clock (weekday 0 = Sunday)', () => {
  const w = wallMinute(new Date('2026-11-02T13:30:00Z'), TZ); // Mon 7:30 CST
  assert.deepEqual(w, { minute: 30, hour: 7, day: 2, month: 11, weekday: 1 });
  assert.ok(matchesMinute('30 7 * * 1-5', w)); assert.ok(!matchesMinute('30 7 * * 0,6', w)); assert.ok(matchesMinute('*/x 7 * * *', w) === false);
  assert.ok(matchesMinute('0,30 6-8 2 11 *', w));
});

test('Nov 1 2026 (DST ends): Sat Oct 31 -> Tue Nov 3, every sync hour 07-22, the 06:30 sweep each day and the 07:30 weekday daily check fire exactly once', async () => {
  const fired = await walk('2026-10-31T05:00:00Z', '2026-11-04T06:00:00Z'); // Sat 00:00 CDT -> Wed 00:00 CST
  const dayList = ['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'];
  const exp = expected(dayList, ['2026-11-02', '2026-11-03']);
  for (const job of ['sync', 'daily', 'sweep']) assert.deepEqual(fired[job], exp[job], job);
  assert.ok(fired.sweep.includes('2026-11-01 06:30'), 'the Sunday sweep node-cron 4.2.1 lost');
});

test('Mar 14 2027 (DST starts): Sat Mar 13 -> Tue Mar 16, same: every slot once, none skipped, none doubled', async () => {
  const fired = await walk('2027-03-13T06:00:00Z', '2027-03-17T05:00:00Z');
  const exp = expected(days('2027-03-13T06:00:00Z', 4), ['2027-03-15', '2027-03-16']);
  for (const job of ['sync', 'daily', 'sweep']) assert.deepEqual(fired[job], exp[job], job);
});

test('a stalled event loop catches up the slot it slept through (once), never twice', async () => {
  const fired = await walk('2026-11-02T12:00:00Z', '2026-11-02T15:00:00Z', { stallAt: '2026-11-02T13:28:30Z' }); // Mon 06:00-09:00 CST, stall over 07:30
  assert.deepEqual(fired.daily, ['2026-11-02 07:33']);
  assert.deepEqual(fired.sync, ['2026-11-02 07:00', '2026-11-02 08:00']);
});
