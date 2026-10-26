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
