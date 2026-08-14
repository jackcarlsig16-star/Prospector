#!/usr/bin/env node
'use strict';
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Lists who would get a real Supabase Auth invite - does NOT send anything.
// Union of approved_users (the allowlist) and team_users where status='approved'
// (people who already onboarded and got approved), deduped case-insensitively.
// Run: node scripts/list-invite-candidates.js
// Requires SUPABASE_URL and SUPABASE_SERVICE_KEY (server-side pair, not the
// REACT_APP_* client-side ones) - set in a local .env or exported in your shell.

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.error('[list-invite-candidates] SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.');
  process.exit(1);
}

const supabase = createClient(url, key);

async function main() {
  const { data: approved, error: approvedErr } = await supabase
    .from('approved_users')
    .select('email');
  if (approvedErr) {
    console.error('[list-invite-candidates] approved_users query failed:', approvedErr.message);
    process.exit(1);
  }

  const { data: teamApproved, error: teamErr } = await supabase
    .from('team_users')
    .select('email')
    .eq('status', 'approved');
  if (teamErr) {
    console.error('[list-invite-candidates] team_users query failed:', teamErr.message);
    process.exit(1);
  }

  const seen = new Map(); // lowercase -> original casing, first seen wins
  for (const row of [...(approved || []), ...(teamApproved || [])]) {
    const raw = (row.email || '').trim();
    if (!raw) continue;
    const lower = raw.toLowerCase();
    if (!seen.has(lower)) seen.set(lower, raw);
  }

  const emails = [...seen.values()].sort((a, b) => a.localeCompare(b));

  console.log(`\n${emails.length} distinct email(s) would be invited:\n`);
  emails.forEach(e => console.log(`  - ${e}`));
  console.log('\nThis script only lists candidates - it does not call inviteUserByEmail. Nothing was sent.\n');
}

main();
