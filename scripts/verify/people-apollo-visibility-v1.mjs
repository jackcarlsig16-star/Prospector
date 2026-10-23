// FIX people-apollo-visibility-v1 (F1, F2, F3a + F3c, F4) live check in a temp workspace:
// F1 a fast Gmail open shows as a real open in People (a fast Chrome open stays hidden as a bot);
// F2 People search by last name / company finds the "First L." row, full name for Members only;
// F3a Sync now (Needs attention) catches up in batches inside the activity budget; F3c the drawer then shows
// "n messages left — Sync again"; F4 the Apollo / Outlook labels in the drawer and on Dashboard > Analytics;
// F3b the daily first-load sync (trigger 'pageload': runs once, skipped on the next load, never from a Viewer).
// SCOPE (declared): TEMP data only - 1 goals_sales workspace (added to SALES_ANALYTICS_BUSINESS_IDS for the local
// server only), 2 temp users (owner, viewer); seeds 2 prospects + 2 messages + 2 open events. One Sync now writes
// <= 100 fixture messages / events / prospects ("ZZ Person n", no addresses) into the temp workspace + its run row.
// 0 real Apollo: the server runs with api/sales/testing/apolloFixture.mjs (fetch to api.apollo.io answered in
// process; the fixture logs every call it answered - reported). 0 Claude / 0 Graph: anthropic, research, visit
// pull, tidy and /api/microsoft are aborted in the browser. HomeLover never written (counts compared).
// Runtime ~2 min, hard cap 300 s (tempGuard). Shots + report: .screenshots/people-apollo-visibility-v1/.
// Run npm run build first. Usage: node scripts/verify/people-apollo-visibility-v1.mjs [outdir]
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const { measureScript, summarize, formatWorst } = require(ROOT + '/scripts/verify/lib/contrastMeasure.cjs');
const OUT = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(ROOT, '.screenshots', 'people-apollo-visibility-v1');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3983;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const NAME = 'ZZ People Apollo Fix';
const HL = ['sales_sync_runs', 'sales_email_messages', 'sales_email_activity', 'sales_prospect_state', 'sales_raw_snapshots'];
const RUNS = ['research_runs', 'visit_pull_runs', 'sales_tidy_runs'];
const TEMP_TABLES = ['sales_email_activity', 'sales_email_messages', 'sales_prospect_events', 'sales_prospect_state', 'sales_raw_snapshots', 'sales_metrics_daily', 'sales_email_daily_counts', 'sales_email_backfill_weeks', 'sales_sequence_tags', 'partner_contacts', 'sales_partner_events', 'sales_sync_runs', ...RUNS, 'sales_week_goals', 'sales_suggestions', 'auth_events', 'business_members'];
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const count = async (t, col, v) => (await svc.from(t).select('*', { count: 'exact', head: true }).eq(col, v)).count;
const hlCounts = async () => { const o = {}; for (const t of HL) o[t] = await count(t, 'business_id', HOMELOVER); return o; };
let srv, browser, B, users = [];
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  if (B) {
    for (const t of TEMP_TABLES) { const r = await svc.from(t).delete().eq('business_id', B); if (r.error && !/does not exist|column/.test(r.error.message)) console.log(`cleanup ${t}: ${r.error.message}`); }
    await svc.from('businesses').delete().eq('id', B);
  }
  for (const u of users) {
    await svc.from('auth_events').delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('actor_id', u.id);
    await svc.from('microsoft_sync_runs').delete().eq('user_id', u.id);
    await svc.auth.admin.deleteUser(u.id);
  }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 300000 });
const laToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
fs.mkdirSync(OUT, { recursive: true });
const hlBefore = await hlCounts();
log('HomeLover before', JSON.stringify(hlBefore));
const results = { screens: {}, checks: [], errors: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${detail}` : ''); };
const SCREEN = measureScript({ scope: '#sales-analytics-root' });
const DRAWER = measureScript({ scope: 'aside[data-attention-drawer]' });

// Fixture Apollo: 100 opened messages waiting for their activities (24-hex ids), each one Gmail open.
const NOWMS = Date.now();
const hex = (p, i) => (p + i.toString(16)).padStart(24, '0');
const FIX_MSGS = Array.from({ length: 100 }, (_, i) => ({ id: hex('a', i), contact_id: hex('c', i), completed_at: new Date(NOWMS - (i + 2) * 3600e3).toISOString(), emailer_campaign_id: hex('5', 1), campaign_position: 1, from_email: null, stats: ['opened'] }));
const FIX_ACTS = Object.fromEntries(FIX_MSGS.map((m, i) => [m.id, { num_opens: 1, emailer_message_events: [{ type: 'open', created_at: new Date(Date.parse(m.completed_at) + 600e3).toISOString(), readable_user_agent: 'Gmail' }], contact: { id: m.contact_id, name: `ZZ Person ${i}`, organization_name: 'ZZ Fixture Co' } }]));

try {
  const tag = 'pav-' + Date.now();
  B = ins(await svc.from('businesses').insert({ name: NAME, website_url: 'https://pav.example.com', color: '#6F8CF0', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
  const mk = async (name, role) => {
    const email = `${tag}-${name.toLowerCase().replace(/\s+/g, '-')}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
    const { data: u, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(error.message);
    await svc.from('profiles').update({ display_name: name, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
    ins(await svc.from('business_members').insert({ business_id: B, email, name, user_id: u.user.id, role }).select());
    const anon = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data: s, error: sErr } = await anon.auth.signInWithPassword({ email, password });
    if (sErr) throw new Error(sErr.message);
    const u2 = { id: u.user.id, session: s.session, name }; users.push(u2); return u2;
  };
  const owner = await mk('Jack Test', 'owner'), viewer = await mk('Vic Viewer', 'viewer');
  const today = laToday();
  // F1 seed: two people, each opened 29 s after delivery - one through Gmail (a person), one Chrome (scanner timing).
  const delivered = new Date(NOWMS - 5 * 3600e3).toISOString(), at29 = new Date(Date.parse(delivered) + 29e3).toISOString();
  ins(await svc.from('sales_prospect_state').insert([
    { business_id: B, contact_id: 'zzgmail0000000000000001', name: 'Avery Quillfeather', title: 'Benefits Lead', company: "ZZ Daisy's Gym", owner: 'jack', status: 'new' },
    { business_id: B, contact_id: 'zzchrome000000000000001', name: 'Robin Thistlewood', title: 'HR Director', company: 'ZZ Pebble Foods', owner: 'jack', status: 'new' },
  ]).select('contact_id'));
  ins(await svc.from('sales_email_messages').insert([
    { business_id: B, apollo_message_id: 'zzmsg0000000000000000001', contact_id: 'zzgmail0000000000000001', step: 1, delivered_at: delivered, num_opens: 1, replied: false, activities_fetched_at: delivered },
    { business_id: B, apollo_message_id: 'zzmsg0000000000000000002', contact_id: 'zzchrome000000000000001', step: 1, delivered_at: delivered, num_opens: 1, replied: false, activities_fetched_at: delivered },
  ]).select('apollo_message_id'));
  ins(await svc.from('sales_email_activity').insert([
    { business_id: B, apollo_message_id: 'zzmsg0000000000000000001', contact_id: 'zzgmail0000000000000001', step: 1, event: 'open', occurred_at: at29, user_agent: 'Gmail' },
    { business_id: B, apollo_message_id: 'zzmsg0000000000000000002', contact_id: 'zzchrome000000000000001', step: 1, event: 'open', occurred_at: at29, user_agent: 'Chrome, Windows' },
  ]).select('id'));
  const runsBefore = {}; for (const t of RUNS) runsBefore[t] = await count(t, 'business_id', B);
  log('fixture in');

  let fixtureCalls = 0, realApolloHint = 0;
  srv = spawn('node', ['--import', './api/sales/testing/apolloFixture.mjs', 'server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}`, APOLLO_FIXTURE: '{}', APOLLO_FIXTURE_EMAIL: JSON.stringify({ empty: true, messages: FIX_MSGS, activities: FIX_ACTS }) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stdout.on('data', d => { const t = String(d); fixtureCalls += (t.match(/\[apollo fixture\] answered/g) || []).length; });
  srv.stderr.on('data', d => { if (/api\.apollo\.io/.test(String(d)) && !/fixture/.test(String(d))) realApolloHint++; });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  const blocked = [];
  const pageloadPosts = [];
  // apollo: false = leave the page-load Apollo sync on (F3b); every other page skips it like the visitor pull / Tidy.
  async function newPage(u, { width = 1440, height = 900, apollo = true } = {}) {
    const errs = [];
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', e => errs.push(`PAGE ${u.name}@${width}: ${e.message.slice(0, 160)}`));
    page.on('requestfailed', r => { if (!blocked.includes(r.url())) results.errors.push(`request failed ${u.name}@${width}: ${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')} ${r.failure()?.errorText}`); });
    await page.addInitScript(([k, v, b, dd, skipApollo]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      localStorage.setItem(`prospector_visits_ran_${b}`, dd); localStorage.setItem(`prospector_tidy_ran_${b}`, dd);
      if (skipApollo) localStorage.setItem(`prospector_apollo_sync_ran_${b}`, dd);
    }, [`sb-${REF}-auth-token`, JSON.stringify(u.session), B, today, apollo]);
    page.on('request', r => { if (/\/sync\/pageload$/.test(r.url())) pageloadPosts.push(u.name); });
    // Real-call guard (Claude / Graph / research / pulls); Sync now goes to the server, whose Apollo is the fixture.
    await page.route(/\/goals\/visits\/pull|\/goals\/tidy\/run|\/research\/run|\/research$|\/proxy\/anthropic|\/api\/microsoft\/|\/goals\/call-notes\/extract/, route => { blocked.push(route.request().url()); route.abort(); });
    await page.goto(`http://localhost:${PORT}/`);
    await page.locator('#main-content').getByText(NAME).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').selectOption({ label: NAME }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    return { page, errs };
  }
  const tab = async (page, label) => { await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: new RegExp(`^${label}`) }).first().dispatchEvent('click'); await page.waitForTimeout(1200); };
  const sub = async (page, label) => { await page.locator('[data-sales-subviews]').getByRole('button', { name: label, exact: true }).dispatchEvent('click'); await page.waitForTimeout(1500); };
  const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide', fullPage: true });
  const measure = async (page, key, scope = SCREEN) => {
    const m = await page.evaluate(scope);
    if (m.error) { results.errors.push(`${key}: ${m.error}`); return null; }
    const s = summarize(m); results.screens[key] = { ...s, scrollW: m.scrollW, vw: m.vw };
    log(key, `text ${s.textFails}/${s.texts}`, `controls ${s.controlFails}/${s.controls}`, `scroll ${m.scrollW}/${m.vw}`);
    if (s.textFails || s.controlFails) log(formatWorst(key, s));
    return s;
  };
  const openDrawer = async page => { await page.getByRole('button', { name: /^(Needs attention|All clear)/ }).first().click(); const d = page.locator('aside[data-attention-drawer]'); await d.waitFor(); await page.waitForTimeout(1200); return d; };

  // ---- Owner, 1440: People (F1 + F2).
  const J = await newPage(owner);
  await tab(J.page, 'Pipeline'); await sub(J.page, 'People');
  await J.page.getByLabel('Search people').fill('quillfeather'); await J.page.waitForTimeout(800);
  const avery = J.page.getByText('Avery Q.', { exact: true }).first();
  ok('F2: search "quillfeather" finds the "Avery Q." row; Members get the full name as its tooltip', await avery.isVisible() && (await avery.getAttribute('title')) === 'Avery Quillfeather');
  const averyRow = J.page.locator('[data-row]').filter({ hasText: 'Avery Q.' }).first();
  ok('F1: her 29-s Gmail open counts - Signal "Open ×1"', /Open ×1/.test(await averyRow.innerText()), (await averyRow.innerText()).replace(/\s+/g, ' ').slice(0, 120));
  await J.page.getByLabel('Search people').fill("daisy's"); await J.page.waitForTimeout(600);
  ok('F2: search by company finds her too', await J.page.getByText('Avery Q.', { exact: true }).first().isVisible());
  await J.page.getByLabel('Search people').fill('thistlewood'); await J.page.waitForTimeout(600);
  const robin = J.page.locator('[data-row]').filter({ hasText: 'Robin T.' });
  ok('F1: the 29-s Chrome open is still a bot - Robin shows no real-open signal', !(await robin.count()) || !/Open ×/.test(await robin.first().innerText()), (await robin.count()) ? (await robin.first().innerText()).replace(/\s+/g, ' ').slice(0, 100) : 'hidden (bot-only)');
  await J.page.getByLabel('Search people').fill('quillfeather'); await J.page.waitForTimeout(600);
  await measure(J.page, 'people@1440'); await shot(J.page, 'pav-people-1440');

  // ---- F4 + F3a/F3c: Needs attention -> Sync now against the fixture -> catch-up -> backlog line.
  await tab(J.page, 'Actions');
  let drawer = await openDrawer(J.page);
  const apolloLine = drawer.locator('li[data-source="apollo"]');
  ok('F4: drawer says "Apollo (sequences, opens, replies)" and "Outlook (mail + calendar)"', /Apollo \(sequences, opens, replies\)/.test(await apolloLine.innerText()) && /Outlook \(mail \+ calendar\)/.test(await drawer.locator('li[data-source="outlook"]').innerText()));
  await apolloLine.getByRole('button', { name: 'Sync now' }).click();
  await drawer.getByRole('status').filter({ hasText: /done|failed|error|cooldown/i }).waitFor({ timeout: 120000 });
  const run = ins(await svc.from('sales_sync_runs').select('trigger, status, counts').eq('business_id', B).order('started_at', { ascending: false }).limit(1).single());
  const a = run.counts.activity || {};
  ok('F3a: one Sync now caught up in batches inside the budget (68 of 100 in 3 batches, 32 left, 72 activity-step calls)', run.trigger === 'manual' && a.activities_fetched === 68 && a.activity_batches === 3 && a.backlog_after_run === 32 && (run.counts.per_endpoint['/emailer_messages/:id/activities'] || 0) === 68, JSON.stringify({ status: run.status, a, per: run.counts.per_endpoint }));
  ok('F3a: the 68 messages + their Gmail opens + prospects landed in the temp workspace', (await count('sales_email_activity', 'business_id', B)) === 2 + 68 && (await count('sales_prospect_state', 'business_id', B)) === 2 + 68);
  await J.page.getByRole('button', { name: 'Close needs attention' }).click(); await J.page.waitForTimeout(400);
  drawer = await openDrawer(J.page);
  const line2 = await drawer.locator('li[data-source="apollo"]').innerText();
  ok('F3c: the Apollo line reads "32 messages left — Sync again"', /32 messages left/.test(line2) && (await drawer.locator('li[data-source="apollo"]').getByRole('button', { name: 'Sync again' }).count()) === 1, line2.replace(/\s+/g, ' '));
  await measure(J.page, 'drawer@1440', DRAWER); await shot(J.page, 'pav-drawer-1440');
  await J.page.getByRole('button', { name: 'Close needs attention' }).click(); await J.page.waitForTimeout(400);

  // ---- F4 on Dashboard > Analytics.
  await tab(J.page, 'Dashboard'); await sub(J.page, 'Analytics'); await J.page.waitForTimeout(1500);
  ok('F4: Analytics status reads "Apollo (sequences, opens, replies) · synced …"', /Apollo \(sequences, opens, replies\) · synced/.test(await J.page.locator('#sales-analytics-root').innerText()));
  await measure(J.page, 'analytics@1440'); await shot(J.page, 'pav-analytics-1440');

  // ---- 390.
  const P = await newPage(owner, { width: 390, height: 844 });
  await tab(P.page, 'Pipeline'); await sub(P.page, 'People');
  await P.page.getByRole('button', { name: /^Filters/ }).first().click(); await P.page.waitForTimeout(500);
  await P.page.getByLabel('Search people').fill('quillfeather'); await P.page.waitForTimeout(500);
  await P.page.keyboard.press('Escape'); await P.page.waitForTimeout(500);
  ok('390: the phone list finds "Avery Q." by last name', await P.page.getByText('Avery Q.', { exact: true }).first().isVisible());
  await measure(P.page, 'people@390'); await shot(P.page, 'pav-people-390');
  await tab(P.page, 'Actions');
  await openDrawer(P.page);
  await measure(P.page, 'drawer@390', DRAWER); await shot(P.page, 'pav-drawer-390');
  ok('390: no sideways page scroll', Object.entries(results.screens).filter(([k]) => k.endsWith('@390')).every(([, s]) => s.scrollW <= s.vw + 1));

  // ---- Viewer: "First L." everywhere, backlog count without the button.
  const V = await newPage(viewer);
  await tab(V.page, 'Pipeline'); await sub(V.page, 'People');
  await V.page.getByLabel('Search people').fill('quillfeather'); await V.page.waitForTimeout(800);
  const vAvery = V.page.getByText('Avery Q.', { exact: true }).first();
  ok('Viewer: last-name search still finds "Avery Q."; no full-name tooltip, not in the page', await vAvery.isVisible() && !(await vAvery.getAttribute('title')) && !(await V.page.locator('#sales-analytics-root').innerHTML()).includes('Quillfeather'));
  await tab(V.page, 'Actions');
  const vd = await openDrawer(V.page);
  ok('Viewer drawer: "32 messages left", no Sync again / Sync now', /32 messages left/.test(await vd.locator('li[data-source="apollo"]').innerText()) && !(await vd.getByRole('button', { name: /Sync again|Sync now/ }).count()));

  // ---- F3b: the daily first-load sync. Back-date the temp runs past 20 h, then a Member's first load starts one.
  ins(await svc.from('sales_sync_runs').update({ started_at: new Date(NOWMS - 30 * 3600e3).toISOString(), finished_at: new Date(NOWMS - 30 * 3600e3 + 60e3).toISOString() }).eq('business_id', B).select('id'));
  const runsOf = async () => ins(await svc.from('sales_sync_runs').select('trigger, status, counts, started_at').eq('business_id', B).order('started_at', { ascending: false }));
  const before = (await runsOf()).length;
  const L1 = await newPage(owner, { apollo: false });
  let pl = null;
  for (let i = 0; i < 60 && !pl; i++) { pl = (await runsOf()).find(r => r.trigger === 'pageload' && r.status !== 'running'); if (!pl) await L1.page.waitForTimeout(1000); }
  ok('F3b: a Member\'s first load (last sync 30 h old) starts one pageload sync; it catches up the 32 left (0 left)', pl?.status === 'success' && pl.counts.activity.activities_fetched === 32 && pl.counts.activity.backlog_after_run === 0 && (await runsOf()).length === before + 1, JSON.stringify(pl && { status: pl.status, a: pl.counts.activity }));
  ok('F3b: it marks this browser (prospector_apollo_sync_ran_<id> = today)', (await L1.page.evaluate(b => localStorage.getItem(`prospector_apollo_sync_ran_${b}`), B)) === today);
  await tab(L1.page, 'Actions');
  const pld = await openDrawer(L1.page);
  ok('F3b: Needs attention shows Apollo OK, no backlog left', /\bOK\b/.test(await pld.locator('li[data-source="apollo"]').innerText()) && !/messages left/.test(await pld.locator('li[data-source="apollo"]').innerText()), (await pld.locator('li[data-source="apollo"]').innerText()).replace(/\s+/g, ' '));
  const L2 = await newPage(owner, { apollo: false });
  await L2.page.waitForTimeout(4000);
  ok('F3b: a second fresh browser asks again but the server skips it (no new run)', pageloadPosts.filter(n => n === owner.name).length === 2 && (await runsOf()).length === before + 1, JSON.stringify(pageloadPosts));
  const V2 = await newPage(viewer, { apollo: false });
  await V2.page.waitForTimeout(3000);
  ok('F3b: a Viewer\'s load never asks', !pageloadPosts.includes(viewer.name));
  const manual = (await runsOf()).filter(r => r.trigger === 'manual').length;
  ok('F3b: the pageload run is not a manual one (manual count unchanged at 1)', manual === 1);

  const fails = Object.entries(results.screens).filter(([, s]) => s.textFails || s.controlFails);
  ok(`ui-clarity measure: 0 failures on ${Object.keys(results.screens).length} screens`, !fails.length, JSON.stringify(fails.map(([k, s]) => [k, s.textFails, s.controlFails])));
  const errs = [...J.errs, ...P.errs, ...V.errs, ...L1.errs, ...L2.errs, ...V2.errs];
  ok('No page errors', !errs.length, JSON.stringify(errs.slice(0, 5)));
  const runsAfter = {}; for (const t of RUNS) runsAfter[t] = await count(t, 'business_id', B);
  const graphRuns = (await Promise.all(users.map(u => count('microsoft_sync_runs', 'user_id', u.id)))).reduce((x, y) => x + y, 0);
  ok('Real-call guard: every Apollo call answered by the fixture; 0 research / pull / tidy runs; 0 Graph runs', fixtureCalls > 0 && realApolloHint === 0 && JSON.stringify(runsBefore) === JSON.stringify(runsAfter) && graphRuns === 0, `fixture answered ${fixtureCalls} · blocked ${blocked.length} browser calls`);
  results.calls = { claude: 0, apollo_real: 0, apollo_fixture: fixtureCalls, graph: graphRuns, blocked: blocked.length };
} catch (e) {
  results.errors.push(e.stack || e.message);
  log('ERROR', e.message);
} finally {
  await cleanup();
  const hlAfter = await hlCounts();
  const restored = JSON.stringify(hlBefore) === JSON.stringify(hlAfter) && !(await count('businesses', 'id', B)) && !(await count('sales_email_activity', 'business_id', B));
  results.restored = restored;
  const pass = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'people-apollo-visibility-v1.json'), JSON.stringify(results, null, 2));
  console.log(`\n${pass}/${results.checks.length} checks passed${results.errors.length ? ` · ${results.errors.length} errors` : ''}`);
  for (const e of results.errors) console.log('ERROR:', e.split('\n').slice(0, 3).join(' | '));
  console.log(`restored: ${restored ? 'yes' : `NO - HomeLover ${JSON.stringify(hlBefore)} -> ${JSON.stringify(hlAfter)}`}`);
  process.exit(0);
}
