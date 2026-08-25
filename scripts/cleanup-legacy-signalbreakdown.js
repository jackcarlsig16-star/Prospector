#!/usr/bin/env node
'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// assay-legacy-signalbreakdown-cleanup-v1 — removes detectSignals()' old-schema
// keys from stored assay results. buildGeneralizedPrompt emits
// fitSignals/adoptionSignals/scaleSignals/slagSignals; paymentSignals/
// onboardingSignals/platformSignals/creditSignals are the pre-gate fintech
// detector's vocabulary and no longer have a producer. DealTimeline.js read
// two of them straight into a prompt, which is why this is data cleanup and
// not cosmetic.
//
// DECLARED SCOPE: <=126 accounts + <=46 account_business_details rows read;
// writes limited to rows actually carrying a legacy key. Seconds, negligible
// volume. Usage: node scripts/cleanup-legacy-signalbreakdown.js [--apply]

const LEGACY = ['paymentSignals', 'onboardingSignals', 'platformSignals', 'creditSignals'];
const apply = process.argv.includes('--apply');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const strip = sb => {
  if (!sb || typeof sb !== 'object') return { next: sb, removed: [] };
  const next = { ...sb }, removed = [];
  for (const k of LEGACY) {
    if (k in next) { removed.push(`${k}(${Array.isArray(next[k]) ? next[k].length : '?'})`); delete next[k]; }
  }
  return { next, removed };
};

(async () => {
  const { data: accts, error: e1 } = await supabase.from('accounts').select('id, data');
  if (e1) throw new Error('accounts read: ' + e1.message);
  const { data: details, error: e2 } = await supabase.from('account_business_details').select('account_id, fit_signals');
  if (e2) throw new Error('abd read: ' + e2.message);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(__dirname, '..', `.backup-legacy-signalbreakdown-${stamp}.json`);
  fs.writeFileSync(backup, JSON.stringify({ accounts: accts, account_business_details: details }, null, 2));
  console.log(`Backup: ${backup}\n${apply ? 'MODE: APPLY' : 'MODE: DRY RUN (pass --apply)'}\n`);

  let a = 0, b = 0;
  for (const row of accts) {
    const { next, removed } = strip(row.data?.signalBreakdown);
    if (!removed.length) continue;
    a++;
    console.log(`accounts  ${(row.data?.name || '').padEnd(24)} ${removed.join(' ')}`);
    if (apply) {
      const { error } = await supabase.from('accounts').update({ data: { ...row.data, signalBreakdown: next } }).eq('id', row.id);
      if (error) throw new Error(`accounts write ${row.id}: ${error.message}`);
    }
  }
  for (const row of details) {
    const { next, removed } = strip(row.fit_signals?.signal_breakdown);
    if (!removed.length) continue;
    b++;
    console.log(`abd       ${row.account_id.padEnd(34)} ${removed.join(' ')}`);
    if (apply) {
      const { error } = await supabase.from('account_business_details')
        .update({ fit_signals: { ...row.fit_signals, signal_breakdown: next } }).eq('account_id', row.account_id);
      if (error) throw new Error(`abd write ${row.account_id}: ${error.message}`);
    }
  }
  console.log(`\naccounts touched: ${a} of ${accts.length} | abd touched: ${b} of ${details.length}`);
  console.log(apply ? 'Applied.' : 'Dry run — nothing written.');
})().catch(e => { console.error('ABORTED:', e.message); process.exit(1); });
