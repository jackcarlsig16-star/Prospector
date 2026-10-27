// hkos-data-foundation-v1 Stage 3 live check - localhost against the build, as Jack (ownerSession: magic-link session,
// no email sent; his sign-in rows are KEPT by rule, last_seen_at restored) on the REAL HumanKind workspace.
// WRITES (declared): the browser may POST/PATCH /api/hk/<HumanKind>/* only - it creates 2 invented brands
// ("Zz Verify Bakery", "Zz Verify Bakery Shop"), 1 contact ("Verify Person", no email) and the hk_events rows those
// writes log, then patches them (claim, notes, do-not-contact). At the end the script deletes EXACTLY the rows it
// created, by the ids it captured from the responses (contacts -> events -> brands), and prints what it deleted.
// Every other non-GET to /api, /proxy and Supabase REST is aborted; every outside host except Supabase + Google Fonts
// is blocked (an Anthropic / Apollo / Gmail host fails the run). The owner toggle is NOT clicked (it would write prefs).
// restored = every hk_* count for HumanKind + HomeLover accounts / lists / sales_* identical before / after; a count()
// error or non-number count THROWS -> "restored: NO (check failed: ...)", exit 1. Contrast on 3 screens (Brands with
// rows, Add brand, Brand page) must be 0 failures. Runtime ~2-3 min, hard cap 300 s. 0 Claude, 0 Apollo.
// Shots + report: .screenshots/hkos-data-foundation-v1/. Run npm run build first.
// Usage: node scripts/verify/hkos-data-foundation-v1-stage3.mjs
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { ownerSession } from './lib/ownerSession.mjs';
import { realGet, keysOf } from './lib/realWiring.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const { measureScript, summarize, formatWorst } = require(ROOT + '/scripts/verify/lib/contrastMeasure.cjs');
const OUT = path.join(ROOT, '.screenshots', 'hkos-data-foundation-v1');
const PORT = 3990, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const HK = '981b790c-a3b0-4265-b32e-1f701d5731ff';
const HK_TABLES = ['hk_brands', 'hk_contacts', 'hk_touches', 'hk_replies', 'hk_sponsor_periods', 'hk_settings', 'hk_events', 'hk_duplicate_decisions', 'hk_import_runs', 'hk_ignored_senders', 'hk_member_prefs', 'business_members'];
const HL_TABLES = ['accounts', 'lists', 'projects', 'sales_goals', 'sales_opportunities', 'sales_targets', 'sales_people', 'sales_source_events', 'sales_partner_events', 'partner_contacts', 'sales_week_goals'];
const NAMES = ['Zz Verify Bakery', 'Zz Verify Bakery Shop'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const { listBrandsRoute } = await import('../../api/hk/brandsRoutes.js');
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const count = async (t, biz) => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', biz); if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message || `no count (HTTP ${r.status})`}`); return r.count; };
const snapshot = async () => { const o = { humankind: {}, homelover: {} }; for (const t of HK_TABLES) o.humankind[t] = await count(t, HK); for (const t of HL_TABLES) o.homelover[t] = await count(t, HOMELOVER); return o; };

const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }

