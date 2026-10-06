#!/usr/bin/env node
'use strict';
// Pre-commit: fail on undefined names in staged .js files. `npm run build`
// runs with DISABLE_ESLINT_PLUGIN=true, so an undefined variable otherwise
// compiles fine and only crashes the screen that renders it (a Huddle crash
// from a removed BRIEFING_MAX was caught this way, 2026-10-06).
//   node scripts/check-undef.js          staged files
//   node scripts/check-undef.js --all    every .js file under src/ api/ scripts/
const { execSync } = require('child_process');
const fs = require('fs');
const { ESLint } = require('eslint');

const all = process.argv.includes('--all');
const list = all
  ? execSync('git ls-files -- "src/*.js" "api/*.js" "scripts/*.js"', { encoding: 'utf8' })
  : execSync('git diff --cached --name-only --diff-filter=ACMR -- "src/*.js" "api/*.js" "scripts/*.js"', { encoding: 'utf8' });
const files = list.split('\n').filter(f => f && fs.existsSync(f));
if (!files.length) process.exit(0);

(async () => {
  const eslint = new ESLint({
    useEslintrc: false,
    overrideConfig: {
      parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
      env: { browser: true, node: true, es2022: true, jest: true },
      plugins: ['react', 'react-hooks'],
      rules: { 'no-undef': 'error', 'react/jsx-no-undef': 'error' },
    },
  });
  const results = await eslint.lintFiles(files);
  const bad = results.filter(r => r.errorCount);
  if (!bad.length) { console.log(`✓  No undefined names in ${files.length} file${files.length === 1 ? '' : 's'}.`); return; }
  for (const r of bad) for (const m of r.messages) console.error(`✖  ${r.filePath.replace(process.cwd() + '/', '')}:${m.line}:${m.column}  ${m.message}`);
  console.error(`\n${bad.reduce((n, r) => n + r.errorCount, 0)} undefined name(s) - fix before committing.`);
  process.exit(1);
})().catch(e => { console.error('check-undef failed:', e.message); process.exit(1); });
