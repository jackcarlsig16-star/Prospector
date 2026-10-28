// FIX pipeline-quick-fixes-v1 live check - READ-ONLY. localhost against the build, as Jack (ownerSession) on the REAL
// HomeLover workspace. Every non-GET to /api, /proxy and Supabase REST is ABORTED; every outside host except Supabase +
// Google Fonts is blocked. Screens at 1440: Sales > Pipeline > Companies ("+ Add ▾" is the one primary in the tools row,
// opens Employer · Partner · Target · Person; Person form renders with no email / phone input; Esc closes; the search is
// the first control and "/" focuses it) and Sales > Actions (search first); at 390: the Add menu as a sheet, the phone
// filter sheet with the search first. One real GET through the wiring (goals/pipeline-board). The Forgot-password path
// is NOT touched here (Jest covers it with a mocked client - never a real reset email). 0 Claude, 0 Apollo, 0 writes.
// Runtime ~1 min, hard cap 240 s. Shots + report: .screenshots/fix-pipeline-quick-fixes-v1/. Run npm run build first.
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
const OUT = path.join(ROOT, '.screenshots', 'fix-pipeline-quick-fixes-v1');
const PORT = 3995, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const HL_TABLES = ['sales_goals', 'sales_opportunities', 'sales_targets', 'sales_people', 'partner_contacts', 'sales_signals', 'sales_week_goals', 'sales_source_events', 'business_anthropic_usage'];
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
  const board = await fetch(`${BASE}/api/sales/${HL}/goals/pipeline-board?fresh=1`, { headers: { cookie } });
  const rowsJson = await board.json().catch(() => null);
  const n = Array.isArray(rowsJson) ? rowsJson.length : Array.isArray(rowsJson?.rows) ? rowsJson.rows.length : null;
  ok(`real wiring: GET goals/pipeline-board -> ${board.status}; ${n} rows; no "@"`, board.status === 200 && n > 0 && !JSON.stringify(rowsJson).includes('@'));

  browser = await chromium.launch();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  async function open(width, tab) {
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
    await page.goto(`${BASE}/?tab=${tab}`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 20000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: tab === 'pipeline' ? /^Pipeline/ : /^Actions/ }).first().dispatchEvent('click'); await page.waitForTimeout(1500);
    return { ctx, page, errors };
  }
  const shot = (page, nme) => page.screenshot({ path: `${OUT}/${nme}.png`, animations: 'disabled', caret: 'hide', fullPage: false });
  const noScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  {
    const { ctx, page, errors } = await open(1440, 'pipeline');
    await page.locator('[data-pipeline-companies]').waitFor({ timeout: 20000 });
    await page.locator('[data-row]').first().waitFor({ timeout: 20000 }); await page.waitForTimeout(600);
    const tools = page.locator('#sales-frame-tools');
    const primaries = await tools.locator('.ui-btn--primary').count();
    const addBtn = tools.getByRole('button', { name: '+ Add ▾' });
    ok(`1440 tools row: "+ Add ▾" present, the only primary (${primaries}), "+ Add employer" gone`, (await addBtn.count()) === 1 && primaries === 1 && (await tools.getByRole('button', { name: '+ Add employer' }).count()) === 0);
    await addBtn.click(); await page.waitForTimeout(300);
    const menu = page.getByRole('menu', { name: 'Add' });
    const items = await menu.getByRole('menuitem').allTextContents();
    ok(`1440 menu opens with ${items.join(' · ')}; focus on the first item`, items.join(',') === 'Employer,Partner,Target,Person' && (await page.evaluate(() => document.activeElement?.textContent)) === 'Employer');
    await shot(page, 'add-menu-1440');
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
    const focused = await page.evaluate(() => document.activeElement?.textContent);
    await page.keyboard.press('Enter'); await page.waitForTimeout(600);
    const form = page.locator('[data-add-person]');
    const badInputs = await form.locator('input[type="email"], input[type="tel"]').count();
    const labels = await form.locator('input').evaluateAll(els => els.map(e => e.getAttribute('aria-label')));
    ok(`1440 arrows + Enter open Person (${focused}): the form has ${labels.join(' · ')} and no email / phone input (${badInputs})`, focused === 'Person' && (await form.count()) === 1 && badInputs === 0 && !labels.some(l => /email|phone/i.test(l || '')));
    await form.getByLabel('Company').fill('hil'); await page.waitForTimeout(500);
    const sugg = await form.getByRole('listbox', { name: 'Company suggestions' }).getByRole('option').count();
    ok(`1440 company typeahead answers ${sugg} suggestions for "hil" (board records, parked names)`, sugg > 0);
    await shot(page, 'add-person-1440');
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    await page.getByRole('dialog', { name: 'Add person' }).getByRole('button', { name: 'Cancel' }).click().catch(() => {}); await page.waitForTimeout(300);
    await addBtn.click(); await page.waitForTimeout(200); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    ok('1440 Esc closes the menu and returns focus to the button', (await page.getByRole('menu', { name: 'Add' }).count()) === 0 && (await page.evaluate(() => document.activeElement?.textContent)) === '+ Add ▾');
    const group = page.getByRole('group', { name: 'Filters' });
    const firstLabel = await group.locator('input, select, button').first().getAttribute('aria-label');
    const width = await group.getByLabel('Search companies').evaluate(el => el.style.width);
    await page.locator('body').click({ position: { x: 5, y: 5 } }); await page.keyboard.press('/'); await page.waitForTimeout(200);
    const focusedLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    ok(`1440 search first ("${firstLabel}", width ${width}); "/" focuses it (${focusedLabel}); no sideways scroll`, firstLabel === 'Search companies' && width === '220px' && focusedLabel === 'Search companies' && (await noScroll(page)));
    await shot(page, 'search-first-1440');
    ok(`1440 0 page errors`, !errors.length, errors.join(' | '));
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await open(1440, 'actions');
    await page.locator('[data-actions]').waitFor({ timeout: 20000 }); await page.waitForTimeout(600);
    const group = page.getByRole('group', { name: 'Filters' });
    const firstLabel = await group.locator('input, select, button').first().getAttribute('aria-label');
    ok(`Actions 1440: search first ("${firstLabel}"); 0 page errors`, firstLabel === 'Search actions' && !errors.length, errors.join(' | '));
    await shot(page, 'actions-search-first-1440');
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await open(390, 'pipeline');
    await page.locator('[data-pipeline-companies]').waitFor({ timeout: 20000 }); await page.waitForTimeout(800);
    const addBtn = page.locator('#sales-frame-tools').getByRole('button', { name: '+ Add ▾' });
    await addBtn.dispatchEvent('click'); await page.waitForTimeout(400);
    const sheet = page.getByRole('dialog', { name: 'Add' });
    const items = await sheet.getByRole('menuitem').allTextContents();
    ok(`390 the Add menu is a full-width sheet with ${items.join(' · ')}; no sideways page scroll`, (await sheet.count()) === 1 && items.length === 4 && (await noScroll(page)));
    await shot(page, 'add-sheet-390');
    await sheet.getByRole('button', { name: 'Cancel' }).click(); await page.waitForTimeout(300);
    await page.getByRole('button', { name: /^Filters/ }).click(); await page.waitForTimeout(400);
    const fsheet = page.getByRole('dialog', { name: 'Filters' });
    const firstLabel = await fsheet.locator('input, select, button').first().getAttribute('aria-label');
    const width = await fsheet.getByLabel('Search companies').evaluate(el => el.style.width);
    ok(`390 filter sheet: search first ("${firstLabel}", width ${width}); 0 page errors`, firstLabel === 'Search companies' && width === '160px' && !errors.length, errors.join(' | '));
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
  console.log(`\nFIX pipeline-quick-fixes-v1 live check: ${passed}/${results.checks.length} passed · Claude 0 · Apollo 0 · writes 0\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  process.exit(passed === results.checks.length && restored && !results.errors.length ? 0 : 1);
}
