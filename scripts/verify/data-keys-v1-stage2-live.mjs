// data-keys-v1 Stage 2, part 2 - localhost, the real routes, as Jack (ownerSession) on the REAL HomeLover workspace.
// DECLARED before it runs:
//   Claude  0 and Apollo 0 (the server runs with both keys empty).
//   Setup   rows this script makes with the service key and removes at the end: ONE target "ZZ Keys Probe Works" and
//           THREE web_visits rows cloned from a real P4 row (two matched to that target, one unmatched and named like
//           the rename). They are visible in the app for about 30 s.
//   Writes  through the real routes, the two the spec names:
//           1 promote  POST goals/prospect-targets/:id/promote { to: 'employer' }
//           2 rename   PATCH opportunities/:id { organization: 'ZZ Keys Probe Renamed' }
//   Restore every row the run made is removed by id (the 3 visit rows, the employer and its event rows, the target,
//           the 2 Activity lines); 13 table counts are compared before / after. No auth_events / hk_events row is
//           deleted; ownerSession restores last_seen_at.
//   Reads   a page tour of 15 GETs (the alias counter must read 0), then ONE GET with the old word to show the counter
//           counts. ~60 requests, ~45 s; cap 200 s.
// Prints company names and counts only.
import { createRequire } from 'module';
import path from 'path';
import { spawn } from 'child_process';
import { ownerSession } from './lib/ownerSession.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const { normName } = await import('../../api/sales/normName.js');
const PORT = 3996, BASE = `http://localhost:${PORT}`;
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const HL = must(await svc.from('businesses').select('id').ilike('name', 'homelover'))[0]?.id;
if (!HL) throw new Error('no HomeLover business');
const NAME = 'ZZ Keys Probe Works', RENAMED = 'ZZ Keys Probe Renamed';
const TABLES = ['web_visits', 'sales_targets', 'sales_opportunities', 'sales_opportunity_events', 'sales_flow_events', 'sales_source_events', 'sales_week_goals', 'sales_todo_events', 'sales_people', 'sales_company_scores', 'research_runs', 'sales_goals', 'partner_domains'];
const count = async t => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL); return r.error ? `n/a (${r.error.message.slice(0, 40)})` : r.count; };
const snapshot = async () => { const o = {}; for (const t of TABLES) o[t] = await count(t); return o; };
const d = new Date(), toSix = ((6 - (d.getHours() % 6)) % 6) * 60 - d.getMinutes();
if ((toSix >= 0 && toSix < 5) || (d.getHours() % 6 === 0 && d.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
const leftovers = [...must(await svc.from('sales_targets').select('id').eq('business_id', HL).ilike('name', 'ZZ Keys Probe%')), ...must(await svc.from('sales_opportunities').select('id').eq('business_id', HL).ilike('organization', 'ZZ Keys Probe%')), ...must(await svc.from('web_visits').select('id').eq('business_id', HL).ilike('company_name', 'ZZ Keys Probe%'))];
if (leftovers.length) { console.log(`ABORT: ${leftovers.length} "ZZ Keys Probe" row(s) are already there - look before running again`); process.exit(1); }

let srv, owner, alias = [];
const made = { visits: [], target: null, employer: null };
const results = { checks: [], errors: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 500)}` : ''); };
async function teardown() {
  if (srv) srv.kill(); srv = null;
  // Remove what this run made, by id. Nothing else is touched.
  const ids = [made.target, made.employer].filter(Boolean);
  if (made.visits.length) must(await svc.from('web_visits').delete().eq('business_id', HL).in('id', made.visits).ilike('company_name', 'ZZ Keys Probe%'));
  if (ids.length) {
    must(await svc.from('sales_flow_events').delete().eq('business_id', HL).in('record_id', ids));
    must(await svc.from('sales_source_events').delete().eq('business_id', HL).in('record_id', ids));
    must(await svc.from('sales_company_scores').delete().eq('business_id', HL).in('company_id', ids));
  }
  if (made.employer) {
    must(await svc.from('sales_opportunity_events').delete().eq('business_id', HL).eq('opportunity_id', made.employer));
    must(await svc.from('sales_opportunities').delete().eq('business_id', HL).eq('id', made.employer).ilike('organization', 'ZZ Keys Probe%'));
  }
  if (made.target) must(await svc.from('sales_targets').delete().eq('business_id', HL).eq('id', made.target).ilike('name', 'ZZ Keys Probe%'));
  if (owner) { log(await owner.release()); owner = null; }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 200000 });
const before = await snapshot();
log('before', JSON.stringify(before));

try {
  // Setup: the target and its visit rows (cloned from real rows so every required column is set).
  const tplT = must(await svc.from('sales_targets').select('*').eq('business_id', HL).eq('status', 'researching').is('visit_id', null).limit(1))[0];
  const tplV = must(await svc.from('web_visits').select('*').eq('business_id', HL).eq('priority', 'P4').is('matched_id', null).order('pulled_on', { ascending: false }).limit(1))[0];
  if (!tplT || !tplV) throw new Error('no row to clone');
  const strip = (row, set) => { const { id, created_at, updated_at, ...rest } = row; return { ...rest, ...set }; };
  const t = must(await svc.from('sales_targets').insert(strip(tplT, { name: NAME, kind: 'employer', status: 'researching', evidence: 'data-keys-v1 Stage 2 test row - removed at the end of the run', research_notes: null, record_id: null, domain: null, domain_source: null, employees: null, employees_source: null, employees_at: null, owner_user_id: null, owner_team: null, co_owner_name: null, source_kind: null, source_partner_id: null, source_person: null, source_office: null, source_set_by: null, source_set_at: null, source_note_id: null, employer_id: null, promoted_goal_id: null, promoted_from_note: null, apollo_account_id: null, decided_at: null, pinned_until: null, pin_reason: null, pinned_by: null, pinned_at: null, signal_id: null, source_campaign_id: null, source_note: null, route_in: null, research_prompt: null, suggested_category: null, apollo_firmographics: null, domain_at: null, fit_level: null, fit_set_by: null, fit_set_at: null, deprioritized_reason: null, deprioritized_note: null, deprioritized_at: null, deprioritized_by: null, us_footprint: null, us_footprint_source: null, us_footprint_at: null, created_by: null })).select('id').single());
  made.target = t.id;
  const visit = (name, pulled, match) => strip(tplV, { company_name: name, company_key: normName(name), domain: null, apollo_org_id: null, linkedin_url: null, pulled_on: pulled, matched_type: match ? 'target' : null, matched_id: match ? t.id : null, noise_reason: 'data-keys-v1 Stage 2 test row', priority_rule: 'data-keys-v1 Stage 2 test row' });
  const day = tplV.pulled_on, dayBefore = new Date(Date.parse(`${day}T12:00:00Z`) - 864e5).toISOString().slice(0, 10);
  const vs = must(await svc.from('web_visits').insert([visit(NAME, day, true), visit(NAME, dayBefore, true), visit(RENAMED, day, false)]).select('id, company_key'));
  made.visits = vs.map(v => v.id);
  const [v1, v2, v3] = made.visits;
  log(`setup: target ${NAME} + 3 visit rows (2 matched to it, 1 unmatched named ${RENAMED})`);

  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', APOLLO_API_KEY: '', ANTHROPIC_API_KEY: '' }, stdio: ['ignore', 'ignore', 'pipe'] });
  srv.stderr.on('data', b => { for (const l of String(b).split('\n')) { if (l.includes('[readType]')) alias.push(l.trim()); else if (l.trim() && process.env.SERVER_LOG) console.log('   server:', l.trim().slice(0, 200)); } });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const call = async (method, p, body) => { const r = await fetch(`${BASE}/api/sales/${HL}${p}`, { method, headers: { cookie, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, body: await r.json().catch(() => null) }; };

  // The page tour: what the main screens read.
  const anEmployer = must(await svc.from('sales_week_goals').select('link_id').eq('business_id', HL).eq('link_type', 'employer').limit(1))[0]?.link_id;
  const local = new Date(Date.now() - new Date().getTimezoneOffset() * 60e3), monday = new Date(local.getTime() - ((local.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
  const tour = ['/goals/pipeline-board', '/goals/scores', '/goals/top-targets?owner=me', '/goals/today', '/goals/today/fixes', '/goals/people/activity', '/goals/funnel', '/goals/dashboard', '/goals/sources', '/goals/clients', `/goals/week?from=${monday}&to=${monday}`, '/opportunities',
    `/goals/company?type=employer&id=${anEmployer}`, `/goals/tasks?link_type=employer&link_id=${anEmployer}`, `/goals/week/events?link_type=employer&link_id=${anEmployer}`];
  const statuses = [];
  for (const p of tour) statuses.push([p.split('?')[0], (await call('GET', p)).status]);
  ok(`page tour: ${tour.length} GETs, all 200`, statuses.every(s => s[1] === 200), statuses.filter(s => s[1] !== 200).map(s => s.join(' ')).join(', '));
  ok(`the alias counter after the tour: ${alias.length}`, alias.length === 0, alias[0]);
  const old = await call('GET', `/goals/tasks?link_type=opportunity&link_id=${anEmployer}`);
  await new Promise(r => setTimeout(r, 300));
  ok(`an old tab's word still works and is counted: HTTP ${old.status}, ${old.body?.tasks?.length} to-do(s), counter ${alias.length}`, old.status === 200 && old.body?.tasks?.length > 0 && alias.length === 1, alias[0]);

  // 1 - promote
  const visitsNow = async () => must(await svc.from('web_visits').select('id, company_key, matched_type, matched_id').in('id', made.visits)).reduce((m, v) => m.set(v.id, v), new Map());
  const pr = await call('POST', `/goals/prospect-targets/${t.id}/promote`, { to: 'employer' });
  made.employer = pr.body?.created?.id || null;
  ok(`promote: HTTP ${pr.status} · created ${pr.body?.created?.type} "${pr.body?.created?.name}" · visits_moved ${pr.body?.visits_moved}`, pr.status === 201 && pr.body?.created?.type === 'employer' && pr.body?.visits_moved === 2, JSON.stringify(pr.body).slice(0, 300));
  const tgt = must(await svc.from('sales_targets').select('status, employer_id').eq('id', t.id).single());
  ok(`K2 the target is accepted and carries employer_id = the new employer`, tgt.status === 'accepted' && tgt.employer_id === made.employer);
  let vv = await visitsNow();
  ok('K10 the 2 matched rows follow the employer; the unmatched row of another name is untouched; no key was rewritten', [v1, v2].every(id => vv.get(id).matched_type === 'employer' && vv.get(id).matched_id === made.employer && vv.get(id).company_key === normName(NAME)) && vv.get(v3).matched_id === null);
  const emp = must(await svc.from('sales_opportunities').select('organization, owner, owner_user_id').eq('id', made.employer).single());
  ok(`K8 the employer has an owner id and no owner text`, emp.owner_user_id === owner.userId && emp.owner == null, `owner text ${JSON.stringify(emp.owner)}`);
  const win = await call('GET', `/goals/company?type=target&id=${t.id}`);
  ok(`the target's window: promoted → ${win.body?.record?.promoted_to?.name}`, win.status === 200 && win.body?.record?.promoted_to?.id === made.employer && win.body.record.promoted_to.type === 'employer');
  const board = await call('GET', '/goals/pipeline-board');
  // (the still-unmatched test visit row of the other name is its own visitor row until the rename)
  const rowsOf = b => (b.body?.rows || []).filter(r => r.name === NAME).map(r => r.type);
  ok(`the board lists ${NAME} once, as the employer (the promoted target is hidden): ${rowsOf(board).join(', ')}`, rowsOf(board).join() === 'employer');
  const flow = async () => must(await svc.from('sales_flow_events').select('kind, text, record_type, meta, by_user, at').eq('business_id', HL).eq('record_id', made.employer).order('at'));
  let ev = await flow();
  ok(`the Activity line of the promote: "${ev[0]?.text}"`, ev.length === 1 && ev[0].kind === 'restamp' && ev[0].meta.visits_moved === 2 && ev[0].by_user === owner.userId);

  // 2 - rename
  const rn = await call('PATCH', `/opportunities/${made.employer}`, { organization: RENAMED });
  ok(`rename: HTTP ${rn.status} · now "${rn.body?.opportunity?.organization}"`, rn.status === 200 && rn.body?.opportunity?.organization === RENAMED, JSON.stringify(rn.body).slice(0, 300));
  vv = await visitsNow();
  ok('K10 after the rename: the 2 rows stay on the employer under their own key, and the unmatched row of the new name joined', [v1, v2].every(id => vv.get(id).matched_id === made.employer && vv.get(id).company_key === normName(NAME)) && vv.get(v3).matched_type === 'employer' && vv.get(v3).matched_id === made.employer);
  ev = await flow();
  ok(`the Activity line of the rename: "${ev[1]?.text}"`, ev.length === 2 && ev[1].kind === 'restamp' && ev[1].meta.visits_matched === 1 && ev[1].text.startsWith(`Renamed ${NAME} → ${RENAMED}`));
  const tw = Date.now();
  const win2 = await call('GET', `/goals/company?type=employer&id=${made.employer}`);
  ok(`the employer's window reads its 3 visit rows by id: ${win2.body?.visits?.length} (${Math.round((Date.now() - tw) / 1000)} s)`, win2.status === 200 && win2.body?.visits?.length === 3);
  ok(`the alias counter at the end: ${alias.length} (the one deliberate old-word request)`, alias.length === 1);
} catch (e) { results.errors.push(e.message); log('ERROR', e.message); }
finally {
  await cleanup();
  const after = await snapshot();
  const moved = TABLES.filter(t => before[t] !== after[t]);
  const left = [...must(await svc.from('sales_targets').select('id').eq('business_id', HL).ilike('name', 'ZZ Keys Probe%')), ...must(await svc.from('sales_opportunities').select('id').eq('business_id', HL).ilike('organization', 'ZZ Keys Probe%')), ...must(await svc.from('web_visits').select('id').eq('business_id', HL).ilike('company_name', 'ZZ Keys Probe%')), ...(made.employer || made.target ? must(await svc.from('sales_flow_events').select('id').eq('business_id', HL).in('record_id', [made.target, made.employer].filter(Boolean))) : [])];
  log('after', JSON.stringify(after));
  const pass = results.checks.filter(c => c.pass).length;
  console.log(`\nchecks: ${pass}/${results.checks.length} passed${results.errors.length ? ` · errors: ${results.errors.join(' | ')}` : ''}`);
  console.log('Claude: 0 · Apollo: 0 · writes through routes: 1 promote + 1 rename, on rows this run made');
  console.log(`restored: ${left.length ? `NO - ${left.length} test row(s) remain` : moved.length ? `CHECK - no test row remains, but counts moved on ${moved.map(t => `${t} ${before[t]} -> ${after[t]}`).join(', ')} (see who wrote)` : 'yes (no test row remains; 13 table counts as before; the sign-in row is kept by rule)'}`);
  process.exit(results.errors.length || pass !== results.checks.length || left.length ? 1 : 0);
}
