#!/usr/bin/env node
'use strict';
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// backfill-email-counts.js — sales-email-trend-v1 REV2 Stage 2. Fills
// sales_email_daily_counts one Mon-Sun week at a time, oldest first, via
// api/sales/emailCounts.js (the same code the sync step uses). Resumable:
// weeks already in sales_email_backfill_weeks with complete = true are
// skipped unless --refresh. Idempotent: each week is replaced wholesale.
// Follows the CLAUDE.md diagnostic-script convention - prints scope and an
// estimate before any call, stops at a hard call cap, warns at 3x pace.
//
// Usage:
//   node scripts/backfill-email-counts.js --dry-run
//   node scripts/backfill-email-counts.js [--from 2026-08-24] [--max-calls 90] [--refresh]

const BUSINESS_ID = 'bc69beab-effd-452d-9e81-fd652333bb95'; // HomeLover
const EST_CALLS_PER_WEEK = 11; // first backfill measured 6-10 per week at ~500 sent/week; 11 leaves headroom

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}

(async () => {
  const { syncWeek, weekStartsBetween } = await import('../api/sales/emailCounts.js');
  const { laDateString } = await import('../api/sales/laDate.js');
  const { isAllowlistedBusiness } = await import('../api/sales/allowlist.js');
  const { CallCapError } = await import('../api/sales/apolloClient.js');

  if (!isAllowlistedBusiness(BUSINESS_ID)) throw new Error('HomeLover is not in SALES_ANALYTICS_BUSINESS_IDS');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const from = arg('--from', '2026-08-24');
  const maxCalls = Number(arg('--max-calls', 90));
  const refresh = process.argv.includes('--refresh');
  const dryRun = process.argv.includes('--dry-run');

  const { data: done, error } = await supabase.from('sales_email_backfill_weeks')
    .select('week_start, complete').eq('business_id', BUSINESS_ID);
  if (error) throw new Error(`read progress failed: ${error.message}`);
  const doneWeeks = new Set((done || []).filter(r => r.complete).map(r => r.week_start));
  const weeks = weekStartsBetween(from, laDateString()).filter(w => refresh || !doneWeeks.has(w));

  const estimate = weeks.length * EST_CALLS_PER_WEEK;
  console.log(`Scope: ${weeks.length} week(s) to fetch (${weeks.join(', ') || 'none'})${refresh ? ', refreshing done weeks too' : `, skipping ${doneWeeks.size} done`}.`);
  console.log(`Estimate: ~${estimate} Apollo calls (0 credits), ~${Math.ceil(weeks.length * 6)}s. Hard cap: ${maxCalls} calls.`);
  if (dryRun || !weeks.length) return;

  const ctx = { callCounter: { count: 0, max: maxCalls }, endpointCounts: {} };
  for (const weekStart of weeks) {
    if (maxCalls - ctx.callCounter.count < EST_CALLS_PER_WEEK) {
      console.log(`Stopping before ${weekStart}: ${maxCalls - ctx.callCounter.count} calls left, a week needs ~${EST_CALLS_PER_WEEK}. Rerun to resume.`);
      break;
    }
    try {
      const r = await syncWeek({ ctx, supabase, businessId: BUSINESS_ID, weekStart });
      console.log(`  ${weekStart}: ${r.calls} calls, ${r.rows} rows${r.complete ? '' : ` — INCOMPLETE, page cap hit on ${r.truncated.join(', ')}`}${r.dropped ? `, ${r.dropped} out-of-week rows dropped` : ''}`);
      if (r.calls > EST_CALLS_PER_WEEK * 3) console.log(`  ⚠ ${weekStart} took ${r.calls} calls, over 3x the ${EST_CALLS_PER_WEEK}-call estimate`);
    } catch (err) {
      if (err instanceof CallCapError) {
        console.log(`Call cap hit during ${weekStart}; that week was not written. Rerun to resume.`);
        break;
      }
      throw err;
    }
  }
  console.log(`Done. Apollo calls used: ${ctx.callCounter.count} / ${maxCalls} (estimate was ~${estimate}).`);
})().catch(err => { console.error('FAILED:', err.message); process.exit(1); });
