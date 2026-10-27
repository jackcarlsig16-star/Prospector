// node --test api/hk/gmailConnectMigration.test.mjs
// hkos-gmail-connect-v1 Stage 1 - the G2 migration text. Reads the file only; no DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20261026_hkos_gmail_connect_v1.sql'), 'utf8');

test('G2: sync state + sync runs tables with the exact keys and CHECKs, RLS + REVOKE; signature_text (<= 400) and hk_replies.urgent added', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.hk_gmail_sync_state \(/);
  assert.match(sql, /PRIMARY KEY \(business_id, user_id\)/);
  assert.match(sql, /grant_id\s+uuid REFERENCES public\.google_grants\(id\) ON DELETE SET NULL/);
  assert.match(sql, /last_error\s+text CHECK \(last_error IS NULL OR length\(last_error\) <= 200\)/);
  assert.match(sql, /CHECK \(status IN \('ok', 'running', 'error', 'needs_reconnect'\)\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.hk_sync_runs \(/);
  assert.match(sql, /CHECK \(trigger IN \('manual', 'pageload', 'test'\)\)/);
  assert.match(sql, /CHECK \(status IN \('ok', 'partial', 'error'\)\)/);
  assert.match(sql, /counts\s+jsonb NOT NULL DEFAULT '\{\}'/);
  assert.match(sql, /ALTER TABLE public\.hk_member_prefs ADD COLUMN IF NOT EXISTS signature_text text;/);
  assert.match(sql, /CHECK \(signature_text IS NULL OR length\(signature_text\) <= 400\)/);
  assert.match(sql, /ALTER TABLE public\.hk_replies ADD COLUMN IF NOT EXISTS urgent boolean NOT NULL DEFAULT false;/);
  for (const t of ['hk_gmail_sync_state', 'hk_sync_runs']) { assert.match(sql, new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY;`)); assert.match(sql, new RegExp(`REVOKE ALL ON public\\.${t}\\s+FROM anon, authenticated;`)); }
  assert.doesNotMatch(sql, /CREATE POLICY|DELETE FROM|DROP TABLE|@/);
  assert.match(sql, /SELECT 'table' AS kind/);
});
