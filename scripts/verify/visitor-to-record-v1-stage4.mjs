// visitor-to-record-v1 REV2 Stage 4 LIVE check - as Jack on the REAL HomeLover workspace. ONE invented visit (Zz Verify
// Loft, example.invalid, US 500+, 6 visits, two pages) goes through the pull's input path (runVisitPull { injected } - the
// same scoring, storage, signals and auto-create as a real pull; 0 visitor calls, no run row, no credit row). Declared:
// Apollo <= 2 HTTP calls at the fetch seam (the V2b people search on example.invalid - expected 0 people - and ONE balance
// read after it), 0 credits expected, 0 Claude. Writes = the invented rows only (web_visits, sales_targets, sales_signals,
// sales_source_events, any sales_people), deleted by id at the end; restored = every HomeLover count identical. One request
// through the real wiring (GET goals/visits/report shows the Created row); People search finds a real person by name (the
// name only). The Apollo answer is recorded scrubbed. Runtime < 1 min, hard cap 240 s.
// Usage: node scripts/verify/visitor-to-record-v1-stage4.mjs
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { ownerSession } from './lib/ownerSession.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { runVisitPull } = await import('../../api/sales/visitPull.js');
const { peopleSearch } = await import('../../api/sales/visitorRoutes.js');
const { undoSignal } = await import('../../api/sales/signalsRoutes.js');
const { normName } = await import('../../api/sales/intakeMatch.js');
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const OUT = path.join(ROOT, '.screenshots', 'visitor-to-record-v1');
const REC = path.join(OUT, 'stage4-apollo-recording.json');
const PORT = 3998, BASE = `http://localhost:${PORT}`;
const APOLLO_CAP = 2, CLAUDE_CAP = 0;
const NAME = 'Zz Verify Loft', KEY = normName(NAME), DOMAIN = 'example.invalid';
const HL_TABLES = ['sales_goals', 'sales_opportunities', 'sales_targets', 'sales_people', 'partner_contacts', 'sales_signals', 'web_visits', 'visit_pull_runs', 'apollo_credit_spend', 'sales_source_events', 'sales_week_goals', 'sales_settings', 'sales_visit_skip'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const count = async (t, biz) => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', biz); if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message || `no count (HTTP ${r.status})`}`); return r.count; };
const biz = must(await svc.from('businesses').select('id, name').ilike('name', '%homelover%'));
if (biz.length !== 1) throw new Error('expected one HomeLover business');
const HL = biz[0].id;
const snapshot = async () => { const o = {}; for (const t of HL_TABLES) o[t] = await count(t, HL); return o; };
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
const ADDR = /[^\s@<>()"',;=&#]+(?:@|%40)[^\s@<>()"',;=&#]+\.[a-z]{2,}/gi;
const scrub = s => String(s).replace(ADDR, 'redacted@example.invalid');
const apolloCalls = [], recording = [];
let claudeCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (/anthropic\.com$/.test(u.host)) { claudeCalls++; throw new Error('Claude cap 0'); }
  if (u.host === 'api.apollo.io') {
    const key = `${init.method || 'GET'} ${u.pathname}`;
    if (apolloCalls.length >= APOLLO_CAP) throw new Error(`Apollo cap ${APOLLO_CAP} reached before ${key} - aborting`);
    apolloCalls.push(key);
    const r = await realFetch(url, init); const text = await r.text();
    recording.push({ key, status: r.status, text: scrub(text).slice(0, 2000) });
    return { status: r.status, ok: r.ok, headers: r.headers, text: async () => text, json: async () => JSON.parse(text) };
  }
  return realFetch(url, init);
};
const results = { checks: [], errors: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 400)}` : ''); };
const created = { visit: null, target: null, signal: null };
let srv, owner;
async function removeCreated() {
  const out = {};
  const del = async (t, q) => { const r = await q.select('id'); if (r.error) console.log(`cleanup ${t}:`, r.error.message); out[t] = (out[t] || 0) + (r.data?.length ?? -1); };
  if (created.target) { await del('sales_people', svc.from('sales_people').delete().eq('business_id', HL).eq('target_id', created.target)); await del('sales_source_events', svc.from('sales_source_events').delete().eq('business_id', HL).eq('record_type', 'target').eq('record_id', created.target)); await del('sales_week_goals', svc.from('sales_week_goals').delete().eq('business_id', HL).eq('link_type', 'target').eq('link_id', created.target)); }
  if (created.signal) await del('sales_signals', svc.from('sales_signals').delete().eq('business_id', HL).eq('id', created.signal));
  if (created.target) await del('sales_targets', svc.from('sales_targets').delete().eq('business_id', HL).eq('id', created.target));
  if (created.visit) await del('web_visits', svc.from('web_visits').delete().eq('business_id', HL).eq('id', created.visit));
  results.deleted = out; log('deleted exactly the created rows:', JSON.stringify(out));
}
async function teardown() { if (srv) srv.kill(); srv = null; await removeCreated(); if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 240000 });
fs.mkdirSync(OUT, { recursive: true });
const pre = await Promise.all([svc.from('sales_targets').select('id').eq('business_id', HL).ilike('name', 'Zz Verify%'), svc.from('web_visits').select('id').eq('business_id', HL).eq('company_key', KEY), svc.from('sales_signals').select('id').eq('business_id', HL).eq('company_key', KEY)]);
if (pre.some(p => p.data?.length)) { console.log('ABORT before any write: leftover Zz Verify rows exist - remove them first'); process.exit(1); }
const csv = path.join(ROOT, 'inbox', 'apollo-visited-people.csv');
const before = await snapshot();
log('LIVE run before', JSON.stringify(before));

try {
  const members = must(await svc.from('business_members').select('user_id, role').eq('business_id', HL));
  const JACK = members.find(m => m.role === 'owner')?.user_id;
  if (!JACK) throw new Error('no owner member');
  const org = { id: 'zz-verify-loft', name: NAME, primary_domain: DOMAIN, website_url: `https://www.${DOMAIN}`, naics_codes: [], sic_codes: [], organization_revenue: 50000000,
    intent_signal_account: { organization_id: 'zz-verify-loft', total_visits: 6, unique_visitors: 2, overall_intent: 'high',
      domain_aggregates: [{ domain: 'homelover.ai', total_visits: 6, unique_visitors: 2, first_visit: 20261024, last_visit: 20261027, intent: 'high', intent_score: 55, weekly_aggregates: [{ week_start_date: '2026-10-26', count: 6 }], top_5_paths: [{ _id: 'homelover.ai/pricing', total_visits: 4 }, { _id: 'homelover.ai/employer-partners', total_visits: 2 }] }],
      website_visitor_metrics: { overall_intent: 'high', page_view_aggregates: { one_day_count: 2, seven_day_count: 6 }, pages: ['/pricing', '/employer-partners'] } } };
  // 1 the injected pull
  const r = await runVisitPull(svc, { businessId: HL, userId: JACK, injected: { organizations: [org], us_ids: ['zz-verify-loft'] } });
  const b = r.body || {};
  created.visit = must(await svc.from('web_visits').select('id').eq('business_id', HL).eq('company_key', KEY))[0]?.id || null;
  created.target = must(await svc.from('sales_targets').select('id').eq('business_id', HL).eq('name', NAME))[0]?.id || null;
  created.signal = must(await svc.from('sales_signals').select('id').eq('business_id', HL).eq('company_key', KEY))[0]?.id || null;
  ok(`1 injected pull -> ${r.status}: counts ${JSON.stringify(b.counts?.auto)} · visitor calls 0 (calls ${b.calls}) · no run / credit row`, r.status === 200 && b.injected === true && b.counts?.auto?.created === 1 && b.counts.auto.searches === 1 && b.counts.auto.people === 0 && b.calls === 1 && b.credits === 0, JSON.stringify(b).slice(0, 300));
  const visit = created.visit ? must(await svc.from('web_visits').select('company_name, priority, priority_rule, us_500, visits_7d, unique_visitors_7d, top_paths, seen_from, seen_to, pulled_on').eq('id', created.visit).single()) : null;
  const target = created.target ? must(await svc.from('sales_targets').select('id, name, kind, status, source, channel, evidence, visit_id, signal_id, owner_user_id, employees, research_notes').eq('id', created.target).single()) : null;
  const signal = created.signal ? must(await svc.from('sales_signals').select('id, status, auto, decided_by, target_id, match, kind, why_now').eq('id', created.signal).single()) : null;
  ok(`2 web_visits row: ${visit?.priority} "${visit?.priority_rule}" · us_500 ${visit?.us_500} · ${visit?.visits_7d} visits / ${visit?.unique_visitors_7d} people · pages ${(visit?.top_paths || []).map(p => p.path).join(', ')} · window ${visit?.seen_from}..${visit?.seen_to}`, visit?.priority === 'P1' && visit.us_500 === true && visit.visits_7d === 6 && (visit.top_paths || []).length === 2);
  ok(`3 employer target created: kind ${target?.kind} · source ${target?.source} · channel ${target?.channel} · visit_id = the visit row · signal_id = the signal · owner unassigned · evidence "${target?.evidence}"`, !!target && target.kind === 'employer' && target.source === 'web_visit' && target.channel === 'website_visit' && target.visit_id === created.visit && target.signal_id === created.signal && target.owner_user_id == null && /^Visited 6 times in 7 days · pages: \/pricing, \/employer-partners · intent high · last 2026-10-27$/.test(target.evidence || ''));
  ok(`4 signal accepted / auto / decided_by null / target_id set / match via new_target (${signal?.kind})`, signal?.status === 'accepted' && signal.auto === true && signal.decided_by === null && signal.target_id === created.target && signal.match?.via === 'new_target');
  const people = must(await svc.from('sales_people').select('id').eq('business_id', HL).eq('target_id', created.target));
  const balance = (await (await realFetch('https://api.apollo.io/api/v1/users/api_profile?include_credit_usage=true', { headers: { 'x-api-key': process.env.APOLLO_API_KEY } })).json())?.num_credits_remaining;
  apolloCalls.push('GET /api/v1/users/api_profile'); // the declared balance read (outside the seam so it never counts against the search)
  const spendRow = must(await svc.from('apollo_credit_spend').select('balance_after').eq('business_id', HL).order('at', { ascending: false }).limit(1))[0];
  ok(`5 V2b people search on ${DOMAIN}: ${apolloCalls.filter(c => c.includes('api_search')).length} declared call, ${people.length} people filed (0 expected on a fake domain) · balance now ${balance} (last recorded ${spendRow?.balance_after})`, apolloCalls.filter(c => c.includes('api_search')).length === 1 && people.length === 0 && typeof balance === 'number');
  // 6 real wiring + Web visitors shows Created
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await realFetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const real = async p => { const res = await realFetch(`${BASE}/api/sales/${HL}/goals${p}`, { headers: { cookie } }); const text = await res.text(); let body = null; try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; } return { code: res.status, body }; };
  const rep = await real('/visits/report');
  const row = (rep.body?.rows || []).find(x => x.company_name === NAME);
  // A company created from today's visit has no match on its visit row until the next pull stamps it; the Created chip is the tell.
  ok(`6 real wiring GET goals/visits/report -> ${rep.code}: ${NAME} listed ${row?.priority} with created=true (match ${row?.match ? row.match.label : 'none yet, as expected'}), people ${row?.people?.length ?? '?'}, counts.created ${rep.body?.counts?.created}, no address`, rep.code === 200 && row?.created === true && rep.body.counts.created >= 1 && !JSON.stringify(rep.body).includes('@'));
  // 7 People search finds a real person by name
  const any = await peopleSearch(svc, { businessId: HL, query: {} });
  const sample = any.body?.people?.find(p => p.name && p.name.split(' ').length >= 2 && !/^Zz/.test(p.name));
  const found = sample ? await real(`/people?q=${encodeURIComponent(sample.name)}`) : null;
  ok(`7 People search by a real name ("${sample?.name || '?'}") through the real wiring -> ${found?.code}: ${found?.body?.n} match${found?.body?.n === 1 ? '' : 'es'}, has_email boolean, no address`, found?.code === 200 && found.body.n >= 1 && found.body.people.some(p => p.name === sample.name) && typeof found.body.people[0].has_email === 'boolean' && !JSON.stringify(found.body).includes('@'));
  // 8 Undo
  const u = await undoSignal(svc, { businessId: HL, userId: JACK, id: created.signal });
  const tAfter = must(await svc.from('sales_targets').select('status, research_notes').eq('id', created.target).single());
  const sAfter = must(await svc.from('sales_signals').select('status, auto, target_id').eq('id', created.signal).single());
  ok(`8 Undo -> ${u.status}: target ${tAfter.status} (archived, never deleted) with the notes line, signal ${sAfter.status} / auto ${sAfter.auto} / target_id ${sAfter.target_id}`, u.status === 200 && tAfter.status === 'rejected' && /Auto-create undone from Signals/.test(tAfter.research_notes || '') && sAfter.status === 'new' && sAfter.auto === false && sAfter.target_id === null);
  ok(fs.existsSync(csv) ? '9 inbox/apollo-visited-people.csv present' : '9 inbox/apollo-visited-people.csv absent - the V2a header map stays the Stage 1 guess (First/Last/Name, Title, Company, Company Domain/Website, Person Linkedin Url, City/State, Last Visit, Page Views/Visits, Pages Visited)', true);
  ok(`caps: Apollo ${apolloCalls.length} <= ${APOLLO_CAP} (${apolloCalls.join(' | ')}), Claude ${claudeCalls} <= ${CLAUDE_CAP}`, apolloCalls.length <= APOLLO_CAP && claudeCalls === 0);
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try { const after = await snapshot(); restored = JSON.stringify(before) === JSON.stringify(after); line = restored ? `yes (every HomeLover count identical; deleted exactly the created rows ${JSON.stringify(results.deleted)}; Jack sign-in row kept by rule, last_seen_at restored)` : `NO - before ${JSON.stringify(before)} after ${JSON.stringify(after)}`; } catch (e) { line = `NO (check failed: ${e.message})`; }
  fs.writeFileSync(REC, JSON.stringify(recording));
  const pass = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'visitor-to-record-v1-stage4.json'), JSON.stringify({ ...results, created, restored, apolloCalls, claudeCalls }, null, 2));
  console.log(`\n${pass}/${results.checks.length} checks passed${results.errors.length ? ` · ${results.errors.length} errors` : ''} · Apollo ${apolloCalls.length} · Claude ${claudeCalls}`);
  for (const e of results.errors) console.log('ERROR:', e.split('\n').slice(0, 3).join(' | '));
  console.log(`restored: ${line}`);
  process.exit(restored && pass === results.checks.length && !results.errors.length ? 0 : 1);
}
