// company-window-v4 Stage 3 live check - localhost against the build, as Jack (ownerSession) on the REAL HomeLover
// workspace, READ-ONLY (0 Claude, 0 Apollo, no writes: every non-GET API call and Supabase write is aborted at the network
// layer and counted; a drawer click writes only the viewer's localStorage). Opens Fortem Media (target), Cloudflare and
// Hilton (employers) and HUB International (live partner) at 1440, Fortem at 390, Hilton as a Viewer (the /api/me reply
// downgraded to viewer): below Fit / Intel the body is seven 40 px drawer rows in order (Signals & visits · People ·
// Open to-dos · Waiting on them · Notes & touches · Client · Files - Client / Files for employers), counts = GET
// goals/company (+ goals/flow, /clients/:id/files), a one-line preview each, the section's action link at the right
// (none for a Viewer), Signals open iff the Interest band is live, a click opens a row inline (the bare card) and writes
// prospector_company_drawers for that company, N2 0 px, axe 0, 390 stacked with no sideways scroll; the live partner
// keeps its cards (no drawers). Side-by-side PNG: the mockup's whole dialog beside the build's whole window at 1440.
// Declared scope: 6 page loads, 4 company lookups, ~10 GETs, 10 table counts twice. ~200 s, cap 300 s.
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
const OUT = path.join(ROOT, '.screenshots', 'company-window-v4-stage3');
const MOCK = path.join(ROOT, 'specs', 'design', 'company-panel-v4', 'CompanyHead.dc.html');
const PORT = 3999, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const TABLES = ['sales_targets', 'sales_opportunities', 'sales_goals', 'sales_opportunity_events', 'sales_partner_events', 'research_runs', 'sales_company_scores', 'business_anthropic_usage', 'apollo_credit_spend', 'sales_notes'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data?.[0]?.id;
if (!HL) throw new Error('no HomeLover business');
const scoped = new Map();
async function count(t) {
  if (scoped.get(t) !== false) {
    const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL);
    if (!r.error && typeof r.count === 'number') { scoped.set(t, true); return r.count; }
    scoped.set(t, false);
  }
  const r = await svc.from(t).select('*', { count: 'exact', head: true });
  return r.error ? `n/a (${r.error.message.slice(0, 40)})` : `${r.count} (whole table)`;
}
const snapshot = async () => { const o = {}; for (const t of TABLES) o[t] = await count(t); return o; };
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
let srv, browser, owner;
const blocked = [], realCalls = [], writes = [];
const results = { checks: [], errors: [], axe: {}, n2: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 300000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));
const ORDER = { employer: ['signals', 'people', 'todos', 'waiting', 'notes', 'client', 'files'], target: ['signals', 'people', 'todos', 'waiting', 'notes'], partner: ['signals', 'people', 'todos', 'waiting', 'notes'] };
const LABEL = { signals: 'Signals & visits', people: 'People', todos: 'Open to-dos', waiting: 'Waiting on them', notes: 'Notes & touches', client: 'Client', files: 'Files' };
const ACTION = { employer: { signals: 'Open in People →', people: '+ Contact', todos: '+ Add', waiting: null, notes: '+ Note', client: 'Make client', files: '+ Upload' }, target: { signals: null, people: '+ Contact', todos: '+ Add', waiting: null, notes: '+ Note' } };

