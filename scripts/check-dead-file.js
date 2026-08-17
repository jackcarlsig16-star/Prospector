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

// Extracted so --sweep can reuse it without re-printing per-file detail.
// verbose=true keeps the original single-file CLI output exactly as before.
function checkOne(relTarget, verbose) {
  if (CONVENTION_LOADED[relTarget]) {
    if (verbose) { console.log(`Checking: ${relTarget}\n`); console.log(`VERDICT: LIVE (build-tool convention)`); console.log(`Reason: ${CONVENTION_LOADED[relTarget]}`); }
    return { verdict: 'LIVE (build-tool convention)', reason: CONVENTION_LOADED[relTarget] };
  }
  if (/\.test\.js$/.test(relTarget)) {
    const reason = "picked up by Jest's test glob (*.test.js), never imported by app code - that's correct, not dead";
    if (verbose) { console.log(`Checking: ${relTarget}\n`); console.log(`VERDICT: LIVE (test file)`); console.log(`Reason: ${reason}`); }
    return { verdict: 'LIVE (test file)', reason };
  }

  const basename = path.basename(relTarget, path.extname(relTarget));
  const escaped = basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const isApiFile = relTarget.startsWith('api/');
  const excludeSelf = f => path.resolve(f) !== path.resolve(relTarget);

  if (verbose) { console.log(`Checking: ${relTarget}`); console.log(`Basename: ${basename}${isApiFile ? ' (api/ file — route registration check applies)' : ''}\n`); }

  const plainHits = grepFiles(`\\b${escaped}\\b`).filter(excludeSelf);
  if (verbose) {
    console.log(`1. Plain identifier grep: ${plainHits.length} file(s)`);
    plainHits.slice(0, 10).forEach(f => console.log(`     ${f}`));
    if (plainHits.length > 10) console.log(`     ... and ${plainHits.length - 10} more`);
  }

  const dynamicHits = grepFiles(`import\\(['"\`][^'"\`]*${escaped}(\\.js)?['"\`]\\)`).filter(excludeSelf);
  if (verbose) { console.log(`2. Dynamic import(): ${dynamicHits.length} file(s)`); dynamicHits.forEach(f => console.log(`     ${f}`)); }

  const relativeHits = grepFiles(`(from|require\\()\\s*['"\`][./][^'"\`]*${escaped}(\\.js)?['"\`]`).filter(excludeSelf);
  if (verbose) { console.log(`3. Relative-path import/require: ${relativeHits.length} file(s)`); relativeHits.forEach(f => console.log(`     ${f}`)); }

  let routeRegistered = false, routeLine = null;
  if (isApiFile) {
    const serverSrc = fs.readFileSync('server.js', 'utf8');
    const routeRe = new RegExp(`['"\`]\\.?/?${relTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`);
    const lines = serverSrc.split('\n');
    const idx = lines.findIndex(l => routeRe.test(l));
    if (idx !== -1) { routeRegistered = true; routeLine = idx + 1; }
    if (verbose) console.log(`4. server.js route registration: ${routeRegistered ? `YES (server.js:${routeLine})` : 'NOT FOUND'}`);
  }

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

  if (verbose) { console.log(`\nVERDICT: ${verdict}`); console.log(`Reason: ${reason}`); console.log(`\n(This tool only reports — it never deletes anything.)`); }
  return { verdict, reason };
}

function listJsFiles(dir) {
  const out = [];
  (function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', '.git', 'build'].includes(entry.name)) continue;
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.js')) out.push(p.replace(/\\/g, '/'));
    }
  })(dir);
  return out;
}

// --sweep <dir...> — scope-bounded testing convention (CLAUDE.md "Diagnostic
// / audit script conventions"): declare scope + a cost estimate up front,
// then watch actual pace against it instead of running silently. Built
// after this exact tool's own first full sweep ran toward 30+ minutes
// before the node_modules exclude-dir fix was found - the fix made it fast,
// but nothing would have caught a *different* slowdown early if this
// safeguard hadn't existed. MEASURED_SEC_PER_FILE below is from a real
// timed run post-fix (248 files in 55s) - update it if the tool's own
// per-file cost changes meaningfully.
const MEASURED_SEC_PER_FILE = 55 / 248;
const WARN_MULTIPLE = 3;

function sweep(dirs) {
  const files = dirs.flatMap(d => fs.existsSync(d) ? listJsFiles(d) : []);
  const estimateSec = Math.round(files.length * MEASURED_SEC_PER_FILE);
  console.log(`Sweep scope: ${files.length} files across [${dirs.join(', ')}]`);
  console.log(`Estimated cost: ~${estimateSec}s at ${MEASURED_SEC_PER_FILE.toFixed(2)}s/file (measured baseline)`);
  console.log(`Will warn if actual pace exceeds ${WARN_MULTIPLE}x this estimate.\n`);

  const start = Date.now();
  let warned = false;
  const results = { LIVE: 0, DEAD: [], AMBIGUOUS: [] };

  files.forEach((f, i) => {
    const { verdict } = checkOne(f, false);
    if (verdict.startsWith('DEAD')) results.DEAD.push(f);
    else if (verdict.startsWith('AMBIGUOUS')) results.AMBIGUOUS.push(f);
    else results.LIVE++;

    if (!warned && i > 0 && i % 25 === 0) {
      const elapsed = (Date.now() - start) / 1000;
      const projectedTotal = (elapsed / i) * files.length;
      if (projectedTotal > estimateSec * WARN_MULTIPLE) {
        warned = true;
        console.warn(`\n⚠ WARNING: ${i}/${files.length} done in ${elapsed.toFixed(0)}s - projected total ~${Math.round(projectedTotal)}s, over ${WARN_MULTIPLE}x the ${estimateSec}s estimate. Something's slower than expected - consider Ctrl-C and investigating before letting this run to completion.\n`);
      }
    }
  });

  const totalSec = (Date.now() - start) / 1000;
  console.log(`\nSwept ${files.length} files in ${totalSec.toFixed(1)}s.`);
  console.log(`LIVE: ${results.LIVE}`);
  console.log(`DEAD (${results.DEAD.length}):`);
  results.DEAD.forEach(f => console.log(`  ${f}`));
  console.log(`AMBIGUOUS (${results.AMBIGUOUS.length}):`);
  results.AMBIGUOUS.forEach(f => console.log(`  ${f}`));
  console.log(`\n(Report only - nothing was deleted.)`);
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--sweep') {
    const dirs = args.slice(1).filter(a => !a.startsWith('--'));
    sweep(dirs.length ? dirs : ['src', 'api']);
    return;
  }

  const target = args[0];
  if (!target) {
    console.error('Usage: node scripts/check-dead-file.js <path>');
    console.error('       node scripts/check-dead-file.js --sweep [dir ...]   (default: src api)');
    process.exit(1);
  }
  const relTarget = path.relative(process.cwd(), path.resolve(target)).replace(/\\/g, '/');
  if (!fs.existsSync(relTarget)) {
    console.error(`File not found: ${relTarget}`);
    process.exit(1);
  }
  checkOne(relTarget, true);
}

main();
