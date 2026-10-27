// node --test api/hk/dailyCheckMigration.test.mjs
// hkos-daily-check-v1 Stage 1 - the migration text: the job ledger, the once-per-Chicago-day partial unique index, the
// quiet-weekends column, service-only grants, proof rows. Reads the file only; no DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20261027_hkos_daily_check_v1.sql'), 'utf8');

test('hk_job_runs: the columns the runners write, with CHECK lists for job / trigger / status and a 200-char error cap', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.hk_job_runs \(/);
  assert.ok(sql.includes("job         text NOT NULL CHECK (job IN ('gmail-sync-all', 'daily-check'))"));
  assert.ok(sql.includes("trigger     text NOT NULL CHECK (trigger IN ('cron', 'pageload', 'manual', 'test'))"));
  assert.ok(sql.includes("status      text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'partial', 'error'))"));
  for (const col of ['chicago_day date NOT NULL', 'counts      jsonb NOT NULL DEFAULT \'{}\'', 'digest      jsonb', 'error       text CHECK (error IS NULL OR length(error) <= 200)', 'started_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL']) assert.ok(sql.includes(col), col);
});

test('once per Chicago day: a partial UNIQUE index on (business_id, job, chicago_day) for daily-check that an error row does not hold', () => {
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS hk_job_runs_daily_check_once ON public\.hk_job_runs \(business_id, job, chicago_day\)\s+WHERE job = 'daily-check' AND status <> 'error';/);
});

test('service-only: RLS on, anon + authenticated revoked, no policy; quiet_weekends added with DEFAULT true; idempotent', () => {
  assert.match(sql, /ALTER TABLE public\.hk_job_runs ENABLE ROW LEVEL SECURITY;/);
  assert.match(sql, /REVOKE ALL ON public\.hk_job_runs FROM anon, authenticated;/);
  assert.doesNotMatch(sql, /CREATE POLICY/);
  assert.match(sql, /ALTER TABLE public\.hk_settings ADD COLUMN IF NOT EXISTS quiet_weekends boolean NOT NULL DEFAULT true;/);
  assert.doesNotMatch(sql, /DROP |DELETE FROM|UPDATE public\./);
  assert.equal((sql.match(/CREATE TABLE/g) || []).length, 1);
});

test('proof rows: table grants, the partial index, the column, the HumanKind seed line', () => {
  for (const k of ["'table' AS kind, 'hk_job_runs'", "'index', 'hk_job_runs_daily_check_once'", "'column', 'hk_settings.quiet_weekends'", "'seed', 'hk_settings HumanKind'"]) assert.ok(sql.includes(k), k);
  assert.match(sql, /has_table_privilege\('anon', 'public\.hk_job_runs', 'SELECT'\)/);
  assert.ok(!sql.includes('@'));
});
