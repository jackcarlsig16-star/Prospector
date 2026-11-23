// FIX claude-pack-dossier Stage 0 (b)-(d) - read-only field coverage on the real sales workspace.
// DECLARED: ~14 SELECTs (counts + one-row column probes), 0 writes, 0 Claude, 0 Apollo, ~10 s, cap 60 s.
// Prints counts and column names only - never a row value.
import { createRequire } from 'module';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const timer = setTimeout(() => { console.error('cap 60 s reached - aborted'); process.exit(1); }, 60000);
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const { data: all } = await svc.from('businesses').select('id, name, features').order('created_at');
const B = all.find(b => b.features?.goals_sales).id;
const n = async (table, build = q => q) => { const r = await build(svc.from(table).select('*', { count: 'exact', head: true }).eq('business_id', B)); return r.error ? `ERR ${r.error.message}` : r.count; };
const cols = async table => { const r = await svc.from(table).select('*').eq('business_id', B).limit(1); return r.error ? `ERR ${r.error.message}` : Object.keys(r.data[0] || {}).join(', '); };

for (const [table, col] of [['sales_prospect_state', 'linkedin_url'], ['sales_people', 'linkedin_url'], ['partner_contacts', 'linkedin_url']]) {
  console.log(`${table}: ${await n(table)} rows · ${col} set on ${await n(table, q => q.not(col, 'is', null).neq(col, ''))}`);
}
console.log(`sales_email_messages: ${await n('sales_email_messages')} rows · subject set on ${await n('sales_email_messages', q => q.not('subject', 'is', null))} · sequence_id set on ${await n('sales_email_messages', q => q.not('sequence_id', 'is', null))} · step set on ${await n('sales_email_messages', q => q.not('step', 'is', null))}`);
for (const table of ['sales_prospect_state', 'sales_people', 'partner_contacts', 'sales_email_messages', 'web_visits', 'sales_opportunities', 'sales_targets', 'sales_goals', 'sales_call_notes', 'sales_sequenced_accounts']) {
  console.log(`\n${table} columns: ${await cols(table)}`);
}
clearTimeout(timer);
