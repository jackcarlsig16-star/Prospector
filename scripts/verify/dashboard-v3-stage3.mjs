// dashboard-v3 Stage 3 live check - localhost against the build, as Jack (ownerSession) on the REAL HomeLover workspace.
// 0 Claude, 0 Apollo. ONE write: Save view (POST goals/explorer/views) - deleted again (DELETE) and sales_settings.saved_views
// compared byte-for-byte before / after; every other non-GET is aborted at the network layer and counted. Real wiring: GET
// goals/explorer (Home defaults by week; day; every layer; splits person / mailbox / cohort), the 5-min cache, GET /views.
// Browser at 1440: Home's Explorer card = chips (4 on), chart; Table mode cells = the route's digits; toggling Visitors
// off / on re-reads (N2 0 px); split Person legend = member first names, never an address; hover card + pin; Save view
// (the one write) + delete; Share = CSV + PNG downloads; axe 0. 390: the card fits, axe 0. Viewer: no Save / Share.
// Side-by-side PNG: the mockup's Explorer card (Dash.dc.html, file://) beside the build's at 1440. ~3 min, cap 300 s.
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
const OUT = path.join(ROOT, '.screenshots', 'dashboard-v3-stage3');
const MOCK = path.join(ROOT, 'specs', 'design', 'dashboard-v3', 'Dash.dc.html');
const PORT = 3999, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const TABLES = ['sales_metric_targets', 'sales_week_goals', 'sales_insight_dismissals', 'sales_settings', 'sales_opportunities', 'sales_goals', 'sales_targets', 'sales_partner_events', 'business_anthropic_usage', 'sales_sync_runs', 'web_visits', 'microsoft_events', 'sales_email_daily_counts'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data?.[0]?.id;
if (!HL) throw new Error('no HomeLover business');
const count = async t => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL); if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message}`); return r.count; };
const snapshot = async () => { const o = {}; for (const t of TABLES) o[t] = await count(t); return o; };
const savedViews = async () => JSON.stringify((await svc.from('sales_settings').select('saved_views').eq('business_id', HL).maybeSingle()).data?.saved_views ?? null);
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const fmtValue = (kind, v) => (v == null ? '—' : kind === 'rate' ? `${(v * 100).toFixed(1)}%` : Number(v).toLocaleString('en-US'));
// No digit runs in the name: the server's cleanText scrubs phone-like numbers from any saved text.
const VIEW_NAME = 'verify stage three temp view';
const ALLOW_WRITES = [`/api/sales/${HL}/goals/explorer/views`];
let srv, browser, owner;
const blocked = [], realCalls = [], writes = [], allowed = [];
const results = { checks: [], errors: [], axe: {}, n2: {}, deviations: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 300000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
const viewsBefore = await savedViews();
log('before', JSON.stringify(before), 'saved_views', viewsBefore.length, 'chars');

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', ANTHROPIC_API_KEY: '', APOLLO_API_KEY: '', MICROSOFT_CLIENT_SECRET: '', GMAIL_CLIENT_SECRET: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const get = async p => { const r = await fetch(`${BASE}/api/sales/${HL}${p}`, { headers: { cookie } }); return { status: r.status, body: await r.json().catch(() => null) }; };
  // ---- Real wiring.
  const home = await get('/goals/explorer');
  const S = home.body?.series || [];
  const byKey = Object.fromEntries(S.map(s => [`${s.layer}:${s.split_key}`, s]));
  const last = s => s?.values?.[s.values.length - 1];
  ok(`real wiring: GET goals/explorer (Home defaults) ${home.status}: ${home.body?.from} – ${home.body?.to}, ${home.body?.labels?.length} weeks, series ${S.map(s => `${s.label} [${s.values.map(v => fmtValue(s.kind, v)).join(' ')}]`).join(' · ')}; notes ${JSON.stringify(home.body?.notes)}`,
    home.status === 200 && home.body?.labels?.length === 9 && S.length === 4 && home.body.labels[8].current === true && home.body.cached_at === null);
  const pulse = await get('/goals/pulse?period=this_week');
  ok(`Explorer this week = Pulse this week to the digit (sent ${last(byKey['sent:team'])} vs ${pulse.body?.metrics?.sent?.value}; human opens ${last(byKey['human_open_rate:team'])} vs ${pulse.body?.metrics?.human_open_rate?.value}; visitors ${last(byKey['visitors:team'])} vs ${pulse.body?.metrics?.visitors?.value})`,
    last(byKey['sent:team']) === pulse.body?.metrics?.sent?.value && last(byKey['human_open_rate:team']) === pulse.body?.metrics?.human_open_rate?.value && last(byKey['visitors:team']) === pulse.body?.metrics?.visitors?.value);
  const again = await get('/goals/explorer');
  ok(`second read served from the 5-min cache (cached_at ${again.body?.cached_at})`, again.status === 200 && !!again.body?.cached_at);
  const all = await get('/goals/explorer?layers=sent,delivered_rate,human_open_rate,reply_rate,hard_bounce_rate,spam_rate,visitors,meetings,first_touched');
  ok(`every layer by week ${all.status}: ${all.body?.series?.length} series (${(all.body?.series || []).map(s => `${s.layer} ${fmtValue(s.kind, last(s))}`).join(' · ')})`, all.status === 200 && all.body?.series?.length === 9);
  const day = await get('/goals/explorer?layers=sent,visitors&by=day');
  ok(`by day ${day.status}: ${day.body?.labels?.length} days, last ${day.body?.labels?.slice(-1)[0]?.key} current ${day.body?.labels?.slice(-1)[0]?.current}`, day.status === 200 && day.body?.labels?.slice(-1)[0]?.key === today);
  const person = await get('/goals/explorer?layers=sent,meetings,visitors&split=person');
  const pSeries = person.body?.series || [];
  ok(`split person ${person.status}: ${pSeries.map(s => `${s.label} (${s.color})`).join(' · ')}`, person.status === 200 && pSeries.some(s => /· Sent$/.test(s.label) && s.split_key !== 'team') && pSeries.some(s => s.label === 'Visitors · team-wide'));
  const mailbox = await get('/goals/explorer?layers=sent&split=mailbox');
  const mSeries = mailbox.body?.series || [];
  ok(`split mailbox ${mailbox.status}: ${mSeries.map(s => `${s.label} / ${s.split_key}`).join(' · ')} - no address anywhere`, mailbox.status === 200 && mSeries.length > 0 && !/@/.test(JSON.stringify(mailbox.body)));
  const cohort = await get('/goals/explorer?layers=sent&split=cohort');
  ok(`split cohort ${cohort.status}: ${(cohort.body?.series || []).map(s => `${s.label} ${s.color}`).join(' · ')}`, cohort.status === 200 && (cohort.body?.series || []).length > 0);
  const bad = await get('/goals/explorer?layers=sent,nope');
  ok(`GET goals/explorer?layers=sent,nope -> ${bad.status} ${bad.body?.error}`, bad.status === 400);
  const views0 = await get('/goals/explorer/views');
  ok(`GET goals/explorer/views ${views0.status}: ${views0.body?.views?.length} explorer views (the Map's are not listed)`, views0.status === 200 && Array.isArray(views0.body?.views));
  const mapViews = await get('/goals/scores/views');
  ok(`GET goals/scores/views ${mapViews.status}: ${mapViews.body?.views?.length} Map views, none of kind explorer`, mapViews.status === 200 && (mapViews.body?.views || []).every(v => !v.kind));

  browser = await chromium.launch();
  async function open(width, { viewer = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 }, hasTouch: width < 900, acceptDownloads: true });
    await ctx.addInitScript(([k, v, bz, d]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      localStorage.setItem('prospector_goals_owner', 'team');
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, d);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (u.protocol === 'file:' || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host), isCdn = u.host === 'cdnjs.cloudflare.com' && /html2canvas/.test(u.pathname);
      const apiWrite = isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname);
      const allowedWrite = apiWrite && !viewer && ALLOW_WRITES.some(p => u.pathname === p || u.pathname.startsWith(`${p}/`));
      if (apiWrite) (allowedWrite ? allowed : writes).push(`${req.method()} ${u.pathname}`);
      const deny = (apiWrite && !allowedWrite) || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont && !isCdn);
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
  const explorer = page => page.locator('[data-explorer="home"]');
  const waitExplorer = async page => { await explorer(page).waitFor({ timeout: 30000 }); await explorer(page).locator('[data-explorer-chart], [data-explorer-table]').first().waitFor({ timeout: 30000 }); await page.waitForTimeout(800); };
  const frameTop = page => page.locator('[data-sales-frame]').evaluate(el => el.getBoundingClientRect().top);

  // ---- 1440: Home's Explorer.
  {
    const { ctx, page, errors } = await open(1440);
    await topTab(page, /^Dashboard/);
    await subTab(page, 'Home');
    await waitExplorer(page);
    const ex = explorer(page);
    const chips = await ex.locator('[data-layer-chip]').evaluateAll(els => els.map(e => `${e.dataset.layerChip}:${e.getAttribute('aria-pressed')}`));
    ok(`1440 layer chips: ${chips.join(' ')} (4 on: sent · human opens · visitors · replies)`, chips.filter(c => /:true$/.test(c)).map(c => c.split(':')[0]).sort().join(',') === 'human_open_rate,reply_rate,sent,visitors');
    const aria = await ex.locator('[data-explorer-chart]').getAttribute('aria-label');
    ok(`1440 chart drawn: "${aria}"; columns sent ${await ex.locator('[data-col="sent"]').count()} · visitors ${await ex.locator('[data-col="visitors"]').count()}; lines ${await ex.locator('[data-line]').count()}; end labels ${await ex.locator('[data-end-label]').count()}; this week shaded ${await ex.locator('[data-shade="current"]').count()}`,
      (await ex.locator('[data-col="sent"]').count()) === 9 && (await ex.locator('[data-line]').count()) === 2 && (await ex.locator('[data-shade="current"]').count()) === 1);
    const chipNote = await ex.locator('[data-layer-chip="visitors"]').textContent();
    ok(`1440 Visitors chip carries the note "${chipNote.trim()}"`, /from /.test(chipNote));
    await shot(page, 'explorer-1440');
    await ex.screenshot({ path: `${OUT}/explorer-card-1440.png`, animations: 'disabled' });
    // Table mode = the route's digits.
    await ex.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Table' }).click(); await page.waitForTimeout(600);
    const cells = {}; const mism = [];
    for (const s of S) for (const l of home.body.labels) { const t = (await ex.locator(`[data-cell="${s.layer}:${s.split_key}:${l.key}"]`).textContent().catch(() => null))?.trim(); const want = fmtValue(s.kind, s.values[home.body.labels.indexOf(l)]); if (t !== want) mism.push(`${s.layer}@${l.key}: ${t} vs ${want}`); cells[`${s.layer}@${l.key}`] = t; }
    ok(`1440 Table mode: ${Object.keys(cells).length} cells = the route's digits (this week: sent ${cells[`sent@${home.body.labels[8].key}`]} · human opens ${cells[`human_open_rate@${home.body.labels[8].key}`]} · visitors ${cells[`visitors@${home.body.labels[8].key}`]})`, Object.keys(cells).length === 36 && !mism.length, mism.join(' | '));
    await ex.screenshot({ path: `${OUT}/explorer-table-1440.png`, animations: 'disabled' });
    await ex.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Lines' }).click(); await page.waitForTimeout(600);
    // Toggle Visitors off / on: a re-read each time, the frame does not move (N2).
    const y0 = await frameTop(page);
    await ex.locator('[data-layer-chip="visitors"]').click(); await page.waitForTimeout(2500);
    const off = await ex.locator('[data-col="visitors"]').count();
    await ex.locator('[data-layer-chip="visitors"]').click(); await page.waitForTimeout(2500);
    const on = await ex.locator('[data-col="visitors"]').count();
    results.n2.toggle = Math.abs((await frameTop(page)) - y0);
    const nVisitorWeeks = (byKey['visitors:team']?.values || []).filter(v => v != null).length;
    ok(`1440 Visitors off -> ${off} columns, on -> ${on} (= ${nVisitorWeeks} weeks with a pull); N2 frame moved ${results.n2.toggle} px`, off === 0 && on === nVisitorWeeks && results.n2.toggle === 0);
    // Hover + pin.
    const chart = ex.locator('[data-explorer-chart]');
    const box = await chart.boundingBox();
    const slot = (box.width * (1340 - 92) / 1340) / 9;
    const x = box.x + box.width * (44 / 1340) + slot * 7.5, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.waitForTimeout(300);
    const hoverText = (await ex.locator('[data-hover-card]').textContent().catch(() => '')).replace(/\s+/g, ' ');
    await page.mouse.click(x, y); await page.waitForTimeout(300);
    const pinnedKind = await ex.locator('[data-hover-card]').getAttribute('data-hover-card').catch(() => null);
    await page.mouse.move(box.x + 5, box.y - 40); await page.waitForTimeout(300);
    const stays = await ex.locator('[data-hover-card]').count();
    await shot(page, 'explorer-pinned-1440');
    ok(`1440 hover card "${hoverText.slice(0, 90)}"; click pins (${pinnedKind}); it stays when the mouse leaves (${stays})`, /Week of/.test(hoverText) && pinnedKind === 'pinned' && stays === 1);
    await page.mouse.click(x, y); await page.waitForTimeout(300);
    // Split Person: legend first names, no address; back to Team.
    await ex.getByRole('group', { name: 'Split' }).getByRole('button', { name: 'Person' }).click(); await page.waitForTimeout(2500);
    const legend = (await ex.locator('[data-explorer-legend]').textContent().catch(() => '')).replace(/\s+/g, ' ').trim();
    const cardText = await ex.textContent();
    ok(`1440 split Person legend "${legend}", no address on the card (${!/@/.test(cardText)})`, legend.length > 0 && !/@/.test(cardText) && !/@/.test(legend));
    await shot(page, 'explorer-person-1440');
    await ex.getByRole('group', { name: 'Split' }).getByRole('button', { name: 'Team' }).click(); await page.waitForTimeout(2500);
    // Save view (the one write), then delete it.
    await ex.getByRole('button', { name: 'Save view' }).click();
    await ex.getByRole('textbox', { name: 'View name' }).fill(VIEW_NAME);
    await ex.locator('[data-save-form] button[type="submit"]').click(); await page.waitForTimeout(2500);
    const after = await get('/goals/explorer/views');
    const saved = (after.body?.views || []).find(v => v.name === VIEW_NAME);
    ok(`Save view wrote one explorer view (${saved ? `id ${saved.id}, kind ${saved.kind}, state ${JSON.stringify(saved.state)}` : 'MISSING'}); the Saved view select shows ${await ex.getByRole('combobox', { name: 'Saved view' }).count()}`, !!saved && saved.kind === 'explorer' && saved.state.layers.length === 4);
    await ex.getByRole('button', { name: 'Save view' }).click(); await page.waitForTimeout(300);
    await ex.getByRole('button', { name: `Delete view ${VIEW_NAME}` }).click(); await page.waitForTimeout(2000);
    const gone = !((await get('/goals/explorer/views')).body?.views || []).some(v => v.name === VIEW_NAME);
    ok(`the view is deleted again (${gone}); saved_views byte-identical to before: ${(await savedViews()) === viewsBefore}`, gone && (await savedViews()) === viewsBefore);
    // Share: CSV + PNG downloads.
    const downloads = [];
    page.on('download', d => downloads.push(d.suggestedFilename()));
    await ex.getByRole('button', { name: 'Share' }).click(); await page.waitForTimeout(6000);
    ok(`Share downloads: ${downloads.join(', ') || 'none'} (CSV + PNG)`, downloads.some(f => /\.csv$/.test(f)) && downloads.some(f => /\.png$/.test(f)));
    await axeOn(page, 'home-explorer@1440', '[data-sales-tab], #sales-analytics-root');
    ok('1440 0 page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- 390.
  {
    const { ctx, page, errors } = await open(390);
    await topTab(page, /^Dashboard/);
    await subTab(page, 'Home');
    await waitExplorer(page);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    const w = await explorer(page).evaluate(el => Math.round(el.getBoundingClientRect().width));
    await explorer(page).scrollIntoViewIfNeeded();
    await explorer(page).screenshot({ path: `${OUT}/explorer-card-390.png`, animations: 'disabled' });
    ok(`390: the Explorer card is ${w} px wide, no sideways scroll ${sideways}, chart drawn ${await explorer(page).locator('[data-explorer-chart]').count()}`, sideways && (await explorer(page).locator('[data-explorer-chart]').count()) === 1);
    await axeOn(page, 'home-explorer@390', '[data-sales-tab], #sales-analytics-root');
    ok('390 0 page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- Viewer.
  {
    const { ctx, page, errors } = await open(1440, { viewer: true });
    await topTab(page, /^Dashboard/);
    await subTab(page, 'Home');
    await waitExplorer(page);
    const ex = explorer(page);
    const save = await ex.getByRole('button', { name: 'Save view' }).count(), share = await ex.getByRole('button', { name: 'Share' }).count();
    const chips = await ex.locator('[data-layer-chip]').count();
    await ex.screenshot({ path: `${OUT}/explorer-viewer-1440.png`, animations: 'disabled' });
    ok(`Viewer: Save view ${save}, Share ${share}, chips ${chips}, chart ${await ex.locator('[data-explorer-chart]').count()}; 0 page errors`, save === 0 && share === 0 && chips === 9 && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- Side-by-side: the mockup's Explorer card | the build's, 1440.
  {
    const width = 1440;
    const ctx = await browser.newContext({ viewport: { width, height: 1420 } });
    const page = await ctx.newPage();
    await page.goto(`file://${MOCK}`); await page.waitForTimeout(1500);
    const card = page.locator('.card').filter({ hasText: 'Explorer' }).first();
    await card.screenshot({ path: `${OUT}/mockup-explorer-1440.png` });
    const compose = await ctx.newPage();
    const b64 = f => fs.readFileSync(path.join(OUT, f)).toString('base64');
    await compose.setViewportSize({ width: width * 2 + 48, height: 200 });
    await compose.setContent(`<body style="margin:0;background:#000;color:#fff;font:12px monospace"><div style="display:flex;gap:16px;padding:16px;align-items:flex-start"><figure style="margin:0"><figcaption style="padding:4px 0">mockup · Dash.dc.html Explorer card · 1440</figcaption><img src="data:image/png;base64,${b64('mockup-explorer-1440.png')}" style="width:${width}px;display:block"></figure><figure style="margin:0"><figcaption style="padding:4px 0">prod build · HEAD · Home Explorer card · 1440</figcaption><img src="data:image/png;base64,${b64('explorer-card-1440.png')}" style="width:${width}px;display:block"></figure></div></body>`);
    await compose.waitForTimeout(500);
    await compose.screenshot({ path: `${OUT}/side-by-side-explorer-1440.png`, fullPage: true });
    ok('side-by-side-explorer-1440.png written (mockup | prod)', true);
    await ctx.close();
  }
  ok(`browser reached 0 Claude / Apollo hosts; writes allowed: ${[...new Set(allowed)].join(', ') || 'none'}; every other non-GET aborted (${[...new Set(writes)].join(', ') || 'none attempted'})`, !realCalls.length && writes.every(w => blocked.includes(w)) && allowed.every(a => /goals\/explorer\/views/.test(a)));
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    const after = await snapshot();
    const moved = TABLES.filter(t => before[t] !== after[t]).map(t => `${t} ${before[t]} -> ${after[t]}`);
    if (moved.length) throw new Error(`counts moved: ${moved.join(', ')}`);
    const viewsAfter = await savedViews();
    if (viewsAfter !== viewsBefore) {
      const cur = JSON.parse(viewsAfter) || [];
      const mine = cur.filter(v => v.kind === 'explorer' && /^verify stage three/.test(v.name));
      if (mine.length) { await svc.from('sales_settings').update({ saved_views: cur.filter(v => !(v.kind === 'explorer' && /^verify stage three/.test(v.name))) }).eq('business_id', HL); }
      if ((await savedViews()) !== viewsBefore) throw new Error('sales_settings.saved_views differs from before');
      line = `yes (${TABLES.length} table counts identical; the verify view was removed in teardown; saved_views identical; Jack sign-in row kept by rule, last_seen_at restored)`;
    } else line = `yes (${TABLES.length} table counts identical; saved_views byte-identical (the one Save view deleted in-test); Jack sign-in row kept by rule, last_seen_at restored)`;
    restored = true;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'stage3-report.json'), JSON.stringify({ ...results, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\ndashboard-v3 Stage 3 live check: ${passed}/${results.checks.length} passed · Claude 0 · Apollo ${realCalls.length} · writes ${allowed.length} (Save view + its delete) · ${Math.round((Date.now() - T0) / 1000)} s`);
  console.log(`files: ${fs.readdirSync(OUT).join(', ')}`);
  console.log(`restored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
