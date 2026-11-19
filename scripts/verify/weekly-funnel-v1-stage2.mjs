// weekly-funnel-v1 Stage 2 check - localhost against the build, as Jack (ownerSession) on the REAL HomeLover workspace.
// READ-ONLY: every non-GET to /api or /proxy is aborted and counted; 0 Claude, 0 Apollo (the server runs with both keys
// empty; the browser's calls to either host are aborted).
// DECLARED before it runs:
//   --before   4 page loads (Scorecard + Home at 1440 and 390), four PNGs (*-before.png). ~90 s, cap 200 s.
//   default    5 page loads (Scorecard 1440 / 390 / Viewer 1440, Home 1440 / 390), 2 route GETs from the script
//              (goals/weekly?weeks=12, goals/pulse?period=this_week) + each page's own reads. 0 writes: a goal cell and a
//              LinkedIn cell are opened and closed with Escape. PNGs under .screenshots/weekly-funnel-v1/. ~170 s, cap 235 s.
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
const BEFORE = process.argv.includes('--before');
const OUT = path.join(ROOT, '.screenshots', 'weekly-funnel-v1');
const PORT = 3996, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const TABLES = ['sales_metric_targets', 'sales_manual_metrics', 'sales_funnel_days', 'sales_email_daily_counts', 'sales_flow_events', 'sales_partner_events'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data?.[0]?.id;
if (!HL) throw new Error('no HomeLover business');
async function count(t) { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL); return r.error ? `n/a (${r.error.message.slice(0, 40)})` : r.count; }
const snapshot = async () => { const o = {}; for (const t of TABLES) o[t] = await count(t); return o; };
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
let srv, browser, owner;
const blocked = [], realCalls = [];
const results = { checks: [], errors: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 600)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: BEFORE ? 200000 : 235000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));
const fmt = n => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const pct = r => (r == null ? '—' : `${(r * 100).toFixed(1)}%`);

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', ANTHROPIC_API_KEY: '', APOLLO_API_KEY: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const get = async p => { const r = await fetch(`${BASE}/api/sales/${HL}${p}`, { headers: { cookie } }); return { status: r.status, body: await r.json().catch(() => null) }; };
  browser = await chromium.launch();
  async function openView(width, tabName, ready, { viewer = false, height = null } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: height || (width < 900 ? 844 : 1000) }, hasTouch: width < 900 });
    await ctx.addInitScript(([k, v, bz, dd]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      localStorage.setItem('prospector_goals_owner', 'team');
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, dd);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (u.protocol === 'file:' || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      const apiWrite = isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname);
      const deny = apiWrite || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.pathname.replace(HL, ':b')}`); return route.abort(); }
      if (viewer && isLocal && u.pathname === '/api/me') {
        const r = await route.fetch(); const j = await r.json();
        j.profile = { ...j.profile, is_platform_owner: false };
        j.memberships = (j.memberships || []).map(m => (m.business_id === HL ? { ...m, role: 'viewer' } : m));
        return route.fulfill({ response: r, json: j });
      }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(25000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    await page.goto(`${BASE}/?tab=dashboard&view=overview`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 25000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: /^Dashboard/ }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
    await page.locator('[data-sales-subviews]').getByRole('tab', { name: tabName, exact: true }).dispatchEvent('click'); await page.waitForTimeout(1500);
    await page.locator(ready).first().waitFor({ timeout: 40000 }); await page.waitForTimeout(2500);
    return { ctx, page, errors };
  }
  const n2 = page => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
  const axeOn = async (page, key, sel) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async s => { const r = await window.axe.run(document.querySelector(s) || document, { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); }, sel);
    ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v));
  };
  const SCORE_READY = '[data-scorecard] [data-value]', HOME_READY = '[data-pulse] [data-pulse-tile]';
  const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, animations: 'disabled' });

  if (BEFORE) {
    for (const w of [1440, 390]) {
      for (const [tab, ready, name] of [['Scorecard', SCORE_READY, 'scorecard'], ['Home', HOME_READY, 'home']]) {
        const { ctx, page } = await openView(w, tab, ready);
        await shot(page, `${name}-${w}-before`);
        ok(`${tab} ${w} before: ${name}-${w}-before.png`, true);
        await ctx.close();
      }
    }
  } else {
    // ---- the two routes the pages read
    const weekly = await get('/goals/weekly?weeks=12'), pulse = await get('/goals/pulse?period=this_week');
    const W = weekly.body, P = pulse.body;
    const text = (m, v) => (m.unit === 'rate' ? pct(v) : fmt(v));
    ok(`routes: goals/weekly ${weekly.status} (${W?.metrics?.length} rows in ${W?.groups?.join(' · ')}, week of ${W?.week_start}, day ${W?.elapsed?.days} of 7) · goals/pulse ${pulse.status} (prev ${P?.prev?.from}..${P?.prev?.to})`, weekly.status === 200 && pulse.status === 200 && W.metrics.length === 20 && P.prev.from === W.same_point.from && P.prev.to === W.same_point.to);
    const expectRow = m => {
      const tw = m.this_week, manual = m.kind === 'manual';
      const d = tw.delta;
      return {
        k: m.key, last: manual ? fmt(m.last_week?.value) : text(m, m.last_week?.value), cur: manual ? fmt(tw.to_date) : text(m, tw.to_date),
        pace: manual ? null : tw.pace != null ? `paceon pace for ~${fmt(tw.pace)}` : tw.to_date == null ? null : m.kind === 'stock' ? 'as of today' : 'to date',
        change: d == null ? null : d === 0 ? '— no change' : `${(d > 0) === (m.direction === 'up') ? '▲' : '▼'} ${d > 0 ? '+' : '−'}${m.unit === 'rate' ? `${Math.abs(d * 100).toFixed(1)} pts` : fmt(Math.abs(d))}`,
        points: m.series.filter(s => s.value != null).length, hollow: tw.to_date != null ? 1 : 0, goals: m.series.filter(s => s.goal != null).length,
      };
    };
    const want = W.metrics.map(expectRow);
    const diff = (got, keys) => want.flatMap((w, i) => keys.filter(f => got[i]?.[f] !== w[f]).map(f => `${w.k}.${f}: page ${JSON.stringify(got[i]?.[f])} vs route ${JSON.stringify(w[f])}`));

    // ---- Scorecard 1440
    {
      const { ctx, page, errors } = await openView(1440, 'Scorecard', '[data-scorecard-table] [data-row]', { height: 1500 });
      const v = await page.evaluate(() => ({
        rows: [...document.querySelectorAll('[data-scorecard-table] [data-row]')].map(r => {
          const k = r.getAttribute('data-row'), c = s => r.querySelector(`[data-cell="${k}|${s}"]`);
          return { k, last: c('last').querySelector('[data-value]')?.textContent ?? null, cur: c('this').querySelector('[data-value]')?.textContent ?? null, pace: c('this').querySelector('[data-pace]')?.textContent ?? null, change: c('change').querySelector('[data-change]')?.textContent ?? null,
            points: c('spark').querySelectorAll('[data-point]').length, hollow: c('spark').querySelectorAll('[data-point="current"]').length, goals: c('spark').querySelectorAll('[data-goal-seg]').length, sparkW: c('spark').querySelector('svg')?.getAttribute('width') };
        }),
        groups: [...document.querySelectorAll('[data-group]')].map(g => g.getAttribute('data-group')), heads: [...document.querySelectorAll('[data-scorecard-table] thead th')].map(h => h.innerText.replace(/\n/g, ' | ')),
        cols: [...document.querySelectorAll('[data-scorecard-table] colgroup col')].map(c => parseInt(c.style.width, 10)), width: Math.round(document.querySelector('[data-scorecard-table]').getBoundingClientRect().width),
        hint: document.querySelector('[data-row="human_open_rate"] [data-hint]')?.textContent, rule: document.querySelector('[data-pace-rule]')?.textContent,
        goalButtons: document.querySelectorAll('[data-cell$="|goal"] button').length, typed: document.querySelectorAll('[data-row^="linkedin_"] [data-value] button').length, entered: [...document.querySelectorAll('[data-entered]')].map(e => e.textContent),
      }));
      const off = diff(v.rows, ['k', 'last', 'cur', 'pace', 'change', 'points', 'hollow', 'goals']);
      ok(`1440 rows = the route to the digit: ${v.rows.length} rows in ${v.groups.join(' · ')}; ${off.length} cells off`, v.rows.length === 20 && v.groups.join() === W.groups.join() && off.length === 0, off.join(' ; '));
      log(`1440 sample: ${v.rows.slice(0, 3).map(r => `${r.k} last ${r.last} · this ${r.cur} (${r.pace}) · ${r.change}`).join(' || ')}`);
      ok(`1440 table: heads ${v.heads.join(' ‖ ')}; cols ${v.cols.join(' + ')} = ${v.cols.reduce((a, b) => a + b, 0)} in ${v.width} px; every line 120 px`, v.cols.reduce((a, b) => a + b, 0) === 1100 && v.rows.every(r => r.sparkW === '120'));
      ok(`1440 words: open-rate hint "${v.hint}"; ${v.goalButtons} goal cells (owner) · ${v.typed} typed LinkedIn cells · entered lines ${JSON.stringify(v.entered)}; pace rule shown`, /÷/.test(v.hint || '') && v.goalButtons === 20 && v.typed === 8 && (v.rule || '').startsWith(W.wording.pace));
      await shot(page, 'scorecard-1440-after');
      await axeOn(page, 'scorecard@1440', '[data-scorecard]');
      ok(`1440: N2 ${await n2(page)} px; page errors ${errors.length}`, (await n2(page)) === 0 && errors.length === 0, errors.join(' | '));
      // the expanded chart: the first row with the most weeks of data, hovered on last week
      const pickRow = W.metrics.filter(m => m.kind !== 'manual').sort((a, b) => b.series.filter(s => s.value != null).length - a.series.filter(s => s.value != null).length)[0];
      await page.locator(`[data-row="${pickRow.key}"] [data-expand]`).click(); await page.waitForTimeout(500);
      const box = await page.locator(`[data-weekly-chart="${pickRow.key}"] [data-explorer-chart]`).boundingBox();
      const g = { W: 1340, padL: 44, padR: 48 }, slot = (g.W - g.padL - g.padR) / 12;
      await page.mouse.move(box.x + ((g.padL + slot * 10.5) / g.W) * box.width, box.y + box.height / 2); await page.waitForTimeout(400);
      const card = await page.locator('[data-hover-card]').innerText().catch(() => '');
      const lw = pickRow.series[10];
      ok(`chart (${pickRow.name}): hover on last week reads "${card.replace(/\n/g, ' · ')}"`, card.includes(`Week of`) && card.includes(text(pickRow, lw.value)) && (await page.locator(`[data-weekly-chart="${pickRow.key}"] [data-point="current"]`).count()) === (pickRow.this_week.to_date != null ? 1 : 0));
      await shot(page, 'scorecard-1440-chart');
      await axeOn(page, 'scorecard chart@1440', '[data-scorecard]');
      await page.mouse.move(5, 5);
      // a goal cell and a typed cell open and close with Escape: nothing is sent
      const sent = blocked.length;
      await page.locator('[data-cell="human_open_rate|goal"] button').click(); await page.waitForTimeout(200);
      const goalInput = await page.locator('[data-cell="human_open_rate|goal"] input').count();
      await page.keyboard.type('18'); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
      await page.locator('[data-cell="linkedin_requests|last"] button').click(); await page.waitForTimeout(200);
      const typedInput = await page.locator('[data-cell="linkedin_requests|last"] input').count();
      await page.keyboard.type('7'); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
      ok(`inputs: the goal cell opens (${goalInput}) and the LinkedIn cell opens (${typedInput}); typed then Escape on both - requests sent ${blocked.length - sent}`, goalInput === 1 && typedInput === 1 && blocked.length === sent && (await page.locator('[data-scorecard] input').count()) === 0);
      await ctx.close();
    }
    // ---- Viewer
    {
      const { ctx, page } = await openView(1440, 'Scorecard', '[data-scorecard-table] [data-row]', { viewer: true, height: 1500 });
      const b = await page.evaluate(() => ({ rows: document.querySelectorAll('[data-scorecard-table] [data-row]').length, buttons: document.querySelectorAll('[data-scorecard-table] td button:not([data-expand])').length, expand: document.querySelectorAll('[data-expand]').length }));
      ok(`Viewer: ${b.rows} rows, ${b.buttons} goal / typed buttons, ${b.expand} chart toggles`, b.rows === 20 && b.buttons === 0 && b.expand === 20);
      await shot(page, 'scorecard-viewer-1440');
      await ctx.close();
    }
    // ---- Scorecard 390
    {
      const { ctx, page, errors } = await openView(390, 'Scorecard', '[data-scorecard="phone"] [data-tile]', { height: 1600 });
      const c = await page.evaluate(() => ({ tiles: [...document.querySelectorAll('[data-tile]')].map(t => ({ k: t.getAttribute('data-tile'), cur: (t.querySelector('[data-value]')?.firstChild?.textContent ?? t.querySelector('[data-value]')?.textContent ?? null), pace: t.querySelector('[data-pace]')?.textContent ?? null, lines: t.querySelectorAll('svg[role="img"]').length, points: t.querySelectorAll('[data-point]').length })), table: document.querySelectorAll('table').length }));
      const offP = want.flatMap((w, i) => [['k', c.tiles[i]?.k, w.k], ['cur', c.tiles[i]?.cur, w.cur], ['pace', c.tiles[i]?.pace, w.pace], ['points', c.tiles[i]?.points, w.points]].filter(([, a, b]) => a !== b).map(([f, a, b]) => `${w.k}.${f}: page ${JSON.stringify(a)} vs route ${JSON.stringify(b)}`));
      await shot(page, 'scorecard-390-after');
      await axeOn(page, 'scorecard@390', '[data-scorecard]');
      ok(`390: ${c.tiles.length} tiles, each with one line (${c.tiles.filter(t => t.lines === 1).length}); to date + pace + points = the route, ${offP.length} off; no table; N2 ${await n2(page)} px; page errors ${errors.length}`, c.tiles.length === 20 && c.tiles.every(t => t.lines === 1) && offP.length === 0 && c.table === 0 && (await n2(page)) === 0 && errors.length === 0, [...offP, ...errors].join(' ; '));
      await ctx.close();
    }
    // ---- Home: the pulse tiles on pace
    for (const w of [1440, 390]) {
      const { ctx, page, errors } = await openView(w, 'Home', HOME_READY, { height: w < 900 ? 1600 : 1300 });
      const t = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-pulse-tile]')].map(x => [x.getAttribute('data-pulse-tile'), { pace: x.querySelector('[data-pace]')?.textContent ?? null, delta: x.querySelector('[data-delta]')?.textContent ?? null }])));
      const offH = Object.entries(P.metrics).flatMap(([k, m]) => {
        const out = [], wantPace = m.pace != null ? `paceon pace for ~${fmt(m.pace)}` : null;
        if (t[k]?.pace !== wantPace) out.push(`${k}.pace: page ${JSON.stringify(t[k]?.pace)} vs route ${JSON.stringify(wantPace)}`);
        if (m.kind === 'rate' && t[k]?.pace != null) out.push(`${k}: a rate is projected`);
        if (/vs last wk/.test(t[k]?.delta || '')) out.push(`${k}: still reads "vs last wk"`);
        return out;
      });
      await shot(page, `home-${w}-after`);
      await axeOn(page, `home pulse@${w}`, '[data-pulse]');
      ok(`Home ${w}: ${Object.keys(t).length} tiles; pace on ${Object.values(t).filter(x => x.pace).length} (the route projects ${Object.values(P.metrics).filter(m => m.pace != null).length} counts, 0 rates); sent reads "${t.sent?.delta}"; ${offH.length} off; N2 ${await n2(page)} px; page errors ${errors.length}`, offH.length === 0 && (await n2(page)) === 0 && errors.length === 0, [...offH, ...errors].join(' ; '));
      await ctx.close();
    }
  }
  ok(`calls to Claude / Apollo: ${realCalls.length}; non-GET aborted: ${blocked.length}${blocked.length ? ` (${[...new Set(blocked)].slice(0, 6).join(', ')})` : ''}`, realCalls.length === 0);
} catch (e) {
  results.errors.push(e.message); log('ERROR', e.stack?.split('\n').slice(0, 4).join(' | '));
} finally {
  await cleanup();
  let line;
  try {
    const after = await snapshot();
    const moved = TABLES.filter(t => after[t] !== before[t]);
    line = moved.length ? `counts moved on ${moved.map(t => `${t} ${before[t]} -> ${after[t]}`).join(', ')} - this run wrote nothing (every non-GET aborted); check who wrote them` : `yes (${TABLES.length} table counts identical; nothing written; Jack's sign-in rows kept by rule)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  console.log(`\n${passed}/${results.checks.length} checks passed${results.errors.length ? ` · errors: ${results.errors.join(' | ')}` : ''}`);
  console.log(`restored: ${line}`);
  process.exit(results.errors.length || passed !== results.checks.length ? 1 : 0);
}
