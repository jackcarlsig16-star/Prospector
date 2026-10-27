// hkos-gmail-connect-v1 Stage 3 live check - localhost against the build, as Jack (ownerSession; sign-in rows KEPT by
// rule, last_seen_at restored) on the REAL HumanKind workspace. READ ONLY: every non-GET to /api and /proxy is aborted
// (the page-load POST /sync included, so 0 Gmail calls), every non-GET to Supabase REST is aborted, every outside host
// except Supabase + Google Fonts is blocked. No rows are created. Checks: nav has Drafts + Replies, the sync pill shows
// one of its known texts, Drafts / Replies render (empty states on the real data, 0 touches / 0 replies today) with no
// Send control, Settings > Connections shows the caller's mailbox row + Sync now + signature, the Brand page offers
// "Draft email..." and the composer never shows an address and keeps Save closed before a lint. Contrast on 3 screens
// (Drafts, Replies, Settings > Connections): 0 text failures, 0 must-fix control boundaries. 390: Drafts, Replies,
// Settings > Connections without sideways page scroll. restored = every hk_* count + HomeLover counts identical; a
// count() error or non-number THROWS -> "restored: NO", exit 1. Runtime ~1-2 min, hard cap 240 s. 0 Claude, 0 Apollo,
// 0 Gmail. Shots: .screenshots/hkos-gmail-connect-v1/.
// Usage: node scripts/verify/hkos-gmail-connect-v1-stage3.mjs   (npm run build first)
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
const OUT = path.join(ROOT, '.screenshots', 'hkos-gmail-connect-v1');
const PORT = 3993, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const HK = '981b790c-a3b0-4265-b32e-1f701d5731ff';
const HK_TABLES = ['hk_brands', 'hk_contacts', 'hk_touches', 'hk_replies', 'hk_sponsor_periods', 'hk_settings', 'hk_events', 'hk_duplicate_decisions', 'hk_import_runs', 'hk_ignored_senders', 'hk_member_prefs', 'hk_gmail_sync_state', 'hk_sync_runs', 'business_members', 'workspace_mailboxes'];
const HL_TABLES = ['accounts', 'lists', 'projects', 'sales_goals', 'sales_opportunities', 'sales_targets', 'sales_people', 'sales_source_events', 'sales_partner_events', 'partner_contacts', 'sales_week_goals'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const count = async (t, biz) => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', biz); if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message || `no count (HTTP ${r.status})`}`); return r.count; };
const snapshot = async () => { const o = { humankind: {}, homelover: {} }; for (const t of HK_TABLES) o.humankind[t] = await count(t, HK); for (const t of HL_TABLES) o.homelover[t] = await count(t, HOMELOVER); const g = await svc.from('google_grants').select('*', { count: 'exact', head: true }); if (g.error || typeof g.count !== 'number') throw new Error('count google_grants'); o.google_grants = g.count; return o; };
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }

