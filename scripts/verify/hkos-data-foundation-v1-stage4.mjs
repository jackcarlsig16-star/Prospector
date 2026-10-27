// hkos-data-foundation-v1 Stage 4 live check - localhost against the build, as Jack (ownerSession; sign-in rows KEPT
// by rule, last_seen_at restored) on the REAL HumanKind workspace.
// WRITES (declared): the browser may POST/PATCH/DELETE /api/hk/<HumanKind>/brands*, /sponsors*, /review/duplicates/
// decide only. It creates 6 invented brands ("Zz Verify ..."), marks one sponsor (+ periods), one do-not-contact,
// decides one duplicate pair "not a duplicate" and merges another, claims one - and the hk_events / hk_sponsor_periods /
// hk_duplicate_decisions rows those writes log. Settings > Pitch is only READ (Confirm stats / Save are never clicked:
// they would change the seeded hk_settings row). At the end the script deletes EXACTLY the rows it created, by the brand
// ids captured from the responses (periods, decisions, contacts, events, brands), and prints what it deleted. Every other
// non-GET to /api, /proxy and Supabase REST is aborted; every outside host except Supabase + Google Fonts is blocked.
// The owner toggle is NOT clicked. restored = every hk_* count for HumanKind + HomeLover counts identical before / after;
// a count() error or non-number THROWS -> "restored: NO (check failed: ...)", exit 1. Contrast on 3 screens (Sponsors,
// Review, Settings > Pitch): 0 text failures, 0 must-fix control boundaries. 390: no sideways page scroll on Sponsors,
// Review, Pipeline. Runtime ~2-3 min, hard cap 300 s. 0 Claude, 0 Apollo. Shots: .screenshots/hkos-data-foundation-v1/.
// Usage: node scripts/verify/hkos-data-foundation-v1-stage4.mjs   (npm run build first)
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
const { measureScript, summarize, formatWorst } = require(ROOT + '/scripts/verify/lib/contrastMeasure.cjs');
const OUT = path.join(ROOT, '.screenshots', 'hkos-data-foundation-v1');
const PORT = 3992, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const HK = '981b790c-a3b0-4265-b32e-1f701d5731ff';
const HK_TABLES = ['hk_brands', 'hk_contacts', 'hk_touches', 'hk_replies', 'hk_sponsor_periods', 'hk_settings', 'hk_events', 'hk_duplicate_decisions', 'hk_import_runs', 'hk_ignored_senders', 'hk_member_prefs', 'business_members'];
const HL_TABLES = ['accounts', 'lists', 'projects', 'sales_goals', 'sales_opportunities', 'sales_targets', 'sales_people', 'sales_source_events', 'sales_partner_events', 'partner_contacts', 'sales_week_goals'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const count = async (t, biz) => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', biz); if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message || `no count (HTTP ${r.status})`}`); return r.count; };
const snapshot = async () => { const o = { humankind: {}, homelover: {} }; for (const t of HK_TABLES) o.humankind[t] = await count(t, HK); for (const t of HL_TABLES) o.homelover[t] = await count(t, HOMELOVER); const s = await svc.from('hk_settings').select('members_stat, completions_stat, stats_confirmed_at, banned_phrases, subject_format').eq('business_id', HK).maybeSingle(); o.settings = s.data; return o; };
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }

