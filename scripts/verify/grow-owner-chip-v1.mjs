// FIX grow-owner-chip-and-site-label live check - as Jack (ownerSession) on the REAL HumanKind workspace, localhost
// against the build, through the real wiring. Brands rows + phone cards show the sheet owner, never "Unclaimed" beside
// a Claimed status; Allover Apparel's page shows "Sheet: Pete · not in Grow yet" and "Website (suggested)" with Save as
// website + Wrong site; ONE Wrong site then Undo on it; 1440 / 390, contrast, axe; a Viewer pass (role forced in /shell).
// SCOPE (declared): reads ~953 hk_brands rows twice (counts + the list route), one brand page. The Inbox is never opened:
// 0 Gmail. 0 Claude, 0 Apollo. Writes: exactly the two POST /brands/<Allover>/wrong-site calls (reject, then undo);
// every other non-GET to /api, /proxy and Supabase REST is aborted (page-load jobs, sync, prefs), as is every outside
// host but Google Fonts. Restore: Allover's row back to its snapshot exactly (incl. updated_at), hk_member_prefs and
// profiles.last_seen_at. KEPT by rule: the two hk_events rows, sign-in rows. "restored" THROWS if anything else moved.
// Runtime ~90 s, cap 240 s.  Usage: node scripts/verify/grow-owner-chip-v1.mjs   (run npm run build first)
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
const OUT = path.join(ROOT, '.screenshots', 'grow-owner-chip-v1');
const PORT = 3995, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const HK_TABLES = ['hk_brands', 'hk_contacts', 'hk_touches', 'hk_replies', 'hk_ignored_senders', 'hk_sync_runs', 'hk_job_runs', 'hk_settings', 'hk_import_runs', 'hk_domain_intel', 'hk_signals'];
const SHEET = 'Sheet: Pete · not in Grow yet';
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const must = r => { if (r.error) throw new Error(r.error.message); return r; };
const hk = (await svc.from('businesses').select('id, features').eq('name', 'HumanKind')).data?.find(b => b.features?.hk_sales);
if (!hk) { console.log('ABORT: no HumanKind workspace with hk_sales on'); process.exit(1); }
const min = new Date().getMinutes();
if (min >= 57 || min < 3) { console.log('ABORT: within 3 min of the hourly HumanKind cron sync'); process.exit(1); }
const counts = async () => { const o = {}; for (const t of HK_TABLES) o[t] = must(await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', hk.id)).count; return o; };
const jackId = must(await svc.from('profiles').select('id').eq('is_platform_owner', true)).data[0].id;
const prefsSeen = async () => must(await svc.from('hk_member_prefs').select('last_seen_at').eq('business_id', hk.id).eq('user_id', jackId).maybeSingle()).data?.last_seen_at ?? null;
const allover = async () => must(await svc.from('hk_brands').select('*').eq('business_id', hk.id).eq('name', 'Allover Apparel').is('archived_at', null).single()).data;
const lastEvt = async () => must(await svc.from('hk_events').select('id, action, detail, actor_user_id, created_at').eq('business_id', hk.id).order('created_at', { ascending: false }).limit(3)).data;
const before = { counts: await counts(), seen: await prefsSeen(), brand: await allover() };
const evt0 = (await lastEvt())[0]?.created_at || '';
const PAST = new Set(['claimed', 'drafted', 'sent', 'bumped', 'final_sent', 'replied', 'meeting', 'signed']);
const live = [];
for (let from = 0; ; from += 1000) { const { data } = must(await svc.from('hk_brands').select('status, owner_user_id, owner_hint').eq('business_id', hk.id).is('archived_at', null).order('id').range(from, from + 999)); live.push(...data); if (data.length < 1000 || from > 5000) break; }
const split = {}; for (const b of live.filter(x => PAST.has(x.status) && !x.owner_user_id)) split[b.owner_hint || '(none)'] = (split[b.owner_hint || '(none)'] || 0) + 1;
const B = before.brand;
log('before', JSON.stringify({ ...before.counts, allover: { status: B.status, owner_user_id: B.owner_user_id, owner_hint: B.owner_hint, domain: B.domain, domain_suggested: B.domain_suggested, domain_confidence: B.domain_confidence }, claimed_plus_no_owner: split }));
if (B.owner_user_id || B.owner_hint !== 'pete' || B.domain || !B.domain_suggested) { console.log('ABORT: Allover Apparel is not in the expected state (sheet owner pete, a suggestion, no domain)'); process.exit(1); }

let srv, browser, owner;
const blocked = [], realCalls = [], writes = [], gmailReads = [];
const results = { checks: [], axe: {}, contrast: {}, split };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
let restoredLine = 'NOT RUN';
async function restore() {
  must(await svc.from('hk_brands').update({ domain_suggested: B.domain_suggested, domain_suggested_at: B.domain_suggested_at, domain_confidence: B.domain_confidence, research_attempted_at: B.research_attempted_at, domain: B.domain, updated_at: B.updated_at }).eq('id', B.id));
  must(await svc.from('hk_member_prefs').update({ last_seen_at: before.seen }).eq('business_id', hk.id).eq('user_id', jackId));
}
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; await restore(); if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 240000 });
fs.mkdirSync(OUT, { recursive: true });
const WRONG = new RegExp(`^/api/hk/${hk.id}/brands/${B.id}/wrong-site$`);

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  async function open(width, { viewer = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 760 ? 844 : 900 }, hasTouch: width < 760 });
    await ctx.addInitScript(([k, v]) => { try { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); localStorage.setItem('prospector_auto_assay_disabled', '1'); } catch { /* sandboxed frame */ } }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session)]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      if (isLocal && /\/inbox\//.test(u.pathname)) gmailReads.push(u.pathname);
      if (isLocal && req.method() === 'POST' && WRONG.test(u.pathname) && !viewer && writes.length < 2) { writes.push(req.postData()); return route.continue(); }
      const deny = (isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname)) || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.pathname.replace(hk.id, '<hk>')}`); return route.abort(); }
      if (viewer && isLocal && /^\/api\/hk\/[^/]+\/shell$/.test(u.pathname)) { const r = await route.fetch(); const j = await r.json(); return route.fulfill({ response: r, json: { ...j, me: { ...j.me, role: 'viewer' } } }); }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(30000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    await page.goto(`${BASE}/`);
    if (width < 900) { await page.getByRole('button', { name: 'Open menu' }).click().catch(() => {}); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 20000 }); await page.getByLabel('Workspace').selectOption({ label: 'HumanKind' });
    await page.locator('[data-hk-shell] [data-hk-avatar]').waitFor({ timeout: 20000 });
    for (const sel of ['[data-hk-nav="brands"]', '[data-hk-tab="brands"]']) { const n = page.locator(sel); if (await n.count() && await n.first().isVisible()) { await n.first().click(); break; } }
    if (!(await page.locator('[data-hk-brands]').count())) { await page.locator('[data-hk-tab="more"]').click(); await page.locator('[data-hk-more]').getByRole('button', { name: 'Brands', exact: true }).click(); }
    const all = page.getByRole('group', { name: 'Whose work' }).getByRole('button', { name: /^(All|Everyone)/ });
    if (await all.count()) await all.first().click();
    await page.getByLabel('Search brands').fill('Allover');
    await page.locator('[data-hk-brands] [data-hk-brand]').first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(600);
    return { ctx, page, errors };
  }
  const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide', fullPage: true });
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
  const headChips = page => page.locator('[data-hk-brand-page] .hk-brand__chips').first().innerText();

  // ---- 1440: Brands row, brand page, Wrong site + Undo.
  {
    const { ctx, page, errors } = await open(1440);
    const row = page.locator('tr', { has: page.locator('[data-hk-brand]', { hasText: 'Allover Apparel' }) }).first();
    const rowText = await row.innerText();
    ok(`1440 Brands row: Claimed + "${SHEET}", no "Unclaimed"`, rowText.includes(SHEET) && rowText.includes('Claimed') && !rowText.includes('Unclaimed'), rowText.replace(/\s+/g, ' '));
    await measure(page, 'brands@1440', '[data-hk-brands]');
    await axeOn(page, 'brands@1440', '[data-hk-brands]');
    await page.locator('[data-hk-brand]', { hasText: 'Allover Apparel' }).first().click();
    await page.locator('[data-hk-brand-page]').waitFor();
    await page.locator('[data-hk-reach-score]').waitFor();
    const chips = await headChips(page);
    ok(`1440 brand page chips: "Claimed" + "${SHEET}", no "Unclaimed" (${chips.replace(/\s+/g, ' ')})`, chips.includes('Claimed') && chips.includes(SHEET) && !chips.includes('Unclaimed'));
    const site = await page.locator('[data-hk-reach-site]').innerText();
    ok(`1440 website line "${site}" with Save as website + Wrong site`, site.startsWith(`Website (suggested): ${B.domain_suggested}`) && (await page.locator('[data-hk-reach-site] [data-hk-use-site]').innerText()) === 'Save as website' && (await page.locator('[data-hk-reach-site] [data-hk-wrong-site]').innerText()) === 'Wrong site');
    await shot(page, 'brand-1440');
    await measure(page, 'brand@1440', '[data-hk-brand-page]');
    await axeOn(page, 'brand@1440', '[data-hk-brand-page]');

    // The ONE reversible write: Wrong site, then Undo inside 10 s.
    await page.locator('[data-hk-wrong-site]').click();
    await page.locator('[data-hk-site-undo]').waitFor();
    const mid = await allover();
    ok(`Wrong site: suggestion cleared (3 fields null), research_attempted_at = now, domain untouched; undo line "${(await page.locator('[data-hk-site-undo]').innerText()).trim()}"`,
      mid.domain_suggested === null && mid.domain_suggested_at === null && mid.domain_confidence === null && mid.research_attempted_at && Date.now() - Date.parse(mid.research_attempted_at) < 60000 && mid.domain === B.domain);
    const ev1 = (await lastEvt()).filter(e => e.created_at > evt0);
    ok(`Activity row brand.domain_rejected by Jack (detail domain ${ev1[0]?.detail?.domain})`, ev1[0]?.action === 'brand.domain_rejected' && ev1[0].actor_user_id === jackId && ev1[0].detail.domain === B.domain_suggested);
    await shot(page, 'brand-1440-wrong-site');
    await measure(page, 'brand@1440 undo line', '[data-hk-brand-page]');
    await page.locator('[data-hk-undo-wrong-site]').click();
    await page.locator('[data-hk-reach-site] [data-hk-wrong-site]').waitFor();
    const back = await allover();
    const same = ['domain', 'domain_suggested', 'domain_suggested_at', 'domain_confidence', 'research_attempted_at'].filter(k => back[k] !== B[k]);
    ok(`Undo: the suggestion back exactly (${same.length ? `differs: ${same.join(', ')}` : 'all 5 fields = snapshot'}); line back to "Website (suggested)"`, !same.length && (await page.locator('[data-hk-reach-site]').innerText()).startsWith('Website (suggested)'));
    const ev2 = (await lastEvt()).filter(e => e.created_at > evt0).map(e => e.action);
    ok(`Activity rows kept: ${ev2.join(', ')}`, ev2.includes('brand.domain_rejected') && ev2.includes('brand.domain_restored'));
    ok(`1440 no page errors (${errors.length})`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---- 390: phone card + brand page.
  {
    const { ctx, page, errors } = await open(390);
    const card = page.locator('[data-hk-brand]', { hasText: 'Allover Apparel' }).first();
    const cardText = await card.innerText();
    ok(`390 phone card: "${SHEET}", no "Unclaimed"`, cardText.includes(SHEET) && !cardText.includes('Unclaimed'), cardText.replace(/\s+/g, ' '));
    ok('390 Brands: no sideways scroll', await noSideways(page));
    await shot(page, 'brands-390');
    await measure(page, 'brands@390', '[data-hk-brands]');
    await axeOn(page, 'brands@390', '[data-hk-brands]');
    await card.click();
    await page.locator('[data-hk-brand-page]').waitFor();
    await page.locator('[data-hk-reach-site]').waitFor();
    const chips = await headChips(page);
    ok(`390 brand page chips: Claimed + sheet owner, no Unclaimed; website line with both buttons`, chips.includes(SHEET) && !chips.includes('Unclaimed') && (await page.locator('[data-hk-reach-site] button').count()) === 2);
    ok('390 brand page: no sideways scroll', await noSideways(page));
    await shot(page, 'brand-390');
    await measure(page, 'brand@390', '[data-hk-brand-page]');
    await axeOn(page, 'brand@390', '[data-hk-brand-page]');
    ok(`390 no page errors (${errors.length})`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---- Viewer: the line reads, no buttons.
  {
    const { ctx, page, errors } = await open(1440, { viewer: true });
    await page.locator('[data-hk-brand]', { hasText: 'Allover Apparel' }).first().click();
    await page.locator('[data-hk-reach-site]').waitFor();
    ok('Viewer: website line shown, no Save as website / Wrong site', (await page.locator('[data-hk-reach-site] button').count()) === 0 && (await page.locator('[data-hk-reach-site]').innerText()).startsWith('Website (suggested)'));
    ok(`Viewer no page errors (${errors.length})`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  ok(`writes: exactly the 2 wrong-site POSTs (${writes.map(w => w || '{}').join(' | ')}); Claude/Apollo hosts hit ${realCalls.length}; Inbox/Gmail reads ${gmailReads.length}`, writes.length === 2 && realCalls.length === 0 && gmailReads.length === 0, `blocked: ${[...new Set(blocked)].join(', ')}`);
} catch (e) {
  ok(`run error: ${e.message}`, false);
} finally {
  await cleanup();
  const after = { counts: await counts(), seen: await prefsSeen(), brand: await allover() };
  const moved = HK_TABLES.filter(t => after.counts[t] !== before.counts[t]);
  const rowDiff = Object.keys(B).filter(k => JSON.stringify(after.brand[k]) !== JSON.stringify(B[k]));
  const evts = (await lastEvt()).filter(e => e.created_at > evt0).length;
  try {
    if (moved.length) throw new Error(`counts moved: ${moved.map(t => `${t} ${before.counts[t]}->${after.counts[t]}`).join(', ')}`);
    if (rowDiff.length) throw new Error(`Allover row differs: ${rowDiff.join(', ')}`);
    if (after.seen !== before.seen) throw new Error('hk_member_prefs.last_seen_at not restored');
    restoredLine = `yes (${HK_TABLES.length} HumanKind counts identical; Allover Apparel row = snapshot field for field incl. updated_at; last_seen_at restored; KEPT by rule: ${evts} hk_events rows, sign-in rows)`;
  } catch (e) { restoredLine = `NO - ${e.message}`; }
  const pass = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ ...results, restored: restoredLine }, null, 1));
  console.log(`\nRESULT ${pass}/${results.checks.length} · restored: ${restoredLine} · ${Math.round((Date.now() - T0) / 1000)} s`);
  process.exit(pass === results.checks.length && restoredLine.startsWith('yes') ? 0 : 1);
}