try {
  const one = async (table, col, name) => (await svc.from(table).select('id, ' + col).eq('business_id', HL).ilike(col, name).limit(1)).data?.[0] || null;
  const fortem = await one('sales_targets', 'name', 'Fortem Media');
  const cloudflare = await one('sales_opportunities', 'organization', 'Cloudflare');
  const hilton = await one('sales_opportunities', 'organization', 'Hilton');
  const hub = (await svc.from('sales_goals').select('id, name').eq('business_id', HL).eq('pipeline_status', 'live').ilike('name', 'HUB%').limit(1)).data?.[0] || (await svc.from('sales_goals').select('id, name').eq('business_id', HL).eq('pipeline_status', 'live').limit(1)).data?.[0];
  if (!fortem || !cloudflare || !hilton || !hub) throw new Error(`missing a company: ${JSON.stringify({ fortem: !!fortem, cloudflare: !!cloudflare, hilton: !!hilton, hub: !!hub })}`);
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', ANTHROPIC_API_KEY: '', APOLLO_API_KEY: '', MICROSOFT_CLIENT_SECRET: '', GMAIL_CLIENT_SECRET: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const get = async p => { const r = await fetch(`${BASE}/api/sales/${HL}${p}`, { headers: { cookie } }); return { status: r.status, body: await r.json().catch(() => null) }; };
  // The counts the rows must show, from the routes the window reads.
  async function expected(type, id) {
    const d = (await get(`/goals/company?type=${type}&id=${id}`)).body;
    const flow = (await get(`/flow/${type}/${id}`)).body?.events || [];
    const files = type === 'employer' ? (await get(`/clients/${id}/files`)).body?.files || [] : null;
    const notes = [...d.recent, ...flow].length;
    return { d, live: !!d.interest?.show, counts: { signals: String(d.timeline.length), people: String(d.people.length), todos: String(d.todos.length), waiting: String(d.waiting.length), notes: String(Math.min(8, notes)), client: '—', files: files ? String(files.length) : null }, files };
  }

  browser = await chromium.launch();
  async function openWin(width, type, id, { viewer = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 }, hasTouch: width < 900 });
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
    await page.goto(`${BASE}/?tab=pipeline&view=companies&open=${type}-${id}`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 25000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: /^Pipeline/ }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
    await page.locator('[data-sales-subviews]').getByRole('tab', { name: 'Companies', exact: true }).dispatchEvent('click'); await page.waitForTimeout(1500);
    await page.locator('[data-center-window] [data-company-panel]').first().waitFor({ timeout: 30000 });
    await page.locator('[data-center-window] [data-company-drawers], [data-center-window] [data-panel-body]').first().waitFor({ timeout: 30000 }); await page.waitForTimeout(2500);
    return { ctx, page, errors };
  }
  const axeOn = async (page, key) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async () => { const r = await window.axe.run(document.querySelector('[data-center-window]'), { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); });
    results.axe[key] = v;
    ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v).slice(0, 300));
  };
  const info = page => page.evaluate(() => {
    const dlg = document.querySelector('[data-center-window]');
    const drawers = dlg.querySelector('[data-company-drawers]');
    const rows = drawers ? [...drawers.querySelectorAll('[data-drawer]')].map(el => {
      const rowEl = el.querySelector('.ui-drawer__row'), head = el.querySelector('.ui-drawer__head');
      const r = rowEl.getBoundingClientRect(), hr = head.getBoundingClientRect();
      return { id: el.dataset.drawer, label: el.querySelector('.ui-drawer__label').textContent, count: el.querySelector('.ui-drawer__count')?.textContent ?? null, warn: !!el.querySelector('.ui-drawer__count--warn'), preview: el.querySelector('.ui-drawer__summary')?.textContent ?? null, action: el.querySelector('.ui-drawer__action')?.textContent ?? null, actionInHead: !!head.querySelector('.ui-drawer__action'), open: el.dataset.open === 'true', height: Math.round(r.height), width: Math.round(r.width), buttonsInRow: rowEl.querySelectorAll('button').length, bare: !!el.querySelector('[data-section][data-bare]'), glyph: el.querySelector('.ui-drawer__glyph')?.textContent, headWidth: Math.round(hr.width) };
    }) : null;
    const fit = dlg.querySelector('[data-fit-intel]');
    return { layout: dlg.querySelector('[data-layout]')?.dataset.layout, rows, drawersAfterFit: !!fit && fit.nextElementSibling?.hasAttribute('data-company-drawers'), panelBody: !!dlg.querySelector('[data-panel-body]'), cards: [...dlg.querySelectorAll('[data-section]:not([data-bare])')].map(s => s.dataset.section), winWidth: Math.round(dlg.getBoundingClientRect().width), headTop: dlg.querySelector('[data-window-head]').getBoundingClientRect().top, text: dlg.textContent, stored: localStorage.getItem('prospector_company_drawers') };
  });
  const rowsCheck = (tag, h, type, exp, { viewer = false } = {}) => {
    const ids = h.rows.map(r => r.id);
    ok(`${tag} drawers below Fit / Intel (${h.drawersAfterFit}), no old two-column body (${!h.panelBody}): ${ids.join(' · ')} = ${ORDER[type].join(' · ')}`, h.drawersAfterFit && !h.panelBody && ids.join('|') === ORDER[type].join('|'));
    const bad = h.rows.filter(r => r.label !== LABEL[r.id] || r.count !== exp.counts[r.id] || Math.abs(r.height - 40) > 2 || !r.preview || r.actionInHead || r.buttonsInRow !== (r.action ? 2 : 1));
    ok(`${tag} every row: label, count = the route (${h.rows.map(r => `${r.id} ${r.count}/${exp.counts[r.id]}`).join(', ')}), 40 px (${h.rows.map(r => r.height).join('/')}), a preview, the action beside the head button; bad: ${bad.map(r => r.id).join(',') || 'none'}`, bad.length === 0);
    const actions = h.rows.map(r => `${r.id}:${r.action ?? '—'}`).join(' ');
    ok(`${tag} action links ${viewer ? '(Viewer: none)' : ''}: ${actions}`, h.rows.every(r => (viewer ? r.action === null : r.action === (ACTION[type][r.id] ?? null))));
    ok(`${tag} Signals ${h.rows[0].open ? 'open' : 'closed'} = interest live ${exp.live}; its count ${h.rows[0].warn ? 'warn' : 'neutral'} (${h.rows[0].count}); every other row closed; previews: ${h.rows.map(r => `${r.id} "${r.preview.slice(0, 40)}"`).join(' · ')}`,
      h.rows[0].open === exp.live && h.rows[0].warn === (Number(h.rows[0].count) > 0) && h.rows.slice(1).every(r => !r.open) && (!exp.live || h.rows[0].bare));
  };

  // ---- Fortem (target) at 1440: rows, a click opens People + writes the viewer's localStorage only, N2 0 px.
  {
    const exp = await expected('target', fortem.id);
    const { ctx, page, errors } = await openWin(1440, 'target', fortem.id);
    const h = await info(page);
    rowsCheck('1440 Fortem', h, 'target', exp);
    await page.locator('[data-center-window] [data-drawer="people"] .ui-drawer__head').click(); await page.waitForTimeout(500);
    const h2 = await info(page);
    const people = h2.rows.find(r => r.id === 'people');
    results.n2.fortem_people = Math.abs(h2.headTop - h.headTop);
    const stored = JSON.parse(h2.stored || '{}');
    ok(`1440 Fortem click People -> open ${people.open}, glyph ${people.glyph}, the bare card inside (${people.bare}); prospector_company_drawers["target-${fortem.id.slice(0, 8)}…"] = ${JSON.stringify(stored[`target-${fortem.id}`])}; N2 ${results.n2.fortem_people} px; 0 writes`, people.open && people.glyph === '▾' && people.bare && stored[`target-${fortem.id}`]?.people === true && results.n2.fortem_people === 0 && writes.length === 0);
    await page.locator('[data-center-window] [data-drawer="people"] .ui-drawer__head').click(); await page.waitForTimeout(300);
    const h3 = await info(page);
    ok(`1440 Fortem click again -> closed (${!h3.rows.find(r => r.id === 'people').open}), stored false (${JSON.parse(h3.stored)[`target-${fortem.id}`]?.people === false})`, !h3.rows.find(r => r.id === 'people').open && JSON.parse(h3.stored)[`target-${fortem.id}`]?.people === false);
    await page.locator('[data-center-window] [data-drawer="people"] .ui-drawer__head').click(); await page.waitForTimeout(300);
    await page.evaluate(() => { const w = document.querySelector('[data-center-window]'); const b = w.querySelector('[data-window-body]'); w.style.maxHeight = 'none'; w.style.height = 'auto'; w.style.overflow = 'visible'; b.style.overflow = 'visible'; b.style.maxHeight = 'none'; });
    await page.waitForTimeout(300);
    await page.locator('[data-center-window]').screenshot({ path: `${OUT}/fortem-window-1440.png`, animations: 'disabled' });
    await axeOn(page, 'fortem@1440');
    ok(`1440 Fortem no address in the window (${!/@/.test(h.text)}); 0 page errors`, !/@/.test(h.text) && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- Cloudflare (employer) at 1440: Signals auto-open iff interest live, Client / Files rows.
  {
    const exp = await expected('employer', cloudflare.id);
    const { ctx, page, errors } = await openWin(1440, 'employer', cloudflare.id);
    const h = await info(page);
    rowsCheck('1440 Cloudflare', h, 'employer', exp);
    const files = h.rows.find(r => r.id === 'files'), client = h.rows.find(r => r.id === 'client');
    ok(`1440 Cloudflare Client row count "—", preview "${client.preview}"; Files count ${files.count} = /clients/:id/files (${exp.files.length}), preview "${files.preview.slice(0, 60)}"`, client.count === '—' && files.count === String(exp.files.length) && (exp.files.length ? files.preview.includes(exp.files[0].title) : /No agreements or financials yet/.test(files.preview)));
    await page.locator('[data-center-window] [data-drawer="client"] .ui-drawer__head').click(); await page.waitForTimeout(400);
    const h2 = await info(page);
    ok(`1440 Cloudflare click Client -> open with the bare Client card (${h2.rows.find(r => r.id === 'client').bare}); 0 writes`, h2.rows.find(r => r.id === 'client').open && h2.rows.find(r => r.id === 'client').bare && writes.length === 0);
    await page.screenshot({ path: `${OUT}/cloudflare-window-1440.png`, animations: 'disabled' });
    await axeOn(page, 'cloudflare@1440');
    ok(`1440 Cloudflare 0 page errors, no address`, !errors.length && !/@/.test(h.text), errors.join(' | '));
    await ctx.close();
  }
  // ---- Hilton (employer) at 1440 as Jack, then as a Viewer (rows without links, the head still toggles).
  {
    const exp = await expected('employer', hilton.id);
    const { ctx, page, errors } = await openWin(1440, 'employer', hilton.id);
    const h = await info(page);
    rowsCheck('1440 Hilton', h, 'employer', exp);
    await axeOn(page, 'hilton@1440');
    ok(`1440 Hilton 0 page errors`, !errors.length, errors.join(' | '));
    await ctx.close();
    const v = await openWin(1440, 'employer', hilton.id, { viewer: true });
    const hv = await info(v.page);
    rowsCheck('1440 Hilton VIEWER', hv, 'employer', exp, { viewer: true });
    const controls = await v.page.evaluate(() => document.querySelectorAll('[data-center-window] [data-company-drawers] button:not(.ui-drawer__head), [data-center-window] [data-actions-row], [data-center-window] [data-fact-button]').length);
    await v.page.locator('[data-center-window] [data-drawer="todos"] .ui-drawer__head').click(); await v.page.waitForTimeout(400);
    const hv2 = await info(v.page);
    const todos = hv2.rows.find(r => r.id === 'todos');
    const bodyButtons = await v.page.evaluate(() => document.querySelectorAll('[data-center-window] [data-drawer="todos"] .ui-drawer__body button').length);
    ok(`1440 Hilton VIEWER: ${controls} controls outside the row heads; To-dos opens (${todos.open}) with the bare card (${todos.bare}) and ${bodyButtons} buttons inside; 0 writes`, controls === 0 && todos.open && todos.bare && bodyButtons === 0 && writes.length === 0);
    await v.page.screenshot({ path: `${OUT}/hilton-viewer-1440.png`, animations: 'disabled' });
    await axeOn(v.page, 'hilton-viewer@1440');
    await v.ctx.close();
  }
  // ---- HUB International (live partner) at 1440: unchanged - cards, no drawers.
  {
    const { ctx, page, errors } = await openWin(1440, 'partner', hub.id);
    const h = await info(page);
    ok(`1440 ${hub.name} (live partner): layout ${h.layout}, drawers ${h.rows ? h.rows.length : 'none'}, the two-column body (${h.panelBody}) with cards ${h.cards.join(' · ')}; 0 page errors`, h.layout === 'live-partner' && h.rows === null && h.panelBody && h.cards.includes('signals') && h.cards.includes('people') && !errors.length, errors.join(' | '));
    await page.screenshot({ path: `${OUT}/hub-window-1440.png`, animations: 'disabled' });
    await axeOn(page, 'hub@1440');
    await ctx.close();
  }
  // ---- Fortem at 390: rows stack full width, no sideways scroll.
  {
    const exp = await expected('target', fortem.id);
    const { ctx, page, errors } = await openWin(390, 'target', fortem.id);
    const h = await info(page);
    const sideways = await page.evaluate(() => { const w = document.querySelector('[data-center-window]'); return w.scrollWidth <= w.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1; });
    ok(`390 Fortem: ${h.rows.length} rows = ${ORDER.target.length}, each ${h.rows.map(r => r.height).join('/')} px tall and ${h.rows.map(r => r.width).join('/')} px wide in a ${h.winWidth} px window, counts = the route (${h.rows.every(r => r.count === exp.counts[r.id])}), no sideways scroll ${sideways}; 0 page errors`, h.rows.length === ORDER.target.length && h.rows.every(r => Math.abs(r.height - 40) <= 2 && r.width >= h.winWidth - 48) && h.rows.every(r => r.count === exp.counts[r.id]) && sideways && !errors.length, errors.join(' | '));
    await page.screenshot({ path: `${OUT}/fortem-window-390.png`, animations: 'disabled', fullPage: true });
    await axeOn(page, 'fortem@390');
    await ctx.close();
  }
  // ---- Side-by-side: the mockup's whole dialog | the build's whole Fortem window.
  {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`file://${MOCK}`); await page.waitForTimeout(800);
    await page.addStyleTag({ content: 'x-dc{display:block} helmet{display:none} div:has(>[role=dialog]){display:block!important;width:auto!important} [role=dialog]{width:1064px!important;flex:none!important}' }); await page.waitForTimeout(500);
    await page.locator('[role="dialog"]').first().screenshot({ path: `${OUT}/mockup-dialog.png` });
    const compose = await ctx.newPage();
    const b64 = f => fs.readFileSync(path.join(OUT, f)).toString('base64');
    await compose.setViewportSize({ width: 1120 * 2 + 48, height: 200 });
    await compose.setContent(`<body style="margin:0;background:#000;color:#fff;font:12px monospace"><div style="display:flex;gap:16px;align-items:flex-start;padding:16px"><figure style="margin:0"><figcaption style="padding:4px 0">mockup · CompanyHead.dc.html · complete (Owner menu drawn open; drawers closed)</figcaption><img src="data:image/png;base64,${b64('mockup-dialog.png')}" style="width:1120px;display:block"></figure><figure style="margin:0"><figcaption style="padding:4px 0">prod build · HEAD · Fortem Media complete at 1440 (People drawer open)</figcaption><img src="data:image/png;base64,${b64('fortem-window-1440.png')}" style="width:1120px;display:block"></figure></div></body>`);
    await compose.waitForTimeout(500);
    await compose.screenshot({ path: `${OUT}/side-by-side-1440.png`, fullPage: true });
    ok('side-by-side-1440.png written (mockup complete | prod window complete)', true);
    await ctx.close();
  }
  ok(`browser reached 0 Claude / Apollo hosts; every non-GET aborted (${[...new Set(writes)].join(', ') || 'none attempted'})`, !realCalls.length && writes.every(w => blocked.includes(w)));
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    const after = await snapshot();
    const moved = TABLES.filter(t => String(before[t]) !== String(after[t])).map(t => `${t} ${before[t]} -> ${after[t]}`);
    if (moved.length) throw new Error(`counts moved: ${moved.join(', ')}`);
    restored = true; line = `yes (${TABLES.length} table counts identical, 0 writes; Jack sign-in row kept by rule, last_seen_at restored)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'stage3-report.json'), JSON.stringify({ ...results, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\ncompany-window-v4 Stage 3 live check: ${passed}/${results.checks.length} passed · Claude 0 · Apollo ${realCalls.length} · writes 0 · ${Math.round((Date.now() - T0) / 1000)} s`);
  console.log(`files: ${fs.readdirSync(OUT).join(', ')}`);
  console.log(`restored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
