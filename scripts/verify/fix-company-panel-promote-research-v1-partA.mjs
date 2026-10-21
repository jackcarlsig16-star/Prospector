// FIX company-panel-promote-research-v1 Part A bar 4 - research runs and matched web visits follow a target on Promote.
// SCOPE (declared): TEMP data only - 1 workspace (goals_sales on, added to SALES_ANALYTICS_BUSINESS_IDS for the local
// server only) + 1 temp owner + 4 targets, 4 fake research_runs rows (inserted directly: 0 Claude), 1 web_visits row.
// HomeLover is never written; its research_runs / sales_targets / sales_goals / web_visits / sales_opportunities counts
// are compared before and after. 0 Apollo. Runtime ~20 s, hard cap 120 s (tempGuard), teardown deletes everything.
// The rollback check calls promoteTarget() directly with a wrapped client that flips the target's status between the
// research move and the guarded accept (a teammate's click) - the real DB rolls back through the route's undo list.
// Usage: node scripts/verify/fix-company-panel-promote-research-v1-partA.mjs
import { createRequire } from 'module';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3975;
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const NAME = 'ZZ Promote Research FixA';
const HL = ['research_runs', 'sales_targets', 'sales_goals', 'web_visits', 'sales_opportunities', 'sales_week_goals', 'sales_partner_events'];
const TEMP_TABLES = ['research_runs', 'web_visits', 'sales_partner_events', 'sales_opportunity_events', 'sales_week_goals', 'sales_targets', 'sales_opportunities', 'sales_goals', 'auth_events', 'business_members'];
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const hlCounts = async () => { const o = {}; for (const t of HL) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HOMELOVER)).count; return o; };
let srv, B, users = [], pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
async function teardown() {
  if (srv) srv.kill(); srv = null;
  if (B) {
    for (const t of TEMP_TABLES) { const r = await svc.from(t).delete().eq('business_id', B); if (r.error) console.log(`cleanup ${t}: ${r.error.message}`); }
    await svc.from('businesses').delete().eq('id', B);
  }
  for (const u of users) { await svc.from('auth_events').delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('actor_id', u.id); await svc.auth.admin.deleteUser(u.id); }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 120000 });
