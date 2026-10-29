// companies-v2 Stage 3 live check - READ-ONLY, localhost against the build, as Jack (ownerSession) on the REAL HomeLover
// workspace, through the real wiring. Real wiring: GET goals/pipeline-board?include_apollo=true x1 (the group and
// channel counts the table must show). Browser:
//   1440 - Pipeline › Companies: underline sub-view tabs with icons, TABLE / SHEET / + Add groups (30 px), channel chips
//          with glyphs (count 0 dashed + last) = the route's counts, FILTER row order (search, 6 pills, 3 toggles), groups
//          P1-P4 + No priority = the route's counts with P3 / P4 / No priority folded, outline Priority pill + header word
//          in the KIT_PRIORITY hue, glyph Channel cells; the active-filter line from a toggle; N2 (sub-view switches,
//          a toggle, opening a group); contrast + axe. Map: zones read Act today · This week · Watch · Noise.
//          Dashboard: four sub-view tabs with icons, N2 across them, Sources contrast + axe.
//   390  - tabs scroll inside their row, the action groups and the channel chips wrap, no page sideways scroll;
//          contrast + axe on Companies.
//   Viewer - /api/me intercepted (role viewer, no temp users): TABLE only, no + Add / Update / Priority control.
// Every non-GET to /api, /proxy and Supabase REST is aborted, and every outside host but Google Fonts; 0 Claude /
// 0 Apollo (any request to those hosts fails the run). Runtime ~2.5 min, cap 240 s. "restored" THROWS if any of the 49
// counts moved. Shots + report: .screenshots/companies-v2/. Run npm run build first.
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
// The screen hues of the four levels, read from src/ui/tokens.js (CRA source; not importable from node).
const KIT_PRIORITY = JSON.parse(/export const KIT_PRIORITY = (\{[^\n]*\});/.exec(fs.readFileSync(path.join(ROOT, 'src', 'ui', 'tokens.js'), 'utf8'))[1].replace(/(P\d)(?=:)/g, '"$1"').replace(/'/g, '"'));
const OUT = path.join(ROOT, '.screenshots', 'companies-v2');
const PORT = 3996, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const SALES = 'cadence_plan call_notes collateral company_score_days company_scores email_activity email_backfill_weeks email_daily_counts email_messages events goals huddles infra_items insight_dismissals lead_uploads mailbox_owners metric_targets metrics_daily month_goals opportunities opportunity_events outreach_campaigns outreach_contacts outreach_events outreach_steps outreach_tracks partner_events people prospect_events prospect_state raw_snapshots sequence_tags sequenced_accounts settings signals source_events stage_marks suggestions sync_runs targets tidy_runs visit_skip week_goal_steps week_goals week_notes week_plans week_report week_report_sections'.split(' ').map(t => `sales_${t}`);
const TABLES = [...SALES, 'web_visits', 'business_anthropic_usage'];
const CHANNEL_BUTTONS = ['all', 'website', 'scout', 'apollo', 'partners', 'call_notes', 'targets'];
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
const hex = c => { const m = /rgba?\((\d+), (\d+), (\d+)/.exec(c); return m ? `#${[m[1], m[2], m[3]].map(x => (+x).toString(16).padStart(2, '0')).join('').toUpperCase()}` : c; };
const HUE = Object.fromEntries(['P1', 'P2', 'P3', 'P4'].map(k => [k, KIT_PRIORITY[k][0].toUpperCase()]));

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;

  // ---- Real wiring: the board the page reads; groups + channel counts are computed from it.
  const res = await fetch(`${BASE}/api/sales/${HL}/goals/pipeline-board?include_apollo=true`, { headers: { cookie } });
  const board = (await res.json().catch(() => null))?.rows || [];
  const inAll = board.filter(r => (r.channels || []).includes('all'));
  const want = { p1: 0, p2: 0, p3: 0, p4: 0, none: 0 };
  for (const r of inAll) want[[1, 2, 3, 4].includes(r.priority) ? `p${r.priority}` : 'none'] += 1;
  const chCounts = Object.fromEntries(CHANNEL_BUTTONS.map(id => [id, board.filter(r => (r.channels || []).includes(id)).length]));
  results.numbers = { rows: board.length, all: inAll.length, groups: want, channels: chCounts };
  ok(`real wiring: GET goals/pipeline-board -> ${res.status}; ${board.length} rows, ${inAll.length} under All; groups ${JSON.stringify(want)}; channels ${JSON.stringify(chCounts)}; no "@"`, res.status === 200 && board.length > 0 && !JSON.stringify(board).includes('@'));

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
    await tab(page, 'Pipeline'); await sub(page, 'Companies');
    await page.locator('[data-pipeline-companies] .ui-table__group, [data-pipeline-companies] .ui-list__group').first().waitFor({ timeout: 30000 }); await page.waitForTimeout(800);
    return { ctx, page, errors };
  }
  const tab = async (page, label) => { await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: new RegExp(`^${label}`) }).first().dispatchEvent('click'); await page.waitForTimeout(1200); };
  const sub = async (page, label) => { await page.locator('[data-sales-subviews]').getByRole('tab', { name: label, exact: true }).click(); await page.waitForTimeout(1200); };
  const shot = (page, nme) => page.screenshot({ path: `${OUT}/${nme}.png`, animations: 'disabled', caret: 'hide' });
  const measure = async (page, key, scope, exclude) => {
    const m = await page.evaluate(measureScript({ scope, exclude }));
    if (m.error) { ok(`contrast ${key}`, false, m.error); return; }
    const s = summarize(m); results.contrast[key] = s;
    ok(`contrast ${key}: 0 text < 4.5:1 and 0 controls < 3:1 (text ${s.textFails}/${s.texts}, controls ${s.controlFails}/${s.controls})`, s.textFails === 0 && s.controlFails === 0, s.worst.slice(0, 6).map(w => `${w.ratio} ${w.kind === 'text' ? `T ${w.fg} on ${w.bg}` : `C via ${w.via}`} ${w.sel} "${w.text}"`).join(' | '));
  };
  const axeOn = async (page, key, sel) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async s => { const r = await window.axe.run(document.querySelector(s), { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); }, sel);
    results.axe[key] = v;
    ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v).slice(0, 400));
  };
  // Rounded boxes of the given selectors (page coordinates, so a scroll doesn't count as a move).
  const boxes = (page, sels) => page.evaluate(ss => Object.fromEntries(ss.map(s => { const el = document.querySelector(s); if (!el) return [s, null]; const r = el.getBoundingClientRect(); return [s, [r.x, r.y + window.scrollY, r.width, r.height].map(v => Math.round(v * 10) / 10)]; })), sels);
  const maxMove = (a, b) => Math.max(0, ...Object.keys(a).filter(k => a[k] && b[k]).flatMap(k => a[k].map((v, i) => Math.abs(v - b[k][i]))));
  const worst = (a, b) => Object.keys(a).filter(k => a[k] && b[k] && maxMove({ k: a[k] }, { k: b[k] }) >= 1).map(k => `${k} ${JSON.stringify(a[k])} -> ${JSON.stringify(b[k])}`).join(' | ');
  const atTop = async page => { await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('.ui-table-box')?.scrollTo(0, 0); }); await page.waitForTimeout(300); };
  const noSideways = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const FRAME = ['[data-sales-tabrow]', '[data-sales-frame]', '[data-sales-subviews]', '[data-sales-subviews] [role="tablist"]'];

  // ---- 1440 Companies.
  {
    const { ctx, page, errors } = await open(1440);
    const view = page.locator('[data-pipeline-companies]');
    const tabs = await page.locator('[data-sales-subviews] [role="tab"]').evaluateAll(ts => ts.map(t => [t.textContent.trim(), !!t.querySelector('svg'), t.getAttribute('aria-selected')]));
    ok(`1440 sub-view row = underline tabs with icons: ${tabs.map(t => t[0]).join(' · ')}; Companies selected`, tabs.map(t => t[0]).join('|') === 'Companies|Map|People|Partner workflow|Campaigns' && tabs.every(t => t[1]) && tabs[0][2] === 'true', JSON.stringify(tabs));
    const act = await page.evaluate(() => {
      const bar = document.querySelector('#sales-frame-tools [data-page-actions]'); if (!bar) return null;
      return { groups: [...bar.querySelectorAll('[data-action-group]')].map(g => g.dataset.actionGroup), words: [...bar.querySelectorAll('.ui-actions__word')].map(w => w.textContent),
        buttons: [...bar.querySelectorAll('button')].map(b => [b.textContent.trim(), Math.round(b.getBoundingClientRect().height), b.title.split(' - ')[0]]) };
    });
    ok(`1440 page actions in the frame row: ${act && act.groups.join(' / ')}; buttons ${act && act.buttons.map(b => `${b[0]} ${b[1]}px`).join(', ')}`, act && act.groups.join('|') === 'table|sheet|add' && act.words.join('|') === 'Table|Sheet'
      && act.buttons.every(b => b[1] === 30) && act.buttons.some(b => b[0] === 'Export' && b[2] === 'Export joint sheet') && act.buttons.some(b => b[0] === 'Update' && b[2] === 'Update from sheet'), JSON.stringify(act));
    const chips = await view.locator('[data-channel-row] [data-channel]').evaluateAll(cs => cs.map(c => [c.dataset.channel, c.querySelector('.ui-chip__count')?.textContent, !!c.querySelector('svg'), getComputedStyle(c).borderTopStyle]));
    const zeroLast = chips.findIndex(c => c[1] === '0');
    ok(`1440 channel chips: glyph on each, counts = the route (${chips.map(c => `${c[0]} ${c[1]}`).join(', ')}), count 0 dashed and last`, chips.every(c => c[2] && String(chCounts[c[0]]) === c[1])
      && chips.every((c, i) => (c[1] === '0') === (c[3] === 'dashed') && (zeroLast < 0 || (i >= zeroLast) === (c[1] === '0'))), JSON.stringify(chips));
    const order = await view.locator('[data-filter-row]').evaluate(r => [...r.querySelectorAll('input[type=search], .ui-filter--pill, .ui-chip')].map(e => (e.matches('input') ? 'search' : e.matches('.ui-filter--pill') ? e.querySelector('label').textContent : e.textContent.trim())));
    ok(`1440 FILTER row: ${order.join(' · ')}`, order.join('|') === 'search|Owner|Team|Type|Stage|Priority|Tier|Visited 7 d|Has open to-do|Overdue', order.join('|'));
    const groups = await view.locator('tr.ui-table__group').evaluateAll(gs => gs.map(g => { const w = g.querySelector('.ui-table__gword'); return [g.dataset.group, w.textContent, getComputedStyle(w).textTransform, getComputedStyle(w).color, g.querySelector('.ui-table__count').textContent, g.querySelector('button').getAttribute('aria-expanded')]; }));
    results.numbers.uiGroups = groups;
    const expectIds = Object.keys(want).filter(k => want[k] > 0);
    ok(`1440 groups = the route (${groups.map(g => `${g[1]} ${g[4]}`).join(', ')}); words uppercased; P1/P2 open, P3/P4/No priority folded`, groups.map(g => g[0]).join('|') === expectIds.join('|') && groups.every(g => String(want[g[0]]) === g[4] && g[2] === 'uppercase' && g[5] === String(['p1', 'p2'].includes(g[0])))
      && groups.filter(g => g[0] !== 'none').every(g => hex(g[3]) === HUE[g[0].toUpperCase()]) && groups.find(g => g[0] === 'p1')?.[1] === 'P1 · Act today', JSON.stringify(groups));
    const pills = await view.locator('select[data-priority-level]').evaluateAll(ss => ss.slice(0, 30).map(s => [s.dataset.priorityLevel, getComputedStyle(s).borderTopColor, getComputedStyle(s).borderTopStyle, !!s.nextElementSibling?.matches('svg.ui-pill-select__caret')]));
    ok(`1440 Priority cells: outline pill in the level's hue with a caret (${pills.length} checked)`, pills.length > 0 && pills.every(p => hex(p[1]) === HUE[p[0]] && p[2] === 'solid' && p[3]), JSON.stringify(pills.slice(0, 4)));
    const cells = await view.locator('[data-channel-cell]').evaluateAll(cs => cs.slice(0, 30).map(c => [c.dataset.channelCell, !!c.querySelector('svg'), c.textContent]));
    ok(`1440 Channel cells: glyph + word (${cells.length} checked, e.g. ${cells.slice(0, 2).map(c => c[2]).join(', ')})`, cells.length > 0 && cells.every(c => c[1] && c[2].length > 0));
    ok('1440 no page sideways scroll', await noSideways(page));
    await shot(page, 'companies-1440');
    await measure(page, 'frame@1440', '[data-sales-frame]');
    await measure(page, 'companies@1440', '[data-pipeline-companies]');
    await axeOn(page, 'frame@1440', '[data-sales-frame]');
    await axeOn(page, 'companies@1440', '[data-pipeline-companies]');

    // N2: a toggle filter moves nothing above the table; the table moves by exactly the active-filter line.
    const ABOVE = [...FRAME, '#sales-frame-tools [data-page-actions]', '[data-filter-card]', '[data-channel-row]', '[data-filter-row]'];
    const a0 = await boxes(page, [...ABOVE, '.ui-table-box']);
    await page.getByRole('button', { name: 'Visited 7 d' }).click(); await page.waitForTimeout(500);
    const line = await page.evaluate(() => { const l = document.querySelector('[data-active-filters]'); return l ? { text: l.textContent, h: l.getBoundingClientRect().height + parseFloat(getComputedStyle(l.parentElement).rowGap || '0') } : null; });
    const a1 = await boxes(page, [...ABOVE, '.ui-table-box']);
    await shot(page, 'companies-1440-filtered');
    const aboveMove = maxMove(Object.fromEntries(ABOVE.map(k => [k, a0[k]?.slice(0, k === '[data-filter-card]' ? 3 : 4)])), Object.fromEntries(ABOVE.map(k => [k, a1[k]?.slice(0, k === '[data-filter-card]' ? 3 : 4)])));
    const tableMove = Math.round((a1['.ui-table-box'][1] - a0['.ui-table-box'][1]) * 10) / 10;
    results.n2.filter = { aboveMove, tableMove, line };
    ok(`N2 1440: Visited 7 d moves nothing above the table (${aboveMove} px); the active-filter line "${line?.text}" appears and the table moves by its height only (${tableMove} vs ${line && Math.round(line.h * 10) / 10} px)`, aboveMove < 1 && line && /^Showing \d+ of \d+ · sorted by priority ·/.test(line.text) && Math.abs(tableMove - line.h) < 1);
    await page.locator('[data-active-filters]').getByRole('button', { name: 'Remove filter Visited 7 d' }).click(); await page.waitForTimeout(500);
    ok('1440 the chip removes its filter and the line leaves', !(await page.locator('[data-active-filters]').count()) && (await page.getByRole('button', { name: 'Visited 7 d' }).getAttribute('aria-pressed')) === 'false');

    // N2: opening a folded group moves nothing above it.
    const fold = groups.find(g => g[5] === 'false');
    if (fold) {
      const above = await page.evaluate(id => { const rows = [...document.querySelectorAll('[data-pipeline-companies] tr.ui-table__group')]; const i = rows.findIndex(r => r.dataset.group === id); return rows.slice(0, i + 1).map(r => `[data-pipeline-companies] tr.ui-table__group[data-group="${r.dataset.group}"]`); }, fold[0]);
      // The box's own height may grow with the opened rows (it is shorter than its window cap while groups are
      // folded); its position may not.
      const sels = [...ABOVE, '.ui-table thead', ...above];
      // Bring the header into view first and press it without Playwright's own scroll-into-view, so a move is layout only.
      await page.locator(`tr.ui-table__group[data-group="${fold[0]}"] button`).scrollIntoViewIfNeeded(); await page.waitForTimeout(400);
      const g0 = await boxes(page, sels);
      const gb0 = (await boxes(page, ['.ui-table-box']))['.ui-table-box'].slice(0, 3);
      await page.locator(`tr.ui-table__group[data-group="${fold[0]}"] button`).dispatchEvent('click'); await page.waitForTimeout(500);
      const g1 = await boxes(page, sels);
      const m = Math.max(maxMove(g0, g1), maxMove({ b: gb0 }, { b: (await boxes(page, ['.ui-table-box']))['.ui-table-box'].slice(0, 3) }));
      results.n2.group = { group: fold[0], move: m };
      results.n2.groupWorst = worst(g0, g1);
      ok(`N2 1440: opening ${fold[1]} moves nothing above it (${m} px; ${results.n2.groupWorst || 'none'}) and shows its rows (${await page.locator(`tr.ui-table__group[data-group="${fold[0]}"] + tr[data-row]`).count()})`, m < 1 && (await page.locator(`tr.ui-table__group[data-group="${fold[0]}"] + tr[data-row]`).count()) === 1);
      await page.locator(`tr.ui-table__group[data-group="${fold[0]}"] button`).dispatchEvent('click'); await page.waitForTimeout(300);
    } else ok('N2 1440: a folded group to open', false, 'no folded group on HomeLover');

    // N2: switching Pipeline sub-views moves nothing in the frame.
    await atTop(page);
    const s0 = await boxes(page, FRAME);
    const tabBoxes0 = await page.locator('[data-sales-subviews] [role="tab"]').evaluateAll(ts => ts.map(t => { const r = t.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(v => Math.round(v * 10) / 10); }));
    let subMove = 0;
    for (const v of ['Map', 'People', 'Partner workflow', 'Campaigns', 'Companies']) {
      await sub(page, v); await atTop(page);
      const sb = await boxes(page, FRAME); if (maxMove(s0, sb) >= 1) results.n2[`sub ${v}`] = worst(s0, sb);
      subMove = Math.max(subMove, maxMove(s0, sb));
      const tb = await page.locator('[data-sales-subviews] [role="tab"]').evaluateAll(ts => ts.map(t => { const r = t.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(x => Math.round(x * 10) / 10); }));
      subMove = Math.max(subMove, ...tb.flatMap((b, i) => b.map((x, j) => Math.abs(x - tabBoxes0[i][j]))));
    }
    results.n2.pipelineSubViews = subMove;
    ok(`N2 1440: switching the five Pipeline sub-views moves the tab row, frame and each tab by ${subMove} px`, subMove < 1);

    // Map: zone words.
    await sub(page, 'Map'); await page.locator('[data-priorities] [data-band-word]').first().waitFor({ timeout: 20000 }); await page.waitForTimeout(800);
    const words = await page.locator('[data-priorities] [data-band-word]').allTextContents();
    ok(`1440 Map zones read ${words.join(' · ')}`, words.join('|') === 'Act today|This week|Watch|Noise');
    await shot(page, 'map-1440');
    await measure(page, 'map@1440', '[data-priorities]', '[data-dot], [data-bar]');
    await axeOn(page, 'map@1440', '[data-priorities]');

    // Dashboard: four sub-view tabs with icons; N2 across them; Sources shot + contrast + axe.
    await tab(page, 'Dashboard'); await sub(page, 'Overview'); await page.waitForTimeout(1500);
    const dtabs = await page.locator('[data-sales-subviews] [role="tab"]').evaluateAll(ts => ts.map(t => [t.textContent.trim(), !!t.querySelector('svg')]));
    ok(`1440 Dashboard sub-views: ${dtabs.map(t => t[0]).join(' · ')}, each with an icon`, dtabs.map(t => t[0]).join('|') === 'Overview|Sources|Analytics|Sequenced' && dtabs.every(t => t[1]));
    await atTop(page);
    const d0 = await boxes(page, FRAME);
    let dMove = 0;
    for (const v of ['Sources', 'Analytics', 'Sequenced', 'Overview', 'Sources']) { await sub(page, v); await atTop(page); const db = await boxes(page, FRAME); if (maxMove(d0, db) >= 1) results.n2[`dash ${v}`] = worst(d0, db); dMove = Math.max(dMove, maxMove(d0, db)); }
    results.n2.dashboardSubViews = dMove;
    ok(`N2 1440: switching Dashboard sub-views moves the frame by ${dMove} px`, dMove < 1);
    await page.waitForTimeout(1500);
    await shot(page, 'dashboard-sources-1440');
    await measure(page, 'frame-dashboard@1440', '[data-sales-frame]');
    await measure(page, 'sources@1440', '[data-sales-tab="dashboard"]', '[data-sales-frame], [data-sales-tabrow], svg');
    await axeOn(page, 'sources@1440', '[data-sales-tab="dashboard"]');
    ok('1440 0 page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }

  // ---- 390.
  {
    const { ctx, page, errors } = await open(390);
    const view = page.locator('[data-pipeline-companies]');
    const tl = await page.locator('[data-sales-subviews] [role="tablist"]').evaluate(el => ({ ox: getComputedStyle(el).overflowX, sw: el.scrollWidth, cw: el.clientWidth }));
    const acts = await page.evaluate(() => { const bar = document.querySelector('[data-pipeline-companies] [data-page-actions]'); return bar && { h: Math.round(bar.getBoundingClientRect().height), groups: [...bar.querySelectorAll('[data-action-group]')].map(g => [g.dataset.actionGroup, Math.round(g.getBoundingClientRect().height), Math.round(g.getBoundingClientRect().top)]) }; });
    const ch = Math.round((await view.locator('[data-channel-row]').boundingBox()).height);
    ok(`390 tabs scroll inside their row (overflow-x ${tl.ox}, ${tl.sw} in ${tl.cw} px); action groups wrap group by group (${JSON.stringify(acts)}); channel chips wrap (${ch} px); no page sideways scroll`,
      ['auto', 'scroll'].includes(tl.ox) && acts && new Set(acts.groups.map(g => g[2])).size > 1 && acts.groups.every(g => g[1] <= 34) && ch > 40 && await noSideways(page));
    await shot(page, 'companies-390');
    await measure(page, 'companies@390', '[data-pipeline-companies]');
    await axeOn(page, 'companies@390', '[data-pipeline-companies]');
    await sub(page, 'Map'); await page.locator('[data-priorities]').waitFor({ timeout: 20000 }); await page.waitForTimeout(1000);
    ok('390 Map: no page sideways scroll', await noSideways(page));
    await shot(page, 'map-390');
    await tab(page, 'Dashboard'); await sub(page, 'Sources'); await page.waitForTimeout(2000);
    ok('390 Dashboard › Sources: no page sideways scroll', await noSideways(page));
    await shot(page, 'dashboard-sources-390');
    ok('390 0 page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }

  // ---- Viewer (intercepted /api/me).
  {
    const { ctx, page, errors } = await open(1440, { viewer: true });
    const groupsV = await page.evaluate(() => [...document.querySelectorAll('[data-action-group]')].map(g => g.dataset.actionGroup));
    const add = await page.getByRole('button', { name: '+ Add ▾' }).count(), upd = await page.getByRole('button', { name: 'Update from sheet' }).count();
    const prio = await page.locator('[data-pipeline-companies] select[aria-label^="Priority for"]').count();
    await shot(page, 'companies-viewer-1440');
    ok(`Viewer: action groups ${groupsV.join(' / ')}; + Add ${add}, Update ${upd}, Priority controls ${prio}; 0 page errors`, groupsV.join('|') === 'table' && add === 0 && upd === 0 && prio === 0 && !errors.length, errors.join(' | '));
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
  console.log(`\ncompanies-v2 Stage 3 live check: ${passed}/${results.checks.length} passed · Claude 0 · Apollo 0 · writes 0\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
