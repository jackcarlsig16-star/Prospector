// hkos-inbox-v1 Stage 2 check - localhost against the build, as Jack (ownerSession; sign-in rows KEPT by rule,
// last_seen_at restored) on the REAL HumanKind workspace. READ ONLY and 0 Gmail: every non-GET to /api and /proxy is
// aborted (the page-load POST /sync included), the two GET /inbox/* routes are FULFILLED IN THE BROWSER from an
// invented fixture (so the layout, chips, frame and panel render without one Gmail call; Stage 3 reads the real
// mailbox), every non-GET to Supabase REST is aborted, every outside host except Supabase + Google Fonts is blocked.
// Checks: Inbox three panes with one row per chip kind, the thread pane's <iframe sandbox=""> with sanitized srcdoc and
// blocked images, Show images, the brand panel's Track as brand / Ignore this sender, no Send control, Settings >
// Connections Inbox options (toggle + ignored list), Today / Drafts / Replies empty copy without "later step", the sync
// pill text. Contrast on 3 screens (Inbox, Settings > Connections, Today): 0 text failures, 0 must-fix control
// boundaries. 390: Inbox list -> thread -> back, Connections, without sideways page scroll. restored = every hk_* count +
// HomeLover counts identical; a count() error or non-number THROWS -> "restored: NO", exit 1. Runtime ~1-2 min, cap
// 240 s. 0 Claude, 0 Apollo, 0 Gmail. Shots: .screenshots/hkos-inbox-v1/.
// Usage: node scripts/verify/hkos-inbox-v1-stage2.mjs   (npm run build first)
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
const OUT = path.join(ROOT, '.screenshots', 'hkos-inbox-v1');
const PORT = 3995, BASE = `http://localhost:${PORT}`;
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

// The invented inbox: one thread per chip kind. Addresses live only inside the one html body (the owner's own, by ruling).
const row = (id, chip, over = {}) => ({ thread_id: id, unread: false, from_name: 'Sam Lee', from_domain: 'bluefin.invalid', from_hint: 'bluefin.invalid', date: new Date(Date.now() - 3600e3).toISOString(), subject: `Fixture ${id}`, snippet: 'Saw the app, would love to chat about a run challenge', message_count: 1, has_attachments: false, chip, ...over });
const FIX_LIST = { tab: 'inbox', unread: 2, next_page_token: null, fetched_at: new Date().toISOString(), scanned: 5, gmail_calls: 0, from_cache: false, threads: [
  row('fx-tracked', { kind: 'tracked', brand_id: 'fx-b1', brand_name: 'Harbor Yoga (fixture)', status: 'sent', label: 'interested' }, { from_name: 'Ana', from_domain: 'harboryoga.invalid', from_hint: 'Owner', unread: true }),
  row('fx-match', { kind: 'matches', brand_id: 'fx-b2', brand_name: 'Bluefin Run Club (fixture)', status: 'candidate' }, { unread: true, from_hint: 'Co-founder' }),
  row('fx-team', { kind: 'team' }, { from_name: 'Pete', from_domain: 'humankindcollective.app', from_hint: 'humankindcollective.app' }),
  row('fx-bulk', { kind: 'not_tracked', reason: 'bulk' }, { from_name: 'shop.invalid', from_domain: 'shop.invalid' }),
  row('fx-new', { kind: 'untracked' }, { from_name: 'Ana Ortiz', from_domain: 'newbrand.invalid', from_hint: 'newbrand.invalid', has_attachments: true }),
] };
const FIX_HTML = '<p>Saw the app. Reach me at sam@bluefin.invalid or on the site.</p><img src="https://t.invalid/pixel.gif" width="1" height="1"><script>steal()</script><form action="https://x.invalid"><input></form><a href="https://bluefin.invalid/deck">Our deck</a>';
const FIX_THREAD = { thread_id: 'fx-new', subject: 'Fixture fx-new', fetched_at: new Date().toISOString(), from_cache: false, unhandled_reply_id: null, sender: { name: 'Ana Ortiz', domain: 'newbrand.invalid' }, chip: { kind: 'untracked' }, brand: null,
  messages: [{ id: 'fx-m1', from_name: 'Ana Ortiz', from_domain: 'newbrand.invalid', is_mine: false, to_names: ['you'], cc_names: [], date: new Date(Date.now() - 3600e3).toISOString(), subject: 'Fixture fx-new', unread: true, text: 'Saw the app', html: FIX_HTML, attachments: [{ name: 'Deck.pdf', size: 48213 }] }] };

