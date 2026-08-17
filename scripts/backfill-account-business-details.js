#!/usr/bin/env node
'use strict';
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// backfill-account-business-details.js — account-business-details-v1,
// one-time migration of existing Assay data forward into
// account_business_details. Run once, after the CREATE TABLE migration
// (supabase/migrations/20260817_account_business_details.sql) has been
// applied. Field mapping mirrors mapAssayResultToBusinessDetails() in
// src/utils/assay.js exactly - keep the two in sync if that mapping ever
// changes.
//
// Usage:
//   node scripts/backfill-account-business-details.js --dry-run
//   node scripts/backfill-account-business-details.js

const supabase = createClient(process.env.REACT_APP_SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY);
const dryRun = process.argv.includes('--dry-run');

function mapAssayResultToBusinessDetails(d) {
  return {
    score: d.score ?? null,
    tier: d.tier || null,
    business_model: d.businessModel || null,
    fit_rationale: d.productFit || null,
    disqualifier: d.disqualifier ?? null,
    ungrounded_claims: Array.isArray(d.ungroundedClaims) && d.ungroundedClaims.length ? d.ungroundedClaims : null,
    fit_signals: {
      key_signals: d.keySignals || [],
      signal_breakdown: d.signalBreakdown || null,
      traction_signals: d.tractionSignals || [],
      confidence: d.confidence || null,
      is_active: d.isActive,
      bank_connect_signal: d.bankConnectSignal,
      business_model_pattern: d.businessModelPattern || null,
      estimated_downstream_users: d.estimatedDownstreamUsers || null,
      is_established: d.isEstablished,
      distribution_multiplier: d.distributionMultiplier,
      use_cases: d.useCases || [],
      products: d.products || [],
      fetch_method: d.fetchMethod || null,
      linkedin: d.linkedin || null,
    },
  };
}

async function main() {
  console.log(dryRun ? 'DRY RUN — reporting matches only, nothing will be written\n' : 'LIVE RUN — will insert rows\n');

  const { data: accounts, error } = await supabase.from('accounts').select('id, data').eq('account_kind', 'business');
  if (error) { console.error('accounts query failed:', error.message); process.exit(1); }

  const analyzed = accounts.filter(a => a.data?.analyzed === true && 'businessModel' in (a.data || {}));
  console.log(`business accounts: ${accounts.length} total, ${analyzed.length} analyzed (has full Assay output)`);

  for (const a of analyzed) {
    const row = { account_id: a.id, assessment_status: 'assessed', last_assayed_at: a.data.lastTouchedAt || a.updated_at || new Date().toISOString(), ...mapAssayResultToBusinessDetails(a.data) };
    console.log(`  - "${a.data.name}" (${a.id}) — tier: ${row.tier}, score: ${row.score}`);
    if (!dryRun) {
      const { error: upErr } = await supabase.from('account_business_details').upsert(row, { onConflict: 'account_id' });
      if (upErr) console.error(`    FAILED: ${upErr.message}`);
    }
  }

  console.log(dryRun ? '\nRe-run without --dry-run to actually write.' : '\nBackfill complete.');
}

main();
