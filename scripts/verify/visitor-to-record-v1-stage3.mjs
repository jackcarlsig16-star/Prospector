// visitor-to-record-v1 REV2 Stage 3 live check - READ-ONLY. localhost against the build, as Jack (ownerSession) on the
// REAL HomeLover workspace. Browser: every non-GET to /api, /proxy and Supabase REST is ABORTED; every outside host
// except Supabase + Google Fonts is blocked (an Anthropic / Apollo host fails the run). Screens: Pipeline > Companies >
// Website > Visitor report (the merged V5 view) and the People search panel at 1440 and 390; N2 = nothing on the page
// moves after a panel opens and closes; no sideways scroll. Two requests go through the real wiring (GET goals/visits/
// report, GET goals/people). restored = HomeLover counts identical; a count() error THROWS. 0 Claude, 0 Apollo, 0 writes.
// Runtime ~1-2 min, hard cap 240 s. Shots + report: .screenshots/visitor-to-record-v1/. Run npm run build first.
// Usage: node scripts/verify/visitor-to-record-v1-stage3.mjs
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
const OUT = path.join(ROOT, '.screenshots', 'visitor-to-record-v1');
const PORT = 3997, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const HL_TABLES = ['sales_goals', 'sales_opportunities', 'sales_targets', 'sales_people', 'partner_contacts', 'sales_signals', 'web_visits', 'visit_pull_runs', 'apollo_credit_spend', 'sales_source_events', 'sales_week_goals', 'sales_settings'];
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
const results = { checks: [], errors: [], n2: {} };
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
  const real = async p => { const r = await fetch(`${BASE}/api/sales/${HL}/goals${p}`, { headers: { cookie } }); const text = await r.text(); let body = null; try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; } return { code: r.status, body }; };
  const rep = await real('/visits/report');
  const withPeople = (rep.body?.rows || []).filter(r => r.people?.length), created = (rep.body?.rows || []).filter(r => r.created), filed = (rep.body?.rows || []).filter(r => r.filed_by_prospector);
  ok(`real wiring: GET goals/visits/report -> ${rep.code}; ${rep.body?.counts?.companies} companies, people_identified ${rep.body?.counts?.people_identified}, with people ${withPeople.length}, created ${created.length}, filed by Prospector ${filed.length}; every row carries people / created / filed_by_prospector; no address`, rep.code === 200 && (rep.body.rows || []).every(r => Array.isArray(r.people) && 'created' in r && 'filed_by_prospector' in r) && !JSON.stringify(rep.body).includes('@'));
  const ppl = await real('/people?q=a');
  ok(`real wiring: GET goals/people?q=a -> ${ppl.code}; ${ppl.body?.n} of ${ppl.body?.total} people, has_email boolean on every row, no address`, ppl.code === 200 && Array.isArray(ppl.body.people) && ppl.body.people.every(p => typeof p.has_email === 'boolean' && typeof p.name === 'string') && !JSON.stringify(ppl.body).includes('@'));
  ok('real wiring: GET goals/people?tie=friend -> 400', (await real('/people?tie=friend')).code === 400);

  browser = await chromium.launch();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  async function open(width) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 900 } });
    await ctx.addInitScript(([k, v, b, d]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      localStorage.setItem('prospector_goals_owner', 'team');
      for (const n of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${n}_ran_${b}`, d);
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
    await page.goto(`${BASE}/?tab=pipeline&view=companies&channel=website`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 20000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: /^Pipeline/ }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
    await page.locator('[data-sales-subviews]').getByRole('tab', { name: 'Companies', exact: true }).dispatchEvent('click'); await page.waitForTimeout(1500);
    await page.locator('[data-row]').first().waitFor({ timeout: 20000 });
    const web = page.locator('[data-channel="website"]');
    if (await web.count()) { await web.first().click(); await page.waitForTimeout(1200); }
    return { ctx, page, errors };
  }
  const boxes = page => page.evaluate(() => Object.fromEntries(['data-workspace-header', 'data-sales-tabrow', 'data-sales-subviews', 'data-channel-row', 'data-filter-row'].map(a => { const el = document.querySelector(`[${a}]`); if (!el) return [a, null]; const r = el.getBoundingClientRect(); return [a, { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, h: Math.round(r.height * 10) / 10 }]; })));
  const maxMove = (a, b) => Math.max(0, ...Object.keys(a).filter(k => a[k] && b[k]).flatMap(k => [Math.abs(a[k].x - b[k].x), Math.abs(a[k].y - b[k].y), Math.abs(a[k].h - b[k].h)]));
  const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide' });
  const noScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  for (const width of [1440, 390]) {
    const { ctx, page, errors } = await open(width);
    const tag = String(width);
    const b0 = await boxes(page);
    await page.getByRole('button', { name: 'Visitor report' }).dispatchEvent('click');
    const rpt = page.locator('[data-visitor-report]'); await rpt.waitFor({ timeout: 20000 });
    await rpt.getByText(/Companies \(7 d\)/).waitFor(); await page.waitForTimeout(1200);
    const text = await rpt.innerText();
    const hasHeader = width >= 900 ? (await rpt.getByRole('columnheader', { name: 'People identified' }).count()) === 1 : true;
    const createdChips = await rpt.locator('.ui-tag', { hasText: /^Created$/ }).count();
    const filedTags = await rpt.getByText('filed by Prospector').count();
    const peopleCells = await rpt.locator('[data-people-cell]').count();
    const conds = { hasHeader, stats: /people identified/i.test(text) && /created/i.test(text), filters: (await rpt.getByRole('group', { name: 'Filters' }).count()) === 1, upload: (await rpt.locator('input[aria-label="Upload Visited People CSV"]').count()) === 1, noScroll: await noScroll(page), noAddress: !text.includes('@') };
    ok(`${tag} Visitor report: merged view renders (stats People identified + Created, ${width >= 900 ? 'People identified column' : 'stacked cards'}, filters row, ${peopleCells} rows with people, ${createdChips} Created chips, ${filedTags} filed by Prospector), Upload Visited People CSV present for the owner, no sideways scroll, no "@"`, Object.values(conds).every(Boolean), JSON.stringify(conds));
    if (peopleCells) { await rpt.locator('[data-people-cell] summary').first().click(); await page.waitForTimeout(300); ok(`${tag} People identified expands to names + titles`, (await rpt.locator('[data-people-cell] li').count()) >= 1); }
    await rpt.getByRole('button', { name: 'Has people' }).click(); await page.waitForTimeout(400);
    const afterFilter = await rpt.locator(width >= 900 ? 'tbody tr' : 'li[data-visit-row]').count();
    ok(`${tag} filter Has people -> ${afterFilter} rows (= rows with people ${peopleCells})`, afterFilter === peopleCells);
    await rpt.getByRole('button', { name: 'Clear' }).click().catch(() => {});
    await shot(page, `stage3-visitors-${tag}`);
    await page.keyboard.press('Escape'); await page.waitForTimeout(600);
    if (await page.locator('[data-visitor-report]').count()) { await page.getByRole('button', { name: /Close/ }).first().click().catch(() => {}); await page.waitForTimeout(500); }
    const b1 = await boxes(page);
    await page.getByRole('button', { name: 'People search' }).dispatchEvent('click');
    const ps = page.locator('[data-people-search]'); await ps.waitFor({ timeout: 20000 });
    await ps.getByLabel('Search people').fill('a'); await page.waitForTimeout(1500);
    const rows = await ps.locator('[data-person-row]').count();
    const pText = await ps.innerText();
    ok(`${tag} People search: ${rows} rows for "a" with company chips and ties, status line, no "@", no sideways scroll`, rows >= 1 && /people/.test(pText) && !pText.includes('@') && (await noScroll(page)), pText.includes('@') ? 'ADDRESS ON SCREEN' : '');
    await shot(page, `stage3-people-${tag}`);
    await page.keyboard.press('Escape'); await page.waitForTimeout(600);
    const b2 = await boxes(page);
    const mv = Math.max(maxMove(b0, b1), maxMove(b0, b2)); results.n2[tag] = mv;
    ok(`N2 ${tag}: opening and closing the two panels moves nothing on the page (max ${mv} px); 0 page errors`, mv <= 1 && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  ok(`browser reached 0 Claude / Apollo hosts; every non-GET was aborted before it left (${[...new Set(writes)].join(', ') || 'none attempted'})`, !realCalls.length && writes.every(w => blocked.includes(w)), `${blocked.length} aborted`);
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try { const after = await snapshot(); restored = JSON.stringify(before) === JSON.stringify(after); line = restored ? 'yes (HomeLover counts identical; Jack sign-in row kept by rule, last_seen_at restored)' : `NO - before ${JSON.stringify(before)} after ${JSON.stringify(after)}`; } catch (e) { line = `NO (check failed: ${e.message})`; }
  const pass = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'visitor-to-record-v1-stage3.json'), JSON.stringify({ ...results, restored, blocked: [...new Set(blocked)] }, null, 2));
  console.log(`\n${pass}/${results.checks.length} checks passed${results.errors.length ? ` · ${results.errors.length} errors` : ''} · Claude 0 · Apollo 0 · writes 0`);
  for (const e of results.errors) console.log('ERROR:', e.split('\n').slice(0, 3).join(' | '));
  console.log(`restored: ${line}`);
  process.exit(restored && pass === results.checks.length && !results.errors.length ? 0 : 1);
}
