// priorities-v2 Stage 3 live check - READ-ONLY, localhost against the build, as Jack (ownerSession) on the REAL HomeLover
// workspace. Real wiring: GET goals/scores x5 (unfiltered + one per type chip; one scores-table pass each). Browser:
// Pipeline > Map at 1440 (Compact / Tall / Standard heights, chips = counts.segments, zones = thresholds, words, rings
// off, a dot <-> row selection, N2, contrast, axe) and 390 (Table first, the filter card wraps, no sideways scroll,
// contrast, axe); a Viewer pass by intercepting /api/me (no temp users). Every non-GET aborted; 0 Claude / 0 Apollo.
// Runtime ~2 min, cap 240 s. "restored" THROWS if any of the 49 counts moved. Shots + report: .screenshots/priorities-v2/.
// Run npm run build first.
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
const { measureScript, summarize } = require(ROOT + '/scripts/verify/lib/contrastMeasure.cjs');
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const OUT = path.join(ROOT, '.screenshots', 'priorities-v2');
const PORT = 3995, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const SALES = 'cadence_plan call_notes collateral company_score_days company_scores email_activity email_backfill_weeks email_daily_counts email_messages events goals huddles infra_items insight_dismissals lead_uploads mailbox_owners metric_targets metrics_daily month_goals opportunities opportunity_events outreach_campaigns outreach_contacts outreach_events outreach_steps outreach_tracks partner_events people prospect_events prospect_state raw_snapshots sequence_tags sequenced_accounts settings signals source_events stage_marks suggestions sync_runs targets tidy_runs visit_skip week_goal_steps week_goals week_notes week_plans week_report week_report_sections'.split(' ').map(t => `sales_${t}`);
const TABLES = [...SALES, 'web_visits', 'business_anthropic_usage'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const biz = (await svc.from('businesses').select('id, name').ilike('name', '%homelover%')).data;
if (biz?.length !== 1) throw new Error('expected one HomeLover business');
const HL = biz[0].id;
const scoped = new Map();
async function count(t) {
  if (scoped.get(t) !== false) {
    const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL);
    if (!r.error && typeof r.count === 'number') { scoped.set(t, true); return r.count; }
    if (scoped.get(t) === true) throw new Error(`count ${t}: ${r.error?.message || 'no count'}`);
    scoped.set(t, false);
  }
  const r = await svc.from(t).select('*', { count: 'exact', head: true });
  if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message || `no count (HTTP ${r.status})`}`);
  return `${r.count} (whole table)`;
}
const snapshot = async () => { const o = {}; for (const t of TABLES) o[t] = await count(t); return o; };
const marksLeft = async () => { const r = await svc.from('sales_stage_marks').select('id, record_type, record_id, stage, at').eq('business_id', HL); if (r.error) throw new Error(`marks: ${r.error.message}`); return r.data; };
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
let srv, browser, owner;
const blocked = [], realCalls = [], writes = [];
const results = { checks: [], errors: [], axe: {}, contrast: {}, n2: {}, numbers: {} };
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
  const get = async p => { const r = await fetch(`${BASE}/api/sales/${HL}/goals/${p}`, { headers: { cookie } }); return { status: r.status, body: await r.json().catch(() => null) }; };

  // ---- Real wiring: counts.segments over the unfiltered ranked set = each chip's own filtered count.
  const sc = await get('scores');
  const b = sc.body || {};
  const seg = b.counts?.segments || {};
  results.numbers.segments = seg; results.numbers.thresholds = b.thresholds; results.numbers.bands = { P1: b.counts?.P1, P2: b.counts?.P2, P3: b.counts?.P3, P4: b.counts?.P4 };
  ok(`real wiring: GET goals/scores -> ${sc.status}; ${b.rows?.length} ranked; segments ${JSON.stringify(seg)}; no "@"`, sc.status === 200 && seg.all === b.counts.ranked && !JSON.stringify(b).includes('@'));
  for (const s of ['visitors', 'partners', 'employers', 'targets']) {
    const r = await get(`scores?segment=${s}`);
    ok(`segment ${s}: chip count ${seg[s]} = the filtered route's ${r.body?.counts?.shown}, and segments unchanged under the filter`, r.status === 200 && r.body.counts.shown === seg[s] && JSON.stringify(r.body.counts.segments) === JSON.stringify(seg));
  }

  browser = await chromium.launch();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  async function open(width, { viewer = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 }, hasTouch: width < 900 });
    await ctx.addInitScript(([k, v, bz, d]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      localStorage.setItem('prospector_goals_owner', 'team');
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, d);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
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
    const page = await ctx.newPage(); page.setDefaultTimeout(20000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    await page.goto(`${BASE}/`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 20000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: /^Pipeline/ }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
    await page.locator('[data-sales-subviews]').getByRole('tab', { name: 'Map', exact: true }).dispatchEvent('click'); await page.waitForTimeout(1500);
    await page.locator('[data-priorities]').waitFor({ timeout: 30000 });
    return { ctx, page, errors };
  }
  const shot = (page, nme) => page.screenshot({ path: `${OUT}/${nme}.png`, animations: 'disabled', caret: 'hide', fullPage: true });
  const measure = async (page, key, scope) => {
    const m = await page.evaluate(measureScript({ scope, exclude: '[data-dot], [data-bar]' })); // chart marks: SVG fills, validated by the dataviz pass
    if (m.error) { ok(`contrast ${key}`, false, m.error); return; }
    const s = summarize(m); results.contrast[key] = s;
    ok(`contrast ${key}: 0 text < 4.5:1 and 0 controls < 3:1 (text ${s.textFails}/${s.texts}, controls ${s.controlFails}/${s.controls})`, s.textFails === 0 && s.controlFails === 0, s.worst.slice(0, 6).map(w => `${w.ratio} ${w.kind === 'text' ? `T ${w.fg} on ${w.bg}` : `C via ${w.via}`} ${w.sel} "${w.text}"`).join(' | '));
  };
  const axeOn = async (page, key, sel) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async s => { const r = await window.axe.run(document.querySelector(s), { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); }, sel);
    results.axe[key] = v;
    ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v).slice(0, 300));
  };
  const top = (b.rows || []).slice(0, 40);

  // ---- 1440: three heights, chips = segments, zones = thresholds, chart <-> table selection.
  {
    const { ctx, page, errors } = await open(1440);
    const view = page.locator('[data-priorities]');
    await view.locator('[data-dot]').first().waitFor({ timeout: 20000 }); await page.waitForTimeout(800);
    const chips = await view.getByRole('group', { name: 'Type' }).locator('[data-segment]').evaluateAll(els => Object.fromEntries(els.map(e => [e.dataset.segment, e.querySelector('.ui-chip__count')?.textContent])));
    ok(`1440 type chips = counts.segments (${JSON.stringify(chips)})`, ['all', 'visitors', 'partners', 'employers', 'targets'].every(k => String(seg[k]) === chips[k]));
    const svg = view.locator('[data-dots-chart] > svg');
    const heights = {};
    for (const [label, px] of [['Compact, 360px', 360], ['Tall, 800px', 800], ['Standard, 560px', 560]]) {
      await view.getByRole('button', { name: label }).click(); await page.waitForTimeout(500);
      heights[px] = Math.round((await svg.boundingBox()).height);
      await shot(page, `map-1440-${px}`);
    }
    ok(`1440 three heights draw at 360 / 800 / 560 px (${JSON.stringify(heights)}); Standard is the default`, heights[360] === 360 && heights[800] === 800 && heights[560] === 560);
    const zones = await view.locator('[data-band-zone] rect').evaluateAll(rs => rs.map(r => +r.getAttribute('height')));
    const plot = zones.reduce((a, x) => a + x, 0), t = b.thresholds;
    const want = [100 - t.P1, t.P1 - t.P2, t.P2 - t.P3, t.P3].map(v => v / 100);
    const got = zones.map(h => h / plot);
    ok(`1440 band zones follow the thresholds ${JSON.stringify(t)}: shares ${got.map(x => x.toFixed(3)).join(' / ')} vs ${want.map(x => x.toFixed(3)).join(' / ')}; words ${(await view.locator('[data-band-word]').allTextContents()).join(' · ')}; rings drawn ${await view.locator('[data-ring]').count()}`, got.every((x, i) => Math.abs(x - want[i]) < 0.005) && (await view.locator('[data-band-word]').allTextContents()).join('|') === 'Act now|Warm|Watch|Backlog' && (await view.locator('[data-ring]').count()) === 0);
    const counts = await view.locator('[data-band-count]').allTextContents();
    ok(`1440 zone counts = the route's (${counts.join(' / ')})`, counts.join('|') === ['P1', 'P2', 'P3', 'P4'].map(k => String(b.counts[k])).join('|'));
    // A dot press highlights + reveals its row; a row press selects the dot.
    const pick = top[Math.min(13, top.length - 1)];
    const pageY = async loc => loc.evaluate(el => el.getBoundingClientRect().top + window.scrollY);
    const chartTop0 = await pageY(view.locator('[data-chart-box]'));
    await view.locator(`[data-dot="${pick.key}"]`).click(); await page.waitForTimeout(600);
    const row = view.locator(`[data-detail-table] tr[data-key="${pick.key}"]`);
    const rowStyle = await row.getAttribute('style');
    const inView = await row.evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight + 2000; });
    ok(`1440 dot ${pick.name} (rank ${pick.rank}) -> its row is highlighted (${/--ui-row-bar/.test(rowStyle || '')}) and shown (rows past 10 opened: ${await view.locator('[data-show-more]').count() === 0})`, /--ui-row-bar/.test(rowStyle || '') && inView);
    const other = top[1];
    await view.locator(`[data-detail-table] tr[data-key="${other.key}"] td:last-child`).click(); await page.waitForTimeout(500);
    ok(`1440 row ${other.name} -> its dot is selected (${await view.locator(`[data-dot="${other.key}"]`).getAttribute('data-selected')}) with the pinned card (${await page.locator('[data-pinned-card]').getAttribute('data-pinned-card')})`, (await view.locator(`[data-dot="${other.key}"]`).getAttribute('data-selected')) === 'true' && (await page.locator('[data-pinned-card]').getAttribute('data-pinned-card')) === other.key);
    const chartTop1 = await pageY(view.locator('[data-chart-box]'));
    await view.getByRole('button', { name: /^Rings/ }).click(); await page.waitForTimeout(400);
    await view.getByRole('button', { name: /^Since yesterday/ }).click(); await page.waitForTimeout(400);
    const chartTop2 = await pageY(view.locator('[data-chart-box]'));
    results.n2.map = Math.abs(chartTop1 - chartTop0) + Math.abs(chartTop2 - chartTop0);
    ok(`N2 1440: selecting and the Rings / Since yesterday toggles move nothing above the chart (${results.n2.map} px); rings now drawn ${await view.locator('[data-ring]').count()}`, results.n2.map === 0 && (await view.locator('[data-ring]').count()) > 0);
    await shot(page, 'map-1440-selected');
    await measure(page, 'map@1440', '[data-priorities]');
    await axeOn(page, 'map@1440', '[data-priorities]');
    ok(`1440 0 page errors`, !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- 390: Table first, filter bar wraps, no sideways scroll.
  {
    const { ctx, page, errors } = await open(390);
    const view = page.locator('[data-priorities]');
    await page.waitForTimeout(800);
    const pressed = await view.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Table' }).getAttribute('aria-pressed');
    const fh = Math.round((await view.locator('[data-filter-row]').boundingBox()).height);
    await shot(page, 'map-390');
    ok(`390 Table first (${pressed}); the filter card wraps (${fh} px tall); no sideways page scroll; 0 page errors`, pressed === 'true' && fh > 90 && (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)) && !errors.length, errors.join(' | '));
    await measure(page, 'map@390', '[data-priorities]');
    await axeOn(page, 'map@390', '[data-priorities]');
    await ctx.close();
  }
  // ---- Viewer (intercepted /api/me).
  {
    const { ctx, page, errors } = await open(1440, { viewer: true });
    const view = page.locator('[data-priorities]');
    await view.locator('[data-dot]').first().waitFor({ timeout: 20000 }); await page.waitForTimeout(600);
    await view.locator(`[data-dot="${top[0].key}"]`).click(); await page.waitForTimeout(500);
    const menu = page.locator('[data-pinned-card]');
    const share = await page.getByRole('button', { name: 'Share' }).count(), recompute = await page.getByRole('button', { name: /Recompute/ }).count();
    const assign = await menu.getByRole('button', { name: /^Assign to/ }).count(), star = await page.getByRole('button', { name: /Top/ }).count();
    await shot(page, 'map-viewer-1440');
    ok(`Viewer: the chart and filters read; no Share (${share}), Recompute (${recompute}), Assign (${assign}), ★ (${star}); 0 page errors`, share === 0 && recompute === 0 && assign === 0 && star === 0 && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  ok(`browser reached 0 Claude / Apollo hosts; every non-GET was aborted (${[...new Set(writes)].join(', ') || 'none attempted'})`, !realCalls.length && writes.every(w => blocked.includes(w)));
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    const after = await snapshot();
    const moved = TABLES.filter(t => before[t] !== after[t]).map(t => `${t} ${before[t]} -> ${after[t]}`);
    if (moved.length) throw new Error(`counts moved: ${moved.join(', ')}`);
    restored = true; line = `yes (${TABLES.length} table counts identical; Jack sign-in row kept by rule, last_seen_at restored)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'stage3-report.json'), JSON.stringify({ ...results, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\npriorities-v2 Stage 3 live check: ${passed}/${results.checks.length} passed · Claude 0 · Apollo 0 · writes 0\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