let srv, browser, owner;
const created = { brands: [], contacts: [] }, blocked = [], realCalls = [], writes = [];
const results = { checks: [], errors: [], screens: {}, deleted: null };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${detail}` : ''); };
async function removeCreated() {
  const out = { contacts: 0, events: 0, brands: 0 };
  if (created.brands.length) {
    const c = await svc.from('hk_contacts').delete().in('brand_id', created.brands).select('id'); out.contacts = c.data?.length ?? -1;
    const e = await svc.from('hk_events').delete().eq('business_id', HK).in('entity_id', created.brands).select('id'); out.events = e.data?.length ?? -1;
    const b = await svc.from('hk_brands').delete().in('id', created.brands).select('id'); out.brands = b.data?.length ?? -1;
    for (const r of [c, e, b]) if (r.error) console.log('cleanup error:', r.error.message);
  }
  results.deleted = out;
  log('deleted exactly the created rows:', JSON.stringify(out), 'ids', JSON.stringify(created));
}
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  await removeCreated();
  if (owner) { log(await owner.release()); owner = null; }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 300000 });
fs.mkdirSync(OUT, { recursive: true });
const pre = await svc.from('hk_brands').select('id').eq('business_id', HK).in('name', NAMES);
if (pre.data?.length) { console.log('ABORT: leftover verify brands exist - remove them first:', pre.data.map(b => b.id).join(', ')); process.exit(1); }
const before = await snapshot();
log('before', JSON.stringify(before.humankind), 'HomeLover accounts', before.homelover.accounts);
const MEASURE = measureScript({ scope: '[data-hk-shell]' });

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  // FIX inbox-tokenfor-v1: one request through the REAL wiring (spawned server.js, no injected deps) must answer the
  // same shape and count as the in-process call. Read-only, 0 Gmail.
  const bRes = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await listBrandsRoute({ method: 'GET', params: { businessId: HK }, query: {}, body: {}, auth: { user: { id: owner.userId, name: 'Jack' }, isPlatformOwner: true, roles: new Map([[HK, 'owner']]) } }, bRes, { supabase: svc });
  const bReal = await realGet({ base: BASE, businessId: HK, session: owner.session, path: '/brands' });
  ok(`real wiring: GET /brands through the spawned server.js (cookie -> hkGate -> hkRoute -> handler(req, res)) -> ${bReal.code}, ${bReal.body?.brands?.length} brands, same keys and count as the in-process call, no address`, bReal.code === 200 && bRes.code === 200 && keysOf(bReal.body) === keysOf(bRes.body) && bReal.body.brands.length === bRes.body.brands.length && keysOf(bReal.body.brands[0]) === keysOf(bRes.body.brands[0]) && !JSON.stringify(bReal.body).includes('@'), bReal.code === 200 ? '' : JSON.stringify(bReal.body).slice(0, 160));
  browser = await chromium.launch();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  async function open(viewport) {
    const ctx = await browser.newContext({ viewport });
    await ctx.addInitScript(([k, v, b, d]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      for (const n of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${n}_ran_${b}`, d);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HOMELOVER, today]);
    const BLOCK = /\/proxy\/(anthropic|gmail|gcal)|\/api\/(gmail|google|microsoft)\b|\/api\/sales\/[^/]+\/(sync|apollo)|\/apollo-check|\/visits\/pull|\/tidy\/run|\/research/;
    const hkWrite = new RegExp(`^/api/hk/${HK}/(brands|brands/[^/]+|brands/[^/]+/contacts|brands/[^/]+/contacts/[^/]+|brands/check)$`);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (/anthropic\.com$|apollo\.io$|gmail\.googleapis\.com$/.test(u.host) || (u.host === 'www.googleapis.com' && u.pathname.startsWith('/gmail'))) realCalls.push(`${req.method()} ${u.host}${u.pathname}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      const allowedWrite = isLocal && ['POST', 'PATCH'].includes(req.method()) && hkWrite.test(u.pathname);
      if (allowedWrite) writes.push(`${req.method()} ${u.pathname}`);
      const deny = (isLocal && (BLOCK.test(u.pathname) || (req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname) && !allowedWrite)))
        || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/'))
        || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.host}${u.pathname}`); return route.abort(); }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 140)));
    page.on('response', async r => {
      const u = new URL(r.url()); if (u.host !== `localhost:${PORT}` || r.request().method() !== 'POST' || r.status() !== 201) return;
      try { const body = await r.json(); if (/\/brands$/.test(u.pathname) && body.brand?.id) created.brands.push(body.brand.id); if (/\/contacts$/.test(u.pathname) && body.contact?.id) created.contacts.push(body.contact.id); } catch {}
    });
    await page.goto(`${BASE}/`);
    if (viewport.width < 900) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 20000 });
    await page.getByLabel('Workspace').selectOption({ label: 'HumanKind' });
    await page.locator('[data-hk-shell] [data-hk-avatar]').waitFor({ timeout: 20000 }); await page.waitForTimeout(500);
    return { ctx, page, errors };
  }
  // Text must pass (4.5 / 3 large). Controls: a boundary under 3:1 fails unless the control is text-only (a link-styled
  // button, tabs, nav items - identified by their text, which passed) or one of the shell's pre-existing chrome pieces
  // (pill, search, avatar, segmented) accepted in hkos-project-shell-v1. Everything new here (inputs, buttons) must pass.
  const SHELL_CHROME = /hk-nav__item|aria-label="Your account"|hk-pill|hk-search\b|ui-seg__btn|ui-tab\b|hk-link|hk-table__name|ui-btn--tertiary|hk-menu__item|hk-subnav__item/;
  const measure = async (page, key) => {
    const m = await page.evaluate(MEASURE); if (m.error) { results.errors.push(`${key}: ${m.error}`); return null; }
    const s = summarize(m);
    const hard = m.controls.filter(c => c.ratio < 3 && !c.textOnly && !SHELL_CHROME.test(c.sel || ''));
    results.screens[key] = { ...s, hardControlFails: hard.length, hard: hard.slice(0, 6).map(c => `${c.ratio} ${c.sel} "${String(c.text || '').slice(0, 30)}"`), scrollW: m.scrollW, vw: m.vw };
    log(key, `text ${s.textFails}/${s.texts}`, `controls ${s.controlFails}/${s.controls} (text-only or shell chrome ${s.controlFails - hard.length}, must-fix ${hard.length})`);
    if (s.textFails || hard.length) log(formatWorst(key, { ...s, worst: [...s.worstText, ...hard.slice(0, 6)] }));
    return s;
  };
  const waitText = async (page, re, ms = 6000) => { try { await page.waitForFunction(r => new RegExp(r).test(document.querySelector('[data-hk-shell]')?.innerText || ''), re.source, { timeout: ms }); return true; } catch { return false; } };
  const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide' });
  const shellText = page => page.evaluate(() => document.querySelector('[data-hk-shell]').innerText);
  const setLocal = async scope => { const sw = scope.getByRole('switch', { name: /Local Chicago/ }); if (await sw.count()) return sw.first().click(); const cb = scope.getByRole('checkbox', { name: /Local Chicago/ }); if (await cb.count()) return cb.first().check(); return scope.getByText('Local Chicago?').click(); };

  // ---- 1440: Brands, Add brand, Brand page, Contacts, Notes, Timeline, duplicate + DNC flows
  const D = await open({ width: 1440, height: 900 });
  await D.page.locator('[data-hk-nav="brands"]').click(); await D.page.locator('[data-hk-brands]').waitFor();
  await D.page.waitForTimeout(600);
  ok('1 Brands opens with the saved-view tabs, search and + Add brand; empty state before any brand', (await D.page.getByRole('tab', { name: 'All' }).count()) === 1 && (await D.page.locator('[data-hk-add]').count()) === 1 && (await D.page.locator('[data-hk-brands] [data-hk-empty]').count()) === 1);
  await D.page.locator('[data-hk-add]').click(); const modal = D.page.locator('[data-hk-add-brand]'); await modal.waitFor();
  await modal.locator('#hk-brand-name').fill(NAMES[0]); await modal.locator('#hk-brand-domain').fill('zz-verify-bakery.example'); await modal.locator('#hk-brand-neighborhood').fill('Logan Square');
  await setLocal(modal); await modal.locator('#hk-brand-category').focus(); await D.page.waitForTimeout(100);
  await modal.locator('[data-hk-verdict="clear"]').waitFor();
  ok('2 Add brand: name + domain blur runs the check and shows "Clear to contact"', (await modal.locator('.hk-banner__title').innerText()) === 'Clear to contact');
  await measure(D.page, 'add-brand@1440'); await shot(D.page, 'add-brand-1440');
  await modal.getByRole('button', { name: 'Save and claim' }).click();
  await D.page.locator('[data-hk-brand-page]').waitFor(); await D.page.waitForTimeout(600);
  let text = await shellText(D.page);
  ok('3 Save and claim opens the Brand page: Claimed, owned by Jack, Local Chicago, 0 of 3 email touches, Copy Claude command primary, clear verdict', /Claimed/.test(text) && /Jack/.test(text) && /Local Chicago/.test(text) && /0 of 3 email touches/.test(text) && (await D.page.locator('[data-hk-copy]').count()) === 1 && (await D.page.locator('[data-hk-verdict="clear"]').count()) === 1, text.match(/\d of \d email touches/)?.[0]);
  ok('3 the address is #hk/brands/<id>', /#hk\/brands\/[0-9a-f-]{36}$/.test(D.page.url()) && created.brands.length === 1, D.page.url().split('#')[1]);
  await D.page.getByRole('tab', { name: 'Contacts' }).click(); await D.page.locator('[data-hk-add-contact]').click();
  await D.page.locator('#hk-c-name').fill('Verify Person'); await D.page.locator('#hk-c-title').fill('Owner');
  await D.page.getByRole('button', { name: 'Save contact' }).click(); await D.page.locator('[data-hk-contact]').waitFor(); await D.page.waitForTimeout(300);
  text = await shellText(D.page);
  ok('4 Contacts: the contact (no email) is listed as primary with "No email"; no "@" anywhere in the shell', (await D.page.locator('[data-hk-contact]').count()) === 1 && /★ Verify Person/.test(text) && /No email/.test(text) && !text.includes('@') && created.contacts.length === 1);
  await D.page.getByRole('tab', { name: 'Notes & ideas' }).click(); await D.page.locator('#hk-n-notes').fill('verify note: bread subscription idea');
  await D.page.locator('[data-hk-save-state]').getByText('Saved', { exact: true }).waitFor({ timeout: 5000 });
  ok('5 Notes autosave: exact "Saved" after the 800 ms timer + a PATCH', writes.some(w => w.startsWith('PATCH ')));
  await D.page.getByRole('tab', { name: 'Timeline' }).click();
  const timelineOk = await D.page.waitForFunction(() => document.querySelectorAll('[data-hk-timeline] li').length >= 4, null, { timeout: 6000 }).then(() => true).catch(() => false);
  const items = await D.page.locator('[data-hk-timeline] li').allInnerTexts();
  ok(`6 Timeline lists the logged events (${items.length}: created, claimed, contact added, edited)`, timelineOk, items.map(t => t.replace(/\s+/g, ' ').slice(0, 40)).join(' | '));
  await measure(D.page, 'brand-page@1440'); await shot(D.page, 'brand-page-1440');
  await D.page.getByRole('button', { name: 'Back to Brands' }).click(); await D.page.locator('[data-hk-brands]').waitFor(); await D.page.waitForTimeout(600);
  ok('7 Brands lists the new brand with its chips and primary contact', (await D.page.locator('[data-hk-brand]').count()) === 1 && /Verify Person/.test(await shellText(D.page)));
  await D.page.getByRole('tab', { name: 'My open' }).click(); await D.page.waitForTimeout(600);
  const myOpen = await D.page.locator('[data-hk-brand]').count();
  await D.page.getByRole('tab', { name: 'Unclaimed candidates' }).click(); await D.page.waitForTimeout(600);
  ok('7 views: My open shows it (claimed by Jack), Unclaimed candidates does not', myOpen === 1 && (await D.page.locator('[data-hk-brand]').count()) === 0);
  await D.page.getByRole('tab', { name: 'All' }).click(); await D.page.waitForTimeout(400);
  await D.page.locator('[data-hk-add]').click(); await modal.waitFor();
  await modal.locator('#hk-brand-name').fill(NAMES[1]); await modal.locator('#hk-brand-category').focus();
  await modal.locator('[data-hk-verdict="possible_duplicate"]').waitFor();
  const saveBtn = modal.getByRole('button', { name: 'Save', exact: true });
  const blockedBefore = await saveBtn.isDisabled();
  await modal.getByRole('button', { name: 'Save anyway' }).click(); await D.page.waitForTimeout(100);
  ok('8 Add brand: a partial duplicate shows "Possible duplicate" with Open match + Save anyway; Save is blocked until Save anyway', blockedBefore && (await modal.getByRole('button', { name: 'Open match' }).count()) === 1 && !(await modal.getByRole('button', { name: 'Save anyway', exact: true }).isDisabled()));
  await modal.getByRole('button', { name: 'Save anyway', exact: true }).click();
  await D.page.locator('[data-hk-brand-page]').waitFor(); await D.page.waitForTimeout(600);
  ok('8 saved anyway -> Brand page, Candidate, Unclaimed, Claim is the primary action', /Candidate/.test(await shellText(D.page)) && (await D.page.locator('[data-hk-claim]').count()) === 1 && created.brands.length === 2);
  await D.page.locator('[data-hk-claim]').click();
  const claimed = await waitText(D.page, /Claimed/);
  ok('9 Claim -> Claimed, Copy Claude command becomes the primary action', claimed && (await D.page.locator('[data-hk-copy]').count()) === 1, claimed ? '' : (await shellText(D.page)).slice(0, 300).replace(/\s+/g, ' '));
  await D.page.locator('[data-hk-more]').click(); await D.page.getByRole('menuitem', { name: 'Mark do-not-contact' }).click();
  await D.page.locator('#hk-dnc').fill('verify: asked us not to write'); await D.page.getByRole('button', { name: 'Mark do-not-contact' }).click();
  const dnc = await waitText(D.page, /Do not contact/);
  ok('10 Mark do-not-contact -> relationship chip "Do not contact" + the blocking banner', dnc && (await D.page.locator('[data-hk-verdict="do_not_contact"]').count()) === 1, dnc ? '' : (await shellText(D.page)).slice(0, 300).replace(/\s+/g, ' '));
  await D.page.getByRole('button', { name: 'Back to Brands' }).click(); await D.page.locator('[data-hk-brands]').waitFor();
  await D.page.getByLabel('Search brands').fill('zz verify'); await D.page.waitForTimeout(900);
  ok('11 search "zz verify" finds both', (await D.page.locator('[data-hk-brand]').count()) === 2);
  await measure(D.page, 'brands@1440'); await shot(D.page, 'brands-1440');
  ok('No page errors (1440)', !D.errors.length, JSON.stringify(D.errors.slice(0, 3)));
  await D.ctx.close();

  // ---- 390: the list as cards, no sideways scroll
  const P = await open({ width: 390, height: 844 });
  await P.page.locator('[data-hk-tab="brands"]').click(); await P.page.locator('[data-hk-brands]').waitFor(); await P.page.waitForTimeout(800);
  ok('12 390: the brands render as cards without sideways scroll', (await P.page.locator('[data-hk-brand]').count()) === 2 && (await P.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)));
  await shot(P.page, 'brands-390');
  ok('No page errors (390)', !P.errors.length, JSON.stringify(P.errors.slice(0, 3)));
  await P.ctx.close();

  const fails = Object.entries(results.screens).filter(([, s]) => s.textFails || s.hardControlFails);
  ok(`contrast on ${Object.keys(results.screens).length} screens: 0 text failures, 0 must-fix control boundaries (text-only + shell chrome listed per screen above)`, Object.keys(results.screens).length === 3 && !fails.length, JSON.stringify(fails.map(([k, s]) => [k, s.textFails, s.hard])));
  ok(`real-call guard: 0 requests to Anthropic / Apollo / Gmail hosts; ${writes.length} allowed hk writes; ${blocked.length} other non-GET / outside requests aborted`, !realCalls.length && writes.every(w => w.includes(`/api/hk/${HK}/`)));
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    const after = await snapshot();
    const d = results.deleted || {};
    restored = JSON.stringify(before) === JSON.stringify(after) && d.brands === created.brands.length && d.contacts === created.contacts.length;
    line = restored ? `yes (HumanKind hk_* + HomeLover counts identical; deleted exactly the created rows: brands ${d.brands}, contacts ${d.contacts}, events ${d.events}; Jack sign-in rows kept by rule)` : `NO - before ${JSON.stringify(before)} after ${JSON.stringify(after)} deleted ${JSON.stringify(d)} created ${JSON.stringify(created)}`;
  } catch (e) { line = `NO (check failed: ${e.message})`; }
  const pass = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'hkos-data-foundation-v1-stage3.json'), JSON.stringify({ ...results, created, restored }, null, 2));
  console.log(`\n${pass}/${results.checks.length} checks passed${results.errors.length ? ` · ${results.errors.length} errors` : ''} · Claude 0 · Apollo 0`);
  for (const e of results.errors) console.log('ERROR:', e.split('\n').slice(0, 3).join(' | '));
  console.log(`restored: ${line}`);
  process.exit(restored ? 0 : 1);
}
