// node --test api/hk/legacyArchive.test.mjs
// hk-legacy-cleanup-v1 Stage 3 - the archive migration touches exactly the Stage 3 set (rulings R1-R4), carries the
// literal expected counts, deletes only the mail-thread dump without a copy, and never deletes a deferred table's rows.
// Reads the migration file only; no DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20261026_legacy_archive.sql'), 'utf8');
const HK = '981b790c-a3b0-4265-b32e-1f701d5731ff';
const DUMP = '07735e4f-b821-4c8f-bcd2-e297866564bf';
const ARCHIVED = { account_lists: 2, account_influencer_details: 26, accounts: 26, business_intel_entries: 9, business_profiles: 1 };
const DEFERRED = ['prospects', 'projects', 'lists', 'member_list_permissions', 'account_business_details'];

test('legacy_archive: service-only table (RLS on, anon + authenticated revoked, no policy)', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.legacy_archive \(/);
  for (const col of ['business_id  uuid', 'source_table text NOT NULL', 'source_id    text NOT NULL', 'row          jsonb NOT NULL', 'archived_at  timestamptz', 'archived_by  text']) assert.ok(sql.includes(col), col);
  assert.match(sql, /ALTER TABLE public\.legacy_archive ENABLE ROW LEVEL SECURITY;/);
  assert.match(sql, /REVOKE ALL ON public\.legacy_archive FROM anon, authenticated;/);
  assert.doesNotMatch(sql, /CREATE POLICY/);
});

test('one DO block for HumanKind archives the five Stage 3 sources child -> parent with the literal counts, then deletes the same', () => {
  assert.equal((sql.match(/^DO \$\$/gm) || []).length, 1);
  assert.match(sql, /CREATE OR REPLACE FUNCTION pg_temp\.expect\(what text, got int, want int\) RETURNS void/);
  assert.doesNotMatch(sql, /PROCEDURE expect/, 'PL\/pgSQL has no local procedures');
  assert.ok(sql.includes(`hk   CONSTANT uuid := '${HK}'`));
  const order = Object.keys(ARCHIVED).map(t => sql.indexOf(`SELECT hk, '${t}', `));
  assert.ok(order.every(i => i > 0), 'every source has an archive insert');
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'archive inserts run child -> parent');
  for (const [t, n] of Object.entries(ARCHIVED)) {
    assert.ok(sql.includes(`PERFORM pg_temp.expect('archived ${t}', n, ${n});`), `archived ${t} = ${n}`);
    assert.ok(new RegExp(`PERFORM pg_temp\\.expect\\('deleted ${t}[^']*', n, ${n}\\);`).test(sql), `deleted ${t} = ${n}`);
  }
  assert.ok(sql.includes("PERFORM pg_temp.expect('legacy_archive rows for HumanKind', n, 0);"), 'empty-archive guard');
  assert.ok(sql.includes("PERFORM pg_temp.expect('legacy_archive rows for HumanKind', n, 64);"), '2+26+26+9+1 after');
  assert.match(sql, /DELETE FROM public\.accounts WHERE business_id = hk AND account_kind = 'influencer';/);
});

test('the dump is the only row deleted without a copy; the archive select excludes it by id', () => {
  assert.ok(sql.includes(`dump CONSTANT uuid := '${DUMP}'`));
  assert.match(sql, /WHERE e\.business_id = hk AND e\.id <> dump;/);
  assert.match(sql, /DELETE FROM public\.business_intel_entries WHERE business_id = hk AND id = dump;/);
  assert.ok(sql.includes("PERFORM pg_temp.expect('deleted the dump', n, 1);"));
  assert.ok(sql.includes("AND source_type = 'note' AND length(content) > 70000;"), 'the dump is re-identified by shape, not only by id');
});

test('deferred set (R3) is asserted present and never deleted; HomeLover 66 / 7 asserted before and after', () => {
  for (const t of DEFERRED) {
    assert.doesNotMatch(sql, new RegExp(`DELETE FROM public\\.${t}\\b`), `no delete from ${t}`);
    assert.doesNotMatch(sql, new RegExp(`'${t}', [a-z]\\.id`), `no archive insert for ${t}`);
  }
  for (const line of ["'business accounts (deferred)', n, 35", "'account_business_details (deferred)', n, 25", "'business account_lists (deferred)', n, 42", "'lists (deferred)', n, 4", "'projects (deferred)', n, 3", "'prospects (deferred)', n, 14", "'member_list_permissions (deferred)', n, 3"]) assert.ok(sql.includes(line), line);
  assert.ok(sql.includes("PERFORM pg_temp.expect('HomeLover accounts', hl_accounts, 66);"));
  assert.ok(sql.includes("PERFORM pg_temp.expect('HomeLover lists', hl_lists, 7);"));
  assert.ok(sql.includes("PERFORM pg_temp.expect('HomeLover accounts after', n, hl_accounts);"));
  assert.doesNotMatch(sql, /DELETE FROM public\.(auth_events|business_members|outreach_doctrine|voice_profiles|businesses)\b/);
});
