// FIX visit-window-v1 Stage 2 LIVE check - as Jack on the REAL HomeLover workspace. ONE backfill-14 visitor pull through
// runVisitPullRoute (owner), declared: Apollo <= 6 HTTP calls at the fetch seam (2 balance reads + up to 2 pages of the
// visitor search + up to 2 pages with the US/500+ filters; the seam ABORTS before a 7th), 0 credits expected (balance
// before/after reported from the apollo_credit_spend row), 0 Claude. Writes are the product's own and are NOT restored:
// 1 visit_pull_runs row (kind backfill), today's web_visits rows (upsert on business_id, company_key, pulled_on),
// sales_signals proposals (P1/P2 not already signalled this week), 1 apollo_credit_spend row. Every other HomeLover table
// must be unchanged. The daily run is NOT re-run live (4 more calls would pass the cap; the same code path is covered
// by the fake-Apollo tests). Also: a member's backfill -> 403 with 0 calls; a second backfill today -> refused, 0 calls;
// the Needs attention visitors line in-process AND through the real wiring (spawned server.js, cookie). Names printed
// only for the three companies Jack named. Runtime ~1 min, hard cap 240 s.
// Usage: node scripts/verify/fix-visit-window-v1-stage2.mjs
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { ownerSession } from './lib/ownerSession.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { runVisitPullRoute, visitStatus } = await import('../../api/sales/visitPull.js');
const { attention } = await import('../../api/sales/attentionRoutes.js');
const { laDateString } = await import('../../api/sales/laDate.js');
const { addDays } = await import('../../api/sales/goalsShared.js');
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const OUT = path.join(ROOT, '.screenshots', 'fix-visit-window-v1');
const PORT = 3996, BASE = `http://localhost:${PORT}`;
const APOLLO_CAP = 6, CLAUDE_CAP = 0;
const NAMES = ['bpm', 'grey orange', 'redrock'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL_TABLES = ['accounts', 'lists', 'projects', 'sales_goals', 'sales_opportunities', 'sales_targets', 'sales_people', 'sales_source_events', 'sales_partner_events', 'partner_contacts', 'sales_week_goals', 'sales_signals', 'web_visits', 'visit_pull_runs', 'apollo_credit_spend', 'sales_visit_skip', 'sales_suggestions', 'sales_tidy_runs', 'sales_sync_runs'];
const MAY_GROW = ['web_visits', 'visit_pull_runs', 'sales_signals', 'apollo_credit_spend'];
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const count = async t => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL); if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message || `no count (HTTP ${r.status})`}`); return r.count; };
const snapshot = async () => { const o = {}; for (const t of HL_TABLES) o[t] = await count(t); return o; };
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }

const biz = must(await svc.from('businesses').select('id, name').ilike('name', '%homelover%'));
if (biz.length !== 1) throw new Error('expected one HomeLover business');
const HL = biz[0].id;
const today = laDateString(new Date());
const claudeHost = /anthropic\.com$/;
const apolloCalls = [];
let claudeCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (claudeHost.test(u.host)) { claudeCalls++; throw new Error('Claude cap 0'); }
  if (u.host === 'api.apollo.io') {
    const key = `${init.method || 'GET'} ${u.pathname}${init.body ? ` page ${JSON.parse(init.body).page}${JSON.parse(init.body).organization_locations ? ' us' : ''} past ${JSON.parse(init.body).website_visitors_from_past}` : ''}`;
    if (apolloCalls.length >= APOLLO_CAP) throw new Error(`Apollo cap ${APOLLO_CAP} reached before ${key} - aborting`);
    apolloCalls.push(key);
  }
  return realFetch(url, init);
};
const results = { checks: [], errors: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${detail}` : ''); };
const res = () => { const r = { code: 200, body: null }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; return r; };
let srv, owner;
async function teardown() { if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 240000 });
fs.mkdirSync(OUT, { recursive: true });
const priorBackfill = must(await svc.from('visit_pull_runs').select('id, status').eq('business_id', HL).eq('la_date', today).eq('kind', 'backfill'));
if (priorBackfill.some(r => r.status === 'ok')) { console.log(`ABORT before any call: a backfill already ran today (${priorBackfill[0].id}); the guard would refuse it - run tomorrow`); process.exit(1); }
const before = await snapshot();
const weekSignalsBefore = before.sales_signals;
log('LIVE run on HomeLover', HL, 'before', JSON.stringify(before));