let srv, browser, owner;
const created = { brands: [] }, blocked = [], realCalls = [], writes = [];
const results = { checks: [], errors: [], screens: {}, deleted: null };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${detail}` : ''); };
async function removeCreated() {
  const out = {};
  if (created.brands.length) {
    const del = async (t, q) => { const r = await q.select('id'); if (r.error) console.log(`cleanup ${t}:`, r.error.message); out[t] = (out[t] || 0) + (r.data?.length ?? -1); };
    await del('hk_sponsor_periods', svc.from('hk_sponsor_periods').delete().in('brand_id', created.brands));
    await del('hk_duplicate_decisions', svc.from('hk_duplicate_decisions').delete().in('brand_a', created.brands));
    await del('hk_duplicate_decisions', svc.from('hk_duplicate_decisions').delete().in('brand_b', created.brands));
    await del('hk_contacts', svc.from('hk_contacts').delete().in('brand_id', created.brands));
    await del('hk_events', svc.from('hk_events').delete().eq('business_id', HK).in('entity_id', created.brands));
    await del('hk_brands', svc.from('hk_brands').delete().in('id', created.brands));
  }
  results.deleted = out;
  log('deleted exactly the created rows:', JSON.stringify(out), 'brand ids', JSON.stringify(created.brands));
}
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  await removeCreated();
  if (owner) { log(await owner.release()); owner = null; }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 300000 });
fs.mkdirSync(OUT, { recursive: true });
const pre = await svc.from('hk_brands').select('id, name').eq('business_id', HK).ilike('name', 'Zz Verify%');
if (pre.data?.length) { console.log('ABORT: leftover verify brands exist - remove them first:', pre.data.map(b => b.id).join(', ')); process.exit(1); }
const before = await snapshot();
log('before', JSON.stringify(before.humankind), 'HomeLover accounts', before.homelover.accounts, 'settings confirmed', before.settings?.stats_confirmed_at);
const MEASURE = measureScript({ scope: '[data-hk-shell]' });
const SHELL_CHROME = /hk-nav__item|aria-label="Your account"|hk-pill|hk-search\b|ui-seg__btn|ui-tab\b|hk-link|hk-table__name|ui-btn--tertiary|hk-menu__item|hk-subnav__item|hk-chip__x/;

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
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
    const hkWrite = new RegExp(`^/api/hk/${HK}/(brands(/[^/]+)?(/contacts(/[^/]+)?)?|brands/check|sponsors/[^/]+/periods(/[^/]+)?|review/duplicates/decide)$`);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (/anthropic\.com$|apollo\.io$|gmail\.googleapis\.com$/.test(u.host) || (u.host === 'www.googleapis.com' && u.pathname.startsWith('/gmail'))) realCalls.push(`${req.method()} ${u.host}${u.pathname}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      const allowedWrite = isLocal && ['POST', 'PATCH', 'DELETE'].includes(req.method()) && hkWrite.test(u.pathname) && !/\/settings|\/me\/prefs/.test(u.pathname);
      if (allowedWrite) writes.push(`${req.method()} ${u.pathname}`);
      const deny = (isLocal && (BLOCK.test(u.pathname) || (req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname) && !allowedWrite)))
        || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/'))
        || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.host}${u.pathname}`); return route.abort(); }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 140)));
    page.on('response', async r => { const u = new URL(r.url()); if (u.host !== `localhost:${PORT}` || r.request().method() !== 'POST' || r.status() !== 201 || !/\/brands$/.test(u.pathname)) return; try { const body = await r.json(); if (body.brand?.id) created.brands.push(body.brand.id); } catch {} });
    await page.goto(`${BASE}/`);
    if (viewport.width < 900) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 20000 });
    await page.getByLabel('Workspace').selectOption({ label: 'HumanKind' });
    await page.locator('[data-hk-shell] [data-hk-avatar]').waitFor({ timeout: 20000 }); await page.waitForTimeout(500);
    return { ctx, page, errors };
  }
  const measure = async (page, key) => {
    const m = await page.evaluate(MEASURE); if (m.error) { results.errors.push(`${key}: ${m.error}`); return null; }
    const s = summarize(m);
    const hard = m.controls.filter(c => c.ratio < 3 && !c.textOnly && !c.disabled && !SHELL_CHROME.test(c.sel || ''));
    const textHard = s.textFails - s.textFailsDisabled;
    results.screens[key] = { ...s, textHard, hardControlFails: hard.length, hard: hard.slice(0, 6).map(c => `${c.ratio} ${c.sel} "${String(c.text || '').slice(0, 30)}"`), scrollW: m.scrollW, vw: m.vw };
    log(key, `text ${s.textFails}/${s.texts} (disabled ${s.textFailsDisabled})`, `controls ${s.controlFails}/${s.controls} (text-only, shell chrome or disabled ${s.controlFails - hard.length}, must-fix ${hard.length})`);
    if (textHard || hard.length) log(formatWorst(key, { ...s, worst: [...s.worstText.filter(t => !t.disabled), ...hard.slice(0, 6)] }));
    return s;
  };
  const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide' });
  const shellText = page => page.evaluate(() => document.querySelector('[data-hk-shell]').innerText);
  const waitText = async (page, re, ms = 6000) => { try { await page.waitForFunction(r => new RegExp(r).test(document.querySelector('[data-hk-shell]')?.innerText || ''), re.source, { timeout: ms }); return true; } catch { return false; } };
  const nav = async (page, id) => { await page.locator(`[data-hk-nav="${id}"]`).click(); await page.waitForTimeout(700); };

  const D = await open({ width: 1440, height: 900 });
  // Seed through the app's own routes (allowed writes); the UI flows then act on them.
  const seed = async body => D.page.evaluate(async ([b, hk]) => { const r = await fetch(`/api/hk/${hk}/brands`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return r.status; }, [body, HK]);
  const statuses = [];
  for (const b of [{ name: 'Zz Verify Juice', domain: 'zz-verify-juice.example', niche: 'juice' }, { name: 'Zz Verify Cafe' }, { name: 'Zz Verify Yoga', domain: 'zz-verify-yoga.example' }, { name: 'Zz Verify Yoga Studio', force_duplicate: true }, { name: 'Zz Verify Run Club', domain: 'zz-verify-run.example', claim: true }, { name: 'Zz Verify Run Club Chicago', force_duplicate: true }, { name: 'Zz Verify Nodomain', claim: true }]) statuses.push(await seed(b));
  await D.page.waitForTimeout(600);
  ok(`0 seeded 7 invented brands through POST /brands (${statuses.join(',')})`, statuses.every(s => s === 201) && created.brands.length === 7);
  // Pipeline: claimed brands only; no Board toggle; no nav badges
  await nav(D.page, 'pipeline');
  await D.page.locator('[data-hk-brands="pipeline"]').waitFor(); await D.page.waitForTimeout(600);
  const pipeNames = await D.page.locator('[data-hk-brand]').allInnerTexts();
  ok(`1 Pipeline table lists only brands in motion (${pipeNames.length}: claimed), no Board toggle, no nav badges`, pipeNames.length === 2 && pipeNames.every(t => /Zz Verify Run Club\b|Nodomain/.test(t.replace(/\s+/g, ' '))) && (await D.page.getByRole('button', { name: /^Board$/ }).count()) === 0 && (await D.page.locator('.hk-nav__badge').count()) === 0, pipeNames.map(t => t.replace(/\s+/g, ' ').slice(0, 24)).join(' | '));
  // Sponsors
  await nav(D.page, 'sponsors'); await D.page.locator('[data-hk-sponsors]').waitFor();
  ok('2 Sponsors shows the top note', /Brands here are blocked from drafting\. Niche is used to warn on lookalike brands\./.test(await shellText(D.page)));
  await D.page.locator('[data-hk-add-sponsor]').click(); const picker = D.page.locator('[data-hk-picker]'); await picker.waitFor();
  await picker.getByLabel('Search brands').fill('zz verify juice'); await picker.getByRole('radio').first().waitFor(); await picker.getByRole('radio').first().check();
  await picker.getByRole('button', { name: 'Mark as sponsor' }).click();
  const sponsorRow = await D.page.locator('[data-hk-sponsor]').first().waitFor({ timeout: 6000 }).then(() => true).catch(() => false);
  ok('3 + Add sponsor: picker -> the brand is listed under sponsors as Sponsor', sponsorRow && /Zz Verify Juice/.test(await D.page.locator('[data-hk-sponsor]').innerText()) && /Sponsor/.test(await D.page.locator('[data-hk-sponsor]').innerText()));
  await D.page.locator('[data-hk-sponsor]').getByRole('button', { name: 'Add period' }).click();
  await D.page.getByLabel('Period (YYYY-MM or launch)').fill('launch'); await D.page.getByRole('button', { name: 'Save period' }).click();
  await waitText(D.page, /Launch/);
  await D.page.locator('[data-hk-sponsor]').getByRole('button', { name: 'Add period' }).click();
  await D.page.getByLabel('Period (YYYY-MM or launch)').fill('2026-07'); await D.page.getByLabel('Note').fill('first monthly'); await D.page.getByRole('button', { name: 'Save period' }).click();
  ok('4 periods: Launch and Jul 26 chips', await waitText(D.page, /Jul 26/) && /Launch/.test(await shellText(D.page)));
  await D.page.getByRole('button', { name: 'Remove Launch' }).click();
  ok('4 owner-role removes a period', await D.page.waitForFunction(() => !/Launch/.test(document.querySelector('[data-hk-sponsors]')?.innerText || ''), null, { timeout: 5000 }).then(() => true).catch(() => false));
  await D.page.locator('[data-hk-add-dnc]').click(); await picker.waitFor();
  await picker.getByLabel('Search brands').fill('zz verify cafe'); await picker.getByRole('radio').first().waitFor(); await picker.getByRole('radio').first().check();
  await picker.getByLabel('Why?').fill('verify: declined twice'); await picker.getByRole('button', { name: 'Block' }).click();
  const dncRow = await D.page.locator('[data-hk-dnc]').first().waitFor({ timeout: 6000 }).then(() => true).catch(() => false);
  const dncText = dncRow ? await D.page.locator('[data-hk-dnc]').innerText() : '';
  ok('5 DNC + Add: listed with reason, marked by Jack, date', dncRow && /Zz Verify Cafe/.test(dncText) && /declined twice/.test(dncText) && /Jack ·/.test(dncText), dncText.replace(/\s+/g, ' ').slice(0, 120));
  await measure(D.page, 'sponsors@1440'); await shot(D.page, 'sponsors-1440');
  // Review
  await nav(D.page, 'review'); await D.page.locator('[data-hk-review]').waitFor(); await D.page.waitForTimeout(800);
  const pairsN = await D.page.locator('[data-hk-pair]').count();
  ok(`6 Review > Possible duplicates shows the two seeded pairs side by side (${pairsN}); a second live brand on the same domain is refused by the unique index, so pairs are name pairs`, pairsN === 2 && /One name contains the other/.test(await shellText(D.page)));
  const yogaPair = D.page.locator('[data-hk-pair]').filter({ hasText: 'Zz Verify Yoga Studio' });
  await yogaPair.getByRole('button', { name: 'Not a duplicate' }).click();
  ok('7 Not a duplicate hides the pair', await D.page.waitForFunction(() => document.querySelectorAll('[data-hk-pair]').length === 1, null, { timeout: 5000 }).then(() => true).catch(() => false));
  await D.page.locator('[data-hk-pair]').getByRole('button', { name: 'Merge into left' }).click();
  const confirmText = await D.page.locator('[data-hk-merge-confirm]').innerText();
  ok('8 Merge into left shows the confirm listing what moves', /contacts, touches, replies and sponsor periods move over/.test(confirmText) && /archived and kept as an alias/.test(confirmText));
  await D.page.locator('[data-hk-merge-confirm]').getByRole('button', { name: 'Merge' }).click();
  ok('8 after Merge: nothing to merge', await D.page.waitForFunction(() => document.querySelectorAll('[data-hk-pair]').length === 0, null, { timeout: 5000 }).then(() => true).catch(() => false));
  await measure(D.page, 'review@1440'); await shot(D.page, 'review-1440');
  await D.page.getByRole('tab', { name: /^Imports/ }).click(); await D.page.waitForTimeout(300);
  ok('9 Imports tab = empty state', /No imports yet/.test(await shellText(D.page)));
  await D.page.getByRole('tab', { name: /^Data warnings/ }).click(); await D.page.waitForTimeout(500);
  ok('9 Data warnings lists the claimed brand without a domain', (await D.page.locator('[data-hk-warning="missing_domain"]').count()) >= 1 && /Zz Verify Nodomain/.test(await shellText(D.page)));
  // Activity
  await nav(D.page, 'activity'); await D.page.locator('[data-hk-activity]').waitFor(); await D.page.waitForTimeout(800);
  const evAll = await D.page.locator('[data-row="true"]').count();
  await D.page.getByLabel('Action').selectOption('sponsor.'); await D.page.waitForTimeout(700);
  const evSponsor = await D.page.locator('[data-row="true"]').count();
  await D.page.getByLabel('Action').selectOption(''); await D.page.waitForFunction(() => document.querySelectorAll('[data-row="true"]').length > 3, null, { timeout: 6000 }).catch(() => {});
  await D.page.getByLabel('Brand').fill('cafe'); await D.page.waitForFunction(() => { const n = document.querySelectorAll('[data-row="true"]').length; return n > 0 && n < 4; }, null, { timeout: 6000 }).catch(() => {});
  const evCafe = await D.page.locator('[data-row="true"]').count();
  ok(`10 Activity table: ${evAll} events, filter by action (sponsor: ${evSponsor}), filter by brand (cafe: ${evCafe}), no "@"`, evAll >= 10 && evSponsor === 3 && evCafe >= 2 && !(await shellText(D.page)).includes('@'));
  // Settings > Pitch (read only)
  await nav(D.page, 'settings'); await D.page.locator('.hk-subnav__item', { hasText: 'Pitch' }).click(); await D.page.locator('[data-hk-pitch]').waitFor(); await D.page.waitForTimeout(500);
  const pitch = await shellText(D.page);
  ok('11 Settings > Pitch: 1,500+ members / 6,000+ completions, amber "Not confirmed yet" + Confirm stats, both market lines with preview, subject format, 11 banned phrases, locked rules with lock icons', /1,500\+ members and 6,000\+ challenge completions/.test(pitch) && (await D.page.locator('[data-hk-stats="unconfirmed"]').count()) === 1 && (await D.page.locator('[data-hk-confirm-stats]').count()) === 1 && /I'm Jack, co-founder of HumanKind, a free community wellness platform launched in Chicago in April and built for our Chicago members\./.test(pitch) && (await D.page.locator('#hk-subject').inputValue()) === 'HumanKind x [Brand] - [descriptor]' && (await D.page.locator('[data-hk-banned] .hk-chip').count()) === 11 && (await D.page.locator('[data-hk-locked] li').count()) >= 12 && (await D.page.locator('[data-hk-locked] svg[aria-label="Locked"]').count()) >= 12);
  await measure(D.page, 'settings-pitch@1440'); await shot(D.page, 'settings-pitch-1440');
  await D.page.locator('.hk-subnav__item', { hasText: 'Members' }).click(); await D.page.waitForTimeout(300);
  const jackColor = await D.page.locator('[data-hk-member]').first().locator('.hk-avatar').evaluate(el => getComputedStyle(el).backgroundColor);
  ok('12 Members: the owner avatar takes slot 1 from hk_member_prefs (green)', jackColor === 'rgb(39, 130, 69)', jackColor);
  ok('No page errors (1440)', !D.errors.length, JSON.stringify(D.errors.slice(0, 3)));
  await D.ctx.close();
  // 390
  const P = await open({ width: 390, height: 844 });
  const noScroll = () => P.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const more = async id => { await P.page.locator('[data-hk-tab="more"]').click(); await P.page.locator('[data-hk-more]').getByRole('button', { name: new RegExp(`^${id}$`, 'i') }).click(); await P.page.waitForTimeout(800); };
  await more('Sponsors'); const s390 = await noScroll();
  await more('Review'); const r390 = await noScroll();
  await more('Pipeline'); const p390 = await noScroll();
  ok('13 390: Sponsors, Review and Pipeline render without sideways page scroll', s390 && r390 && p390, `${s390}/${r390}/${p390}`);
  await shot(P.page, 'sponsors-390');
  ok('No page errors (390)', !P.errors.length, JSON.stringify(P.errors.slice(0, 3)));
  await P.ctx.close();
  const fails = Object.entries(results.screens).filter(([, s]) => s.textHard || s.hardControlFails);
  ok(`contrast on ${Object.keys(results.screens).length} screens: 0 text failures (disabled text exempt), 0 must-fix control boundaries`, Object.keys(results.screens).length === 3 && !fails.length, JSON.stringify(fails.map(([k, s]) => [k, s.textHard, s.hard])));
  ok(`real-call guard: 0 requests to Anthropic / Apollo / Gmail hosts; ${writes.length} allowed hk writes, none to settings or prefs; ${blocked.length} other non-GET / outside requests aborted`, !realCalls.length && writes.every(w => w.includes(`/api/hk/${HK}/`) && !/settings|prefs/.test(w)));
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    const after = await snapshot();
    const d = results.deleted || {};
    restored = JSON.stringify(before) === JSON.stringify(after) && d.hk_brands === created.brands.length;
    line = restored ? `yes (HumanKind hk_* + settings row + HomeLover counts identical; deleted exactly the created rows: ${JSON.stringify(d)}; Jack sign-in rows kept by rule)` : `NO - before ${JSON.stringify(before)} after ${JSON.stringify(after)} deleted ${JSON.stringify(d)} created ${JSON.stringify(created)}`;
  } catch (e) { line = `NO (check failed: ${e.message})`; }
  const pass = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'hkos-data-foundation-v1-stage4.json'), JSON.stringify({ ...results, created, restored }, null, 2));
  console.log(`\n${pass}/${results.checks.length} checks passed${results.errors.length ? ` · ${results.errors.length} errors` : ''} · Claude 0 · Apollo 0`);
  for (const e of results.errors) console.log('ERROR:', e.split('\n').slice(0, 3).join(' | '));
  console.log(`restored: ${line}`);
  process.exit(restored ? 0 : 1);
}
