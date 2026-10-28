// brad-attribution-v1 Stage 3 live check - localhost against the build, as Jack (ownerSession) on the REAL HomeLover
// workspace. Declared scope: reads only, except ONE stage mark (sales_stage_marks: 1 PUT through Mark stage, then the
// toast's Undo = 1 DELETE) on one Brad-referred company that has no Meeting date and no Upside lock. Real wiring: GET
// goals/sources/funnel (1 full HomeLover gather), GET goals/sources/export?partner=Upside (1 gather), GET goals/brief for
// that company (it already has a score row - no recompute), GET goals/source for it. Browser: Dashboard > Sources at 1440
// + 390 (funnel, Brad's Visited count -> its list, bars, contrast, N2), Priorities > Table > Open -> the Journey line ->
// Mark stage -> Undo; a Viewer pass by intercepting /api/me (role viewer, not platform owner; no temp users), every
// non-GET aborted in that pass. Every other non-GET is aborted; 0 Claude / Apollo hosts. ~6 gathers of ~362 companies
// (est < 10 MB), runtime ~2-3 min, cap 240 s. "restored" THROWS if the mark is still there or any sales_* count (47
// tables, HomeLover rows; whole table where there is no business_id) or web_visits / business_anthropic_usage moved.
// Shots + report: .screenshots/brad-attribution-v1/. Run npm run build first. Never prints an address.
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
const { measureScript, summarize } = require(ROOT + '/scripts/verify/lib/contrastMeasure.cjs');
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const OUT = path.join(ROOT, '.screenshots', 'brad-attribution-v1');
const PORT = 3994, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const SALES = 'cadence_plan call_notes collateral company_score_days company_scores email_activity email_backfill_weeks email_daily_counts email_messages events goals huddles infra_items insight_dismissals lead_uploads mailbox_owners metric_targets metrics_daily month_goals opportunities opportunity_events outreach_campaigns outreach_contacts outreach_events outreach_steps outreach_tracks partner_events people prospect_events prospect_state raw_snapshots sequence_tags sequenced_accounts settings signals source_events stage_marks suggestions sync_runs targets tidy_runs visit_skip week_goal_steps week_goals week_notes week_plans week_report week_report_sections'.split(' ').map(t => `sales_${t}`);
const TABLES = [...SALES, 'web_visits', 'business_anthropic_usage'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const biz = (await svc.from('businesses').select('id, name').ilike('name', '%homelover%')).data;
if (biz?.length !== 1) throw new Error('expected one HomeLover business');
const HL = biz[0].id;
const scoped = new Map();
async function count(t) {
  if (scoped.get(t) !== false) {
    const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL);
    if (!r.error && typeof r.count === 'number') { scoped.set(t, true); return r.count; }
    if (scoped.get(t) === true) throw new Error(`count ${t}: ${r.error?.message || 'no count'}`);
    scoped.set(t, false);
  }
  const r = await svc.from(t).select('*', { count: 'exact', head: true });
  if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message || `no count (HTTP ${r.status})`}`);
  return `${r.count} (whole table)`;
}
const snapshot = async () => { const o = {}; for (const t of TABLES) o[t] = await count(t); return o; };
const marksLeft = async () => { const r = await svc.from('sales_stage_marks').select('id, record_type, record_id, stage, at').eq('business_id', HL); if (r.error) throw new Error(`marks: ${r.error.message}`); return r.data; };
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
let srv, browser, owner;
const blocked = [], realCalls = [], writes = [], allowedWrites = [];
const results = { checks: [], errors: [], axe: {}, contrast: {}, n2: {}, numbers: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 240000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
const marksBefore = await marksLeft();
log('before', JSON.stringify(before));
const md = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const get = async p => { const r = await fetch(`${BASE}/api/sales/${HL}/goals/${p}`, { headers: { cookie } }); return { status: r.status, body: await r.json().catch(() => null) }; };

  // ---- Real wiring: the funnel.
  const f = await get('sources/funnel');
  const fb = f.body || {};
  ok(`real wiring: GET goals/sources/funnel -> ${f.status}; ${fb.companies?.length} companies; no "@" in the reply`, f.status === 200 && fb.companies?.length > 0 && !JSON.stringify(fb).includes('@'));
  const S = ['referred', 'visited', 'replied', 'meeting', 'pilot', 'lost'];
  const nums = g => S.map(s => g[s]).join(' / ');
  results.numbers.totals = nums(fb.totals || {});
  results.numbers.by_rep = (fb.by_rep || []).map(g => ({ rep: g.label, counts: nums(g) }));
  log('by rep (Referred / Visited / Replied / Meeting / Pilot / Lost):'); for (const r of results.numbers.by_rep) log(`  ${r.rep}: ${r.counts}`);
  const brad = (fb.by_rep || []).find(g => /brad/i.test(g.label) && /upside/i.test(g.label));
  const upside = (fb.by_partner || []).find(g => /^upside$/i.test(g.label));
  ok(`Brad · Upside row: ${brad ? nums(brad) : 'missing'} (Referred / Visited / Replied / Meeting / Pilot / Lost)`, !!brad && brad.referred > 0);
  const bradCos = fb.companies.filter(c => c.keys?.rep === brad?.key);
  const recount = S.map(s => bradCos.filter(c => c[s]).length).join(' / ');
  ok(`Brad's counts re-derived from the companies' own dates = the row (${recount})`, recount === nums(brad || {}));
  const visitedRef = bradCos.filter(c => c.referred && c.visited).sort((a, b) => b.visited.localeCompare(a.visited));
  results.numbers.referred_then_visited = visitedRef.slice(0, 3).map(c => `${c.name} - referred ${md(c.referred)}, visited ${md(c.visited)}`);
  ok(`Brad-referred companies that visited: ${visitedRef.length}; first three: ${results.numbers.referred_then_visited.join(' | ') || 'none'}`, visitedRef.length > 0);
  // The DB agrees: each one's visit date is a real web_visits row for that company.
  const wv = (await svc.from('web_visits').select('seen_from, pulled_on, matched_id, company_name').eq('business_id', HL)).data || [];
  for (const c of visitedRef.slice(0, 3)) {
    const days = wv.filter(x => (x.matched_id === c.id) || (x.company_name || '').toLowerCase().replace(/[^a-z0-9]/g, '') === c.name.toLowerCase().replace(/[^a-z0-9]/g, '')).map(x => x.seen_from || x.pulled_on).filter(Boolean).sort();
    ok(`DB: ${c.name} has a web_visits row on the funnel's Visited day (${c.visited}; its days ${days.slice(0, 3).join(', ')})`, days.includes(c.visited));
  }

  // ---- Export for Upside.
  const ex = await get(`sources/export?partner=${upside?.key}`);
  const exRows = ex.body?.rows || [];
  results.numbers.upside_export_rows = exRows.length;
  ok(`Export for Upside: ${ex.status}, ${exRows.length} rows (funnel by partner Upside: ${upside?.companies}); columns end Referred on…Score band; no "@" / route in`, ex.status === 200 && exRows.length === upside?.companies && ['referred', 'visited', 'replied', 'meeting', 'pilot', 'lost', 'score_band'].every(k => k in (exRows[0] || {})) && !/@|route_in/i.test(JSON.stringify(ex.body)));

  // ---- The mark subject: Brad-referred, on Priorities page 1, no Meeting date, not Upside-locked.
  const sc = await get('scores');
  const top = (sc.body?.rows || []).slice(0, 40);
  const subject = top.map(r => ({ r, c: bradCos.find(c => `${c.type}-${c.id}` === r.key) })).find(x => x.c && !x.c.meeting && !x.r.touch_locked && x.r.type !== 'target');
  ok(`mark subject on Priorities page 1: ${subject ? `${subject.r.name} (${subject.r.type}, ${subject.r.band})` : 'none'}`, !!subject);
  const src = await get(`source/${subject.r.type}/${subject.r.id}`);
  ok(`GET goals/source carries the journey: "${src.body?.journey?.journey}" · locked ${src.body?.journey?.locked}`, src.status === 200 && /^Referred by /.test(src.body?.journey?.journey || '') && src.body.journey.locked === false);
  const br = await get(`brief/${subject.r.type}/${subject.r.id}`);
  const jline = (br.body?.lines || []).find(l => /^Journey: /.test(l.text));
  ok(`Brief has the Journey ref line (${jline?.ref}: ${jline?.text?.slice(0, 80)})`, br.status === 200 && !!jline);

  browser = await chromium.launch();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const markDay = new Date(Date.parse(`${today}T12:00:00Z`) - 864e5).toISOString().slice(0, 10);
  async function open(width, { viewer = false, allowMark = false, view = 'sources' } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 900 }, hasTouch: width < 900 });
    await ctx.addInitScript(([k, v, b, d]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      localStorage.setItem('prospector_goals_owner', 'team');
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${b}`, d);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      const apiWrite = isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname);
      if (apiWrite) writes.push(`${req.method()} ${u.pathname}`);
      const markWrite = apiWrite && allowMark && !viewer && /\/goals\/stage-marks\//.test(u.pathname) && ['PUT', 'DELETE'].includes(req.method());
      if (markWrite) { allowedWrites.push(`${req.method()} ${u.pathname.replace(/[0-9a-f-]{36}/g, ':id')}`); return route.continue(); }
      const deny = apiWrite || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.pathname}`); return route.abort(); }
      if (viewer && isLocal && u.pathname === '/api/me') {
        const r = await route.fetch(); const j = await r.json();
        j.profile = { ...j.profile, is_platform_owner: false };
        j.memberships = (j.memberships || []).map(m => (m.business_id === HL ? { ...m, role: 'viewer' } : m));
        return route.fulfill({ response: r, json: j });
      }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(20000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    await page.goto(`${BASE}/`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 20000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    const tab = view === 'sources' ? /^Dashboard/ : /^Pipeline/;
    await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: tab }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
    await page.locator('[data-sales-subviews]').getByRole('button', { name: view === 'sources' ? 'Sources' : 'Priorities', exact: true }).dispatchEvent('click'); await page.waitForTimeout(1500);
    await page.locator(view === 'sources' ? '[data-source-funnel]' : '[data-priorities]').waitFor({ timeout: 30000 });
    return { ctx, page, errors };
  }
  const shot = (page, nme) => page.screenshot({ path: `${OUT}/${nme}.png`, animations: 'disabled', caret: 'hide', fullPage: false });
  const measure = async (page, key, scope) => {
    const m = await page.evaluate(measureScript({ scope }));
    if (m.error) { ok(`contrast ${key}`, false, m.error); return; }
    const s = summarize(m); results.contrast[key] = s;
    ok(`contrast ${key}: 0 text < 4.5:1 and 0 controls < 3:1 (text ${s.textFails}/${s.texts}, controls ${s.controlFails}/${s.controls})`, s.textFails === 0 && s.controlFails === 0, s.worst.slice(0, 6).map(w => `${w.ratio} ${w.kind === 'text' ? `T ${w.fg} on ${w.bg}` : `C via ${w.via}`} ${w.sel} "${w.text}"`).join(' | '));
  };
  const axeOn = async (page, key, sel) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async s => { const r = await window.axe.run(document.querySelector(s), { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); }, sel);
    results.axe[key] = v;
    ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v).slice(0, 300));
  };
  const bradRow = page => page.locator('[data-source-funnel] [data-funnel-row]').filter({ hasText: /Brad/ }).filter({ hasText: /Upside/ }).first();

  // ---- 1440: Sources funnel.
  {
    const { ctx, page, errors } = await open(1440);
    const fun = page.locator('[data-source-funnel]');
    await bradRow(page).waitFor();
    const shown = await bradRow(page).locator('[data-funnel-count]').evaluateAll(els => els.map(e => `${e.dataset.funnelCount}:${e.textContent}`));
    const want = S.filter(s => brad[s]).map(s => `${s}:${brad[s].toLocaleString('en-US')}`);
    ok(`1440 Brad's row on screen = the API (${shown.join(' ')})`, JSON.stringify(shown) === JSON.stringify(want), JSON.stringify(want));
    await bradRow(page).getByRole('button', { name: /Brad/ }).click(); await page.waitForTimeout(300);
    const bars = await fun.locator('[data-funnel-chart] [data-funnel-bar]').count();
    const tableTop0 = (await fun.locator('table').boundingBox()).y, totals0 = (await fun.locator('[data-funnel-totals]').boundingBox()).y;
    await shot(page, 'sources-1440');
    await bradRow(page).locator('[data-funnel-count="visited"]').click(); await page.waitForTimeout(400);
    const listed = await fun.locator('[data-funnel-drawer="visited"] [data-funnel-company]').evaluateAll(els => els.map(e => e.dataset.funnelCompany));
    const apiVisited = bradCos.filter(c => c.visited).map(c => c.name).sort();
    ok(`1440 Brad's Visited count opens its list through the real wiring: ${listed.length} companies = the API's ${apiVisited.length}; five bars (${bars})`, listed.length === brad.visited && JSON.stringify([...listed].sort()) === JSON.stringify(apiVisited) && bars === 5);
    const tableTop1 = (await fun.locator('table').boundingBox()).y, totals1 = (await fun.locator('[data-funnel-totals]').boundingBox()).y;
    results.n2.sources = Math.abs(tableTop1 - tableTop0) + Math.abs(totals1 - totals0);
    ok(`N2 1440: opening the list moves nothing above it (${results.n2.sources} px)`, results.n2.sources === 0);
    await shot(page, 'sources-drawer-1440');
    await measure(page, 'funnel@1440', '[data-source-funnel]');
    await axeOn(page, 'funnel@1440', '[data-source-funnel]');
    for (const g of ['By partner', 'By source']) { await fun.getByRole('button', { name: g }).click(); await page.waitForTimeout(300); }
    const sourceRows = await fun.locator('[data-funnel-row]').count();
    ok(`1440 groupings switch (By source: ${sourceRows} rows = API ${fb.by_source_kind.length}); 0 page errors`, sourceRows === fb.by_source_kind.length && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- 390: Sources funnel as a list.
  {
    const { ctx, page, errors } = await open(390);
    const fun = page.locator('[data-source-funnel]');
    await bradRow(page).waitFor();
    await bradRow(page).locator('[data-funnel-count="visited"]').scrollIntoViewIfNeeded();
    await bradRow(page).locator('[data-funnel-count="visited"]').dispatchEvent('click'); await page.waitForTimeout(400);
    const listed = await fun.locator('[data-funnel-drawer="visited"] [data-funnel-company]').count();
    await shot(page, 'sources-390');
    ok(`390 the funnel is a list (no table: ${await fun.locator('table').count()}); Visited opens ${listed}; no sideways page scroll; 0 page errors`, (await fun.locator('table').count()) === 0 && listed === brad.visited && (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)) && !errors.length, errors.join(' | '));
    await measure(page, 'funnel@390', '[data-source-funnel]');
    await ctx.close();
  }
  // ---- 1440: Priorities > Table > Open -> Journey line -> Mark stage -> Undo (the one write).
  {
    const { ctx, page, errors } = await open(1440, { allowMark: true, view: 'priorities' });
    const view = page.locator('[data-priorities]');
    await view.getByRole('button', { name: 'Table' }).click(); await page.waitForTimeout(800);
    await view.getByRole('table').getByRole('button', { name: subject.r.name, exact: true }).first().click(); await page.waitForTimeout(400);
    await view.getByRole('toolbar', { name: `Actions for ${subject.r.name}` }).getByRole('button', { name: 'Open', exact: true }).click();
    await page.locator('[data-journey]').waitFor({ timeout: 20000 });
    const line0 = (await page.locator('[data-journey-line]').textContent()).replace(/\s+/g, ' ').trim();
    ok(`window Journey line = the API ("${line0}")`, line0 === src.body.journey.journey);
    const facts0 = (await page.locator('[data-facts-row]').boundingBox()).y;
    await page.getByRole('button', { name: 'Mark stage' }).click(); await page.waitForTimeout(300);
    const facts1 = (await page.locator('[data-facts-row]').boundingBox()).y;
    results.n2.panel = Math.abs(facts1 - facts0);
    ok(`N2 window: opening Mark stage moves nothing above the Journey line (${results.n2.panel} px)`, results.n2.panel === 0);
    const form = page.getByRole('group', { name: 'Mark stage' });
    await form.getByLabel('Stage').selectOption('meeting');
    await form.getByLabel('Date it happened').fill(markDay);
    await form.getByLabel('Note').fill('Stage 3 live check (removed by Undo)');
    await measure(page, 'journey+form@1440', '[data-journey]');
    await axeOn(page, 'journey+form@1440', '[data-journey]');
    await shot(page, 'mark-form-1440');
    await form.getByRole('button', { name: 'Save mark' }).click();
    await page.locator('[data-journey-stage="meeting"][data-reached="true"]').waitFor({ timeout: 15000 });
    const marked = await marksLeft();
    const meetingText = (await page.locator('[data-journey-stage="meeting"]').textContent()).replace(/\s+/g, ' ').trim();
    ok(`Mark stage -> PUT through the real route: the DB has 1 new mark (${marked.length - marksBefore.length}) for ${subject.r.name} meeting ${marked.find(m => m.record_id === subject.r.id)?.at}; the line reads "${meetingText}"`, marked.length === marksBefore.length + 1 && marked.some(m => m.record_id === subject.r.id && m.stage === 'meeting' && m.at === markDay) && meetingText.endsWith(md(markDay)));
    const stageNow = (await svc.from(subject.r.type === 'partner' ? 'sales_goals' : 'sales_opportunities').select(subject.r.type === 'partner' ? 'pipeline_status' : 'stage').eq('id', subject.r.id).maybeSingle()).data;
    ok(`the record's own stage did not move (${JSON.stringify(stageNow)} = ${subject.r.stage})`, Object.values(stageNow || {})[0] === subject.r.stage);
    await shot(page, 'marked-1440');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.locator('[data-journey-stage="meeting"][data-reached="false"]').waitFor({ timeout: 15000 });
    const after = await marksLeft();
    ok(`Undo -> DELETE through the real route: marks back to ${after.length} (before ${marksBefore.length}); the line greys Meeting again; writes sent: ${allowedWrites.join(', ')}; 0 page errors`, after.length === marksBefore.length && !after.some(m => m.record_id === subject.r.id) && allowedWrites.length === 2 && !errors.length, errors.join(' | '));
    // Priorities card chain (the funnel read once on first pointer).
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    await view.getByRole('button', { name: 'Dots' }).click(); await page.waitForTimeout(800);
    await view.locator('[data-chart-box]').hover(); await page.waitForTimeout(2500);
    await view.locator(`[data-dot="${subject.r.key}"]`).click(); await page.waitForTimeout(500);
    const chain = await page.locator('[data-pinned-card] [data-card-chain]').textContent().catch(() => null);
    ok(`Priorities card chain for ${subject.r.name}: "${chain}"`, !!chain && chain.includes('↪'));
    await ctx.close();
  }
  // ---- Viewer pass (intercepted /api/me; every non-GET aborted).
  {
    const { ctx, page, errors } = await open(1440, { viewer: true });
    await bradRow(page).waitFor();
    await bradRow(page).locator('[data-funnel-count="referred"]').click(); await page.waitForTimeout(300);
    const listed = await page.locator('[data-funnel-drawer="referred"] [data-funnel-company]').count();
    ok(`Viewer: the funnel reads (Brad's Referred lists ${listed}); no Backfill`, listed === brad.referred && (await page.getByRole('region', { name: 'Backfill sources' }).count()) === 0);
    await ctx.close();
    const v = await open(1440, { viewer: true, view: 'priorities' });
    const pv = v.page.locator('[data-priorities]');
    await pv.getByRole('button', { name: 'Table' }).click(); await v.page.waitForTimeout(800);
    await pv.getByRole('table').getByRole('button', { name: subject.r.name, exact: true }).first().click(); await v.page.waitForTimeout(400);
    await pv.getByRole('toolbar', { name: `Actions for ${subject.r.name}` }).getByRole('button', { name: 'Open', exact: true }).click();
    await v.page.locator('[data-journey]').waitFor({ timeout: 20000 });
    await shot(v.page, 'viewer-window-1440');
    ok(`Viewer: the window shows the Journey line, no Mark stage, "view access" note; 0 page errors`, (await v.page.getByRole('button', { name: 'Mark stage' }).count()) === 0 && (await v.page.getByText(/You have view access/).count()) === 1 && !errors.length && !v.errors.length, [...errors, ...v.errors].join(' | '));
    await v.ctx.close();
  }
  ok(`browser reached 0 Claude / Apollo hosts; every non-GET except the one mark + its Undo was aborted (${[...new Set(writes)].length} kinds attempted)`, !realCalls.length && writes.filter(w => !/stage-marks/.test(w)).every(w => blocked.includes(w)));
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    const after = await snapshot(), left = await marksLeft();
    const moved = TABLES.filter(t => before[t] !== after[t]).map(t => `${t} ${before[t]} -> ${after[t]}`);
    if (left.length !== marksBefore.length) throw new Error(`the stage mark is still there (${left.length} vs ${marksBefore.length} before)`);
    if (moved.length) throw new Error(`counts moved: ${moved.join(', ')}`);
    restored = true; line = `yes (${TABLES.length} table counts identical, sales_stage_marks back to ${left.length}; Jack sign-in row kept by rule, last_seen_at restored)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'stage3-report.json'), JSON.stringify({ ...results, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\nbrad-attribution-v1 Stage 3 live check: ${passed}/${results.checks.length} passed · Claude 0 · Apollo 0 · writes 2 (1 mark + its Undo)\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
