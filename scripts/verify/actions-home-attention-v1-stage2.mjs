// actions-home-attention-v1 Stage 2 (D2-D5) - the Needs attention button + drawer on Actions, live in a temp workspace:
// the button's count, each source's state in words (Apollo stale - last sync a week ago; Outlook not connected; Tidy
// Failed "on page load" because the guard aborts the page-load Tidy), the counts and their links (overdue to-dos ->
// Tasks drawer, campaign sends -> Pipeline > Campaigns), Quick add -> the Tasks drawer's call-notes panel, one drawer at
// a time, Esc, a Viewer pass, contrast (ui-clarity measure) on the open drawer at 1440 + 390, N2 on the frame row.
// SCOPE (declared): TEMP data only - 1 goals_sales workspace (added to SALES_ANALYTICS_BUSINESS_IDS for the local server
// only), 2 temp users (owner, viewer), seed rows: 1 Apollo run, 1 visitor pull, 1 Tidy run (yesterday), 2 to-dos,
// 1 waiting-on, 1 campaign with 1 track, 1 step, 2 contacts (.example addresses). No Microsoft grant is created.
// HomeLover never written (counts compared). 0 Claude / 0 Apollo / 0 Graph: Sync now and the other manual controls
// are NOT clicked; sync, apollo, visit pull, tidy, research, anthropic and /api/microsoft routes are aborted in the
// browser (listed) and run tables counted. Runtime ~1.5 min, hard cap 200 s (tempGuard). Shots + report:
// .screenshots/actions-home-attention-v1/. Run npm run build first.
// Usage: node scripts/verify/actions-home-attention-v1-stage2.mjs [outdir]
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
const OUT = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(ROOT, '.screenshots', 'actions-home-attention-v1');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3977;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const NAME = 'ZZ Attention Stage2';
const HL = ['sales_sync_runs', 'visit_pull_runs', 'sales_tidy_runs', 'research_runs', 'sales_week_goals', 'sales_outreach_contacts', 'sales_outreach_events'];
const RUNS = ['research_runs', 'visit_pull_runs', 'sales_sync_runs', 'sales_tidy_runs'];
const TEMP_TABLES = ['sales_outreach_events', 'sales_outreach_contacts', 'sales_outreach_campaigns', 'sales_week_goal_steps', 'sales_week_goals', 'sales_suggestions', 'sales_signals', ...RUNS, 'auth_events', 'business_members'];
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
    for (const t of TEMP_TABLES) { const r = await svc.from(t).delete().eq('business_id', B); if (r.error) console.log(`cleanup ${t}: ${r.error.message}`); }
    await svc.from('businesses').delete().eq('id', B);
  }
  for (const u of users) { await svc.from('auth_events').delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('actor_id', u.id); await svc.from('microsoft_sync_runs').delete().eq('user_id', u.id); await svc.auth.admin.deleteUser(u.id); }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 200000 });
const laToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const monday = d => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));
fs.mkdirSync(OUT, { recursive: true });
const hlBefore = await hlCounts();
log('HomeLover before', JSON.stringify(hlBefore));
const results = { screens: {}, checks: [], errors: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${detail}` : ''); };
const DRAWER = measureScript({ scope: 'aside[data-attention-drawer]' });
const BOXES = `(() => Object.fromEntries(['data-workspace-header', 'data-sales-tabrow', 'data-sales-subviews', 'data-sales-frame'].map(a => {
  const el = document.querySelector('[' + a + ']'); if (!el) return [a, null];
  const r = el.getBoundingClientRect(); return [a, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }];
})))()`;
const maxMove = (a, b, keys) => Math.max(...keys.map(k => (a[k] && b[k] ? Math.max(Math.abs(a[k].x - b[k].x), Math.abs(a[k].y - b[k].y), Math.abs(a[k].h - b[k].h)) : 0)));

try {
  const tag = 'ahome2-' + Date.now();
  B = ins(await svc.from('businesses').insert({ name: NAME, website_url: 'https://ahome2.example.com', color: '#6F8CF0', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
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
  const today = laToday(), week = monday(today), ago = h => new Date(Date.now() - h * 3600e3).toISOString();
  ins(await svc.from('sales_sync_runs').insert({ business_id: B, trigger: 'manual', status: 'success', started_at: ago(170), finished_at: ago(169.9) }).select('id'));
  ins(await svc.from('visit_pull_runs').insert({ business_id: B, la_date: today, status: 'ok', calls: 0, credits: 0, updated_at: ago(1) }).select('id'));
  ins(await svc.from('sales_tidy_runs').insert({ business_id: B, started_at: ago(26), finished_at: ago(26), status: 'ok', trigger: 'manual', counts: {} }).select('id'));
  ins(await svc.from('sales_week_goals').insert([
    { business_id: B, week_start: week, kind: 'todo', status: 'open', text: 'ZZ Send the deck', owner_user_id: owner.id, due_date: addDays(today, -2), created_by: owner.id, contacts: [], sort_order: 0 },
    { business_id: B, week_start: week, kind: 'todo', status: 'open', text: 'ZZ Later thing', owner_user_id: owner.id, due_date: addDays(today, 3), created_by: owner.id, contacts: [], sort_order: 0 },
    { business_id: B, week_start: addDays(week, -7), kind: 'waiting', status: 'open', text: 'the signed MSA', waiting_on: 'Pat', due_date: addDays(today, -4), created_by: owner.id, contacts: [], sort_order: 0 },
  ]).select('id'));
  const camp = ins(await svc.from('sales_outreach_campaigns').insert({ business_id: B, name: 'ZZ Fall campaign', sender_user_id: owner.id, owner_user_ids: [owner.id], status: 'active', created_by: owner.id }).select('id').single());
  const track = ins(await svc.from('sales_outreach_tracks').insert({ campaign_id: camp.id, name: 'Consultants / brokers · knows Jack', segment: 'consultant_broker', warmth: 'warm', sort: 0 }).select('id').single());
  ins(await svc.from('sales_outreach_steps').insert({ track_id: track.id, step_no: 1, day_offset: 0, subject: 'Hi {first_name}', body: 'Hello', created_by: owner.id }).select('id'));
  ins(await svc.from('sales_outreach_contacts').insert([
    { campaign_id: camp.id, business_id: B, name: 'Ana Alder', company: 'ZZ Alder', email: 'ana@alder.example', segment: 'consultant_broker', warmth: 'warm', track_id: track.id, owner_user_id: owner.id, status: 'active', current_step: 1, next_due_date: addDays(today, -1) },
    { campaign_id: camp.id, business_id: B, name: 'Ben Birch', company: 'ZZ Birch', email: 'ben@birch.example', segment: 'consultant_broker', warmth: 'warm', track_id: track.id, owner_user_id: owner.id, status: 'replied', current_step: 1, replied_at: ago(3) },
  ]).select('id'));
  const runsBefore = {}; for (const t of RUNS) runsBefore[t] = await count(t, 'business_id', B);
  log('fixture in');

  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  const blocked = [];
  async function newPage(u, { width = 1440, height = 900 } = {}) {
    const errs = [];
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', e => errs.push(`PAGE ${u.name}@${width}: ${e.message.slice(0, 160)}`));
    page.on('requestfailed', r => { if (!blocked.includes(r.url())) results.errors.push(`request failed ${u.name}@${width}: ${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')} ${r.failure()?.errorText}`); });
    // The visitor pull is marked done for today; the page-load Tidy is left to run so the guard's abort shows as a page-load failure.
    await page.addInitScript(([k, v, b, dd]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      localStorage.setItem(`prospector_visits_ran_${b}`, dd);
    }, [`sb-${REF}-auth-token`, JSON.stringify(u.session), B, today]);
    // Real-call guard: anything that could spend Claude, Apollo or Graph never leaves the browser.
    await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)|\/goals\/visits\/pull|\/goals\/tidy\/run|\/research\/run|\/research$|\/proxy\/anthropic|\/api\/microsoft\//, route => { blocked.push(route.request().url()); route.abort(); });
    await page.goto(`http://localhost:${PORT}/`);
    await page.locator('#main-content').getByText(NAME).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').selectOption({ label: NAME }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(3000);
    return { page, errs };
  }
  const tab = async (page, label) => { await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: new RegExp(`^${label}`) }).first().dispatchEvent('click'); await page.waitForTimeout(1200); };
  const sub = async (page, label) => { await page.locator('[data-sales-subviews]').getByRole('tab', { name: label, exact: true }).dispatchEvent('click'); await page.waitForTimeout(1200); };
  const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide' });
  const measure = async (page, key) => {
    const m = await page.evaluate(DRAWER);
    if (m.error) { results.errors.push(`${key}: ${m.error}`); return null; }
    const s = summarize(m); results.screens[key] = { ...s, scrollW: m.scrollW, vw: m.vw };
    log(key, `text ${s.textFails}/${s.texts}`, `controls ${s.controlFails}/${s.controls}`, `scroll ${m.scrollW}/${m.vw}`);
    if (s.textFails || s.controlFails) log(formatWorst(key, s));
    return s;
  };
  const drawer = page => page.locator('aside[data-attention-drawer]');
  const srcText = async (page, id) => (await drawer(page).locator(`[data-source="${id}"]`).textContent()).replace(/\s+/g, ' ');

  // ---- Owner 1440.
  const J = await newPage(owner);
  await J.page.locator('[data-attention-button] button').filter({ hasText: /Needs attention|All clear/ }).waitFor({ timeout: 20000 });
  await J.page.waitForTimeout(1500);
  const label = (await J.page.locator('[data-attention-button] button').textContent()).trim();
  ok('Actions frame row: "Needs attention (6)" - Apollo stale + Tidy failed on page load + 4 counts (Outlook not connected is not counted)', label === 'Needs attention (6)', label);
  const boxActions = await J.page.evaluate(BOXES);
  const fit = await J.page.evaluate(() => { const b = document.querySelector('[data-attention-button]').getBoundingClientRect(), f = document.querySelector('[data-sales-frame]').getBoundingClientRect(); return { b: Math.round(b.right), f: Math.round(f.right), w: Math.round(b.width) }; });
  ok('1440: the button sits inside the frame row without scrolling it', fit.b <= fit.f + 1, JSON.stringify(fit));
  await shot(J.page, 'ahome2-actions-1440');
  await J.page.locator('[data-attention-button] button').click(); await drawer(J.page).waitFor();
  await J.page.waitForTimeout(1500);
  const lines = Object.fromEntries(await Promise.all(['apollo', 'outlook', 'visitors', 'tidy', 'research'].map(async id => [id, await srcText(J.page, id)])));
  ok('Apollo: Stale, last sync a week ago, Sync now beside it', /Stale/.test(lines.apollo) && /last /.test(lines.apollo) && /Sync now/.test(lines.apollo), lines.apollo);
  ok('Outlook: Not connected - Connections link, no Sync Outlook', /Not connected/.test(lines.outlook) && /Connections/.test(lines.outlook) && !/Sync Outlook/.test(lines.outlook), lines.outlook);
  ok('Website visitors: OK (today\'s pull), Pull now beside it', /OK/.test(lines.visitors) && /Pull now/.test(lines.visitors), lines.visitors);
  ok('Tidy: Failed "on page load" (the guard aborted the page-load run)', /Failed/.test(lines.tidy) && /on page load/.test(lines.tidy), lines.tidy);
  ok('Research: OK, no manual control', /OK/.test(lines.research) && !(await drawer(J.page).locator('[data-source="research"] button').count()), lines.research);
  const counts = Object.fromEntries(await Promise.all(['overdue_todos', 'overdue_waiting', 'campaign_sends', 'campaign_replies', 'held_apollo', 'held_outlook'].map(async k => [k, (await drawer(J.page).locator(`[data-count="${k}"]`).textContent()).replace(/\s+/g, ' ')])));
  ok('Needs you: 1 overdue to-do, 1 waiting-on, 1 campaign send, 1 reply, 0 held moves', /1 →/.test(counts.overdue_todos) && /1 →/.test(counts.overdue_waiting) && /1 →/.test(counts.campaign_sends) && /1 →/.test(counts.campaign_replies) && /0$/.test(counts.held_apollo.trim()) && /0$/.test(counts.held_outlook.trim()), JSON.stringify(counts));
  ok('No address anywhere in the drawer', !(await drawer(J.page).textContent()).includes('@'));
  await measure(J.page, 'drawer@1440'); await shot(J.page, 'ahome2-drawer-1440');
  const boxOpen = await J.page.evaluate(BOXES);
  const mvA = maxMove(boxActions, boxOpen, ['data-workspace-header', 'data-sales-tabrow', 'data-sales-subviews', 'data-sales-frame']);
  await J.page.keyboard.press('Escape'); await J.page.waitForTimeout(400);
  ok('Esc closes the drawer', !(await drawer(J.page).count()));
  await tab(J.page, 'Pipeline'); await sub(J.page, 'Companies'); await J.page.waitForTimeout(1000);
  const boxCompanies = await J.page.evaluate(BOXES);
  const mv = maxMove(boxCompanies, boxActions, ['data-workspace-header', 'data-sales-tabrow', 'data-sales-frame']);
  ok(`N2 1440: header, tab row and frame row sit where they do on Companies (max ${mv} px); opening the drawer moves nothing (max ${mvA} px)`, mv <= 1 && mvA <= 1, JSON.stringify({ companies: boxCompanies['data-sales-frame'], actions: boxActions['data-sales-frame'] }));
  await tab(J.page, 'Actions'); await J.page.waitForTimeout(1500);

  // Links: overdue to-dos -> the Tasks drawer (and this one closes); campaign sends -> Pipeline > Campaigns; Quick add -> call notes.
  await J.page.locator('[data-attention-button] button').click(); await drawer(J.page).waitFor();
  await drawer(J.page).getByRole('button', { name: /Your overdue to-dos: 1/ }).click(); await J.page.waitForTimeout(1200);
  ok('Overdue to-dos -> the Tasks drawer opens, this one closes', await J.page.locator('aside[aria-labelledby="task-drawer-title"]').isVisible() && !(await drawer(J.page).count()));
  // With the Tasks drawer open its panel sits over the frame row's right end (the button is under it at 1440); the
  // other direction of one-at-a-time is the open event itself.
  await J.page.evaluate(() => window.dispatchEvent(new Event('prospector:open-attention'))); await J.page.waitForTimeout(600);
  ok('One at a time: Needs attention opening closes the Tasks drawer', !(await J.page.locator('aside[aria-labelledby="task-drawer-title"]').count()));
  await J.page.locator('[data-attention-button] button').click(); await drawer(J.page).waitFor(); await J.page.waitForTimeout(600);
  await drawer(J.page).getByRole('button', { name: '📝 Paste call notes' }).click(); await J.page.waitForTimeout(1200);
  const tasksDrawer = J.page.locator('aside[aria-labelledby="task-drawer-title"]');
  ok('Quick add -> the Tasks drawer opens on its call-notes panel', await tasksDrawer.isVisible() && (await tasksDrawer.locator('textarea').count()) > 0, (await tasksDrawer.textContent()).slice(0, 80));
  await tasksDrawer.getByRole('button', { name: 'Close tasks' }).click().catch(() => {}); await J.page.waitForTimeout(400);
  await J.page.locator('[data-attention-button] button').click(); await drawer(J.page).waitFor();
  await drawer(J.page).getByRole('button', { name: /Your campaign sends due: 1/ }).click(); await J.page.waitForTimeout(1500);
  ok('Campaign sends -> Pipeline > Campaigns', await J.page.locator('[data-campaigns], [data-campaign]').first().isVisible());

  // ---- 390.
  const P = await newPage(owner, { width: 390, height: 844 });
  await P.page.locator('[data-attention-button] button').filter({ hasText: /Needs attention|All clear/ }).waitFor({ timeout: 20000 });
  await P.page.locator('[data-attention-button] button').click(); await drawer(P.page).waitFor(); await P.page.waitForTimeout(1500);
  await measure(P.page, 'drawer@390'); await shot(P.page, 'ahome2-drawer-390');
  ok('390: the drawer is the full width, no sideways scroll', (await drawer(P.page).boundingBox()).width >= 389 && results.screens['drawer@390'].scrollW <= 391);

  // ---- Viewer.
  const V = await newPage(viewer);
  await V.page.locator('[data-attention-button] button').filter({ hasText: /Needs attention|All clear/ }).waitFor({ timeout: 20000 });
  await V.page.locator('[data-attention-button] button').click(); await drawer(V.page).waitFor(); await V.page.waitForTimeout(1500);
  const vButtons = await drawer(V.page).getByRole('button').allTextContents();
  ok('Viewer: statuses + counts, read-only - no Sync now / Pull now / Tidy now / Paste call notes', /read-only/.test(await drawer(V.page).textContent()) && !vButtons.some(t => /Sync now|Sync Outlook|Pull now|Tidy now|Paste call notes/.test(t)), JSON.stringify(vButtons));
  await measure(V.page, 'drawer-viewer@1440'); await shot(V.page, 'ahome2-drawer-viewer-1440');

  const fails = Object.entries(results.screens).filter(([, s]) => s.textFails || s.controlFails);
  ok(`ui-clarity measure on the open drawer: 0 failures (${Object.keys(results.screens).join(', ')})`, !fails.length, JSON.stringify(fails.map(([k, s]) => [k, s.textFails, s.controlFails])));
  const errs = [...J.errs, ...P.errs, ...V.errs];
  ok('No page errors', !errs.length, JSON.stringify(errs.slice(0, 5)));
  const runsAfter = {}; for (const t of RUNS) runsAfter[t] = await count(t, 'business_id', B);
  const graphRuns = (await Promise.all(users.map(u => count('microsoft_sync_runs', 'user_id', u.id)))).reduce((a, b) => a + b, 0);
  const blockedPaths = [...new Set(blocked.map(x => x.replace(/^https?:\/\/[^/]+/, '').replace(/[0-9a-f-]{36}/g, ':id')))];
  ok('Real-call guard: no run rows written, 0 Graph runs; only the page-load Tidy was stopped in the browser', JSON.stringify(runsBefore) === JSON.stringify(runsAfter) && graphRuns === 0 && blockedPaths.every(p => /tidy\/run/.test(p)), `blocked ${JSON.stringify(blockedPaths)} · ${JSON.stringify(runsAfter)}`);
  results.calls = { claude: 0, apollo: 0, graph: graphRuns, blocked: blockedPaths };
} catch (e) {
  results.errors.push(e.stack || e.message);
  log('ERROR', e.message);
} finally {
  await cleanup();
  const hlAfter = await hlCounts();
  const restored = JSON.stringify(hlBefore) === JSON.stringify(hlAfter) && !(await count('businesses', 'id', B));
  results.restored = restored;
  const pass = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'actions-home-attention-v1-stage2.json'), JSON.stringify(results, null, 2));
  console.log(`\n${pass}/${results.checks.length} checks passed${results.errors.length ? ` · ${results.errors.length} errors` : ''}`);
  for (const e of results.errors) console.log('ERROR:', e.split('\n').slice(0, 3).join(' | '));
  console.log(`restored: ${restored ? 'yes' : `NO - HomeLover ${JSON.stringify(hlBefore)} -> ${JSON.stringify(hlAfter)}`}`);
  process.exit(0);
}
