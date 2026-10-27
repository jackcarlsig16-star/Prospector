// intent-score-v1 REV2 Stage 3 live check - READ-ONLY. localhost against the build, as Jack (ownerSession) on the REAL
// HomeLover workspace. Browser: GET goals/scores is answered with a FIXTURE (12 invented companies on .example, one of
// them keyed to a real HomeLover partner so the company window opens by key) because prod has no score rows until
// Stage 4's recompute; every other request is real and GET-only - every non-GET to /api, /proxy and Supabase REST is
// ABORTED; every outside host except Supabase + Google Fonts is blocked (an Anthropic / Apollo host fails the run).
// Screens: Sales > Pipeline > Priorities at 1440 (dots, legend toggle, Y switch, selection + quick menu + company
// window, table) and 390 (table default, dots in the scrolling card); N2 = nothing above the view moves after the
// window opens and closes; no sideways scroll; 0 page errors; no "@". Three requests go through the real wiring
// (GET goals/scores, goals/compose/status, goals/scores/views). restored = HomeLover counts identical; a count()
// error THROWS. 0 Claude, 0 Apollo, 0 writes. Runtime ~1-2 min, hard cap 240 s. Shots + report:
// .screenshots/intent-score-v1/. Run npm run build first. Usage: node scripts/verify/intent-score-v1-stage3.mjs
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
const OUT = path.join(ROOT, '.screenshots', 'intent-score-v1');
const PORT = 3996, BASE = `http://localhost:${PORT}`;
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
const results = { checks: [], errors: [], n2: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 240000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));

