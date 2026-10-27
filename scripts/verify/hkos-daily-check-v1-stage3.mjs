// hkos-daily-check-v1 Stage 3 live check - READ-ONLY. localhost against the build, as Jack (ownerSession: magic-link
// session, no email sent; sign-in rows KEPT by rule, last_seen_at restored) on the REAL HumanKind workspace, through the
// real wiring (spawned server.js, cookie -> hkGate -> hkRoute). Screens: Today at 1440 and 390, Settings > Digest at
// 1440. Every non-GET to /api, /proxy and Supabase REST is ABORTED (the shell's page-load jobs call included, so no run
// row, no draft, no sync); every outside host except Supabase + Google Fonts is blocked (an Anthropic / Apollo / Gmail
// host fails the run). One request goes through the real wiring (GET jobs/today) and is compared to the in-process call.
// restored = every hk_* count for HumanKind + HomeLover counts identical before / after; a count() error THROWS. Shell
// text is checked for "@" on every screen. Runtime ~1-2 min, hard cap 240 s. 0 Claude, 0 Apollo, 0 Gmail, 0 writes.
// Shots + report: .screenshots/hkos-daily-check-v1/. Run npm run build first.
// Usage: node scripts/verify/hkos-daily-check-v1-stage3.mjs
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
const OUT = path.join(ROOT, '.screenshots', 'hkos-daily-check-v1');
const PORT = 3992, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const HK = '981b790c-a3b0-4265-b32e-1f701d5731ff';
const HK_TABLES = ['hk_brands', 'hk_contacts', 'hk_touches', 'hk_replies', 'hk_sponsor_periods', 'hk_settings', 'hk_events', 'hk_duplicate_decisions', 'hk_import_runs', 'hk_ignored_senders', 'hk_member_prefs', 'hk_sync_runs', 'hk_gmail_sync_state', 'hk_job_runs', 'business_members'];
const HL_TABLES = ['accounts', 'lists', 'projects', 'sales_goals', 'sales_opportunities', 'sales_targets', 'sales_people', 'sales_source_events', 'sales_partner_events', 'partner_contacts', 'sales_week_goals'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const { todayRoute } = await import('../../api/hk/jobsRoutes.js');
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const count = async (t, biz) => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', biz); if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message || `no count (HTTP ${r.status})`}`); return r.count; };
const snapshot = async () => { const o = { humankind: {}, homelover: {} }; for (const t of HK_TABLES) o.humankind[t] = await count(t, HK); for (const t of HL_TABLES) o.homelover[t] = await count(t, HOMELOVER); return o; };

const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }

