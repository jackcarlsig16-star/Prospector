// FIX visitor-people-filing-v1 - the live check on HomeLover. DECLARED before it runs:
//   default (no flag)  READ-ONLY snapshot: ~14 Supabase GETs, 0 Apollo, 0 writes (a non-GET throws), cap 60 s.
//   --pull             the snapshot, then ONE forced visitor-people pull as the platform owner through the working
//                      tree's runVisitorPeoplePull (the same function "Pull visitor people now" calls), then the
//                      snapshot again. Apollo: the pull's own calls only - GET users/api_profile (balance) and POST
//                      contacts/search, 0 credits, HARD CAP 6 (a 7th or any other path throws). Claude 0. Supabase
//                      writes = the pull's: sales_people rows (expected about +97), sales_targets only for a company
//                      web_visits holds that passes the rule (named), its run row, the settings state, one spend row.
//                      Cap 4 min. These rows are the FIX's intended result - nothing is restored afterwards.
//   Prints names and companies only - never an address or phone.
import { createRequire } from 'module';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
delete process.env.ANTHROPIC_API_KEY;
const PULL = process.argv.includes('--pull');
const APOLLO_CAP = 6;
setTimeout(() => { console.log(`ABORT ${PULL ? '4 min' : '60 s'} cap`); process.exit(2); }, PULL ? 240000 : 60000).unref();
const supaHost = new URL(process.env.SUPABASE_URL).host;
const net = { gets: 0, writes: 0, apollo: [], refused: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = (init.method || 'GET').toUpperCase();
  if (url.host === supaHost) {
    if (['GET', 'HEAD'].includes(method)) { net.gets++; return realFetch(input, init); }
    if (PULL) { net.writes++; return realFetch(input, init); }
  }
  const apolloOk = (method === 'GET' && url.pathname.endsWith('/users/api_profile')) || (method === 'POST' && url.pathname.endsWith('/contacts/search'));
  if (PULL && url.host === 'api.apollo.io' && apolloOk && net.apollo.length < APOLLO_CAP) { net.apollo.push(`${method} ${url.pathname}`); return realFetch(input, init); }
  net.refused.push(`${method} ${url.host}${url.pathname}`);
  throw new Error(`guard: refused ${method} ${url.host}${url.pathname}`);
};
const { createClient } = require('@supabase/supabase-js');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const { runVisitorPeoplePull, peopleState } = await import('../../api/sales/visitorPeoplePull.js');
const { salesSettings } = await import('../../api/sales/visitorRoutes.js');
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data[0].id;
const count = async (table, build = q => q) => { const r = await build(svc.from(table).select('id', { count: 'exact', head: true }).eq('business_id', HL)); if (r.error) throw new Error(`${table}: ${r.error.message}`); return r.count; };
const noAt = s => String(s ?? '').replace(/\S*@\S*/g, '[address]');

async function snapshot() {
  const [people, peopleLive, noRecord, visitors, targets, opportunities, partners] = await Promise.all([
    count('sales_people'), count('sales_people', q => q.is('archived_at', null)), count('sales_people', q => q.eq('company_type', 'parked').is('archived_at', null)),
    count('sales_people', q => q.eq('source_kind', 'web_visit').is('archived_at', null)), count('sales_targets'), count('sales_opportunities'), count('sales_goals', q => q.eq('goal_type', 'partnership')),
  ]);
  return { sales_people: people, people_live: peopleLive, people_without_record: noRecord, identified_visitors_live: visitors, sales_targets: targets, sales_opportunities: opportunities, sales_goals_partners: partners };
}
const line = s => Object.entries(s).map(([k, v]) => `${k} ${v}`).join(' · ');

const state = peopleState(await salesSettings(svc, HL));
console.log(`== mode: ${PULL ? 'ONE forced pull' : 'read-only'} · list "${state.list_name}" · cached count ${state.list_count} · last pull ${state.last_pull_on}`);
console.log(`last_counts ${JSON.stringify(state.last_counts)}`);
const runs = await svc.from('visit_pull_runs').select('la_date, status, calls, credits, error, updated_at').eq('business_id', HL).eq('kind', 'people').order('la_date', { ascending: false }).limit(5);
for (const r of runs.data || []) console.log(`run ${r.la_date} · ${r.status} · calls ${r.calls} · credits ${r.credits} · updated ${r.updated_at}${r.error ? ` · error ${noAt(r.error).slice(0, 80)}` : ''}`);

const before = await snapshot();
console.log(`\n== BEFORE  ${line(before)}`);

// Targets the people filer made on earlier pulls (source web_visit, no visit row of their own) - listed, never touched.
const filerTargets = await svc.from('sales_targets').select('id, name, status, employees, visit_id, created_at, evidence').eq('business_id', HL).eq('source', 'web_visit').is('visit_id', null).order('created_at', { ascending: false }).limit(300);
if (filerTargets.error) throw new Error(filerTargets.error.message);
const sizeless = filerTargets.data.filter(t => t.employees == null);
console.log(`\n== targets the people filer created on earlier pulls: ${filerTargets.data.length} (headcount unknown: ${sizeless.length}) - NOT touched`);
const byDay = {};
for (const t of filerTargets.data) { const d = t.created_at.slice(0, 10); (byDay[d] = byDay[d] || []).push(t); }
for (const [d, ts] of Object.entries(byDay)) console.log(`  ${d} (UTC) · ${ts.length}: ${ts.map(t => `${noAt(t.name)}${t.employees == null ? ' [size ?]' : ` [${t.employees}]`}${t.status !== 'researching' ? ` (${t.status})` : ''}`).join('; ')}`);

