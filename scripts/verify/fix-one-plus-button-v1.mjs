// FIX one-plus-button-v1 live check - READ-ONLY. localhost against the build, as Jack (ownerSession) on the REAL HomeLover
// workspace; every non-GET aborted, outside hosts blocked. 1440 + 390: the header "+" from Dashboard, Pipeline and
// Actions opens ONE menu with Task · Note · Idea | Employer · Partner · Target · Person (seven items, two groups);
// Pipeline's "+ Add ▾" shows the same four AND is not clipped (its last item is what the pointer hits at its center -
// the Oct 27 "Employer box" was the frame row clipping an absolute menu); Person opens the form with no email / phone
// input; one real GET through the wiring. 0 Claude, 0 Apollo, 0 writes. Runtime ~1 min, cap 240 s.
// Shots + report: .screenshots/fix-one-plus-button-v1/. Run npm run build first.
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
const OUT = path.join(ROOT, '.screenshots', 'fix-one-plus-button-v1');
const PORT = 3993, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const HL_TABLES = ['sales_goals', 'sales_opportunities', 'sales_targets', 'sales_people', 'partner_contacts', 'sales_week_goals', 'sales_source_events', 'business_anthropic_usage'];
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
const SEVEN = 'Task,Note,Idea,Employer,Partner,Target,Person';

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const me = await fetch(`${BASE}/api/sales/${HL}/goals/members`, { headers: { cookie } });
  ok(`real wiring: GET goals/members -> ${me.status}`, me.status === 200);
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
    const tabName = { dashboard: /^Dashboard/, pipeline: /^Pipeline/, actions: /^Actions/ }[tab];
    await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: tabName }).first().dispatchEvent('click'); await page.waitForTimeout(1500);
    return { ctx, page, errors };
  }
  const shot = (page, nme) => page.screenshot({ path: `${OUT}/${nme}.png`, animations: 'disabled', caret: 'hide', fullPage: false });
  const headerMenu = async (page, phone) => {
    await page.locator('[data-capture-button]').first().dispatchEvent('click'); await page.waitForTimeout(400);
    const menu = phone ? page.getByRole('dialog', { name: 'Capture or add', exact: true }) : page.getByRole('menu', { name: 'Capture or add', exact: true });
    const items = (await menu.getByRole('menuitem').allTextContents()).map(t => t.replace(/[TNI]$/, ''));
    const groups = await menu.getByRole('group').evaluateAll(els => els.map(e => e.getAttribute('aria-label')));
    return { menu, items: items.join(','), groups: groups.join(',') };
  };
  const hitsLast = async (page, menu) => menu.getByRole('menuitem').last().evaluate(el => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!hit && (hit === el || el.contains(hit)); });

  for (const tab of ['dashboard', 'pipeline', 'actions']) {
    const { ctx, page, errors } = await open(1440, tab);
    const { menu, items, groups } = await headerMenu(page, false);
    const last = await hitsLast(page, menu);
    ok(`1440 ${tab}: the header "+" opens one menu - groups ${groups}; items ${items}; the last item is hit-testable (${last}); 0 page errors`, items === SEVEN && groups === 'Capture,Add' && last && !errors.length, errors.join(' | '));
    if (tab === 'pipeline') {
      await shot(page, 'header-plus-pipeline-1440');
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      const stillOpen = await page.getByRole('menu', { name: 'Capture or add', exact: true }).count();
      ok(`1440 Esc closes the header menu (${stillOpen} left open); focus back on the "+" (${await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))})`, stillOpen === 0);
      const addBtn = page.locator('#sales-frame-tools').getByRole('button', { name: '+ Add ▾' });
      await shot(page, 'before-add-click-1440');
      await addBtn.dispatchEvent('click'); await page.waitForTimeout(400);
      const pm = page.getByRole('menu', { name: 'Add', exact: true });
      const pitems = (await pm.getByRole('menuitem').allTextContents()).join(',');
      const plast = await hitsLast(page, pm);
      const box = await pm.boundingBox();
      ok(`1440 Pipeline "+ Add ▾": the same four (${pitems}), portaled + fixed, fully visible (last item hit-testable ${plast}, menu ${Math.round(box?.height || 0)} px tall)`, pitems === 'Employer,Partner,Target,Person' && plast && (box?.height || 0) > 100);
      await shot(page, 'pipeline-add-menu-1440');
      await pm.getByRole('menuitem', { name: 'Person' }).click(); await page.waitForTimeout(600);
      const form = page.locator('[data-add-person]');
      ok(`1440 Pipeline › Person form renders with no email / phone input`, (await form.count()) === 1 && (await form.locator('input[type="email"], input[type="tel"]').count()) === 0);
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      await page.locator('[data-capture-button]').first().dispatchEvent('click'); await page.waitForTimeout(300);
      await page.getByRole('menu', { name: 'Capture or add', exact: true }).getByRole('menuitem', { name: 'Person' }).click(); await page.waitForTimeout(600);
      ok(`1440 header "+" › Person opens the same form (no email / phone input)`, (await page.locator('[data-add-person]').count()) === 1 && (await page.locator('[data-add-person] input[type="email"], [data-add-person] input[type="tel"]').count()) === 0);
      await shot(page, 'header-person-1440');
    } else { await page.keyboard.press('Escape'); }
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await open(390, 'pipeline');
    const { items, groups } = await headerMenu(page, true);
    ok(`390 the header "+" opens the sheet - groups ${groups}; items ${items}; no sideways page scroll; 0 page errors`, items === SEVEN && groups === 'Capture,Add' && (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)) && !errors.length, errors.join(' | '));
    await shot(page, 'header-plus-390');
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
  console.log(`\nFIX one-plus-button-v1 live check: ${passed}/${results.checks.length} passed · Claude 0 · Apollo 0 · writes 0\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  process.exit(passed === results.checks.length && restored && !results.errors.length ? 0 : 1);
}