let srv, browser, owner;
const blocked = [], realCalls = [], writes = [];
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
log('before', JSON.stringify(before.humankind), 'HomeLover accounts', before.homelover.accounts);
const MEASURE = measureScript({ scope: '[data-hk-shell]' });

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const tRes = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await todayRoute({ method: 'GET', params: { businessId: HK }, query: {}, body: {}, auth: { user: { id: owner.userId, name: 'Jack' }, isPlatformOwner: true, roles: new Map([[HK, 'owner']]) } }, tRes, { supabase: svc, slackUrl: null });
  const tReal = await realGet({ base: BASE, businessId: HK, session: owner.session, path: '/jobs/today' });
  ok(`real wiring: GET /jobs/today through the spawned server.js -> ${tReal.code}, same keys as the in-process call, digest counts ${JSON.stringify(tReal.body?.digest?.counts)}, no address`, tReal.code === 200 && tRes.code === 200 && keysOf(tReal.body) === keysOf(tRes.body) && keysOf(tReal.body.digest) === keysOf(tRes.body.digest) && !JSON.stringify(tReal.body).includes('@'), tReal.code === 200 ? '' : JSON.stringify(tReal.body).slice(0, 160));
  const counts = tReal.body?.digest?.counts || {};
  const expectedBadge = (counts.urgent || 0) + (counts.replies || 0) + (counts.drafts || 0) + (counts.no_draft || 0) + (counts.dm_ready || 0);
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
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (/anthropic\.com$|apollo\.io$|gmail\.googleapis\.com$|slack\.com$/.test(u.host) || (u.host === 'www.googleapis.com' && u.pathname.startsWith('/gmail'))) realCalls.push(`${req.method()} ${u.host}${u.pathname}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      if (isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname)) writes.push(`${req.method()} ${u.pathname}`);
      const deny = (isLocal && (BLOCK.test(u.pathname) || (req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname))))
        || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/'))
        || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.host}${u.pathname}`); return route.abort(); }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 140)));
    await page.goto(`${BASE}/`);
    if (viewport.width < 900) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 20000 });
    await page.getByLabel('Workspace').selectOption({ label: 'HumanKind' });
    await page.locator('[data-hk-shell] [data-hk-avatar]').waitFor({ timeout: 20000 }); await page.waitForTimeout(500);
    return { ctx, page, errors };
  }
  const SHELL_CHROME = /hk-nav__item|aria-label="Your account"|hk-pill|hk-search\b|ui-seg__btn|ui-tab\b|hk-link|hk-table__name|ui-btn--tertiary|hk-menu__item|hk-subnav__item|hk-new\b|hk-tab\b/;
  const measure = async (page, key) => {
    const m = await page.evaluate(MEASURE); if (m.error) { results.errors.push(`${key}: ${m.error}`); return null; }
    const s = summarize(m);
    const hard = m.controls.filter(c => c.ratio < 3 && !c.textOnly && !SHELL_CHROME.test(c.sel || ''));
    results.screens[key] = { ...s, hardControlFails: hard.length, hard: hard.slice(0, 6).map(c => `${c.ratio} ${c.sel} "${String(c.text || '').slice(0, 30)}"`), scrollW: m.scrollW, vw: m.vw };
    log(key, `text ${s.textFails}/${s.texts}`, `controls ${s.controlFails}/${s.controls} (text-only or shell chrome ${s.controlFails - hard.length}, must-fix ${hard.length})`);
    if (s.textFails || hard.length) log(formatWorst(key, { ...s, worst: [...s.worstText, ...hard.slice(0, 6)] }));
    return s;
  };
  const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide', fullPage: true });
  const shellText = page => page.evaluate(() => document.querySelector('[data-hk-shell]').innerText);

  // ---- 1440: Today (the shell opens on it), then Settings > Digest and Follow-up timing
  const D = await open({ width: 1440, height: 900 });
  await D.page.locator('[data-hk-today]').waitFor({ timeout: 20000 });
  await D.page.locator('[data-hk-run-line]').waitFor(); await D.page.waitForTimeout(800);
  let text = await shellText(D.page);
  const sections = await D.page.locator('[data-hk-section]').evaluateAll(els => els.map(e => e.getAttribute('data-hk-section')));
  const emptyShown = (await D.page.locator('[data-hk-today] [data-hk-empty]').count()) === 1;
  ok(`1 Today renders: greeting header, run line "${(text.match(/(The daily check has not run yet\.|Daily check ran today[^\n]*|Last daily check[^\n]*)/) || [''])[0]}", sections [${sections.join(', ')}]${emptyShown ? ' (empty state)' : ''}, footer, no "@"`, /Good (morning|afternoon|evening), Jack/.test(text) && /Done yesterday: \d+ sent/.test(text) && (sections.length > 0 || emptyShown) && !text.includes('@'), text.includes('@') ? 'ADDRESS LEAKED' : '');
  ok('2 the owner-role buttons are there (Sync Gmail now, Run daily check now) and nothing says Send', (await D.page.locator('[data-hk-run-daily]').count()) === 1 && (await D.page.locator('[data-hk-sync-all]').count()) === 1 && !/\bSend\b/.test(text.replace(/Send test digest/g, '')));
  const badge = await D.page.locator('[data-hk-nav="today"] .hk-nav__badge').innerText().catch(() => '0');
  ok(`3 nav badge Today = ${badge} = urgent + replies + drafts + no draft + DM ready from jobs/today (${expectedBadge})`, Number(badge || 0) === expectedBadge);
  const strip = (await D.page.locator('[data-hk-stats-strip]').count()) === 1;
  ok(`4 stats strip ${strip ? 'shown (stats not confirmed in the last 14 days)' : 'hidden (stats fresh)'} matches jobs/today.stats_stale=${tReal.body?.stats_stale}`, strip === !!tReal.body?.stats_stale);
  await measure(D.page, 'today@1440'); await shot(D.page, 'today-1440');
  await D.page.locator('[data-hk-nav="settings"]').click(); await D.page.getByRole('button', { name: 'Digest' }).click();
  await D.page.locator('[data-hk-digest]').waitFor(); await D.page.locator('[data-hk-slack-line]').waitFor(); await D.page.waitForTimeout(500);
  text = await shellText(D.page);
  ok('5 Settings > Digest: time 07:30, weekdays, the workspace timezone, "Slack: not configured" naming HK_SLACK_WEBHOOK_URL, Send test digest present (not clicked: it is a POST)', (await D.page.locator('#hk-dg-time').inputValue()) === '07:30' && (await D.page.locator('#hk-dg-days').inputValue()) === 'weekdays' && /America\/Chicago/.test(text) && /Slack: not configured\. Set HK_SLACK_WEBHOOK_URL/.test(text) && (await D.page.locator('[data-hk-send-test]').count()) === 1);
  await measure(D.page, 'settings-digest@1440'); await shot(D.page, 'settings-digest-1440');
  await D.page.getByRole('button', { name: 'Follow-up timing' }).click(); await D.page.locator('[data-hk-followups]').waitFor(); await D.page.waitForTimeout(400);
  ok('6 Settings > Follow-up timing: bump 5 / DM 9 / final 14, the locked cap of 3, Quiet weekends on', (await D.page.locator('#hk-fu-bump_after_days').inputValue()) === '5' && (await D.page.locator('#hk-fu-dm_after_days').inputValue()) === '9' && (await D.page.locator('#hk-fu-final_after_days').inputValue()) === '14' && /At most 3 email touches/.test(await shellText(D.page)) && (await D.page.getByRole('switch').getAttribute('aria-checked')) === 'true');
  ok('No page errors (1440)', !D.errors.length, JSON.stringify(D.errors.slice(0, 3)));
  await D.ctx.close();

  // ---- 390: Today is the first phone tab
  const P = await open({ width: 390, height: 844 });
  await P.page.locator('[data-hk-today]').waitFor({ timeout: 20000 }); await P.page.locator('[data-hk-run-line]').waitFor(); await P.page.waitForTimeout(800);
  text = await shellText(P.page);
  ok('7 390: Today renders as stacked cards without sideways scroll, Today tab current, no "@"', (await P.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)) && (await P.page.locator('[data-hk-tab="today"]').getAttribute('aria-current')) === 'page' && !text.includes('@'));
  await measure(P.page, 'today@390'); await shot(P.page, 'today-390');
  ok('No page errors (390)', !P.errors.length, JSON.stringify(P.errors.slice(0, 3)));
  await P.ctx.close();

  const fails = Object.entries(results.screens).filter(([, s]) => s.textFails || s.hardControlFails);
  ok(`contrast on ${Object.keys(results.screens).length} screens: 0 text failures, 0 must-fix control boundaries`, Object.keys(results.screens).length === 3 && !fails.length, JSON.stringify(fails.map(([k, s]) => [k, s.textFails, s.hard])));
  ok(`read-only guard: 0 requests to Anthropic / Apollo / Gmail / Slack hosts; every non-GET aborted (${writes.length} attempted: ${[...new Set(writes)].join(', ') || 'none'}); ${blocked.length} requests blocked in all`, !realCalls.length && writes.every(w => blocked.some(b => b.endsWith(w.split(' ')[1]))));
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    const after = await snapshot();
    restored = JSON.stringify(before) === JSON.stringify(after);
    line = restored ? 'yes (read-only run: HumanKind hk_* + HomeLover counts identical; nothing created; Jack sign-in rows kept by rule)' : `NO - before ${JSON.stringify(before)} after ${JSON.stringify(after)}`;
  } catch (e) { line = `NO (check failed: ${e.message})`; }
  const pass = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'hkos-daily-check-v1-stage3.json'), JSON.stringify({ ...results, restored }, null, 2));
  console.log(`\n${pass}/${results.checks.length} checks passed${results.errors.length ? ` · ${results.errors.length} errors` : ''} · Claude 0 · Apollo 0 · Gmail 0`);
  for (const e of results.errors) console.log('ERROR:', e.split('\n').slice(0, 3).join(' | '));
  console.log(`restored: ${line}`);
  process.exit(restored && pass === results.checks.length ? 0 : 1);
}
