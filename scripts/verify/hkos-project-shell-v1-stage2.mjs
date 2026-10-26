// hkos-project-shell-v1 Stage 2 - the HumanKind Sales OS shell on localhost, as Jack, against the real HumanKind
// workspace (needs businesses.features.hk_sales on). Checks 1-10 + N2 from the SPEC:
//  1 opens into the shell; all ten screens from the nav at 1440x900, each with its title + empty state
//  2 390x844: 5-tab bottom bar, More sheet lists the rest, no horizontal scroll, targets >= 44 px
//  3 owner toggle = Me / <other signed-in member> / All, switches, survives reload (a second signed-in member is
//    injected into the /shell response, since HumanKind's second member hasn't signed in)
//  4 workspace pill -> HomeLover lands on Sales & Marketing Actions; the menu has NO "Old ... screens" item
//    (hk-legacy-cleanup-v1 Stage 2, R2: no path back to the legacy pages from the shell)
//  5 #hk/settings/members deep link after reload; Back/Forward between screens
//  6 Cmd+K and Ctrl+K palette: filter, jump, Esc; after leaving the shell Cmd+K opens nothing
//  7 contrast: every text pair in the shell >= 4.5 (>= 3 for large), icons >= 3; prints the pair table
//  8 no element outside .hk-theme uses Fredoka or Jost (the baseline diff itself is the separate compare run)
//  9 /api/hk/.../shell response and shell page text contain no "@"
// 10 viewer pass: role forced to viewer in the /shell response (Jack's ruling); shell renders, no write controls
// N2 clicking nav items and the toggle moves nothing else >= 1 px.
// SCOPE (declared): read-only. Jack's session via scripts/verify/lib/ownerSession.mjs (last_seen_at restored,
// sign-in rows kept by rule). No app writes: every non-GET to /api, /proxy and Supabase REST is aborted, as are
// sync / Apollo / visitor pull / Tidy / research / Anthropic / Gmail / Google / Microsoft routes and every outside host
// except Google Fonts (counted; any attempt at an Anthropic, Apollo or Gmail host fails the run). HomeLover counts
// compared. Screenshots (1440 + 390: Today, Settings > Members, More sheet) to scripts/verify/out/ (gitignored); no
// screenshot of Admin. Runtime ~2 min, hard cap 240 s. Serves build/ - run npm run build first.
// Usage: node scripts/verify/hkos-project-shell-v1-stage2.mjs
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const { measureScript } = require(ROOT + '/scripts/verify/lib/contrastMeasure.cjs');
const { ownerSession } = await import(ROOT + '/scripts/verify/lib/ownerSession.mjs');