if (PULL) {
  const owners = await svc.from('profiles').select('id').eq('is_platform_owner', true);
  if (owners.error || owners.data.length !== 1) throw new Error('expected exactly one platform owner profile');
  const started = new Date().toISOString();
  const r = await runVisitorPeoplePull(svc, { businessId: HL, userId: owners.data[0].id, force: true });
  console.log(`\n== THE PULL  status ${r.status} · ran ${r.body.ran} · Apollo calls ${r.body.calls} (guard saw ${net.apollo.length}: ${net.apollo.join(', ')}) · credits ${r.body.credits}`);
  if (r.status !== 200 || !r.body.ran) { console.log(noAt(JSON.stringify(r.body)).slice(0, 600)); process.exit(1); }
  console.log(`list "${r.body.list.name}" holds ${r.body.list.count} contacts (this read)`);
  console.log(`counts ${JSON.stringify(r.body.counts)}`);
  const created = r.body.companies.filter(c => c.action === 'created');
  console.log(`records CREATED: ${created.length}${created.length ? ` - ${created.map(c => `${noAt(c.name)} (${c.reason})`).join('; ')}` : ''}`);
  const linked = r.body.companies.filter(c => c.action === 'matched' && c.people_added);
  console.log(`companies whose new people were LINKED to an existing record: ${linked.length}${linked.length ? ` - ${linked.map(c => `${noAt(c.name)} (${c.type}, +${c.people_added})`).join('; ')}` : ''}`);
  const fresh = await svc.from('sales_people').select('name, company_type, company_name, source_kind, apollo_person_id, target_id, opportunity_id, note, source_note, title').eq('business_id', HL).gte('created_at', started).order('created_at');
  if (fresh.error) throw new Error(fresh.error.message);
  console.log(`\n== NEW sales_people rows: ${fresh.data.length} (names only)`);
  console.log(fresh.data.map(p => noAt(p.name)).join(' · '));
  console.log(`Seth Whitworth among them: ${fresh.data.some(p => p.name === 'Seth Whitworth')}`);
  console.log(`every new row: source_kind web_visit ${fresh.data.every(p => p.source_kind === 'web_visit')} · an Apollo id ${fresh.data.every(p => p.apollo_person_id)} · no "@" in any field ${!/@/.test(JSON.stringify(fresh.data))} · on a record ${fresh.data.filter(p => p.target_id || p.opportunity_id).length} · company name only ${fresh.data.filter(p => p.company_type === 'parked').length}`);
  const partnerNew = await svc.from('partner_contacts').select('name, goal_id, role_in_notes, source').eq('business_id', HL).gte('first_seen', started);
  if (partnerNew.error) throw new Error(partnerNew.error.message);
  for (const c of partnerNew.data) { const g = (await svc.from('sales_goals').select('name').eq('id', c.goal_id).maybeSingle()).data; console.log(`visitor filed on a PARTNER: ${noAt(c.name)} -> ${noAt(g?.name)} · marker ${c.role_in_notes} · source ${c.source}`); }
  console.log(`new partner_contacts (visitors filed on a partner): ${partnerNew.data.length}`);
  // The pull schedules its score recompute in the background; give it a bounded moment before the process ends.
  await new Promise(res => setTimeout(res, 20000));
  const after = await snapshot();
  console.log(`\n== AFTER   ${line(after)}`);
  console.log(`== DELTA   ${Object.keys(after).map(k => `${k} ${after[k] - before[k] >= 0 ? '+' : ''}${after[k] - before[k]}`).join(' · ')}`);
}
const seth = await svc.from('sales_people').select('name, company_type, company_name, target_id, opportunity_id, source_kind, created_at, archived_at').eq('business_id', HL).eq('name', 'Seth Whitworth');
for (const p of seth.data || []) {
  const rec = p.target_id ? (await svc.from('sales_targets').select('name, status, employees, created_at').eq('id', p.target_id).maybeSingle()).data : null;
  console.log(`\nSeth Whitworth: filed ${p.created_at} · ${p.source_kind} · ${p.company_type}${rec ? ` · on target "${noAt(rec.name)}" (${rec.status}, size ${rec.employees ?? '?'}, created ${rec.created_at})` : p.company_name ? ` · company name only "${noAt(p.company_name)}"` : ''}${p.archived_at ? ' · archived' : ''}`);
}
if (!(seth.data || []).length) console.log('\nSeth Whitworth: no sales_people row');
console.log(`\nnetwork: Supabase GETs ${net.gets} · Supabase writes ${net.writes} · Apollo ${net.apollo.length} (cap ${PULL ? APOLLO_CAP : 0}) · Claude 0 · refused ${net.refused.length}${net.refused.length ? `: ${[...new Set(net.refused)].join(', ')}` : ''}`);
process.exit(0);
