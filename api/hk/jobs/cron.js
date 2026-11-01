// hkos-daily-check-v1 J2 - the in-process scheduler. OFF unless process.env.HK_SCHEDULER === 'cron' (server.js checks
// before importing this file). FIX hk-cron-minute-tick: node-cron 4.2.1 computes a next run that crosses a DST change
// as Jan 1 of the next year (measured Oct 31 2026), so a once-a-day job silently lost its first day after the change.
// Now ONE timer per process wakes every minute, reads each workspace's wall clock and runs every job whose pattern
// matches that minute. A job still running from an earlier minute is not started again (per process); the run row's
// cron_slot (unique) is what stops the same slot running twice across server processes.
import { getSupabase } from '../hkShared.js';
import { SETTINGS_DEFAULTS } from '../opsRoutes.js';
import { cronExprFor } from './plan.js';
import { gmailSyncAll, dailyCheck } from './runner.js';
import { researchSweep } from '../researchSweep.js';
import { readThreads } from '../threadRead.js';
import { intelSettings } from '../intelScore.js';

export const SYNC_EXPR = '0 7-22 * * *'; // hourly 07:00-22:00 in the workspace timezone
export const READ_EXPR = '30 7-22 * * *'; // grow-mailbox-link-v1 L5: half past, between the syncs
// grow-inbox-intel M2: once a day at hk_settings.intel.sweep.time (default 06:30), workspace timezone.
export const sweepExpr = intel => { const [h, m] = String(intelSettings(intel).sweep.time || '06:30').split(':').map(Number); return `${Number.isFinite(m) ? m : 30} ${Number.isFinite(h) ? h : 6} * * *`; };
const MINUTE = 60e3, CATCH_UP_MINUTES = 10;

const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
// The wall-clock minute in tz: { minute, hour, day, month, weekday (0 = Sunday) }.
export function wallMinute(date, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short', hourCycle: 'h23' }).formatToParts(date).map(x => [x.type, x.value]));
  return { minute: +p.minute, hour: +p.hour, day: +p.day, month: +p.month, weekday: WEEKDAY[p.weekday] };
}
// The five-field patterns this file writes: numbers, a-b ranges, comma lists and *.
const field = (spec, v) => spec.split(',').some(part => { if (part === '*') return true; const m = /^(\d+)(?:-(\d+))?$/.exec(part); return !!m && v >= +m[1] && v <= +(m[2] ?? m[1]); });
export function matchesMinute(expr, w) {
  const [mi, h, dom, mon, dow] = expr.trim().split(/\s+/);
  return field(mi, w.minute) && field(h, w.hour) && field(dom, w.day) && field(mon, w.month) && field(dow, w.weekday);
}

// workspaces: [{ businessId, settings }] -> [{ businessId, job, expr, timezone, fn }]. jobs is injectable for tests.
export function hkRegistrations(workspaces, { jobs = { gmailSyncAll, dailyCheck, researchSweep, readThreads } } = {}) {
  const out = [];
  for (const { businessId, settings = {} } of workspaces) {
    const s = { ...SETTINGS_DEFAULTS, ...settings }, timezone = s.timezone || 'America/Chicago';
    for (const [job, expr, fn] of [['gmail-sync-all', SYNC_EXPR, jobs.gmailSyncAll], ['daily-check', cronExprFor(s), jobs.dailyCheck], ['research-sweep', sweepExpr(settings.intel), jobs.researchSweep], ['thread-read', READ_EXPR, jobs.readThreads]]) out.push({ businessId, job, expr, timezone, fn });
  }
  return out;
}

export async function runTick(reg, log = console.log) {
  const { job, businessId, fn } = reg;
  log(`[CRON] HumanKind ${job} ${businessId}`);
  try { const r = await fn({ businessId, trigger: 'cron' }); log(`[CRON] HumanKind ${job} ${businessId}:`, r.skipped ? `skipped (${r.skipped})` : `${r.run?.status} ${JSON.stringify(r.counts || {})}`); }
  catch (err) { log(`[CRON] HumanKind ${job} ${businessId} failed:`, err.message); }
}

// Starts the minute timer. Each wake handles every whole minute since the last one it handled (at most
// CATCH_UP_MINUTES back, so a stalled event loop still runs a slot it slept through), then sleeps to the next minute.
// now / setTimer are injectable so tests can walk a clock across DST changes. -> { stop }
export function startMinuteTick(regs, { log = console.log, now = () => new Date(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const running = new Set();
  let last = Math.floor(now().getTime() / MINUTE) - 1, timer = null, stopped = false;
  const fire = reg => {
    const key = `${reg.businessId}|${reg.job}`;
    if (running.has(key)) { log(`[CRON] HumanKind ${reg.job} ${reg.businessId}: skipped (still running)`); return; }
    running.add(key);
    runTick(reg, log).finally(() => running.delete(key));
  };
  const wake = () => {
    if (stopped) return;
    const cur = Math.floor(now().getTime() / MINUTE);
    for (let m = Math.max(last + 1, cur - CATCH_UP_MINUTES + 1); m <= cur; m++) {
      const at = new Date(m * MINUTE);
      for (const reg of regs) if (matchesMinute(reg.expr, wallMinute(at, reg.timezone))) fire(reg);
    }
    last = Math.max(last, cur);
    timer = setTimer(wake, (cur + 1) * MINUTE - now().getTime() + 500);
  };
  wake();
  log(`[CRON] HumanKind minute tick active (pid ${process.pid}, instance ${process.env.RENDER_INSTANCE_ID || 'unset'}):`, JSON.stringify(regs.map(({ businessId, job, expr, timezone }) => ({ businessId, job, expr, timezone }))));
  return { stop() { stopped = true; if (timer) clearTimer(timer); } };
}

// Every workspace with hk_sales on, with its settings row. One today (HumanKind); the loop is the multi-workspace path.
export async function hkWorkspaces(supabase = getSupabase()) {
  const { data, error } = await supabase.from('businesses').select('id, features');
  if (error) throw new Error(error.message);
  const out = [];
  for (const b of (data || []).filter(x => x.features?.hk_sales === true)) {
    const { data: s } = await supabase.from('hk_settings').select('digest_time, digest_days, timezone, intel').eq('business_id', b.id).maybeSingle();
    out.push({ businessId: b.id, settings: s || {} });
  }
  return out;
}

export const startHkCronFromDb = async () => startMinuteTick(hkRegistrations(await hkWorkspaces()));
