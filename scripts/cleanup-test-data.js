#!/usr/bin/env node
'use strict';
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// cleanup-test-data.js — standing cleanup for anything created during live
// verification, replacing the per-test bespoke delete script. Convention:
// every project/list/account created for a live test is named starting
// with "TEST-" going forward. This script finds and deletes everything
// matching that prefix across every table it can land in.
//
// Usage:
//   node scripts/cleanup-test-data.js --dry-run   (report only, delete nothing)
//   node scripts/cleanup-test-data.js             (actually delete)

const supabase = createClient(process.env.REACT_APP_SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY);
const dryRun = process.argv.includes('--dry-run');

async function cleanupProjects() {
  const { data: projects, error } = await supabase.from('projects').select('id, name, list_id').ilike('name', 'TEST-%');
  if (error) { console.error('projects query failed:', error.message); return 0; }
  console.log(`projects: ${projects.length} matched`);
  for (const p of projects) {
    console.log(`  - "${p.name}" (${p.id})${p.list_id ? ` — linked list ${p.list_id}` : ''}`);
    if (!dryRun) {
      await supabase.from('projects').delete().eq('id', p.id);
      if (p.list_id) {
        await supabase.from('account_lists').delete().eq('list_id', p.list_id);
        await supabase.from('lists').delete().eq('id', p.list_id);
      }
    }
  }
  return projects.length;
}

// Standalone TEST- lists not already deleted via a project above (a test
// might create a list without a project, or the project's list_id link
// could be stale) - re-check lists directly so nothing's missed.
async function cleanupLists() {
  const { data: lists, error } = await supabase.from('lists').select('id, name').ilike('name', 'TEST-%');
  if (error) { console.error('lists query failed:', error.message); return 0; }
  console.log(`lists (standalone, not already removed above): ${lists.length} matched`);
  for (const l of lists) {
    console.log(`  - "${l.name}" (${l.id})`);
    if (!dryRun) {
      await supabase.from('account_lists').delete().eq('list_id', l.id);
      await supabase.from('lists').delete().eq('id', l.id);
    }
  }
  return lists.length;
}

// accounts.data is jsonb - name lives inside it, not a real column, so this
// needs a full scan + JS-side filter rather than a server-side ilike.
async function cleanupAccounts() {
  const { data: accounts, error } = await supabase.from('accounts').select('id, data');
  if (error) { console.error('accounts query failed:', error.message); return 0; }
  const testAccounts = accounts.filter(a => typeof a.data?.name === 'string' && a.data.name.startsWith('TEST-'));
  console.log(`accounts: ${testAccounts.length} matched`);
  for (const a of testAccounts) {
    console.log(`  - "${a.data.name}" (${a.id})`);
    if (!dryRun) {
      await supabase.from('account_lists').delete().eq('account_id', a.id);
      await supabase.from('accounts').delete().eq('id', a.id);
    }
  }
  return testAccounts.length;
}

async function main() {
  console.log(dryRun ? 'DRY RUN — reporting matches only, nothing will be deleted\n' : 'LIVE RUN — matched rows will be deleted\n');
  const counts = {
    projects: await cleanupProjects(),
    lists: await cleanupLists(),
    accounts: await cleanupAccounts(),
  };
  console.log(`\nTotal matched: ${Object.values(counts).reduce((a, b) => a + b, 0)}`);
  console.log(dryRun ? 'Re-run without --dry-run to actually delete.' : 'Cleanup complete.');
}

main();
