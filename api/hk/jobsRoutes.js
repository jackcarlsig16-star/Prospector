// hkos-daily-check-v1 J2 / J5 / J6 - the routes under /api/hk/:businessId/jobs (hkGate ran). Page load = any member
// (their own mailbox + the workspace daily-check); Run daily check now, Sync Gmail now and Send test digest = owner role;
// Today's read and the runs list = any member. No address in any response.
import { getSupabase, HkError, fail, isOwner, me } from './hkShared.js';
import { gmailSyncAll, dailyCheck, pageloadJob, todayPayload, testDigest, retryDraft, skipTouch, markDmSent, runRow } from './jobs/runner.js';

const JOBS = new Set(['gmail-sync-all', 'daily-check']);

// POST /jobs/pageload
export async function pageloadRoute(req, res, d = {}) {
  try { res.json(await pageloadJob({ businessId: req.params.businessId, userId: me(req), d })); } catch (e) { fail(res, e, 'jobs/pageload'); }
}

// POST /jobs/daily-check (owner) -> { run, counts, digest } | { skipped, run }
export async function dailyCheckRoute(req, res, d = {}) {
  const businessId = req.params.businessId;
  try {
    if (!isOwner(req)) throw new HkError(403, 'only an owner-role member can run the daily check');
    const out = await dailyCheck({ businessId, trigger: 'manual', startedBy: me(req), d });
    if (out.skipped) {
      const supabase = d.supabase || getSupabase();
      const { data } = await supabase.from('hk_job_runs').select('*').eq('business_id', businessId).eq('job', 'daily-check').order('started_at', { ascending: false }).limit(1);
      return res.json({ skipped: out.skipped, run: runRow(data?.[0] || null) });
    }
    res.json({ run: out.run, counts: out.counts, digest: out.digest });
  } catch (e) { fail(res, e, 'jobs/daily-check'); }
}

// POST /jobs/gmail-sync-all (owner)
export async function syncAllRoute(req, res, d = {}) {
  try {
    if (!isOwner(req)) throw new HkError(403, 'only an owner-role member can sync every mailbox');
    res.json(await gmailSyncAll({ businessId: req.params.businessId, trigger: 'manual', startedBy: me(req), d }));
  } catch (e) { fail(res, e, 'jobs/sync-all'); }
}

// GET /jobs/today
export async function todayRoute(req, res, d = {}) {
  try { res.json(await todayPayload({ businessId: req.params.businessId, d })); } catch (e) { fail(res, e, 'jobs/today'); }
}

// GET /jobs/runs?job=
export async function runsRoute(req, res, d = {}) {
  const supabase = d.supabase || getSupabase();
  try {
    let q = supabase.from('hk_job_runs').select('*').eq('business_id', req.params.businessId).order('started_at', { ascending: false }).limit(20);
    if (req.query?.job) { if (!JOBS.has(req.query.job)) throw new HkError(400, 'job must be gmail-sync-all or daily-check'); q = q.eq('job', req.query.job); }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    res.json({ runs: (data || []).map(runRow) });
  } catch (e) { fail(res, e, 'jobs/runs'); }
}

// POST /jobs/test-digest (owner)
export async function testDigestRoute(req, res, d = {}) {
  try {
    if (!isOwner(req)) throw new HkError(403, 'only an owner-role member can send a test digest');
    res.json(await testDigest({ businessId: req.params.businessId, d }));
  } catch (e) { fail(res, e, 'jobs/test-digest'); }
}

// POST /jobs/retry-draft { brand_id } (member)
export async function retryDraftRoute(req, res, d = {}) {
  try { if (!req.body?.brand_id) throw new HkError(400, 'brand_id is required'); res.json(await retryDraft({ businessId: req.params.businessId, brandId: String(req.body.brand_id), d })); } catch (e) { fail(res, e, 'jobs/retry-draft'); }
}

// POST /jobs/skip-touch { brand_id } (member)
export async function skipTouchRoute(req, res, d = {}) {
  try { if (!req.body?.brand_id) throw new HkError(400, 'brand_id is required'); res.json(await skipTouch({ businessId: req.params.businessId, brandId: String(req.body.brand_id), userId: me(req), d })); } catch (e) { fail(res, e, 'jobs/skip-touch'); }
}

// POST /drafts/:touchId/dm-sent (member)
export async function dmSentRoute(req, res, d = {}) {
  try { res.json(await markDmSent({ businessId: req.params.businessId, touchId: req.params.touchId, userId: me(req), d })); } catch (e) { fail(res, e, 'jobs/dm-sent'); }
}
