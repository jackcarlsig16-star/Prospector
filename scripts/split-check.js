#!/usr/bin/env node
'use strict';
const fs   = require('fs');
const path = require('path');

// Scan src/ for component-level function definitions and estimate extractability
const srcDir  = path.join(__dirname, '..', 'src');
const appFile = path.join(srcDir, 'App.js');

if (!fs.existsSync(appFile)) {
  console.error('App.js not found at', appFile);
  process.exit(1);
}

const lines = fs.readFileSync(appFile, 'utf8').split('\n');
const total = lines.length;

// Find top-level function/component definitions
const componentRe = /^function ([A-Z][A-Za-z]+)\s*\(/;
const constRe     = /^(?:const|let) ([A-Z][A-Z_0-9]+)\s*=/;

const components = [];
for (let i = 0; i < lines.length; i++) {
  const cm = lines[i].match(componentRe);
  if (cm) {
    components.push({ name: cm[1], startLine: i + 1, type: 'component' });
  }
}

// Estimate each component's size by counting to the next top-level component
for (let i = 0; i < components.length; i++) {
  const next = components[i + 1];
  const end  = next ? next.startLine - 1 : total;
  components[i].lines = end - components[i].startLine + 1;
}

// Identify extraction candidates (>200 lines, not already extracted)
const alreadyExtracted = new Set(
  ['App'].concat(
    fs.existsSync(path.join(srcDir, 'components'))
      ? fs.readdirSync(path.join(srcDir, 'components')).map(f => f.replace('.js', ''))
      : []
  )
);

const candidates = components
  .filter(c => c.lines > 200 && !alreadyExtracted.has(c.name))
  .sort((a, b) => b.lines - a.lines);

console.log(`\n📋  App.js split suggestions (${total} total lines)\n`);
console.log('─'.repeat(62));

if (candidates.length === 0) {
  console.log('  No large inline components found — App.js looks well-factored!\n');
} else {
  for (const c of candidates) {
    const savings = Math.round(c.lines);
    console.log(`  Extracting ${c.name}`);
    console.log(`    → would save ~${savings} lines from App.js`);
    console.log(`    → suggest: src/components/${c.name}.js`);
    console.log(`    → starts at line ${c.startLine}\n`);
  }
}

console.log('─'.repeat(62));
const extractable = candidates.reduce((s, c) => s + c.lines, 0);
console.log(`  After all extractions: App.js would be ~${total - extractable} lines\n`);
