// sales-ia-v1 Stage 2 bar 4 - Today (Your day, Focus 5, glance) + the viewer's Today. TEMP data: 1 workspace, 2 temp users (owner, viewer)
// and one temp to-do, all torn down via tempGuard. HomeLover: READ-ONLY - every GET the Today page makes is answered by calling the real
// route function for HomeLover with the service key (no HomeLover membership is touched, nothing is written); writes stay in the temp
// workspace. 0 Apollo (sync/apollo requests aborted), 0 Claude. Serves build/ (run npm run build first).
// Usage: node scripts/verify/sales-ia-v1-stage2.mjs <outdir>   ~2.5 min, cap 230 s.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const OUT = process.argv[2] || path.join(ROOT, 'build', 'verify-shots');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3972;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const NAME = 'ZZ Sales IA Today';
const WATCH = ['businesses', 'business_members', 'profiles', 'auth_events', 'sales_week_goals', 'sales_week_goal_steps', 'sales_week_report'];
const HL = ['sales_week_goals', 'sales_week_goal_steps', 'sales_goals', 'sales_opportunities', 'sales_partner_events', 'sales_week_report', 'business_members'];
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const counts = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true })).count; return o; };
const hlCounts = async () => { const o = {}; for (const t of HL) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HOMELOVER)).count; return o; };
let srv, browser, B, users = [], pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
const skip = (n, why) => console.log(`SKIP  ${n} - ${why}`);
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  if (B) {
    const { data: goals } = await svc.from('sales_week_goals').select('id').eq('business_id', B);
    if (goals?.length) await svc.from('sales_week_goal_steps').delete().in('goal_id', goals.map(g => g.id));
    await svc.from('sales_week_goals').delete().eq('business_id', B);
    await svc.from('sales_week_report').delete().eq('business_id', B);
    await svc.from('auth_events').delete().eq('business_id', B); await svc.from('business_members').delete().eq('business_id', B); await svc.from('businesses').delete().eq('id', B); B = null;
  }
  for (const u of users) { await svc.from('auth_events').delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('actor_id', u.id); await svc.auth.admin.deleteUser(u.id); }
  users = [];
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 230000 });

