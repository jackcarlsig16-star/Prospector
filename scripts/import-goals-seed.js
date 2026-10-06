#!/usr/bin/env node
'use strict';
require('dotenv').config();
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

// import-goals-seed.js — sales-goals-v1 REVISION 4 Stage 7. Imports
// specs/seed/goals-seed-2026-09.json into HomeLover once, and optionally
// employee counts from a name,employees CSV (Jack's September sheet, exported
// outside the repo). Idempotent: rows are matched on natural keys and never
// duplicated or overwritten - re-running inserts nothing new. 0 Apollo calls.
//
//   partners     sales_goals (partnership) by name, all fields, priority as given
//   to-dos       week of 2026-09-28, with steps; owner Jack, Cyrus for GivingGo
//   targets      September weekly + month goals (goals only - the sheet's
//                actuals are history; live actuals come from synced data)
//   commitments  week of 2026-10-05; owner Jack, Cyrus where the text starts "Cyrus"
//   employees    sales_sequenced_accounts.employees, only where still empty
//
// Employee names match after normalizing case, punctuation, spacing and a
// trailing legal suffix (Inc, LLC, Ltd, Corp, Co, PLC) - nothing fuzzier.
// A name repeated in the sheet with different counts, or matching more than
// one company, is reported as ambiguous and skipped. Never guessed.
//
// Usage:
//   node scripts/import-goals-seed.js --dry-run [--employees <file.csv>]
//   node scripts/import-goals-seed.js [--employees <file.csv>]

const BUSINESS_ID = 'bc69beab-effd-452d-9e81-fd652333bb95'; // HomeLover
const SEED = 'specs/seed/goals-seed-2026-09.json';
const TODO_WEEK = '2026-09-28';
const COMMITMENT_WEEK = '2026-10-05';
const WEEK_METRICS = ['outbound_audience', 'total_in_sequence', 'sequences_running', 'meetings_set'];
const MONTH_METRICS = ['outbound_audience', 'total_in_sequence', 'sequences_running', 'meetings_set', 'open_rate'];

const arg = name => { const i = process.argv.indexOf(name); return i === -1 ? null : process.argv[i + 1]; };
const dryRun = process.argv.includes('--dry-run');
const lower = s => String(s || '').trim().toLowerCase();
const SUFFIX = /\b(inc|llc|ltd|corp|corporation|co|plc)$/;
function normName(s) {
  let n = lower(s).replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  while (SUFFIX.test(n)) n = n.replace(SUFFIX, '').trim();
  return n;
}

async function selectAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

