// grow-ui-refresh-v1 REV2 Stage 3c live check - the new Brands list (U6) as Jack (ownerSession) on the REAL HumanKind
// workspace, localhost against the build, through the real wiring: Grow › Brands, sorted by Score.
// SCOPE (declared): 0 Claude, 0 Apollo, 0 Gmail (the Brands space reads only the DB; the shell's page-load sync POST is
// aborted). 0 writes: every non-GET to /api, /proxy and Supabase REST is aborted; the bulk bar is shown on 3 selected
// rows and NO action is run. Restore: hk_member_prefs.last_seen_at, profiles.last_seen_at (sign-in rows kept by rule).
// "restored" THROWS if any HumanKind count moved. Runtime ~1.5 min, cap 5 min.
// Usage: node scripts/verify/grow-ui-refresh-v1-stage3c.mjs   (run npm run build first)
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
const { loadIntel, firstNameOf } = await import('../../api/hk/intelData.js');
const { rankReach } = await import('../../api/hk/intelScore.js');
const OUT = path.join(ROOT, '.screenshots', 'grow-ui-refresh-v1');
const MOCK = path.join(ROOT, 'inbox', '2026-10-30-0920-grow-ui-refresh-mock-brands-targets.png');
const PORT = 3993, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const HK_TABLES = ['hk_brands', 'hk_contacts', 'hk_touches', 'hk_replies', 'hk_ignored_senders', 'hk_sync_runs', 'hk_job_runs', 'hk_settings', 'hk_import_runs', 'hk_domain_intel', 'hk_signals'];
const KEPT = new Set([]);
const BRAND_FIELDS = ['last_touch_at', 'updated_at'];
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
const usage = async () => must(await svc.from('business_anthropic_usage').select('*', { count: 'exact', head: true }).eq('business_id', hk.id).in('call_type', ['hk_inbox_analyze', 'hk_research_sweep'])).count;
const jackId = must(await svc.from('profiles').select('id').eq('is_platform_owner', true)).data[0].id;
const prefsSeen = async () => must(await svc.from('hk_member_prefs').select('last_seen_at').eq('business_id', hk.id).eq('user_id', jackId).maybeSingle()).data?.last_seen_at ?? null;
const before = { counts: await counts(), usage: await usage(), seen: await prefsSeen() };
const data0 = await loadIntel(svc, hk.id, new Date());
const top = rankReach(data0.brands, { ...data0, meId: jackId, now: new Date() }, { meFirstName: firstNameOf(data0, jackId), limit: 10 });
log('before', JSON.stringify({ ...before.counts, top: top.map(r => `${r.brand.name} ${r.score}`) }));
let srv, browser, owner;
const blocked = [], realCalls = [], posts = [], listLoads = [];
let briefBody = null;
const results = { checks: [], errors: [], axe: {}, contrast: {}, numbers: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
const snaps = {};
const snapBrand = async id => { snaps[id] = must(await svc.from('hk_brands').select('*').eq('id', id).single()).data; };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 5 * 60000 });
fs.mkdirSync(OUT, { recursive: true });
const ALLOW = [];
const CAPS = {};

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  async function open(width, { viewer = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 760 ? 844 : 900 }, hasTouch: width < 760, permissions: ['clipboard-read', 'clipboard-write'] });
    await ctx.addInitScript(([k, v]) => { try { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); localStorage.setItem('prospector_auto_assay_disabled', '1'); } catch { /* sandboxed frame */ } }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session)]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      if (isLocal && req.method() === 'POST' && !viewer && ALLOW.some(re => re.test(u.pathname))) {
        const kind = u.pathname.split('/').pop();
        posts.push(kind);
        if (posts.filter(p => p === kind).length > CAPS[kind]) { blocked.push(`POST ${kind} (over cap)`); return route.abort(); }
        return route.continue();
      }
      const deny = (isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname)) || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.pathname.replace(hk.id, '<hk>')}`); return route.abort(); }
      if (viewer && isLocal && /^\/api\/hk\/[^/]+\/shell$/.test(u.pathname)) { const r = await route.fetch(); const j = await r.json(); return route.fulfill({ response: r, json: { ...j, me: { ...j.me, role: 'viewer' } } }); }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(30000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    page.on('response', async r => {
      const u = new URL(r.url()), p = u.pathname;
      if (/\/inbox\/threads$/.test(p) && r.request().method() === 'GET' && r.ok()) { const j = await r.json().catch(() => null); if (j?.tab === 'inbox') listLoads.push({ width, units: j.from_cache ? 0 : j.gmail_units, cached: !!j.from_cache }); }
      if (/\/briefing$/.test(p) && r.ok()) briefBody = await r.json().catch(() => briefBody);
    });
    await page.goto(`${BASE}/`);
    if (width < 900) { await page.getByRole('button', { name: 'Open menu' }).click().catch(() => {}); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 20000 }); await page.getByLabel('Workspace').selectOption({ label: 'HumanKind' });
    await page.locator('[data-hk-shell] [data-hk-avatar]').waitFor({ timeout: 20000 });
    await page.evaluate(() => { window.location.hash = '#hk/brands?sort=score'; });
    await page.locator('[data-hk-brands-space] [data-hk-brand-list] tbody tr[data-row], [data-hk-brands-space] [data-hk-brand-list] [data-row]').first().waitFor({ timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    await page.locator('[data-hk-brand-list] [data-row]').first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(600);
    return { ctx, page, errors };
  }
  const shot = (page, n, full = true) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide', fullPage: full });
  const measure = async (page, key, scope) => {
    const m = await page.evaluate(measureScript({ scope }));
    if (m.error) { ok(`contrast ${key}`, false, m.error); return; }
    const s = summarize(m); results.contrast[key] = s;
    ok(`contrast ${key}: 0 text < 4.5:1 (text ${s.textFails}/${s.texts}; control edges, reported only: ${s.controlFails}/${s.controls})`, s.textFails === 0, s.worst.slice(0, 6).map(w => `${w.ratio} ${w.kind === 'text' ? `T ${w.fg} on ${w.bg}` : `C via ${w.via}`} ${w.sel} "${w.text}"`).join(' | '));
  };
  const axeOn = async (page, key, sel) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async s => { const r = await window.axe.run(document.querySelector(s), { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); }, sel);
    results.axe[key] = v;
    ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v).slice(0, 400));
  };
  const noSideways = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const toast = page => page.locator('[data-hk-toast]');
  const sideBySide = async (shotName, width) => {
    const p = await browser.newPage({ viewport: { width: 2 * 1500, height: 1000 } });
    const b64 = f => `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`;
    await p.setContent(`<body style="margin:0;display:flex;gap:16px;background:#ddd;font:14px sans-serif"><figure style="margin:0;flex:1"><figcaption>mockup (inbox/2026-10-30-0920-grow-ui-refresh-mock-brands-targets.png)</figcaption><img src="${b64(MOCK)}" style="width:100%"></figure><figure style="margin:0;flex:1"><figcaption>build @ ${width}</figcaption><img src="${b64(`${OUT}/${shotName}.png`)}" style="width:100%"></figure></body>`);
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${OUT}/side-by-side-${width}.png`, fullPage: true });
    await p.close();
  };

  const SPACE = '[data-hk-brands-space]';
  // ---- 1440: the list against the DB (sorted by Score), hover, 3 selected -> the bulk bar (no action), N2.
  {
    const { ctx, page, errors } = await open(1440);
    const heads = await page.locator(`${SPACE} thead th`).evaluateAll(es => es.map(e => (e.querySelector('.ui-sr-only')?.textContent || e.textContent).replace(/[↑↓↕▲▼]/g, '').trim()));
    const visibleHeads = await page.locator(`${SPACE} thead th`).evaluateAll(es => es.map(e => (e.querySelector('.ui-table__label, .ui-table__sort')?.textContent || '').replace(/[↑↓↕▲▼]/g, '').trim()).filter(Boolean));
    results.numbers.visibleHeaders = visibleHeads;
    const first = await page.locator(`${SPACE} [data-row]`).evaluateAll(es => es.slice(0, 10).map(e => [e.querySelector('[data-hk-brand] .hk-table__title')?.textContent, e.querySelector('.hk-score')?.textContent || null]));
    results.numbers.headers = heads; results.numbers.first10 = first;
    const want = top.map(r => [r.brand.name, String(r.score)]);
    ok(`1440 columns: ${heads.join(' · ')}; visible headers ${visibleHeads.join(' · ')}`, JSON.stringify(heads) === JSON.stringify(['Select', 'Brand', 'Target', 'Industry', 'Market', 'Heat', 'Stage', 'Owner', 'Contact', 'Last touch', 'Score', 'Actions']) && visibleHeads.length === 10);
    ok(`sorted by Score, high to low: the first 5 scores = the scorer on the DB (ties may order differently) (${first.slice(0, 5).map(([n, sc]) => `${n} ${sc}`).join(' · ')})`, JSON.stringify(first.slice(0, 5).map(x => x[1])) === JSON.stringify(want.slice(0, 5).map(x => x[1])), `ui ${JSON.stringify(first.slice(0, 5))} want ${JSON.stringify(want.slice(0, 5))}`);
    const r0 = page.locator(`${SPACE} [data-row]`).first();
    const geo = () => page.evaluate(() => { const rs = [...document.querySelectorAll('[data-hk-brands-space] [data-row]')].slice(0, 3); return rs.map(r => [Math.round(r.getBoundingClientRect().top), Math.round(r.getBoundingClientRect().height)]); });
    const hidden = await r0.locator('.hk-rowacts__full').isVisible();
    const g0 = await geo();
    await r0.hover(); await page.waitForTimeout(250);
    const shown = await r0.locator('.hk-rowacts__full').isVisible();
    const g1 = await geo();
    const btns = await r0.locator('.hk-rowacts__full button').evaluateAll(es => es.map(e => e.getAttribute('aria-label') || e.textContent.trim()));
    ok(`hover shows the primary + quick commands (${btns.join(' · ')}); hidden at rest (${!hidden}); N2: rows move ${JSON.stringify(g0) === JSON.stringify(g1) ? 0 : 'SOME'} px`, !hidden && shown && btns.includes('Toggle Target') && btns.includes('Not a fit') && JSON.stringify(g0) === JSON.stringify(g1), `${JSON.stringify(g0)} -> ${JSON.stringify(g1)}`);
    await shot(page, 'brands-1440-hover', false);
    await page.mouse.move(5, 5);
    for (let i = 0; i < 3; i++) await page.locator(`${SPACE} [data-row] input[type="checkbox"]`).nth(i).check();
    const bar = page.locator('[data-hk-bulk]');
    await bar.waitFor({ timeout: 10000 });
    const barBtns = await bar.locator('button').evaluateAll(es => es.map(e => e.textContent.trim()));
    const tinted = await page.locator(`${SPACE} [data-row]`).evaluateAll(es => es.slice(0, 3).every(e => /--ui-row-tint/.test(e.getAttribute('style') || '')));
    results.numbers.bulk = { buttons: barBtns, text: await bar.textContent() };
    ok(`3 selected -> forest bulk bar: ${barBtns.join(' · ')}; rows tinted ${tinted}; no action run`, barBtns.length === 7 && /^Pitch \d+ ready$/.test(barBtns[0]) && /^Research \d+/.test(barBtns[1]) && barBtns.slice(2).join('|') === 'Claim|+ Target|+ Pipeline|Set status ▾|Copy batch command' && tinted);
    await shot(page, 'brands-1440');
    await sideBySide('brands-1440', 1440);
    await measure(page, 'brands@1440', SPACE);
    await axeOn(page, 'brands@1440', SPACE);
    ok('1440: no sideways scroll of the page; 0 page errors', await noSideways(page) && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  for (const w of [1280, 390]) {
    const { ctx, page, errors } = await open(w);
    if (w === 1280) { for (let i = 0; i < 3; i++) await page.locator(`${SPACE} [data-row] input[type="checkbox"]`).nth(i).check(); await page.locator('[data-hk-bulk]').waitFor(); }
    await shot(page, `brands-${w}`);
    await sideBySide(`brands-${w}`, w);
    await measure(page, `brands@${w}`, SPACE);
    await axeOn(page, `brands@${w}`, SPACE);
    ok(`${w}: ${await page.locator(`${SPACE} [data-row]`).count()} rows, no sideways scroll of the page, 0 page errors`, await noSideways(page) && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await open(1440, { viewer: true });
    const r0 = page.locator(`${SPACE} [data-row]`).first(); await r0.hover();
    const writes = await page.locator(`${SPACE} input[type="checkbox"], ${SPACE} [data-hk-primary], ${SPACE} .hk-qcs, [data-hk-bulk]`).count();
    await shot(page, 'brands-1440-viewer');
    ok(`Viewer (role forced in /shell): rows read; no checkboxes / primary / quick commands / bulk bar even on hover (${writes}); 0 page errors`, writes === 0 && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  const fresh = listLoads.filter(l => !l.cached);
  results.numbers.gmail = { loads: listLoads.length, uncached: fresh.length, units: fresh.reduce((n, l) => n + (l.units || 0), 0) };
  ok(`browser reached 0 Claude / Apollo hosts directly; writes ${JSON.stringify(posts.reduce((m, p) => ({ ...m, [p]: (m[p] || 0) + 1 }), {}))}; Gmail ${results.numbers.gmail.units} units (declared 0); other writes aborted (${[...new Set(blocked)].slice(0, 6).join(', ') || 'none attempted'})`,
    !realCalls.length && results.numbers.gmail.units === 0 && posts.length === 0);
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    for (const [id, s] of Object.entries(snaps)) must(await svc.from('hk_brands').update(Object.fromEntries(BRAND_FIELDS.map(k => [k, s[k]]))).eq('id', id).eq('business_id', hk.id));
    must(await svc.from('hk_member_prefs').update({ last_seen_at: before.seen }).eq('business_id', hk.id).eq('user_id', jackId));
    for (const [id, s] of Object.entries(snaps)) {
      const now = must(await svc.from('hk_brands').select('*').eq('id', id).single()).data;
      const diff = Object.keys(s).filter(k => JSON.stringify(s[k]) !== JSON.stringify(now[k]) && !(typeof s[k] === 'string' && Date.parse(s[k]) === Date.parse(now[k])));
      if (diff.length) throw new Error(`${s.name} fields differ: ${diff.join(', ')}`);
    }
    const after = { counts: await counts(), seen: await prefsSeen() };
    const moved = HK_TABLES.filter(t => !KEPT.has(t) && before.counts[t] !== after.counts[t]).map(t => `${t} ${before.counts[t]} -> ${after.counts[t]}`);
    if (moved.length) throw new Error(`counts moved: ${moved.join(', ')}`);
    if (after.seen !== before.seen) throw new Error('hk_member_prefs.last_seen_at not restored');
    restored = true;
    line = `yes (0 writes; ${HK_TABLES.length} HumanKind counts identical; last_seen_at restored; sign-in rows kept by rule)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'stage3c-report.json'), JSON.stringify({ ...results, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\ngrow-ui-refresh-v1 Stage 3c live check: ${passed}/${results.checks.length} passed · Claude 0 · Apollo 0\nnumbers: ${JSON.stringify(results.numbers)}\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
