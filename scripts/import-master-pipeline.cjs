#!/usr/bin/env node
'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// master-pipeline-import-v1 - the master sheet's two CSVs into one workspace.
//   node scripts/import-master-pipeline.cjs <businessId> <accounts.csv> <contacts.csv> [--apply] [--accept-possible <record_id> ...] [--json <file>]
// A DRY RUN unless --apply: reads the workspace (one pass, ~9 queries),
// prints what would change and writes nothing. --apply writes exactly that
// plan. 0 Apollo / 0 Claude. Reports name record_id + account name only.

const USAGE = 'usage: import-master-pipeline.cjs <businessId> <accounts.csv> <contacts.csv> [--apply] [--accept-possible <record_id> ...] [--json <file>]';

async function main() {
  const args = process.argv.slice(2);
  const flags = { apply: false, acceptPossible: [], json: null };
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') flags.apply = true;
    else if (args[i] === '--accept-possible') flags.acceptPossible.push(args[++i]);
    else if (args[i] === '--json') flags.json = args[++i];
    else pos.push(args[i]);
  }
  const [businessId, accountsFile, contactsFile] = pos;
  if (!businessId || !accountsFile || !contactsFile) { console.error(USAGE); process.exit(2); }

  const { readInput, loadState, plan, applyPlan, ImportRefused } = await import(path.join(__dirname, '../api/sales/masterImport.js'));
  let input;
  try { input = readInput(fs.readFileSync(accountsFile, 'utf8'), fs.readFileSync(contactsFile, 'utf8')); }
  catch (e) { if (e instanceof ImportRefused) { console.error(`REFUSED: ${e.message}`); process.exit(1); } throw e; }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: biz, error } = await supabase.from('businesses').select('id, name').eq('id', businessId).maybeSingle();
  if (error || !biz) { console.error(`workspace ${businessId} not found`); process.exit(1); }
  const people = [...input.contacts.values()].reduce((n, l) => n + l.length, 0);
  console.log(`${flags.apply ? 'APPLY' : 'DRY RUN'} into "${biz.name}": ${input.accounts.length} valid accounts, ${input.invalid.length} invalid, ${people} contacts. 0 Apollo / 0 Claude.`);

  const state = await loadState(supabase, businessId);
  const result = plan(state, input, { acceptPossible: flags.acceptPossible });
  const r = result.report;
  console.log('\nRoutes:', JSON.stringify(r.counts));
  console.log('Contacts:', JSON.stringify(r.contacts), '· to-dos:', r.todos);
  const list = (title, rows, fmt) => { console.log(`\n${title} (${rows.length})`); for (const x of rows) console.log(`  ${x.record_id}  ${x.name}  ${fmt(x)}`); };
  list('Partner stages - sheet vs Prospector, never applied', r.partner_stages, x => `sheet ${x.dir}: ${x.sheet} (Prospector ${x.prospector})`);
  list('Employer stage moves', r.opp_stage_moves, x => `${x.from} -> ${x.to}`);
  list('Employer stage refused', r.opp_stage_refused, x => `${x.reason}`);
  list('Field differences - Prospector kept', r.differences, x => `${x.field}: Prospector "${x.prospector}" / sheet "${x.sheet}"`);
  list('Possibles - not matched', r.possibles, x => x.possible);
  list('Kind mismatches - stays the partner', r.kind_mismatches, x => `sheet ${x.sheet_kind}, Prospector ${x.prospector}`);
  list('Skipped', r.skipped, x => x.reason);
  list('Invalid rows', r.invalid, x => x.reason);
  if (flags.json) fs.writeFileSync(flags.json, JSON.stringify(result, null, 2));

  if (!flags.apply) { console.log('\nNothing written (dry run). Re-run with --apply to write.'); return; }
  const done = await applyPlan(supabase, businessId, result);
  console.log('\nWritten:', JSON.stringify({ ...done, errors: done.errors.length }));
  for (const e of done.errors) console.log(`  ERROR ${e.record_id}  ${e.name}  ${e.error}`);
  if (done.errors.length) process.exit(1);
}

main().catch(e => { console.error(e.message); process.exit(1); });
