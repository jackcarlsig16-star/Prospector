// dashboard-v3 Stage 1 live check - localhost against the build, as Jack (ownerSession) on the REAL HomeLover workspace,
// READ-ONLY (0 Claude, 0 Apollo, 0 writes: every non-GET API call and Supabase write is aborted at the network layer and
// counted; the goal-saving paths are exercised by the Jest suite, never here). Real wiring: GET goals/scorecard for this
// month (the digits) and GET goals/hero (the same builder) must agree. Browser at 1440: Dashboard sub-views read Home ·
// Email · Scorecard · Sources; Pipeline hides Campaigns (0 rows); the Scorecard table's cells = the route's digits for this
// week and the month; this week tinted; future weeks "—"; the Outlook row names the calendar; N2 0 px when the month
// changes; axe 0; print media + PDF. ?view=sequenced lands on Email. 390: eight tiles, no table, no sideways scroll, axe 0.
// Viewer (intercepted /api/me): no goal buttons, read-only line. Side-by-side PNGs: the mockup (specs/design/dashboard-v3/
// DashScorecard*.dc.html, rendered from file://) beside the prod build at the same width. ~2.5 min, cap 300 s.
// Shots + report: .screenshots/dashboard-v3-stage1/.
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
const OUT = path.join(ROOT, '.screenshots', 'dashboard-v3-stage1');
const MOCK = { desk: path.join(ROOT, 'specs', 'design', 'dashboard-v3', 'DashScorecard.dc.html'), phone: path.join(ROOT, 'specs', 'design', 'dashboard-v3', 'DashScorecardPhone.dc.html') };
const PORT = 3999, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const TABLES = ['sales_metric_targets', 'sales_week_goals', 'sales_week_report', 'sales_week_report_sections', 'sales_outreach_campaigns', 'sales_opportunities', 'sales_goals', 'sales_targets', 'business_anthropic_usage', 'sales_sync_runs'];
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
const monday = (() => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
const month = `${today.slice(0, 7)}-01`;
const fmt = n => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const pct = r => (r == null ? '—' : `${(r * 100).toFixed(1)}%`);
const ROWS = [['total_in_sequence', fmt], ['sequences_running', fmt], ['human_open_rate', pct], ['meetings_set', fmt], ['people_first_touched', fmt], ['tier1_touched_pct', pct], ['partner_meetings', fmt], ['partners_pilot_live', fmt]];
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
  // ---- Real wiring: the scorecard route (this month) and the hero (same builder) agree to the digit.
  const sc = await get(`/goals/scorecard?month=${month}`);
  const hero = await get(`/goals/hero?week_start=${monday}`);
  const wk = sc.body?.weeks?.find(w => w.week_start === monday);
  const hw = hero.body?.scorecard?.weeks?.find(w => w.week_start === monday);
  const keys = ['total_in_sequence', 'sequences_running', 'human_open_rate', 'meetings_set', 'people_first_touched', 'tier1_touched_pct', 'partner_meetings', 'partners_pilot_live'];
  const same = keys.every(k => wk?.metrics?.[k]?.value === hw?.metrics?.[k]?.value);
  ok(`real wiring: GET goals/scorecard ${sc.status} (week of ${monday}: ${keys.map(k => `${k} ${wk?.metrics?.[k]?.value}`).join(' · ')}; calendar ${JSON.stringify(sc.body?.calendar)}; synced ${sc.body?.synced_at}) = GET goals/hero ${hero.status} on every digit (${same}); no "@" in either`, sc.status === 200 && hero.status === 200 && same && !JSON.stringify(sc.body).includes('@') && !JSON.stringify(hero.body).includes('@'));
  const campaigns = await get('/goals/campaigns');
  const nCampaigns = campaigns.body?.campaigns?.length ?? -1;

  browser = await chromium.launch();
  // preSales(page): runs after the workspace pick, before the Sales tab mounts (an old link's query string, a stored sub-view).
  async function open(width, { viewer = false, url = '', preSales = null, stored = null } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 }, hasTouch: width < 900 });
    await ctx.addInitScript(([k, v, bz, d, st]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      localStorage.setItem('prospector_goals_owner', 'team');
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, d);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
      for (const [sk, sv] of Object.entries(st || {})) localStorage.setItem(sk, sv);
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today, stored]);
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
    await page.goto(`${BASE}/${url}`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 25000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    if (preSales) await preSales(page);
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    return { ctx, page, errors };
  }
  const tabs = page => page.locator('#workspace-header-tabs, [data-sales-tabrow]');
  const topTab = async (page, re) => { await tabs(page).getByRole('button', { name: re }).first().dispatchEvent('click'); await page.waitForTimeout(1500); };
  const subTab = async (page, name) => { await page.locator('[data-sales-subviews]').getByRole('tab', { name, exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500); };
  const subTabs = page => page.locator('[data-sales-subviews] [role="tab"]').allTextContents();
  const shot = (page, nme, opts = {}) => page.screenshot({ path: `${OUT}/${nme}.png`, animations: 'disabled', caret: 'hide', fullPage: false, ...opts });
  const axeOn = async (page, key, sel) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async s => { const r = await window.axe.run(document.querySelector(s) || document, { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); }, sel);
    results.axe[key] = v;
    ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v).slice(0, 300));
  };
  const cellText = (page, k) => page.locator(`[data-cell="${k}"] [data-value]`).first().textContent().catch(() => null);

  // ---- 1440: nav + Scorecard.
  {
    const { ctx, page, errors } = await open(1440);
    await topTab(page, /^Pipeline/);
    const pipe = await subTabs(page);
    ok(`1440 Pipeline sub-views ${pipe.join(' · ')} (campaign rows ${nCampaigns}; Campaigns ${nCampaigns > 0 ? 'shown' : 'hidden'})`, nCampaigns > 0 ? pipe.some(t => /Campaigns/.test(t)) : !pipe.some(t => /Campaigns/.test(t)));
    await topTab(page, /^Dashboard/);
    const dash = await subTabs(page);
    ok(`1440 Dashboard sub-views ${dash.join(' · ')}`, dash.join('|') === 'Home|Email|Scorecard|Sources');
    await subTab(page, 'Scorecard');
    await page.locator('[data-scorecard-table]').waitFor({ timeout: 30000 }); await page.waitForTimeout(1500);
    const frameY0 = await page.locator('[data-sales-frame]').evaluate(el => el.getBoundingClientRect().top);
    const got = {}; const mism = [];
    for (const [k, f] of ROWS) {
      got[k] = { week: await cellText(page, `${k}|${monday}`), month: await cellText(page, `${k}|month`) };
      const w = f(wk?.metrics?.[k]?.value), m = f(sc.body?.month_total?.[k]?.value);
      if (!got[k].week?.startsWith(w) || !got[k].month?.startsWith(m)) mism.push(`${k}: screen ${got[k].week} / ${got[k].month} vs route ${w} / ${m}`);
    }
    ok(`1440 every cell = the route's digit for the week of ${monday} and the month (${ROWS.map(([k]) => `${k} ${got[k].week}`).join(' · ')})`, !mism.length, mism.join(' | '));
    const future = await page.locator(`[data-cell="total_in_sequence|${sc.body?.weeks?.find(w => w.week_start > monday)?.week_start}"]`).textContent().catch(() => null);
    ok(`1440 this week tinted (${await page.locator('[data-this-week]').count()}), the next week reads "—" (${JSON.stringify(future)})`, (await page.locator('[data-this-week]').count()) === 1 && (future == null || future.trim() === '—'));
    const outlookRow = await page.locator('#score-row-meetings_set').textContent();
    ok(`1440 Meetings set row: ${outlookRow.slice(0, 120)}`, /Outlook/.test(outlookRow) && (!sc.body?.calendar?.partial || /calendar/.test(outlookRow)));
    const banner = await page.locator('[data-goals-banner]').count();
    ok(`1440 goals banner ${banner ? 'shown (no goals this month)' : 'absent (goals exist)'}`, true);
    const tools = await page.locator('#sales-frame-tools').textContent();
    ok(`1440 tools: ${tools.trim().replace(/\s+/g, ' ').slice(0, 80)} (month switch · Print · Set goals; no Export)`, /Print/.test(tools) && /Set \w+ goals/.test(tools) && !/Export/.test(tools));
    await page.locator('#sales-frame-tools').getByRole('group', { name: 'Month' }).getByRole('button').first().click(); await page.waitForTimeout(2000);
    const frameY1 = await page.locator('[data-sales-frame]').evaluate(el => el.getBoundingClientRect().top);
    results.n2.month = Math.abs(frameY1 - frameY0);
    ok(`1440 N2: switching the month moves the frame 0 px (${results.n2.month})`, results.n2.month === 0);
    await page.locator('#sales-frame-tools').getByRole('group', { name: 'Month' }).getByRole('button').nth(1).click(); await page.waitForTimeout(2000);
    await page.locator('[data-scorecard-table]').waitFor({ timeout: 30000 }); await page.waitForTimeout(800);
    await shot(page, 'scorecard-1440');
    await shot(page, 'scorecard-1440-full', { fullPage: true });
    await axeOn(page, 'scorecard@1440', '[data-sales-tab], #sales-analytics-root');
    await page.emulateMedia({ media: 'print' }); await page.waitForTimeout(600);
    await shot(page, 'scorecard-print', { fullPage: true });
    try { await page.pdf({ path: path.join(OUT, 'scorecard.pdf'), landscape: true, format: 'Letter', printBackground: true }); ok('print: scorecard.pdf written (landscape Letter)', true); } catch (e) { ok('print: pdf', false, e.message); }
    await page.emulateMedia({ media: 'screen' });
    ok('1440 0 page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- A2: a browser that last showed Sequenced opens on Home (the stored keys). The ?view=sequenced -> Email mapping
  // is unit-tested (salesNav.test.js): this harness's sign-in bootstrap rewrites the first URL before the Sales tab mounts.
  {
    // (a workspace always opens on Actions - actions-home-attention-v1 D1 - so the stored sub-view shows once Dashboard is clicked.)
    const { ctx, page, errors } = await open(1440, { stored: { prospector_sales_tab: 'dashboard', prospector_sales_view: 'sequenced' } });
    await topTab(page, /^Dashboard/);
    await page.locator('[data-sales-subviews]').waitFor({ timeout: 20000 }).catch(() => {}); await page.waitForTimeout(1000);
    const sel = await page.locator('[data-sales-subviews] [role="tab"][aria-selected="true"]').textContent().catch(() => null);
    ok(`a stored sub-view 'sequenced' opens on ${sel?.trim()} (view=${new URL(page.url()).searchParams.get('view')})`, sel?.trim() === 'Home' && new URL(page.url()).searchParams.get('view') === 'overview' && !errors.length);
    await ctx.close();
  }
  // ---- 390: tiles.
  {
    const { ctx, page, errors } = await open(390);
    await topTab(page, /^Dashboard/);
    await subTab(page, 'Scorecard');
    await page.locator('[data-scorecard="phone"]').waitFor({ timeout: 30000 }); await page.locator('[data-tile]').first().waitFor({ timeout: 30000 }).catch(() => {}); await page.waitForTimeout(1000);
    const tiles = await page.locator('[data-tile]').count();
    const table = await page.locator('table').count();
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    const first = await page.locator('[data-tile="total_in_sequence"] [data-value]').textContent();
    ok(`390: ${tiles} tiles, ${table} tables, no sideways scroll ${sideways}; In sequence tile ${first} = route ${fmt(wk?.metrics?.total_in_sequence?.value)}`, tiles === 8 && table === 0 && sideways && first.startsWith(fmt(wk?.metrics?.total_in_sequence?.value)));
    await shot(page, 'scorecard-390', { fullPage: true });
    await axeOn(page, 'scorecard@390', '[data-sales-tab], #sales-analytics-root');
    ok('390 0 page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- Viewer.
  {
    const { ctx, page, errors } = await open(1440, { viewer: true });
    await topTab(page, /^Dashboard/);
    await subTab(page, 'Scorecard');
    await page.locator('[data-scorecard-table]').waitFor({ timeout: 30000 }); await page.waitForTimeout(1000);
    const goalBtns = await page.locator('[data-scorecard-table] button').count();
    const setGoals = await page.locator('#sales-frame-tools').getByRole('button', { name: /Set \w+ goals/ }).count();
    const ro = await page.locator('[data-scorecard]').textContent();
    await shot(page, 'scorecard-viewer-1440');
    ok(`Viewer: ${goalBtns} goal buttons, Set goals ${setGoals}, read-only line ${/Read-only on this account/.test(ro)}; 0 page errors`, goalBtns === 0 && setGoals === 0 && /Read-only on this account/.test(ro) && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- Side-by-side: mockup (file://) | prod build, same width.
  for (const [key, file, width, height, prodShot] of [['1440', MOCK.desk, 1440, 900, 'scorecard-1440.png'], ['390', MOCK.phone, 390, 1180, 'scorecard-390.png']]) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    await page.goto(`file://${file}`); await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/mockup-${key}.png`, fullPage: true });
    const compose = await ctx.newPage();
    const b64 = f => fs.readFileSync(path.join(OUT, f)).toString('base64');
    await compose.setViewportSize({ width: width * 2 + 48, height: 200 });
    await compose.setContent(`<body style="margin:0;background:#000;color:#fff;font:12px monospace"><div style="display:flex;gap:16px;padding:16px"><figure style="margin:0"><figcaption style="padding:4px 0">mockup · ${path.basename(file)} · ${width}</figcaption><img src="data:image/png;base64,${b64(`mockup-${key}.png`)}" style="width:${width}px;display:block"></figure><figure style="margin:0"><figcaption style="padding:4px 0">prod build · HEAD · ${width}</figcaption><img src="data:image/png;base64,${b64(prodShot)}" style="width:${width}px;display:block"></figure></div></body>`);
    await compose.waitForTimeout(500);
    await compose.screenshot({ path: `${OUT}/side-by-side-${key}.png`, fullPage: true });
    ok(`side-by-side-${key}.png written (mockup | prod)`, true);
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
  fs.writeFileSync(path.join(OUT, 'stage1-report.json'), JSON.stringify({ ...results, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\ndashboard-v3 Stage 1 live check: ${passed}/${results.checks.length} passed · Claude 0 · Apollo ${realCalls.length} · writes 0 · ${Math.round((Date.now() - T0) / 1000)} s`);
  console.log(`files: ${fs.readdirSync(OUT).join(', ')}`);
  console.log(`restored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
