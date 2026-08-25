#!/usr/bin/env node
'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// assay-legacy-fintech-data-cleanup-v1 — one-time, bounded correction of
// Plaid/fintech-era residue in 4 known accounts. Re-assay cannot clear it:
// the generalized prompt correctly returns products: [] for a non-fintech
// business, and AccountsPage.js's `parsed.products?.length ? … : (a.prods||[])`
// fallback then restores the stale value precisely because the correct answer
// is empty. Hence a direct write.
//
// DECLARED SCOPE: 4 accounts, 2 tables (accounts.data, account_business_details),
// at most 8 row updates. Seconds of runtime, negligible data volume.
//
// Per-field, not blanket (Jack, 2026-08-25): only fields carrying real fintech
// residue are cleared. RentTrack's and Roots' business models and Studio Three's
// entire current assay are accurate, current-era output and are preserved.
//
// Usage: node scripts/cleanup-legacy-fintech-data.js [--apply]
//        (no flag = dry run; prints every before/after and writes nothing)

const STALE_SIGNAL = 'ACH payment signal detected';

const PLAN = {
  'import_1786692240343_oaq3x': {
    name: 'Bilt Rewards',
    account: { prods: [], products: [], ucs: [], useCases: [], pf: null, productFit: null, bm: null, businessModel: null, sigs: [], keySignals: [], bankConnectSignal: false },
    detail: { fit_rationale: null, business_model: null, fitSignals: { products: [], use_cases: [], key_signals: [] }, dropBankConnect: true },
  },
  'import_1786692240343_u89hk': {
    name: 'RentTrack',
    account: { prods: [], products: [], ucs: [], useCases: [], pf: null, productFit: null },
    detail: { fit_rationale: null, fitSignals: { products: [], use_cases: [] }, dropBankConnect: true },
  },
  'import_1786692240343_ry53b': {
    name: 'Roots',
    account: { dropStaleSignal: true },
    detail: { dropStaleSignal: true, dropBankConnect: true },
  },
  'import_1787091718719_m8inj': {
    name: 'Studio Three',
    account: { bankConnectSignal: false },
    detail: { dropBankConnect: true },
  },
};

const apply = process.argv.includes('--apply');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const ids = Object.keys(PLAN);
const dropStale = arr => (Array.isArray(arr) ? arr.filter(x => String(x) !== STALE_SIGNAL) : arr);

(async () => {
  const { data: accts, error: e1 } = await supabase.from('accounts').select('id, data').in('id', ids);
  if (e1) throw new Error('accounts read failed: ' + e1.message);
  const { data: details, error: e2 } = await supabase.from('account_business_details').select('*').in('account_id', ids);
  if (e2) throw new Error('account_business_details read failed: ' + e2.message);

  if (accts.length !== ids.length) throw new Error(`expected ${ids.length} accounts, got ${accts.length} — aborting`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(__dirname, '..', `.backup-legacy-fintech-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({ accounts: accts, account_business_details: details }, null, 2));
  console.log(`Backup written: ${backupPath}\n${apply ? 'MODE: APPLY' : 'MODE: DRY RUN (pass --apply to write)'}\n`);

  for (const id of ids) {
    const plan = PLAN[id];
    const row = accts.find(a => a.id === id);
    const next = { ...row.data };
    const changes = [];

    for (const [k, v] of Object.entries(plan.account)) {
      if (k === 'dropStaleSignal') continue;
      if (!(k in next)) continue;
      if (JSON.stringify(next[k]) === JSON.stringify(v)) continue;
      changes.push(`  accounts.data.${k}: ${JSON.stringify(next[k]).slice(0, 70)} -> ${JSON.stringify(v)}`);
      next[k] = v;
    }
    if (plan.account.dropStaleSignal) {
      for (const k of ['sigs', 'keySignals']) {
        const after = dropStale(next[k]);
        if (Array.isArray(next[k]) && after.length !== next[k].length) {
          changes.push(`  accounts.data.${k}: dropped "${STALE_SIGNAL}" (${next[k].length} -> ${after.length})`);
          next[k] = after;
        }
      }
    }

    const det = details.find(d => d.account_id === id);
    let detPatch = null;
    if (det && plan.detail) {
      const fs2 = { ...(det.fit_signals || {}) };
      const p = { };
      for (const [k, v] of Object.entries(plan.detail)) {
        if (['fitSignals', 'dropBankConnect', 'dropStaleSignal'].includes(k)) continue;
        if (JSON.stringify(det[k]) === JSON.stringify(v)) continue;
        changes.push(`  abd.${k}: ${JSON.stringify(det[k]).slice(0, 70)} -> ${JSON.stringify(v)}`);
        p[k] = v;
      }
      let fsChanged = false;
      for (const [k, v] of Object.entries(plan.detail.fitSignals || {})) {
        if (JSON.stringify(fs2[k]) === JSON.stringify(v)) continue;
        changes.push(`  abd.fit_signals.${k}: ${JSON.stringify(fs2[k]).slice(0, 70)} -> ${JSON.stringify(v)}`);
        fs2[k] = v; fsChanged = true;
      }
      if (plan.detail.dropStaleSignal) {
        const after = dropStale(fs2.key_signals);
        if (Array.isArray(fs2.key_signals) && after.length !== fs2.key_signals.length) {
          changes.push(`  abd.fit_signals.key_signals: dropped "${STALE_SIGNAL}"`);
          fs2.key_signals = after; fsChanged = true;
        }
      }
      if (plan.detail.dropBankConnect && 'bank_connect_signal' in fs2) {
        changes.push(`  abd.fit_signals.bank_connect_signal: ${JSON.stringify(fs2.bank_connect_signal)} -> (key removed)`);
        delete fs2.bank_connect_signal; fsChanged = true;
      }
      if (fsChanged) p.fit_signals = fs2;
      if (Object.keys(p).length) detPatch = p;
    }

    console.log(`${plan.name} (${id}) — ${changes.length} change${changes.length === 1 ? '' : 's'}`);
    changes.forEach(c => console.log(c));
    if (!changes.length) console.log('  (already clean)');
    console.log('');

    if (apply && changes.length) {
      const { error } = await supabase.from('accounts').update({ data: next }).eq('id', id);
      if (error) throw new Error(`accounts write failed for ${id}: ${error.message}`);
      if (detPatch) {
        const { error: e3 } = await supabase.from('account_business_details').update(detPatch).eq('account_id', id);
        if (e3) throw new Error(`abd write failed for ${id}: ${e3.message}`);
      }
    }
  }
  console.log(apply ? 'Applied.' : 'Dry run complete — nothing written.');
})().catch(e => { console.error('ABORTED:', e.message); process.exit(1); });
