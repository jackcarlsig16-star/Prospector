// node --test api/hk/legacyArchiveDeferred.test.mjs
// hk-legacy-cleanup-v1 Stage 5 - the deferred archive migration (ruling R3's set, after hkos-sheet-import-v1 bar 5)
// touches exactly that set child -> parent, carries the literal expected counts (live reads 2026-10-27), deletes nothing
// without a copy, and leaves hk_*, Stage 3's archive rows and every other workspace alone. Reads the file only; no DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20261027_legacy_archive_deferred.sql'), 'utf8');
const HK = '981b790c-a3b0-4265-b32e-1f701d5731ff';
// Order = the archive inserts and the deletes: children before parents (prospects -> projects CASCADE; projects before
// lists because projects.list_id is ON DELETE SET NULL; account_* before accounts; permissions before lists).
const ARCHIVED = [['prospects', 14], ['projects', 3], ['account_lists', 42], ['account_business_details', 25], ['accounts', 35], ['member_list_permissions', 0], ['lists', 4]];
const TOTAL = ARCHIVED.reduce((n, [, c]) => n + c, 0);

test('no new table: reuses legacy_archive, one DO block, the pg_temp assert helper, HumanKind pinned by id', () => {
  assert.doesNotMatch(sql, /CREATE TABLE/);
  assert.equal((sql.match(/^DO \$\$/gm) || []).length, 1);
  assert.match(sql, /CREATE OR REPLACE FUNCTION pg_temp\.expect\(what text, got int, want int\) RETURNS void/);
  assert.doesNotMatch(sql, /PROCEDURE expect/);
  assert.ok(sql.includes(`hk   CONSTANT uuid := '${HK}'`));
  assert.ok(sql.includes("who  CONSTANT text := 'hk-legacy-cleanup-v1 Stage 5'"));
});

test('archives the seven deferred sources child -> parent with the literal counts, then deletes the same in the same order', () => {
  const ins = ARCHIVED.map(([t]) => sql.indexOf(`SELECT hk, '${t}', `));
  assert.ok(ins.every(i => i > 0), 'every source has an archive insert');
  assert.deepEqual(ins, [...ins].sort((a, b) => a - b), 'archive inserts run child -> parent');
  const del = ARCHIVED.map(([t]) => sql.search(new RegExp(`DELETE FROM public\\.${t}\\b`)));
  assert.ok(del.every(i => i > Math.max(...ins)), 'no delete runs before the last copy is in');
  assert.deepEqual(del, [...del].sort((a, b) => a - b), 'deletes run child -> parent');
  for (const [t, n] of ARCHIVED) {
    assert.ok(sql.includes(`PERFORM pg_temp.expect('archived ${t}', n, ${n});`), `archived ${t} = ${n}`);
    assert.ok(sql.includes(`PERFORM pg_temp.expect('deleted ${t}', n, ${n});`), `deleted ${t} = ${n}`);
  }
  assert.equal(TOTAL, 123);
  assert.ok(sql.includes("PERFORM pg_temp.expect('legacy_archive rows for HumanKind (Stage 3)', n, 64);"), 'Stage 3 rows present first');
  assert.ok(sql.includes("PERFORM pg_temp.expect('legacy_archive rows for HumanKind', n, 187);"), '64 + 123 after');
  assert.ok(sql.includes("PERFORM pg_temp.expect('legacy_archive rows from this run', n, 123);"));
});

test('guards: the live set is exactly as counted, nothing else references the projects / accounts, prospects are the 14 founding partners', () => {
  for (const line of ["'projects', n, 3", "'prospects', n, 14", "'prospects flagged founding partner', n, 14", "'accounts total', n, 35", "'business accounts', n, 35", "'account_business_details', n, 25", "'account_lists by account', n, 42", "'account_lists by list', n, 42", "'account_lists pointing outside HumanKind', n, 0", "'lists', n, 4", "'member_list_permissions', n, 0"]) assert.ok(sql.includes(line), line);
  for (const t of ['outreach_drafts', 'campaigns', 'frontier', 'bdr_assignments', 'handoff_intel', 'sfdc_tokens', 'business_intel_entries']) assert.ok(sql.includes(`'${t} on HumanKind projects', n, 0`), `${t} asserted empty`);
  assert.ok(sql.includes("'accounts (any workspace) on HumanKind projects', n, 0"));
  assert.ok(sql.includes("'plospect_compliance on HumanKind accounts', n, 0"));
  assert.match(sql, /IF to_regclass\('public\.project_members'\) IS NOT NULL THEN/, 'project_members is checked only when the table exists');
  assert.ok(sql.includes("PERFORM pg_temp.expect('HomeLover accounts', hl_accounts, 66);"));
  assert.ok(sql.includes("PERFORM pg_temp.expect('HomeLover lists', hl_lists, 7);"));
  assert.ok(sql.includes("PERFORM pg_temp.expect('HomeLover accounts after', n, hl_accounts);"));
  assert.ok(sql.includes("PERFORM pg_temp.expect('HomeLover lists after', n, hl_lists);"));
  assert.ok(sql.includes("'hk_brands founding partners (the Sheet import, untouched)', n, 14"));
});

test('every delete is scoped to HumanKind; untouched tables are never deleted from; every archived table is deleted exactly once', () => {
  for (const m of sql.matchAll(/DELETE FROM public\.(\w+)[^;]*;/g)) assert.match(m[0], /business_id = hk/, `scoped: ${m[0].slice(0, 80)}`);
  for (const [t] of ARCHIVED) assert.equal((sql.match(new RegExp(`DELETE FROM public\\.${t}\\b`, 'g')) || []).length, 1, `one delete from ${t}`);
  assert.doesNotMatch(sql, /DELETE FROM public\.(hk_\w+|legacy_archive|auth_events|business_members|outreach_doctrine|voice_profiles|businesses|business_intel_entries|business_profiles|account_influencer_details)\b/);
  assert.doesNotMatch(sql, /\bUPDATE public\./);
  assert.doesNotMatch(sql, /DROP /);
});

test('proof rows: archive by source_table, HumanKind live (0 each + hk_brands untouched), HomeLover', () => {
  assert.match(sql, /SELECT 'archive' AS kind, string_agg\(source_table \|\| '=' \|\| n/);
  assert.match(sql, /SELECT 'HumanKind live',/);
  for (const k of ['accounts=', 'account_business_details=', 'account_lists=', 'lists=', 'projects=', 'prospects=', 'member_list_permissions=', 'hk_brands=', 'hk_brands founding partners=']) assert.ok(sql.includes(`' · ${k}'`) || sql.includes(`'${k}'`), k);
  assert.match(sql, /SELECT 'HomeLover',/);
  assert.doesNotMatch(sql, /@/, 'no address anywhere in the migration');
});
