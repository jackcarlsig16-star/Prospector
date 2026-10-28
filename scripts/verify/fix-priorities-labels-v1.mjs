// FIX priorities-labels-v1 live check - READ-ONLY. localhost against the build, as Jack (ownerSession) on the REAL
// HomeLover workspace with the REAL scores (GET goals/scores through the wiring - no fixture). Every non-GET to /api,
// /proxy and Supabase REST is ABORTED; every outside host except Supabase + Google Fonts is blocked (an Anthropic /
// Apollo / CDN host fails the run - so the html2canvas PNG is NOT exercised here; the labels live in the SVG it
// captures). Screens: Sales > Pipeline > Priorities at 1440 (every P1 dot named without hovering, Hilton by name,
// Names Off / All / On, the selected row always named, Bars named, axe on the view) and 390 (table first; Dots names
// P1 only; a tap selects + keeps the breakdown card). N2 = nothing above the view moves across the toggles; no
// sideways page scroll; 0 page errors; no "@". restored = HomeLover counts identical; a count() error THROWS.
// 0 Claude, 0 Apollo, 0 writes. Runtime ~1-2 min, hard cap 240 s. Shots + report: .screenshots/fix-priorities-labels-v1/.
// Run npm run build first. Usage: node scripts/verify/fix-priorities-labels-v1.mjs
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
const OUT = path.join(ROOT, '.screenshots', 'fix-priorities-labels-v1');
const AXE = fs.readFileSync(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const PORT = 3997, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const HL_TABLES = ['sales_goals', 'sales_opportunities', 'sales_targets', 'sales_people', 'sales_signals', 'web_visits', 'sales_week_goals', 'sales_settings', 'sales_company_scores', 'sales_company_score_days', 'visit_priority_override', 'sales_visit_skip', 'business_anthropic_usage'];
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
const results = { checks: [], errors: [], n2: {}, axe: null };
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
  const sc = await real('/scores');
  const rows = sc.body?.rows || [];
  const p1 = rows.filter(r => r.band === 'P1'), p2 = rows.filter(r => r.band === 'P2');
  const page1 = rows.slice(0, 40);
  const expectedOn = new Set([...page1.filter(r => r.band === 'P1' || r.band === 'P2').map(r => r.key), ...page1.slice(0, 10).map(r => r.key)]);
  ok(`real wiring: GET goals/scores -> ${sc.code}; ${sc.body?.counts?.companies} companies, ${rows.length} ranked, P1 ${p1.length} (${p1.map(r => r.name).join(', ')}), P2 ${p2.length}; no "@"`, sc.code === 200 && rows.length > 10 && p1.length > 0 && !JSON.stringify(sc.body).includes('@'));

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
  const boxes = page => page.evaluate(() => Object.fromEntries(['data-workspace-header', 'data-sales-tabrow', 'data-sales-subviews', 'data-filter-row', 'data-view-row'].map(a => { const el = document.querySelector(`[${a}]`); if (!el) return [a, null]; const r = el.getBoundingClientRect(); return [a, { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, h: Math.round(r.height * 10) / 10 }]; })));
  const maxMove = (a, b) => Math.max(0, ...Object.keys(a).filter(k => a[k] && b[k]).flatMap(k => [Math.abs(a[k].x - b[k].x), Math.abs(a[k].y - b[k].y), Math.abs(a[k].h - b[k].h)]));
  const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide', fullPage: true });
  const noScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const labelKeys = view => view.locator('[data-name-label]').evaluateAll(els => els.map(e => [e.getAttribute('data-name-label'), e.textContent, e.getAttribute('fill')]));
  const namesBtn = (view, n) => view.getByRole('group', { name: 'Names' }).getByRole('button', { name: n, exact: true });

  {
    const { ctx, page, errors } = await open(1440);
    const view = page.locator('[data-priorities]');
    await view.locator('[data-dot]').first().waitFor({ timeout: 20000 }); await page.waitForTimeout(900);
    const b0 = await boxes(page);
    const dots = await view.locator('[data-dot]').count();
    const l0 = await labelKeys(view);
    const keys0 = new Set(l0.map(l => l[0]));
    const p1Named = p1.filter(r => keys0.has(r.key)).length;
    const hilton = l0.find(l => /^Hilton/.test(l[1]));
    const missing = [...expectedOn].filter(k => !keys0.has(k)).length;
    ok(`1440 Dots default: ${dots} dots, ${l0.length} named without hovering; every P1 named (${p1Named}/${p1.length}), Hilton by name (${hilton ? hilton[1] : 'MISSING'}), ${missing} of the ${expectedOn.size} P1/P2/top-10 candidates dropped by the collision pass, labels in the text color, no sideways scroll, no "@"`,
      dots === Math.min(40, rows.length) && p1Named === p1.length && !!hilton && l0.every(l => l[2] === 'var(--sa-text)') && (await noScroll(page)) && !(await view.innerText()).includes('@'), `named: ${l0.map(l => l[1]).join(' | ')}`);
    await shot(page, 'labels-dots-1440');
    await namesBtn(view, 'Off').click(); await page.waitForTimeout(400);
    const offCount = await view.locator('[data-name-label]').count();
    await view.locator('[data-dot]').nth(12).click(); await page.waitForTimeout(900);
    const lOff = await labelKeys(view);
    const selKey = await view.locator('[data-dot][data-selected="true"]').getAttribute('data-dot');
    const stored = await page.evaluate(() => localStorage.getItem('prospector_sales_priorities_names'));
    ok(`1440 Names Off: ${offCount} labels, then a click names only the selected row (${lOff.map(l => l[1]).join(', ')}); stored as "${stored}"`, offCount === 0 && lOff.length === 1 && lOff[0][0] === selKey && stored === 'off');
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    await namesBtn(view, 'All').click(); await page.waitForTimeout(500);
    const lAll = await labelKeys(view);
    const countLine = (await view.locator('[data-names-count]').count()) ? await view.locator('[data-names-count]').innerText() : '';
    const m = countLine.match(/^(\d+) of (\d+) named - see Table for all$/);
    ok(`1440 Names All: "${countLine}" matches the ${lAll.length} labels drawn of ${dots}; the selected row still named first`, !!m && Number(m[1]) === lAll.length && Number(m[2]) === dots && lAll[0]?.[0] === selKey && lAll.length >= l0.length);
    await shot(page, 'labels-dots-all-1440');
    await namesBtn(view, 'On').click(); await page.waitForTimeout(400);
    await view.getByRole('button', { name: 'Bars' }).click(); await page.waitForTimeout(900);
    const bars = await view.locator('[data-bar]').count();
    const lBars = await labelKeys(view);
    const barKeys = new Set(lBars.map(l => l[0]));
    const inside = await view.locator('[data-label-inside]').count();
    ok(`1440 Bars: ${bars} bars, ${lBars.length} named (${inside} inside the bar, the rest above), every P1 named (${p1.filter(r => barKeys.has(r.key)).length}/${p1.length}), the selected row named, no score-only labels left`, bars === dots && p1.every(r => barKeys.has(r.key)) && barKeys.has(selKey) && (await view.locator('[data-bars-chart] [data-direct-label]').count()) === 0);
    await shot(page, 'labels-bars-1440');
    await view.getByRole('button', { name: 'Dots' }).click(); await page.waitForTimeout(700);
    await page.addScriptTag({ content: AXE });
    const axe = await page.evaluate(async () => { const r = await window.axe.run(document.querySelector('[data-priorities]'), { resultTypes: ['violations'] }); return r.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, targets: v.nodes.slice(0, 3).map(n => n.target.join(' ')) })); });
    results.axe = axe;
    ok(`axe on the Priorities view (dots, names on): ${axe.length} violations`, axe.length === 0, JSON.stringify(axe).slice(0, 400));
    const b1 = await boxes(page);
    const mv = maxMove(b0, b1); results.n2['1440'] = mv;
    ok(`N2 1440: the Names toggle, a selection and the Bars / Dots switch move nothing above the view (max ${mv} px); 0 page errors`, mv <= 1 && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await open(390);
    const view = page.locator('[data-priorities]');
    await view.locator('.ui-list, table').first().waitFor({ timeout: 20000 }).catch(async () => { await shot(page, 'labels-debug-390'); });
    await page.waitForTimeout(600);
    const tablePressed = await view.getByRole('group', { name: 'Chart view' }).getByRole('button', { name: 'Table' }).getAttribute('aria-pressed');
    ok(`390 the table is the landing view (${tablePressed}), no dots, no sideways page scroll`, tablePressed === 'true' && (await view.locator('[data-dots-chart]').count()) === 0 && (await noScroll(page)));
    await view.getByRole('button', { name: 'Dots' }).click(); await page.waitForTimeout(900);
    const lPhone = await labelKeys(view);
    const phoneKeys = new Set(lPhone.map(l => l[0]));
    const p1OnPage = p1.filter(r => page1.some(x => x.key === r.key));
    const p1Dropped = p1OnPage.filter(r => !phoneKeys.has(r.key)).map(r => r.name);
    ok(`390 Dots (720 px card, ${Math.round(612 / Math.min(40, rows.length))} px per dot): ${lPhone.length} of the ${p1OnPage.length} P1 named and nothing else (${lPhone.map(l => l[1]).join(', ')}); dropped by the 3-step rule: ${p1Dropped.join(', ') || 'none'} - the Table (the phone landing) has them; Hilton named; no card open before a tap`,
      lPhone.length > 0 && lPhone.every(l => p1OnPage.some(r => r.key === l[0])) && lPhone.some(l => /^Hilton/.test(l[1])) && (await page.getByRole('tooltip').count()) === 0, `P1 dropped on the phone: ${p1Dropped.length}`);
    await view.locator('[data-dot]').nth(15).dispatchEvent('click'); await page.waitForTimeout(900);
    const tapKey = await view.locator('[data-dot][data-selected="true"]').getAttribute('data-dot');
    const lTap = await labelKeys(view);
    const tip = page.getByRole('tooltip');
    const tipText = (await tip.count()) ? await tip.innerText() : '';
    const tapName = lTap.find(l => l[0] === tapKey)?.[1] || '';
    ok(`390 tap: the dot is selected and named ("${tapName}"), the breakdown card stays open (${tipText.split('\n')[0]}), the card scrolls sideways inside itself, the page does not; 0 page errors`, !!tapKey && !!tapName && tipText.startsWith(tapName.replace('…', '')) && (await view.locator('[data-chart-box]').evaluate(el => getComputedStyle(el).overflowX === 'auto' && el.scrollWidth > el.clientWidth)) && (await noScroll(page)) && !errors.length, errors.join(' | '));
    await shot(page, 'labels-dots-390');
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
  console.log(`\nFIX priorities-labels-v1 live check: ${passed}/${results.checks.length} passed · N2 ${JSON.stringify(results.n2)} · axe ${results.axe ? results.axe.length : 'n/a'} · Claude 0 · Apollo 0 · writes 0\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  process.exit(passed === results.checks.length && restored && !results.errors.length ? 0 : 1);
}