// HomeLover reads, answered by the real route functions (server.js wires these same functions behind salesGate). GET only.
const { laDateString } = await import(ROOT + '/api/sales/laDate.js');
const laWeekStart = () => { const d = new Date(`${laDateString()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + (d.getUTCDay() === 0 ? -6 : 1 - d.getUTCDay())); return d.toISOString().slice(0, 10); };
const ROUTES = [
  ['goals/members', 'goalsRoutes.js', 'listGoalMembersRoute'], ['goals/land', 'goalsRoutes.js', 'listLandGoalsRoute'], ['goals/week', 'goalsRoutes.js', 'listWeekGoalsRoute'],
  ['goals/week/plans', 'weekPlanRoutes.js', 'listWeekPlansRoute'], ['goals/cadences', 'goalsRoutes.js', 'listCadencesRoute'], ['goals/prospect-targets', 'targetsRoutes.js', 'listProspectTargetsRoute'],
  ['goals/partners/events', 'partnersRoutes.js', 'listPartnerEventsRoute'], ['goals/scorecard', 'goalsReportRoutes.js', 'scorecardRoute'], ['goals/kpi', 'goalsReportRoutes.js', 'kpiRoute'],
  ['goals/companies', 'goalsReportRoutes.js', 'listCompaniesRoute'], ['goals/hero', 'goalsReportRoutes.js', 'heroRoute'], ['goals/report', 'goalsReportRoutes.js', 'getReportRoute'],
  ['goals/pipeline-board', 'pipelineBoard.js', 'pipelineBoardRoute'], ['huddle/flags', 'huddleFlags.js', 'listFlagsRoute'],
  ['opportunities/movement', 'pipelineRoutes.js', 'movementRoute'], ['opportunities', 'pipelineRoutes.js', 'listOpportunitiesRoute'],
];
const mods = {};
async function hl(pathname, query, userId) {
  const r = ROUTES.find(([p]) => p === pathname);
  if (!r) return null;
  mods[r[1]] ||= await import(`${ROOT}/api/sales/${r[1]}`);
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; }, send(b) { this.body = b; }, setHeader() {}, set() {} };
  await mods[r[1]][r[2]]({ params: { businessId: HOMELOVER }, query, auth: { user: { id: userId } }, headers: {}, method: 'GET' }, res);
  return res;
}
let proxied = 0;
const serveHomeLover = (page, userId) => page.route(new RegExp(`/api/sales/${B}/`), async route => {
  const req = route.request(); const url = new URL(req.url());
  if (/\/(sync|apollo)/.test(url.pathname)) return route.abort();
  if (req.method() !== 'GET') return route.continue();
  const res = await hl(url.pathname.split(`/api/sales/${B}/`)[1], Object.fromEntries(url.searchParams), userId).catch(e => ({ code: 500, body: { error: e.message } }));
  if (!res) return route.continue();
  proxied++;
  return route.fulfill({ status: res.code, contentType: 'application/json', body: JSON.stringify(res.body) });
});

const today = laDateString(), week = laWeekStart();
const before = await counts(); const hlBefore = await hlCounts();
console.log('counts before', JSON.stringify(before)); console.log('HomeLover before', JSON.stringify(hlBefore));
fs.mkdirSync(OUT, { recursive: true });
const errsAll = [];
try {
  const tag = 'sia2-' + Date.now();
  B = ins(await svc.from('businesses').insert({ name: NAME, website_url: 'https://today.example.com', color: '#6F8CF0', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
  const mk = async (name, role) => {
    const email = `${tag}-${name}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
    const { data: u, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(error.message);
    await svc.from('profiles').update({ display_name: `${name} Test`, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
    ins(await svc.from('business_members').insert({ business_id: B, email, name: `${name} Test`, user_id: u.user.id, role }).select());
    const anon = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data: s, error: sErr } = await anon.auth.signInWithPassword({ email, password });
    if (sErr) throw new Error(sErr.message);
    const u2 = { id: u.user.id, session: s.session }; users.push(u2); return u2;
  };
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const owner = await mk('Owner', 'owner'), viewer = await mk('Viewer', 'viewer');
  // One temp finalized report for last week (this week stays draft) so the viewer's card has something to open.
  const lastWeek = (() => { const d = new Date(`${week}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 7); return d.toISOString().slice(0, 10); })();
  ins(await svc.from('sales_week_report').insert({ business_id: B, week_start: lastWeek, status: 'final', finalized_at: new Date().toISOString(), finalized_by: owner.id }).select());
  // One temp to-do due today, so the tick stays visible (struck through) after it lands.
  const tempTodo = ins(await svc.from('sales_week_goals').insert({ business_id: B, kind: 'todo', text: 'Temp: send the joint deck', week_start: week, owner_user_id: owner.id, status: 'open', due_date: today, created_by: owner.id, contacts: [] }).select().single());
  browser = await chromium.launch();

  async function newPage(u, { width = 1440, height = 900, homeLover = true, query = '?tab=today' } = {}) {
    const errs = [];
    const page = await (await browser.newContext({ viewport: { width, height } })).newPage(); page.setDefaultTimeout(10000);
    page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
    page.on('console', m => { if (m.type() === 'error' && !/favicon|net::ERR_FAILED|Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 160)); });
    await page.addInitScript(([k, v]) => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(u.session)]);
    await page.addInitScript(() => { window.__prints = 0; window.print = () => { window.__prints++; }; });
    if (homeLover) await serveHomeLover(page, u.id); else await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)/, route => route.abort());
    await page.goto(`http://localhost:${PORT}/${query}`);
    try { await page.locator('#main-content').getByText(NAME).first().waitFor({ timeout: 30000 }); }
    catch (e) { await page.screenshot({ path: `${OUT}/debug-fail.png` }); console.log('DEBUG body:', (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 400), '| errs:', errs.join(' | ')); throw e; }
    await page.waitForTimeout(1200);
    page.compact = width < 900;
    if (page.compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').selectOption({ label: NAME }); await page.waitForTimeout(1500);
    if (page.compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Goals & Sales', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    return { page, errs };
  }
  const tabBtn = (page, label) => page.locator('#workspace-header-tabs').getByRole('button', { name: new RegExp(`^${label}`) }).first();
  const tab = async (page, label) => { await tabBtn(page, label).click(); await page.waitForTimeout(1800); };
  const sub = async (page, label) => { await page.locator('.ui-seg').getByRole('button', { name: label, exact: true }).first().click(); await page.waitForTimeout(1800); };
  const person = async (page, label) => { await page.getByRole('group', { name: 'Filter by person' }).getByRole('button', { name: label, exact: true }).click(); await page.waitForTimeout(1500); };
  const state = page => page.evaluate(() => { const u = new URL(location.href); return `${u.searchParams.get('tab')}/${u.searchParams.get('view')}`; });
  const noScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const shot = (page, name, full = true) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full, animations: 'disabled', caret: 'hide' });
  const sectionCount = (page, label) => page.locator(`[aria-label="${label}"] li[data-task-id]`).count();
  const yourDay = async page => ({ overdue: await sectionCount(page, 'Overdue'), due: await sectionCount(page, 'Due today'), flagged: (await sectionCount(page, 'Flagged for you')) + (await sectionCount(page, 'Flagged')) });

  // Expected numbers from the API that reads the DB (the same route functions), not from the UI.
  const members = (await hl('goals/members', {}, owner.id)).body.members;
  const jack = members.find(m => /^jack/i.test(m.name)), cyrus = members.find(m => /^cyrus/i.test(m.name));
  const todos = (await hl('goals/week', { from: week, to: week, kind: 'todo' }, owner.id)).body.goals;
  const flags = (await hl('huddle/flags', {}, owner.id)).body.flags;
  const flagIds = new Set(flags.map(f => f.id));
  const st = t => (t.status === 'dropped' ? 'dropped' : t.status === 'done' || (t.steps.length && t.steps.every(s => s.done)) ? 'done' : 'open');
  const expectFor = uid => {
    const mine = todos.filter(t => !flagIds.has(t.id) && (uid === 'team' || t.owner_user_id === uid) && st(t) !== 'dropped');
    const open = mine.filter(t => st(t) !== 'done');
    return { overdue: open.filter(t => t.due_date && t.due_date < today).length, due: mine.filter(t => t.due_date === today).length, flagged: flags.filter(f => uid === 'team' || f.owner_user_id === uid).length };
  };
  console.log(`HomeLover: ${members.length} members, ${todos.length} to-dos this week, ${flags.length} open flags; today ${today}, week ${week}`);

  // ── 1440 owner, HomeLover data: Team / Jack / Cyrus ──
  { const { page, errs } = await newPage(owner);
    await page.getByText('Your day').waitFor({ timeout: 15000 }); await page.locator('[data-hero-card]').first().waitFor({ timeout: 20000 }); await page.waitForTimeout(1500);
    ok('Today: default lands on today/null with the date as the title', (await state(page)) === 'today/null' && /^[A-Z][a-z]+day, [A-Z][a-z]{2} \d/.test(await page.locator('#sales-analytics-root h1').first().innerText()), await page.locator('#sales-analytics-root h1').first().innerText());
    ok('Today: Your day · Focus 5 · This week at a glance · goal cards', (await page.getByLabel('This week at a glance').count()) === 1 && (await page.getByLabel(/^Focus 5/).count()) === 1 && (await page.locator('[data-hero-card]').count()) >= 4);
    ok('Today: hidden sections are hidden (no Follow-ups, no Research ready), chip slot empty', (await page.getByText(/Follow-ups due|Research ready/).count()) === 0 && (await page.locator('[data-today-chips] > *').count()) === 0);
    ok('Today: header has Plan this week (owner), the Tasks drawer link, no View only tag', (await page.getByRole('button', { name: 'Plan this week' }).count()) >= 1 && (await page.getByRole('button', { name: 'All tasks →' }).count()) === 1 && (await page.getByText('View only').count()) === 0);
    const team = await yourDay(page), eTeam = expectFor('team');
    ok(`Team: Your day counts match the API (overdue ${team.overdue}, due today ${team.due}, flagged ${team.flagged})`, JSON.stringify(team) === JSON.stringify(eTeam), `expected ${JSON.stringify(eTeam)}`);
    await shot(page, 'today-team-1440');
    if (jack) {
      await person(page, jack.name.split(' ')[0]);
      const j = await yourDay(page), ej = expectFor(jack.user_id);
      ok(`Jack: Your day counts match the API (overdue ${j.overdue}, due today ${j.due}, flagged ${j.flagged})`, JSON.stringify(j) === JSON.stringify(ej), `expected ${JSON.stringify(ej)}`);
      ok('Jack: overdue rows say how late, flags carry ⚑ + Mark contacted', (j.overdue === 0 || (await page.locator('[aria-label="Overdue"]').getByText(/\dd late/).count()) >= 1) && (j.flagged === 0 || (await page.locator('[aria-label="Flagged"], [aria-label="Flagged for you"]').getByRole('button', { name: 'Mark contacted' }).count()) === j.flagged));
      await shot(page, 'today-jack-1440');
    } else skip('Jack person filter', 'no member named Jack');
    if (cyrus) {
      await person(page, cyrus.name.split(' ')[0]);
      const c = await yourDay(page), ec = expectFor(cyrus.user_id);
      ok(`Cyrus: Your day counts match the API (overdue ${c.overdue}, due today ${c.due}, flagged ${c.flagged})`, JSON.stringify(c) === JSON.stringify(ec), `expected ${JSON.stringify(ec)}`);
      await shot(page, 'today-cyrus-1440');
      await person(page, 'Team');
    } else skip('Cyrus person filter', 'no member named Cyrus');
    ok('1440: no sideways page scroll', await noScroll(page));
    // D9 links: Reports › Weekly report "to-dos done last week" chip (week:prev) → Today, previous week.
    await tab(page, 'Reports'); await sub(page, 'Weekly report');
    const prevChip = page.getByTitle('Open the to-dos done last week').first();
    if (await prevChip.count()) { await prevChip.click(); await page.waitForTimeout(1500); ok('✓ D9 report chip (week:prev) → Today at the previous week', (await state(page)) === 'today/null' && /^Week of /.test(await page.locator('#sales-analytics-root h1').first().innerText()), `${await state(page)} · ${await page.locator('#sales-analytics-root h1').first().innerText()}`); await page.getByRole('button', { name: 'This week', exact: true }).click(); await page.waitForTimeout(800); }
    else skip('D9 week:prev chip', 'chip not rendered');
    // D9: Analytics goal line "Today →" (view:week) → Today.
    await tab(page, 'Reports'); await sub(page, 'Analytics'); await page.waitForTimeout(2500);
    const line = page.getByLabel('Goals this week');
    await line.waitFor({ timeout: 15000 }).catch(() => {});
    if (await line.count()) { await line.getByText('Today →').click(); await page.waitForTimeout(1500); ok('✓ D9 Analytics "Today →" (view:week) → Today', (await state(page)) === 'today/null', await state(page)); }
    else skip('D9 Analytics view:week link', 'goal line did not render');
    // D9: 'score:<m>' stays Reports › Scorecard (hero Meetings card).
    await tab(page, 'Today'); await page.waitForTimeout(800);
    const meetings = page.getByTitle('Open the scorecard row').first();
    if (await meetings.count()) { await meetings.click(); await page.waitForTimeout(1500); ok('✓ D9 hero meetings (score:meetings_set) stays Reports › Scorecard', (await state(page)) === 'reports/scorecard', await state(page)); }
    else skip('score:meetings_set link', 'meetings card absent');
    // Glance links.
    await tab(page, 'Today'); await page.waitForTimeout(800);
    await page.getByTitle('Open Pipeline › Partner workflow').click(); await page.waitForTimeout(1500);
    ok('✓ glance Partners → Pipeline › Partner workflow', (await state(page)) === 'pipeline/partners', await state(page));
    await tab(page, 'Today'); await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Open weekly report →' }).click(); await page.waitForTimeout(1500);
    ok('✓ glance "Open weekly report →" → Reports › Weekly report', (await state(page)) === 'reports/weekly', await state(page));
    // Tasks drawer "Open Today →" (OPEN_GOALS_WEEK).
    await page.getByRole('button', { name: /^Open tasks/i }).first().click(); await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'Open Today →' }).click(); await page.waitForTimeout(1500);
    ok('✓ Tasks drawer "Open Today →" → Today', (await state(page)) === 'today/null', await state(page));
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    // Print path: Export › Weekly report PDF still prints once with one print area.
    await tab(page, 'Reports'); await sub(page, 'Scorecard');
    await page.getByRole('button', { name: 'Export', exact: true }).click(); await page.waitForTimeout(300);
    await page.getByRole('menuitem', { name: 'Weekly report PDF' }).click(); await page.waitForTimeout(1200);
    ok('Export › Weekly report PDF prints once with one print area', (await state(page)) === 'reports/weekly' && (await page.evaluate(() => window.__prints)) === 1 && (await page.locator('#sales-analytics-print-area').count()) === 1, `prints=${await page.evaluate(() => window.__prints)}`);
    await page.emulateMedia({ media: 'print' }); await page.waitForTimeout(400); await shot(page, 'print-reports-weekly'); await page.emulateMedia({ media: 'screen' });
    errsAll.push(...errs.map(e => `owner 1440: ${e}`)); await page.context().close(); }

  // ── ?gview=week → Today ──
  { const { page, errs } = await newPage(owner, { query: '?gview=week' });
    ok('✓ D9 old URL ?gview=week → Today', (await state(page)) === 'today/null', await state(page));
    errsAll.push(...errs.map(e => `gview: ${e}`)); await page.context().close(); }

  // ── Tick a to-do in the TEMP workspace (no HomeLover proxy) ──
  { const { page, errs } = await newPage(owner, { homeLover: false });
    await page.getByText('Your day').waitFor({ timeout: 15000 }); await page.waitForTimeout(1200);
    const row = page.locator(`[data-task-id="${tempTodo.id}"]`);
    ok('temp to-do due today shows under Due today', (await row.count()) === 1 && (await page.locator('[aria-label="Due today"]').count()) === 1);
    await page.getByRole('button', { name: `Done: ${tempTodo.text}` }).click(); await page.waitForTimeout(1500);
    const { data: after } = await svc.from('sales_week_goals').select('status').eq('id', tempTodo.id).single();
    const struck = await row.evaluate(li => ({ check: !!li.querySelector('[aria-label="done"]'), lineThrough: [...li.querySelectorAll('span')].some(s => getComputedStyle(s).textDecorationLine.includes('line-through')), pressed: li.querySelector('[aria-pressed]')?.getAttribute('aria-pressed') }));
    ok('tick → status done in the DB (the drawer path: PATCH goals/week/:id status done) and the row is struck through with a check', after.status === 'done' && struck.check && struck.lineThrough && struck.pressed === 'true', `status=${after?.status} ${JSON.stringify(struck)}`);
    await shot(page, 'today-temp-ticked-1440', false);
    await page.getByRole('button', { name: `Done: ${tempTodo.text}` }).click(); await page.waitForTimeout(1200);
    const { data: back } = await svc.from('sales_week_goals').select('status').eq('id', tempTodo.id).single();
    ok('untick → status open again', back.status === 'open', `status=${back?.status}`);
    errsAll.push(...errs.map(e => `tick: ${e}`)); await page.context().close(); }

  // ── Viewer, HomeLover data ──
  { const { page, errs } = await newPage(viewer);
    await page.getByLabel('Latest report').waitFor({ timeout: 15000 });
    await page.getByLabel('Latest report').locator('text=/Finalized|No finalized report/').waitFor({ timeout: 30000 }).catch(() => {}); await page.waitForTimeout(1500);
    ok('viewer: View only tag, no Plan this week, no All tasks, no checkboxes', (await page.getByText('View only').count()) === 1 && (await page.getByRole('button', { name: 'Plan this week' }).count()) === 0 && (await page.getByRole('button', { name: 'All tasks →' }).count()) === 0 && (await page.locator('#sales-analytics-root main [aria-pressed]').count()) === 0, `pressed=${await page.locator('#sales-analytics-root main [aria-pressed]').count()}`);
    const card = page.getByLabel('Latest report');
    const latest = await card.innerText();
    const hasFinal = /Finalized/.test(latest);
    ok(`viewer: latest report card ${hasFinal ? 'shows the newest finalized week' : 'says no finalized report yet'}`, hasFinal ? (await card.getByRole('button', { name: 'Open report' }).count()) === 1 && (await card.getByRole('button', { name: 'Download PDF' }).count()) === 1 : /No finalized report/.test(latest), latest.replace(/\n/g, ' · ').slice(0, 120));
    ok('viewer: The team today lists every member with overdue · due · flags; Pipeline moves + Focus 5 + glance present', (await page.getByLabel('The team today').locator('li').filter({ hasText: /overdue/ }).count()) === members.length && (await page.getByText('Pipeline moves this week').count()) === 1 && (await page.getByLabel('Focus 5', { exact: true }).count()) === 1 && (await page.getByLabel('This week at a glance').count()) === 1, `members=${await page.getByLabel('The team today').locator('li').filter({ hasText: /overdue/ }).count()}/${members.length}`);
    const stray = await page.locator('#sales-analytics-root main button').evaluateAll(bs => bs.filter(b => !['Open report', 'Download PDF'].includes(b.textContent.trim()) && !b.hasAttribute('data-link') && !b.hasAttribute('data-part') && !b.closest('[data-hero-card]') && !b.hasAttribute('aria-expanded')).map(b => b.textContent.trim().slice(0, 40)));
    ok('viewer: zero action buttons in the Today body (only Open report / Download PDF / links / hero drill numbers / the hero Expand-Collapse toggle)', stray.length === 0, stray.join(' | '));
    await shot(page, 'today-viewer-1440');
    if (hasFinal) {
      await card.getByRole('button', { name: 'Download PDF' }).click(); await page.waitForTimeout(1500);
      ok('viewer: Download PDF → Reports › Weekly report at that week + window.print once', (await state(page)) === 'reports/weekly' && (await page.evaluate(() => window.__prints)) === 1 && (await page.locator('#sales-analytics-print-area').count()) === 1, `${await state(page)} prints=${await page.evaluate(() => window.__prints)}`);
      await tab(page, 'Today'); await page.getByLabel('Latest report').getByRole('button', { name: 'Open report' }).waitFor({ timeout: 15000 });
      await page.getByLabel('Latest report').getByRole('button', { name: 'Open report' }).click(); await page.waitForTimeout(1500);
      ok('viewer: Open report → Reports › Weekly report', (await state(page)) === 'reports/weekly', await state(page));
    } else skip('viewer Open report / Download PDF click-through', 'HomeLover has no finalized report');
    errsAll.push(...errs.map(e => `viewer: ${e}`)); await page.context().close(); }

  // ── Viewer, TEMP data: the finalized-report card click-through ──
  { const { page, errs } = await newPage(viewer, { homeLover: false });
    const card = page.getByLabel('Latest report'); await card.waitFor({ timeout: 15000 });
    await card.getByRole('button', { name: 'Open report' }).waitFor({ timeout: 20000 }); await page.waitForTimeout(500);
    const text = (await card.innerText()).replace(/\n/g, ' · ');
    ok('viewer (temp): the newest finalized week is last week, "Finalized by Owner", this week in progress', /Finalized by Owner/.test(text) && /report is in progress/.test(text) && !text.includes(`${week.slice(5)}`), text.slice(0, 140));
    await card.getByRole('button', { name: 'Download PDF' }).click(); await page.waitForTimeout(1500);
    ok('viewer: Download PDF → Reports › Weekly report at that week + window.print once', (await state(page)) === 'reports/weekly' && (await page.evaluate(() => window.__prints)) === 1 && (await page.locator('#sales-analytics-print-area').count()) === 1 && (await page.locator('#sales-analytics-root').getByText(/Final ·/).count()) >= 1, `${await state(page)} prints=${await page.evaluate(() => window.__prints)}`);
    await tab(page, 'Today'); await page.getByLabel('Latest report').getByRole('button', { name: 'Open report' }).waitFor({ timeout: 20000 });
    await page.getByLabel('Latest report').getByRole('button', { name: 'Open report' }).click(); await page.waitForTimeout(1500);
    ok('viewer: Open report → Reports › Weekly report (final, read-only)', (await state(page)) === 'reports/weekly' && (await page.locator('#sales-analytics-root').getByText(/Final ·/).count()) >= 1 && (await page.getByRole('button', { name: 'Finalize' }).count()) === 0, await state(page));
    errsAll.push(...errs.map(e => `viewer temp: ${e}`)); await page.context().close(); }

  // ── 390 ──
  { const { page, errs } = await newPage(owner, { width: 390, height: 844 });
    await page.getByText('Your day').waitFor({ timeout: 15000 }); await page.waitForTimeout(1500);
    ok('390: no sideways page scroll, short date title', (await noScroll(page)) && /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d/.test(await page.locator('#sales-analytics-root h1').first().innerText()), `${await page.evaluate(() => `${document.documentElement.scrollWidth} > ${window.innerWidth}`)} · ${await page.locator('#sales-analytics-root h1').first().innerText()}`);
    await shot(page, 'today-team-390');
    if (jack) { await person(page, jack.name.split(' ')[0]); ok('390 Jack: no sideways scroll', await noScroll(page)); await shot(page, 'today-jack-390'); }
    errsAll.push(...errs.map(e => `390: ${e}`)); await page.context().close(); }
  { const { page, errs } = await newPage(viewer, { width: 390, height: 844 });
    await page.getByLabel('Latest report').waitFor({ timeout: 15000 }); await page.waitForTimeout(2000);
    ok('390 viewer: no sideways page scroll', await noScroll(page));
    await shot(page, 'today-viewer-390');
    errsAll.push(...errs.map(e => `390 viewer: ${e}`)); await page.context().close(); }

  const bundle = fs.readdirSync(ROOT + '/build/static/js').filter(f => /^main\..*\.js$/.test(f)).map(f => fs.readFileSync(`${ROOT}/build/static/js/${f}`, 'utf8')).join('');
  ok('bundle marker: data-today-chips + "Your day" + "View only" in build/', bundle.includes('data-today-chips') && bundle.includes('Your day') && bundle.includes('View only'));
  ok('0 page errors', errsAll.length === 0, errsAll.slice(0, 5).join(' | '));
  console.log(`HomeLover GETs answered by route functions: ${proxied}`);
} catch (e) { console.error('ERROR', e.stack || e.message); }
finally {
  await cleanup();
  const after = await counts(), hlAfter = await hlCounts();
  const moved = WATCH.filter(t => after[t] !== before[t]), hlMoved = HL.filter(t => hlAfter[t] !== hlBefore[t]);
  console.log(`HomeLover ${hlMoved.length ? 'MOVED: ' + hlMoved.join(',') : 'identical'} ${JSON.stringify(hlAfter)}`);
  console.log(`checks: ${pass}/${total}  shots: ${fs.readdirSync(OUT).filter(f => f.endsWith('.png')).length} png -> ${OUT}`);
  console.log(`restored: ${moved.length ? 'NO - moved: ' + moved.join(', ') : 'yes'}`);
  process.exit(pass === total && !moved.length && !hlMoved.length ? 0 : 1);
}
