// FIX pipeline-390-toolbar-v1 live check - localhost against the build, as Jack (ownerSession) on the REAL HomeLover
// workspace, READ-ONLY (0 Claude, 0 Apollo, no writes: every non-GET API call and Supabase write aborted and counted).
// argv[2] = before | after (the screenshot set; both runs use the same checks). Pipeline › Map and › Companies at 390 and
// 1440: the sub-view strip vs the Share / Recompute buttons (bounding boxes must not intersect), N2 no sideways page
// scroll, the active tab inside the strip's visible box, axe 0 at 390 (heading order included). Declared scope: 4 page
// loads, 0 DB reads beyond the owner session + 3 watched head counts before/after. ~60 s, cap 240 s.
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
const MODE = process.argv[2] === 'before' ? 'before' : 'after';
const OUT = path.join(ROOT, '.screenshots', 'fix-pipeline-390-toolbar-v1');
const PORT = 3996, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const TABLES = ['sales_week_goals', 'sales_company_scores', 'business_anthropic_usage'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data?.[0]?.id;
if (!HL) throw new Error('no HomeLover business');
const count = async t => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL); if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message}`); return r.count; };
const snapshot = async () => { const o = {}; for (const t of TABLES) o[t] = await count(t); return o; };
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const nowT = new Date();
const minsToSix = ((6 - (nowT.getHours() % 6)) % 6) * 60 - nowT.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (nowT.getHours() % 6 === 0 && nowT.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
let srv, browser, owner;
const blocked = [], realCalls = [], writes = [];
const results = { mode: MODE, checks: [], axe: {}, boxes: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  if (owner) { log(await owner.release()); owner = null; }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 240000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));

try {
  owner = await ownerSession(svc); log('owner session');
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', ANTHROPIC_API_KEY: '', APOLLO_API_KEY: '', MICROSOFT_CLIENT_SECRET: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  log('server up'); browser = await chromium.launch(); log('browser');
  async function open(width, view) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 }, hasTouch: width < 900 });
    await ctx.addInitScript(([k, val, bz, d]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, val);
      localStorage.setItem('prospector_goals_owner', 'team');
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, d);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today]);
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
    await page.goto(`${BASE}/?tab=pipeline&view=${view}`, { waitUntil: 'domcontentloaded', timeout: 60000 }); log(`goto ${width} pipeline/${view}`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 20000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: /^Pipeline/ }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
    const sub = { priorities: 'Map', companies: 'Companies' }[view];
    await page.locator('[data-sales-subviews]').getByRole('tab', { name: sub, exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    return { ctx, page, errors, sub };
  }
  const axeOn = async (page, key, sel) => {
    await page.addScriptTag({ content: AXE });
    const vs = await page.evaluate(async s => { const r = await window.axe.run(s ? document.querySelector(s) : document, { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, html: x.nodes[0]?.html?.slice(0, 120) })); }, sel);
    results.axe[key] = vs;
    ok(`axe ${key}: ${vs.length} violations`, vs.length === 0, JSON.stringify(vs).slice(0, 400));
  };
  const geometry = page => page.evaluate(() => {
    const box = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
    const strip = document.querySelector('[data-sales-subviews]');
    const active = strip?.querySelector('[role="tab"][aria-selected="true"]');
    const btn = re => [...document.querySelectorAll('button')].find(b => re.test((b.getAttribute('aria-label') || b.textContent || '').trim()));
    return { strip: box(strip), active: box(active), share: box(btn(/^(↗ )?Share$|^Share/)), recompute: box(btn(/Recompute/)), scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, stripScroll: strip ? { scrollLeft: strip.scrollLeft, scrollWidth: strip.scrollWidth, clientWidth: strip.clientWidth } : null };
  });
  const intersects = (a, b) => !!(a && b) && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const [width, view] of [[390, 'priorities'], [390, 'companies'], [1440, 'priorities'], [1440, 'companies']]) {
    const { ctx, page, errors, sub } = await open(width, view);
    await page.locator('[data-sales-subviews]').waitFor({ timeout: 30000 }); await page.waitForTimeout(1500);
    const g = await geometry(page); results.boxes[`${width}-${view}`] = g;
    const key = `${sub}@${width}`;
    ok(`${key}: strip ${JSON.stringify(g.strip)} · Share ${JSON.stringify(g.share)} · Recompute ${JSON.stringify(g.recompute)} · no overlap`, g.strip && !intersects(g.strip, g.share) && !intersects(g.strip, g.recompute));
    ok(`${key}: N2 no sideways page scroll (${g.scrollW} vs ${g.innerW})`, g.scrollW <= g.innerW + 1);
    ok(`${key}: active tab inside the strip's visible box`, g.active && g.strip && g.active.x >= g.strip.x - 1 && g.active.x + g.active.w <= g.strip.x + g.strip.w + 1);
    // Share + Recompute are the Map's tools (PrioritiesView); Companies renders its own actions inline on a phone.
    if (width === 390 && view === 'priorities') ok(`${key}: Share / Recompute reachable with names (${g.share ? 'Share' : 'no Share'}, ${g.recompute ? 'Recompute' : 'no Recompute'}) · tools row under the strip`, !!g.share && !!g.recompute && g.share.y >= g.strip.y + g.strip.h - 1);
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/${MODE}-${view}-${width}.png`, fullPage: false, animations: 'disabled', caret: 'hide' });
    if (width === 390) { await axeOn(page, `${key} frame`, '[data-sales-frame]'); await axeOn(page, `${key} screen`, '[data-sales-tab]'); }
    ok(`${key}: 0 page errors`, !errors.length, errors.join(' | '));
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
console.log(`\nFIX pipeline-390-toolbar-v1 live check (${MODE}): ${passed}/${results.checks.length} passed · ${Math.round((Date.now() - T0) / 1000)} s`);
console.log(`Claude / Apollo calls: ${realCalls.length} · API writes attempted (all aborted): ${writes.length}${writes.length ? ' ' + JSON.stringify([...new Set(writes)]) : ''} · other blocked: ${blocked.length}`);
console.log(`screenshots: ${fs.readdirSync(OUT).join(', ')}`);
console.log(`restored: ${moved.length ? `NO - ${moved.join(', ')}` : 'yes (read-only; no watched count moved)'}`);
fs.writeFileSync(path.join(OUT, `results-${MODE}.json`), JSON.stringify({ results, writes, realCalls, before, after }, null, 2));
if (moved.length) throw new Error('watched counts moved');