(async () => {
  const { parseCsv } = await import('../src/utils/csv.js');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  const report = {};
  const write = async (table, rows) => {
    if (dryRun || !rows.length) return rows.map((r, i) => ({ ...r, id: `dry-${i}` }));
    const { data, error } = await supabase.from(table).insert(rows).select();
    if (error) throw new Error(`${table}: ${error.message}`);
    return data;
  };

  const { data: members, error: mErr } = await supabase.from('business_members').select('name, user_id').eq('business_id', BUSINESS_ID).not('user_id', 'is', null);
  if (mErr) throw new Error(mErr.message);
  const memberId = first => { const m = members.filter(x => lower(x.name).startsWith(first)); if (m.length !== 1) throw new Error(`expected exactly one member named ${first}*, found ${m.length}`); return m[0].user_id; };
  const jack = memberId('jack'), cyrus = memberId('cyrus');

  // Partners
  const existingPartners = new Set((await selectAll(() => supabase.from('sales_goals').select('name').eq('business_id', BUSINESS_ID).eq('goal_type', 'partnership').order('id'))).map(p => lower(p.name)));
  const newPartners = seed.partners.filter(p => !existingPartners.has(lower(p.name))).map(p => ({
    business_id: BUSINESS_ID, goal_type: 'partnership', name: p.name.trim(), priority: p.priority ?? null,
    meeting_status: p.meeting_status ?? null, champion: p.champion ?? null, angle: p.angle ?? null, motto: p.motto ?? null,
    watch_outs: p.watch_outs ?? null, first_email: p.first_email ?? null, first_email_note: p.first_email_note ?? null, sources: p.sources ?? null,
  }));
  await write('sales_goals', newPartners);
  report.partners = { in_seed: seed.partners.length, inserted: newPartners.length, already_there: seed.partners.length - newPartners.length };

  // Week goals (to-dos + commitments)
  const existingGoals = await selectAll(() => supabase.from('sales_week_goals').select('week_start, kind, text').eq('business_id', BUSINESS_ID).in('week_start', [TODO_WEEK, COMMITMENT_WEEK]).order('id'));
  const goalKey = (w, k, t) => `${w}|${k}|${lower(t)}`;
  const haveGoal = new Set(existingGoals.map(g => goalKey(g.week_start, g.kind, g.text)));

  const todoRows = seed.todos.map((t, i) => ({ t, row: {
    business_id: BUSINESS_ID, week_start: TODO_WEEK, kind: 'todo', text: t.title.trim(), category: t.category || null,
    contacts: t.contacts || [], owner_user_id: /givinggo/i.test(t.title) ? cyrus : jack, sort_order: i,
  } })).filter(x => !haveGoal.has(goalKey(TODO_WEEK, 'todo', x.row.text)));
  const insertedTodos = await write('sales_week_goals', todoRows.map(x => x.row));
  const steps = insertedTodos.flatMap((g, i) => (todoRows[i].t.steps || []).map((text, j) => ({ business_id: BUSINESS_ID, goal_id: g.id, text: text.trim(), sort_order: j })));
  await write('sales_week_goal_steps', steps);
  report.todos = { in_seed: seed.todos.length, inserted: insertedTodos.length, steps_inserted: steps.length, already_there: seed.todos.length - insertedTodos.length, week: TODO_WEEK };

  const commitments = seed.commitments_week_of_2026_10_05.map((text, i) => ({
    business_id: BUSINESS_ID, week_start: COMMITMENT_WEEK, kind: 'commitment', text: text.trim(),
    owner_user_id: /^cyrus\b/i.test(text.trim()) ? cyrus : jack, sort_order: i,
  })).filter(c => !haveGoal.has(goalKey(COMMITMENT_WEEK, 'commitment', c.text)));
  await write('sales_week_goals', commitments);
  report.commitments = { in_seed: seed.commitments_week_of_2026_10_05.length, inserted: commitments.length, already_there: seed.commitments_week_of_2026_10_05.length - commitments.length, week: COMMITMENT_WEEK };

  // Targets (goals only; existing goals are never overwritten)
  const existingTargets = new Set((await selectAll(() => supabase.from('sales_metric_targets').select('period, period_start, metric_key').eq('business_id', BUSINESS_ID).order('period_start'))).map(t => `${t.period}|${t.period_start}|${t.metric_key}`));
  const targets = [];
  for (const w of seed.weekly) for (const k of WEEK_METRICS) {
    const goal = w[k]?.[1];
    if (goal != null) targets.push({ period: 'week', period_start: w.week_start, metric_key: k, goal });
  }
  for (const k of MONTH_METRICS) if (seed.month_targets[k] != null) targets.push({ period: 'month', period_start: seed.month_targets.month, metric_key: k, goal: seed.month_targets[k] });
  const newTargets = targets.filter(t => !existingTargets.has(`${t.period}|${t.period_start}|${t.metric_key}`)).map(t => ({ business_id: BUSINESS_ID, ...t }));
  await write('sales_metric_targets', newTargets);
  report.targets = { in_seed: targets.length, inserted: newTargets.length, already_there: targets.length - newTargets.length, weeks: seed.weekly.map(w => w.week_start) };

  // Employee counts
  const csvPath = arg('--employees');
  if (csvPath) {
    const { rows } = parseCsv(fs.readFileSync(csvPath, 'utf8'));
    const sheet = new Map();
    for (const r of rows) {
      const n = Number(String(r.employees).replace(/,/g, ''));
      if (!r.name || !Number.isInteger(n) || n < 0) continue;
      const key = normName(r.name);
      if (!sheet.has(key)) sheet.set(key, { names: new Set(), counts: new Set() });
      sheet.get(key).names.add(r.name.trim()); sheet.get(key).counts.add(n);
    }
    const companies = await selectAll(() => supabase.from('sales_sequenced_accounts').select('account_id, name, employees').eq('business_id', BUSINESS_ID).order('account_id'));
    const byKey = new Map();
    for (const c of companies) { const k = normName(c.name); if (!k) continue; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(c); }
    const matched = [], unmatched = [], ambiguous = [], conflicts = [], unchanged = [];
    for (const [key, s] of sheet) {
      const label = [...s.names].join(' / ');
      if (s.counts.size > 1) { ambiguous.push(`${label} (sheet lists ${[...s.counts].join(', ')})`); continue; }
      const hits = byKey.get(key) || [];
      if (!hits.length) { unmatched.push(label); continue; }
      if (hits.length > 1) { ambiguous.push(`${label} (matches ${hits.length} companies)`); continue; }
      const count = [...s.counts][0], c = hits[0];
      if (c.employees === count) { unchanged.push(c.name); continue; }
      if (c.employees != null) { conflicts.push(`${c.name}: app has ${c.employees}, sheet ${count} (kept app value)`); continue; }
      matched.push({ account_id: c.account_id, app_name: c.name, sheet_name: label, employees: count });
    }
    if (!dryRun) {
      const now = new Date().toISOString();
      for (const m of matched) {
        const { error } = await supabase.from('sales_sequenced_accounts').update({ employees: m.employees, employees_updated_at: now })
          .eq('business_id', BUSINESS_ID).eq('account_id', m.account_id).is('employees', null);
        if (error) throw new Error(`employees ${m.app_name}: ${error.message}`);
      }
    }
    report.employees = {
      sheet_names: sheet.size, app_companies: companies.length, filled: matched.length, already_equal: unchanged.length,
      unmatched: unmatched.length, ambiguous: ambiguous.length, conflicts: conflicts.length,
      matched_list: matched.map(m => `${m.sheet_name}${m.sheet_name === m.app_name ? '' : ` -> ${m.app_name}`}: ${m.employees}`),
      unmatched_list: unmatched, ambiguous_list: ambiguous, conflict_list: conflicts,
    };
  }

  console.log(JSON.stringify({ dry_run: dryRun, ...report }, null, 2));
})().catch(err => { console.error('FAILED:', err.message); process.exit(1); });
