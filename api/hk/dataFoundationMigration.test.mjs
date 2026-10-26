// node --test api/hk/dataFoundationMigration.test.mjs
// hkos-data-foundation-v1 Stage 1 - the migration text carries every D1 table, every CHECK list, RLS + REVOKE for
// each table, the two seeds and nothing from the mockups. Reads the file only; no DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20261026_hkos_data_foundation_v1.sql'), 'utf8');
const seed = createRequire(import.meta.url)('./lintSeed.json');
const TABLES = ['hk_brands', 'hk_contacts', 'hk_touches', 'hk_replies', 'hk_sponsor_periods', 'hk_settings', 'hk_events', 'hk_duplicate_decisions', 'hk_import_runs', 'hk_ignored_senders', 'hk_member_prefs'];
const CHECKS = {
  segment: ['sponsor_brand', 'creator', 'nonprofit', 'press', 'podcast', 'university'],
  status: ['candidate', 'claimed', 'drafted', 'sent', 'bumped', 'final_sent', 'replied', 'meeting', 'signed', 'passed', 'skipped', 'sponsor'],
  relationship: ['prospect', 'sponsor', 'founding_partner', 'do_not_contact'],
  source: ['sourced', 'user_supplied', 'apollo_list', 'places', 'import'],
  email_source: ['apollo_verified', 'site_published', 'user_supplied', 'import'],
  channel: ['email', 'ig_dm', 'linkedin', 'contact_form', 'phone', 'in_person'],
  kind: ['cold', 'bump', 'dm_text', 'final', 'reply', 'outside'],
  state: ['drafted', 'sent', 'discarded'],
  created_by: ['claude', 'system', 'user'],
  label: ['interested', 'pricing', 'referral', 'decline', 'auto_reply', 'prefers_email', 'new_thread', 'other'],
  actor_kind: ['user', 'claude', 'system'],
  verdict: ['not_duplicate', 'merged'],
};
const list = vals => vals.map(v => `'${v}'`).join(', ');

test('every D1 table is created with business_id -> businesses ON DELETE CASCADE, RLS on and anon + authenticated revoked', () => {
  for (const t of TABLES) {
    const at = sql.indexOf(`CREATE TABLE IF NOT EXISTS public.${t} (`);
    assert.ok(at > 0, `create ${t}`);
    const body = sql.slice(at, sql.indexOf(');', at));
    assert.match(body, /business_id\s+uuid NOT NULL (PRIMARY KEY )?REFERENCES public\.businesses\(id\) ON DELETE CASCADE|business_id\s+uuid PRIMARY KEY REFERENCES public\.businesses\(id\) ON DELETE CASCADE/, `${t} business_id`);
    assert.match(body, /created_at\s+timestamptz NOT NULL DEFAULT now\(\)/, `${t} created_at`);
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY;`), `${t} rls`);
    assert.match(sql, new RegExp(`REVOKE ALL ON public\\.${t}\\s+FROM anon, authenticated;`), `${t} revoke`);
  }
  assert.doesNotMatch(sql, /CREATE POLICY/);
});

test('every CHECK list from D1 is present verbatim; avatar_slot is 1..4; sponsor period is launch or YYYY-MM', () => {
  for (const [col, vals] of Object.entries(CHECKS)) assert.ok(sql.includes(`CHECK (${col} IN (${list(vals)}))`), `${col} check`);
  assert.ok(sql.includes('CHECK (avatar_slot BETWEEN 1 AND 4)'));
  assert.ok(sql.includes("CHECK (period = 'launch' OR period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')"));
  assert.ok(sql.includes('CHECK (length(name) BETWEEN 1 AND 160)'));
});

test('the partial uniques and the generated duplicate pair exist; no phone column anywhere', () => {
  assert.match(sql, /hk_brands_live_name_uniq\s+ON public\.hk_brands \(business_id, normalized_name\) WHERE archived_at IS NULL/);
  assert.match(sql, /hk_brands_live_domain_uniq ON public\.hk_brands \(business_id, domain\) WHERE domain IS NOT NULL AND archived_at IS NULL/);
  assert.match(sql, /hk_contacts_one_primary_uniq ON public\.hk_contacts \(brand_id\) WHERE is_primary/);
  assert.match(sql, /hk_replies_message_uniq ON public\.hk_replies \(business_id, gmail_message_id\) WHERE gmail_message_id IS NOT NULL/);
  assert.match(sql, /UNIQUE \(brand_id, period, kind\)/);
  assert.match(sql, /pair_lo\s+uuid GENERATED ALWAYS AS \(LEAST\(brand_a, brand_b\)\) STORED/);
  assert.match(sql, /UNIQUE \(business_id, pair_lo, pair_hi\)/);
  assert.match(sql, /UNIQUE \(business_id, user_id, domain\)/);
  assert.doesNotMatch(sql, /\bphone\s+text/i);
});

test('the only "@" is inside the hk_contacts.email CHECK pattern', () => {
  const lines = sql.split('\n');
  const withAt = lines.map((l, i) => [i + 1, l]).filter(([, l]) => l.includes('@'));
  assert.equal(withAt.length, 1, JSON.stringify(withAt.map(([n]) => n)));
  assert.match(withAt[0][1], /^\s+email\s+text CHECK \(email IS NULL OR \(length\(email\) <= 254 AND email ~\* /);
});

test('seeds: one hk_settings row for HumanKind with the skill stats, the subject format and the lintSeed banned words; owner slot 1; nothing else', () => {
  assert.match(sql, /INSERT INTO public\.hk_settings \(business_id, members_stat, completions_stat, subject_format, market_line_local, market_line_national, banned_phrases\)\nVALUES \('981b790c-a3b0-4265-b32e-1f701d5731ff', 1500, 6000, 'HumanKind x \[Brand\] - \[descriptor\]'/);
  assert.ok(sql.includes(`ARRAY[${list(seed.banned_words)}]`), 'banned_phrases = lintSeed banned_words, same order');
  assert.ok(sql.includes('ON CONFLICT (business_id) DO NOTHING;'));
  assert.match(sql, /INSERT INTO public\.hk_member_prefs \(business_id, user_id, avatar_slot\)\nVALUES \('981b790c-a3b0-4265-b32e-1f701d5731ff', '68e2a844-90c2-4051-b2f9-1604c81fc8b3', 1\)\nON CONFLICT \(business_id, user_id\) DO NOTHING;/);
  assert.equal((sql.match(/INSERT INTO/g) || []).length, 2, 'no mockup data seeded');
  assert.doesNotMatch(sql, /stats_confirmed_at\)|stats_confirmed_at,/, 'stats_confirmed_at is not seeded');
});

test('pg_trgm index is guarded by pg_extension, never required', () => {
  assert.match(sql, /IF EXISTS \(SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'\) THEN\s+EXECUTE 'CREATE INDEX IF NOT EXISTS hk_brands_normalized_name_trgm_idx/);
  assert.doesNotMatch(sql, /CREATE EXTENSION/);
});
