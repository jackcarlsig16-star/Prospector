// FIX visit-window-v1 Stage 0 diagnostic - READ-ONLY on the DB (0 writes, 0 Claude). HomeLover only.
// (a) visit_pull_runs since Oct 14, (b) web_visits since Oct 14 by first_visit + three name probes (names only),
// (e) LA days with a Sales page load (sales_sync_runs trigger pageload).
// With --apollo: ONE declared visitor search (website_visitors_from_past: 14, page 1, per_page 100) bracketed by two
// 0-credit api_profile balance reads = 3 HTTP calls, expected 0-1 credits. Prints totals + name matches only.
// Usage: node scripts/verify/fix-visit-window-v1-stage0.mjs [--apollo]
import { createRequire } from 'module';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { apolloRequest } = await import(ROOT + '/api/sales/apolloClient.js');
const { VISITOR_DOMAINS } = await import(ROOT + '/api/sales/visitRules.js');
const { laDateString } = await import(ROOT + '/api/sales/laDate.js');

const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const SINCE = '2026-10-14';
const today = laDateString();
const NAMES = ['bpm', 'grey orange', 'redrock'];
const days = (from, to) => { const out = []; for (let d = new Date(from + 'T12:00:00Z'); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10)); return out; };

const biz = must(await svc.from('businesses').select('id, name').ilike('name', '%homelover%'));
if (biz.length !== 1) throw new Error(`expected 1 HomeLover business, got ${biz.length}`);
const HL = biz[0].id;
console.log(`HomeLover business ${HL} (${biz[0].name}) · LA today ${today}`);

console.log('\n(a) visit_pull_runs since', SINCE);
const runs = must(await svc.from('visit_pull_runs').select('la_date, status, calls, credits, error, created_at').eq('business_id', HL).gte('la_date', SINCE).order('la_date'));
for (const r of runs) console.log(`  ${r.la_date} ${r.status} calls=${r.calls} credits=${r.credits} error=${r.error ? JSON.stringify(r.error).slice(0, 80) : 'null'}`);
const okDays = new Set(runs.filter(r => r.status === 'ok').map(r => r.la_date));
console.log('  LA days with NO ok run:', days(SINCE, today).filter(d => !okDays.has(d)).join(', ') || 'none');

console.log('\n(b) web_visits pulled_on >=', SINCE);
const visits = must(await svc.from('web_visits').select('company_name, first_visit, last_visit, pulled_on').eq('business_id', HL).gte('pulled_on', SINCE));
const byFirst = {};
for (const v of visits) byFirst[v.first_visit || 'null'] = (byFirst[v.first_visit || 'null'] || 0) + 1;
console.log(`  rows: ${visits.length} · by first_visit: ${Object.entries(byFirst).sort().map(([d, n]) => `${d}=${n}`).join(' ')}`);
const byPulled = {};
for (const v of visits) byPulled[v.pulled_on] = (byPulled[v.pulled_on] || 0) + 1;
console.log(`  by pulled_on: ${Object.entries(byPulled).sort().map(([d, n]) => `${d}=${n}`).join(' ')}`);
const allVisits = must(await svc.from('web_visits').select('company_name, pulled_on').eq('business_id', HL));
for (const n of NAMES) {
  const hits = allVisits.filter(v => (v.company_name || '').toLowerCase().includes(n));
  console.log(`  "${n}": ${hits.length ? hits.map(h => `${h.company_name} (pulled_on ${h.pulled_on})`).join('; ') : 'absent'}`);
}

console.log('\n(e) sales_sync_runs trigger=pageload since', SINCE);
const syncs = must(await svc.from('sales_sync_runs').select('started_at, status').eq('business_id', HL).eq('trigger', 'pageload').gte('started_at', SINCE + 'T00:00:00Z').order('started_at'));
const loadDays = [...new Set(syncs.map(s => laDateString(new Date(s.started_at))))].sort();
console.log(`  LA days with a page load: ${loadDays.join(', ') || 'none'}`);
console.log(`  LA days WITHOUT a page load: ${days(SINCE, today).filter(d => !loadDays.includes(d)).join(', ') || 'none'}`);

if (process.argv.includes('--apollo')) {
  console.log('\n(d) ONE declared Apollo visitor search (from_past 14, page 1, per_page 100) + 2 balance reads');
  const ctx = { callCounter: { count: 0, max: 3 }, endpointCounts: {} };
  const bal = async () => (await apolloRequest({ method: 'GET', path: '/users/api_profile', query: 'include_credit_usage=true', ctx }))?.num_credits_remaining;
  const before = await bal();
  const json = await apolloRequest({ method: 'POST', path: '/mixed_companies/search', ctx, body: { website_visitors_from_domains: VISITOR_DOMAINS, website_visitors_from_past: 14, per_page: 100, page: 1 } });
  const after = await bal();
  const orgs = [...(json?.organizations || []), ...(json?.accounts || [])];
  console.log(`  pagination: ${JSON.stringify(json?.pagination)} · organizations=${(json?.organizations || []).length} accounts=${(json?.accounts || []).length}`);
  for (const n of NAMES) {
    const hits = orgs.filter(o => (o.name || '').toLowerCase().includes(n)).map(o => o.name);
    console.log(`  "${n}": ${hits.length ? hits.join('; ') : 'not in page 1'}`);
  }
  const ymd = s => (/^\d{8}$/.test(String(s || '')) ? `${String(s).slice(0, 4)}-${String(s).slice(4, 6)}-${String(s).slice(6)}` : null);
  const firsts = orgs.flatMap(o => (o.intent_signal_account?.domain_aggregates || []).map(a => ymd(a.first_visit))).filter(Boolean).sort();
  const lasts = orgs.flatMap(o => (o.intent_signal_account?.domain_aggregates || []).map(a => ymd(a.last_visit))).filter(Boolean).sort();
  console.log(`  first_visit range: ${firsts[0]} .. ${firsts[firsts.length - 1]} · last_visit range: ${lasts[0]} .. ${lasts[lasts.length - 1]} (unit check: a 14-day window should reach back to ~${days('2026-10-01', today).slice(-15)[0]})`);
  console.log(`  credits: before ${before} · after ${after} · spent ${before - after} · HTTP calls ${ctx.callCounter.count}`);
}
console.log('\nwrites: 0');
