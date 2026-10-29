// grow-signals-v1 Stage 3 live check - as Jack (ownerSession) on the REAL HumanKind workspace, localhost against the
// build, through the real wiring. Today's Signals panel (prospects + the Sponsors heading, no Snooze), Brands with the
// Heat column / row bar / Hot leads / Targets, the Brand page chip, ONE + Target then Undo on GHOST from its Brands row
// (N2: the row and the page do not move), a contrast table for the four heat chips, axe, 1440 + 390, and a Viewer pass
// (role forced to viewer in the /shell response).
// SCOPE (declared): HumanKind reads (~952 brands, 47 signals). 0 Claude, 0 Gmail (the Inbox is not opened; the
// page-load sync POST is aborted), 0 Apollo. The ONLY writes let through: POST brands/<GHOST>/target (on, then off)
// and POST signals/seen; every other non-GET to /api, /proxy and Supabase REST is aborted, as is every outside host
// but Google Fonts.
// Restore: GHOST's hk_brands row back to its snapshot exactly (heat, heat_band, heat_at, targeted_*, updated_at); the
// test's targeted_by_user signal row deleted (test data); seen_at put back to null on the signals that were unseen;
// hk_member_prefs.last_seen_at + profiles.last_seen_at restored. hk_events rows are KEPT (brand.targeted /
// brand.untargeted stay in Activity, standing rule 2026-10-29) and are not in the restored counts; sign-in rows kept by
// rule. "restored" THROWS if anything else moved. Runtime ~2 min, cap 240 s.
// Usage: node scripts/verify/grow-signals-v1-stage3.mjs   (run npm run build first)
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
const OUT = path.join(ROOT, '.screenshots', 'grow-signals-v1');
const PORT = 3997, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const HK_TABLES = ['hk_brands', 'hk_contacts', 'hk_touches', 'hk_replies', 'hk_signals', 'hk_ignored_senders', 'hk_sync_runs', 'hk_job_runs', 'hk_settings', 'hk_import_runs', 'hk_domain_intel'];
const TARGET_NAME = 'GHOST';
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
const ghostRow = async () => must(await svc.from('hk_brands').select('*').eq('business_id', hk.id).eq('name', TARGET_NAME).is('archived_at', null)).data;
const signals = async () => must(await svc.from('hk_signals').select('*').eq('business_id', hk.id).order('id')).data;
const jackId = must(await svc.from('profiles').select('id').eq('is_platform_owner', true)).data[0].id;
const prefsSeen = async () => must(await svc.from('hk_member_prefs').select('last_seen_at').eq('business_id', hk.id).eq('user_id', jackId).maybeSingle()).data?.last_seen_at ?? null;
const ghosts = await ghostRow();
if (ghosts.length !== 1) { console.log(`ABORT: expected one live ${TARGET_NAME} brand, found ${ghosts.length}`); process.exit(1); }
const G = ghosts[0];
if (G.targeted_at) { console.log(`ABORT: ${TARGET_NAME} is already targeted - not touching a real Target`); process.exit(1); }
const before = { counts: await counts(), ghost: G, signals: await signals(), seen: await prefsSeen() };
const dbOpen = before.signals.filter(s => !s.dismissed_at);
const SPONSOR = new Set(['sponsor_renewal_due', 'sponsor_lapsed']);
const db = { prospects: dbOpen.filter(s => !SPONSOR.has(s.kind)).length, sponsors: dbOpen.filter(s => SPONSOR.has(s.kind)).length };
const brandsAll = must(await svc.from('hk_brands').select('heat_band, targeted_at').eq('business_id', hk.id).is('archived_at', null).range(0, 1999)).data;
db.hotWarm = brandsAll.filter(b => ['hot', 'warm'].includes(b.heat_band)).length; db.targets = brandsAll.filter(b => b.targeted_at).length;
log('before', JSON.stringify({ ...before.counts, ...db, ghost: { heat: G.heat, band: G.heat_band } }));

