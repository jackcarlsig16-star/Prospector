// top-targets-v1 Stage 2 live check - localhost against the build, as Jack (ownerSession) on the REAL HomeLover
// workspace. READ-ONLY: every non-GET to /api or /proxy is aborted and counted; 0 Claude, 0 Apollo (the server runs
// with both keys empty; the browser's calls to either host are aborted).
// DECLARED before it runs:
//   --map-before   2 page loads (the Map at 1440 and 390), two PNGs (map-1440-before / map-390-before). ~60 s, cap 150 s.
//   default        7 page loads (Top targets 1440 / 390 / Viewer 1440, the Map 1440 / 390, the two mockup files),
//                  ~6 route GETs (goals/top-targets for Mine / Cyrus / Team, goals/scores), 5 table reads
//                  (Apple's pin columns on the three record tables; two counts of dated priorities with no pin).
//                  0 writes. PNGs under .screenshots/top-targets-v1/. ~150 s, cap 240 s.
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
const BEFORE = process.argv.includes('--map-before');
const OUT = path.join(ROOT, '.screenshots', 'top-targets-v1');
const MOCK = path.join(ROOT, 'specs', 'design', 'top-targets');
const PORT = 3997, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const TABLES = ['sales_opportunities', 'sales_targets', 'sales_goals', 'sales_flow_events', 'sales_partner_events', 'sales_week_goals', 'sales_company_scores'];
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
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 500)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: BEFORE ? 150000 : 240000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));

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
    await page.goto(`${BASE}/?tab=pipeline&view=companies`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 25000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: /^Pipeline/ }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
    await page.locator('[data-sales-subviews]').getByRole('tab', { name: tabName, exact: true }).dispatchEvent('click'); await page.waitForTimeout(1500);
    await page.locator(ready).first().waitFor({ timeout: 30000 }); await page.waitForTimeout(2000);
    return { ctx, page, errors };
  }
  const n2 = page => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
  const axeOn = async (page, key, sel) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async s => { const r = await window.axe.run(document.querySelector(s) || document, { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); }, sel);
    ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v));
  };
  const MAP_READY = '[data-priorities] [data-dot], [data-priorities] [data-row]';

  if (BEFORE) {
    for (const w of process.argv.includes('--390') ? [390] : [1440, 390]) {
      const { ctx, page } = await openView(w, 'Map', MAP_READY);
      await page.screenshot({ path: `${OUT}/map-${w}-before.png`, animations: 'disabled' });
      ok(`Map ${w} before: ${await page.locator(MAP_READY).count()} marks, ${await page.locator('[data-pin-glyph]').count()} pin glyphs`, true);
      await ctx.close();
    }
  } else {
    // ---- the route, three scopes
    const [mine, team] = [await get('/goals/top-targets?owner=me&limit=1000'), await get('/goals/top-targets?limit=1000')];
    const rows = mine.body.rows, all = team.body.rows;
    const sumOk = all.filter(r => r.groups.heat + r.groups.fit + r.groups.impact + r.groups.recency + r.groups.pin === r.score).length;
    const order = list => list.every((r, i) => i === 0 || !(r.pin && !r.pin.held) || (list[i - 1].pin && !list[i - 1].pin.held));
    ok(`route: Mine ${mine.body.total} of scope ${mine.body.scope} (${mine.body.pinned} pinned) · Team ${team.body.total} of book ${team.body.book}; the five bars sum to the score on ${sumOk} of ${all.length}; P1 pins lead both lists`, mine.status === 200 && team.status === 200 && sumOk === all.length && order(rows) && order(all) && team.body.total === team.body.book);
    const diff = all.filter(r => r.why.short !== r.why.full).length, leak = all.filter(r => /pinned|held at|next [A-Z]/.test(r.why.short)).length;
    ok(`why: short differs from full on ${diff} of ${all.length}; a pin reason or next date inside why.short on ${leak}`, leak === 0 && diff > 0, `e.g. "${all[0].why.short}" vs "${all[0].why.full}"`);
    const expired = all.filter(r => r.pin_expired).length, withNext = all.filter(r => r.next).length;
    log(`team: ${all.filter(r => r.pin).length} live pins, ${expired} expired, ${withNext} rows with an open to-do; bands ${JSON.stringify(team.body.counts.bands)}; owners ${Object.keys(team.body.counts.owners).length}`);

    // ---- S5: Apple's stored pin
    for (const [t, nameCol, extra] of [['sales_opportunities', 'organization', ', is_top'], ['sales_goals', 'name', ', hot'], ['sales_targets', 'name', '']]) {
      const { data, error } = await svc.from(t).select(`${nameCol}, pinned_until, pinned_at, pin_reason${t === 'sales_targets' ? '' : ', priority, priority_set_at'}${extra}`).eq('business_id', HL).ilike(nameCol, 'apple%').limit(5);
      for (const r of data || []) log(`S5 ${t}: ${JSON.stringify(r)}`);
      if (error) log(`S5 ${t}: ${error.message}`);
    }
    const apple = all.find(r => /^apple\b/i.test(r.name));
    ok(`S5 Apple on the route: ${apple ? `score ${apple.score} ${apple.band}, pin ${JSON.stringify(apple.pin && { reason: apple.pin.reason, days_left: apple.pin.days_left, level: apple.pin.level })}` : 'not in the open book'}`, !!apple);
    // ---- the clamp-only-on-pin rule: who it touches at the next recompute
    for (const [t, nameCol] of [['sales_opportunities', 'organization'], ['sales_goals', 'name']]) {
      const { data } = await svc.from(t).select(`${nameCol}, priority, priority_set_at`).eq('business_id', HL).is('pinned_until', null).not('priority', 'is', null).not('priority_set_at', 'is', null).limit(50);
      log(`dated priority with no pin (stops clamping) ${t}: ${(data || []).length}${(data || []).length ? ` - ${(data || []).map(r => `${r[nameCol]} P${r.priority}`).join(', ')}` : ''}`);
    }

    // ---- 1440
    {
      const { ctx, page, errors } = await openView(1440, 'Top targets', '[data-top-targets] [data-row]', { height: 1260 });
      const tabs = await page.locator('[data-sales-subviews] [role=tab]').allTextContents();
      const v = await page.evaluate(() => {
        const root = document.querySelector('[data-top-targets]');
        const bars = [...root.querySelectorAll('tr[data-row]')].map(tr => ({ score: Number(tr.querySelector('.tt-band small').textContent), w: [...tr.querySelectorAll('[data-seg]')].reduce((n, i) => n + parseFloat(i.style.width), 0), barW: Math.round(tr.querySelector('.tt-bar').getBoundingClientRect().width) }));
        return {
          mode: root.getAttribute('data-top-targets'), rows: root.querySelectorAll('tr[data-row]').length, keys: [...root.querySelectorAll('tr[data-row]')].map(r => r.getAttribute('data-row')),
          chips: [...root.querySelectorAll('[data-owner-chip]')].map(c => c.textContent), pinned: root.querySelector('[data-pinned-chip]').textContent, bands: [...root.querySelectorAll('[data-band-chip]')].map(c => c.textContent),
          count: root.querySelector('[data-count-line]').textContent, heads: [...root.querySelectorAll('thead th')].map(h => h.textContent), cols: [...root.querySelectorAll('colgroup col')].map(c => parseInt(c.style.width, 10)),
          barsOff: bars.filter(b => Math.abs(b.w - Math.max(0, b.score)) > 0.5).length, barW: [...new Set(bars.map(b => b.barW))], width: Math.round(root.getBoundingClientRect().width),
          stars: [...root.querySelectorAll('[data-star]')].reduce((m, s) => { const k = s.getAttribute('data-star'); m[k] = (m[k] || 0) + 1; return m; }, {}),
        };
      });
      ok(`1440 tabs: ${tabs.join(' · ')}`, tabs[0] === 'Top targets' && tabs[1] === 'Companies');
      ok(`1440: ${v.rows} rows = the route's Mine (${rows.length}), same order; count line "${v.count}"`, v.mode === 'table' && v.rows === rows.length && v.keys.join() === rows.map(r => r.key).join() && v.count.startsWith(`Showing ${mine.body.total} of ${mine.body.scope} · ${mine.body.pinned} pinned`));
      ok(`1440 chips = route: ${v.chips.join(' · ')} · ${v.pinned} · ${v.bands.join(' · ')}`, v.chips[0] === `Mine ${mine.body.counts.owners[owner.userId] || 0}` && v.chips.at(-1) === `Team ${mine.body.book}` && v.pinned === `Pinned ${mine.body.pinned}` && v.bands.join() === ['P1', 'P2', 'P3', 'P4'].map(b => `${b} ${mine.body.counts.bands[b]}`).join());
      ok(`1440 table: heads ${v.heads.join(' | ')}; cols ${v.cols.join(' + ')} = ${v.cols.reduce((a, b) => a + b, 0)} in ${v.width} px; bar ${v.barW.join('/')} px; drawn segments off the score on ${v.barsOff} rows; stars ${JSON.stringify(v.stars)}`, v.barsOff === 0 && v.barW.join() === '160' && v.cols.join() === '186,206,184,262,202,60');
      await page.screenshot({ path: `${OUT}/top-targets-1440.png`, animations: 'disabled' });
      await axeOn(page, 'top-targets@1440', '[data-top-targets]');
      ok(`1440: N2 ${await n2(page)} px; page errors ${errors.length}`, (await n2(page)) === 0 && errors.length === 0, errors.join(' | '));
      // the two drawn popovers: the breakdown on the first pinned row with a lift, the reason form on a not-pinned row
      const lifted = rows.find(r => r.groups.pin > 0) || rows[0];
      await page.locator(`tr[data-row="${lifted.key}"] [data-score-bar]`).hover(); await page.waitForTimeout(400);
      const pop = await page.locator('[data-breakdown]').innerText().catch(() => '');
      ok(`breakdown hover (${lifted.name}): ${pop.split('\n')[0]}`, pop.includes(lifted.name) && pop.includes('Heat') && pop.includes('Pin'));
      await page.mouse.move(5, 5);
      const plain = rows.find(r => !r.pin && !r.pin_expired);
      if (plain) {
        await page.locator(`tr[data-row="${plain.key}"] [data-star]`).click(); await page.waitForTimeout(400);
        const form = await page.locator('[data-pin-pop="form"]').innerText().catch(() => '');
        ok(`pin popover (${plain.name}): opens, Pin disabled until a reason is typed - closed without a write`, form.includes(`Pin ${plain.name}`) && await page.locator('[data-pin-pop="form"] button[type=submit]').isDisabled());
        await page.locator(`tr[data-row="${lifted.key}"] [data-score-bar]`).hover(); await page.waitForTimeout(300);
        await page.screenshot({ path: `${OUT}/top-targets-1440-popovers.png`, animations: 'disabled' });
        await page.keyboard.press('Escape'); await page.mouse.move(5, 5);
      }
      const pinnedRow = rows.find(r => r.pin);
      if (pinnedRow) {
        await page.locator(`tr[data-row="${pinnedRow.key}"] [data-star]`).click(); await page.waitForTimeout(300);
        const items = await page.locator('[data-pin-pop="menu"] [role=menuitem]').allTextContents();
        ok(`filled star menu (${pinnedRow.name}): ${items.join(' · ')} - closed without a pick`, items.join('|') === 'Edit reason|Renew 30 more days|Unpin');
        await page.screenshot({ path: `${OUT}/top-targets-1440-menu.png`, animations: 'disabled' });
        await page.keyboard.press('Escape');
      }
      // Team scope through the chip
      await page.locator('[data-owner-chip="team"]').click(); await page.waitForTimeout(2500);
      const teamRows = await page.locator('[data-top-targets] tr[data-row]').count();
      ok(`Team chip: ${teamRows} rows = the route's Team (${all.length})`, teamRows === all.length);
      await ctx.close();
    }
    // ---- Viewer
    {
      const { ctx, page } = await openView(1440, 'Top targets', '[data-top-targets] [data-row]', { viewer: true });
      const v = await page.evaluate(() => ({ rows: document.querySelectorAll('[data-top-targets] tr[data-row]').length, starButtons: document.querySelectorAll('[data-top-targets] button[data-star]').length, glyphs: document.querySelectorAll('[data-top-targets] span[data-star]').length, renew: [...document.querySelectorAll('[data-top-targets] .tt-pinl button')].length }));
      ok(`Viewer: ${v.rows} rows, ${v.glyphs} star glyphs, ${v.starButtons} star buttons, ${v.renew} Renew links`, v.starButtons === 0 && v.renew === 0 && v.glyphs === v.rows);
      await page.screenshot({ path: `${OUT}/top-targets-viewer-1440.png`, animations: 'disabled' });
      await ctx.close();
    }
    // ---- 390
    {
      const { ctx, page, errors } = await openView(390, 'Top targets', '[data-top-targets] [data-row]', { height: 1560 });
      const c = await page.evaluate(() => ({ mode: document.querySelector('[data-top-targets]').getAttribute('data-top-targets'), cards: document.querySelectorAll('[data-top-targets] article[data-row]').length, nums: document.querySelectorAll('[data-top-targets] .tt-nums').length, star: (() => { const b = document.querySelector('[data-top-targets] button[data-star]')?.getBoundingClientRect(); return b ? [Math.round(b.width), Math.round(b.height)] : null; })(), count: document.querySelector('[data-count-line]').textContent }));
      await page.screenshot({ path: `${OUT}/top-targets-390.png`, animations: 'disabled' });
      await axeOn(page, 'top-targets@390', '[data-top-targets]');
      const plain = rows.find(r => !r.pin && !r.pin_expired);
      let sheet = null;
      if (plain) {
        await page.locator(`article[data-row="${plain.key}"] [data-star]`).click(); await page.waitForTimeout(500);
        sheet = await page.evaluate(() => { const s = document.querySelector('[data-pin-sheet] .tt-sheet'); return s ? { bottom: Math.round(window.innerHeight - s.getBoundingClientRect().bottom), text: s.innerText.split('\n')[0] } : null; });
        await page.screenshot({ path: `${OUT}/top-targets-390-sheet.png`, animations: 'disabled' });
        await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      }
      ok(`390: ${c.cards} cards (${c.nums} with the numbers under a full bar), star target ${c.star?.join('×')} px, "${c.count}"; the pin sheet ${sheet ? `"${sheet.text}" ${sheet.bottom} px from the bottom` : 'n/a'} - closed without a write; N2 ${await n2(page)} px; page errors ${errors.length}`, c.mode === 'cards' && c.cards === rows.length && c.nums === c.cards && (await n2(page)) === 0 && errors.length === 0 && (!plain || sheet?.bottom === 0), errors.join(' | '));
      await ctx.close();
    }
    // ---- the Map, after
    const scores = await get('/goals/scores');
    const livePins = (scores.body?.rows || []).filter(r => r.pinned).length;
    for (const w of [1440, 390]) {
      const { ctx, page, errors } = await openView(w, 'Map', MAP_READY);
      const g = await page.evaluate(() => ({ dots: document.querySelectorAll('[data-priorities] [data-dot], [data-priorities] [data-row]').length, glyphs: document.querySelectorAll('[data-priorities] [data-dot] [data-pin-glyph], [data-priorities] [data-row] [data-pin-glyph]').length }));
      await page.screenshot({ path: `${OUT}/map-${w}-after.png`, animations: 'disabled' });
      ok(`Map ${w}: ${g.dots} marks, ${g.glyphs} pin glyphs (the scores route marks ${livePins} rows pinned); N2 ${await n2(page)} px; page errors ${errors.length}`, g.glyphs > 0 && g.glyphs <= livePins && (await n2(page)) === 0 && errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
    // ---- side by side with the two mockups
    for (const [file, shot, w, h] of [['TopTargets.dc.html', 'top-targets-1440.png', 1440, 1260], ['TopTargetsPhone.dc.html', 'top-targets-390.png', 390, 1560]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      const page = await ctx.newPage();
      await page.goto(`file://${path.join(MOCK, file)}`); await page.waitForTimeout(1200);
      const mock = `${OUT}/mock-${w}.png`;
      await page.screenshot({ path: mock, animations: 'disabled' });
      const b64 = f => fs.readFileSync(f).toString('base64');
      await page.setViewportSize({ width: w * 2 + 60, height: h + 60 });
      await page.setContent(`<body style="margin:0;background:#000;color:#fff;font:14px system-ui"><div style="display:flex;gap:20px;padding:20px"><figure style="margin:0"><figcaption style="height:20px">mockup</figcaption><img width="${w}" src="data:image/png;base64,${b64(mock)}"></figure><figure style="margin:0"><figcaption style="height:20px">built (real data, Mine)</figcaption><img width="${w}" src="data:image/png;base64,${b64(`${OUT}/${shot}`)}"></figure></div></body>`);
      await page.screenshot({ path: `${OUT}/side-by-side-${w}.png`, fullPage: true });
      ok(`side by side ${w}: side-by-side-${w}.png`, true);
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
    line = moved.length ? `counts moved on ${moved.map(t => `${t} ${before[t]} -> ${after[t]}`).join(', ')} - this run wrote nothing (every non-GET aborted); check who wrote them` : `yes (${TABLES.length} table counts identical; nothing written; Jack's sign-in row kept by rule, last_seen_at restored)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  console.log(`\n${passed}/${results.checks.length} checks passed${results.errors.length ? ` · errors: ${results.errors.join(' | ')}` : ''}`);
  console.log(`restored: ${line}`);
  process.exit(results.errors.length || passed !== results.checks.length ? 1 : 0);
}
