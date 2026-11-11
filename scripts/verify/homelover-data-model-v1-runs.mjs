// AUDIT homelover-data-model-v1 A4 - READ-ONLY: the run tables' freshness by trigger + the tables PostgREST exposes
// that no migration creates. Declared: ~12 small selects + 1 OpenAPI GET (~300 KB), < 20 s; cap 60 s.
import fs from 'fs';
import { svc, HL, cap, footer } from './homelover-data-model-v1-lib.mjs';
cap(60);
const S = process.argv[2];
const show = async (t, cols, key, stamp, biz = true) => { let q = svc.from(t).select(cols); if (biz) q = q.eq('business_id', HL); const { data, error } = await q.order(stamp, { ascending: false }).limit(1000); if (error) return console.log(`${t}: ${error.message}`); const m = new Map(); for (const r of data) { const k = key(r); const e = m.get(k) || { n: 0, last: r[stamp] }; e.n += 1; m.set(k, e); } console.log(`${t}: ` + [...m.entries()].map(([k, v]) => `${k} x${v.n} (last ${String(v.last).slice(0, 16)})`).join(' · ')); };
await show('sales_sync_runs', '*', r => `${r.trigger}/${r.status}`, 'started_at');
await show('microsoft_sync_runs', '*', r => `${r.trigger ?? r.kind ?? '?'}/${r.status}`, 'started_at');
await show('visit_pull_runs', '*', r => `${r.kind}/${r.trigger ?? '?'}/${r.status}`, 'la_date');
await show('sales_tidy_runs', '*', r => `${r.trigger}/${r.status ?? '?'}`, 'started_at');
await show('sales_job_slots', '*', r => `${r.job}${r.business_id === HL ? '' : ' (other/none)'}/${r.status ?? '?'}`, 'la_date', false);
await show('sales_team_email_sends', '*', r => `${r.kind}/${r.status}/${r.trigger ?? '?'}`, 'created_at');
await show('apollo_credit_spend', '*', r => `${r.purpose ?? r.kind ?? r.source ?? '?'}`, 'created_at');
const one = async t => console.log(`${t} columns: ` + Object.keys((await svc.from(t).select('*').limit(1)).data?.[0] || {}).join(', '));
for (const t of ['sales_sync_runs', 'microsoft_sync_runs', 'visit_pull_runs', 'sales_tidy_runs', 'sales_job_slots', 'apollo_credit_spend']) await one(t);
const res = await fetch(process.env.SUPABASE_URL + '/rest/v1/', { headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_KEY } });
const api = await res.json();
const exposed = Object.keys(api.definitions || {}).filter(t => !t.startsWith('hk_'));
const mig = new Set(fs.readFileSync(S + '/tables_mig.txt', 'utf8').split('\n').filter(Boolean));
console.log(`\nPostgREST exposes ${exposed.length} non-other-workspace tables/views; not created by any migration file: ${exposed.filter(t => !mig.has(t)).join(', ') || 'none'}`);
for (const t of exposed.filter(t => !mig.has(t))) { const c = await svc.from(t).select('*', { count: 'exact', head: true }); console.log(`  ${t}: ${c.count ?? c.error?.message} rows · columns ${Object.keys(api.definitions[t].properties || {}).join(', ').slice(0, 200)}`); }
footer();
