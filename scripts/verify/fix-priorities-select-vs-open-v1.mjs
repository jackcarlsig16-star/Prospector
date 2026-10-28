// FIX priorities-select-vs-open-v1 live check - READ-ONLY. localhost against the build, as Jack (ownerSession) on the REAL
// HomeLover workspace with the REAL scores; every non-GET aborted, outside hosts blocked. 1440: click Hilton's dot ->
// the card pins beside it with the quick menu (seven buttons) inside and the company window stays CLOSED; Esc clears;
// click again, Open in the menu -> the window; Esc closes it; double-click -> the window; the table's Open. 390: tap ->
// card + menu, Open -> the window sheet. One real GET through the wiring (goals/scores). 0 Claude, 0 Apollo, 0 writes.
// Runtime ~1 min, cap 240 s. Shots + report: .screenshots/fix-priorities-select-vs-open-v1/. Run npm run build first.
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
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const OUT = path.join(ROOT, '.screenshots', 'fix-priorities-select-vs-open-v1');
const PORT = 3992, BASE = `http://localhost:${PORT}`;
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
const results = { checks: [], errors: [] };
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
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 900 } });
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
    await page.locator('[data-sales-subviews]').getByRole('button', { name: 'Priorities', exact: true }).dispatchEvent('click'); await page.waitForTimeout(1500);
    await page.locator('[data-priorities]').waitFor({ timeout: 20000 });
    return { ctx, page, errors };
  }
  const shot = (page, nme) => page.screenshot({ path: `${OUT}/${nme}.png`, animations: 'disabled', caret: 'hide', fullPage: false });
  const panel = page => page.locator('[data-company-panel]');
  const card = page => page.locator('[data-pinned-card]');
  const menuButtons = page => card(page).getByRole('toolbar').getByRole('button').allTextContents();

  {
    const { ctx, page, errors } = await open(1440);
    const view = page.locator('[data-priorities]');
    await view.locator('[data-dot]').first().waitFor({ timeout: 20000 }); await page.waitForTimeout(800);
    const dot = view.locator(`[data-dot="${hilton.key}"]`);
    await dot.click(); await page.waitForTimeout(700);
    const btns = await menuButtons(page);
    ok(`1440 click ${hilton.name}: ring + card pinned (${await card(page).getAttribute('data-card-side')} side) with the quick menu inside (${btns.length}: ${btns.map(b => b.split(' ·')[0]).join(' · ')}); the window stays CLOSED (${await panel(page).count()}); aria-pressed ${await dot.getAttribute('aria-pressed')}`, btns.length === 7 && (await panel(page).count()) === 0 && (await dot.getAttribute('aria-pressed')) === 'true' && (await card(page).getAttribute('role')) === 'group');
    await shot(page, 'select-card-1440');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    ok('1440 Esc clears the selection (card gone, nothing open)', (await card(page).count()) === 0 && (await panel(page).count()) === 0 && (await dot.getAttribute('aria-pressed')) === 'false');
    await dot.click(); await page.waitForTimeout(500);
    await card(page).getByRole('toolbar').getByRole('button', { name: 'Open' }).click();
    await panel(page).waitFor({ timeout: 20000 }); await page.waitForTimeout(600);
    ok(`1440 Open in the menu -> the company window (${await panel(page).count()})`, (await panel(page).count()) === 1);
    await shot(page, 'open-window-1440');
    await page.keyboard.press('Escape'); await page.waitForTimeout(700);
    const closed = (await panel(page).count()) === 0;
    await shot(page, 'after-esc-1440');
    ok(`1440 Esc closes the window (${closed}); the selection stays (card ${await card(page).count()})`, closed);
    await dot.dispatchEvent('dblclick'); await page.waitForTimeout(800);
    ok(`1440 a double-click on the dot opens the window again (${await panel(page).count()})`, (await panel(page).count()) === 1);
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await dot.click(); await page.waitForTimeout(400);
    await card(page).locator('[data-card-name]').click(); await page.waitForTimeout(800);
    ok(`1440 the name in the card opens the window (${await panel(page).count()})`, (await panel(page).count()) === 1);
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300); // the second Esc clears the selection (a table click on a selected row would toggle it off)
    await view.getByRole('button', { name: 'Table' }).click(); await page.waitForTimeout(800);
    const table = view.getByRole('table');
    await table.getByRole('button', { name: hilton.name, exact: true }).first().click(); await page.waitForTimeout(400);
    const tableSelected = (await panel(page).count()) === 0 && (await view.getByRole('toolbar', { name: `Actions for ${hilton.name}` }).count()) === 1;
    await table.getByRole('button', { name: `Open ${hilton.name}` }).first().click(); await page.waitForTimeout(800);
    ok(`1440 Table: the name selects (menu under the table, no window: ${tableSelected}); the row's Open opens the window (${await panel(page).count()}); 0 page errors`, tableSelected && (await panel(page).count()) === 1 && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await open(390);
    const view = page.locator('[data-priorities]');
    await view.getByRole('button', { name: 'Dots' }).click(); await page.waitForTimeout(800);
    const dot = view.locator(`[data-dot="${hilton.key}"]`);
    await dot.dispatchEvent('click'); await page.waitForTimeout(600);
    const btns = await menuButtons(page);
    const tapOk = btns.length === 7 && (await panel(page).count()) === 0;
    await shot(page, 'select-card-390');
    await card(page).getByRole('toolbar').getByRole('button', { name: 'Open' }).dispatchEvent('click'); await page.waitForTimeout(800);
    ok(`390 tap = select with the card + ${btns.length} menu buttons and no window (${tapOk}); Open -> the window (${await panel(page).count()}); 0 page errors`, tapOk && (await panel(page).count()) === 1 && !errors.length, errors.join(' | '));
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
  console.log(`\nFIX priorities-select-vs-open-v1 live check: ${passed}/${results.checks.length} passed · Claude 0 · Apollo 0 · writes 0\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  process.exit(passed === results.checks.length && restored && !results.errors.length ? 0 : 1);
}
