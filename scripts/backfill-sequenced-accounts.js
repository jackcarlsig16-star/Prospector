#!/usr/bin/env node
'use strict';
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// backfill-sequenced-accounts.js — sales-goals-v1 REV4 Stage 3. One-time
// fill of sales_sequenced_accounts for weeks before the ones the sync
// refreshes (current + previous). Delivered messages only, to stay inside
// the ~20-call budget Jack approved 2026-10-06 - a company whose only step-1
// sends in a backfilled week all bounced or were spam-blocked is missed
// there. Names come from one paged accounts/search. 0 credits. Idempotent:
// recordSequencedAccounts only moves dates earlier and fills names.
// Follows the CLAUDE.md diagnostic-script convention: scope + estimate
// before any call, hard call cap, warns at 3x pace.
//
// Usage:
//   node scripts/backfill-sequenced-accounts.js --dry-run
//   node scripts/backfill-sequenced-accounts.js [--from 2026-08-31] [--max-calls 20]

const BUSINESS_ID = 'bc69beab-effd-452d-9e81-fd652333bb95'; // HomeLover
const PER_PAGE = 100;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}

(async () => {
  const { fetchStat, weekStartOf, weekStartsBetween, addDays } = await import('../api/sales/emailCounts.js');
  const { firstTouches, recordSequencedAccounts } = await import('../api/sales/sequencedAccounts.js');
  const accounts = await import('../api/sales/adapters/accounts.js');
  const { laDateString } = await import('../api/sales/laDate.js');
  const { isAllowlistedBusiness } = await import('../api/sales/allowlist.js');
  const { CallCapError } = await import('../api/sales/apolloClient.js');

  if (!isAllowlistedBusiness(BUSINESS_ID)) throw new Error('HomeLover is not in SALES_ANALYTICS_BUSINESS_IDS');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const from = arg('--from', '2026-08-31');
  const maxCalls = Number(arg('--max-calls', 20));
  const dryRun = process.argv.includes('--dry-run');

  // The sync's email-counts step covers the current and previous week.
  const previousWeek = addDays(weekStartOf(laDateString()), -7);
  const weeks = weekStartsBetween(from, addDays(previousWeek, -1));

  const { data: counts, error } = await supabase.from('sales_email_daily_counts').select('day, delivered')
    .eq('business_id', BUSINESS_ID).gte('day', weeks[0] || from).lt('day', previousWeek);
  if (error) throw new Error(`read counts failed: ${error.message}`);
  const delivered = new Map(weeks.map(w => [w, 0]));
  for (const r of counts) { const w = weekStartOf(r.day); if (delivered.has(w)) delivered.set(w, delivered.get(w) + (r.delivered || 0)); }
  const pagesFor = n => Math.floor(n / PER_PAGE) + 1;
  const { data: snap } = await supabase.from('sales_raw_snapshots').select('payload').eq('business_id', BUSINESS_ID).eq('entity', 'accounts').order('captured_at', { ascending: false }).limit(1);
  const nameCalls = Math.ceil(((snap && snap[0] && snap[0].payload.length) || 300) / PER_PAGE);
  const estimate = nameCalls + weeks.reduce((n, w) => n + pagesFor(delivered.get(w)), 0);

  console.log(`Scope: ${weeks.length} week(s) (${weeks.map(w => `${w}: ${delivered.get(w)} delivered`).join(', ') || 'none'}) + account names (~${nameCalls} pages).`);
  console.log(`Estimate: ~${estimate} Apollo calls (0 credits), ~${estimate}s. Hard cap: ${maxCalls} calls.`);
  if (dryRun || !weeks.length) return;
  if (estimate > maxCalls) console.log(`⚠ estimate is over the cap - the last week(s) may not finish. Rerun to resume.`);

  const ctx = { callCounter: { count: 0, max: maxCalls }, endpointCounts: {} };
  let accountNames;
  try {
    const records = await accounts.fetchRecords(ctx);
    accountNames = new Map(records.map(r => [r.id, r.name]));
    console.log(`  names: ${records.length} accounts, ${ctx.callCounter.count} calls`);
  } catch (err) {
    if (err instanceof CallCapError) { console.log('Call cap hit fetching names; nothing written.'); return; }
    throw err;
  }
  for (const weekStart of weeks) {
    const before = ctx.callCounter.count;
    try {
      const { messages, complete } = await fetchStat(ctx, 'delivered', weekStart);
      const r = await recordSequencedAccounts({ supabase, businessId: BUSINESS_ID, touches: firstTouches(messages), accountNames });
      const calls = ctx.callCounter.count - before;
      console.log(`  ${weekStart}: ${messages.length} delivered, ${calls} calls, ${r.inserted} new companies, ${r.updated} updated${complete ? '' : ' — INCOMPLETE, page cap hit'}`);
      if (calls > pagesFor(delivered.get(weekStart)) * 3) console.log(`  ⚠ ${weekStart} took ${calls} calls, over 3x its estimate`);
    } catch (err) {
      if (err instanceof CallCapError) { console.log(`Call cap hit during ${weekStart}; that week was not written. Rerun to resume.`); break; }
      throw err;
    }
  }
  console.log(`Done. Apollo calls used: ${ctx.callCounter.count} / ${maxCalls} (estimate was ~${estimate}).`);
})().catch(err => { console.error('FAILED:', err.message); process.exit(1); });
