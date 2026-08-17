#!/usr/bin/env node
'use strict';

// check-dead-file.js — runs the four checks that keep getting done ad hoc
// (and inconsistently) whenever "is this file actually dead" comes up:
// plain identifier grep, dynamic import(), relative-path import/require,
// and — for api/ files specifically — registration in server.js's route
// dispatch map (files under api/ are NOT auto-routed here; Render runs
// server.js as a persistent process, server.js wires each route by hand).
// Built after two real near-misses this session: api/zoom/client.js was
// nearly flagged safe-to-remove by a sweep that only checked route
// registration + a plain grep, missing a relative import from
// api/zoom/webhook.js; EmailGenerator.js was nearly called dead in an
// earlier session on a plain-grep-only check that missed its lazy-load
// site.
//
// Usage: node scripts/check-dead-file.js <path>
// Exits with a single verdict: LIVE / DEAD / AMBIGUOUS — never deletes
// anything itself.

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// execFileSync, not execSync — the pattern arg goes straight into argv with
// no shell string parsing in between. A regex containing backticks (real
// case: matching template-literal import paths) broke an earlier execSync
// version of this script, since a bare backtick inside a double-quoted
// shell string starts command substitution.
//
// --exclude-dir on node_modules/.git/build, not a post-hoc JS filter - a
// full-repo sweep (Part B2, 248 files) timed out past 30 minutes with only
// 50 files done because every one of the 3-4 greps per file was recursing
// into node_modules first and filtering after, instead of never descending
// into it at all. Confirmed live: this was the actual bottleneck, not disk
// or grep itself.
function grepFiles(pattern) {
  let out;
  try {
    out = execFileSync('grep', [
      '-rlE', pattern, '--include=*.js',
      '--exclude-dir=node_modules', '--exclude-dir=.git', '--exclude-dir=build',
      '.',
    ], { encoding: 'utf8', cwd: process.cwd() });
  } catch (e) {
    out = e.stdout || '';
  }
  return out.trim().split('\n').filter(Boolean).map(f => f.replace(/^\.\//, ''));
}

// A full-repo sweep (Part B2) flagged src/index.js, src/setupProxy.js,
// src/setupTests.js, and *.test.js as dead/ambiguous - all false positives.
// These are loaded by Create React App/webpack/Jest via exact-filename
// convention, never by an actual import/require anywhere in app code, which
// is correct behavior for them, not a sign they're unused. This tool only
// sees JS-level import/require/dynamic-import/route-registration - it
// structurally cannot see build-tool convention loading. Special-cased
// rather than left as a silent trap for the next sweep.
const CONVENTION_LOADED = {
  'src/index.js': 'webpack/CRA entry point - loaded by build config, not imported by app code',
  'src/setupProxy.js': 'auto-required by react-scripts/webpack-dev-server via exact filename, dev-server only',
  'src/setupTests.js': 'auto-loaded by CRA\'s Jest config via exact filename convention',
};

function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node scripts/check-dead-file.js <path>');
    process.exit(1);
  }
  const relTarget = path.relative(process.cwd(), path.resolve(target)).replace(/\\/g, '/');
  if (!fs.existsSync(relTarget)) {
    console.error(`File not found: ${relTarget}`);
    process.exit(1);
  }
  if (CONVENTION_LOADED[relTarget]) {
    console.log(`Checking: ${relTarget}\n`);
    console.log(`VERDICT: LIVE (build-tool convention)`);
    console.log(`Reason: ${CONVENTION_LOADED[relTarget]}`);
    return;
  }
  if (/\.test\.js$/.test(relTarget)) {
    console.log(`Checking: ${relTarget}\n`);
    console.log(`VERDICT: LIVE (test file)`);
    console.log(`Reason: picked up by Jest's test glob (*.test.js), never imported by app code - that's correct, not dead`);
    return;
  }
  const basename = path.basename(relTarget, path.extname(relTarget));
  const escaped = basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const isApiFile = relTarget.startsWith('api/');
  const excludeSelf = f => path.resolve(f) !== path.resolve(relTarget);

  console.log(`Checking: ${relTarget}`);
  console.log(`Basename: ${basename}${isApiFile ? ' (api/ file — route registration check applies)' : ''}\n`);

  // 1. Plain identifier grep — catches string refs, comments, non-import usage
  const plainHits = grepFiles(`\\b${escaped}\\b`).filter(excludeSelf);
  console.log(`1. Plain identifier grep: ${plainHits.length} file(s)`);
  plainHits.slice(0, 10).forEach(f => console.log(`     ${f}`));
  if (plainHits.length > 10) console.log(`     ... and ${plainHits.length - 10} more`);

  // 2. Dynamic import()
  const dynamicHits = grepFiles(`import\\(['"\`][^'"\`]*${escaped}(\\.js)?['"\`]\\)`).filter(excludeSelf);
  console.log(`2. Dynamic import(): ${dynamicHits.length} file(s)`);
  dynamicHits.forEach(f => console.log(`     ${f}`));

  // 3. Relative-path import/require — matches regardless of caller's own depth
  const relativeHits = grepFiles(`(from|require\\()\\s*['"\`][./][^'"\`]*${escaped}(\\.js)?['"\`]`).filter(excludeSelf);
  console.log(`3. Relative-path import/require: ${relativeHits.length} file(s)`);
  relativeHits.forEach(f => console.log(`     ${f}`));

  // 4. server.js route registration (api/ files only)
  let routeRegistered = false;
  let routeLine = null;
  if (isApiFile) {
    const serverSrc = fs.readFileSync('server.js', 'utf8');
    const routeRe = new RegExp(`['"\`]\\.?/?${relTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`);
    const lines = serverSrc.split('\n');
    const idx = lines.findIndex(l => routeRe.test(l));
    if (idx !== -1) { routeRegistered = true; routeLine = idx + 1; }
    console.log(`4. server.js route registration: ${routeRegistered ? `YES (server.js:${routeLine})` : 'NOT FOUND'}`);
  }

  // Verdict
  const strongLiveSignal = relativeHits.length > 0 || dynamicHits.length > 0 || routeRegistered;
  const weakSignal = plainHits.length > 0;
  let verdict, reason;
  if (strongLiveSignal) {
    verdict = 'LIVE';
    reason = routeRegistered ? 'registered as a real route in server.js' : 'a real import/require references it';
  } else if (weakSignal) {
    verdict = 'AMBIGUOUS — needs a human look';
    reason = `${plainHits.length} file(s) mention "${basename}" as a bare word, but no actual import/route reference found — could be a comment, a coincidental name collision, or a real reference this pattern missed`;
  } else {
    verdict = 'DEAD — candidate for removal';
    reason = 'zero references found across all four checks';
  }

  console.log(`\nVERDICT: ${verdict}`);
  console.log(`Reason: ${reason}`);
  console.log(`\n(This tool only reports — it never deletes anything.)`);
}

main();
