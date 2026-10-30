// grow-nav-filters-v1 Stage 3 live check - as Jack (ownerSession) on the REAL HumanKind workspace, localhost against the
// build, through the real wiring: the rail (spaces, buckets, counts), the active-filter line, the address, the one
// search, ONE saved view saved -> reload -> removed, the old links, Pipeline (252) and Sponsors (68 / 132), Inbox ›
// Needs you Gmail units, 1440 / 1280 / 390 with the rail expanded and collapsed, contrast (text + the dot table), axe,
// N2 (the list never jumps), keyboard-only rail, and a Viewer pass (role forced in /shell).
// SCOPE (declared): reads only, except PUT /me/prefs (the one saved view + rail collapse state from the keyboard check),
// restored to its snapshot exactly at the end. Gmail = ONE Inbox open (Needs you; <= 2 list pages, efc26b2 measured 930
// units); every later view inside 120 s is the server cache. 0 Claude, 0 Apollo. Every other non-GET to /api, /proxy and
// Supabase REST is aborted (page-load jobs, sync, owner-toggle PATCH, signals seen), as is every outside host but Google
// Fonts. Counts are compared to GET /brands run in-process on the DB (never to the UI's own numbers). KEPT by rule:
// hk_events, sign-in rows. "restored" THROWS if anything else moved. Runtime ~3 min, cap 300 s.
// Usage: node scripts/verify/grow-nav-filters-v1-stage3.mjs [--no-gmail]   (run npm run build first)
//   --no-gmail: Inbox opens on Tracked replies, never a Gmail lane (0 Gmail) - for a re-run after the units are measured.
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
const { listBrandsRoute } = await import('../../api/hk/brandsRoutes.js');
const OUT = path.join(ROOT, '.screenshots', 'grow-nav-filters-v1');
const NO_GMAIL = process.argv.includes('--no-gmail');
const PORT = 3994, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const HK_TABLES = ['hk_brands', 'hk_contacts', 'hk_touches', 'hk_replies', 'hk_ignored_senders', 'hk_sync_runs', 'hk_job_runs', 'hk_settings', 'hk_import_runs', 'hk_domain_intel', 'hk_signals', 'hk_sponsor_periods'];
// Stage 2's prod facets (9e089d2 report) - every bucket on the rail must match the DB now, and these unless data moved.
const STAGE2 = { view: { all: 953, pipeline: 252, my_open: 29, unclaimed: 611, overdue: 96, sponsors: 68, dnc: 0, hot: 0, targets: 0 }, segment: { sponsor_brand: 886, press: 32, podcast: 30, nonprofit: 5 }, due: { overdue: 96, week: 11, later: 8, none: 838 } };
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const must = r => { if (r.error) throw new Error(r.error.message); return r; };
const hk = (await svc.from('businesses').select('id, features').eq('name', 'HumanKind')).data?.find(b => b.features?.hk_sales);
if (!hk) { console.log('ABORT: no HumanKind workspace with hk_sales on'); process.exit(1); }
const min = new Date().getMinutes();
if (min >= 56 || min < 4) { console.log('ABORT: within 4 min of the hourly HumanKind cron sync'); process.exit(1); }
const counts = async () => { const o = {}; for (const t of HK_TABLES) o[t] = must(await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', hk.id)).count; return o; };
const jackId = must(await svc.from('profiles').select('id').eq('is_platform_owner', true)).data[0].id;
const prefsRow = async () => must(await svc.from('hk_member_prefs').select('*').eq('business_id', hk.id).eq('user_id', jackId).maybeSingle()).data;
const before = { counts: await counts(), prefs: await prefsRow() };
if (before.prefs?.saved_views?.length) { console.log('ABORT: Jack already has saved views - this check only adds and removes its own'); process.exit(1); }
// The DB truth: GET /brands?page= run in-process on the service client (the same route the browser calls).
const api = async query => { const r = { code: 200 }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; await listBrandsRoute({ params: { businessId: hk.id }, query: { page: '1', limit: '1', ...query }, auth: { user: { id: jackId } } }, r, { supabase: svc }); if (r.code !== 200) throw new Error(JSON.stringify(r.body)); return r.body; };
const dbAll = await api({ facets: '1' });
log('before', JSON.stringify({ ...before.counts, prefs: before.prefs ? { owner_filter: before.prefs.owner_filter, saved: before.prefs.saved_views.length, rail: before.prefs.rail } : null, total: dbAll.total }));

let srv, browser, owner;
const blocked = [], realCalls = [], writes = [], listLoads = [];
const results = { checks: [], axe: {}, contrast: {}, dots: [], buckets: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
let restoredLine = 'NOT RUN';
async function restore() {
  if (before.prefs) { const { business_id, user_id, ...rest } = before.prefs; must(await svc.from('hk_member_prefs').update(rest).eq('business_id', hk.id).eq('user_id', jackId)); }
}
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; await restore(); if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 300000 });
fs.mkdirSync(OUT, { recursive: true });

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  async function open(width, { viewer = false, hash = '#hk/brands', all = true } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 760 ? 844 : 900 }, hasTouch: width < 760 });
    await ctx.addInitScript(([k, v]) => { try { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); localStorage.setItem('prospector_auto_assay_disabled', '1'); } catch { /* sandboxed frame */ } }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session)]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      if (isLocal && req.method() === 'PUT' && /^\/api\/hk\/[^/]+\/me\/prefs$/.test(u.pathname) && !viewer) { writes.push(req.postData()); return route.continue(); }
      const deny = (isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname)) || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.pathname.replace(hk.id, '<hk>')}`); return route.abort(); }
      if (viewer && isLocal && /^\/api\/hk\/[^/]+\/shell$/.test(u.pathname)) { const r = await route.fetch(); const j = await r.json(); return route.fulfill({ response: r, json: { ...j, me: { ...j.me, role: 'viewer' } } }); }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(30000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    page.on('response', async r => {
      const p = new URL(r.url()).pathname;
      if (/\/inbox\/threads$/.test(p) && r.request().method() === 'GET' && r.ok()) { const j = await r.json().catch(() => null); if (j?.tab === 'inbox') listLoads.push({ width, units: j.from_cache ? 0 : j.gmail_units, calls: j.from_cache ? 0 : j.gmail_calls, cached: !!j.from_cache }); }
    });
    await page.goto(`${BASE}/${hash}`);
    await page.locator('[data-hk-shell]').waitFor({ timeout: 30000 });
    if (all) { const b = page.getByRole('group', { name: 'Whose work' }).getByRole('button', { name: 'All' }); await b.waitFor(); await b.click(); }
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    return { ctx, page, errors };
  }
  const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide', fullPage: false });
  const measure = async (page, key, scope) => {
    const m = await page.evaluate(measureScript({ scope }));
    if (m.error) { ok(`contrast ${key}`, false, m.error); return; }
    const s = summarize(m); results.contrast[key] = s;
    ok(`contrast ${key}: 0 text < 4.5:1 (text ${s.textFails}/${s.texts})`, s.textFails === 0, s.worst.slice(0, 6).map(w => `${w.ratio} ${w.kind === 'text' ? `T ${w.fg} on ${w.bg}` : `C via ${w.via}`} ${w.sel} "${w.text}"`).join(' | '));
  };
  const axeOn = async (page, key, sel) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async s => { const r = await window.axe.run(document.querySelector(s), { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); }, sel);
    results.axe[key] = v;
    ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v).slice(0, 400));
  };
  const noSideways = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const railItems = page => page.locator('[data-hk-rail] [data-hk-filter]').evaluateAll(es => es.map(e => [e.dataset.hkFilter, Number((e.querySelector('.hk-bucket__n')?.textContent || '').replace(/,/g, '')) || 0]));
  const resultCount = async page => Number(((await page.locator('[data-hk-result-count]').textContent()) || '').replace(/[^0-9]/g, ''));
  const waitCount = async (page, n) => { await page.waitForFunction(want => Number((document.querySelector('[data-hk-result-count]')?.textContent || '').replace(/[^0-9]/g, '')) === want && !document.querySelector('[aria-busy="true"]'), n, { timeout: 30000 }).catch(() => {}); return resultCount(page); };

  // ---- 1440: buckets vs the DB, a combined filter, the address, save -> reload -> remove, search, views.
  {
    const { ctx, page, errors } = await open(1440);
    await page.locator('[data-hk-filter="stage:sent"]').waitFor();
    await waitCount(page, dbAll.total);
    const items = await railItems(page);
    const want = []; for (const [k, vals] of Object.entries(dbAll.facets)) for (const [v, n] of vals) want.push([`${k === 'view' ? 'views' : k}:${k === 'owner' && v === jackId ? 'me' : v}`, n]);
    const ui = Object.fromEntries(items), miss = want.filter(([id, n]) => ui[id] !== n);
    for (const [id, n] of want) { const [k, v] = id.split(/:(.*)/s); (results.buckets[k] ||= {})[v] = n; }
    ok(`1440 every rail count = GET /brands facets on the DB (${want.length} values in ${Object.keys(dbAll.facets).length} buckets)`, !miss.length && items.length === want.length, `mismatch ${JSON.stringify(miss).slice(0, 300)} · ui ${items.length}`);
    const drift = [];
    for (const [k, vals] of Object.entries(STAGE2)) for (const [v, n] of Object.entries(vals)) { const now = (dbAll.facets[k] || []).find(([x]) => x === v)?.[1] ?? 0; if (now !== n) drift.push(`${k}.${v} ${n}->${now}`); }
    ok(`Stage 2 numbers still hold on prod (${drift.length ? `moved: ${drift.join(', ')}` : 'views, segment, due unchanged'})`, !drift.length);
    ok(`views always listed, even at 0 (Do not contact ${ui['views:dnc']}, Hot leads ${ui['views:hot']}, Targets ${ui['views:targets']})`, ['dnc', 'hot', 'targets'].every(v => `views:${v}` in ui));
    ok('the nav has no Replies / Drafts / Pipeline / Sponsors items (spaces: Today · Inbox · Brands; Workspace: Review · Activity · Settings)', (await page.locator('[data-hk-nav="replies"], [data-hk-nav="drafts"], [data-hk-nav="pipeline"], [data-hk-nav="sponsors"]').count()) === 0 && JSON.stringify(await page.locator('[data-hk-rail] [data-hk-nav]').evaluateAll(es => es.map(e => e.dataset.hkNav))) === JSON.stringify(['today', 'inbox', 'brands', 'review', 'activity', 'settings']));
    await shot(page, 'brands-1440-rail-expanded');
    await measure(page, 'rail@1440', '[data-hk-rail]');
    await measure(page, 'brands@1440', '[data-hk-brands-space]');
    await axeOn(page, 'brands@1440', '[data-hk-shell]');
    // The dot table: every dot shown against the rail (sand) - 3:1 for a graphic beside its word.
    results.dots = await page.evaluate(() => {
      const lum = c => { const [r, g, b] = c.match(/\d+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100; };
      const bg = getComputedStyle(document.querySelector('[data-hk-rail]')).backgroundColor;
      const seen = {}; for (const d of document.querySelectorAll('[data-hk-rail] .hk-dot')) { const cls = [...d.classList].find(c => c.startsWith('hk-dot--')); if (!seen[cls]) seen[cls] = { cls, fill: getComputedStyle(d).backgroundColor, ratio: ratio(getComputedStyle(d).backgroundColor, bg), label: d.nextElementSibling?.textContent }; }
      return Object.values(seen);
    });
    ok(`dot table (${results.dots.length} dots, each beside its word): ${results.dots.map(d => `${d.label} ${d.ratio}`).join(' · ')}`, results.dots.length > 0);

    // Stage › Sent + Owner › no member owner (Unclaimed + Sheet: Pete); N2: the rail and page do not jump.
    await page.locator('[data-hk-filter="stage:sent"]').click();
    await page.locator('[data-hk-filter="owner:unclaimed"]').click();
    await page.locator('[data-hk-filter="owner:sheet:pete"]').scrollIntoViewIfNeeded();
    await waitCount(page, (await api({ stage: 'sent', owner: 'unclaimed' })).total);
    const pos0 = await page.evaluate(() => ({ rail: document.querySelector('[data-hk-rail]').scrollTop, y: window.scrollY }));
    await page.locator('[data-hk-filter="owner:sheet:pete"]').click();
    const db = await api({ stage: 'sent', owner: 'unclaimed,sheet:pete' });
    const got = await waitCount(page, db.total);
    const pos1 = await page.evaluate(() => ({ rail: document.querySelector('[data-hk-rail]').scrollTop, y: window.scrollY }));
    ok(`Stage › Sent + Owner › Unclaimed + Sheet: Pete -> ${got} (DB ${db.total}; Stage 2 said 101)`, got === db.total && db.total === 101);
    ok(`N2: the rail (${pos0.rail}->${pos1.rail}) and the page (${pos0.y}->${pos1.y}) did not jump`, pos0.rail === pos1.rail && pos0.y === pos1.y);
    const hash = await page.evaluate(() => window.location.hash);
    ok(`the address carries it: ${hash}`, hash === '#hk/brands?stage=sent&owner=unclaimed,sheet:pete');
    const chips = await page.locator('[data-hk-active-chip]').allTextContents();
    ok(`active-filter chips: ${chips.join(' | ')}`, chips.length === 3);
    const share = await ctx.newPage(); await share.goto(`${BASE}/${hash}`); await share.locator('[data-hk-result-count]').waitFor();
    await share.getByRole('group', { name: 'Whose work' }).getByRole('button', { name: 'All' }).click();
    ok(`a pasted link opens the same view (${await waitCount(share, db.total)})`, (await resultCount(share)) === db.total);
    await share.close();
    await shot(page, 'brands-1440-sent-no-member-owner');

    // N7: save -> reload -> still under Views -> remove.
    await page.locator('[data-hk-save-view]').click();
    await page.locator('[data-hk-view-name]').fill('Sent, unclaimed');
    await page.locator('[data-hk-save-view-confirm]').click();
    await page.waitForFunction(() => document.querySelector('[data-hk-rail]')?.textContent.includes('Sent, unclaimed'));
    const saved = (await prefsRow()).saved_views;
    ok(`saved: hk_member_prefs.saved_views = [${saved.map(v => `${v.name} ${JSON.stringify(v.filters)}`).join(', ')}]`, saved.length === 1 && saved[0].name === 'Sent, unclaimed' && !JSON.stringify(saved).includes('@'));
    await page.reload(); await page.locator('[data-hk-shell]').waitFor();
    await page.getByRole('group', { name: 'Whose work' }).getByRole('button', { name: 'All' }).click();
    const after = page.locator('[data-hk-rail] [data-hk-filter^="views:saved:"]');
    await after.first().waitFor();
    ok(`after reload it is under Views ("${await after.first().textContent()}", pressed ${await after.first().getAttribute('aria-pressed')})`, (await after.count()) === 1);
    await page.locator('[data-hk-remove-view]').click();
    await page.waitForFunction(() => !document.querySelector('[data-hk-rail] [data-hk-filter^="views:saved:"]'));
    ok('removed: saved_views back to []', (await prefsRow()).saved_views.length === 0);

    // N6: "pod" -> Segment › Podcast (30) -> Enter -> the podcast brands.
    await page.goto(`${BASE}/#hk/brands`); await page.reload(); await page.locator('[data-hk-shell]').waitFor();
    await page.getByRole('group', { name: 'Whose work' }).getByRole('button', { name: 'All' }).click();
    await page.locator('[data-hk-filter="stage:sent"]').waitFor();
    await waitCount(page, dbAll.total);
    await page.locator('[data-hk-result-count]').click();
    await page.keyboard.press('/');
    await page.locator('[data-hk-search-input]').fill('pod');
    const hit = page.locator('[data-hk-search-hit="f-segment:podcast"]');
    await hit.waitFor();
    const hitText = (await hit.textContent()).trim();
    const pod = await api({ segment: 'podcast' });
    await page.locator('[data-hk-search-hit^="b-"], [data-hk-palette] .hk-palette__none').first().waitFor({ timeout: 10000 }).catch(() => {});
    const recs = await page.locator('[data-hk-search-hit^="b-"]').allTextContents();
    await shot(page, 'search-pod-1440');
    await page.locator('[data-hk-search-input]').press('Enter');
    const podN = await waitCount(page, pod.total);
    ok(`search "pod": "${hitText}" -> ${podN} podcast brands (DB ${pod.total}); brand records: ${recs.length ? recs.join(' | ') : 'none named pod'}`, /Segment › Podcast/.test(hitText) && hitText.includes(`(${pod.total})`) && podN === pod.total && pod.total === 30);

    // Views › Pipeline (by stage) and Views › Sponsors (hosted screen).
    await page.locator('[data-hk-filter="views:pipeline"]').click();
    const pipe = await api({ view: 'pipeline' });
    const pipeN = await waitCount(page, pipe.total);
    const groups = await page.locator('tr[data-group]').count();
    ok(`Views › Pipeline: ${pipeN} brands (DB ${pipe.total}, old Pipeline 252), By stage pressed, ${groups} stage groups`, pipeN === pipe.total && pipe.total === 252 && (await page.locator('[data-hk-layout-btn="stage"]').getAttribute('aria-pressed')) === 'true');
    await shot(page, 'pipeline-by-stage-1440');
    await page.locator('[data-hk-filter="views:sponsors"]').click();
    await page.locator('[data-hk-sponsors]').waitFor();
    await page.locator('[data-hk-sponsor]').first().waitFor();
    const sp = await page.locator('[data-hk-sponsor]').count(), periods = await page.locator('[data-hk-sponsor] .hk-period-chips .hk-chip').count();
    const dbPeriods = must(await svc.from('hk_sponsor_periods').select('*', { count: 'exact', head: true }).eq('business_id', hk.id)).count;
    ok(`Views › Sponsors hosts the Sponsors screen: ${sp} sponsors, ${periods} periods (DB ${dbPeriods}; spec 68 / 132), Add sponsor ${await page.locator('[data-hk-add-sponsor]').count() ? 'shown' : 'absent'}`, sp === 68 && periods === dbPeriods && dbPeriods === 132);
    await shot(page, 'sponsors-view-1440');

    // Collapsed rail: 56 px, a bucket flyout; "[" expands again.
    await page.locator('[data-hk-filter="views:all"]').click();
    await waitCount(page, dbAll.total);
    await page.locator('[data-hk-rail-toggle]').click();
    const w = await page.locator('[data-hk-rail="narrow"]').evaluate(e => e.getBoundingClientRect().width);
    await page.locator('[data-hk-rail-bucket="stage"]').click();
    await page.locator('[data-hk-flyout="stage"]').waitFor();
    const fly = await page.locator('[data-hk-flyout="stage"]').evaluate(e => { const r = e.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 20); return { x: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), onTop: e.contains(hit) }; });
    ok(`collapsed flyout is on screen beside the rail (x ${fly.x}, ${fly.w}x${fly.h}, topmost ${fly.onTop})`, fly.x >= 56 && fly.w > 200 && fly.h > 100 && fly.onTop);
    await shot(page, 'brands-1440-rail-collapsed');
    await axeOn(page, 'rail-collapsed@1440', '[data-hk-rail]');
    await page.keyboard.press('Escape');
    await page.locator('[data-hk-content], main').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press('[');
    ok(`collapsed rail ${w} px with a Stage flyout; "[" expands it again`, w === 56 && (await page.locator('[data-hk-rail="wide"]').count()) === 1);

    // Keyboard-only rail: Tab into it, ↓ to an item, Space toggles, ← collapses, → expands.
    await page.goto(`${BASE}/#hk/brands`); await page.locator('[data-hk-filter="stage:sent"]').waitFor();
    await page.locator('[data-hk-rail-search]').focus();
    let tabs = 0; while (tabs < 40 && !(await page.evaluate(() => !!document.activeElement?.dataset?.bucketHead))) { await page.keyboard.press('Tab'); tabs++; }
    const head0 = await page.evaluate(() => document.activeElement.dataset.bucketHead);
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
    const item = await page.evaluate(() => document.activeElement.dataset.hkFilter);
    await page.keyboard.press('Space');
    await page.waitForFunction(id => document.querySelector(`[data-hk-filter="${id}"]`)?.getAttribute('aria-pressed') === 'true', item);
    const kh = await page.evaluate(() => window.location.hash);
    await page.locator(`[data-hk-filter="${item}"]`).focus();
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
    const shut = await page.locator(`[data-bucket-head="${head0}"]`).getAttribute('aria-expanded');
    await page.keyboard.press('ArrowRight');
    const open2 = await page.locator(`[data-bucket-head="${head0}"]`).getAttribute('aria-expanded');
    ok(`keyboard only: ${tabs} Tabs into the rail (${head0}), ↓ ↓ to ${item}, Space -> ${kh}, ← ← collapsed (aria-expanded ${shut}), → expanded (${open2})`, !!head0 && item === 'views:pipeline' && kh === '#hk/brands?view=pipeline' && shut === 'false' && open2 === 'true');
    ok(`1440 no page errors (${errors.length})`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---- Old links land on their new views.
  {
    const { ctx, page, errors } = await open(1440, { hash: '#hk/today', all: false });
    const want = { '#hk/replies': ['#hk/inbox?replies=open', '[data-hk-inbox-space="replies"]'], '#hk/drafts': ['#hk/inbox?drafts=all', '[data-hk-inbox-space="drafts"]'], '#hk/pipeline': ['#hk/brands?view=pipeline', '[data-hk-layout-btn="stage"][aria-pressed="true"]'], '#hk/sponsors': ['#hk/brands?view=sponsors', '[data-hk-sponsors]'] };
    for (const [from, [to, sel]] of Object.entries(want)) {
      await page.goto(`${BASE}/${from}`); await page.locator('[data-hk-shell]').waitFor();
      await page.locator(sel).first().waitFor({ timeout: 20000 }).catch(() => {});
      const at = await page.evaluate(() => window.location.hash), shown = await page.locator(sel).count();
      ok(`old link ${from} -> ${at}`, at === to && shown > 0);
    }
    ok(`old links: no page errors (${errors.length})`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---- Inbox: My mail › Needs you (the one Gmail read), Tracked replies, Queued drafts; 1280 screenshots.
  {
    const { ctx, page, errors } = await open(1280, { hash: NO_GMAIL ? '#hk/inbox?replies=open' : '#hk/inbox' });
    if (!NO_GMAIL) try { await page.locator('[data-hk-filter="my_mail:needs_you"]').waitFor({ timeout: 30000 }); }
    catch (e) { await shot(page, 'inbox-fail-1280'); throw new Error(`Inbox rail missing at ${await page.evaluate(() => location.hash)}; rail ${await page.locator('[data-hk-rail]').getAttribute('data-hk-rail').catch(() => 'none')}; filters ${await page.locator('[data-hk-filter]').count()}; errors ${errors.join(' | ')}`); }
    if (!NO_GMAIL) {
      await page.locator('[data-hk-filter="my_mail:needs_you"]').click();
      await page.waitForFunction(() => !/Reading your Gmail/.test(document.querySelector('[data-hk-inbox-list]')?.textContent || ''), null, { timeout: 90000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
      const fresh = listLoads.filter(l => !l.cached), units = fresh.reduce((n, l) => n + l.units, 0);
      ok(`Inbox › Needs you: ${fresh.length} Gmail list page(s), ${units} units (efc26b2: 930 for its two-page load; cap 1010)`, fresh.length >= 1 && fresh.length <= 2 && units <= 1010);
      await shot(page, 'inbox-needs-you-1280');
    } else ok(`--no-gmail: Inbox never opened a Gmail lane (${listLoads.length} list loads)`, listLoads.length === 0);
    await page.locator('[data-hk-filter="tracked_replies:open"]').click();
    await page.locator('[data-hk-inbox-space="replies"]').waitFor();
    await page.locator('[data-hk-replies] [data-hk-reply], [data-hk-replies] [data-hk-empty]').first().waitFor();
    await measure(page, 'inbox-replies@1280', '[data-hk-inbox-space]');
    await axeOn(page, 'inbox-replies@1280', '[data-hk-shell]');
    await page.locator('[data-hk-filter="queued_drafts:all"]').click();
    await page.locator('[data-hk-inbox-space="drafts"]').waitFor();
    ok(`Inbox hosts Tracked replies and Queued drafts; rail counts: ${JSON.stringify(await page.locator('[data-hk-bucket="tracked_replies"] [data-hk-filter], [data-hk-bucket="queued_drafts"] [data-hk-filter]').evaluateAll(es => es.map(e => e.textContent.trim())))}`, true);
    await page.goto(`${BASE}/#hk/brands`); await page.locator('[data-hk-filter="stage:sent"]').waitFor();
    await waitCount(page, dbAll.total);
    await shot(page, 'brands-1280-rail-expanded');
    await page.locator('[data-hk-rail-toggle]').click();
    await page.locator('[data-hk-rail="narrow"]').waitFor();
    await shot(page, 'brands-1280-rail-collapsed');
    await page.locator('[data-hk-rail-toggle]').click();
    ok(`1280: no sideways scroll; no page errors (${errors.length})`, (await noSideways(page)) && errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---- 390: tab bar, Filters sheet.
  {
    const { ctx, page, errors } = await open(390, { hash: '#hk/brands' });
    const tabs = await page.locator('.hk-tabbar [data-hk-tab]').evaluateAll(es => es.map(e => e.textContent.trim()));
    ok(`390 tab bar: ${tabs.join(' · ')}`, JSON.stringify(tabs) === JSON.stringify(['Today', 'Inbox', 'Brands', 'Search', 'More']));
    await page.locator('[data-hk-brand]').first().waitFor();
    await shot(page, 'brands-390');
    await measure(page, 'brands@390', '[data-hk-brands-space]');
    await axeOn(page, 'brands@390', '[data-hk-shell]');
    await page.locator('[data-hk-open-filters]').click();
    await page.locator('[data-hk-filters-sheet] [data-hk-filter="stage:sent"]').click();
    const show = (await page.locator('[data-hk-show-results]').textContent()).trim();
    await shot(page, 'filters-sheet-390');
    await measure(page, 'filters-sheet@390', '[data-hk-filters-sheet]');
    await axeOn(page, 'filters-sheet@390', '[data-hk-filters-sheet]');
    const sent = await api({ stage: 'sent' });
    await page.waitForFunction(n => document.querySelector('[data-hk-show-results]')?.textContent.includes(String(n)), sent.total, { timeout: 20000 }).catch(() => {});
    const show2 = (await page.locator('[data-hk-show-results]').textContent()).trim();
    await page.locator('[data-hk-show-results]').click();
    ok(`390 Filters sheet: Stage › Sent -> "${show2}" (DB ${sent.total}); first read "${show}"; no sideways scroll`, show2.includes(sent.total.toLocaleString('en-US')) && (await noSideways(page)));
    ok(`390 no page errors (${errors.length})`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---- Viewer (role forced in /shell): reads, filters, no write controls.
  {
    const { ctx, page, errors } = await open(1440, { viewer: true, hash: '#hk/brands' });
    await page.locator('[data-hk-brand]').first().waitFor();
    const brandsWrites = await page.locator('[data-hk-brands] input[type="checkbox"], [data-hk-target], [data-hk-pipeline], [data-hk-bulk-target]').count();
    await page.locator('[data-hk-filter="stage:sent"]').click();
    const filtered = await waitCount(page, (await api({ stage: 'sent' })).total);
    await page.goto(`${BASE}/#hk/inbox?replies=open`); await page.locator('[data-hk-inbox-space="replies"]').waitFor();
    await page.locator('[data-hk-replies] [data-hk-reply], [data-hk-replies] [data-hk-empty]').first().waitFor();
    const replyWrites = await page.locator('[data-hk-replies] input[type="checkbox"], [data-hk-replies] [data-hk-mark-handled]').count();
    ok(`Viewer: filters work (${filtered} sent), 0 checkboxes / + Target / + Pipeline on Brands (${brandsWrites}), 0 checkboxes / Mark handled on Tracked replies (${replyWrites})`, brandsWrites === 0 && replyWrites === 0 && filtered > 0);
    ok(`Viewer no page errors (${errors.length})`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  ok(`writes: only PUT /me/prefs (${writes.length}: ${writes.map(w => Object.keys(JSON.parse(w)).join('+')).join(', ')}); Claude/Apollo hosts hit ${realCalls.length}`, writes.every(w => /^\{"(saved_views|rail)"/.test(w)) && realCalls.length === 0, `blocked: ${[...new Set(blocked)].join(', ')}`);
} catch (e) {
  ok(`run error: ${e.message}`, false);
} finally {
  await cleanup();
  const after = { counts: await counts(), prefs: await prefsRow() };
  const moved = HK_TABLES.filter(t => after.counts[t] !== before.counts[t]);
  const diff = before.prefs ? Object.keys(before.prefs).filter(k => JSON.stringify(after.prefs?.[k]) !== JSON.stringify(before.prefs[k])) : [];
  try {
    if (moved.length) throw new Error(`counts moved: ${moved.map(t => `${t} ${before.counts[t]}->${after.counts[t]}`).join(', ')}`);
    if (diff.length) throw new Error(`hk_member_prefs differs: ${diff.join(', ')}`);
    restoredLine = `yes (${HK_TABLES.length} HumanKind counts identical; Jack's hk_member_prefs row = snapshot field for field incl. saved_views [], rail, owner_filter, last_seen_at, updated_at; KEPT by rule: hk_events, sign-in rows)`;
  } catch (e) { restoredLine = `NO - ${e.message}`; }
  const pass = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ ...results, restored: restoredLine }, null, 1));
  console.log(`\nRESULT ${pass}/${results.checks.length} · restored: ${restoredLine} · ${Math.round((Date.now() - T0) / 1000)} s`);
  process.exit(pass === results.checks.length && restoredLine.startsWith('yes') ? 0 : 1);
}