let srv, browser, owner;
const blocked = [], allowed = [], realCalls = [];
const results = { checks: [], errors: [], axe: {}, contrast: {}, chips: [], n2: {}, numbers: { db } };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 240000 });
fs.mkdirSync(OUT, { recursive: true });
const ALLOW = [new RegExp(`^/api/hk/${hk.id}/brands/${G.id}/target$`), new RegExp(`^/api/hk/${hk.id}/signals/seen$`)];

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  let signalsBody = null;
  async function open(width, { viewer = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 760 ? 844 : 900 }, hasTouch: width < 760 });
    await ctx.addInitScript(([k, v]) => { try { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); localStorage.setItem('prospector_auto_assay_disabled', '1'); } catch { /* sandboxed frame */ } }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session)]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (/anthropic\.com$|apollo\.io$|googleapis\.com$/.test(u.host) && !/fonts\.googleapis\.com$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      if (isLocal && req.method() === 'POST' && !viewer && ALLOW.some(r => r.test(u.pathname))) { allowed.push(u.pathname.split('/').slice(-2).join('/')); return route.continue(); }
      const deny = (isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname)) || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.pathname.replace(hk.id, '<hk>')}`); return route.abort(); }
      if (viewer && isLocal && /^\/api\/hk\/[^/]+\/shell$/.test(u.pathname)) {
        const r = await route.fetch(); const j = await r.json();
        return route.fulfill({ response: r, json: { ...j, me: { ...j.me, role: 'viewer' } } });
      }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(30000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    page.on('response', async r => { if (/\/api\/hk\/[^/]+\/signals$/.test(new URL(r.url()).pathname) && r.ok() && !signalsBody) signalsBody = await r.json().catch(() => null); });
    await page.goto(`${BASE}/`);
    if (width < 900) { await page.getByRole('button', { name: 'Open menu' }).click().catch(() => {}); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 20000 }); await page.getByLabel('Workspace').selectOption({ label: 'HumanKind' });
    await page.locator('[data-hk-shell] [data-hk-avatar]').waitFor({ timeout: 20000 });
    return { ctx, page, errors };
  }
  const go = async (page, id) => {
    const nav = page.locator(`[data-hk-nav="${id}"]`);
    if (await nav.count() && await nav.first().isVisible()) await nav.first().click();
    else if (await page.locator(`[data-hk-tab="${id}"]`).count()) await page.locator(`[data-hk-tab="${id}"]`).click();
    else { await page.locator('[data-hk-tab="more"]').click(); await page.locator('[data-hk-more]').getByRole('button', { name: id[0].toUpperCase() + id.slice(1), exact: true }).click(); }
  };
  const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide' });
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
  const brandsView = async (page, label) => { await page.getByRole('tab', { name: label, exact: true }).click(); await page.locator('[data-hk-brands] [data-hk-brand], [data-hk-brands] .hk-empty').first().waitFor({ timeout: 30000 }); await page.waitForTimeout(400); };

  // ---- 1440: Today, Brands, + Target / Undo, Brand page, chips.
  {
    const { ctx, page, errors } = await open(1440);
    await go(page, 'today');
    const panel = page.locator('[data-hk-section="signals"]');
    await panel.waitFor({ timeout: 30000 }); await page.waitForTimeout(600);
    ok(`real wiring: GET signals = the DB (prospects ${signalsBody?.prospects?.length} vs ${db.prospects}, Sponsors ${signalsBody?.sponsors?.length} vs ${db.sponsors}); no "@"`,
      signalsBody && signalsBody.prospects.length === Math.min(200, db.prospects) && signalsBody.sponsors.length === Math.min(200 - db.prospects, db.sponsors) && !JSON.stringify(signalsBody).includes('@'));
    const title = await panel.locator('h2').textContent();
    const rows = await panel.locator('.hk-rows').first().locator('[data-hk-signal]').count();
    const spons = await panel.locator('[data-hk-signals-sponsors] summary').textContent().catch(() => '');
    ok(`1440 Today Signals panel: "${title}", ${rows} rows shown (first 8), "${spons}"; no Snooze`, title === `Signals (${db.prospects})` && rows === Math.min(8, db.prospects) && spons.startsWith(`Sponsors (${db.sponsors})`) && !/Snooze/.test(await panel.textContent()));
    const ghostSig = panel.locator('[data-hk-signal]', { hasText: TARGET_NAME });
    ok(`1440 the ${TARGET_NAME} signal row carries its Cool chip`, (await ghostSig.count()) >= 1 && (await ghostSig.first().locator('[data-hk-heat="cool"]').count()) === 1);
    await shot(page, 'today-1440');
    await measure(page, 'today@1440', '[data-hk-section="signals"]');
    await axeOn(page, 'today@1440', '[data-hk-today]');

    await go(page, 'brands');
    await page.locator('[data-hk-brands] [data-hk-brand]').first().waitFor({ timeout: 60000 });
    await brandsView(page, 'Hot leads');
    const hotRows = await page.locator('[data-hk-brands] tbody [data-hk-brand]').count();
    const hotEmpty = await page.locator('[data-hk-brands] .hk-empty__title').textContent().catch(() => '');
    ok(`1440 Hot leads = the DB's Hot + Warm (${hotRows} rows vs ${db.hotWarm}${hotRows ? '' : `; "${hotEmpty}"`})`, hotRows === db.hotWarm && (db.hotWarm > 0 || hotEmpty === 'No Hot or Warm brands right now.'));
    await brandsView(page, 'Targets');
    ok(`1440 Targets = the DB's targeted brands (${await page.locator('[data-hk-brands] tbody [data-hk-brand]').count()} vs ${db.targets})`, (await page.locator('[data-hk-brands] tbody [data-hk-brand]').count()) === db.targets);
    await brandsView(page, 'All');
    await page.getByLabel('Search brands').fill(TARGET_NAME);
    await page.waitForFunction(n => { const r = [...document.querySelectorAll('[data-hk-brands] tbody [data-hk-brand]')]; return r.length > 0 && r.every(x => x.textContent.toUpperCase().includes(n)); }, TARGET_NAME, { timeout: 30000 });
    const row = page.locator('[data-hk-brands] tbody tr', { has: page.locator(`[data-hk-brand="${G.id}"]`) });
    await row.waitFor({ timeout: 30000 }); await page.waitForTimeout(500);
    const bar = await row.evaluate(tr => getComputedStyle(tr).boxShadow);
    ok(`1440 the ${TARGET_NAME} row: Heat column "Cool", 4 px bar (${bar})`, (await row.locator('[data-hk-heat="cool"]').count()) === 1 && /4px 0px 0px/.test(bar) && (await page.getByRole('columnheader', { name: /Heat/ }).count()) === 1);
    await shot(page, 'brands-1440');
    await measure(page, 'brands@1440', '[data-hk-brands]');
    await axeOn(page, 'brands@1440', '[data-hk-brands]');
    // + Target, N2, then Undo - all on the row.
    const geo = () => page.evaluate(id => { const b = document.querySelector(`[data-hk-brand="${id}"]`).getBoundingClientRect(); return { y: window.scrollY, top: b.top, left: b.left }; }, G.id);
    const g0 = await geo();
    await row.getByRole('button', { name: `Add ${TARGET_NAME} to Targets` }).click();
    await row.locator('[data-hk-undo-line]').waitFor({ timeout: 20000 });
    const g1 = await geo();
    const move = Math.max(...['y', 'top', 'left'].map(k => Math.abs(g1[k] - g0[k])));
    results.n2.target = { g0, g1, move, tableScrollLeft: await page.evaluate(() => document.querySelector('[data-hk-brands] .ui-table-box').scrollLeft) };
    ok(`N2 1440: + Target on the row moves the row ${move} px and the page ${g1.y - g0.y} px`, move < 1);
    const on = (await ghostRow())[0];
    const tsig = (await signals()).filter(s => s.kind === 'targeted_by_user' && s.brand_id === G.id);
    results.numbers.on = { targeted_at: on.targeted_at, by_jack: on.targeted_by === jackId, heat: on.heat, band: on.heat_band, signal: tsig.length };
    ok(`+ Target through the real wiring: targeted_at set by Jack, 1 targeted_by_user signal, heat ${G.heat} -> ${on.heat} (${on.heat_band}); row shows Targeted + Undo`, on.targeted_at && on.targeted_by === jackId && tsig.length === 1 && Math.abs(on.heat - (G.heat + 10)) <= 1 && (await row.locator('[data-hk-targeted]').count()) === 1);
    await shot(page, 'brands-1440-targeted');
    await row.locator('[data-hk-undo]').click();
    await row.getByRole('button', { name: `Add ${TARGET_NAME} to Targets` }).waitFor({ timeout: 20000 });
    const off = (await ghostRow())[0];
    const tsig2 = (await signals()).filter(s => s.kind === 'targeted_by_user' && s.brand_id === G.id);
    ok(`Undo: targeted_at cleared, the signal dismissed (never deleted by the app), heat back to ${off.heat} (${off.heat_band})`, !off.targeted_at && !off.targeted_by && tsig2.length === 1 && tsig2[0].dismissed_at && Math.abs(off.heat - G.heat) <= 1 && off.heat_band === G.heat_band);
    const ev = must(await svc.from('hk_events').select('action').eq('business_id', hk.id).eq('entity_id', G.id).in('action', ['brand.targeted', 'brand.untargeted']).gte('created_at', new Date(T0).toISOString())).data.map(e => e.action);
    ok(`Activity logged both (kept): ${ev.join(', ')}`, ev.includes('brand.targeted') && ev.includes('brand.untargeted'));

    await row.locator(`[data-hk-brand="${G.id}"]`).click();
    await page.locator(`[data-hk-brand-page="${G.id}"]`).waitFor({ timeout: 30000 }); await page.waitForTimeout(400);
    ok(`1440 Brand page: ${TARGET_NAME} title chips carry "Cool"; + Target and + Pipeline (or the reason) present`, (await page.locator('.hk-brand__head [data-hk-heat="cool"]').count()) === 1 && (await page.locator(`[data-hk-lists="${G.id}"] [data-hk-target]`).count()) === 1 && (await page.locator(`[data-hk-lists="${G.id}"] [data-hk-pipeline], [data-hk-lists="${G.id}"] [data-hk-in-pipeline]`).count()) === 1);
    await shot(page, 'brand-1440');
    await axeOn(page, 'brand@1440', '[data-hk-brand-page]');
    // The four chips' contrast, measured on the live page's own styles.
    results.chips = await page.evaluate(() => {
      const host = document.querySelector('[data-hk-brand-page]'); const box = document.createElement('div'); host.appendChild(box);
      const lum = c => { const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const out = ['hot', 'warm', 'cool', 'cold'].map(b => { const s = document.createElement('span'); s.className = `hk-heat hk-heat--${b}`; s.textContent = b; box.appendChild(s); const cs = getComputedStyle(s); const [l1, l2] = [lum(cs.color), lum(cs.backgroundColor)].sort((x, y) => y - x); return { band: b, fg: cs.color, bg: cs.backgroundColor, ratio: Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100 }; });
      box.remove(); return out;
    });
    ok(`contrast table, the four chips: ${results.chips.map(c => `${c.band} ${c.ratio}:1`).join(' · ')}`, results.chips.length === 4 && results.chips.every(c => c.ratio >= 4.5));
    ok('1440 no sideways scroll; 0 page errors', await noSideways(page) && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- 390: Today + Brands.
  {
    const { ctx, page, errors } = await open(390);
    await go(page, 'today');
    await page.locator('[data-hk-section="signals"]').waitFor({ timeout: 30000 }); await page.waitForTimeout(500);
    await shot(page, 'today-390');
    const side1 = await noSideways(page);
    await measure(page, 'today@390', '[data-hk-section="signals"]');
    await axeOn(page, 'today@390', '[data-hk-today]');
    await go(page, 'brands');
    await page.locator('[data-hk-brands] [data-hk-brand]').first().waitFor({ timeout: 60000 });
    await page.getByLabel('Search brands').fill(TARGET_NAME); await page.waitForTimeout(900);
    await shot(page, 'brands-390');
    const card = page.locator('[data-hk-brands] [data-row]', { has: page.locator(`[data-hk-brand="${G.id}"]`) });
    ok(`390 the ${TARGET_NAME} card: Cool chip + list buttons, bar on the card`, (await card.locator('[data-hk-heat="cool"]').count()) === 1 && (await card.locator('[data-hk-target]').count()) === 1 && /4px 0px 0px/.test(await card.evaluate(li => getComputedStyle(li).boxShadow)));
    await measure(page, 'brands@390', '[data-hk-brands]');
    await axeOn(page, 'brands@390', '[data-hk-brands]');
    ok('390 no sideways scroll on Today and Brands; 0 page errors', side1 && await noSideways(page) && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- Viewer (role forced in the /shell response): reads, no writes offered.
  {
    const { ctx, page, errors } = await open(1440, { viewer: true });
    await go(page, 'today');
    const panel = page.locator('[data-hk-section="signals"]'); await panel.waitFor({ timeout: 30000 }); await page.waitForTimeout(400);
    const todayWrites = await panel.locator('[data-hk-signal-dismiss], [data-hk-target], [data-hk-pipeline]').count();
    await go(page, 'brands');
    await page.locator('[data-hk-brands] [data-hk-brand]').first().waitFor({ timeout: 60000 });
    const brandWrites = await page.locator('[data-hk-target], [data-hk-pipeline], [data-hk-bulk-target]').count();
    await page.getByLabel('Search brands').fill(TARGET_NAME); await page.waitForTimeout(900);
    await page.locator(`[data-hk-brand="${G.id}"]`).first().click();
    await page.locator(`[data-hk-brand-page="${G.id}"]`).waitFor({ timeout: 30000 });
    const pageWrites = await page.locator('[data-hk-lists]').count();
    ok(`Viewer: Signals readable with no Dismiss / list buttons (${todayWrites}); Brands no + Target / + Pipeline (${brandWrites}); Brand page none (${pageWrites}); chip still shown; 0 page errors`,
      todayWrites === 0 && brandWrites === 0 && pageWrites === 0 && (await page.locator('.hk-brand__head [data-hk-heat="cool"]').count()) === 1 && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  ok(`browser reached 0 Claude / Apollo / Gmail hosts; writes let through: ${[...new Set(allowed)].join(', ')}; aborted: ${[...new Set(blocked)].slice(0, 6).join(', ') || 'none attempted'}`, !realCalls.length && allowed.filter(a => /target$/.test(a)).length === 2);
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    const nowSigs = await signals();
    const added = nowSigs.filter(s => !before.signals.some(b => b.id === s.id));
    const foreign = added.filter(s => !(s.kind === 'targeted_by_user' && s.brand_id === G.id));
    if (foreign.length) throw new Error(`signals written by someone else during the run: ${foreign.map(s => s.kind).join(', ')} - left alone`);
    for (const s of added) must(await svc.from('hk_signals').delete().eq('id', s.id));
    let reseen = 0;
    for (const b of before.signals) { const a = nowSigs.find(s => s.id === b.id); if (a && a.seen_at !== b.seen_at) { must(await svc.from('hk_signals').update({ seen_at: b.seen_at, acted_at: b.acted_at, dismissed_at: b.dismissed_at }).eq('id', b.id)); reseen++; } }
    const { id, ...ghostBack } = before.ghost;
    must(await svc.from('hk_brands').update(ghostBack).eq('id', id));
    must(await svc.from('hk_member_prefs').update({ last_seen_at: before.seen }).eq('business_id', hk.id).eq('user_id', jackId));
    const after = { counts: await counts(), ghost: (await ghostRow())[0], signals: await signals(), seen: await prefsSeen() };
    const moved = HK_TABLES.filter(t => before.counts[t] !== after.counts[t]).map(t => `${t} ${before.counts[t]} -> ${after.counts[t]}`);
    if (moved.length) throw new Error(`counts moved: ${moved.join(', ')}`);
    if (JSON.stringify(after.ghost) !== JSON.stringify(before.ghost)) throw new Error(`${TARGET_NAME} row not back to its snapshot`);
    if (JSON.stringify(after.signals) !== JSON.stringify(before.signals)) throw new Error('hk_signals not back to the snapshot');
    if (after.seen !== before.seen) throw new Error('hk_member_prefs.last_seen_at not restored');
    restored = true;
    line = `yes (${HK_TABLES.length} HumanKind counts identical; ${TARGET_NAME} row = snapshot; ${added.length} test signal row deleted; seen_at put back on ${reseen}; hk_member_prefs + profiles last_seen_at restored; hk_events rows KEPT by rule, not counted; sign-in rows kept by rule)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'stage3-report.json'), JSON.stringify({ ...results, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\ngrow-signals-v1 Stage 3 live check: ${passed}/${results.checks.length} passed · Claude 0 · Gmail 0 · Apollo 0\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
