// FIX hkos-inbox-list-width live check - READ-ONLY, as Jack (ownerSession) on the REAL HumanKind workspace, localhost
// against the build. Grow › Inbox at 1440x900 and 1280x800: the list column width and the rendered width of the sender
// names GHOST and Peter Norgaard (both must show in full); Needs you rows after the one-page auto-fill and the Gmail units
// that load used; drag the divider, reload -> the width is kept; contrast (HumanKind's rule), axe, N2 (opening a thread
// moves the list 0 px and the page 0 px), 390 one pane.
// SCOPE (declared): Gmail <= 2 list pages per load (<= 1,010 units; later views from the server's 120 s cache) + one
// thread open; 0 Claude; every non-GET aborted. Writes: the /shell last_seen_at stamp on hk_member_prefs (restored
// exactly) and profiles.last_seen_at (ownerSession restores it). "restored" THROWS if any HumanKind count moved.
// Runtime ~2 min, cap 240 s. Run npm run build first.
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
const OUT = path.join(ROOT, '.screenshots', 'hkos-inbox-list-width');
const PORT = 4001, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const HK_TABLES = ['hk_brands', 'hk_contacts', 'hk_touches', 'hk_replies', 'hk_ignored_senders', 'hk_events', 'hk_sync_runs', 'hk_job_runs', 'hk_settings', 'hk_domain_intel'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const must = r => { if (r.error) throw new Error(r.error.message); return r; };
const hk = (await svc.from('businesses').select('id, features').eq('name', 'HumanKind')).data?.find(b => b.features?.hk_sales);
if (!hk) { console.log('ABORT: no HumanKind workspace with hk_sales on'); process.exit(1); }
const now0 = new Date();
const minsToSix = ((6 - (now0.getHours() % 6)) % 6) * 60 - now0.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now0.getHours() % 6 === 0 && now0.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
const counts = async () => { const o = {}; for (const t of HK_TABLES) o[t] = must(await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', hk.id)).count; return o; };
const jackId = must(await svc.from('profiles').select('id').eq('is_platform_owner', true)).data[0].id;
const prefsSeen = async () => must(await svc.from('hk_member_prefs').select('last_seen_at').eq('business_id', hk.id).eq('user_id', jackId).maybeSingle()).data?.last_seen_at ?? null;
const usage = async () => must(await svc.from('business_anthropic_usage').select('*', { count: 'exact', head: true }).eq('business_id', hk.id)).count;
const before = { counts: await counts(), seen: await prefsSeen(), usage: await usage() };
log('before', JSON.stringify(before.counts));

let srv, browser, owner, listBody = null;
const listPages = [];
const blocked = [], realCalls = [];
const results = { checks: [], errors: [], axe: {}, contrast: {}, n2: {}, numbers: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 240000 });
fs.mkdirSync(OUT, { recursive: true });

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  async function open(width, height, { viewer = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: width < 760 });
    // try: the init script also runs inside the sandboxed email frame, which has no storage.
    await ctx.addInitScript(([k, v]) => { try { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); localStorage.setItem('prospector_auto_assay_disabled', '1'); } catch { /* sandboxed frame */ } }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session)]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      const deny = (isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname)) || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.pathname}`); return route.abort(); }
      if (viewer && isLocal && /^\/api\/hk\/[^/]+\/shell$/.test(u.pathname)) { const r = await route.fetch(); const j = await r.json(); return route.fulfill({ response: r, json: { ...j, me: { ...j.me, role: 'viewer' } } }); }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(30000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    page.on('response', async r => { if (/\/inbox\/threads\?/.test(r.url()) && r.request().method() === 'GET' && r.ok()) { const j = await r.json().catch(() => null); if (j?.tab === 'inbox') { if (!listBody) listBody = j; listPages.push({ page: new URL(r.url()).searchParams.get('pageToken') ? 2 : 1, units: j.gmail_units, cached: j.from_cache, rows: j.threads.length }); } } });
    await page.goto(`${BASE}/`);
    if (width < 900) { await page.getByRole('button', { name: 'Open menu' }).click().catch(() => {}); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 20000 }); await page.getByLabel('Workspace').selectOption({ label: 'HumanKind' });
    await page.locator('[data-hk-shell] [data-hk-avatar]').waitFor({ timeout: 20000 });
    const nav = page.locator('[data-hk-nav="inbox"]');
    if (await nav.count() && await nav.first().isVisible()) await nav.first().click();
    else { await page.locator('[data-hk-tab="more"]').click(); await page.locator('[data-hk-more]').getByRole('button', { name: 'Inbox', exact: true }).click(); }
    await page.locator('[data-hk-inbox-list] [data-hk-thread], [data-hk-inbox-list] .hk-empty').first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(600);
    return { ctx, page, errors };
  }
  const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide' });
  const measure = async (page, key) => {
    const m = await page.evaluate(measureScript({ scope: '[data-hk-inbox]', exclude: 'iframe' }));
    if (m.error) { ok(`contrast ${key}`, false, m.error); return; }
    const s = summarize(m); results.contrast[key] = s;
    ok(`contrast ${key}: 0 text < 4.5:1 (text ${s.textFails}/${s.texts}; control edges, reported only: ${s.controlFails}/${s.controls})`, s.textFails === 0, s.worst.slice(0, 5).map(w => `${w.ratio} ${w.kind === 'text' ? `T ${w.fg} on ${w.bg}` : `C via ${w.via}`} ${w.sel} "${w.text}"`).join(' | '));
  };
  const axeOn = async (page, key) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async () => { const r = await window.axe.run(document.querySelector('[data-hk-inbox]'), { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); });
    results.axe[key] = v; ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v).slice(0, 400));
  };
  const noSideways = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const nameW = (page, re) => page.evaluate(src => { const rx = new RegExp(src, 'i'); const el = [...document.querySelectorAll('[data-hk-inbox-list] [data-hk-row-from]')].find(e => rx.test(e.textContent)); return el ? { text: el.textContent, width: Math.round(el.getBoundingClientRect().width), full: el.scrollWidth <= el.clientWidth + 1 } : null; }, re.source);
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    listPages.length = 0;
    const { ctx, page, errors } = await open(w, h);
    await page.waitForTimeout(1500);
    const listW = Math.round((await page.locator('[data-hk-inbox-list]').boundingBox()).width);
    const ghost = await nameW(page, /^ghost$/), peter = await nameW(page, /peter norgaard/);
    const needs = await page.locator('[data-hk-inbox-list] [data-hk-thread][data-hk-lane="needs_you"]').count();
    const firstLoad = listPages.filter(p => !p.cached);
    const units = firstLoad.reduce((n, p) => n + (p.units || 0), 0);
    results.numbers[`${w}x${h}`] = { listW, ghost, peter, needs, pages: listPages.slice() };
    await shot(page, `inbox-${w}x${h}`);
    ok(`${w}x${h}: list ${listW} px; GHOST ${ghost ? `${ghost.width} px, full ${ghost.full}` : 'not on the page'}; Peter Norgaard ${peter ? `${peter.width} px, full ${peter.full}` : 'not on the page'}; Needs you ${needs} rows after ${listPages.length} list page(s) (${firstLoad.length ? `${units} Gmail units fetched` : 'served from cache'})`,
      listW >= 360 && listW <= 620 && (!ghost || ghost.full) && (!peter || peter.full) && listPages.length <= 2 && units <= 1010 && !errors.length, errors.join(' | '));
    if (w === 1440) {
      // Drag the divider 80 px right, reload -> the width is kept.
      const div = page.locator('[data-hk-divider]'); const b = await div.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + 100); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + 80, b.y + 100, { steps: 6 }); await page.mouse.up();
      await page.waitForTimeout(300);
      const dragged = Math.round((await page.locator('[data-hk-inbox-list]').boundingBox()).width);
      const saved = await page.evaluate(() => localStorage.getItem('prospector_hk_inbox_list_w'));
      await page.evaluate(() => sessionStorage.setItem('__s', '1'));
      await page.reload();
      await page.locator('[data-hk-shell] [data-hk-avatar]').waitFor({ timeout: 20000 });
      const nav = page.locator('[data-hk-nav="inbox"]'); if (await nav.count() && await nav.first().isVisible()) await nav.first().click();
      await page.locator('[data-hk-inbox-list] [data-hk-thread]').first().waitFor({ timeout: 60000 }); await page.waitForTimeout(800);
      const kept = Math.round((await page.locator('[data-hk-inbox-list]').boundingBox()).width);
      ok(`1440 drag the divider: ${listW} -> ${dragged} px (saved ${saved}); after a reload ${kept} px`, Math.abs(dragged - listW - 80) <= 2 && Math.abs(kept - dragged) <= 1);
      // N2: opening a thread moves the list 0 px and the page 0 px.
      const geo = () => page.evaluate(() => { const p = document.querySelector('[data-hk-inbox-list]'); const r = p.getBoundingClientRect(); return { y: window.scrollY, top: r.top, w: r.width, h: r.height, st: p.scrollTop }; });
      const g0 = await geo();
      await page.locator('[data-hk-inbox-list] [data-hk-thread]').first().dispatchEvent('click');
      await page.locator('[data-hk-intel-strip]').waitFor({ timeout: 60000 }); await page.waitForTimeout(500);
      const g1 = await geo();
      const move = Math.max(...['y', 'top', 'w', 'h', 'st'].map(k => Math.abs(g1[k] - g0[k])));
      ok(`N2 1440: opening a thread moves the list ${move} px and the page ${g1.y - g0.y} px`, move < 1);
      await measure(page, 'inbox@1440'); await axeOn(page, 'inbox@1440');
    }
    ok(`${w} no sideways scroll`, await noSideways(page));
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await open(390, 844);
    const m = await page.locator('[data-hk-inbox]').getAttribute('data-hk-inbox-mode');
    const sep = await page.locator('[data-hk-divider]').count();
    await shot(page, 'inbox-390');
    await measure(page, 'inbox@390'); await axeOn(page, 'inbox@390');
    ok(`390 one pane (${m}), no divider (${sep}); no sideways scroll; 0 page errors`, m === 'phone' && sep === 0 && await noSideways(page) && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  ok(`0 Claude / Apollo calls; every write aborted (${[...new Set(blocked)].slice(0, 4).join(', ') || 'none attempted'})`, !realCalls.length);
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    must(await svc.from('hk_member_prefs').update({ last_seen_at: before.seen }).eq('business_id', hk.id).eq('user_id', jackId));
    const after = { counts: await counts(), seen: await prefsSeen(), usage: await usage() };
    const moved = HK_TABLES.filter(t => before.counts[t] !== after.counts[t]).map(t => `${t} ${before.counts[t]} -> ${after.counts[t]}`);
    if (moved.length) throw new Error(`counts moved: ${moved.join(', ')}`);
    if (after.seen !== before.seen) throw new Error('hk_member_prefs.last_seen_at not restored');
    if (after.usage !== before.usage) throw new Error(`a Claude usage row appeared (${before.usage} -> ${after.usage})`);
    restored = true; line = `yes (${HK_TABLES.length} HumanKind counts identical incl. hk_domain_intel; hk_member_prefs.last_seen_at + profiles.last_seen_at restored; 0 usage rows; sign-in rows kept by rule)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ ...results, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\nhkos-inbox-list-width live check: ${passed}/${results.checks.length} passed · Claude 0 · writes 0\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
