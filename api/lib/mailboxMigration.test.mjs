// node --test api/lib/mailboxMigration.test.mjs
// mailbox-connections-v1 REV2 Stage 1 - the migration text carries M1 + M2 exactly and nothing that re-points or
// deletes an account. Reads the file only; no DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20261026_mailbox_connections_v1.sql'), 'utf8');

test('M1: new columns, every existing row becomes the default, id becomes the PK, (user_id, google_email) unique, one default per user', () => {
  for (const col of ['id           uuid NOT NULL DEFAULT gen_random_uuid()', 'is_default   boolean NOT NULL DEFAULT false', 'error        text', 'error_at     timestamptz', 'last_used_at timestamptz']) assert.ok(sql.includes(`ADD COLUMN IF NOT EXISTS ${col}`), col);
  assert.match(sql, /UPDATE public\.google_grants SET is_default = true WHERE is_default = false;/);
  assert.match(sql, /DROP CONSTRAINT google_grants_pkey;/);
  assert.match(sql, /ADD CONSTRAINT google_grants_pkey PRIMARY KEY \(id\);/);
  assert.match(sql, /ADD CONSTRAINT google_grants_user_email_uniq UNIQUE \(user_id, google_email\);/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS google_grants_one_default_per_user ON public\.google_grants \(user_id\) WHERE is_default;/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS google_grants_user_idx ON public\.google_grants \(user_id\);/);
  assert.match(sql, /CHECK \(error IS NULL OR error IN \('needs_reconnect'\)\)/);
  assert.match(sql, /CHECK \(google_email = lower\(google_email\)\)/);
});

test('M2: workspace_mailboxes with the exact key, provider and purposes checks, cascades, RLS + REVOKE', () => {
  const at = sql.indexOf('CREATE TABLE IF NOT EXISTS public.workspace_mailboxes (');
  assert.ok(at > 0);
  const body = sql.slice(at, sql.indexOf(');', at));
  assert.match(body, /business_id\s+uuid NOT NULL REFERENCES public\.businesses\(id\) ON DELETE CASCADE/);
  assert.match(body, /user_id\s+uuid NOT NULL REFERENCES public\.profiles\(id\) ON DELETE CASCADE/);
  assert.match(body, /provider\s+text NOT NULL CHECK \(provider IN \('google'\)\)/);
  assert.match(body, /google_grant_id uuid NOT NULL REFERENCES public\.google_grants\(id\) ON DELETE CASCADE/);
  assert.match(body, /purposes\s+text\[\] NOT NULL CHECK \(purposes <@ ARRAY\['drafts', 'inbox', 'calendar'\] AND cardinality\(purposes\) > 0\)/);
  assert.match(body, /PRIMARY KEY \(business_id, user_id, provider\)/);
  assert.match(sql, /ALTER TABLE public\.workspace_mailboxes ENABLE ROW LEVEL SECURITY;/);
  assert.match(sql, /REVOKE ALL ON public\.workspace_mailboxes FROM anon, authenticated;/);
  assert.doesNotMatch(sql, /CREATE POLICY/);
});

test('nothing deletes a grant, drops the user_id FK, or touches microsoft_grants; the verification query is present', () => {
  assert.doesNotMatch(sql, /DELETE FROM/);
  assert.doesNotMatch(sql, /DROP TABLE/);
  assert.doesNotMatch(sql, /google_grants_user_id_fkey/);
  assert.doesNotMatch(sql, /microsoft_grants/);
  assert.match(sql, /SELECT 'grants per user' AS kind/);
  assert.match(sql, /SELECT 'tethers', 'workspace_mailboxes rows=' \|\|/);
  assert.match(sql, /do NOT connect or reconnect Google between running this and Stage 2/);
});
