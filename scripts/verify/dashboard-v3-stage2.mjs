// dashboard-v3 Stage 2 live check - localhost against the build, as Jack (ownerSession) on the REAL HomeLover workspace,
// READ-ONLY (0 Claude, 0 Apollo, 0 writes: every non-GET API call and Supabase write is aborted at the network layer and
// counted). Real wiring: GET goals/pulse (this week + month), GET goals/explorer (the Stage 3 stub), GET /insights.
// Browser at 1440: Dashboard › Home = title line · seven Pulse tiles whose digits are the pulse route's · the Insights
// card (top three of the route's list, one action each, or "Nothing to flag") · the Explorer marked Stage 3; switching
// the Period (frame row) re-reads and moves the frame 0 px (N2); the Goals section + Track & improve sit under Actions,
// not on Home; axe 0. 390: seven tiles, no sideways scroll, axe 0. Viewer (intercepted /api/me): Home reads the same,
// no write control. Side-by-side PNG: specs/design/dashboard-v3/Dash.dc.html (file://) beside the build at 1440.
// ~2.5 min, cap 300 s. Shots + report: .screenshots/dashboard-v3-stage2/.
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
const OUT = path.join(ROOT, '.screenshots', 'dashboard-v3-stage2');
const MOCK = path.join(ROOT, 'specs', 'design', 'dashboard-v3', 'Dash.dc.html');
const PORT = 3999, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const TABLES = ['sales_metric_targets', 'sales_week_goals', 'sales_insight_dismissals', 'sales_outreach_campaigns', 'sales_opportunities', 'sales_goals', 'sales_targets', 'sales_partner_events', 'business_anthropic_usage', 'sales_sync_runs', 'web_visits', 'microsoft_events', 'sales_email_daily_counts'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data?.[0]?.id;
if (!HL) throw new Error('no HomeLover business');
const count = async t => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL); if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message}`); return r.count; };
const snapshot = async () => { const o = {}; for (const t of TABLES) o[t] = await count(t); return o; };
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const fmt = n => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const pts = r => (r == null ? '—' : (r * 100).toFixed(1));
const TILES = ['sent', 'delivered_rate', 'human_open_rate', 'reply_rate', 'meetings', 'visitors', 'first_touched'];
// The tile's main digit as HomeView.tileValue formats it (the route's value; a rate in points; first-touched with its goal).
const expected = (k, m) => (m.value == null ? '—' : m.kind === 'rate' ? `${pts(m.value)}%` : k === 'first_touched' && m.goal != null ? `${fmt(m.value)}/${fmt(m.goal)}` : fmt(m.value));
let srv, browser, owner;
const blocked = [], realCalls = [], writes = [];
const results = { checks: [], errors: [], axe: {}, n2: {}, deviations: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 300000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', ANTHROPIC_API_KEY: '', APOLLO_API_KEY: '', MICROSOFT_CLIENT_SECRET: '', GMAIL_CLIENT_SECRET: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const get = async p => { const r = await fetch(`${BASE}/api/sales/${HL}${p}`, { headers: { cookie } }); return { status: r.status, body: await r.json().catch(() => null) }; };
  // ---- Real wiring: the pulse route (this week + month), the Explorer stub, the insights list.
  const week = await get('/goals/pulse?period=this_week');
  const month = await get('/goals/pulse?period=month');
  const wm = week.body?.metrics || {};
  ok(`real wiring: GET goals/pulse this_week ${week.status} (${week.body?.from} – ${week.body?.to}; ${TILES.map(k => `${k} ${wm[k]?.value}`).join(' · ')}; synced ${week.body?.synced_at}; ${week.body?.apollo_calls} Apollo calls; credits ${JSON.stringify(week.body?.credits)})`,
    week.status === 200 && TILES.every(k => wm[k] && Array.isArray(wm[k].series) && wm[k].series.length === 5));
  ok(`real wiring: GET goals/pulse month ${month.status} (${month.body?.from} – ${month.body?.to}; sent ${month.body?.metrics?.sent?.value}, prev ${month.body?.metrics?.sent?.prev})`, month.status === 200 && month.body?.from === `${today.slice(0, 7)}-01`);
  const bad = await get('/goals/pulse?period=year');
  ok(`GET goals/pulse?period=year -> ${bad.status} ${bad.body?.error}`, bad.status === 400);
  const ex = await get('/goals/explorer');
  ok(`real wiring: GET goals/explorer ${ex.status} stub "${ex.body?.stub}" (${ex.body?.series?.length} days since ${ex.body?.from})`, ex.status === 200 && ex.body?.stub === 'Stage 3' && ex.body?.series?.length >= 1);
  const ins = await get('/insights');
  const nIns = ins.body?.insights?.length ?? -1;
  ok(`real wiring: GET /insights ${ins.status} (${nIns} fired: ${(ins.body?.insights || []).slice(0, 3).map(i => `${i.id} ${i.severity}`).join(', ')}; ${ins.body?.not_enough_data?.length} waiting)`, ins.status === 200 && nIns >= 0);

  browser = await chromium.launch();
  async function open(width, { viewer = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 }, hasTouch: width < 900 });
    await ctx.addInitScript(([k, v, bz, d]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      localStorage.setItem('prospector_goals_owner', 'team');
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, d);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (u.protocol === 'file:') return route.continue();
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      const apiWrite = isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname);
      if (apiWrite) writes.push(`${req.method()} ${u.pathname}`);
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
    const page = await ctx.newPage(); page.setDefaultTimeout(25000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    await page.goto(`${BASE}/`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 25000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    return { ctx, page, errors };
  }
  const tabs = page => page.locator('#workspace-header-tabs, [data-sales-tabrow]');
  const topTab = async (page, re) => { await tabs(page).getByRole('button', { name: re }).first().dispatchEvent('click'); await page.waitForTimeout(1500); };
  const subTab = async (page, name) => { await page.locator('[data-sales-subviews]').getByRole('tab', { name, exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500); };
  const shot = (page, nme, opts = {}) => page.screenshot({ path: `${OUT}/${nme}.png`, animations: 'disabled', caret: 'hide', fullPage: false, ...opts });
  const axeOn = async (page, key, sel) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async s => { const r = await window.axe.run(document.querySelector(s) || document, { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); }, sel);
    results.axe[key] = v;
    ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v).slice(0, 300));
  };
  const tileValues = async page => { const o = {}; for (const k of TILES) o[k] = (await page.locator(`[data-pulse-tile="${k}"] [data-value]`).textContent().catch(() => null))?.trim(); return o; };
  const waitHome = async page => { await page.locator('[data-pulse]').waitFor({ timeout: 30000 }); await page.locator('[data-pulse-tile="sent"]').waitFor({ timeout: 30000 }); await page.waitForTimeout(1200); };

  // ---- 1440: Home.
  {
    const { ctx, page, errors } = await open(1440);
    // Actions holds the Goals section + Track & improve now; Home must not.
    const onActions = { goals: await page.locator('#goals-section').count(), track: await page.locator('[data-track-improve]').count() };
    ok(`Actions holds the Goals section (${onActions.goals}) and Track & improve (${onActions.track})`, onActions.goals === 1 && onActions.track === 1);
    await topTab(page, /^Dashboard/);
    await subTab(page, 'Home');
    await waitHome(page);
    const got = await tileValues(page);
    const mism = TILES.filter(k => got[k] !== expected(k, wm[k])).map(k => `${k}: screen ${got[k]} vs route ${expected(k, wm[k])}`);
    ok(`1440 seven tiles = the pulse route's digits (${TILES.map(k => `${k} ${got[k]}`).join(' · ')})`, (await page.locator('[data-pulse-tile]').count()) === 7 && !mism.length, mism.join(' | '));
    const dirs = {}; for (const k of TILES) dirs[k] = await page.locator(`[data-pulse-tile="${k}"] [data-delta]`).getAttribute('data-delta');
    const dirOk = TILES.filter(k => !['meetings', 'first_touched'].includes(k) || wm[k].goal == null).every(k => (wm[k].delta == null ? dirs[k] === 'none' : wm[k].delta === 0 ? dirs[k] === 'flat' : wm[k].delta > 0 ? dirs[k] === 'good' : dirs[k] === 'bad') || (k === 'meetings' && dirs[k] === 'flat'));
    ok(`1440 deltas by direction (${TILES.map(k => `${k} ${wm[k].delta == null ? 'null' : wm[k].delta > 0 ? '+' : wm[k].delta < 0 ? '−' : '0'} → ${dirs[k]}`).join(' · ')})`, dirOk);
    const meta = (await page.locator('[data-home-meta]').textContent()).trim();
    ok(`1440 title line: "${meta}"`, /synced/.test(meta) && /Apollo calls/.test(meta) && /of 500 credits/.test(meta));
    const sparks = await page.locator('[data-pulse-tile] svg path').count();
    ok(`1440 sparklines drawn on ${sparks} of 7 tiles (a tile with < 2 points draws none)`, sparks >= 1);
    const onHome = { goals: await page.locator('#goals-section').count(), track: await page.locator('[data-track-improve]').count(), charts: await page.locator('[data-sales-section="dashboard"] canvas, [data-dashboard-charts]').count() };
    ok(`1440 Home has no Goals section (${onHome.goals}), no Track & improve (${onHome.track}), no chart cards (${onHome.charts})`, !onHome.goals && !onHome.track && !onHome.charts);
    const shown = await page.locator('[data-insight]').count();
    const empty = await page.locator('[data-insights-empty]').count();
    const ids = await page.locator('[data-insight]').evaluateAll(els => els.map(e => `${e.dataset.insight} ${e.dataset.severity}`));
    const routeTop = (ins.body?.insights || []).slice(0, 3).map(i => `${i.id} ${i.severity}`);
    ok(`1440 Insights: ${shown} shown of ${nIns} fired (${ids.join(', ')}) = the route's top three; empty state ${empty}`, shown === Math.min(3, nIns) && ids.join('|') === routeTop.join('|') && empty === (nIns ? 0 : 1));
    const actions = await page.locator('[data-insight] a, [data-insight] button').evaluateAll(els => els.map(e => e.textContent.trim()));
    ok(`1440 one action per insight (${actions.join(' · ') || 'none'}), no Dismiss`, actions.length <= shown && !actions.some(a => /Dismiss/.test(a)) && (await page.getByRole('button', { name: /Dismiss/ }).count()) === 0);
    const allLink = await page.getByRole('button', { name: new RegExp(`All ${nIns} in Email`) }).count();
    ok(`1440 "All ${nIns} in Email →" ${nIns ? 'shown' : 'absent (0 fired)'}`, nIns ? allLink === 1 : allLink === 0);
    const explorer = await page.locator('[data-explorer="stage-3"]').textContent();
    ok(`1440 Explorer area marked Stage 3 ("${explorer.replace(/\s+/g, ' ').slice(0, 110)}")`, /Stage 3/.test(explorer) && /stubbed/.test(explorer));
    const tools = (await page.locator('#sales-frame-tools').textContent()).replace(/\s+/g, ' ').trim();
    ok(`1440 tools: ${tools.slice(0, 90)} (Period · Who · Export)`, /This week/.test(tools) && /Team/.test(tools) && /Export/.test(tools) && !/Range|All teams/.test(tools));
    const row = await page.locator('[data-sales-frame]').evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth, tools: document.getElementById('sales-frame-tools').getBoundingClientRect() }));
    ok(`1440 the frame row fits without sideways scroll (${row.scroll} of ${row.client} px; tools from x ${Math.round(row.tools.left)})`, row.scroll <= row.client + 1);
    const tileRows = await page.locator('[data-pulse-tile]').evaluateAll(els => new Set(els.map(e => Math.round(e.getBoundingClientRect().top))).size);
    ok(`1440 seven tiles on ${tileRows} row`, tileRows === 1);
    await shot(page, 'home-1440');
    await shot(page, 'home-1440-full', { fullPage: true });
    await axeOn(page, 'home@1440', '[data-sales-tab], #sales-analytics-root');
    // N2 + a period change: the frame stays put, the tiles re-read with month digits.
    const frameY0 = await page.locator('[data-sales-frame]').evaluate(el => el.getBoundingClientRect().top);
    await page.locator('#sales-frame-tools').getByRole('group', { name: 'Period' }).getByRole('button', { name: 'Month' }).click();
    await page.waitForTimeout(3000); await waitHome(page);
    const frameY1 = await page.locator('[data-sales-frame]').evaluate(el => el.getBoundingClientRect().top);
    results.n2.period = Math.abs(frameY1 - frameY0);
    ok(`1440 N2: switching the Period moves the frame 0 px (${results.n2.period})`, results.n2.period === 0);
    const gotM = await tileValues(page);
    const mm = month.body?.metrics || {};
    const mismM = TILES.filter(k => gotM[k] !== expected(k, mm[k])).map(k => `${k}: screen ${gotM[k]} vs route ${expected(k, mm[k])}`);
    ok(`1440 Month tiles = GET goals/pulse?period=month (${TILES.map(k => `${k} ${gotM[k]}`).join(' · ')}); title ${(await page.locator('[data-home] h1').textContent()).trim()}`, !mismM.length, mismM.join(' | '));
    await shot(page, 'home-month-1440');
    ok('1440 0 page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- 390.
  {
    const { ctx, page, errors } = await open(390);
    await topTab(page, /^Dashboard/);
    await subTab(page, 'Home');
    await waitHome(page);
    const tiles = await page.locator('[data-pulse-tile]').count();
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    const got = await tileValues(page);
    ok(`390: ${tiles} tiles, no sideways scroll ${sideways}; sent ${got.sent} = route ${expected('sent', wm.sent)}`, tiles === 7 && sideways && got.sent === expected('sent', wm.sent));
    await shot(page, 'home-390', { fullPage: true });
    await axeOn(page, 'home@390', '[data-sales-tab], #sales-analytics-root');
    ok('390 0 page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- Viewer.
  {
    const { ctx, page, errors } = await open(1440, { viewer: true });
    await topTab(page, /^Dashboard/);
    await subTab(page, 'Home');
    await waitHome(page);
    const got = await tileValues(page);
    const writeBtns = await page.locator('[data-home] button, [data-home] input, [data-home] textarea').evaluateAll(els => els.map(e => e.textContent.trim() || e.tagName).filter(t => !/in Email|Open Email/.test(t)));
    const viewOnly = await page.locator('#sales-frame-tools').getByText('View only').count();
    await shot(page, 'home-viewer-1440');
    ok(`Viewer: same digits (sent ${got.sent}), View only chip ${viewOnly}, write controls on Home: ${writeBtns.length} (${writeBtns.join(', ') || 'none'}); 0 page errors`, got.sent === expected('sent', wm.sent) && viewOnly === 1 && !writeBtns.length && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- Side-by-side: mockup (file://) | prod build, 1440.
  {
    const width = 1440, height = 1000;
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    await page.goto(`file://${MOCK}`); await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/mockup-1440.png`, fullPage: true });
    const compose = await ctx.newPage();
    const b64 = f => fs.readFileSync(path.join(OUT, f)).toString('base64');
    await compose.setViewportSize({ width: width * 2 + 48, height: 200 });
    await compose.setContent(`<body style="margin:0;background:#000;color:#fff;font:12px monospace"><div style="display:flex;gap:16px;padding:16px;align-items:flex-start"><figure style="margin:0"><figcaption style="padding:4px 0">mockup · Dash.dc.html · 1440</figcaption><img src="data:image/png;base64,${b64('mockup-1440.png')}" style="width:${width}px;display:block"></figure><figure style="margin:0"><figcaption style="padding:4px 0">prod build · HEAD · 1440 (full page)</figcaption><img src="data:image/png;base64,${b64('home-1440-full.png')}" style="width:${width}px;display:block"></figure></div></body>`);
    await compose.waitForTimeout(500);
    await compose.screenshot({ path: `${OUT}/side-by-side-1440.png`, fullPage: true });
    ok('side-by-side-1440.png written (mockup | prod)', true);
    await ctx.close();
  }
  ok(`browser reached 0 Claude / Apollo hosts; every non-GET was aborted (${[...new Set(writes)].join(', ') || 'none attempted'})`, !realCalls.length && writes.every(w => blocked.includes(w)));
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    const after = await snapshot();
    const moved = TABLES.filter(t => before[t] !== after[t]).map(t => `${t} ${before[t]} -> ${after[t]}`);
    if (moved.length) throw new Error(`counts moved: ${moved.join(', ')}`);
    restored = true; line = `yes (${TABLES.length} table counts identical; Jack sign-in row kept by rule, last_seen_at restored)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'stage2-report.json'), JSON.stringify({ ...results, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\ndashboard-v3 Stage 2 live check: ${passed}/${results.checks.length} passed · Claude 0 · Apollo ${realCalls.length} · writes 0 · ${Math.round((Date.now() - T0) / 1000)} s`);
  console.log(`files: ${fs.readdirSync(OUT).join(', ')}`);
  console.log(`restored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
