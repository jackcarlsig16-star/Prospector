// FIX map-fill-space-v1 live check - localhost against the build, as Jack (ownerSession) on the REAL HomeLover workspace,
// READ-ONLY: every non-GET API call and every Supabase write is aborted at the network layer and counted; the daily pulls
// are marked done in localStorage. `--before` = screenshots + measurements only (run on the build BEFORE the fix).
// Map at 1440: Dots at Standard then Tall - the SVG viewBox width vs the chart box width (M1), the plot rect's left /
// right gutters, the Y tick labels (M2: fitted range vs 0-100), the out-of-range band edge label, the Y range toggle
// (persisted in prospector_priorities_view), N2 0 px, axe 0, 0 page errors; 390: Dots view forced, no page scroll,
// axe 0. 0 Claude / 0 Apollo. ~1.5 min, cap 280 s.
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
const BEFORE = process.argv.includes('--before');
const TAG = BEFORE ? 'before' : 'after';
const OUT = path.join(ROOT, '.screenshots', 'fix-map-fill-space-v1');
const PORT = 3993, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const TABLES = ['sales_opportunities', 'sales_goals', 'sales_targets', 'sales_flow_events', 'sales_company_scores', 'sales_source_events', 'business_anthropic_usage', 'web_visits'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data?.[0]?.id;
if (!HL) throw new Error('no HomeLover business');
const count = async t => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL); if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message}`); return r.count; };
const snapshot = async () => { const o = {}; for (const t of TABLES) o[t] = await count(t); return o; };
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const nowT = new Date();
if (nowT.getHours() % 6 === 0 && nowT.getMinutes() < 2) { console.log('ABORT: within 2 min of a server.js cron time'); process.exit(1); }
let srv, browser, owner;
const blocked = [], realCalls = [], writes = [];
const results = { checks: [], axe: {}, measures: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  if (owner) { log(await owner.release()); owner = null; }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 280000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  async function open(width, { prefs = {} } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 }, hasTouch: width < 900 });
    await ctx.addInitScript(([k, val, bz, d, p]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, val);
      localStorage.setItem('prospector_goals_owner', 'team');
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, d);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
      localStorage.setItem('prospector_priorities_view', JSON.stringify(p));
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today, prefs]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      const apiWrite = isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname);
      if (apiWrite) writes.push(`${req.method()} ${u.pathname.replace(HL, '<HL>').replace(/[0-9a-f-]{36}/g, '<id>')}`);
      const deny = apiWrite || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.pathname}`); return route.abort(); }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(20000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    await page.goto(`${BASE}/?tab=pipeline&view=priorities`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 20000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: /^Pipeline/ }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
    await page.locator('[data-sales-subviews]').getByRole('tab', { name: 'Map', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    await page.locator('[data-dots-chart]').waitFor({ timeout: 30000 }); await page.waitForTimeout(1500);
    return { ctx, page, errors };
  }
  const measure = page => page.evaluate(() => {
    const box = document.querySelector('[data-chart-box]'); const svg = box.querySelector('svg');
    const vb = svg.getAttribute('viewBox').split(' ').map(Number);
    const rect = svg.querySelector('[data-band-zone] rect') || svg.querySelector('[data-plot]');
    const b = box.getBoundingClientRect(), s = svg.getBoundingClientRect();
    const zoneLeft = rect ? Number(rect.getAttribute('x')) : null, zoneW = rect ? Number(rect.getAttribute('width')) : null;
    const ctm = svg.getScreenCTM(); const scale = ctm ? ctm.a : s.width / vb[2];
    const first = svg.querySelector('[data-dot]'), last = [...svg.querySelectorAll('[data-dot]')].pop();
    const dotX = el => el.getBoundingClientRect().left + el.getBoundingClientRect().width / 2 - b.left;
    const rr = rect ? rect.getBoundingClientRect() : null;
    return {
      boxW: Math.round(b.width), svgW: Math.round(s.width), svgH: Math.round(s.height), vbW: vb[2], vbH: vb[3], scale: Math.round(scale * 1000) / 1000,
      plotLeftPx: rr ? Math.round(rr.left - b.left) : null, plotRightGapPx: rr ? Math.round(b.left + b.width - rr.right) : null, zoneLeft, zoneW,
      ticks: [...svg.querySelectorAll('[data-y-tick]')].map(t => t.textContent), edges: [...svg.querySelectorAll('[data-band-edge]')].map(t => t.textContent),
      firstDotX: first ? Math.round(dotX(first)) : null, lastDotX: last ? Math.round(dotX(last)) : null, dots: svg.querySelectorAll('[data-dot]').length,
      pageScroll: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  const axeOn = async (page, key, sel) => {
    await page.addScriptTag({ content: AXE });
    const vs = await page.evaluate(async s => { const r = await window.axe.run(document.querySelector(s), { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, html: x.nodes[0]?.html?.slice(0, 120) })); }, sel);
    results.axe[key] = vs;
    ok(`axe ${key}: ${vs.length} violations`, vs.length === 0, JSON.stringify(vs).slice(0, 400));
  };
  const shot = (page, nme) => page.locator('[data-priorities] [data-chart-card], [data-chart-box]').first().screenshot({ path: `${OUT}/${TAG}-${nme}.png`, animations: 'disabled' });
  const setHeight = async (page, label) => { await page.getByRole('group', { name: 'Chart height' }).getByRole('button', { name: new RegExp(`^${label}`) }).click(); await page.waitForTimeout(900); };

  // ---- 1440: Standard, then Tall.
  {
    const { ctx, page, errors } = await open(1440);
    for (const h of ['Standard', 'Tall']) {
      await setHeight(page, h);
      const m = await measure(page); results.measures[`1440-${h}`] = m;
      await shot(page, `${h.toLowerCase()}-1440`);
      log(`1440 ${h}: ${JSON.stringify(m)}`);
      if (!BEFORE) {
        ok(`${h} M1: viewBox width ${m.vbW} = chart box ${m.boxW} (scale ${m.scale})`, Math.abs(m.vbW - m.boxW) <= 1 && Math.abs(m.scale - 1) < 0.01);
        ok(`${h} M1: plot starts ${m.plotLeftPx} px from the card's left (band column), ${m.plotRightGapPx} px right gutter (ticks)`, m.plotLeftPx <= 60 && m.plotRightGapPx <= 40);
        ok(`${h} M2: Y ticks ${m.ticks.join(' ')} fit the data (not 0 25 50 75 100), edges ${m.edges.join(' | ') || 'none'}`, m.ticks.join(' ') !== '0 25 50 75 100' && m.ticks.length >= 3);
        ok(`${h}: first dot at ${m.firstDotX} px, last at ${m.lastDotX} px of ${m.boxW} (${m.dots} dots)`, m.firstDotX > 56 && m.lastDotX > m.boxW * 0.9);
      } else ok(`${h} (before): viewBox ${m.vbW} vs box ${m.boxW}, plot left ${m.plotLeftPx} px, right gap ${m.plotRightGapPx} px, ticks ${m.ticks.join(' ')}`, true);
    }
    if (!BEFORE) {
      await page.getByRole('group', { name: 'Y range' }).getByRole('button', { name: '0–100' }).click(); await page.waitForTimeout(900);
      const full = await measure(page);
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('prospector_priorities_view') || '{}'));
      ok(`toggle 0–100: ticks ${full.ticks.join(' ')} · stored yfit=${stored.yfit}`, full.ticks.join(' ') === '0 25 50 75 100' && stored.yfit === false && full.edges.length === 0);
      await shot(page, 'tall-full-1440');
      await page.getByRole('group', { name: 'Y range' }).getByRole('button', { name: 'Fit to data' }).click(); await page.waitForTimeout(900);
      const fit = await measure(page);
      const stored2 = await page.evaluate(() => JSON.parse(localStorage.getItem('prospector_priorities_view') || '{}'));
      ok(`toggle back: ticks ${fit.ticks.join(' ')} · stored yfit=${stored2.yfit}`, fit.ticks.join(' ') !== '0 25 50 75 100' && stored2.yfit === true);
      ok('1440 N2: no sideways page scroll', fit.pageScroll <= 0, `${fit.pageScroll} px`);
      await axeOn(page, 'Map@1440', '[data-priorities]');
    }
    ok('1440: 0 page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- 390: Dots forced (the phone defaults to Table).
  {
    const { ctx, page, errors } = await open(390, { prefs: { view: 'dots', height: 'standard' } });
    const m = await measure(page); results.measures['390'] = m;
    await page.screenshot({ path: `${OUT}/${TAG}-map-390.png`, fullPage: false });
    log(`390: ${JSON.stringify(m)}`);
    if (!BEFORE) {
      ok(`390: chart scrolls inside its box (viewBox ${m.vbW} ≥ 720, svg ${m.svgW} px wide), no page scroll`, m.vbW >= 720 && m.svgW === m.vbW && m.pageScroll <= 0, `page scroll ${m.pageScroll} px`);
      await axeOn(page, 'Map@390', '[data-priorities]');
    } else ok(`390 (before): viewBox ${m.vbW} vs svg ${m.svgW} px, box ${m.boxW}`, true);
    ok('390: 0 page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
} catch (e) {
  ok(`script error: ${e.message}`, false);
} finally {
  await cleanup();
}
const after = await snapshot();
const moved = TABLES.filter(t => before[t] !== after[t]).map(t => `${t} ${before[t]} -> ${after[t]}`);
const passed = results.checks.filter(c => c.pass).length;
console.log(`\nfix-map-fill-space-v1 live check (${TAG}): ${passed}/${results.checks.length} passed · ${Math.round((Date.now() - T0) / 1000)} s`);
console.log(`Claude / Apollo calls: ${realCalls.length} · API writes attempted (all aborted): ${writes.length}${writes.length ? ' ' + JSON.stringify([...new Set(writes)]) : ''} · other blocked: ${blocked.length}`);
console.log(`screenshots: ${fs.readdirSync(OUT).join(', ')}`);
console.log(`restored: ${moved.length ? `NO - ${moved.join(', ')}` : 'yes (read-only; no watched count moved)'}`);
fs.writeFileSync(path.join(OUT, `results-${TAG}.json`), JSON.stringify({ results, writes, realCalls, before, after }, null, 2));
if (moved.length) throw new Error('watched counts moved');
