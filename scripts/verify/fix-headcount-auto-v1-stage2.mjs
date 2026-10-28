// FIX headcount-auto-v1 REV2 Stage 2 live check - as Jack (ownerSession) on the REAL HomeLover workspace through the real
// wiring on localhost (server.js with the real .env - the fill's Apollo calls are REAL). ONE "Fill headcounts" run with
// the first-run caps: max_name_searches 48 + max_lookups 10, each enrich followed by a balance read, one balance read
// before (and one after when only name searches ran) -> declared Apollo <= 48 + 10 + 11 = 69 (Jack's cap 70). Expected
// credits 0 (enrich measured free on Oct 27; the run stops itself on the first non-zero delta). THIS WRITES by design:
// employees / employees_source 'apollo' or 'research' / employees_at, domain / domain_source 'apollo_name', and
// apollo_firmographics on existing records; partner_domains may gain unconfirmed suggestion rows; one apollo_credit_spend
// row; the settings state. No other new rows anywhere - the counts before / after prove it. 0 Claude.
// Report: .screenshots/fix-headcount-auto-v1/stage2-report.json. Usage: node scripts/verify/fix-headcount-auto-v1-stage2.mjs
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { ownerSession } from './lib/ownerSession.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const OUT = path.join(ROOT, '.screenshots', 'fix-headcount-auto-v1');
const PORT = 3991, BASE = `http://localhost:${PORT}`;
const MAX_NAMES = 48, MAX_LOOKUPS = 10, DECLARED = MAX_NAMES + MAX_LOOKUPS + 11;
const HL_TABLES = ['sales_goals', 'sales_opportunities', 'sales_targets', 'sales_people', 'partner_contacts', 'partner_domains', 'sales_signals', 'web_visits', 'sales_settings', 'apollo_credit_spend', 'sales_source_events', 'sales_company_scores', 'business_anthropic_usage'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const count = async (t, biz) => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', biz); if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message || `no count (HTTP ${r.status})`}`); return r.count; };
const biz = (await svc.from('businesses').select('id, name').ilike('name', '%homelover%')).data;
if (biz?.length !== 1) throw new Error('expected one HomeLover business');
const HL = biz[0].id;
const snapshot = async () => { const o = {}; for (const t of HL_TABLES) o[t] = await count(t, HL); return o; };
const headcounts = async () => {
  const o = {};
  for (const [t, name] of [['sales_goals', 'name'], ['sales_opportunities', 'organization'], ['sales_targets', 'name']]) {
    const r = await svc.from(t).select(`${name}, employees, employees_source, employees_at`).eq('business_id', HL);
    if (r.error) throw new Error(r.error.message);
    o[t] = { with: r.data.filter(x => x.employees != null).length, apollo: r.data.filter(x => x.employees_source === 'apollo').length, research: r.data.filter(x => x.employees_source === 'research').length, manual: r.data.filter(x => x.employees_source === 'manual').length, total: r.data.length };
  }
  const d = {};
  for (const t of ['sales_opportunities', 'sales_targets']) { const r = await svc.from(t).select('domain, domain_source').eq('business_id', HL); d[t] = { with: r.data.filter(x => x.domain).length, apollo_name: r.data.filter(x => x.domain_source === 'apollo_name').length }; }
  return { headcounts: o, domains: d };
};
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
let srv, owner;
const results = { checks: [], errors: [], apollo: null };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 400)}` : ''); };
async function teardown() { if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 240000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot(), hcBefore = await headcounts();
log('before', JSON.stringify(before)); log('headcounts before', JSON.stringify(hcBefore));
const startedAt = new Date().toISOString();

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const api = async (p, b = null) => { const r = await fetch(`${BASE}/api/sales/${HL}/goals${p}`, { method: b ? 'POST' : 'GET', headers: { cookie, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; } return { code: r.status, body: json }; };
  const st0 = await api('/headcount/status');
  ok(`real wiring: GET goals/headcount/status -> ${st0.code}; daily cap ${st0.body?.daily_cap}, month spend ${st0.body?.month_spend} of ${st0.body?.cap}, state ${JSON.stringify(st0.body?.state || {}).slice(0, 120)}`, st0.code === 200 && st0.body.daily_cap === 25);

  const r = await api('/headcount/fill', { max_name_searches: MAX_NAMES, max_lookups: MAX_LOOKUPS });
  const b = r.body || {}, c = b.counts || {};
  results.apollo = { calls: b.calls ?? null, credits: b.credits ?? null, balance_before: b.balance_before ?? null, balance_after: b.balance_after ?? null, declared: DECLARED };
  if (r.code !== 200) ok(`Fill headcounts -> ${r.code}: ${b.error} (calls ${b.calls ?? '?'})`, false);
  else ok(`Fill headcounts through the real wiring -> 200: Apollo calls ${b.calls} (declared <= ${DECLARED}), credits ${b.credits}, balance ${b.balance_before} -> ${b.balance_after}; ${b.line}; candidates ${c.candidates}, name searches ${c.name_searches}, lookups ${c.lookups}, errors ${c.lookup_errors}${c.stopped ? ` · STOPPED: ${c.stopped.message}` : ''}${b.paused ? ` · ${b.paused}` : ''}`,
    b.ran === true && b.calls <= DECLARED && b.credits === 0 && !c.stopped && !JSON.stringify(b).includes('@'));
  const three = (b.filled || []).slice(0, 3).map(f => `${f.name} · ${f.employees ?? '—'} (${f.source || 'domain only'}${f.domain ? `, ${f.domain}` : ''})`);
  ok(`three filled (names only): ${three.join(' | ') || 'none'}`, true);

  const after = await snapshot(), hcAfter = await headcounts();
  const grew = Object.keys(after).filter(t => after[t] !== before[t]).map(t => `${t} ${before[t]} -> ${after[t]}`);
  const allowedGrowth = grew.every(g => /^(partner_domains|apollo_credit_spend|sales_company_scores) /.test(g));
  ok(`counts after: rows that grew ${grew.join(', ') || 'none'} (only partner_domains suggestions / one spend row / scores allowed); headcounts ${JSON.stringify(hcAfter.headcounts)}; domains ${JSON.stringify(hcAfter.domains)}; manual headcounts untouched (${hcBefore.headcounts.sales_goals.manual + hcBefore.headcounts.sales_opportunities.manual + hcBefore.headcounts.sales_targets.manual} before, ${hcAfter.headcounts.sales_goals.manual + hcAfter.headcounts.sales_opportunities.manual + hcAfter.headcounts.sales_targets.manual} after)`,
    allowedGrowth && (after.apollo_credit_spend === before.apollo_credit_spend + (b.balance_before != null ? 1 : 0)));
  const spend = (await svc.from('apollo_credit_spend').select('endpoint, ref, credits, balance_before, balance_after').eq('business_id', HL).gte('at', startedAt)).data || [];
  ok(`ledger: ${spend.map(s => `${s.ref} ${s.credits} credits (${s.balance_before} -> ${s.balance_after})`).join(', ') || 'no row (no Apollo call needed)'}`, spend.every(s => s.credits === 0));
  const att = await api('/attention?fresh=1');
  const hc = att.body?.sources?.find(s => s.id === 'headcount');
  ok(`GET goals/attention -> ${att.code}: Headcounts line "${hc?.line}", status ${hc?.status}, month ${hc?.spend?.month} of ${hc?.spend?.cap}, today ${hc?.spend?.today?.lookups} lookups`, att.code === 200 && hc && hc.status === 'ok' && hc.line);
  const bands = (await svc.from('sales_company_scores').select('band').eq('business_id', HL)).data || [];
  ok(`scores after (recompute scheduled by the fill): P1 ${bands.filter(x => x.band === 'P1').length} · P2 ${bands.filter(x => x.band === 'P2').length} · P3 ${bands.filter(x => x.band === 'P3').length} · P4 ${bands.filter(x => x.band === 'P4').length}`, true);
  results.after = { hcAfter, grew };
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'stage2-report.json'), JSON.stringify({ ...results, before, hcBefore, when: new Date().toISOString() }, null, 2));
  console.log(`\nFIX headcount-auto-v1 REV2 Stage 2 live check: ${passed}/${results.checks.length} passed · Apollo ${JSON.stringify(results.apollo)} · Claude 0\nrestored: by design the fill wrote headcounts / domains / firmographics onto existing records (see the counts line); row counts: ${results.after ? (results.after.grew.join(', ') || 'identical') : 'n/a'}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
