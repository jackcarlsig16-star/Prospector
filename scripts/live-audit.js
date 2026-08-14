#!/usr/bin/env node
'use strict';
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// live-audit.js — reusable checks for verifying real, live state before or
// after any change that touches schema, data, RLS, or a deploy. Built after
// a session where count-only (head:true) Supabase checks, "should be fine"
// schema assumptions, and ambiguous "success" confirmations each produced a
// real false positive. Every command here does a real query against the
// live system — never a guess, never a cached/remembered answer.
//
// Usage:
//   node scripts/live-audit.js table <name>          - real select (anon key) + row count + sample
//   node scripts/live-audit.js rls <name>             - actual pg_policies for a table (service key)
//   node scripts/live-audit.js schema <name>          - actual columns/constraints for a table (service key)
//   node scripts/live-audit.js remote [branch]        - confirm local HEAD matches origin (default: current branch)
//   node scripts/live-audit.js deploy [baselineHash]  - fetch live bundle hash; compare to baseline if given
//
// Requires in .env:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY               - for `rls` and `schema` (privileged introspection)
//   REACT_APP_SUPABASE_URL, REACT_APP_SUPABASE_ANON_KEY - for `table` (same credential the browser uses)
// `remote` and `deploy` need no credentials, just git and network access.
//
// `rls`/`schema` depend on the RPCs in
// supabase/migrations/20260813_create_audit_rpcs.sql - run that once before
// using either command. If it hasn't been run, the error says so.

const { execSync } = require('child_process');

const LIVE_URL = process.env.PROSPECTOR_LIVE_URL || 'https://prospector-chtj.onrender.com';

function serviceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY in .env');
    process.exit(1);
  }
  return createClient(url, key);
}

function anonClient() {
  const url = process.env.REACT_APP_SUPABASE_URL;
  const key = process.env.REACT_APP_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error('Missing REACT_APP_SUPABASE_URL / REACT_APP_SUPABASE_ANON_KEY in .env');
    console.error('These are the same two vars the app itself reads (src/utils/supabase.js) -');
    console.error('add them to .env with the values from Render / the live bundle.');
    process.exit(1);
  }
  return createClient(url, key);
}

// ── table <name> — real select (anon key), not a head:true count ───────────
async function cmdTable(name) {
  if (!name) { console.error('Usage: table <name>'); process.exit(1); }
  const supabase = anonClient();
  const { data, error, count } = await supabase.from(name).select('*', { count: 'exact' });
  if (error) {
    console.log(`✗  ${name}: NOT usable via anon key`);
    console.log(`   ${error.code || ''} ${error.message}`);
    process.exit(1);
  }
  console.log(`✓  ${name}: real select succeeded (anon key)`);
  console.log(`   row count: ${count}`);
  console.log(`   sample (first ${Math.min(3, data.length)} of ${data.length}):`);
  console.log(JSON.stringify(data.slice(0, 3), null, 2));
}

// ── rls <name> — actual current pg_policies, not an assumption ─────────────
async function cmdRls(name) {
  if (!name) { console.error('Usage: rls <name>'); process.exit(1); }
  const supabase = serviceClient();
  const { data, error } = await supabase.rpc('audit_table_policies', { target_table: name });
  if (error) {
    console.error(`✗  Could not read policies for ${name}: ${error.message}`);
    if (/function .* does not exist/i.test(error.message || '')) {
      console.error('   Run supabase/migrations/20260813_create_audit_rpcs.sql first.');
    }
    process.exit(1);
  }
  if (!data || data.length === 0) {
    console.log(`⚠  ${name}: no policies found (RLS may be enabled with zero policies — that blocks everyone, or RLS is off entirely).`);
    return;
  }
  console.log(`Policies on ${name} (${data.length}):`);
  for (const p of data) {
    console.log(`\n  ${p.policyname}  [${p.cmd}]  roles: ${p.roles}`);
    if (p.qual) console.log(`    USING:      ${p.qual}`);
    if (p.with_check) console.log(`    WITH CHECK: ${p.with_check}`);
  }
}

// ── schema <name> — actual current columns/constraints, not a guess ────────
async function cmdSchema(name) {
  if (!name) { console.error('Usage: schema <name>'); process.exit(1); }
  const supabase = serviceClient();
  const { data, error } = await supabase.rpc('audit_table_schema', { target_table: name });
  if (error) {
    console.error(`✗  Could not read schema for ${name}: ${error.message}`);
    if (/function .* does not exist/i.test(error.message || '')) {
      console.error('   Run supabase/migrations/20260813_create_audit_rpcs.sql first.');
    }
    process.exit(1);
  }
  if (!data || data.length === 0) {
    console.log(`✗  ${name}: no columns found — table likely doesn't exist in public schema.`);
    return;
  }
  console.log(`Columns on ${name} (${data.length}):`);
  const col = (s, w) => String(s ?? '').padEnd(w);
  for (const c of data) {
    const nullable = c.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
    const fk = c.fk_target ? `  -> ${c.fk_target}` : '';
    const def = c.column_default ? `  default ${c.column_default}` : '';
    console.log(`  ${col(c.column_name, 24)} ${col(c.data_type, 14)} ${col(nullable, 9)}${fk}${def}`);
  }
}

// ── remote — local HEAD vs actual origin, not "push succeeded" ─────────────
function cmdRemote(branch) {
  const b = branch || execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
  const local = execSync('git rev-parse HEAD').toString().trim();
  const remoteLine = execSync(`git ls-remote origin ${b}`).toString().trim();
  const remote = remoteLine.split(/\s+/)[0] || '(no such ref on origin)';
  console.log(`branch: ${b}`);
  console.log(`local:  ${local}`);
  console.log(`origin: ${remote}`);
  if (local === remote) {
    console.log('✓  local HEAD matches origin');
  } else {
    console.log('✗  local HEAD does NOT match origin — push may not have landed, or origin has moved ahead');
    process.exit(1);
  }
}

// ── deploy [baselineHash] — real bundle hash, not "should be deployed by now" ─
async function cmdDeploy(baseline) {
  const res = await fetch(LIVE_URL);
  const html = await res.text();
  const match = html.match(/main\.[a-f0-9]+\.js/);
  const current = match ? match[0] : null;
  if (!current) {
    console.log(`✗  Could not find a main.*.js bundle reference at ${LIVE_URL} — site may be down or serving something unexpected.`);
    process.exit(1);
  }
  console.log(`live bundle: ${current}`);
  if (!baseline) {
    console.log('(no baseline given — this is just the current hash; pass the pre-push hash to compare)');
    return;
  }
  if (current !== baseline) {
    console.log(`✓  changed since baseline (${baseline}) — a new deploy has landed`);
  } else {
    console.log(`✗  unchanged since baseline (${baseline}) — deploy has NOT landed yet, keep polling`);
    process.exit(1);
  }
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  switch (cmd) {
    case 'table':  return cmdTable(arg);
    case 'rls':    return cmdRls(arg);
    case 'schema': return cmdSchema(arg);
    case 'remote': return cmdRemote(arg);
    case 'deploy': return cmdDeploy(arg);
    default:
      console.log(`Usage: node scripts/live-audit.js <table|rls|schema|remote|deploy> [arg]`);
      console.log(`See the header comment in this file for full usage.`);
      process.exit(cmd ? 1 : 0);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
