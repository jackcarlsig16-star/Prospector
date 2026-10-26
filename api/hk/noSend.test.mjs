import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

// hkos-project-shell-v1 S12 - Prospector never sends email. Any send call anywhere in the app fails this test;
// there is no allowlist. The needles are split so this file doesn't match itself.
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const NEEDLES = ['drafts' + '.send', 'messages' + '.send', '/drafts' + '/send', '/messages' + '/send', 'send' + 'Mail'];
const SOURCE = /\.(m?js|cjs|jsx|ts|tsx)$/;

const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === 'node_modules' ? [] : files(p);
  return SOURCE.test(e.name) ? [p] : [];
});

test('no send path in api/, src/ or server.js', () => {
  const hits = [];
  for (const f of [...files(path.join(ROOT, 'api')), ...files(path.join(ROOT, 'src')), path.join(ROOT, 'server.js')]) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      for (const n of NEEDLES) if (line.includes(n)) hits.push(`${path.relative(ROOT, f)}:${i + 1} ${n}`);
    });
  }
  assert.deepEqual(hits, []);
});

// hkos-data-foundation-v1 Stage 2 - the scan walks api/hk/** (the new route files included), and hk_replies.from_email
// is named nowhere in api/hk route code: the one serializer (hkShared.replyRow) picks a column list that leaves it out,
// so no handler can add it back by accident.
test('api/hk/** is in the walk and never names from_email outside a comment', () => {
  const hk = files(path.join(ROOT, 'api', 'hk')).filter(f => !/\.test\.mjs$|testing\.mjs$/.test(f));
  assert.ok(hk.length >= 6, `hk files walked: ${hk.length}`);
  const hits = [];
  for (const f of hk) fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => { if (line.includes('from' + '_email') && !/^\s*\/\//.test(line)) hits.push(`${path.relative(ROOT, f)}:${i + 1}`); });
  assert.deepEqual(hits, []);
});
