// node --test api/hk/legacyCarry.test.mjs
// hk-legacy-cleanup-v1 Stage 1 - the carried HumanKind strategy holds no address, phone or handle, and the lint seed
// has the shape lint_draft (hkos-data-foundation-v1) will read. Reads the two files only; no DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hasPii } from '../sales/scrubText.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const SEED = path.join(ROOT, 'api', 'hk', 'lintSeed.json');
const CARRY = path.join(ROOT, 'specs', 'playbook', 'humankind-legacy-carry.txt');

test('lintSeed.json parses: >= 10 banned words, >= 5 banned patterns with ids, pillars / ask rules present', () => {
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  assert.ok(seed.banned_words.length >= 10, `banned_words ${seed.banned_words.length}`);
  assert.ok(seed.banned_patterns.length >= 5, `banned_patterns ${seed.banned_patterns.length}`);
  assert.equal(new Set(seed.banned_patterns.map(p => p.id)).size, seed.banned_patterns.length, 'pattern ids unique');
  for (const p of seed.banned_patterns) assert.ok(p.id && p.rule && p.source, JSON.stringify(p));
  for (const w of seed.banned_words) assert.equal(w, w.toLowerCase().trim());
  assert.match(seed.pillars_rule, /3 most relevant/);
  assert.match(seed.ask_rule, /15-minute call/);
});

test('no PII in the carry file or the seed: hasPii false line by line, no @, no instagram / linkedin profile paths', () => {
  for (const f of [CARRY, SEED]) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    const bad = lines.map((l, i) => [i + 1, l]).filter(([, l]) => hasPii(l) || /@/.test(l) || /instagram\.com\/|linkedin\.com\/in\//i.test(l));
    assert.deepEqual(bad.map(([n]) => `${path.relative(ROOT, f)}:${n}`), []);
  }
});

test('the carry file marks the stale stats and points at hk_settings', () => {
  const txt = fs.readFileSync(CARRY, 'utf8');
  assert.match(txt, /STALE 1,000\+ \/ 4,000\+/);
  assert.match(txt, /hk_settings 1,500\+ \/ 6,000\+/);
  assert.ok(txt.length > 5000);
});
