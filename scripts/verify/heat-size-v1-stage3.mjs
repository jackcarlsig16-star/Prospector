// heat-size-v1 Stage 3 - LIVE as Jack (ownerSession) on the REAL HomeLover workspace, localhost against build/, 0 Claude,
// 0 Apollo (the server runs with both keys empty; the browser's calls to either host are aborted and counted).
// Writes, every one declared:
//   W1 ONE explicit writePersonActivity recompute of sales_person_activity (the stored heat on prod was v1 until now) -
//      KEPT on purpose; rows differing before / after are counted (R8's stale rows reported on the v1 email-only score).
//   W2 one headcount typed on one target through the Employees fact in the company window (PATCH
//      goals/company/target/:id/fields through the real wiring + the one-company score recompute it awaits) -
//      sales_targets (employees, employees_source, employees_at, updated_at), the company's sales_company_scores row and
//      today's sales_company_score_days row are snapshotted first and RESTORED exactly.
//   W3 one People saved view (Share view › Save view, POST goals/people/views) with the 5,000+ size chip and its ×
//      (DELETE) - sales_settings (saved_views + updated_at) snapshotted and RESTORED exactly.
// Every other non-GET API call and every browser Supabase write is aborted at the network layer and counted.
// Names and companies only - never an address or phone (the section texts and both CSVs are checked for "@").
// Declared scope: 1 owner session (released, last_seen_at restored) · ~12 table reads twice (< 3k rows each) ·
// 8 page loads · ~40 GETs · 4 API writes (W2 PATCH, W3 POST + DELETE) + W1 · ~150 s, cap 240 s.
// Usage: node scripts/verify/heat-size-v1-stage3.mjs
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { ownerSession } from './lib/ownerSession.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const AXE = fs.readFileSync(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const { selectAllPages } = await import('../../api/lib/selectAllPages.js');
const { writePersonActivity, buildPersonActivity, summarizePerson } = await import('../../api/sales/personActivity.js');
const { CSV_COLUMNS: SCORES_CSV } = await import('../../api/sales/scoresRoutes.js');
// The client model imports extensionless paths (CRA), so Node can't load it: its CSV header labels are read from the source.
const PEOPLE_CSV = [...fs.readFileSync(path.join(ROOT, 'src/components/salesAnalytics/people/peopleTableModel.js'), 'utf8').split('export const CSV_COLUMNS')[1].split('];')[0].matchAll(/label: '([^']+)'/g)].map(m => ({ label: m[1] }));
const { SIZE_BUCKETS, sizeBucketOf } = await import('../../src/constants/headcount.js');
const OUT = path.join(ROOT, '.screenshots', 'heat-size-v1');
const PORT = 3997, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data?.[0]?.id;
if (!HL) throw new Error('no HomeLover business');
const now0 = new Date();
const minsToSix = ((6 - (now0.getHours() % 6)) % 6) * 60 - now0.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now0.getHours() % 6 === 0 && now0.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const TABLES = ['sales_prospect_state', 'sales_people', 'partner_contacts', 'sales_person_activity', 'sales_email_messages', 'sales_email_activity', 'web_visits', 'sales_opportunities', 'sales_targets', 'sales_goals', 'sales_settings', 'sales_company_scores', 'sales_company_score_days'];
async function count(t) { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL); return r.error ? `n/a (${r.error.message.slice(0, 40)})` : r.count; }
const snapshot = async () => { const o = {}; for (const t of TABLES) o[t] = await count(t); return o; };
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const all = (table, cols, build = x => x) => selectAllPages(() => build(svc.from(table).select(cols).eq('business_id', HL)).order('id'));
const BANDS = ['cold', 'warm', 'hot'];
const TYPED = 4321;
const VIEW_NAME = `stage3 sizes ${Date.now().toString(36)}`;
let srv, browser, owner, lastScores = null;
const TABLE = { partner: 'sales_goals', employer: 'sales_opportunities', target: 'sales_targets' };
const blocked = [], realCalls = [], writes = [];
let patchWrites = 0, viewWrites = 0;
const results = { checks: [], errors: [], axe: {}, numbers: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 400)}` : ''); };
const before = await snapshot();
log('before', JSON.stringify(before));
const settingsBefore = (await svc.from('sales_settings').select('saved_views, updated_at').eq('business_id', HL).maybeSingle()).data;
let targetBefore = null, scoreBefore = null, dayBefore = null, target = null;
let restored = false, restoreLine = 'not run';
// The restore runs inside the abort guard's teardown so a cap / signal can never skip it (it did once: the typed
// headcount and the settings timestamp were left behind and put back by hand).
async function restoreAll() {
  try {
    const notes = [];
    if (targetBefore) {
      must(await svc.from(TABLE[target.type]).update({ employees: targetBefore.employees, employees_source: targetBefore.employees_source, employees_at: targetBefore.employees_at, updated_at: targetBefore.updated_at }).eq('id', target.id).select('id'));
      if (scoreBefore) must(await svc.from('sales_company_scores').upsert(scoreBefore, { onConflict: 'business_id,company_type,company_id' }).select('company_id'));
      if (dayBefore) must(await svc.from('sales_company_score_days').upsert(dayBefore, { onConflict: 'business_id,company_type,company_id,day' }).select('company_id'));
      else must(await svc.from('sales_company_score_days').delete().eq('business_id', HL).eq('company_type', target.type).eq('company_id', target.id).eq('day', today).select('company_id'));
      const t = must(await svc.from(TABLE[target.type]).select('employees, employees_source, employees_at, updated_at').eq('id', target.id).maybeSingle());
      const s = must(await svc.from('sales_company_scores').select('*').eq('business_id', HL).eq('company_type', target.type).eq('company_id', target.id).maybeSingle());
      if (JSON.stringify(t) !== JSON.stringify({ employees: targetBefore.employees, employees_source: targetBefore.employees_source, employees_at: targetBefore.employees_at, updated_at: targetBefore.updated_at })) throw new Error(`${TABLE[target.type]} ${target.name} differs from the snapshot`);
      if (scoreBefore && JSON.stringify(s) !== JSON.stringify(scoreBefore)) throw new Error(`sales_company_scores ${target.name} differs from the snapshot`);
      notes.push(`${target.name}: ${TABLE[target.type]} employees/source/at/updated_at + its score row${dayBefore ? ' + today\'s day row' : ' (today\'s day row removed again)'} = the snapshot`);
    }
    if (settingsBefore) {
      must(await svc.from('sales_settings').update({ saved_views: settingsBefore.saved_views, updated_at: settingsBefore.updated_at }).eq('business_id', HL).select('business_id'));
      const fin = (await svc.from('sales_settings').select('saved_views, updated_at').eq('business_id', HL).maybeSingle()).data;
      if (JSON.stringify(fin?.saved_views) !== JSON.stringify(settingsBefore.saved_views) || fin?.updated_at !== settingsBefore.updated_at) throw new Error('sales_settings differs from the snapshot');
      notes.push('sales_settings saved_views + updated_at = the snapshot');
    }
    const after = await snapshot();
    const moved = TABLES.filter(t => String(before[t]) !== String(after[t])).map(t => `${t} ${before[t]} -> ${after[t]}`);
    const expected = moved.filter(t => /^sales_person_activity /.test(t));
    const unexpected = moved.filter(t => !/^sales_person_activity /.test(t));
    if (unexpected.length) throw new Error(`counts moved: ${unexpected.join(', ')}`);
    restored = true;
    restoreLine = `yes - but for W1 (kept on purpose: sales_person_activity ${expected.join('') || 'count unchanged'}, the v2 heat prod now reads); ${notes.join('; ')}; ${TABLES.length - 1} other table counts identical; owner session released, last_seen_at restored, sign-in rows kept by rule`;
  } catch (e) { restoreLine = `NO - ${e.message}`; }
  log(`restored: ${restoreLine}`);
}
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } await restoreAll(); }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 230000 });
fs.mkdirSync(OUT, { recursive: true });

try {
  // ---- W1: the stored heat before, the fresh v2 rows, R8's stale rows on the v1 (email-only) score, then ONE recompute.
  const [storedBefore, messages, events, prospects, partnerContacts, salesPeople, opportunities, targets, partners, visits] = await Promise.all([
    selectAllPages(() => svc.from('sales_person_activity').select('person_key, contact_id, heat, heat_band, sent, computed_at').eq('business_id', HL).order('person_key')),
    selectAllPages(() => svc.from('sales_email_messages').select('apollo_message_id,contact_id,sequence_id,step,delivered_at,replied,reply_class,replied_seen_at,replied_at,num_opens,num_clicks,last_opened_at,last_clicked_at,bounced').eq('business_id', HL).order('apollo_message_id')),
    selectAllPages(() => svc.from('sales_email_activity').select('id,apollo_message_id,contact_id,step,event,occurred_at,user_agent,tracking_service').eq('business_id', HL).order('id')),
    selectAllPages(() => svc.from('sales_prospect_state').select('contact_id, name, company, opportunity_id, goal_id').eq('business_id', HL).order('contact_id')),
    all('partner_contacts', 'id, name, apollo_contact_id, goal_id'),
    all('sales_people', 'id, name, company_type, opportunity_id, target_id, company_name, source_kind, created_at, archived_at'),
    all('sales_opportunities', 'id, organization, archived_at, employees, employees_source'),
    all('sales_targets', 'id, name, status, employees, employees_source, employees_at, updated_at'),
    all('sales_goals', 'id, name, archived_at, employees, employees_source', x => x.eq('goal_type', 'partnership')),
    all('web_visits', 'id, company_key, matched_type, matched_id, visits_7d, unique_visitors_7d, last_visit, seen_to, pulled_on'),
  ]);
  const NOW = Date.now();
  const fresh = buildPersonActivity({ prospects, partnerContacts, salesPeople, opportunities, targets, partners, visits, messages, events, now: NOW });
  const freshBy = new Map(fresh.map(r => [r.person_key, r]));
  const storedBy = new Map(storedBefore.map(r => [r.person_key, r]));
  const differ = fresh.filter(r => { const s = storedBy.get(r.person_key); return !s || s.heat !== r.heat || s.heat_band !== r.heat_band; });
  const gone = storedBefore.filter(s => !freshBy.has(s.person_key));
  // R8: stale on the v1 score = stored differs from the email-only summary (no visit) - the three rows Stage 0 found.
  const msgsBy = new Map(), evsBy = new Map();
  for (const m of messages) { if (!msgsBy.has(m.contact_id)) msgsBy.set(m.contact_id, []); msgsBy.get(m.contact_id).push(m); }
  for (const e of events) { if (!evsBy.has(e.contact_id)) evsBy.set(e.contact_id, []); evsBy.get(e.contact_id).push(e); }
  const nameOfKey = k => { const [kind, id] = k.split(':'); if (kind === 'prospect') return prospects.find(p => p.contact_id === id)?.name; if (kind === 'contact') return partnerContacts.find(c => String(c.id) === id)?.name; return salesPeople.find(p => String(p.id) === id)?.name; };
  const v1Stale = storedBefore.filter(s => { if (!s.contact_id) return false; const v1 = summarizePerson(msgsBy.get(s.contact_id) || [], evsBy.get(s.contact_id) || [], NOW); return (msgsBy.get(s.contact_id) || evsBy.get(s.contact_id)) && (v1.heat !== s.heat || v1.heat_band !== s.heat_band); });
  results.numbers.before = { stored: storedBefore.length, fresh: fresh.length, differ: differ.length, newKeys: differ.filter(r => !storedBy.has(r.person_key)).length, gone: gone.length, v1Stale: v1Stale.length };
  ok(`W1 before: stored sales_person_activity rows ${storedBefore.length} · fresh v2 rows ${fresh.length} · differing (heat or band) ${differ.length} (of which ${results.numbers.before.newKeys} new keys = visit-only people) · stale keys to drop ${gone.length} · R8 stale on the v1 email-only score: ${v1Stale.length} (${v1Stale.map(s => `${nameOfKey(s.person_key)} ${s.heat}/${s.heat_band}`).join(', ') || 'none'})`, true);
  const t1 = Date.now();
  const w1 = await writePersonActivity(svc, HL, { now: NOW });
  const storedAfter = await selectAllPages(() => svc.from('sales_person_activity').select('person_key, contact_id, heat, heat_band, computed_at').eq('business_id', HL).order('person_key'));
  const afterBy = new Map(storedAfter.map(r => [r.person_key, r]));
  const differAfter = fresh.filter(r => { const s = afterBy.get(r.person_key); return !s || s.heat !== r.heat || s.heat_band !== r.heat_band; });
  results.numbers.w1 = { ...w1, ms: Date.now() - t1, storedAfter: storedAfter.length, differAfter: differAfter.length };
  ok(`W1 ONE writePersonActivity recompute: ${w1.rows} rows upserted, ${w1.removed} stale keys removed, ${Date.now() - t1} ms · stored rows ${storedBefore.length} -> ${storedAfter.length} · differing after ${differAfter.length} (the ${differ.length} before are now written; R8's ${v1Stale.length} covered)`, w1.rows === fresh.length && differAfter.length === 0 && storedAfter.length === fresh.length);
  // Band flips vs Stage 0's 19 (set B): existing rows whose band moved + new rows above cold.
  const flips = storedAfter.map(a => ({ a, b: storedBy.get(a.person_key) })).filter(({ a, b }) => (b ? b.heat_band !== a.heat_band : a.heat_band !== 'cold'));
  const by = flips.reduce((o, { a, b }) => { const k = `${b?.heat_band || 'none'}->${a.heat_band}`; o[k] = (o[k] || 0) + 1; return o; }, {});
  const up = flips.filter(({ a, b }) => BANDS.indexOf(a.heat_band) > BANDS.indexOf(b?.heat_band || 'cold')).length;
  results.numbers.flips = { total: flips.length, by, up, down: flips.length - up, existing: flips.filter(f => f.b).length, newRows: flips.filter(f => !f.b).length };
  ok(`band flips old -> new: ${flips.length} (${JSON.stringify(by)}; up ${up}, down ${flips.length - up}; ${flips.filter(f => f.b).length} existing rows moved + ${flips.filter(f => !f.b).length} new visit-only rows above cold) vs Stage 0's 19 under set B`, true);

  // ---- the server (build/) + the route reads
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', ANTHROPIC_API_KEY: '', APOLLO_API_KEY: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const get = async p => { const r = await fetch(`${BASE}/api/sales/${HL}${p}`, { headers: { cookie } }); return { status: r.status, body: await r.json().catch(() => null), text: null }; };
  const getText = async p => { const r = await fetch(`${BASE}/api/sales/${HL}${p}`, { headers: { cookie } }); return { status: r.status, text: await r.text() }; };
  const people = (await get('/goals/people/activity?window=all')).body;
  const scores = (await get('/goals/scores')).body;
  // counts.sizes / headcount are over the whole ranked set (deprioritized included); the default rows hide Deprioritized.
  const allRanked = (await get('/goals/scores?fit=strong,good,low,deprioritized')).body;
  ok(`GET goals/people/activity: ${people.total} people, hot ${people.counts.hot}, visited 7 d ${people.counts.visited_7d}; GET goals/scores: ${scores.counts.ranked} ranked (${scores.rows.length} rows without Deprioritized, ${allRanked.rows.length} with), sizes ${JSON.stringify(scores.counts.sizes)}, headcount ${JSON.stringify(scores.counts.headcount)}`, people.rows?.length > 0 && allRanked.rows.length === scores.counts.ranked);

  // ---- 10 named people: old heat -> new heat with the why lines (GET goals/people/activity/:key = the same function).
  const pick = [];
  const add = r => { if (r && !pick.some(p => p.key === r.key) && pick.length < 10) pick.push(r); };
  const visitedRow = r => r.visits && r.visits.visits_7d > 0;
  people.rows.filter(r => visitedRow(r) && r.emails.sent > 0 && storedBy.get(r.key)).slice(0, 3).forEach(add);
  people.rows.filter(r => r.identified_at && r.heat != null).slice(0, 2).forEach(add);
  people.rows.filter(r => visitedRow(r) && !r.emails.sent && !r.identified_at && r.heat != null).slice(0, 1).forEach(add);
  people.rows.filter(r => r.emails.replied > 0).slice(0, 2).forEach(add);
  people.rows.filter(r => r.emails.clicked > 0 && !visitedRow(r)).slice(0, 1).forEach(add);
  people.rows.filter(r => r.heat != null).forEach(add);
  const details = [];
  for (const r of pick) {
    const d = (await get(`/goals/people/activity/${encodeURIComponent(r.key)}`)).body;
    const old = storedBy.get(r.key);
    details.push({ name: r.name, company: r.company?.name || null, old: old ? `${old.heat} ${old.heat_band}` : 'none', now: `${r.heat} ${r.heat_band}`, live: d?.heat ? `${d.heat.score} ${d.heat.band}` : 'none', why: d?.heat?.why || [], same: d?.heat && d.heat.score === r.heat && d.heat.band === r.heat_band });
  }
  results.numbers.people = details;
  ok(`10 named people, old heat -> new heat (stored = the pinned card's live heat, with its why lines):\n` + details.map(p => `      ${p.name} (${p.company || 'no company'}): ${p.old} -> ${p.now}${p.same ? '' : ` [live ${p.live} DIFFERS]`} · ${p.why.join(' · ') || 'no why'}`).join('\n'), pick.length === 10 && details.every(p => p.same));
  const visitWhy = details.filter(p => p.why.some(l => /on the site/.test(l)));
  ok(`${visitWhy.length} of the 10 carry a visit why line ("Company on the site · n visits · k people (7 d) +n" / "Identified on the site n d ago +n")`, visitWhy.length >= 3);

  // ---- the raw record-table headcounts (service key) behind both lists' size chips and sorts
  const recEmp = new Map([...partners.map(g => [`partner:${g.id}`, g]), ...opportunities.map(o => [`employer:${o.id}`, o]), ...targets.map(t => [`target:${t.id}`, t])]);
  const empOf = (type, id) => recEmp.get(`${type}:${id}`)?.employees ?? null;
  const ranked = allRanked.rows;
  const rawMapSizes = Object.fromEntries(SIZE_BUCKETS.map(([id]) => [id, ranked.filter(r => sizeBucketOf(empOf(r.type, r.id)) === id).length]));
  const mapDiff = SIZE_BUCKETS.map(([id]) => id).filter(id => rawMapSizes[id] !== scores.counts.sizes[id]);
  ok(`Map size chips = a raw query over the record tables for the ${ranked.length} ranked companies: raw ${JSON.stringify(rawMapSizes)} vs route ${JSON.stringify(scores.counts.sizes)}${mapDiff.length ? `; differ: ${mapDiff.join(', ')} (stored score meta older than the record)` : '; all five equal'}`, mapDiff.length === 0);
  const rawPeopleSizes = Object.fromEntries(SIZE_BUCKETS.map(([id]) => [id, people.rows.filter(r => sizeBucketOf(r.company?.id ? empOf(r.company.type, r.company.id) : null) === id).length]));
  const rawMapTop = ranked.map(r => ({ name: r.name, n: empOf(r.type, r.id) })).filter(r => r.n != null).sort((a, b) => b.n - a.n).slice(0, 5);
  const peopleCompanies = [...new Map(people.rows.filter(r => r.company?.id).map(r => [`${r.company.type}:${r.company.id}`, r.company])).values()];
  const rawPeopleTop = peopleCompanies.map(c => ({ name: c.name, n: empOf(c.type, c.id) })).filter(c => c.n != null).sort((a, b) => b.n - a.n).slice(0, 5);
  const bothScoresCsv = await getText('/goals/scores/export.csv');
  const csvLines = bothScoresCsv.text.split(/\r?\n/).filter(Boolean);
  const hc = SCORES_CSV.indexOf('Headcount');
  const csvKnown = csvLines.slice(1).filter(l => l.split(',')[hc] !== 'unknown').length, csvSourced = csvLines.slice(1).filter(l => /,(Apollo|typed|researched),/.test(l)).length;
  ok(`Companies CSV (GET goals/scores/export.csv): header = scoresRoutes CSV_COLUMNS (${csvLines[0] === SCORES_CSV.join(',')}) with Headcount + Headcount source; ${csvLines.length - 1} rows, ${csvKnown} with a headcount, ${csvSourced} with a source word (the stored score meta carries employees_source only from the first full recompute after Stage 1 - see the report); no "@" (${!/@/.test(bothScoresCsv.text)})`, csvLines[0] === SCORES_CSV.join(',') && !/@/.test(bothScoresCsv.text) && csvLines.length > 1);

  // ---- the browser
  browser = await chromium.launch();
  async function open(width, view, { viewer = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 }, hasTouch: width < 900, acceptDownloads: true });
    await ctx.addInitScript(([k, v, bz, dd]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      localStorage.setItem('prospector_goals_owner', 'team');
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, dd);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (u.protocol === 'file:' || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      const apiWrite = isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname);
      if (apiWrite) writes.push(`${req.method()} ${u.pathname}`);
      const patchOk = apiWrite && !viewer && req.method() === 'PATCH' && target && u.pathname === `/api/sales/${HL}/goals/company/${target.type}/${target.id}/fields`;
      const viewOk = apiWrite && !viewer && ((req.method() === 'POST' && u.pathname === `/api/sales/${HL}/goals/people/views`) || (req.method() === 'DELETE' && u.pathname.startsWith(`/api/sales/${HL}/goals/people/views/`)));
      if (patchOk) { patchWrites += 1; return route.continue(); }
      if (viewOk) { viewWrites += 1; return route.continue(); }
      const deny = apiWrite || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.pathname}`); return route.abort(); }
      if (viewer && isLocal && u.pathname === '/api/me') {
        const r = await route.fetch(); const j = await r.json();
        j.profile = { ...j.profile, is_platform_owner: false };
        j.memberships = (j.memberships || []).map(m => (m.business_id === HL ? { ...m, role: 'viewer' } : m));
        return route.fulfill({ response: r, json: j });
      }
      // The rows the UI actually fetched (its own fit / size filters) - what the table is compared against.
      if (isLocal && req.method() === 'GET' && u.pathname === `/api/sales/${HL}/goals/scores`) {
        const r = await route.fetch(); const j = await r.json(); lastScores = j;
        return route.fulfill({ response: r, json: j });
      }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(25000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    await page.goto(`${BASE}/?tab=pipeline&view=${view}`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    try { await page.getByLabel('Workspace').waitFor({ timeout: 25000 }); }
    catch (e) { await page.screenshot({ path: `${OUT}/debug-open-${view}-${width}${viewer ? '-viewer' : ''}.png` }).catch(() => {}); log(`open(${view}@${width}) stalled: title "${await page.title()}", text: ${(await page.evaluate(() => document.body.innerText)).replace(/[^\s@<>()"',;=&#]+@[^\s@<>()"',;=&#]+/g, '[addr]').replace(/\s+/g, ' ').slice(0, 300)}`); throw e; }
    await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: /^Pipeline/ }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
    await page.locator('[data-sales-subviews]').getByRole('tab', { name: view === 'people' ? 'People' : 'Map', exact: true }).dispatchEvent('click'); await page.waitForTimeout(1500);
    if (view === 'priorities' && !compact) {
      // The Map lists the top N by intent (default 40) in Table mode too; the Top stepper only shows in chart mode, so All is set there first.
      for (let i = 0; i < 3 && (await page.locator('[data-top-n]').textContent()) !== 'All'; i++) { await page.getByRole('button', { name: 'More', exact: true }).click(); await page.waitForTimeout(300); }
      await page.getByRole('button', { name: 'Table', exact: true }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
    }
    await page.locator(view === 'people' ? '[data-people-table] [data-row]' : '[data-priorities] [data-detail-table] [data-row]').first().waitFor({ timeout: 30000 }); await page.waitForTimeout(2000);
    return { ctx, page, errors };
  }
  const axeOn = async (page, sel, key) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async s => { const r = await window.axe.run(document.querySelector(s) || document, { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); }, sel);
    results.axe[key] = v;
    ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v).slice(0, 300));
  };
  // Click the column's sort button until the header reads descending (biggest first).
  async function sortDesc(page, sel, label) {
    const th = page.locator(`${sel} th`).filter({ has: page.locator('button.ui-table__sort', { hasText: label }) }).first();
    for (let i = 0; i < 3; i++) {
      if ((await th.getAttribute('aria-sort')) === 'descending') return true;
      await th.locator('button.ui-table__sort').click(); await page.waitForTimeout(400);
    }
    return (await th.getAttribute('aria-sort')) === 'descending';
  }
  const readMap = page => page.evaluate(() => {
    const sec = document.querySelector('[data-priorities]');
    let group = null;
    const rows = [...sec.querySelectorAll('[data-detail-table] tr, [data-detail-table] li')].flatMap(el => {
      if (el.dataset.group) { group = el.dataset.group; return []; }
      if (!el.hasAttribute('data-row')) return [];
      return [{ key: el.dataset.key, group, name: el.querySelector('[data-row-name]')?.textContent.trim(), size: el.querySelector('[data-headcount]')?.textContent.trim() || null, src: el.querySelector('[data-headcount]')?.dataset.headcount || null }];
    });
    return {
      rows, ranked: rows.filter(r => r.group !== 'live'), topN: sec.querySelector('[data-top-n]')?.textContent || null,
      chips: [...sec.querySelectorAll('[data-size-chip]')].map(b => ({ id: b.dataset.sizeChip, text: b.textContent.replace(/\s+/g, ' ').trim(), count: b.querySelector('.ui-chip__count')?.textContent || '', pressed: b.getAttribute('aria-pressed') })),
      coverage: sec.querySelector('[data-coverage]')?.textContent || null, cards: sec.querySelectorAll('.ui-list__row').length,
      cardSizes: [...sec.querySelectorAll('[data-card-size]')].slice(0, 3).map(e => e.textContent.trim()),
      share: !!sec.querySelector('button[title^="Save this view"]'), sideways: document.documentElement.scrollWidth > window.innerWidth + 1, text: sec.innerText,
      at: [...sec.querySelectorAll('*')].filter(e => !e.children.length && !/^(STYLE|SCRIPT)$/.test(e.tagName) && /@/.test(e.textContent)).slice(0, 3).map(e => `${e.tagName.toLowerCase()}${e.className ? '.' + String(e.className).split(' ')[0] : ''}[${Object.keys(e.dataset).join(',')}] in ${e.closest('[data-fact],[data-pinned-card],[role=dialog],[data-detail-table],[data-company-panel],section')?.tagName.toLowerCase() || '?'}: ${e.textContent.replace(/[^\s@<>()"',;=&#]+@[^\s@<>()"',;=&#]+/g, '[addr]').slice(0, 80)}`),
    };
  });
  const readPeople = page => page.evaluate(() => {
    const sec = document.querySelector('[data-people-table]');
    const box = sec.querySelector('.ui-table-box'), table = sec.querySelector('table.ui-table');
    return {
      rows: [...sec.querySelectorAll('[data-row]')].map(el => ({ key: el.dataset.key, name: el.querySelector('[data-person-name]')?.textContent.trim(), company: el.querySelector('td:nth-child(2) > span > :first-child')?.textContent.trim() || null, size: el.querySelector('[data-size]')?.textContent.trim() || null, src: el.querySelector('[data-size]')?.dataset.size || null })),
      chips: [...sec.querySelectorAll('[data-size-chip]')].map(b => ({ id: b.dataset.sizeChip, text: b.textContent.replace(/\s+/g, ' ').trim(), count: b.querySelector('.ui-chip__count')?.textContent || '', pressed: b.getAttribute('aria-pressed') })),
      coverage: sec.querySelector('[data-coverage]')?.textContent || null, cards: sec.querySelectorAll('.ui-list__row').length,
      cardSizes: [...sec.querySelectorAll('[data-card-size]')].slice(0, 3).map(e => e.textContent.trim()),
      showing: [...sec.querySelectorAll('span, div')].map(e => e.textContent.trim()).find(t => /^Showing \d+ of \d+/.test(t)) || '',
      buttons: [...sec.querySelectorAll('[data-filter-row] button')].map(b => b.textContent.trim()),
      fit: box && table ? { boxClient: box.clientWidth, boxScroll: box.scrollWidth } : null,
      sideways: document.documentElement.scrollWidth > window.innerWidth + 1, text: sec.innerText,
    };
  });
  const numOf = s => (s == null || /unknown/.test(s) ? null : Number(String(s).replace(/[^\d]/g, '')));
  const chipN = c => Number(String(c?.count || '').replace(/[(),\s]/g, ''));
  const unknownsLast = sizes => { const nums = sizes.map(numOf); const firstUnknown = nums.indexOf(null); return (firstUnknown < 0 || nums.slice(firstUnknown).every(n => n == null)) && nums.filter(n => n != null).every((n, i, a) => i === 0 || a[i - 1] >= n); };

  // ---- Map (the Companies list) at 1440: sort by Headcount, chips, the window's Employees fact (W2).
  target = ranked.find(r => r.type === 'target' && r.employees == null && /norton/i.test(r.name || '')) || ranked.find(r => r.type === 'target' && r.employees == null);
  if (!target) throw new Error('no ranked target with an unknown headcount');
  targetBefore = must(await svc.from(TABLE[target.type]).select('id, employees, employees_source, employees_at, updated_at').eq('id', target.id).maybeSingle());
  scoreBefore = must(await svc.from('sales_company_scores').select('*').eq('business_id', HL).eq('company_type', target.type).eq('company_id', target.id).maybeSingle());
  dayBefore = must(await svc.from('sales_company_score_days').select('*').eq('business_id', HL).eq('company_type', target.type).eq('company_id', target.id).eq('day', today).maybeSingle());
  log(`W2 target: ${target.name} (${target.type} ${target.id}, fit ${target.fit_level}) employees ${targetBefore.employees} / ${targetBefore.employees_source}; score row ${scoreBefore ? 'snapshotted' : 'none'}, today's day row ${dayBefore ? 'snapshotted' : 'none'}`);
  const rowSel = `[data-priorities] [data-detail-table] [data-row][data-key="${target.key}"] [data-row-name]`;
  // The Map's default fit chips are Strong + Good; a Low-fit record (Norton LifeLock) needs the Low chip pressed first.
  const showRow = async page => { if (await page.locator(rowSel).count()) return false; await page.locator('[data-priorities] [data-fit-chip="low"]').click(); await page.waitForTimeout(1800); return true; };
  const rawTopOf = rows => rows.map(r => ({ name: r.name, n: empOf(r.type, r.id) })).filter(r => r.n != null).sort((a, b) => b.n - a.n).slice(0, 5);
  {
    const { ctx, page, errors } = await open(1440, 'priorities');
    const uiSet = lastScores;
    const m0 = await readMap(page);
    ok(`Map@1440 table (Top ${m0.topN}): ${m0.ranked.length} ranked rows = the rows the UI fetched (${uiSet.rows.length}, fit ${JSON.stringify(uiSet.filters.fit)} - the Map's default chips; ${scores.counts.ranked} ranked in all) + ${m0.rows.length - m0.ranked.length} live; chips ${m0.chips.map(c => c.text).join(' / ')} = counts.sizes over every ranked company; coverage "${m0.coverage}"`, m0.ranked.length === uiSet.rows.length && SIZE_BUCKETS.every(([id]) => chipN(m0.chips.find(c => c.id === id)) === scores.counts.sizes[id]) && m0.coverage === `headcount known for ${scores.counts.headcount.known} of ${scores.counts.headcount.companies} companies`);
    ok(`Map@1440 sort by Headcount reaches descending`, await sortDesc(page, '[data-priorities] [data-detail-table]', 'Headcount'));
    const m1 = await readMap(page);
    const top5 = m1.ranked.slice(0, 5), uiTop = rawTopOf(uiSet.rows);
    ok(`Map@1440 top 5 by size (the fetched set): ${top5.map(r => `${r.name} ${r.size}`).join(' · ')} = raw record tables ${uiTop.map(r => `${r.name} ${r.n.toLocaleString('en-US')}`).join(' · ')}; unknowns last (${m1.ranked.filter(r => numOf(r.size) == null).length} unknown rows after the last known). Over all ${ranked.length} ranked the raw top 5 is ${rawMapTop.map(r => `${r.name} ${r.n.toLocaleString('en-US')}`).join(' · ')}`, top5.map(r => r.name).join('|') === uiTop.map(r => r.name).join('|') && unknownsLast(m1.ranked.map(r => r.size)));
    await page.screenshot({ path: `${OUT}/stage3-companies-size-1440.png`, animations: 'disabled' });
    await axeOn(page, '[data-priorities]', 'companies@1440');
    // 5,000+ chip narrows the table (?size=5k on top of the fit chips) = the fetched set's rows with >= 5,000 on the record.
    for (let i = 0; i < 2 && !(lastScores?.filters?.size || []).includes('5k'); i++) { await page.locator('[data-priorities] [data-size-chip="5k"]').click(); for (let t = 0; t < 20 && !(lastScores?.filters?.size || []).includes('5k'); t++) await page.waitForTimeout(250); }
    await page.waitForTimeout(1200);
    const m2 = await readMap(page), narrowed = lastScores;
    const raw5k = uiSet.rows.filter(r => (empOf(r.type, r.id) ?? -1) >= 5000).length;
    ok(`Map@1440 chip 5,000+ narrows the ranked rows to ${m2.ranked.length} = the route's ?size=5k ${narrowed.rows.length} (filters ${JSON.stringify({ fit: narrowed.filters.fit, size: narrowed.filters.size })}) = raw record tables ${raw5k}; the chip itself reads ${scores.counts.sizes['5k']} over every ranked company`, m2.ranked.length === narrowed.rows.length && m2.ranked.length === raw5k && m2.ranked.every(r => numOf(r.size) >= 5000));
    await page.locator('[data-priorities] [data-size-chip="5k"]').click(); await page.waitForTimeout(1500);
    // W2: open the target's window from the table, type the headcount through the Employees fact.
    const pressedLow = await showRow(page);
    await page.locator(rowSel).scrollIntoViewIfNeeded();
    await page.locator(rowSel).click(); await page.waitForTimeout(2500);
    const fact = page.locator('[data-fact="Employees"][data-fact-button]');
    await fact.waitFor({ timeout: 15000 });
    const factBefore = await fact.evaluate(el => ({ text: el.textContent.trim(), need: el.dataset.need || null }));
    await fact.click(); await page.waitForTimeout(500);
    const form = page.locator('form[role="dialog"][aria-label="Employees"]');
    await form.getByLabel('Employees').fill(String(TYPED));
    const [resp] = await Promise.all([page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().includes('/fields'), { timeout: 30000 }), form.getByRole('button', { name: 'Save' }).click()]);
    const patchBody = await resp.json().catch(() => null);
    await page.waitForTimeout(3500);
    const tAfter = must(await svc.from(TABLE[target.type]).select('employees, employees_source, employees_at, updated_at').eq('id', target.id).maybeSingle());
    const sAfter = must(await svc.from('sales_company_scores').select('components, computed_at').eq('business_id', HL).eq('company_type', target.type).eq('company_id', target.id).maybeSingle());
    const factAfter = await page.locator('[data-fact="Employees"]').first().evaluate(el => ({ text: el.textContent.trim(), need: el.dataset.need || null }));
    ok(`W2 Employees fact on ${target.name} (${target.type}, fit ${target.fit_level}${pressedLow ? ' - the Low chip pressed to show it' : ''}): "${factBefore.text}" (need ${factBefore.need}) -> typed ${TYPED} -> PATCH ${resp.status()} fields ${JSON.stringify(patchBody?.fields ? { employees: patchBody.fields.employees, employees_source: patchBody.fields.employees_source } : patchBody)} · ${TABLE[target.type]} now ${tAfter.employees} / ${tAfter.employees_source} · the stored score row's meta ${JSON.stringify({ employees: sAfter?.components?.meta?.employees ?? null, employees_source: sAfter?.components?.meta?.employees_source ?? null })} (recomputed ${sAfter?.computed_at?.slice(11, 19)}) · fact now "${factAfter.text}" (need ${factAfter.need})`, resp.status() === 200 && tAfter.employees === TYPED && tAfter.employees_source === 'manual' && sAfter?.components?.meta?.employees === TYPED && sAfter?.components?.meta?.employees_source === 'manual' && factAfter.need == null);
    await page.keyboard.press('Escape'); await page.waitForTimeout(800);
    await sortDesc(page, '[data-priorities] [data-detail-table]', 'Headcount');
    const m3 = await readMap(page);
    const idx = m3.ranked.findIndex(r => r.key === target.key);
    const expectIdx = m3.ranked.filter(r => numOf(r.size) != null && numOf(r.size) > TYPED).length;
    const routeRow = (await get(`/goals/scores?fit=strong,good,low`)).body.rows.find(r => r.key === target.key);
    ok(`W2 ${target.name} sorts into place on the Map table: row ${idx + 1} of ${m3.rows.length} shows "${m3.rows[idx]?.size}" (source ${m3.rows[idx]?.src}) with ${expectIdx} bigger companies above it; the route row reads employees ${routeRow?.employees} / ${routeRow?.employees_source}`, idx >= 0 && idx === expectIdx && m3.rows[idx]?.src === 'manual' && numOf(m3.rows[idx]?.size) === TYPED && routeRow?.employees === TYPED);
    const csv2 = (await getText('/goals/scores/export.csv?fit=strong,good,low')).text;
    const csvRow = csv2.split(/\r?\n/).find(l => l.startsWith(`${target.name},`) || l.startsWith(`"${target.name}",`));
    ok(`Companies CSV after W2 carries the typed value: "${csvRow?.split(',').slice(0, 1)[0]} … ${TYPED},typed" (${csvRow?.includes(`,${TYPED},typed,`)}); no "@" (${!/@/.test(csv2)})`, !!csvRow?.includes(`,${TYPED},typed,`) && !/@/.test(csv2));
    ok(`Map@1440 no "@" in the section (${!/@/.test(m3.text)}${m3.at.length ? `; found in ${m3.at.join(' || ')}` : ''}), page not sideways (${!m3.sideways}), 0 page errors`, !/@/.test(m3.text) && !m3.sideways && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- People at 1440: sort by Size, chips vs raw, the typed target's people, CSV, Save view with sizes (W3).
  {
    const { ctx, page, errors } = await open(1440, 'people');
    const p0 = await readPeople(page);
    // W2 already typed the target's headcount: the raw buckets read the record tables as they are now.
    const targetPeople = people.rows.filter(r => r.company?.type === target.type && r.company.id === target.id).length;
    const empNow = (type, id) => (type === target.type && id === target.id ? TYPED : empOf(type, id));
    const rawPeopleSizesNow = Object.fromEntries(SIZE_BUCKETS.map(([id]) => [id, people.rows.filter(r => sizeBucketOf(r.company?.id ? empNow(r.company.type, r.company.id) : null) === id).length]));
    const chipBad = SIZE_BUCKETS.map(([id]) => id).filter(id => chipN(p0.chips.find(c => c.id === id)) !== rawPeopleSizesNow[id]);
    ok(`People@1440 size chips ${p0.chips.map(c => c.text).join(' / ')} = raw record-table buckets over the route's ${people.rows.length} people ${JSON.stringify(rawPeopleSizesNow)} (before W2: ${JSON.stringify(rawPeopleSizes)}; ${targetPeople} of ${target.name}'s people moved Unknown -> ${sizeBucketOf(TYPED)})${chipBad.length ? `; differ: ${chipBad.join(', ')}` : '; all five equal'}; coverage "${p0.coverage}"`, chipBad.length === 0 && /^headcount known for \d+ of \d+ companies · \d+ people have no company record$/.test(p0.coverage || ''));
    ok(`People@1440 sort by Size reaches descending`, await sortDesc(page, '[data-people-table]', 'Size'));
    const p1 = await readPeople(page);
    const topCos = []; for (const r of p1.rows) { if (numOf(r.size) == null) break; if (!topCos.some(c => c.name === r.company)) topCos.push({ name: r.company, n: numOf(r.size) }); if (topCos.length === 5) break; }
    const rawTopNow = [...rawPeopleTop, ...(targetPeople ? [{ name: target.name, n: TYPED }] : [])].sort((a, b) => b.n - a.n).slice(0, 5);
    ok(`People@1440 top 5 companies by size: ${topCos.map(c => `${c.name} ${c.n.toLocaleString('en-US')}`).join(' · ')} = raw ${rawTopNow.map(c => `${c.name} ${c.n.toLocaleString('en-US')}`).join(' · ')}; unknowns last (${p1.rows.filter(r => numOf(r.size) == null).length} unknown rows after the last known); the table fits its card (${p1.fit?.boxScroll} ≤ ${p1.fit?.boxClient})`, topCos.map(c => c.name).join('|') === rawTopNow.map(c => c.name).join('|') && unknownsLast(p1.rows.map(r => r.size)) && p1.fit && p1.fit.boxScroll <= p1.fit.boxClient);
    await page.screenshot({ path: `${OUT}/stage3-people-size-1440.png`, animations: 'disabled' });
    await axeOn(page, '[data-people-table]', 'people@1440');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.locator('[data-filter-row]').getByRole('button', { name: 'CSV' }).click()]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    const lines = csv.split(/\r?\n/).filter(Boolean);
    const typedLine = lines.find(l => l.includes(`,${TYPED},typed,`));
    ok(`People CSV ${dl.suggestedFilename()}: ${lines.length - 1} rows, header = the model's columns with Company size + Size source (${lines[0] === PEOPLE_CSV.map(c => c.label).join(',')}), no "@" (${!/@/.test(csv)}), ${target.name}'s people read "${TYPED},typed" (${targetPeople ? !!typedLine : 'no people on it'})`, lines[0] === PEOPLE_CSV.map(c => c.label).join(',') && !/@/.test(csv) && lines.length - 1 === people.rows.length && (!targetPeople || !!typedLine));
    // W3: Save view with the 5,000+ chip, apply it after clearing, delete it.
    await page.locator('[data-people-table] [data-size-chip="5k"]').click(); await page.waitForTimeout(600);
    const p2 = await readPeople(page);
    ok(`People@1440 chip 5,000+ narrows to ${p2.rows.length} rows = the chip's count; "${p2.showing}"`, chipN(p2.chips.find(c => c.id === '5k')) === p2.rows.length && p2.showing.startsWith(`Showing ${p2.rows.length} of ${people.total}`));
    await page.locator('[data-filter-row]').getByRole('button', { name: /^Share view/ }).click(); await page.waitForTimeout(400);
    await page.getByLabel('View name').fill(VIEW_NAME);
    await page.getByRole('button', { name: 'Save view' }).click(); await page.waitForTimeout(2000);
    const saved = (await svc.from('sales_settings').select('saved_views').eq('business_id', HL).maybeSingle()).data?.saved_views || [];
    const mine = saved.find(v => v.kind === 'people' && v.name === VIEW_NAME);
    await page.locator('[data-people-table] [data-size-chip="5k"]').click(); await page.waitForTimeout(400);
    const cleared = (await readPeople(page)).chips.find(c => c.id === '5k')?.pressed;
    await page.getByRole('button', { name: VIEW_NAME, exact: true }).click(); await page.waitForTimeout(800);
    const p3 = await readPeople(page);
    ok(`W3 Save view "${VIEW_NAME}" keeps sizes: state ${JSON.stringify(mine?.state)}; after clearing (pressed ${cleared}) the saved view re-presses 5,000+ (${p3.chips.find(c => c.id === '5k')?.pressed}) and shows ${p3.rows.length} rows`, mine && JSON.stringify(mine.state.sizes) === '["5k"]' && cleared === 'false' && p3.chips.find(c => c.id === '5k')?.pressed === 'true' && p3.rows.length === p2.rows.length);
    await page.getByRole('button', { name: `Delete view ${VIEW_NAME}` }).click(); await page.waitForTimeout(2000);
    const after = (await svc.from('sales_settings').select('saved_views').eq('business_id', HL).maybeSingle()).data?.saved_views || [];
    ok(`W3 its × removes it: saved_views ${saved.length} -> ${after.length} = the snapshot's ${(settingsBefore?.saved_views || []).length} (${JSON.stringify(after) === JSON.stringify(settingsBefore?.saved_views || [])}); view writes ${viewWrites}`, JSON.stringify(after) === JSON.stringify(settingsBefore?.saved_views || []) && viewWrites === 2);
    ok(`People@1440 no "@" in the section (${!/@/.test(p3.text)}), page not sideways (${!p3.sideways}), 0 page errors`, !/@/.test(p3.text) && !p3.sideways && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- Viewer at 1440: the chips still narrow, no Share / Share view, the Employees fact is not a button.
  {
    const { ctx, page, errors } = await open(1440, 'people', { viewer: true });
    await page.locator('[data-people-table] [data-size-chip="5k"]').click(); await page.waitForTimeout(600);
    const pv = await readPeople(page);
    await ctx.close();
    const { ctx: c2, page: p2, errors: e2 } = await open(1440, 'priorities', { viewer: true });
    const mv0 = await readMap(p2);
    await showRow(p2);
    await p2.locator(rowSel).scrollIntoViewIfNeeded();
    await p2.locator(rowSel).click(); await p2.waitForTimeout(2500);
    const factViewer = await p2.evaluate(() => { const el = document.querySelector('[data-fact="Employees"]'); return el ? { tag: el.tagName, button: el.hasAttribute('data-fact-button'), text: el.textContent.trim() } : null; });
    await p2.screenshot({ path: `${OUT}/stage3-viewer-window-1440.png`, animations: 'disabled' });
    await c2.close();
    ok(`Viewer: People toolbar ${pv.buttons.join(' · ')} (CSV yes, no Share view), 5,000+ chip narrows to ${pv.rows.length} rows; Map has no Share button (${!mv0.share}); ${target.name}'s window from the name click: ${factViewer ? `Employees fact is read-only (${factViewer.tag} "${factViewer.text}", button ${factViewer.button})` : 'no company window opens for a Viewer (row selected only)'}; API writes attempted as Viewer ${writes.filter(w => !/views|fields/.test(w)).length}; 0 page errors`, pv.buttons.includes('CSV') && !pv.buttons.some(b => /Share view/.test(b)) && pv.rows.length > 0 && !mv0.share && (!factViewer || factViewer.button === false) && !errors.length && !e2.length, [...errors, ...e2].join(' | '));
  }
  // ---- 390: cards with the size line on both lists, chips, no sideways scroll, axe.
  for (const [view, sel, name] of [['priorities', '[data-priorities]', 'companies'], ['people', '[data-people-table]', 'people']]) {
    const { ctx, page, errors } = await open(390, view);
    const m = view === 'people' ? await readPeople(page) : await readMap(page);
    await page.screenshot({ path: `${OUT}/stage3-${name}-390.png`, animations: 'disabled', fullPage: true });
    ok(`${name}@390: ${m.cards} cards, size lines e.g. ${m.cardSizes.map(s => `"${s}"`).join(' ')}, chips ${m.chips.length}, page not sideways (${!m.sideways}), 0 page errors`, m.cards > 0 && m.cardSizes.length === 3 && m.chips.length === 5 && !m.sideways && !errors.length, errors.join(' | '));
    await axeOn(page, sel, `${name}@390`);
    await ctx.close();
  }
  ok(`browser reached 0 Claude / Apollo hosts (${realCalls.length}); API writes let through: ${patchWrites} PATCH (W2) + ${viewWrites} view (W3); every other non-GET aborted (${[...new Set(writes.filter(w => !/goals\/people\/views|\/fields$/.test(w)))].join(', ') || 'none attempted'})`, !realCalls.length && patchWrites === 1 && viewWrites === 2);
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'stage3-report.json'), JSON.stringify({ ...results, restored, restoreLine, when: new Date().toISOString() }, null, 2));
  console.log(`\nheat-size-v1 Stage 3 live check: ${passed}/${results.checks.length} passed · Claude 0 · Apollo ${realCalls.length} · writes: W1 recompute + ${patchWrites} PATCH + ${viewWrites} view · ${Math.round((Date.now() - T0) / 1000)} s`);
  console.log(`files: ${fs.readdirSync(OUT).filter(f => f.startsWith('stage3')).join(', ')}`);
  console.log(`restored: ${restoreLine}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${restoreLine}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
