#!/usr/bin/env node
'use strict';
const fs   = require('fs');
const path = require('path');

const WARN_LINES  = 1500;
const BLOCK_LINES = 3000;

// Pure data/constants files — size is expected, exempt from line-limit checks
const EXEMPT_FILES = [
  'approvalMatrix.js',  // large data constants file — size is expected
  'products.js',        // product definitions — size is expected
  'colors.js',          // color constants
  'seedData.js',        // seed/fixture data — size is expected
  'pricingProducts.js', // pricing product definitions
  'voiceConfig.js',     // voice/tone configuration
];

const isReport = process.argv.includes('--report');

function countLines(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').length;
  } catch {
    return 0;
  }
}

function walk(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !['node_modules', 'build', '.git'].includes(entry.name)) {
      walk(full, results);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(full);
    }
  }
  return results;
}

const srcDir = path.join(__dirname, '..', 'src');
const files  = walk(srcDir);

// Sort by line count descending for report
const counted = files
  .map(f => ({ file: path.relative(srcDir, f), lines: countLines(f) }))
  .sort((a, b) => b.lines - a.lines);

if (isReport) {
  const col = (s, w) => String(s).padEnd(w);
  console.log('\n' + col('File', 42) + col('Lines', 10) + 'Status');
  console.log('─'.repeat(62));
  for (const { file, lines } of counted) {
    const exempt = EXEMPT_FILES.some(e => file.endsWith(e));
    const status = exempt                ? '⬜ Exempt (constants)'
                 : lines > BLOCK_LINES  ? '🔴 Split immediately (>3000)'
                 : lines > WARN_LINES   ? '🟠 Consider splitting (>1500)'
                 : lines > 500          ? '🟡 Watch'
                 :                        '🟢 OK';
    console.log(col(file, 42) + col(lines, 10) + status);
  }
  console.log();
  process.exit(0);
}

// Pre-commit mode: check for oversized files
let blocked = false;
let warned  = false;

for (const { file, lines } of counted) {
  if (EXEMPT_FILES.some(exempt => file.endsWith(exempt))) continue;
  if (lines > BLOCK_LINES) {
    console.error(`\n✗  ${file} is ${lines} lines — too large to commit. Split before pushing.\n`);
    blocked = true;
  } else if (lines > WARN_LINES) {
    console.warn(`⚠  ${file} is ${lines} lines — consider splitting. Run npm run size-report for suggestions.\n`);
    warned = true;
  }
}

if (!blocked && !warned) {
  console.log('✓  All source files are within size limits.');
}

process.exit(blocked ? 1 : 0);
