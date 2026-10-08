import { createClient } from '@supabase/supabase-js';
import { laDateString } from './laDate.js';
import { CallCapError } from './apolloClient.js';
import { resolveSenders } from './senderLookup.js';
import * as sequences from './adapters/sequences.js';
import * as accounts from './adapters/accounts.js';
import * as prospects from './adapters/prospects.js';
import * as mailboxes from './adapters/mailboxes.js';
import { syncActivity, ACTIVITY_MAX_CALLS } from './activitySync.js';
import { refreshRecentWeeks, EMAIL_COUNTS_MAX_CALLS } from './emailCounts.js';
import { isDeadRun } from './syncRunStatus.js';

// PROPOSED values (SPEC) - sized from real counts in the audit (21
// sequences, 314 accounts, 9 active sequences, 2 mailboxes), confirmed at
// Stage 0 to come to ~7 real calls per run at the real max per_page of 100.
export const MAX_APOLLO_CALLS_PER_RUN = 50;
const STALE_LOCK_MINUTES = 15;
const MANUAL_COOLDOWN_MINUTES = 10;
const MANUAL_MAX_PER_DAY = 6;
const RETENTION_DAYS = 180;

function chunkRows(rows, size) {
  const chunks = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}

// Order matters: sequences must run first. accounts.js and prospects.js
// both read ctx.sequenceCohortById / ctx.activeSequenceIds, which this
// file derives from the sequences adapter's own output right after it
// returns - not true adapter independence, documented here since it's the
// one real exception to "the array is the only place adapters are listed".
const ADAPTERS = [sequences, accounts, prospects, mailboxes];

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// Guardrail 5 - refuse to start if a 'running' row is younger than 15
// minutes; mark an older one 'error'/'stale lock' and proceed. Runs before
// the manual cooldown/day-cap check so a genuinely stuck run always wins
// the refusal message.
async function checkConcurrencyLock(supabase, businessId) {
  const { data: runningRows } = await supabase
    .from('sales_sync_runs')
    .select('id, started_at')
    .eq('business_id', businessId)
    .eq('status', 'running');

  for (const row of runningRows || []) {
    const ageMinutes = (Date.now() - new Date(row.started_at).getTime()) / 60000;
    if (ageMinutes < STALE_LOCK_MINUTES) {
      return { locked: true, reason: 'a sync is already running for this business' };
    }
    await supabase
      .from('sales_sync_runs')
      .update({ status: 'error', error_text: 'stale lock', finished_at: new Date().toISOString() })
      .eq('id', row.id);
  }
  return { locked: false };
}

// Guardrail 6 - 10-minute cooldown + 6/LA-day max, enforced server-side
// only, manual trigger only. A 36h lookback window is used instead of
// computing an exact LA-midnight UTC boundary (no date library - avoids
// DST-offset arithmetic entirely); the actual day match is a plain string
// compare via laDateString() on each row.
async function checkManualLimits(supabase, businessId) {
  const lookbackIso = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
  const { data } = await supabase
    .from('sales_sync_runs')
    .select('id, started_at, status, error_text')
    .eq('business_id', businessId)
    .eq('trigger', 'manual')
    .gte('started_at', lookbackIso)
    .order('started_at', { ascending: false });

  const rows = (data || []).filter(r => !isDeadRun(r));
  const mostRecent = rows[0];
  if (mostRecent) {
    const minutesSince = (Date.now() - new Date(mostRecent.started_at).getTime()) / 60000;
    if (minutesSince < MANUAL_COOLDOWN_MINUTES) {
      return { refused: true, reason: `manual sync cooldown active - try again in ${Math.ceil(MANUAL_COOLDOWN_MINUTES - minutesSince)} min` };
    }
  }

  const today = laDateString();
  const todaysCount = rows.filter(r => laDateString(new Date(r.started_at)) === today).length;
  if (todaysCount >= MANUAL_MAX_PER_DAY) {
    return { refused: true, reason: `manual sync daily max reached (${MANUAL_MAX_PER_DAY}/day)` };
  }
  return { refused: false };
}

