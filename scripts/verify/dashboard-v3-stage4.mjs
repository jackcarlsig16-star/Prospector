// dashboard-v3 Stage 4 live check - localhost against the build, as Jack (ownerSession) on the REAL HomeLover workspace,
// READ-ONLY (0 Claude, 0 Apollo, 0 writes: every non-GET API call and Supabase write is aborted at the network layer and
// counted; Dismiss, Sync now and the audience picker are exercised by the Jest suites, never here). Real wiring: GET
// goals/pulse?scope=email (this week + month), GET goals/sequence-steps (per-step sums = the lifetime rows; own; no
// address), GET /insights, GET /entities. Browser at 1440: Dashboard › Email = tools (Period · Sync now · Export) in the
// frame row, the title line, seven tiles = the route's digits, the Explorer with the email defaults (six chips on, split
// Mailbox, band drawn), WHY rows = the route's list, Mailboxes tiles named never addressed, Sequences = HomeLover's own
// with a row expanded to its steps (sum = lifetime); a Period change re-reads with N2 0 px; axe 0. 390: axe 0, no
// sideways scroll. Viewer: no Sync now, no Dismiss, no audience picker. Needs attention: the missing-headcount line.
// Side-by-side PNG: the mockup (DashEmail.dc.html, file://) beside the build at 1440. ~3 min, cap 300 s.
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
const OUT = path.join(ROOT, '.screenshots', 'dashboard-v3-stage4');
const MOCK = path.join(ROOT, 'specs', 'design', 'dashboard-v3', 'DashEmail.dc.html');
const PORT = 3999, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const TABLES = ['sales_metric_targets', 'sales_week_goals', 'sales_insight_dismissals', 'sales_settings', 'sales_sequence_tags', 'sales_opportunities', 'sales_goals', 'sales_targets', 'sales_partner_events', 'business_anthropic_usage', 'sales_sync_runs', 'web_visits', 'microsoft_events', 'sales_email_daily_counts', 'sales_sequenced_accounts'];
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
const TILES = ['sent', 'delivered_rate', 'hard_bounce_rate', 'spam_blocks', 'human_open_rate', 'reply_rate', 'meetings'];
const expected = m => (m.value == null ? '—' : m.kind === 'rate' ? `${pts(m.value)}%` : fmt(m.value));
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
  // ---- Real wiring.
  const week = await get('/goals/pulse?scope=email&period=this_week');
  const wm = week.body?.metrics || {};
  ok(`real wiring: GET goals/pulse?scope=email this_week ${week.status}: ${week.body?.from} – ${week.body?.to} vs ${week.body?.prev?.from} – ${week.body?.prev?.to}; ${TILES.map(k => `${k} ${expected(wm[k] || {})}`).join(' · ')}; mailboxes ${(week.body?.mailboxes || []).map(t => `${t.label} ${t.sent} ${t.status}`).join(', ')}`,
    week.status === 200 && TILES.every(k => wm[k]) && wm.hard_bounce_rate.better === 'down' && wm.spam_blocks.better === 'down' && (week.body.mailboxes || []).length > 0 && !/@/.test(JSON.stringify(week.body)));
  const home = await get('/goals/pulse?period=this_week');
  ok(`email Pulse = Home Pulse where the words match (sent ${wm.sent?.value} vs ${home.body?.metrics?.sent?.value}; human opens ${wm.human_open_rate?.value} vs ${home.body?.metrics?.human_open_rate?.value}; meetings ${wm.meetings?.value} vs ${home.body?.metrics?.meetings?.value})`,
    wm.sent?.value === home.body?.metrics?.sent?.value && wm.human_open_rate?.value === home.body?.metrics?.human_open_rate?.value && wm.meetings?.value === home.body?.metrics?.meetings?.value);
  const month = await get('/goals/pulse?scope=email&period=month');
  ok(`GET goals/pulse?scope=email month ${month.status}: ${month.body?.from} – ${month.body?.to} vs ${month.body?.prev?.from} – ${month.body?.prev?.to}, sent ${month.body?.metrics?.sent?.value}`, month.status === 200 && month.body?.prev?.to === `${month.body?.from?.slice(0, 7) === '2026-11' ? '2026-10-31' : month.body?.prev?.to}`);
  const bad = await get('/goals/pulse?scope=mail');
  ok(`GET goals/pulse?scope=mail -> ${bad.status} ${bad.body?.error}`, bad.status === 400);
  const steps = await get('/goals/sequence-steps');
  const seqs = steps.body?.sequences || {};
  const stepSumsOk = Object.values(seqs).every(s => s.steps.reduce((n, x) => n + x.delivered, 0) === s.delivered && s.steps.reduce((n, x) => n + x.messages, 0) === s.messages);
  const foreign = Object.values(seqs).filter(s => !s.own).length;
  ok(`real wiring: GET goals/sequence-steps ${steps.status}: ${Object.keys(seqs).length} sequences, every per-step sum = its lifetime (${stepSumsOk}), ${foreign} not own, totals ${JSON.stringify(steps.body?.totals)}, no address (${!/@/.test(JSON.stringify(steps.body))})`,
    steps.status === 200 && stepSumsOk && !/@/.test(JSON.stringify(steps.body)));
  // Independent check of one sequence's lifetime against the raw daily rows.
  const [sid, s0] = Object.entries(seqs).sort((a, b) => b[1].delivered - a[1].delivered)[0] || [];
  if (sid) {
    const raw = await svc.from('sales_email_daily_counts').select('delivered').eq('business_id', HL).eq('sequence_id', sid);
    const lifetime = (raw.data || []).reduce((n, r) => n + r.delivered, 0);
    ok(`the biggest sequence's steps (${s0.steps.map(x => `${x.step}:${x.delivered}`).join(' ')}) sum to the raw daily rows' delivered ${lifetime}`, s0.delivered === lifetime && s0.steps.reduce((n, x) => n + x.delivered, 0) === lifetime);
  }
  const ins = await get('/insights');
  const nIns = ins.body?.insights?.length ?? -1;
  ok(`real wiring: GET /insights ${ins.status} (${nIns} fired, ${ins.body?.dismissed?.length} dismissed, ${ins.body?.not_enough_data?.length} short of data)`, ins.status === 200 && nIns >= 0);
  const ents = await get('/entities');
  const ownIds = new Set(Object.entries(seqs).filter(([, s]) => s.own).map(([id]) => id));
  const running = (ents.body?.sequences || []).filter(s => s.active && (!(s.id in seqs) || ownIds.has(s.id))).length;
  const total = (ents.body?.sequences || []).filter(s => !(s.id in seqs) || ownIds.has(s.id)).length;
  ok(`real wiring: GET /entities ${ents.status}: ${ents.body?.sequences?.length} sequences, HomeLover's own ${total}, running ${running}`, ents.status === 200);
  const att = await get('/goals/attention');
  const hc = (att.body?.sources || []).find(s => s.id === 'headcount');
  ok(`Needs attention headcount line carries missing_headcount ${hc?.missing_headcount}`, att.status === 200 && typeof hc?.missing_headcount === 'number');

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
      if (u.protocol === 'file:' || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
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
  const waitEmail = async page => { await page.locator('[data-email-view]').waitFor({ timeout: 30000 }); await page.locator('[data-pulse-tile="sent"]').waitFor({ timeout: 30000 }); await page.locator('[data-sequences]').waitFor({ timeout: 30000 }); await page.waitForTimeout(1500); };
  const tileValues = async page => { const o = {}; for (const k of TILES) o[k] = (await page.locator(`[data-pulse-tile="${k}"] [data-value]`).textContent().catch(() => null))?.trim(); return o; };
  // Document position, not viewport: the Period click scrolls the page, which is not the layout moving (N2).
  const frameTop = page => page.locator('[data-sales-frame]').evaluate(el => el.getBoundingClientRect().top + window.scrollY);

  // ---- 1440: Email.
  {
    const { ctx, page, errors } = await open(1440);
    // Needs attention: the headcount line (Actions is the landing page).
    await page.getByRole('button', { name: /Needs attention|All clear/ }).first().click().catch(() => {}); await page.waitForTimeout(1500);
    const hcLine = (await page.locator('[data-missing-headcount]').textContent().catch(() => '')).trim();
    ok(`Needs attention › Headcounts line: "${hcLine.slice(0, 90)}"`, hc?.missing_headcount > 0 ? /sequenced compan/.test(hcLine) && hcLine.startsWith(String(hc.missing_headcount)) : true);
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    await topTab(page, /^Dashboard/);
    await subTab(page, 'Email');
    await waitEmail(page);
    const tools = (await page.locator('#sales-frame-tools').textContent()).replace(/\s+/g, ' ').trim();
    ok(`1440 tools: ${tools.slice(0, 100)} (Period · Sync now · Export)`, /This week/.test(tools) && /Sync now/.test(tools) && /Export/.test(tools) && !/Range|Compare|Who/.test(tools));
    const title = (await page.locator('[data-email-title]').textContent()).trim();
    ok(`1440 title line "${title}"`, /vs/.test(title) && /Apollo sequences, opens, replies/.test(title) && /synced/.test(title));
    const got = await tileValues(page);
    const mism = TILES.filter(k => got[k] !== expected(wm[k])).map(k => `${k}: screen ${got[k]} vs route ${expected(wm[k])}`);
    ok(`1440 seven email tiles = the route's digits (${TILES.map(k => `${k} ${got[k]}`).join(' · ')})`, (await page.locator('[data-pulse-tile]').count()) === 7 && !mism.length, mism.join(' | '));
    const dirs = {}; for (const k of TILES) dirs[k] = await page.locator(`[data-pulse-tile="${k}"] [data-delta]`).getAttribute('data-delta');
    const dirOk = TILES.filter(k => k !== 'meetings').every(k => (wm[k].delta == null ? dirs[k] === 'none' : wm[k].delta === 0 ? dirs[k] === 'flat' : (wm[k].delta > 0) === (wm[k].better === 'up') ? dirs[k] === 'good' : dirs[k] === 'bad'));
    ok(`1440 deltas by direction, bounce / spam down = good (${TILES.map(k => `${k} ${wm[k].delta == null ? 'null' : wm[k].delta > 0 ? '+' : wm[k].delta < 0 ? '−' : '0'}/${wm[k].better} → ${dirs[k]}`).join(' · ')})`, dirOk);
    const chips = await page.locator('[data-explorer="email"] [data-layer-chip]').evaluateAll(els => els.filter(e => e.getAttribute('aria-pressed') === 'true').map(e => e.dataset.layerChip));
    const split = await page.locator('[data-explorer="email"]').getAttribute('data-explorer-state');
    ok(`1440 Explorer email defaults: on ${chips.join(',')}; state ${split}; band ${await page.locator('[data-explorer="email"] [data-band="good"]').count()}`, chips.sort().join(',') === 'delivered_rate,hard_bounce_rate,human_open_rate,reply_rate,sent,spam_rate' && /\|week\|mailbox\|tall$/.test(split || '') && (await page.locator('[data-explorer="email"] [data-band="good"]').count()) === 1);
    const whyRows = await page.locator('[data-insights-panel] [data-insight]').count();
    const whyHead = (await page.locator('#h-why').textContent()).replace(/\s+/g, ' ');
    ok(`1440 WHY rows ${whyRows} = the route's ${nIns} fired; header "${whyHead.trim()}"; Dismiss buttons ${await page.getByRole('button', { name: 'Dismiss 7 d' }).count()}`, whyRows === nIns && /10 rules live/.test(whyHead) && (await page.getByRole('button', { name: 'Dismiss 7 d' }).count()) === nIns);
    const mbTiles = await page.locator('[data-mailbox-tile]').evaluateAll(els => els.map(e => `${e.textContent.replace(/\s+/g, ' ').trim().slice(0, 60)} [${e.dataset.status}]`));
    const mbText = await page.locator('[data-mailboxes]').textContent();
    ok(`1440 Mailboxes: ${mbTiles.join(' · ')} - no address (${!/@/.test(mbText)})`, mbTiles.length === (week.body.mailboxes || []).length && !/@/.test(mbText));
    const seqHead = (await page.locator('[data-sequences] h2 + span').textContent()).replace(/\s+/g, ' ').trim();
    const seqRows = await page.locator('[data-sequences] tbody tr[data-row]').count();
    const seqText = await page.locator('[data-sequences]').textContent();
    ok(`1440 Sequences "${seqHead.slice(0, 60)}": ${seqRows} running rows shown (route: running ${running} of ${total}); no address (${!/@/.test(seqText)})`, new RegExp(`^${running} running of ${total}`).test(seqHead) && seqRows === running && !/@/.test(seqText));
    // Expand the first row: step rows sum to the row's delivered as the route says.
    const firstName = (await page.locator('[data-sequences] tbody tr[data-row]').first().getAttribute('data-key')) || '';
    await page.locator('[data-sequences] tbody tr[data-row]').first().getByRole('button', { name: /Show details/ }).click(); await page.waitForTimeout(600);
    const stepDelivered = await page.locator(`[data-sequence-detail="${firstName}"] [data-step-delivered]`).evaluateAll(els => els.map(e => Number(e.textContent.replace(/,/g, ''))));
    ok(`1440 first row expanded (${firstName.slice(-6)}): ${stepDelivered.length} step rows, delivered ${stepDelivered.join('+')} = ${stepDelivered.reduce((a, b) => a + b, 0)} = route ${seqs[firstName]?.delivered}`, stepDelivered.length > 0 && stepDelivered.reduce((a, b) => a + b, 0) === seqs[firstName]?.delivered);
    await shot(page, 'email-1440');
    await shot(page, 'email-1440-full', { fullPage: true });
    await axeOn(page, 'email@1440', '[data-sales-tab], #sales-analytics-root');
    const y0 = await frameTop(page);
    await page.locator('#sales-frame-tools').getByRole('group', { name: 'Period' }).getByRole('button', { name: 'Month' }).click(); await page.waitForTimeout(3000);
    await page.locator('[data-pulse-tile="sent"]').waitFor({ timeout: 30000 });
    results.n2.period = Math.abs((await frameTop(page)) - y0);
    const gotM = await tileValues(page);
    const mm = month.body?.metrics || {};
    const mismM = TILES.filter(k => gotM[k] !== expected(mm[k])).map(k => `${k}: ${gotM[k]} vs ${expected(mm[k])}`);
    ok(`1440 Month tiles = GET goals/pulse?scope=email&period=month (${TILES.map(k => `${k} ${gotM[k]}`).join(' · ')}); N2 ${results.n2.period} px`, !mismM.length && results.n2.period === 0, mismM.join(' | '));
    const whole = await page.locator('[data-email-view]').textContent();
    ok(`1440 no address anywhere on the Email page (${!/@/.test(whole)})`, !/@/.test(whole));
    ok('1440 0 page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- 390.
  {
    const { ctx, page, errors } = await open(390);
    await topTab(page, /^Dashboard/);
    await subTab(page, 'Email');
    await waitEmail(page);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    const got = await tileValues(page);
    ok(`390: ${await page.locator('[data-pulse-tile]').count()} tiles, no sideways scroll ${sideways}; sent ${got.sent} = route ${expected(wm.sent)}`, sideways && got.sent === expected(wm.sent));
    const cols = await page.locator('[data-why-mailboxes]').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    ok(`390: WHY and Mailboxes stack (${cols} column)`, cols === 1);
    await shot(page, 'email-390', { fullPage: true });
    await axeOn(page, 'email@390', '[data-sales-tab], #sales-analytics-root');
    ok('390 0 page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- Viewer.
  {
    const { ctx, page, errors } = await open(1440, { viewer: true });
    await topTab(page, /^Dashboard/);
    await subTab(page, 'Email');
    await waitEmail(page);
    const sync = await page.locator('#sales-frame-tools').getByRole('button', { name: 'Sync now' }).count();
    const dismiss = await page.getByRole('button', { name: 'Dismiss 7 d' }).count();
    await page.locator('[data-sequences] tbody tr[data-row]').first().getByRole('button', { name: /Show details/ }).click(); await page.waitForTimeout(500);
    const audience = await page.locator('[data-sequence-detail] button').count();
    const save = await page.locator('[data-explorer="email"]').getByRole('button', { name: 'Save view' }).count();
    await shot(page, 'email-viewer-1440');
    ok(`Viewer: Sync now ${sync}, Dismiss ${dismiss}, audience buttons ${audience}, Save view ${save}; tiles ${await page.locator('[data-pulse-tile]').count()}; 0 page errors`, sync === 0 && dismiss === 0 && audience === 0 && save === 0 && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- Side-by-side: mockup (file://) | prod build, 1440.
  {
    const width = 1440;
    const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await ctx.newPage();
    await page.goto(`file://${MOCK}`); await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/mockup-1440.png`, fullPage: true });
    const compose = await ctx.newPage();
    const b64 = f => fs.readFileSync(path.join(OUT, f)).toString('base64');
    await compose.setViewportSize({ width: width * 2 + 48, height: 200 });
    await compose.setContent(`<body style="margin:0;background:#000;color:#fff;font:12px monospace"><div style="display:flex;gap:16px;padding:16px;align-items:flex-start"><figure style="margin:0"><figcaption style="padding:4px 0">mockup · DashEmail.dc.html · 1440</figcaption><img src="data:image/png;base64,${b64('mockup-1440.png')}" style="width:${width}px;display:block"></figure><figure style="margin:0"><figcaption style="padding:4px 0">prod build · HEAD · 1440 (full page)</figcaption><img src="data:image/png;base64,${b64('email-1440-full.png')}" style="width:${width}px;display:block"></figure></div></body>`);
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
  fs.writeFileSync(path.join(OUT, 'stage4-report.json'), JSON.stringify({ ...results, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\ndashboard-v3 Stage 4 live check: ${passed}/${results.checks.length} passed · Claude 0 · Apollo ${realCalls.length} · writes 0 · ${Math.round((Date.now() - T0) / 1000)} s`);
  console.log(`files: ${fs.readdirSync(OUT).join(', ')}`);
  console.log(`restored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