const OUT = path.join(ROOT, 'scripts', 'verify', 'out', 'hkos-project-shell-v1');
const PORT = 3988;
const BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const HL_TABLES = ['sales_week_goals', 'sales_goals', 'sales_signals', 'sales_suggestions', 'sales_sync_runs', 'visit_pull_runs', 'sales_tidy_runs', 'research_runs', 'apollo_credit_spend'];
const SCREENS = ['today', 'inbox', 'replies', 'drafts', 'pipeline', 'brands', 'sponsors', 'review', 'activity', 'settings'];
const LABELS = { today: 'Today', inbox: 'Inbox', replies: 'Replies', drafts: 'Drafts', pipeline: 'Pipeline', brands: 'Brands', sponsors: 'Sponsors', review: 'Review', activity: 'Activity', settings: 'Settings' };
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass: !!pass }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${detail}` : ''); };

const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }

const { data: hkRows } = await svc.from('businesses').select('id,name,features').eq('name', 'HumanKind');
const HK = hkRows?.find(b => b.features?.hk_sales);
if (!HK) { console.log('ABORT: HumanKind has no hk_sales flag on - turn on "HumanKind Sales OS" in Admin > Settings first'); process.exit(1); }

const hlCounts = async () => { const o = {}; for (const t of HL_TABLES) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HOMELOVER)).count; return o; };
const hlBefore = await hlCounts();

let srv, browser, owner;
const blocked = [];
const realCalls = [];
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  if (owner) { log(await owner.release()); owner = null; }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 240000 });

// Opens a context as Jack. shellPatch(json) rewrites the /api/hk/.../shell response (checks 3 and 10).
async function open(viewport, { shellPatch, clear = true } = {}) {
  const ctx = await browser.newContext({ viewport });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  await ctx.addInitScript(([k, v, b, d, wipe]) => {
    if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1');
    if (wipe) localStorage.clear();
    localStorage.setItem(k, v);
    for (const n of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${n}_ran_${b}`, d);
    localStorage.setItem('prospector_auto_assay_disabled', '1');
  }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HOMELOVER, today, clear]);
  const supa = new URL(process.env.SUPABASE_URL).host;
  const BLOCK = /\/proxy\/(anthropic|gmail|gcal)|\/api\/(gmail|google|microsoft)\b|\/api\/sales\/[^/]+\/(sync|apollo)|\/visits\/pull|\/tidy\/run|\/research/;
  const shellBodies = [];
  await ctx.route('**/*', async route => {
    const req = route.request(); const u = new URL(req.url());
    if (/anthropic\.com$|apollo\.io$|gmail\.googleapis\.com$/.test(u.host) || (u.host === 'www.googleapis.com' && u.pathname.startsWith('/gmail'))) realCalls.push(`${req.method()} ${u.host}${u.pathname}`);
    const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === supa, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
    const deny = (isLocal && (BLOCK.test(u.pathname) || (req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname))))
      || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/'))
      || (!isLocal && !isSupa && !isFont);
    if (deny) { blocked.push(`${req.method()} ${u.host}${u.pathname}`); return route.abort(); }
    if (isLocal && /^\/api\/hk\/[^/]+\/shell$/.test(u.pathname)) {
      const res = await route.fetch(); const text = await res.text(); shellBodies.push(text);
      if (!shellPatch || !res.ok()) return route.fulfill({ response: res, body: text });
      return route.fulfill({ response: res, body: JSON.stringify(shellPatch(JSON.parse(text))), headers: { ...res.headers(), 'content-type': 'application/json' } });
    }
    return route.continue();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message.slice(0, 120)));
  return { ctx, page, errors, shellBodies };
}

const shellReady = async page => { await page.locator('[data-hk-shell] [data-hk-avatar]').waitFor({ timeout: 20000 }); await page.waitForTimeout(500); };
async function openHk(page) {
  await page.goto(`${BASE}/`);
  if (page.viewportSize().width < 900) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
  await page.getByLabel('Workspace').waitFor({ timeout: 20000 });
  await page.getByLabel('Workspace').selectOption({ label: 'HumanKind' });
  await shellReady(page);
}
const h1 = page => page.locator('[data-hk-shell] h1').first().innerText();
const boxes = page => page.evaluate(() => Object.fromEntries([['nav', '.hk-nav'], ['top', '.hk-top'], ['title', '.hk-head__title'], ['workspace', '[data-hk-workspace]'], ['avatar', '[data-hk-avatar]'], ...[...document.querySelectorAll('[data-hk-nav]')].map(e => [e.dataset.hkNav, `[data-hk-nav="${e.dataset.hkNav}"]`])].map(([k, s]) => {
  const el = document.querySelector(s); if (!el) return [k, null]; const r = el.getBoundingClientRect(); return [k, { x: r.x, y: r.y, w: r.width, h: r.height }];
})));
const maxMove = (a, b) => Math.max(0, ...Object.keys(a).filter(k => a[k] && b[k]).map(k => Math.max(...['x', 'y', 'w', 'h'].map(p => Math.abs(a[k][p] - b[k][p])))));
const noAt = page => page.evaluate(() => !document.querySelector('[data-hk-shell]').innerText.includes('@'));