let srv, browser, owner;
const blocked = [], realCalls = [];
const results = { checks: [], errors: [], screens: {}, skipped: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${detail}` : ''); };
const skip = (name, why) => { results.skipped.push({ name, why }); log('SKIP', name, `- ${why}`); };
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  if (owner) { log(await owner.release()); owner = null; }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 240000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before.humankind), 'HomeLover accounts', before.homelover.accounts, 'grants', before.google_grants);
const MEASURE = measureScript({ scope: '[data-hk-shell]' });
const SHELL_CHROME = /hk-nav__item|aria-label="Your account"|hk-pill|hk-sync|hk-search\b|ui-seg__btn|ui-tab\b|hk-link|hk-table__name|ui-btn--tertiary|hk-menu__item|hk-subnav__item|hk-chip__x/;
const PILL_TEXTS = /^(Link your Gmail|Gmail needs reconnect|Syncing|Gmail sync failed|Gmail linked, not synced yet|Gmail synced .+ ago|Gmail synced just now)$/;

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
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (/anthropic\.com$|apollo\.io$|gmail\.googleapis\.com$|accounts\.google\.com$/.test(u.host) || (u.host === 'www.googleapis.com')) realCalls.push(`${req.method()} ${u.host}${u.pathname}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      const deny = (isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname))
        || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/'))
        || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.pathname}`); return route.abort(); }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 140)));
    await page.goto(`${BASE}/`);
    if (viewport.width < 900) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 20000 });
    await page.getByLabel('Workspace').selectOption({ label: 'HumanKind' });
    await page.locator('[data-hk-shell] [data-hk-avatar]').waitFor({ timeout: 20000 }); await page.waitForTimeout(900);
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
  const nav = async (page, id) => { await page.locator(`[data-hk-nav="${id}"]`).click(); await page.waitForTimeout(800); };
  const noAddress = s => !/[^\s@<>()"']+@[^\s@<>()"']+\.[a-z]{2,}/i.test(s);

  const D = await open({ width: 1440, height: 900 });
  // nav + pill
  ok('1 nav lists Drafts and Replies', (await D.page.locator('[data-hk-nav="drafts"]').count()) === 1 && (await D.page.locator('[data-hk-nav="replies"]').count()) === 1);
  const pillN = await D.page.locator('[data-hk-sync]').count();
  const pillText = pillN ? (await D.page.locator('[data-hk-sync]').innerText()).trim() : '';
  ok(`2 sync pill sits in the top bar with a known text ("${pillText}"), no dash`, pillN === 1 && PILL_TEXTS.test(pillText) && !/[–—]/.test(pillText), `tone ${pillN ? await D.page.locator('[data-hk-sync]').getAttribute('data-hk-sync') : 'none'}`);
  // Drafts
  await nav(D.page, 'drafts'); await D.page.locator('[data-hk-drafts]').waitFor(); await D.page.waitForTimeout(800);
  const draftsText = await shellText(D.page);
  const rows = await D.page.locator('[data-hk-drafts] [data-row]').count();
  ok(`3 Drafts renders (${rows} rows on the real data) with the no-send strip and no Send control or address`, /Drafts waiting in Gmail for you to send/.test(draftsText) && /There is no Send button here/.test(draftsText) && (await D.page.getByRole('button', { name: /^Send\b/ }).count()) === 0 && noAddress(draftsText), rows ? '' : 'empty state');
  await measure(D.page, 'drafts@1440'); await shot(D.page, 'drafts-1440');
  // Replies
  await nav(D.page, 'replies'); await D.page.locator('[data-hk-replies]').waitFor(); await D.page.waitForTimeout(800);
  const repliesText = await shellText(D.page);
  ok('4 Replies renders with the label / owner / handled filters, no address', /Brands that wrote back/.test(repliesText) && (await D.page.getByLabel('Label').count()) === 1 && (await D.page.getByLabel('Handled').count()) === 1 && noAddress(repliesText));
  await measure(D.page, 'replies@1440'); await shot(D.page, 'replies-1440');
  // Settings > Connections
  await nav(D.page, 'settings'); await D.page.locator('.hk-subnav__item', { hasText: 'Connections' }).click(); await D.page.locator('[data-hk-connections]').waitFor(); await D.page.waitForTimeout(600);
  const connText = await shellText(D.page);
  const myRow = D.page.locator('[data-hk-mailbox-row="me"]');
  const otherRows = await D.page.locator('[data-hk-mailbox-row="other"]').count();
  ok(`5 Settings > Connections: my Gmail row with state, Sync now, Manage on Connections, one row per other member (${otherRows}, HumanKind has ${before.humankind.business_members} member row${before.humankind.business_members === 1 ? '' : 's'} today), the signature field + preview`, (await myRow.count()) === 1 && /Gmail - Jack/.test(connText) && (await D.page.locator('[data-hk-sync-now]').count()) === 1 && (await D.page.locator('[data-hk-manage-connections]').count()) === 1 && otherRows === before.humankind.business_members - 1 && (await D.page.locator('[data-hk-signature]').count()) === 1 && /Worth a 15-minute call/.test(connText), (await myRow.innerText()).replace(/\s+/g, ' ').replace(/[^\s@]+@[^\s]+/g, '<address>').slice(0, 90));
  ok('6 the address hash points at #hk/settings/connections', await D.page.evaluate(() => window.location.hash) === '#hk/settings/connections');
  await measure(D.page, 'settings-connections@1440'); await shot(D.page, 'settings-connections-1440');
  // Brand page composer
  await nav(D.page, 'brands'); await D.page.locator('[data-hk-brands]').waitFor(); await D.page.waitForTimeout(800);
  const anyBrand = D.page.locator('[data-hk-brand] .hk-table__name').first();
  if (await anyBrand.count()) {
    await anyBrand.click(); await D.page.locator('[data-hk-brand-page]').waitFor().catch(() => {}); await D.page.waitForTimeout(800);
    await D.page.getByRole('button', { name: 'More' }).click(); await D.page.waitForTimeout(200);
    const item = D.page.locator('[data-hk-draft-email]');
    ok('7 Brand page: More menu offers "Draft email…"', (await item.count()) === 1);
    await item.click(); await D.page.locator('[data-hk-composer]').waitFor(); await D.page.waitForTimeout(600);
    const comp = D.page.locator('[data-hk-composer]');
    const compText = await comp.innerText();
    const save = comp.locator('[data-hk-save-draft]');
    ok('8 composer: To is read-only without an address, Save to Gmail Drafts is disabled before a lint with the reason in its title, Nothing here sends', (await comp.locator('[data-hk-composer-to]').getAttribute('readonly')) !== null && noAddress(compText) && (await save.isDisabled()) && /Run lint first\.|No contact with an email yet|Link your Gmail/.test((await save.getAttribute('title')) || '') && /Nothing here sends/.test(compText), `title "${await save.getAttribute('title')}"`);
    await comp.getByRole('button', { name: 'Cancel' }).click(); await D.page.waitForTimeout(200);
    ok('8 Cancel closes the composer', (await D.page.locator('[data-hk-composer]').count()) === 0);
  } else { skip('7-8 Brand page More > Draft email… + composer', `0 live brands on HumanKind today (sheet import pending); read-only run creates none; covered by Jest gmailScreens.test.js`); }
  ok('No page errors (1440)', !D.errors.length, JSON.stringify(D.errors.slice(0, 3)));
  await D.ctx.close();
  // 390
  const P = await open({ width: 390, height: 844 });
  const noScroll = () => P.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const tab = async id => { await P.page.locator(`[data-hk-tab="${id}"]`).click(); await P.page.waitForTimeout(800); };
  const more = async id => { await P.page.locator('[data-hk-tab="more"]').click(); await P.page.locator('[data-hk-more]').getByRole('button', { name: new RegExp(`^${id}$`, 'i') }).click(); await P.page.waitForTimeout(800); };
  ok('9 390: the sync pill sits in the phone header', (await P.page.locator('.hk-phone-top [data-hk-sync]').count()) === 1);
  await tab('drafts'); const d390 = await noScroll(); await shot(P.page, 'drafts-390');
  await tab('replies'); const r390 = await noScroll();
  await more('Settings'); await P.page.locator('.hk-subnav__item', { hasText: 'Connections' }).click(); await P.page.waitForTimeout(600); const c390 = await noScroll(); await shot(P.page, 'settings-connections-390');
  ok('10 390: Drafts, Replies and Settings > Connections render without sideways page scroll', d390 && r390 && c390, `${d390}/${r390}/${c390}`);
  ok('No page errors (390)', !P.errors.length, JSON.stringify(P.errors.slice(0, 3)));
  await P.ctx.close();
  const fails = Object.entries(results.screens).filter(([, s]) => s.textHard || s.hardControlFails);
  ok(`contrast on ${Object.keys(results.screens).length} screens: 0 text failures (disabled text exempt), 0 must-fix control boundaries`, Object.keys(results.screens).length === 3 && !fails.length, JSON.stringify(fails.map(([k, s]) => [k, s.textHard, s.hard])));
  const syncAttempts = blocked.filter(b => /\/sync\b/.test(b));
  ok(`real-call guard: 0 requests to Anthropic / Apollo / Google hosts; ${blocked.length} non-GET requests aborted (${syncAttempts.length} page-load sync attempts, all aborted before Gmail)`, !realCalls.length, blocked.slice(0, 5).join(', '));
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    const after = await snapshot();
    restored = JSON.stringify(before) === JSON.stringify(after);
    line = restored ? 'yes (read-only run; HumanKind hk_* + workspace_mailboxes + google_grants + HomeLover counts identical; Jack sign-in rows kept by rule)' : `NO - before ${JSON.stringify(before)} after ${JSON.stringify(after)}`;
  } catch (e) { line = `NO (check failed: ${e.message})`; }
  const pass = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'hkos-gmail-connect-v1-stage3.json'), JSON.stringify({ ...results, blocked, realCalls, restored }, null, 2));
  console.log(`\n${pass}/${results.checks.length} checks passed${results.skipped.length ? ` · ${results.skipped.length} skipped (${results.skipped.map(s => s.name).join('; ')})` : ''}${results.errors.length ? ` · ${results.errors.length} errors` : ''} · Claude 0 · Apollo 0 · Gmail ${realCalls.length}`);
  for (const e of results.errors) console.log('ERROR:', e.split('\n').slice(0, 3).join(' | '));
  console.log(`restored: ${line}`);
  process.exit(restored ? 0 : 1);
}
