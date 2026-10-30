// hkos-daily-check-v1 J2 - the in-process cron runner. OFF unless process.env.HK_SCHEDULER === 'cron' (server.js checks
// before importing this file). One registration per workspace per job, { timezone, noOverlap: true } like the Sales
// Analytics block; every tick is a job run with trigger 'cron' and its own hk_job_runs row, so a tick that overlaps a
// page-load run loses to the DB guard, never doubles it. noOverlap is per process only: the row's cron_slot (unique)
// is what stops the same tick fired in two server processes from running twice.
import { getSupabase } from '../hkShared.js';
import { SETTINGS_DEFAULTS } from '../opsRoutes.js';
import { cronExprFor } from './plan.js';
import { gmailSyncAll, dailyCheck } from './runner.js';
import { researchSweep } from '../researchSweep.js';
import { intelSettings } from '../intelScore.js';

export const SYNC_EXPR = '0 7-22 * * *'; // hourly 07:00-22:00 in the workspace timezone
// grow-inbox-intel M2: once a day at hk_settings.intel.sweep.time (default 06:30), workspace timezone.
export const sweepExpr = intel => { const [h, m] = String(intelSettings(intel).sweep.time || '06:30').split(':').map(Number); return `${Number.isFinite(m) ? m : 30} ${Number.isFinite(h) ? h : 6} * * *`; };

// workspaces: [{ businessId, settings }] -> the registrations made. jobs is injectable for tests.
export function registerHkCron(cron, workspaces, { log = console.log, jobs = { gmailSyncAll, dailyCheck, researchSweep } } = {}) {
  const out = [];
  for (const { businessId, settings = {} } of workspaces) {
    const s = { ...SETTINGS_DEFAULTS, ...settings }, timezone = s.timezone || 'America/Chicago';
    const tick = (job, fn) => async () => {
      log(`[CRON] HumanKind ${job} ${businessId}`);
      try { const r = await fn({ businessId, trigger: 'cron' }); log(`[CRON] HumanKind ${job} ${businessId}:`, r.skipped ? `skipped (${r.skipped})` : `${r.run?.status} ${JSON.stringify(r.counts || {})}`); }
      catch (err) { log(`[CRON] HumanKind ${job} ${businessId} failed:`, err.message); }
    };
    for (const [job, expr, fn] of [['gmail-sync-all', SYNC_EXPR, jobs.gmailSyncAll], ['daily-check', cronExprFor(s), jobs.dailyCheck], ['research-sweep', sweepExpr(settings.intel), jobs.researchSweep]]) {
      cron.schedule(expr, tick(job, fn), { timezone, noOverlap: true });
      out.push({ businessId, job, expr, timezone });
    }
  }
  return out;
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

export const registerHkCronFromDb = async cron => registerHkCron(cron, await hkWorkspaces());