const hlBefore = await hlCounts();
console.log('HomeLover before', JSON.stringify(hlBefore));
try {
  const tag = 'fixa-' + Date.now();
  B = ins(await svc.from('businesses').insert({ name: NAME, website_url: 'https://fixa.example.com', color: '#6F8CF0', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
  const email = `${tag}-owner@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
  const { data: u, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(error.message);
  await svc.from('profiles').update({ display_name: 'Owner Test', welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
  ins(await svc.from('business_members').insert({ business_id: B, email, name: 'Owner Test', user_id: u.user.id, role: 'owner' }).select());
  const anon = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: s, error: sErr } = await anon.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(sErr.message);
  const owner = { id: u.user.id, session: s.session }; users.push(owner);

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const T = Object.fromEntries(ins(await svc.from('sales_targets').insert([
    { business_id: B, name: 'ZZ Promo A', kind: 'partner', status: 'researching', channel: 'call_note', evidence: 'named on a call' },
    { business_id: B, name: 'ZZ Promo B', kind: 'employer', status: 'researching', channel: 'scout' },
    { business_id: B, name: 'ZZ Promo C', kind: 'partner', status: 'researching', channel: 'manual' },
    { business_id: B, name: 'ZZ Promo D', kind: 'partner', status: 'researching', channel: 'manual' },
  ]).select('id, name')).map(t => [t.name.slice(-1), t.id]));
  const fakeRun = (id, at, n) => ({ business_id: B, entity_type: 'target', entity_id: id, trigger: 'manual', status: 'done', model: 'fake', cost_usd: 0.001, created_by: owner.id, created_at: at, result: { summary: `Fake research ${n}`, size: '1,000 employees', website: 'https://fixa.example.com', domain: 'fixa.example.com', website_confidence: 'low', source_urls: [] } });
  const runs = ins(await svc.from('research_runs').insert([
    fakeRun(T.A, new Date(Date.now() - 2 * 864e5).toISOString(), 'A1'), fakeRun(T.A, new Date(Date.now() - 1 * 864e5).toISOString(), 'A2'),
    fakeRun(T.B, new Date(Date.now() - 1 * 864e5).toISOString(), 'B1'), fakeRun(T.D, new Date(Date.now() - 1 * 864e5).toISOString(), 'D1'),
  ]).select('id, entity_id, created_at'));
  const newestA = runs.filter(r => r.entity_id === T.A).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const visit = ins(await svc.from('web_visits').insert({ business_id: B, pulled_on: today, company_key: 'zz promo a', company_name: 'ZZ Promo A', priority: 'P2', priority_rule: 'Matched target visited', matched_type: 'target', matched_id: T.A, visits_7d: 3, last_visit: today, us_500: false, top_paths: ['/pricing'] }).select('id').single());

  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const api = async (method, p, body) => {
    const res = await fetch(`http://localhost:${PORT}/api/sales/${B}${p}`, { method, headers: { Cookie: `prospector_at=${encodeURIComponent(owner.session.access_token)}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  // Target A: 2 runs + 1 matched visit -> partner.
  const before = await api('GET', `/goals/company?type=target&id=${T.A}`);
  ok('target panel before: 2 runs, newest first, the matched visit shows', before.status === 200 && before.body.research.runs.length === 2 && before.body.research.runs[0].id === newestA.id && before.body.visits.some(v => v.id === visit.id), JSON.stringify({ s: before.status, n: before.body?.research?.runs?.length }));
  const pa = await api('POST', `/goals/prospect-targets/${T.A}/promote`, { to: 'partner' });
  ok('promote A -> partner: 201, research_moved 2, visits_moved 1', pa.status === 201 && pa.body.research_moved === 2 && pa.body.visits_moved === 1, JSON.stringify(pa.body?.error || { rm: pa.body?.research_moved, vm: pa.body?.visits_moved }));
  const partner = await api('GET', `/goals/company?type=partner&id=${pa.body.created.id}`);
  ok('partner panel (the body CompanyPanel renders): research card has both runs, latest = the newest target run, done result present', partner.status === 200 && partner.body.research.runs.length === 2 && partner.body.research.runs[0].id === newestA.id && partner.body.research.runs[0].result?.summary === 'Fake research A2', JSON.stringify({ s: partner.status, runs: partner.body?.research?.runs?.map(r => r.id) }));
  ok('partner panel: the matched visit followed (matched_type partner) and the intake note is the first recent event', partner.body.visits.some(v => v.id === visit.id) && partner.body.recent[0]?.event === 'note');
  const dbVisit = ins(await svc.from('web_visits').select('matched_type, matched_id').eq('id', visit.id).single());
  ok('DB: web_visits row matched_type partner / matched_id = the new partner', dbVisit.matched_type === 'partner' && dbVisit.matched_id === pa.body.created.id);
  const after = await api('GET', `/goals/company?type=target&id=${T.A}`);
  ok('target panel after: 0 runs left on the target (accepted)', after.status === 200 && after.body.research.runs.length === 0 && after.body.record.stage === 'accepted');
  const cap = await api('GET', `/goals/company/partner/${pa.body.created.id}/research`);
  ok('A2: GET company research for the partner counts the moved runs (runs 2, today 0 - both are older than today)', cap.status === 200 && cap.body.runs.length === 2 && cap.body.today === 0, JSON.stringify(cap.body));

  // Target B: 1 run -> employer.
  const pb = await api('POST', `/goals/prospect-targets/${T.B}/promote`, { to: 'employer' });
  ok('promote B -> employer: 201, research_moved 1, visits_moved 0', pb.status === 201 && pb.body.research_moved === 1 && pb.body.visits_moved === 0, JSON.stringify(pb.body?.error || pb.body?.created));
  const emp = await api('GET', `/goals/company?type=employer&id=${pb.body.created.id}`);
  ok('employer panel: the run sits on the employer (entity_type employer)', emp.status === 200 && emp.body.research.runs.length === 1 && emp.body.research.runs[0].result?.summary === 'Fake research B1', JSON.stringify({ s: emp.status, n: emp.body?.research?.runs?.length }));
  const dbB = ins(await svc.from('research_runs').select('entity_type, entity_id').eq('business_id', B).eq('result->>summary', 'Fake research B1').single());
  ok('DB: that run is entity_type employer / entity_id = the opportunity', dbB.entity_type === 'employer' && dbB.entity_id === pb.body.created.id);

  // Target C: nothing to move.
  const pc = await api('POST', `/goals/prospect-targets/${T.C}/promote`, { to: 'partner' });
  ok('promote C (no runs, no visits) -> partner: 201, research_moved 0, visits_moved 0', pc.status === 201 && pc.body.research_moved === 0 && pc.body.visits_moved === 0, JSON.stringify(pc.body?.error || ''));

  // Target D: a teammate's change between the research move and the accept -> 409 and the move is undone, on the real DB.
  const { promoteTarget } = await import(ROOT + '/api/sales/targetsRoutes.js');
  const wrapped = { from: table => {
    const b = svc.from(table);
    if (table !== 'research_runs') return b;
    const u = b.update.bind(b);
    b.update = p => { const q = u(p); const then = q.then.bind(q); q.then = (res, rej) => svc.from('sales_targets').update({ status: 'rejected' }).eq('id', T.D).then(() => then(res, rej)); return q; };
    return b;
  } };
  const pd = await promoteTarget(wrapped, { businessId: B, userId: owner.id, targetId: T.D, body: { to: 'partner' } });
  const dRuns = ins(await svc.from('research_runs').select('entity_type, entity_id').eq('business_id', B).eq('result->>summary', 'Fake research D1'));
  const dGoal = ins(await svc.from('sales_goals').select('id').eq('business_id', B).eq('name', 'ZZ Promo D'));
  ok('rollback: 409 "changed since", the run is back on the target and no partner row is left', pd.status === 409 && dRuns.length === 1 && dRuns[0].entity_type === 'target' && dRuns[0].entity_id === T.D && dGoal.length === 0, JSON.stringify({ s: pd.status, e: pd.body?.error, run: dRuns[0], goals: dGoal.length }));
  const total_ = (await svc.from('research_runs').select('*', { count: 'exact', head: true }).eq('business_id', B)).count;
  ok('no run was duplicated or lost (4 rows in the temp workspace)', total_ === 4, String(total_));
} catch (e) {
  ok('script ran without throwing', false, e.stack?.split('\n').slice(0, 3).join(' | ') || e.message);
} finally {
  await cleanup();
  const left = B ? (await svc.from('businesses').select('id', { count: 'exact', head: true }).eq('id', B)).count : 0;
  const hlAfter = await hlCounts();
  const diff = Object.keys(hlBefore).filter(k => hlBefore[k] !== hlAfter[k]);
  ok(`HomeLover counts identical (${HL.length} tables)`, !diff.length, diff.map(k => `${k} ${hlBefore[k]}->${hlAfter[k]}`).join(', '));
  console.log(`\n${pass}/${total} passed · restored: ${left === 0 && !diff.length ? 'yes' : 'NO'}`);
  process.exit(0);
}