// The fixture: 12 invented companies, every source once or twice, one hollow, one decayed, one Upside no-double-touch,
// one live; the first dot carries a REAL partner's type + id so the company window can open by key (read-only).
const realPartner = (await svc.from('sales_goals').select('id, name').eq('business_id', HL).eq('goal_type', 'partnership').is('archived_at', null).order('name').limit(1)).data?.[0] || null;
const comp = (v, p, f, r, e) => ({ visits: { points: v, inputs: {} }, pages: { points: 0, inputs: {} }, apollo_intent: { points: 0, inputs: {} }, people: { points: p, inputs: {} }, fit: { points: f, inputs: {} }, research: { points: r, inputs: {} }, source: { points: 12, inputs: {} }, engagement: { points: e, inputs: {} }, stage: { points: 0, inputs: {} }, recency: { points: 0, inputs: {} } });
const mk = (i, name, score, band, source, over = {}) => ({ type: 'target', id: `00000000-0000-4000-8000-00000000000${i.toString(16)}`, key: `target-00000000-0000-4000-8000-00000000000${i.toString(16)}`, name, score, band, source_label: source, source_kind: source, components: comp(17, 6, 15, 10, 0), owner_user_id: null, owner: null, owner_team: 'homelover', co_owner_name: null, no_double_touch: false, upside_owned: false, touch_locked: false, closed: false, live: false, duplicate_of: null, stage: 'proposed', employees: 5000, visits_7d: 6, unique_visitors_7d: 3, last_visit: '2026-10-26', people: 2, last_touch_at: '2026-10-25T00:00:00Z', last_touch_who: 'Jack', last_touch_channel: 'call', days_since_touch: 2, researched: 'fresh', research_at: '2026-10-25T00:00:00Z', prev_score: score - 5, prev_band: band, trend: 'up', band_changed: false, rank: i, ...over });
const ROWS = [
  mk(1, 'Zz Verify Loft', 88, 'P1', 'upside', realPartner ? { type: 'partner', id: realPartner.id, key: `partner-${realPartner.id}`, name: realPartner.name, days_since_touch: 1 } : {}),
  mk(2, 'Zz Harbor Example', 74, 'P1', 'partner_referral', { band_changed: true, prev_band: 'P2' }),
  mk(3, 'Zz Hilton Example', 61, 'P1', 'upside', { owner_team: 'upside', no_double_touch: true, upside_owned: true, touch_locked: true, days_since_touch: 20 }),
  mk(4, 'Zz Quarry Example', 55, 'P2', 'website', { days_since_touch: 9 }),
  mk(5, 'Zz Nimbus Example', 48, 'P2', 'campaign', { researched: 'decayed', days_since_touch: null, last_touch_at: null }),
  mk(6, 'Zz Ridge Example', 44, 'P2', 'inbound'),
  mk(7, 'Zz Cedar Example', 31, 'P3', 'person_referral', { researched: 'none', components: comp(0, 0, 4, -3, 0), employees: null }),
  mk(8, 'Zz Orchard Example', 27, 'P3', 'homelover_outreach', { employees: 120 }),
  mk(9, 'Zz Birch Example', 19, 'P3', 'scout', { days_since_touch: 40 }),
  mk(10, 'Zz Maple Example', 12, 'P4', 'other', { researched: 'none', components: comp(0, 0, 4, -3, 0), days_since_touch: null, last_touch_at: null }),
  mk(11, 'Zz Elm Example', 8, 'P4', 'upside', { closed: true }),
  mk(12, 'Zz Oak Example', 3, 'P4', 'website', { employees: null }),
];
const LIVE = [mk(13, 'Zz Live Example', 70, 'P1', 'inbound', { live: true, rank: 0 })];
const counts = { companies: 13, ranked: 12, shown: 12, live: 1, duplicates: 0, closed: 1, needs_touch: 2, band_changed: 1, P1: 3, P2: 3, P3: 3, P4: 3 };
const sources = { upside: 3, partner_referral: 1, person_referral: 1, campaign: 1, website: 2, inbound: 1, homelover_outreach: 1, scout: 1, other: 1 };
const fixture = params => {
  const src = params.get('source'); const seg = params.get('segment');
  const rows = ROWS.filter(r => (!src || src.split(',').includes(r.source_label)) && (!seg || seg === 'all' || (seg === 'partners' ? r.type === 'partner' : seg === 'targets' ? r.type === 'target' : true)));
  return { rows, live: LIVE, counts: { ...counts, shown: rows.length }, sources, owners: [], filters: {}, computed_at: new Date().toISOString(), stale: false, today: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }), has_previous: true, thresholds: { P1: 60, P2: 40, P3: 15 }, caps: { visits: 25, pages: 10, apollo_intent: 5, people: 15, fit: 15, research: 10, source: 12, engagement: 10, stage: 10, recency: 10 }, needs_touch_rule: { min: 40, days: 14 }, source_order: ['upside', 'partner_referral', 'person_referral', 'campaign', 'website', 'inbound', 'homelover_outreach', 'scout', 'other'] };
};

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const real = async p => { const r = await fetch(`${BASE}/api/sales/${HL}/goals${p}`, { headers: { cookie } }); const text = await r.text(); let body = null; try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; } return { code: r.status, body }; };
  const sc = await real('/scores');
  ok(`real wiring: GET goals/scores -> ${sc.code}; ${sc.body?.counts?.companies ?? '?'} companies scored (0 until Stage 4), rows / live / counts / sources / thresholds / caps present, stale ${sc.body?.stale}, no address`, sc.code === 200 && Array.isArray(sc.body.rows) && Array.isArray(sc.body.live) && sc.body.counts && sc.body.sources && sc.body.thresholds && sc.body.caps && !JSON.stringify(sc.body).includes('@'));
  const cs = await real('/compose/status');
  ok(`real wiring: GET goals/compose/status -> ${cs.code}; used ${cs.body?.used} of ${cs.body?.max}, estimate $${cs.body?.cost_estimate_usd}`, cs.code === 200 && typeof cs.body.used === 'number' && cs.body.max === 30);
  const vw = await real('/scores/views');
  ok(`real wiring: GET goals/scores/views -> ${vw.code}; ${vw.body?.views?.length} saved views`, vw.code === 200 && Array.isArray(vw.body.views));
  ok('real wiring: GET goals/scores/visitor/x -> 400', (await real('/scores/visitor/x')).code === 400);

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
      if (isLocal && req.method() === 'GET' && /\/goals\/scores$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture(u.searchParams)) });
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
  const boxes = page => page.evaluate(() => Object.fromEntries(['data-workspace-header', 'data-sales-tabrow', 'data-sales-subviews', 'data-filter-row', 'data-view-row'].map(a => { const el = document.querySelector(`[${a}]`); if (!el) return [a, null]; const r = el.getBoundingClientRect(); return [a, { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, h: Math.round(r.height * 10) / 10 }]; })));
  const maxMove = (a, b) => Math.max(0, ...Object.keys(a).filter(k => a[k] && b[k]).flatMap(k => [Math.abs(a[k].x - b[k].x), Math.abs(a[k].y - b[k].y), Math.abs(a[k].h - b[k].h)]));
  const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide', fullPage: true });
  const noScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  {
    const { ctx, page, errors } = await open(1440);
    const view = page.locator('[data-priorities]');
    await view.locator('[data-dot]').first().waitFor({ timeout: 20000 }); await page.waitForTimeout(800);
    const dots = await view.locator('[data-dot]').count();
    const pills = await view.locator('[data-legend-source]').count();
    const hollow = await view.locator('[data-dot][data-hollow="hollow"]').count();
    const halos = await view.locator('[data-dot][data-halo]').count();
    const rings = await view.locator('[data-dot] [data-ring]').count();
    const guides = await view.locator('[data-band-guide]').count();
    const labels = await view.locator('[data-direct-label]').count();
    const text = await view.innerText();
    ok(`1440 Dots: ${dots} dots (= 12 ranked), ${pills} legend pills, ${hollow} hollow (2 unresearched), ${halos} with a halo, ${rings} rings, ${guides} band guides with counts, ${labels} direct labels (top 5), rank line, no sideways scroll, no "@"`, dots === 12 && pills === 9 && hollow === 2 && halos >= 6 && rings > 20 && guides === 3 && labels === 5 && (await view.locator('[data-rank-line]').count()) === 1 && (await noScroll(page)) && !text.includes('@'));
    await shot(page, 'stage3-dots-1440');
    await view.locator('[data-legend-source="upside"]').click(); await page.waitForTimeout(600);
    const dimmed = await view.locator('[data-dot][data-dimmed="true"]').count();
    const threads = await view.locator('[data-thread="upside"]').count();
    const litFill = await view.locator('[data-dot][data-source="upside"] [data-core]').first().getAttribute('fill');
    const dimFill = await view.locator('[data-dot][data-source="website"] [data-core]').first().getAttribute('fill');
    ok(`1440 legend Brad / Upside: ${dimmed} dots dimmed (= 12 - 3), ${threads} threads to the 3 lit dots, every dot still present, colors kept (upside ${litFill}, website ${dimFill})`, dimmed === 9 && threads === 3 && (await view.locator('[data-dot]').count()) === 12 && litFill === 'var(--sa-src-upside)' && dimFill === 'var(--sa-src-website)');
    await shot(page, 'stage3-legend-upside-1440');
    await view.getByRole('button', { name: 'All sources' }).click(); await page.waitForTimeout(400);
    const b0 = await boxes(page);
    await view.locator('[data-dot]').first().click(); await page.waitForTimeout(800);
    const menu = page.getByRole('toolbar', { name: /^Actions for / });
    const menuText = (await menu.count()) ? await menu.innerText() : '';
    const selected = await view.locator('[data-dot][data-selected="true"]').count();
    ok(`1440 select: selection ring on the dot, the quick menu in order (Brief · Write email · Research · Assign to · Add task · Not a fit · Open)`, selected === 1 && /Brief[\s\S]*Write email[\s\S]*Research[\s\S]*Assign to[\s\S]*Add task[\s\S]*Not a fit[\s\S]*Open/.test(menuText), menuText.replace(/\s+/g, ' ').slice(0, 200));
    const panel = page.locator('[data-company-panel]');
    const opened = realPartner ? await panel.waitFor({ timeout: 20000 }).then(() => true).catch(() => false) : null;
    if (realPartner) {
      await page.locator('[data-intent-fact]').waitFor({ timeout: 10000 }).catch(() => {});
      ok(`1440 the company window opened by key for the real partner (${realPartner.name}) - Intent fact present ("No score yet" until Stage 4)`, opened && (await page.locator('[data-intent-fact]').count()) === 1 && /No score yet|· P[1-4]/.test(await page.locator('[data-intent-fact]').innerText()));
      await shot(page, 'stage3-window-1440');
      await page.keyboard.press('Escape'); await page.waitForTimeout(700);
    }
    const b1 = await boxes(page);
    await view.getByRole('button', { name: 'Size' }).click(); await page.waitForTimeout(700);
    const keptSel = await view.locator('[data-dot][data-selected="true"]').count();
    const ySize = await page.getByRole('img', { name: /Y axis Employees/ }).count();
    await view.getByRole('button', { name: 'Activity' }).click(); await page.waitForTimeout(700);
    const yAct = await page.getByRole('img', { name: /Y axis Days since last touch/ }).count();
    ok(`1440 Y switch Size then Activity: the axis label changes, the selection stays (${keptSel})`, keptSel === 1 && ySize === 1 && yAct === 1);
    await shot(page, 'stage3-activity-1440');
    await view.getByRole('button', { name: 'Intent' }).click(); await page.waitForTimeout(400);
    await view.locator('[data-dot][data-source="upside"]:not([data-selected])').first().click().catch(() => {}); await page.waitForTimeout(600);
    const lockedMenu = page.getByRole('toolbar', { name: /^Actions for Zz Hilton Example/ });
    if (await lockedMenu.count()) {
      const disabled = await lockedMenu.locator('button[disabled]').count();
      ok(`1440 Upside no-double-touch row: ${disabled} touching actions disabled (Write email, Assign, Add task) with the reason, the Upside chip shown`, disabled === 3 && (await lockedMenu.locator('[data-upside-chip]').count()) === 1);
    } else ok('1440 Upside no-double-touch row reachable', false, 'could not select the Hilton fixture dot');
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    await view.getByRole('button', { name: 'Table' }).click(); await page.waitForTimeout(800);
    const table = view.getByRole('table');
    const tableOk = (await table.count()) === 1 && (await table.getByRole('columnheader', { name: 'Source' }).count()) === 1 && (await table.getByText(/Live · closed-won or pilot/).count()) === 1;
    ok('1440 Table view: Source column, the Live group, no sideways scroll', tableOk && (await noScroll(page)));
    await shot(page, 'stage3-table-1440');
    await view.getByRole('button', { name: 'Dots' }).click(); await page.waitForTimeout(600);
    const b2 = await boxes(page);
    const mv = Math.max(maxMove(b0, b1), maxMove(b0, b2)); results.n2['1440'] = mv;
    ok(`N2 1440: opening and closing the window and switching views moves nothing above the view (max ${mv} px); 0 page errors`, mv <= 1 && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await open(390);
    const view = page.locator('[data-priorities]');
    await view.locator('.ui-list, table').first().waitFor({ timeout: 20000 }).catch(async () => { await shot(page, 'stage3-debug-390'); });
    await page.waitForTimeout(600);
    const listRows = await view.locator('.ui-list [data-row-name], table [data-row-name]').count();
    ok(`390 the table (phone list, ${listRows} rows incl. Live) is the default view on a phone, no dots, no sideways page scroll, no "@"`, listRows === 13 && (await view.locator('[data-dots-chart]').count()) === 0 && (await noScroll(page)) && !(await view.innerText()).includes('@'));
    await shot(page, 'stage3-table-390');
    await view.getByRole('button', { name: 'Dots' }).click(); await page.waitForTimeout(800);
    const card = view.locator('[data-chart-box]');
    const scrollsInside = await card.evaluate(el => getComputedStyle(el).overflowX === 'auto' && el.scrollWidth > el.clientWidth);
    ok(`390 Dots: ${await view.locator('[data-dot]').count()} dots inside a sideways-scrolling card, the page itself never scrolls sideways; 0 page errors`, (await view.locator('[data-dot]').count()) === 12 && scrollsInside && (await noScroll(page)) && !errors.length, errors.join(' | '));
    await shot(page, 'stage3-dots-390');
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
  fs.writeFileSync(path.join(OUT, 'stage3-report.json'), JSON.stringify({ ...results, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\nintent-score-v1 Stage 3 live check: ${passed}/${results.checks.length} passed · N2 ${JSON.stringify(results.n2)} · Claude 0 · Apollo 0 · writes 0\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  process.exit(passed === results.checks.length && restored && !results.errors.length ? 0 : 1);
}
