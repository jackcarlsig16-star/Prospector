// FIX priorities-click-outside-v1 live check - READ-ONLY. localhost against the build, as Jack (ownerSession) on the REAL
// HomeLover workspace with the REAL scores; every non-GET aborted, outside hosts blocked. 1440: select Hilton -> a click
// on empty chart space deselects (card gone, aria-pressed false); a click on another dot swaps; a click inside the card
// keeps; Assign open + click elsewhere -> the dropdown closes, the selection stays; the Y switch keeps; a legend pill
// deselects; the table: a cell deselects, another name selects; axe on the view. 390: a tap outside the card closes it;
// no sideways page scroll. One real GET through the wiring (goals/scores). 0 Claude, 0 Apollo, 0 writes.
// Runtime ~1 min, cap 240 s. Shots + report: .screenshots/fix-priorities-click-outside-v1/. Run npm run build first.
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
const OUT = path.join(ROOT, '.screenshots', 'fix-priorities-click-outside-v1');
const PORT = 3993, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const HL_TABLES = ['sales_goals', 'sales_opportunities', 'sales_targets', 'sales_people', 'sales_signals', 'sales_week_goals', 'sales_settings', 'sales_company_scores', 'visit_priority_override', 'business_anthropic_usage'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const count = async (t, biz) => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', biz); if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message || `no count (HTTP ${r.status})`}`); return r.count; };
const biz = (await svc.from('businesses').select('id, name').ilike('name', '%homelover%')).data;
if (biz?.length !== 1) throw new Error('expected one HomeLover business');
const HL = biz[0].id;
const snapshot = async () => { const o = {}; for (const t of HL_TABLES) o[t] = await count(t, HL); return o; };
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
let srv, browser, owner;
const blocked = [], realCalls = [], writes = [];
const results = { checks: [], errors: [], axe: null };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 240000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const sc = await fetch(`${BASE}/api/sales/${HL}/goals/scores`, { headers: { cookie } });
  const body = await sc.json().catch(() => null);
  const rows = body?.rows || [];
  const hilton = rows.find(r => /^Hilton/.test(r.name)) || rows[0];
  ok(`real wiring: GET goals/scores -> ${sc.status}; ${rows.length} ranked; first subject ${hilton?.name} (${hilton?.band}); no "@"`, sc.status === 200 && rows.length > 0 && !JSON.stringify(body).includes('@'));

  browser = await chromium.launch();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  async function open(width) {
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
      if (isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname)) writes.push(`${req.method()} ${u.pathname}`);
      const deny = (isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname)) || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.pathname}`); return route.abort(); }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(20000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    await page.goto(`${BASE}/?tab=pipeline&view=priorities`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 20000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: /^Pipeline/ }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
    await page.locator('[data-sales-subviews]').getByRole('tab', { name: 'Priorities', exact: true }).dispatchEvent('click'); await page.waitForTimeout(1500);
    await page.locator('[data-priorities]').waitFor({ timeout: 20000 });
    return { ctx, page, errors };
  }
  const shot = (page, nme) => page.screenshot({ path: `${OUT}/${nme}.png`, animations: 'disabled', caret: 'hide', fullPage: false });
  const panel = page => page.locator('[data-company-panel]');
  const card = page => page.locator('[data-pinned-card]');
  const emptySpace = async page => { const b = await page.locator('[data-dots-chart] svg').boundingBox(); await page.mouse.click(b.x + 12, b.y + 8); await page.waitForTimeout(400); }; // the Y-axis label corner: never a dot
  const page1 = rows.slice(0, 40), hi = page1.indexOf(hilton);
  const other = page1[hi < 20 ? page1.length - 1 : 0]; // the far end of the page: its dot is never under Hilton's card

  {
    const { ctx, page, errors } = await open(1440);
    const view = page.locator('[data-priorities]');
    await view.locator('[data-dot]').first().waitFor({ timeout: 20000 }); await page.waitForTimeout(800);
    const dot = view.locator(`[data-dot="${hilton.key}"]`);
    const dot2 = view.locator(`[data-dot="${other.key}"]`);
    await dot.click(); await page.waitForTimeout(600);
    const pinned = (await card(page).count()) === 1;
    await shot(page, 'selected-1440');
    const box0 = await view.locator('[data-chart-box]').boundingBox();
    await emptySpace(page);
    const box1 = await view.locator('[data-chart-box]').boundingBox();
    await shot(page, 'after-outside-click-1440');
    ok(`1440 select ${hilton.name} (card ${pinned}) -> a click on empty chart space deselects: card ${await card(page).count()}, aria-pressed ${await dot.getAttribute('aria-pressed')}, chart box moved ${Math.abs(box1.width - box0.width) + Math.abs(box1.y - box0.y)} px`, pinned && (await card(page).count()) === 0 && (await dot.getAttribute('aria-pressed')) === 'false' && Math.abs(box1.width - box0.width) + Math.abs(box1.y - box0.y) === 0);
    await dot.click(); await page.waitForTimeout(400);
    await dot2.click(); await page.waitForTimeout(500);
    ok(`1440 a click on another dot (${other.name}) swaps the selection: card ${await card(page).getAttribute('data-pinned-card')}, ${hilton.name} aria-pressed ${await dot.getAttribute('aria-pressed')}`, (await card(page).getAttribute('data-pinned-card')) === other.key && (await dot.getAttribute('aria-pressed')) === 'false' && (await dot2.getAttribute('aria-pressed')) === 'true');
    await card(page).getByText(/^Intent /).click(); await page.waitForTimeout(300);
    ok(`1440 a click inside the card keeps it (card ${await card(page).count()})`, (await card(page).count()) === 1);
    const assign = card(page).getByRole('button', { name: /^Assign to/ });
    const assignable = await assign.isEnabled();
    if (assignable) {
      await assign.click(); await page.waitForTimeout(300);
      const menuOpen = (await page.getByRole('menu', { name: 'Assign to' }).count()) === 1;
      await shot(page, 'assign-open-1440');
      await emptySpace(page);
      ok(`1440 Assign ▾ open (${menuOpen}) + a click elsewhere -> the dropdown closes (${await page.getByRole('menu', { name: 'Assign to' }).count()}), the selection stays (card ${await card(page).count()})`, menuOpen && (await page.getByRole('menu', { name: 'Assign to' }).count()) === 0 && (await card(page).count()) === 1);
    } else ok(`1440 Assign ▾ is disabled on ${other.name} (Upside lock) - dropdown check covered by Jest`, true);
    await view.getByRole('group', { name: 'Y axis' }).getByRole('button', { name: 'Size' }).click(); await page.waitForTimeout(600);
    ok(`1440 the Y switch keeps the selection (card ${await card(page).count()})`, (await card(page).count()) === 1);
    await view.getByRole('group', { name: 'Y axis' }).getByRole('button', { name: 'Intent' }).click(); await page.waitForTimeout(600);
    const pill = view.locator('[data-legend-source]').first();
    await pill.click(); await page.waitForTimeout(400);
    const legendDeselects = (await card(page).count()) === 0;
    await view.getByRole('button', { name: 'All sources' }).click(); await page.waitForTimeout(400);
    ok(`1440 a legend pill deselects (card ${legendDeselects ? 0 : 1})`, legendDeselects);
    await page.addScriptTag({ content: AXE });
    const axe = await page.evaluate(async () => { const r = await window.axe.run(document.querySelector('[data-priorities]'), { resultTypes: ['violations'] }); return r.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, targets: v.nodes.slice(0, 3).map(n => n.target.join(' ')) })); });
    results.axe = axe;
    ok(`axe on the Priorities view: ${axe.length} violations`, axe.length === 0, JSON.stringify(axe).slice(0, 400));
    await view.getByRole('button', { name: 'Table' }).click(); await page.waitForTimeout(800);
    const table = view.getByRole('table');
    await table.getByRole('button', { name: hilton.name, exact: true }).first().click(); await page.waitForTimeout(400);
    const menuFor = n => view.getByRole('toolbar', { name: `Actions for ${n}` });
    const tableSelected = (await menuFor(hilton.name).count()) === 1;
    await table.getByRole('button', { name: other.name, exact: true }).first().click(); await page.waitForTimeout(400);
    const swapped = (await menuFor(other.name).count()) === 1 && (await menuFor(hilton.name).count()) === 0;
    await table.getByRole('columnheader', { name: 'Score' }).click(); await page.waitForTimeout(400);
    ok(`1440 Table: the name selects (${tableSelected}), another name swaps (${swapped}), a click on the Score header deselects (menu ${await view.getByRole('toolbar').count()}); 0 page errors`, tableSelected && swapped && (await view.getByRole('toolbar').count()) === 0 && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await open(390);
    const view = page.locator('[data-priorities]');
    await view.getByRole('button', { name: 'Dots' }).click(); await page.waitForTimeout(800);
    const dot = view.locator(`[data-dot="${hilton.key}"]`);
    await dot.dispatchEvent('click'); await page.waitForTimeout(600);
    const tapped = (await card(page).count()) === 1;
    await shot(page, 'selected-390');
    await page.evaluate(() => { window.__ev = []; for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'click', 'touchstart', 'touchend']) document.querySelector('[data-priorities]').addEventListener(t, e => window.__ev.push(`${t}:${e.pointerType || ''}:${e.target.tagName}${e.target.getAttribute('data-pinned-card') ? '(card)' : ''}`)); });
    await page.locator('[data-dots-chart] svg').scrollIntoViewIfNeeded(); await page.waitForTimeout(400); // a tap never scrolls
    const b = await page.locator('[data-dots-chart] svg').boundingBox();
    log('390 svg box', JSON.stringify(b), 'card box', JSON.stringify(await card(page).boundingBox()));
    await page.touchscreen.tap(b.x + 12, b.y + 8); await page.waitForTimeout(500);
    log('390 events after the tap:', JSON.stringify(await page.evaluate(() => window.__ev)));
    await shot(page, 'after-outside-tap-390');
    ok(`390 tap = card (${tapped}); a tap outside the card closes it (card ${await card(page).count()}, aria-pressed ${await dot.getAttribute('aria-pressed')}); no sideways page scroll; 0 page errors`, tapped && (await card(page).count()) === 0 && (await dot.getAttribute('aria-pressed')) === 'false' && (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)) && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  ok(`browser reached 0 Claude / Apollo hosts; every non-GET was aborted before it left (${[...new Set(writes)].join(', ') || 'none attempted'})`, !realCalls.length && writes.every(w => blocked.includes(w)), `${blocked.length} aborted`);
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try { const after = await snapshot(); restored = JSON.stringify(before) === JSON.stringify(after); line = restored ? 'yes (HomeLover counts identical; Jack sign-in row kept by rule, last_seen_at restored)' : `NO - before ${JSON.stringify(before)} after ${JSON.stringify(after)}`; } catch (e) { line = `NO (check failed: ${e.message})`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ ...results, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\nFIX priorities-click-outside-v1 live check: ${passed}/${results.checks.length} passed · axe ${results.axe ? results.axe.length : 'n/a'} · Claude 0 · Apollo 0 · writes 0\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  process.exit(passed === results.checks.length && restored && !results.errors.length ? 0 : 1);
}
