// One-off (Jack's ruling, Nov 3): write momentum4all.org to Momentum's domain through the connector's own add_client
// (makeClient fills an empty domain, logs a client event = Activity row with Undo), then check_upside_owned on it.
// SCOPE: 1 employer row (Momentum), 1 sales_client_events row. Claude 0 · Apollo 0 · sends 0. Runtime < 10 s.
// Not restored on purpose: the domain is Jack's data and stays; the event's Undo reverts it.
import { createRequire } from 'module';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { runTool } = await import('../../api/hlconnect/tools.js');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const HL = must(await svc.from('businesses').select('id').ilike('name', 'homelover'))[0].id;
const owner = must(await svc.from('business_members').select('user_id').eq('business_id', HL).eq('role', 'owner'))[0].user_id;
const mom = must(await svc.from('sales_opportunities').select('id, organization, domain, client_status').eq('business_id', HL).ilike('organization', 'momentum%').is('archived_at', null));
if (mom.length !== 1) throw new Error(`expected one Momentum, got ${mom.length}`);
console.log('before: domain', mom[0].domain ?? 'none', '· status', mom[0].client_status);
const ctx = { auth: { user: { id: owner } }, businessId: HL, origin: 'https://prospector-chtj.onrender.com', d: { supabase: svc } };
const parse = r => JSON.parse(r.content[0].text);
if (!mom[0].domain) {
  const w = parse(await runTool(ctx, 'add_client', { company_name: mom[0].organization, status: mom[0].client_status, domain: 'momentum4all.org', source_type: 'partner', referred_by_partner: 'HUB International' }));
  console.log('add_client:', JSON.stringify({ result: w.result, matched_by: w.matched_by, unchanged: w.unchanged, error: w.error, warnings: w.warnings }));
}
const after = must(await svc.from('sales_opportunities').select('domain').eq('id', mom[0].id).single());
const ev = must(await svc.from('sales_client_events').select('id, kind, via, at').eq('opportunity_id', mom[0].id).order('at', { ascending: false }).limit(1));
console.log('after: domain', after.domain, '· last event', ev[0]?.kind, ev[0]?.via, ev[0]?.id);
const c = parse(await runTool(ctx, 'check_upside_owned', { domains: ['momentum4all.org'] }));
console.log('check_upside_owned:', JSON.stringify(c));