try {
  fs.mkdirSync(OUT, { recursive: true });
  log('HomeLover before', JSON.stringify(hlBefore));
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();

  // 1 + 9 + N2 + 7 (desktop)
  const D = await open({ width: 1440, height: 900 });
  await openHk(D.page);
  const t0 = await h1(D.page);
  ok('1 opens into the shell on Today', /^Good (morning|afternoon|evening), Jack$/.test(t0), t0);
  const box0 = await boxes(D.page);
  let moved = 0, allTitled = true, allEmpty = true, at = true;
  const contrast = { texts: [], icons: [] };
  for (const id of SCREENS) {
    await D.page.locator(`[data-hk-nav="${id}"]`).click(); await D.page.waitForTimeout(250);
    const title = await h1(D.page);
    if (id !== 'today' && title !== LABELS[id]) { allTitled = false; log('  title', id, title); }
    if (id !== 'settings' && !(await D.page.locator('[data-hk-empty]').count())) allEmpty = false;
    if (!(await noAt(D.page))) at = false;
    moved = Math.max(moved, maxMove(box0, { ...(await boxes(D.page)), title: box0.title }));
    const m = await D.page.evaluate(measureScript({ scope: '[data-hk-shell]' }));
    contrast.texts.push(...m.texts);
    contrast.icons.push(...await D.page.evaluate(() => [...document.querySelectorAll('[data-hk-shell] svg')].filter(s => s.getBoundingClientRect().width).map(s => {
      const p = c => (c.match(/[\d.]+/g) || []).map(Number);
      const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
      let bg = null; for (let e = s.parentElement; e; e = e.parentElement) { const b = p(getComputedStyle(e).backgroundColor); if (b.length && (b[3] === undefined || b[3] > 0)) { bg = b; break; } }
      const stroke = getComputedStyle(s).stroke; const fg = p(stroke !== 'none' ? stroke : getComputedStyle(s).color);
      if (!bg || fg.length < 3 || s.querySelector('[fill]:not([fill="none"])')) return null;
      const l1 = lum(fg), l2 = lum(bg); return { label: s.closest('button')?.innerText.trim().slice(0, 18) || 'icon', ratio: Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100 };
    }).filter(Boolean)));
    if (id === 'today') await D.page.screenshot({ path: path.join(OUT, 'today-1440.png') });
    if (id === 'settings') await D.page.screenshot({ path: path.join(OUT, 'settings-members-1440.png') });
  }
  ok('1 all ten screens reachable from the nav, each with its title', allTitled);
  ok('1 every non-Settings screen shows its empty state', allEmpty);
  const members = await D.page.locator('[data-hk-member]').count();
  ok('1 Settings > Members lists the members (no email)', members >= 1 && await noAt(D.page), `${members} rows`);
  await D.page.locator('.hk-subnav__item', { hasText: 'Modules' }).click(); await D.page.waitForTimeout(200);
  ok('1 Settings > Modules: Email outreach On, five Off', (await D.page.locator('[data-hk-module]').count()) === 6 && (await D.page.locator('[data-hk-module="email"]').innerText()).includes('On'));
  ok('N2 nav clicks move nothing else >= 1 px', moved < 1, `max ${moved.toFixed(2)} px`);
  ok('9 shell page text has no "@" on any screen', at);
  ok('9 /shell response has no "@"', D.shellBodies.length > 0 && D.shellBodies.every(b => !b.includes('@')), `${D.shellBodies.length} responses`);

  // 7 contrast table
  const pairs = new Map();
  for (const t of contrast.texts) { const k = `${t.fg} on ${t.bg}${t.big ? ' (large)' : ''}`; const e = pairs.get(k); if (!e || t.ratio < e.ratio) pairs.set(k, { ratio: t.ratio, big: t.big, sample: t.text }); }
  console.log('   contrast pairs (fg on bg · min ratio · sample):');
  for (const [k, v] of [...pairs].sort((a, b) => a[1].ratio - b[1].ratio)) console.log(`     ${k.padEnd(30)} ${String(v.ratio).padEnd(6)} "${v.sample}"`);
  const textFails = [...pairs.values()].filter(v => v.ratio < (v.big ? 3 : 4.5));
  const iconMin = contrast.icons.reduce((m, i) => Math.min(m, i.ratio), 99);
  ok('7 every text pair >= 4.5:1 (3:1 large)', !textFails.length, `${pairs.size} pairs, ${textFails.length} under`);
  ok('7 every line icon >= 3:1', iconMin >= 3, `${contrast.icons.length} icons, min ${iconMin}`);

  // 6 palette
  await D.page.keyboard.press('Meta+k'); await D.page.waitForTimeout(200);
  const pal1 = await D.page.locator('[data-hk-palette]').count();
  await D.page.keyboard.type('spo'); await D.page.waitForTimeout(150);
  const opts = await D.page.locator('[data-hk-palette] [role=option]').count();
  await D.page.keyboard.press('Enter'); await D.page.waitForTimeout(250);
  const afterJump = await h1(D.page);
  await D.page.keyboard.press('Control+k'); await D.page.waitForTimeout(200);
  const pal2 = await D.page.locator('[data-hk-palette]').count();
  await D.page.keyboard.press('Escape'); await D.page.waitForTimeout(200);
  const pal3 = await D.page.locator('[data-hk-palette]').count();
  ok('6 Cmd+K opens, filter, Enter jumps; Ctrl+K opens; Esc closes', pal1 === 1 && opts === 1 && afterJump === 'Sponsors' && pal2 === 1 && pal3 === 0, `open ${pal1}, options ${opts}, jumped to ${afterJump}, ctrl ${pal2}, after Esc ${pal3}`);

  // 5 Back/Forward + deep link
  await D.page.locator('[data-hk-nav="inbox"]').click(); await D.page.waitForTimeout(200);
  await D.page.locator('[data-hk-nav="brands"]').click(); await D.page.waitForTimeout(200);
  await D.page.goBack(); await D.page.waitForTimeout(300); const back = await h1(D.page);
  await D.page.goForward(); await D.page.waitForTimeout(300); const fwd = await h1(D.page);
  ok('5 Back / Forward move between screens', back === 'Inbox' && fwd === 'Brands', `${back} / ${fwd}`);
  await D.page.goto(`${BASE}/#hk/settings/members`); await shellReady(D.page);
  ok('5 #hk/settings/members deep link opens Members after reload', (await h1(D.page)) === 'Settings' && (await D.page.locator('section[aria-label="Members"]').count()) === 1 && D.page.url().endsWith('#hk/settings/members'));

  // 4 workspace pill + old screens; 6 after leaving; 8 fonts outside the shell
  await D.page.locator('[data-hk-workspace]').click(); await D.page.getByRole('menuitem', { name: 'HomeLover' }).click();
  await D.page.locator('[data-actions]').waitFor({ timeout: 20000 });
  ok('4 workspace pill -> HomeLover lands on Sales & Marketing Actions', (await D.page.locator('[data-hk-shell]').count()) === 0 && !D.page.url().includes('#hk/'));
  await D.page.keyboard.press('Meta+k'); await D.page.waitForTimeout(250);
  ok('6 after leaving the shell, Cmd+K opens no palette', (await D.page.locator('[data-hk-palette]').count()) === 0);
  const hkFonts = async () => D.page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => !el.closest('.hk-theme') && /Fredoka|Jost/.test(getComputedStyle(el).fontFamily)).length);
  let fontLeaks = await hkFonts();
  await D.page.getByLabel('Workspace').selectOption({ label: 'HumanKind' }); await shellReady(D.page);
  await D.page.locator('[data-hk-workspace]').click(); await D.page.waitForTimeout(250);
  const oldItems = await D.page.getByRole('menuitem', { name: /^Old .* screens$/ }).count();
  await D.page.keyboard.press('Escape'); await D.page.waitForTimeout(250);
  ok('4 (R2) the workspace menu has no "Old ... screens" item; the shell stays', oldItems === 0 && (await D.page.locator('[data-hk-shell]').count()) === 1);
  await D.page.locator('[data-hk-avatar]').click(); await D.page.getByRole('menuitem', { name: 'Back to Prospector' }).click();
  await D.page.getByLabel('Workspace').waitFor({ timeout: 20000 }); await D.page.waitForTimeout(500);
  fontLeaks += await hkFonts();
  ok('8 no element outside .hk-theme uses Fredoka or Jost', fontLeaks === 0, `${fontLeaks} elements`);
  if (D.errors.length) log('desktop page errors:', D.errors.slice(0, 3));
  ok('desktop: no page errors', !D.errors.length);
  await D.ctx.close();

  // 3 owner toggle with a second signed-in member injected
  const withOther = j => ({ ...j, members: [...j.members.filter(m => m.user_id), { user_id: '00000000-0000-0000-0000-0000000000aa', first_name: 'Riley', role: 'member', signed_up: true, palette_index: 2 }] });
  const O = await open({ width: 1440, height: 900 }, { shellPatch: withOther });
  await openHk(O.page);
  const seg = O.page.locator('.hk-nav [role=group] button');
  const labels = await seg.allInnerTexts();
  await O.page.locator('.hk-nav [role=group] button', { hasText: 'Riley' }).click(); await O.page.waitForTimeout(200);
  const b1 = await boxes(O.page);
  await O.page.reload(); await shellReady(O.page);
  const pressed = await O.page.locator('.hk-nav [role=group] button[aria-pressed="true"]').innerText();
  ok('3 owner toggle Me / Riley / All, switches, survives reload', labels.join('|') === 'Me|Riley|All' && pressed === 'Riley', `${labels.join(' / ')} -> ${pressed}`);
  await O.page.locator('.hk-nav [role=group] button', { hasText: 'All' }).click(); await O.page.waitForTimeout(200);
  ok('N2 owner toggle moves nothing else >= 1 px', maxMove(b1, await boxes(O.page)) < 1);
  await O.ctx.close();

  // 10 viewer
  const V = await open({ width: 1440, height: 900 }, { shellPatch: j => ({ ...j, me: { ...j.me, role: 'viewer' } }) });
  await openHk(V.page);
  await V.page.locator('[data-hk-nav="settings"]').click(); await V.page.waitForTimeout(200);
  const writeish = await V.page.locator('[data-hk-shell] button').evaluateAll(bs => bs.map(b => b.innerText.trim()).filter(t => /invite|add|new|save|edit|delete|remove|import|connect/i.test(t)));
  const inputs = await V.page.locator('[data-hk-shell] input, [data-hk-shell] textarea, [data-hk-shell] select').count();
  ok('10 viewer: shell renders, no write controls', (await V.page.locator('[data-hk-shell]').count()) === 1 && !writeish.length && !inputs, writeish.join(', '));
  await V.ctx.close();

  // 2 phone
  const P = await open({ width: 390, height: 844 });
  await openHk(P.page);
  const tabs = await P.page.locator('.hk-tabbar button').allInnerTexts();
  const sizes = await P.page.locator('.hk-tabbar button').evaluateAll(bs => bs.map(b => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); }));
  await P.page.screenshot({ path: path.join(OUT, 'today-390.png') });
  const scrollW = await P.page.evaluate(() => document.documentElement.scrollWidth);
  await P.page.locator('[data-hk-tab="more"]').click(); await P.page.waitForTimeout(250);
  const sheet = await P.page.locator('[data-hk-more] button').allInnerTexts();
  const sheetSizes = await P.page.locator('[data-hk-more] button').evaluateAll(bs => bs.map(b => b.getBoundingClientRect().height));
  await P.page.screenshot({ path: path.join(OUT, 'more-sheet-390.png') });
  await P.page.locator('[data-hk-more] button', { hasText: 'Settings' }).click(); await P.page.waitForTimeout(250);
  await P.page.screenshot({ path: path.join(OUT, 'settings-members-390.png') });
  const scrollW2 = await P.page.evaluate(() => document.documentElement.scrollWidth);
  ok('2 phone: Today / Replies / Drafts / Brands / More', tabs.map(t => t.trim()).join('|') === 'Today|Replies|Drafts|Brands|More', tabs.map(t => t.trim()).join(' / '));
  ok('2 More sheet lists Inbox, Pipeline, Sponsors, Review, Activity, Settings, Back to Prospector, Sign out',
    sheet.map(t => t.trim()).join('|') === 'Inbox|Pipeline|Sponsors|Review|Activity|Settings|Back to Prospector|Sign out');
  ok('2 no horizontal scroll at 390', scrollW <= 390 && scrollW2 <= 390, `${scrollW} / ${scrollW2}`);
  ok('2 every tab and sheet target >= 44 px', Math.min(...sizes, ...sheetSizes) >= 44, `min ${Math.min(...sizes, ...sheetSizes)}`);
  if (P.errors.length) log('phone page errors:', P.errors.slice(0, 3));
  await P.ctx.close();

  ok('real-call guard: 0 requests to Anthropic, Apollo or Gmail hosts', !realCalls.length, realCalls.join(', '));
} catch (e) {
  ok(`run completed (${e.message.split('\n')[0]})`, false);
} finally {
  await cleanup();
  const hlAfter = await hlCounts();
  const movedT = HL_TABLES.filter(t => hlAfter[t] !== hlBefore[t]);
  log('HomeLover after', movedT.length ? `MOVED: ${movedT.join(', ')}` : '(unchanged)');
  const byKind = {}; blocked.forEach(b => { const k = b.replace(/\/[0-9a-f-]{36}/g, '/:id'); byKind[k] = (byKind[k] || 0) + 1; });
  log(`blocked requests: ${blocked.length}`, JSON.stringify(byKind));
  const passed = results.filter(r => r.pass).length;
  log(`RESULT ${passed}/${results.length} passed · screenshots: ${OUT}`);
  process.exit(passed === results.length && !movedT.length ? 0 : 1);
}