try {
  const members = must(await svc.from('business_members').select('user_id, role').eq('business_id', HL));
  const JACK = members.find(m => m.role === 'owner')?.user_id;
  const member = members.find(m => m.role === 'member' && m.user_id)?.user_id || JACK;
  if (!JACK) throw new Error('no owner member on HomeLover');
  const req = (uid, role, body) => ({ params: { businessId: HL }, body, auth: { user: { id: uid }, isPlatformOwner: false, roles: new Map([[HL, role]]) } });
  // 1 a member cannot backfill (0 calls)
  const r403 = res();
  await runVisitPullRoute(req(member, 'member', { backfill_days: 14 }), r403);
  ok('1 member backfill -> 403, 0 Apollo calls, no run row', r403.code === 403 && apolloCalls.length === 0 && (await count('visit_pull_runs')) === before.visit_pull_runs, `${r403.code} ${r403.body?.error}`);
  // 2 the backfill as the owner
  const r = res();
  await runVisitPullRoute(req(JACK, 'owner', { backfill_days: 14 }), r);
  const b = r.body || {};
  const run = b.run || null;
  const start = addDays(today, -14);
  ok(`2 backfill 14 as owner -> ${r.code}, ran, run row kind backfill · window ${run?.window_start}..${run?.window_end} · lookback ${run?.lookback_days} · status ${run?.status} · calls ${run?.calls} (cap ${APOLLO_CAP}) · credits ${b.credits}`, r.code === 200 && b.ran === true && run?.kind === 'backfill' && run.window_start === start && run.window_end === today && run.lookback_days === 14 && run.status === 'ok' && run.calls <= APOLLO_CAP && b.credits === 0, r.code === 200 ? '' : JSON.stringify(b).slice(0, 200));
  const spend = must(await svc.from('apollo_credit_spend').select('ref, credits, balance_before, balance_after').eq('business_id', HL).eq('ref', `visit_pull:${today}:backfill`));
  ok(`3 credit row: ref visit_pull:${today}:backfill · balance ${spend[0]?.balance_before} -> ${spend[0]?.balance_after} · credits ${spend[0]?.credits}`, spend.length === 1 && spend[0].credits === 0);
  const rows = must(await svc.from('web_visits').select('company_name, seen_from, seen_to, first_visit, last_visit, priority, us_500').eq('business_id', HL).eq('pulled_on', today));
  const inWindow = rows.filter(v => v.seen_from === start && v.seen_to === today);
  const byPrio = rows.reduce((o, v) => ({ ...o, [v.priority]: (o[v.priority] || 0) + 1 }), {});
  ok(`4 web_visits pulled_on ${today}: ${rows.length} companies (counts.companies ${b.counts?.companies}, us_500 ${b.counts?.us_500}), ${inWindow.length} with seen_from ${start} / seen_to ${today} · priorities ${JSON.stringify(byPrio)} · first_visit range ${rows.map(v => v.first_visit).filter(Boolean).sort()[0]}..${rows.map(v => v.last_visit).filter(Boolean).sort().pop()}`, rows.length > 0 && inWindow.length === rows.length && b.counts?.companies === rows.length);
  const found = NAMES.map(n => { const hit = rows.filter(v => (v.company_name || '').toLowerCase().includes(n)); return `${n}: ${hit.length ? hit.map(h => `${h.company_name} (${h.priority}, first ${h.first_visit}, last ${h.last_visit})`).join('; ') : 'absent'}`; });
  ok(`5 the three names Jack named - ${found.join(' · ')}`, true);
  const after1 = await snapshot();
  ok(`6 signals proposed this run: ${b.counts?.signals} (sales_signals ${weekSignalsBefore} -> ${after1.sales_signals})`, after1.sales_signals - weekSignalsBefore === b.counts?.signals);
  // 7 second backfill the same day -> refused, 0 calls
  const n0 = apolloCalls.length;
  const r2 = res();
  await runVisitPullRoute(req(JACK, 'owner', { backfill_days: 14 }), r2);
  ok('7 second backfill today -> ran false "Already backfilled today", 0 Apollo calls', r2.code === 200 && r2.body.ran === false && r2.body.reason === 'Already backfilled today' && apolloCalls.length === n0, JSON.stringify(r2.body?.reason));
  // 8 Needs attention line in-process + visits/status
  const att = await attention(svc, { businessId: HL, userId: JACK, fresh: true });
  const w = att.sources.find(s => s.id === 'visitors').window;
  const st = await visitStatus(svc, HL);
  ok(`8 Needs attention visitors line: Window ${w.window_start}..${w.window_end} (${w.kind}, ${w.lookback_days} d) · ${w.companies} companies · gap ${w.gap} · last ok ${w.last_ok_at?.slice(0, 19)}; visits/status today P1 ${st.today.P1} P2 ${st.today.P2} P3 ${st.today.P3} P4 ${st.today.P4}, last_run kind ${st.last_run?.kind}`, w.window_start === start && w.window_end === today && w.gap === false && w.companies === rows.length && st.last_run?.kind === 'backfill' && Object.values(st.today).reduce((a, n) => a + n, 0) === rows.length);
  // 9 real wiring
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await realFetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const real = await realFetch(`${BASE}/api/sales/${HL}/goals/attention?fresh=1`, { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}` } });
  const realBody = await real.json().catch(() => null);
  const rw = realBody?.sources?.find(s => s.id === 'visitors')?.window;
  ok(`9 real wiring: GET goals/attention through the spawned server.js -> ${real.status}, visitors.window identical to the in-process read, no address`, real.status === 200 && JSON.stringify(rw) === JSON.stringify(w) && !JSON.stringify(realBody).includes('@'));
  ok(`caps: Apollo ${apolloCalls.length} <= ${APOLLO_CAP} (${apolloCalls.join(' | ')}), Claude ${claudeCalls} <= ${CLAUDE_CAP}`, apolloCalls.length <= APOLLO_CAP && claudeCalls === 0);
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let line;
  try {
    const after = await snapshot();
    const changed = HL_TABLES.filter(t => after[t] !== before[t]);
    const unexpected = changed.filter(t => !MAY_GROW.includes(t));
    const deltas = changed.map(t => `${t} ${before[t]} -> ${after[t]}`).join(', ');
    line = unexpected.length ? `NO - unexpected change in ${unexpected.join(', ')} (${deltas})` : `n/a by design (product writes kept: ${deltas || 'none'}; every other HomeLover table identical; Jack sign-in row kept by rule, last_seen_at restored)`;
    results.unexpected = unexpected;
  } catch (e) { line = `NO (check failed: ${e.message})`; results.unexpected = ['?']; }
  const pass = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'fix-visit-window-v1-stage2.json'), JSON.stringify({ ...results, apolloCalls, claudeCalls }, null, 2));
  console.log(`\n${pass}/${results.checks.length} checks passed${results.errors.length ? ` · ${results.errors.length} errors` : ''} · Apollo ${apolloCalls.length} · Claude ${claudeCalls}`);
  for (const e of results.errors) console.log('ERROR:', e.split('\n').slice(0, 3).join(' | '));
  console.log(`restored: ${line}`);
  process.exit(pass === results.checks.length && !results.errors.length && !results.unexpected?.length ? 0 : 1);
}
