// node --test api/sales/targetsSourceCheck.test.mjs
// FIX targets-source-check-v1 - the migration restores the sales_targets.source value list under a DISTINCT name,
// and no later migration reuses sales_targets_source_check (the source_kind shape) for anything else. Reads the
// migration files only; no DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../supabase/migrations');
const read = f => fs.readFileSync(path.join(DIR, f), 'utf8');
const VALUES = ['note', 'scout', 'web_visit', 'manual'];
// The two migrations that (re)create sales_targets_source_check as the source_kind shape: the loop that dropped the
// signals-v1 value list, and lead-upload-v1 widening it with 'apollo'.
const KNOWN = ['20261022_lead_source_v1.sql', '20261026_lead_upload_v1.sql'];

test('20261026_targets_source_value_check.sql: guard, distinct constraint name, the four signals-v1 values, nothing else dropped', () => {
  const sql = read('20261026_targets_source_value_check.sql');
  assert.match(sql, /RAISE EXCEPTION/);
  assert.match(sql, /ADD CONSTRAINT sales_targets_source_value_check\s+CHECK \(source IN \('note', 'scout', 'web_visit', 'manual'\)\)/);
  for (const v of VALUES) assert.match(sql, new RegExp(`'${v}'`));
  assert.doesNotMatch(sql, /DROP CONSTRAINT IF EXISTS sales_targets_source_check\b/, 'the source_kind check stays as lead-source-v1 wrote it');
  assert.doesNotMatch(sql, /'apollo'|'upload'/, 'the value list is not widened here');
  assert.match(sql, /Never reuse it/, 'the naming rule is in the file header');
});

test('no migration after 20261022 adds a constraint named sales_targets_source_check except the two known ones', () => {
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.sql') && f >= '20261022').sort();
  assert.ok(files.length >= 3, 'the lead-source / lead-upload migrations are present');
  const offenders = files.filter(f => {
    const sql = read(f);
    // Literal name, or the loop form: FOREACH ... 'sales_targets' ... || '_source_check'.
    const literal = /ADD CONSTRAINT sales_targets_source_check\b/.test(sql);
    const loop = /FOREACH[\s\S]*?'sales_targets'[\s\S]*?\|\| '_source_check'/.test(sql);
    return (literal || loop) && !KNOWN.includes(f);
  });
  assert.deepEqual(offenders, []);
  // The two known ones are still the source_kind shape, which is what the rule protects.
  for (const f of KNOWN) assert.match(read(f), /source_kind IS NULL OR source_kind IN/);
});
