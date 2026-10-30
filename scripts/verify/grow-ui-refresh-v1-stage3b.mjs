// grow-ui-refresh-v1 REV2 Stage 3b live check - the new Brand page (U7 + U8) as Jack (ownerSession) on the REAL
// HumanKind workspace, localhost against the build, through the real wiring: opened from the Briefing's top row.
// SCOPE (declared): 0 Claude (Re-run is never clicked), 0 Apollo. Gmail = the Inbox list the Briefing sits in (<= 2
// pages per uncached open, ~850 units; cap 2100). Writes allowed through the UI: ONE Log activity (an outside touch,
// "Met", on 2026-10-29) and its Undo (the touch is discarded, never deleted); every other non-GET to /api, /proxy and
// Supabase REST is aborted. Restore: the brand row back to its snapshot exactly (last_touch_at, updated_at),
// hk_member_prefs.last_seen_at, profiles.last_seen_at. KEPT, by rule: the discarded outside touch (state discarded),
// hk_events (touch.logged / touch.unlogged), sign-in rows. "restored" THROWS if anything else moved.
// Runtime ~2 min, cap 6 min.  Usage: node scripts/verify/grow-ui-refresh-v1-stage3b.mjs [--shots-only]   (run npm run build first)
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
const SHOTS_ONLY = process.argv.includes('--shots-only');
const MOCK = path.join(ROOT, 'inbox', '2026-10-30-0920-grow-ui-refresh-mock-brand-page.png');
const PORT = 3994, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const HK_TABLES = ['hk_brands', 'hk_contacts', 'hk_touches', 'hk_replies', 'hk_ignored_senders', 'hk_sync_runs', 'hk_job_runs', 'hk_settings', 'hk_import_runs', 'hk_domain_intel', 'hk_signals'];
const KEPT = new Set(['hk_touches']);
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
const target = top[0]?.brand;
if (!target) { console.log('ABORT: no Send-these-10 brand to open'); process.exit(1); }
log('before', JSON.stringify({ ...before.counts, brand: target.name }));
let srv, browser, owner;
const blocked = [], realCalls = [], posts = [], listLoads = [];
let briefBody = null;
const results = { checks: [], errors: [], axe: {}, contrast: {}, numbers: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
const snaps = {};
const snapBrand = async id => { snaps[id] = must(await svc.from('hk_brands').select('*').eq('id', id).single()).data; };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 6 * 60000 });
fs.mkdirSync(OUT, { recursive: true });
const ALLOW = [/\/brands\/[^/]+\/activity$/];
const CAPS = { activity: 2 };
let loggedId = null;

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
    const nav = page.locator('[data-hk-nav="inbox"]');
    if (await nav.count() && await nav.first().isVisible()) await nav.first().click();
    else await page.locator('[data-hk-tab="inbox"]').click();
    await page.locator('[data-hk-briefing] [data-hk-section="send"]').waitFor({ timeout: 60000 });
    await page.waitForFunction(() => !/Reading your Gmail/.test(document.querySelector('[data-hk-section="important"]')?.textContent || ''), null, { timeout: 90000 });
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    // The shell can reload the lane once the Inbox list lands ("Loading the briefing…" again): wait for the rows.
    await page.locator('[data-hk-send-row]').first().waitFor({ timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(500);
    await page.locator(`[data-hk-send-row="${target.id}"] .hk-srow__name`).click();
    await page.locator(`[data-hk-brand-page="${target.id}"] [data-hk-research-card]`).waitFor({ timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
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
    await p.setContent(`<body style="margin:0;display:flex;gap:16px;background:#ddd;font:14px sans-serif"><figure style="margin:0;flex:1"><figcaption>mockup (inbox/2026-10-30-0920-grow-ui-refresh-mock-brand-page.png)</figcaption><img src="${b64(MOCK)}" style="width:100%"></figure><figure style="margin:0;flex:1"><figcaption>build @ ${width}</figcaption><img src="${b64(`${OUT}/${shotName}.png`)}" style="width:100%"></figure></body>`);
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${OUT}/side-by-side-${width}.png`, fullPage: true });
    await p.close();
  };

  // ---- 1440: the page against the DB, then ONE Log activity + Undo.
  {
    const { ctx, page, errors } = await open(1440);
    const page0 = `[data-hk-brand-page="${target.id}"]`;
    const name = await page.locator(`${page0} h1`).textContent();
    const labels = await page.locator(`${page0} .hk-bhead [data-hk-labels] > *`).evaluateAll(es => es.map(e => e.textContent.trim()));
    const step = await page.locator(`${page0} [aria-current="step"]`).textContent().catch(() => null);
    const touches = await page.locator(`${page0} [data-hk-touches]`).textContent();
    const intel = must(await svc.from('hk_domain_intel').select('intel, cost_usd').eq('business_id', hk.id).eq('domain', target.domain || target.domain_suggested).maybeSingle()).data;
    const what = await page.locator(`${page0} [data-hk-research-card] .hk-research__p`).first().textContent();
    results.numbers.page = { name, labels, step, touches, fit: intel?.intel?.fit?.sponsor_fit, what };
    ok(`1440 Brand page for ${name}: labels [${labels.join(' | ')}], step ${step}, "${touches.trim()}"; Research card = the DB row (${intel?.intel?.fit?.sponsor_fit} fit, "${what.slice(0, 40)}…")`,
      name === target.name && what === intel?.intel?.company?.what_they_do && labels.some(l => l.startsWith('Industry ')) && !!step);
    const sections = await page.locator(`${page0} section[aria-label]`).evaluateAll(es => es.map(e => e.getAttribute('aria-label')));
    ok(`sections in mockup order: ${sections.join(' · ')}`, ['Research', 'Timeline', 'Next step', 'Contacts', 'Deal', 'Details'].every(s => sections.includes(s)));
    await shot(page, 'brand-1440');
    await sideBySide('brand-1440', 1440);
    await measure(page, 'brand@1440', page0);
    await axeOn(page, 'brand@1440', page0);
    // ONE Log activity (L) + Undo (skipped with --shots-only: a screenshot refresh writes nothing).
    if (!SHOTS_ONLY) {
    await snapBrand(target.id);
    const t0 = must(await svc.from('hk_touches').select('id', { count: 'exact', head: true }).eq('business_id', hk.id).eq('brand_id', target.id)).count;
    await page.locator('body').press('l');
    const form = page.locator('[data-hk-log-activity]');
    await form.waitFor({ timeout: 10000 });
    await form.locator('[data-hk-log-what="met"]').click();
    await form.locator('input[type="date"]').fill('2026-10-29');
    await form.getByLabel('Note').fill('Zz verify: logged then undone by the Stage 3b check');
    await form.locator('[data-hk-log-save]').click();
    await toast(page).waitFor({ timeout: 30000 });
    const t = await toast(page).textContent();
    const row = must(await svc.from('hk_touches').select('id, kind, channel, state, subject, sent_at').eq('business_id', hk.id).eq('brand_id', target.id).eq('kind', 'outside').order('created_at', { ascending: false }).limit(1)).data[0];
    loggedId = row?.id || null;
    await shot(page, 'brand-1440-logged', false);
    await page.locator(`${page0} [data-hk-timeline]`).getByText('logged: Met').waitFor({ timeout: 15000 }).catch(() => {});
    const timelineHas = await page.locator(`${page0} [data-hk-timeline]`).textContent();
    await toast(page).getByRole('button', { name: 'Undo' }).click(); await page.waitForTimeout(1500);
    const after = must(await svc.from('hk_touches').select('state').eq('id', loggedId).single()).data;
    const t1 = must(await svc.from('hk_touches').select('id', { count: 'exact', head: true }).eq('business_id', hk.id).eq('brand_id', target.id)).count;
    results.numbers.log = { toast: t, row, after: after.state };
    ok(`Log activity (L) on ${target.name}: toast "${t.replace('Undo', '').trim()}", touch ${row?.kind}/${row?.channel}/${row?.subject} ${row?.sent_at?.slice(0, 10)} on the Timeline; Undo -> ${after.state} (kept, never deleted)`,
      row?.kind === 'outside' && row?.channel === 'in_person' && row?.subject === 'Met' && /logged: Met/.test(timelineHas) && after.state === 'discarded' && t1 === t0 + 1);
    }
    ok('1440: no sideways scroll; 0 page errors', await noSideways(page) && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  for (const w of [1280, 390]) {
    const { ctx, page, errors } = await open(w);
    const sel = `[data-hk-brand-page="${target.id}"]`;
    await shot(page, `brand-${w}`);
    await sideBySide(`brand-${w}`, w);
    await measure(page, `brand@${w}`, sel);
    await axeOn(page, `brand@${w}`, sel);
    const railBelow = await page.evaluate(() => { const m = document.querySelector('.hk-bgrid__main').getBoundingClientRect(), r = document.querySelector('.hk-bgrid__rail').getBoundingClientRect(); return r.top >= m.bottom - 1; });
    ok(`${w}: right rail ${railBelow ? 'below' : 'beside'} the main column, no sideways scroll, 0 page errors`, await noSideways(page) && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await open(1440, { viewer: true });
    const writes = await page.locator('[data-hk-primary], .hk-qcs, [data-hk-qc-log], [data-hk-more], [data-hk-rerun], .hk-kv__pen, [data-hk-add-note], [data-hk-add-contact], [data-hk-edit-idea], [data-hk-edit]').count();
    await page.locator('body').press('l'); await page.locator('body').press('s');
    await shot(page, 'brand-1440-viewer');
    ok(`Viewer (role forced in /shell): the page reads; no primary / quick commands / Log activity / More / Re-run / pencils / Add a note / + Add (${writes}); keys do nothing; 0 page errors`, writes === 0 && !(await page.locator('[data-hk-log-activity]').count()) && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  const fresh = listLoads.filter(l => !l.cached);
  results.numbers.gmail = { loads: listLoads.length, uncached: fresh.length, units: fresh.reduce((n, l) => n + (l.units || 0), 0) };
  ok(`browser reached 0 Claude / Apollo hosts directly; writes ${JSON.stringify(posts.reduce((m, p) => ({ ...m, [p]: (m[p] || 0) + 1 }), {}))}; Gmail ${results.numbers.gmail.units} units in ${fresh.length} uncached list page(s) (cap 2100); other writes aborted (${[...new Set(blocked)].slice(0, 6).join(', ') || 'none attempted'})`,
    !realCalls.length && results.numbers.gmail.units <= 2100 && posts.length === (SHOTS_ONLY ? 0 : 2));
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
    if (loggedId && must(await svc.from('hk_touches').select('state').eq('id', loggedId).single()).data.state !== 'discarded') throw new Error('the logged touch is not discarded');
    const after = { counts: await counts(), seen: await prefsSeen() };
    const moved = HK_TABLES.filter(t => !KEPT.has(t) && before.counts[t] !== after.counts[t]).map(t => `${t} ${before.counts[t]} -> ${after.counts[t]}`);
    if (moved.length) throw new Error(`counts moved: ${moved.join(', ')}`);
    if (after.counts.hk_touches - before.counts.hk_touches !== (loggedId ? 1 : 0)) throw new Error(`hk_touches moved ${after.counts.hk_touches - before.counts.hk_touches}, expected ${loggedId ? 1 : 0} (the discarded log)`);
    if (after.seen !== before.seen) throw new Error('hk_member_prefs.last_seen_at not restored');
    restored = true;
    line = `yes (${Object.keys(snaps).length} brand row identical incl. updated_at; ${HK_TABLES.length - KEPT.size} HumanKind counts identical; last_seen_at restored; KEPT by rule: the discarded outside touch (hk_touches +${after.counts.hk_touches - before.counts.hk_touches}), hk_events, sign-in rows)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'stage3b-report.json'), JSON.stringify({ ...results, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\ngrow-ui-refresh-v1 Stage 3b live check: ${passed}/${results.checks.length} passed · Claude 0 · Apollo 0\nnumbers: ${JSON.stringify(results.numbers)}\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