// trigger is 'cron' (the scheduled job), 'manual' (the Sync now button,
// via routes.js - subject to the cooldown/daily cap below), or 'test' (a
// real verification run, called directly the same way this function is
// always called - never through the HTTP route). 'test' is intentionally
// exempt from checkManualLimits() below since it isn't 'manual', and
// routes.js's runsRoute excludes it from what the UI shows as "last
// synced". A run's trigger is never rewritten after insert - if a run was
// mislabeled, it's disclosed and left as-is, not silently corrected.
//
// maxCalls is test-only - every real caller (routes.js and the cron job)
// omits it and gets the real MAX_APOLLO_CALLS_PER_RUN. Exists so the
// call-cap guardrail can be exercised for real without touching the real
// default (Stage 2 verification: "MAX set to 2 stops the run at exactly 2
// calls").
export async function runSync({ businessId, trigger, maxCalls }) {
  const supabase = getSupabase();

  const lock = await checkConcurrencyLock(supabase, businessId);
  if (lock.locked) return { refused: true, reason: lock.reason };

  if (trigger === 'manual') {
    const limits = await checkManualLimits(supabase, businessId);
    if (limits.refused) return { refused: true, reason: limits.reason };
  }

  const { data: run, error: insertErr } = await supabase
    .from('sales_sync_runs')
    .insert({ business_id: businessId, trigger })
    .select()
    .single();
  if (insertErr) return { refused: false, error: insertErr.message };

  const ctx = { callCounter: { count: 0, max: maxCalls || MAX_APOLLO_CALLS_PER_RUN }, endpointCounts: {} };
  const metricDate = laDateString();
  const missingAll = [];
  const adapterErrors = {};
  let stoppedForCap = false;
  let apolloMs = 0;
  let supabaseMs = 0;
  let senderLookupCount = 0;
  let accountNames = null;

  for (const adapter of ADAPTERS) {
    try {
      const apolloStart = Date.now();
      const records = await adapter.fetchRecords(ctx);
      apolloMs += Date.now() - apolloStart;

      if (adapter.name === 'sequences') {
        ctx.sequenceCohortById = {};
        ctx.activeSequenceIds = [];
        for (const r of records) {
          ctx.sequenceCohortById[r.id] = r.cohort;
          if (r.active) ctx.activeSequenceIds.push(r.id);
        }

        // dashboard-v2 - sender lookup runs right after sequences, inside
        // the same try block, so a CallCapError from it is handled by the
        // same catch below exactly like every other Apollo call in this
        // loop (stops the whole run, not just this step).
        const senderResult = await resolveSenders({
          ctx, businessId, activeSequenceIds: ctx.activeSequenceIds, supabase,
        });
        senderLookupCount += senderResult.lookupCalls;
        if (senderResult.unresolved.length) {
          missingAll.push(...senderResult.unresolved.map(id => `sender lookup: ${id} unresolved`));
        }
      }

      if (adapter.name === 'accounts') accountNames = new Map(records.map(r => [r.id, r.name]));

      const { rows, missing } = adapter.toMetrics(records, metricDate, ctx);
      missingAll.push(...(missing || []));

      const supabaseStart = Date.now();

      // Raw snapshot - guardrail 10: only the fields each adapter's own
      // fetchRecords already trimmed down to, never a full Apollo payload.
      await supabase.from('sales_raw_snapshots').insert({
        business_id: businessId,
        run_id: run.id,
        entity: adapter.name,
        payload: records,
      });

      // Idempotent per-LA-date upsert, batched: one request per chunk of
      // <=500 rows (real root cause of a 112s run that made only 2 Apollo
      // calls - a per-row upsert loop meant ~300 sequential round trips for
      // sequences alone). The migration's UNIQUE constraint is what makes
      // each chunk's upsert safe to re-run on the same day.
      const upsertRows = rows.map(row => ({
        business_id: businessId,
        metric_date: metricDate,
        metric_key: row.metric_key,
        dim_type: row.dim_type,
        dim_value: row.dim_value,
        value: row.value,
        source: 'apollo',
        updated_at: new Date().toISOString(),
      }));
      for (const chunk of chunkRows(upsertRows, 500)) {
        const { error: upsertErr } = await supabase
          .from('sales_metrics_daily')
          .upsert(chunk, { onConflict: 'business_id,metric_date,metric_key,dim_type,dim_value' });
        if (upsertErr) adapterErrors[adapter.name] = `upsert failed: ${upsertErr.message}`;
      }

      supabaseMs += Date.now() - supabaseStart;
    } catch (err) {
      if (err instanceof CallCapError) {
        stoppedForCap = true;
        break;
      }
      adapterErrors[adapter.name] = err.message;
    }
  }

  // sales-hot-prospects-v1 - its own call counter, so the per-message
  // activities budget can't eat into the metrics adapters' cap or vice versa.
  const activityCtx = { callCounter: { count: 0, max: ACTIVITY_MAX_CALLS }, endpointCounts: {} };
  let activityCounts = null;
  let activityMs = 0;
  try {
    const activityStart = Date.now();
    const result = await syncActivity({ ctx: activityCtx, supabase, businessId });
    activityMs = Date.now() - activityStart;
    missingAll.push(...result.missing);
    activityCounts = result.counts;
  } catch (err) {
    adapterErrors.activity = err instanceof CallCapError ? 'call_cap' : err.message;
  }

  // sales-email-trend-v1 REV2 - per-day email counts for the current and
  // previous week, on their own call counter like the activity step.
  const countsCtx = { callCounter: { count: 0, max: EMAIL_COUNTS_MAX_CALLS }, endpointCounts: {} };
  let emailCountWeeks = null;
  let emailCountsMs = 0;
  try {
    const countsStart = Date.now();
    emailCountWeeks = await refreshRecentWeeks({ ctx: countsCtx, supabase, businessId, accountNames });
    emailCountsMs = Date.now() - countsStart;
    for (const w of emailCountWeeks) {
      if (w.complete === false) missingAll.push(`email counts: week ${w.weekStart} hit the page cap on ${w.truncated.join(', ')}`);
    }
  } catch (err) {
    adapterErrors.email_counts = err instanceof CallCapError ? 'call_cap' : err.message;
  }

  const hasErrors = Object.keys(adapterErrors).length > 0;
  const status = stoppedForCap || hasErrors ? 'partial' : 'success';

  const counts = {
    apollo_calls: ctx.callCounter.count + activityCtx.callCounter.count + countsCtx.callCounter.count,
    per_endpoint: {
      ...ctx.endpointCounts,
      ...activityCtx.endpointCounts,
      '/emailer_messages/search': (activityCtx.endpointCounts['/emailer_messages/search'] || 0) + (countsCtx.endpointCounts['/emailer_messages/search'] || 0),
      sender_lookup: senderLookupCount,
    },
    activity: activityCounts,
    email_counts: emailCountWeeks,
    missing: missingAll,
    adapter_errors: adapterErrors,
    timing_ms: { apollo: apolloMs, supabase: supabaseMs, activity: activityMs, email_counts: emailCountsMs },
  };
  if (stoppedForCap) counts.stopped_reason = 'call_cap';

  const errorText = stoppedForCap
    ? 'call_cap'
    : (hasErrors ? Object.entries(adapterErrors).map(([a, e]) => `${a}: ${e}`).join('; ') : null);

  const { data: finalRun } = await supabase
    .from('sales_sync_runs')
    .update({ status, finished_at: new Date().toISOString(), counts, error_text: errorText })
    .eq('id', run.id)
    .select()
    .single();

  return { refused: false, run: finalRun };
}

// Guardrail 10 - retention cleanup, called by the cron job after every
// business's sync completes.
export async function cleanupOldSnapshots() {
  const supabase = getSupabase();
  const cutoffIso = new Date(Date.now() - RETENTION_DAYS * 24 * 3600 * 1000).toISOString();
  const { error, count } = await supabase
    .from('sales_raw_snapshots')
    .delete({ count: 'exact' })
    .lt('captured_at', cutoffIso);
  if (error) console.error('[sales/cleanup] failed:', error.message);
  return { deleted: count || 0, error: error ? error.message : null };
}