let srv, browser, owner;
const blocked = [], realCalls = [], fulfilled = [];
const results = { checks: [], errors: [], screens: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${detail}` : ''); };
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
const SHELL_CHROME = /hk-nav__item|aria-label="Your account"|hk-pill|hk-sync|hk-search\b|ui-seg__btn|ui-tab\b|hk-link|hk-table__name|ui-btn--tertiary|hk-menu__item|hk-subnav__item|hk-chip__x|ui-switch/;
const PILL_TEXTS = /^(Link your Gmail|Gmail needs reconnect|Syncing|Gmail sync failed|Gmail linked, not synced yet|Gmail synced .+ ago|Gmail synced just now|Gmail synced · nothing tracked yet)$/;
const noAddress = s => !/[^\s@<>()"']+@[^\s@<>()"']+\.[a-z]{2,}/i.test(s);

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  async function open(viewport) {
    const ctx = await browser.newContext({ viewport });
    await ctx.addInitScript(([k, v, b, d]) => {
      if (window !== window.top) return; // the sandboxed reading frame has no storage; this script is the verify's, not the app's
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      for (const n of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${n}_ran_${b}`, d);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HOMELOVER, today]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (/anthropic\.com$|apollo\.io$|gmail\.googleapis\.com$|accounts\.google\.com$/.test(u.host) || (u.host === 'www.googleapis.com')) realCalls.push(`${req.method()} ${u.host}${u.pathname}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      if (isLocal && req.method() === 'GET' && /^\/api\/hk\/[^/]+\/inbox\/threads/.test(u.pathname)) {
        fulfilled.push(u.pathname + u.search);
        const body = /\/inbox\/threads\/[^/]+$/.test(u.pathname) ? FIX_THREAD : FIX_LIST;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      }
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

  const D = await open({ width: 1440, height: 900 });
  const pillText = (await D.page.locator('[data-hk-sync]').innerText()).trim();
  ok(`1 sync pill shows a known text ("${pillText}"), no dash`, PILL_TEXTS.test(pillText) && !/[–—]/.test(pillText));
  // Today empty copy
  const todayText = await shellText(D.page);
  ok('2 Today empty state says what fills it, no "later step" or "once Gmail is connected"', /Sheet import/.test(todayText) && /Gmail sync/.test(todayText) && !/later step|once Gmail is connected/i.test(todayText));
  await measure(D.page, 'today@1440');
  // Inbox
  ok('3 nav lists Inbox', (await D.page.locator('[data-hk-nav="inbox"]').count()) === 1);
  await nav(D.page, 'inbox'); await D.page.locator('[data-hk-inbox]').waitFor(); await D.page.locator('[data-hk-thread="fx-new"]').waitFor(); await D.page.waitForTimeout(500);
  const kinds = await D.page.locator('[data-hk-thread]').evaluateAll(els => els.map(e => e.getAttribute('data-hk-chip')));
  ok(`4 Inbox list: one row per chip kind (${kinds.join(', ')}), the not-tracked row dimmed, 2 unread dots, the Inbox badge = 2`, kinds.sort().join() === 'matches,not_tracked,team,tracked,untracked' && (await D.page.locator('.hk-inbox__row--dim').count()) === 1 && (await D.page.locator('.hk-inbox__dot').count()) === 2 && (await D.page.locator('[data-hk-nav="inbox"] .hk-nav__badge').innerText()) === '2');
  const listText = await shellText(D.page);
  ok('5 the list carries no address, no Send, no compose box; footer "Only you see your inbox."', noAddress(listText) && !/\bSend\b/.test(listText) && (await D.page.locator('[data-hk-inbox] textarea').count()) === 0 && /Only you see your inbox/.test(listText));
  await D.page.locator('[data-hk-thread="fx-new"]').click(); await D.page.locator('[data-hk-frame]').waitFor(); await D.page.waitForTimeout(500);
  const frame = D.page.locator('[data-hk-frame]');
  const sandbox = await frame.getAttribute('sandbox'); const srcdoc = await frame.getAttribute('srcdoc');
  const frameBodyText = await D.page.frameLocator('[data-hk-frame]').locator('body').innerText().catch(() => '');
  ok('6 thread pane: html only inside <iframe sandbox=""> (no scripts, no same origin, no forms); srcdoc has no script / form / input; every img src is the placeholder with data-blocked-src kept; the frame shows the text', sandbox === '' && !/<script|<form|<input/i.test(srcdoc) && /data-blocked-src="https:\/\/t\.invalid\/pixel\.gif"/.test(srcdoc) && !/(?<![-\w])src="https:/.test(srcdoc) && /Saw the app/.test(frameBodyText));
  const paneText = await D.page.locator('[data-hk-inbox-thread]').innerText();
  const panelText = await D.page.locator('[data-hk-brand-panel="untracked"]').innerText();
  ok('7 thread pane: Images hidden strip + Show images, Reply in Gmail link (new tab, the caller\'s own authuser), attachment named with size, no address outside the frame, no Send', /Images are hidden/.test(paneText) && (await D.page.locator('[data-hk-reply-gmail]').getAttribute('target')) === '_blank' && /#all\/fx-new$/.test(await D.page.locator('[data-hk-reply-gmail]').getAttribute('href')) && /Deck\.pdf/.test(paneText) && noAddress(paneText) && !/\bSend\b/.test(paneText));
  ok('8 brand panel for a new sender: Not a brand yet, Track as brand, Ignore this sender', /Not a brand yet/.test(panelText) && (await D.page.locator('[data-hk-track-brand]').count()) === 1 && (await D.page.locator('[data-hk-ignore-sender]').count()) === 1);
  await D.page.locator('[data-hk-show-images]').click(); await D.page.waitForTimeout(400);
  const srcdoc2 = await frame.getAttribute('srcdoc');
  ok('9 Show images swaps the real src back in for this render and drops the strip', /(?<![-\w])src="https:\/\/t\.invalid\/pixel\.gif"/.test(srcdoc2) && (await D.page.locator('[data-hk-images-hidden]').count()) === 0);
  await D.page.locator('[data-hk-track-brand]').click(); await D.page.locator('[data-hk-add-brand]').waitFor();
  ok('10 Track as brand opens the Add brand modal titled Track as brand, prefilled with the sender name + domain', /Track as brand/.test(await D.page.locator('[data-hk-add-brand] h2').innerText()) && (await D.page.locator('#hk-brand-name').inputValue()) === 'Ana Ortiz' && (await D.page.locator('#hk-brand-domain').inputValue()) === 'newbrand.invalid');
  await D.page.keyboard.press('Escape'); await D.page.waitForTimeout(300);
  ok('10b Escape closes the modal without a brand (the read-only run aborted its brands/check POST)', (await D.page.locator('[data-hk-add-brand]').count()) === 0 && (await D.page.locator('.hk-backdrop').count()) === 0);
  await measure(D.page, 'inbox@1440'); await shot(D.page, 'inbox-1440');
  ok('11 the address hash is #hk/inbox', await D.page.evaluate(() => window.location.hash) === '#hk/inbox');
  // Drafts / Replies empty copy
  await nav(D.page, 'drafts'); await D.page.locator('[data-hk-drafts]').waitFor(); await D.page.waitForTimeout(600);
  const draftsText = await shellText(D.page);
  await nav(D.page, 'replies'); await D.page.locator('[data-hk-replies]').waitFor(); await D.page.waitForTimeout(600);
  const repliesText = await shellText(D.page);
  ok('12 Drafts and Replies carry no "later step" / "once Gmail is connected" wording', !/later step|once Gmail is connected/i.test(draftsText + repliesText));
  // Settings > Connections
  await nav(D.page, 'settings'); await D.page.locator('.hk-subnav__item', { hasText: 'Connections' }).click(); await D.page.locator('[data-hk-inbox-options]').waitFor(); await D.page.waitForTimeout(600);
  const connText = await shellText(D.page);
  const toggle = D.page.locator('[data-hk-inbox-options] [role="switch"]');
  ok('13 Settings > Connections > Inbox options: Show images by default toggle (off) + Ignored senders list', /Inbox options/.test(connText) && (await toggle.getAttribute('aria-checked')) === 'false' && /Ignored senders/.test(connText));
  await toggle.click(); await D.page.waitForTimeout(200);
  ok('14 the toggle writes prospector_hk_inbox_images = 1 on this device', (await D.page.evaluate(() => localStorage.getItem('prospector_hk_inbox_images'))) === '1' && (await toggle.getAttribute('aria-checked')) === 'true');
  await toggle.click();
  await measure(D.page, 'settings-connections@1440'); await shot(D.page, 'settings-connections-1440');
  ok('No page errors (1440)', !D.errors.length, JSON.stringify(D.errors.slice(0, 3)));
  await D.ctx.close();
  // 390
  const P = await open({ width: 390, height: 844 });
  const noScroll = () => P.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const more = async id => { await P.page.locator('[data-hk-tab="more"]').click(); await P.page.locator('[data-hk-more]').getByRole('button', { name: new RegExp(`^${id}$`, 'i') }).click(); await P.page.waitForTimeout(800); };
  await more('Inbox'); await P.page.locator('[data-hk-thread="fx-new"]').waitFor(); await P.page.waitForTimeout(400);
  const l390 = await noScroll(); await shot(P.page, 'inbox-390');
  await P.page.locator('[data-hk-thread="fx-new"]').click(); await P.page.locator('[data-hk-frame]').waitFor(); await P.page.waitForTimeout(500);
  const t390 = await noScroll();
  const onePane = (await P.page.locator('[data-hk-inbox-list]').count()) === 0 && (await P.page.locator('[data-hk-inbox-thread] [data-hk-brand-panel]').count()) === 1;
  await shot(P.page, 'inbox-thread-390');
  await P.page.locator('[data-hk-inbox-back]').click(); await P.page.waitForTimeout(300);
  const backOk = (await P.page.locator('[data-hk-inbox-list]').count()) === 1;
  ok('15 390: list, then one thread pane with the brand panel folded under the messages, Back returns to the list; no sideways page scroll', l390 && t390 && onePane && backOk, `${l390}/${t390}/${onePane}/${backOk}`);
  await more('Settings'); await P.page.locator('.hk-subnav__item', { hasText: 'Connections' }).click(); await P.page.locator('[data-hk-inbox-options]').waitFor(); await P.page.waitForTimeout(600);
  ok('16 390: Settings > Connections with Inbox options, no sideways page scroll', await noScroll());
  ok('No page errors (390)', !P.errors.length, JSON.stringify(P.errors.slice(0, 3)));
  await P.ctx.close();
  const fails = Object.entries(results.screens).filter(([, s]) => s.textHard || s.hardControlFails);
  ok(`contrast on ${Object.keys(results.screens).length} screens: 0 text failures (disabled text exempt), 0 must-fix control boundaries`, Object.keys(results.screens).length === 3 && !fails.length, JSON.stringify(fails.map(([k, s]) => [k, s.textHard, s.hard])));
  const syncAttempts = blocked.filter(b => /\/sync\b/.test(b));
  ok(`real-call guard: 0 requests to Anthropic / Apollo / Google hosts; ${fulfilled.length} inbox GETs answered from the fixture (0 Gmail); ${blocked.length} non-GET requests aborted (${syncAttempts.length} page-load sync attempts)`, !realCalls.length && fulfilled.length >= 2, blocked.slice(0, 5).join(', '));
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
  fs.writeFileSync(path.join(OUT, 'hkos-inbox-v1-stage2.json'), JSON.stringify({ ...results, blocked, realCalls, fulfilled, restored }, null, 2));
  console.log(`\n${pass}/${results.checks.length} checks passed${results.errors.length ? ` · ${results.errors.length} errors` : ''} · Claude 0 · Apollo 0 · Gmail 0`);
  for (const e of results.errors) console.log('ERROR:', e.split('\n').slice(0, 3).join(' | '));
  console.log(`restored: ${line}`);
  process.exit(restored ? 0 : 1);
}
