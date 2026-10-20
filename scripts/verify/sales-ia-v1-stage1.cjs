// sales-ia-v1 Stage 1 - Today · Pipeline · Huddle · Reports, rail removed. TEMP data only: 1 businesses row (goals_sales on), 2 temp users
// (owner + viewer), 0 accounts - all deleted by teardown. 0 Apollo calls (Sync now is never clicked). Reads hit the temp business only.
// Modes:
//   setup <state.json>            create fixtures, write ids + passwords + a fixed clock + temp-table counts
//   checks <state.json>           structure (4 tabs, sub-views, width), link click-through, old ?gview= + new ?tab= URLs, print path on
//                                 every tab (one print area at a time, window.print stubbed), viewer pass, 390 no sideways scroll
//   shots <state.json> <outdir>   every tab + sub-view at 1440 dark, the four tabs at 1440 light, every tab + sub-view at 390 dark,
//                                 print-media renders of Weekly report / Analytics / Huddle
//   teardown <state.json>         delete everything setup made, print table counts before/after
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3967;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const WATCH = ['businesses', 'business_members', 'accounts', 'profiles', 'auth_events'];
const NAME = 'ZZ Sales IA Tabs';
const [mode, a1, a2] = process.argv.slice(2);
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const counts = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true })).count; return o; };
let srv, browser, pass = 0, total = 0;
const ok = (n, c, d = "") => { total++; if (c) pass++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? ` - ${d}` : ""}`); };
const skip = (n, why) => console.log(`SKIP  ${n} - ${why}`);
require('./lib/tempGuard.cjs')(async () => { if (browser) await browser.close().catch(() => {}); if (srv) srv.kill(); }, { capMs: 230000 });

async function setup(file) {
  const before = await counts();
  const tag = 'sia1-' + Date.now();
  const B = ins(await svc.from('businesses').insert({ name: NAME, website_url: 'https://tabs.example.com', color: '#6F8CF0', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
  const users = {};
  for (const [name, role] of [['Owner', 'owner'], ['Viewer', 'viewer']]) {
    const email = `${tag}-${name.toLowerCase()}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
    const { data: u, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(error.message);
    await svc.from('profiles').update({ display_name: `${name} Test`, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
    ins(await svc.from('business_members').insert({ business_id: B, email, name: `${name} Test`, user_id: u.user.id, role }).select());
    users[name] = { id: u.user.id, email, password };
  }
  fs.writeFileSync(file, JSON.stringify({ tag, B, users, clock: Date.now(), before }, null, 2));
  console.log(`setup done: workspace ${B}, 2 users. Counts before: ${JSON.stringify(before)}`);
}

async function session(u) {
  const c = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: s, error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error(error.message);
  return s.session;
}
async function startServer(st) {
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${st.B}` }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); return; } catch { await new Promise(r => setTimeout(r, 250)); } }
  throw new Error('server did not start');
}
async function newPage(st, sess, { width = 1440, height = 900, light = false, query = '' } = {}) {
  const errs = [];
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage(); page.setDefaultTimeout(10000);
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); }); page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
  await page.clock.setFixedTime(new Date(st.clock));
  await page.addInitScript(([k, v, light]) => {
    if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
    if (light) localStorage.setItem('prospector_prefs', JSON.stringify({ displayMode: 'straight_shooter' }));
  }, [`sb-${REF}-auth-token`, JSON.stringify(sess), light]);
  await page.addInitScript(() => { window.__prints = 0; window.print = () => { window.__prints++; }; });
  await page.goto(`http://localhost:${PORT}/${query}`);
  await page.locator('#main-content').getByText(NAME).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  page.compact = width < 900;
  return { page, errs };
}
const shot = (page, out, name) => page.screenshot({ path: `${out}/${name}.png`, fullPage: true, animations: 'disabled', caret: 'hide' });
async function openSales(page) {
  if (page.compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
  await page.getByLabel('Workspace').selectOption({ label: NAME }); await page.waitForTimeout(2000);
  if (page.compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
  await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
}
const tabBtn = (page, label) => page.locator('#workspace-header-tabs, #sales-analytics-root').getByRole('button', { name: new RegExp(`^${label}`) }).first();
async function tab(page, label) { await tabBtn(page, label).click(); await page.waitForTimeout(1800); }
async function sub(page, label) { await page.locator('.ui-seg').getByRole('button', { name: label, exact: true }).first().click(); await page.waitForTimeout(1800); }
const state = page => page.evaluate(() => { const u = new URL(location.href); return `${u.searchParams.get('tab')}/${u.searchParams.get('view')}`; });
const noScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const printAreas = page => page.locator('#sales-analytics-print-area').count();
// sales-ia-v2 N1: the tabs these views moved to.
const VIEWS = [['Actions', null, 'actions/null'], ['Pipeline', 'Companies', 'pipeline/companies'], ['Pipeline', 'Partner workflow', 'pipeline/partners'], ['Dashboard', 'Sequenced', 'dashboard/sequenced'],
  ['Pipeline', 'People', 'pipeline/people'], ['Dashboard', 'Weekly report', 'dashboard/weekly'], ['Dashboard', 'Scorecard', 'dashboard/scorecard'], ['Dashboard', 'Analytics', 'dashboard/analytics']];
async function goView(page, [t, s]) { await tab(page, t); if (s) await sub(page, s); }

async function checks(file) {
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  await startServer(st);
  browser = await chromium.launch();
  const allErrs = [];
  try {
    const owner = await session(st.users.Owner);
    const { page, errs } = await newPage(st, owner);
    await openSales(page);
    const tabs = await page.locator('#workspace-header-tabs button').allInnerTexts();
    ok('4 tabs in the header row: Today · Pipeline · Huddle · Reports', tabs.map(t => t.trim()).join(' · ') === 'Today · Pipeline · Huddle · Reports', tabs.join(' | '));
    ok('default lands on Today', (await state(page)) === 'today/null', await state(page));
    ok('no right rail on Today', (await page.locator('aside[aria-label="Goals panel"]').count()) === 0);
    for (const v of VIEWS) {
      await goView(page, v);
      const s = await state(page);
      const areas = await printAreas(page);
      ok(`${v[0]}${v[1] ? ' › ' + v[1] : ''}: lands on ${v[2]}, ${areas} print area(s)`, s === v[2] && areas <= 1, `${s}, ${areas}`);
    }
    const widthOf = () => page.locator('[data-sales-tab]').evaluate(e => Math.round(e.getBoundingClientRect().width));
    await tab(page, 'Pipeline'); const wPipe = await widthOf();
    await tab(page, 'Today'); const wToday = await widthOf();
    ok('Pipeline is full width (> 1100) and Today keeps 1100', wPipe > 1100 && wToday === 1100, `${wPipe} / ${wToday}`);
    ok('Pipeline board page has no sideways scroll at 1440', await noScroll(page));
    // Link click-through (what the empty temp workspace renders).
    await tab(page, 'Reports'); await sub(page, 'Weekly report');
    await page.getByRole('button', { name: 'Open Companies →' }).first().click(); await page.waitForTimeout(1500);
    ok('✓ Weekly report "Open Companies →" (view:companies) → Pipeline › Sequenced', (await state(page)) === 'pipeline/sequenced', await state(page));
    ok('  Sequenced shows the owner ring at the top', (await page.getByLabel('Companies sequenced by owner').count()) >= 1);
    await tab(page, 'Reports'); await sub(page, 'Weekly report');
    await page.getByRole('button', { name: 'Open Pipeline & overview →' }).first().click(); await page.waitForTimeout(2500);
    ok('✓ Weekly report "Open Pipeline & overview →" (overview) → Reports › Analytics', (await state(page)) === 'reports/analytics', await state(page));
    const line = page.getByLabel("Goals this week"); await line.waitFor({ timeout: 15000 }).catch(() => {});
    if (await line.count()) {
      await line.getByText('Scorecard →').click(); await page.waitForTimeout(1500);
      ok('✓ Analytics "Scorecard →" (view:week) → Reports › Scorecard', (await state(page)) === 'reports/scorecard', await state(page));
      await tab(page, 'Reports'); await sub(page, 'Analytics'); await page.waitForTimeout(1500);
      await page.getByTitle('Open Pipeline › Partner workflow (Sent)').click(); await page.waitForTimeout(1500);
      ok('✓ Analytics first-touched ({ partners }) → Pipeline › Partner workflow', (await state(page)) === 'pipeline/partners', await state(page));
      await tab(page, 'Reports'); await sub(page, 'Analytics'); await page.waitForTimeout(1500);
      await page.getByTitle('Open the scorecard row').click(); await page.waitForTimeout(1500);
      ok('✓ Analytics meetings (score:meetings_set) → Reports › Scorecard', (await state(page)) === 'reports/scorecard', await state(page));
    } else skip('Analytics goal line links (Scorecard →, first-touched, meetings)', 'goal line did not render in the temp workspace');
    await tab(page, 'Today');
    const heroAnalytics = page.getByTitle('Open Analytics').first();
    if (await heroAnalytics.count()) { await heroAnalytics.click(); await page.waitForTimeout(1500); ok('✓ Today hero "in sequence" (overview:week_strip) → Reports › Analytics', (await state(page)) === 'reports/analytics', await state(page)); }
    else skip('Today hero in-sequence link', 'card absent');
    await tab(page, 'Today');
    const heroHuddle = page.getByTitle('Open the Huddle').first();
    if (await heroHuddle.count()) { await heroHuddle.click(); await page.waitForTimeout(1500); ok('✓ Today hero "engagement" (huddle:feed) → Huddle', (await state(page)) === 'huddle/null', await state(page)); }
    else skip('Today hero engagement (huddle:feed) link', 'card absent in the temp workspace');
    // Huddle → 'plan' → Today + the plan drawer.
    await tab(page, 'Huddle');
    const plan = page.locator('#sales-analytics-root').getByRole('button', { name: 'Plan this week' }).first();
    if (await plan.count()) { await plan.click(); await page.waitForTimeout(1500); ok('✓ Huddle "Plan this week" (plan) → Today + plan drawer', (await state(page)) === 'today/null' && (await page.getByRole('dialog').count()) >= 1, await state(page)); await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    else skip('Huddle Plan this week (plan) link', 'the nudge only shows on Tuesdays and the Focus line needs a plan');
    // Tasks drawer "Open Today →" (OPEN_GOALS_WEEK + ?tab=today).
    await tab(page, 'Reports');
    await page.getByRole('button', { name: /^(Open )?tasks/i }).first().click(); await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'Open Today →' }).click(); await page.waitForTimeout(1500);
    ok('✓ Tasks drawer "Open Today →" → Today', (await state(page)) === 'today/null', await state(page));
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    // Print path: Export → Weekly report PDF from Scorecard switches to the report and calls window.print once.
    await tab(page, 'Reports'); await sub(page, 'Scorecard');
    await page.getByRole('button', { name: 'Export', exact: true }).click(); await page.waitForTimeout(300);
    await page.getByRole('menuitem', { name: 'Weekly report PDF' }).click(); await page.waitForTimeout(1200);
    ok('Export › Weekly report PDF: switches to Weekly report and prints once', (await state(page)) === 'reports/weekly' && (await page.evaluate(() => window.__prints)) === 1 && (await printAreas(page)) === 1, `${await state(page)}, prints=${await page.evaluate(() => window.__prints)}`);
    await tab(page, 'Huddle');
    const agenda = page.getByRole('button', { name: 'Print agenda' }).first();
    if (await agenda.isEnabled()) { await agenda.click(); await page.waitForTimeout(300); ok('Huddle "Print agenda" prints (agenda print area mounted)', (await page.evaluate(() => window.__prints)) === 2 && (await printAreas(page)) === 1); }
    else skip('Huddle Print agenda', 'button disabled without huddle data');
    allErrs.push(...errs.map(e => `owner: ${e}`));
    // Old ?gview= links and the new params.
    for (const [q, want] of [['?gview=report', 'reports/weekly'], ['?gview=week', 'today/null'], ['?gview=partners', 'pipeline/partners'], ['?gview=companies', 'pipeline/sequenced'], ['?gview=pipeline', 'pipeline/board'], ['?tab=reports&view=scorecard', 'reports/scorecard'], ['?tab=pipeline&view=bogus', 'pipeline/board']]) {
      const p = await newPage(st, owner, { query: q });
      await openSales(p.page);
      ok(`URL ${q} → ${want}`, (await state(p.page)) === want, await state(p.page));
      allErrs.push(...p.errs.map(e => `${q}: ${e}`));
      await p.page.context().close();
    }
    // Stored old key maps once.
    { const p = await newPage(st, owner); await p.page.evaluate(() => { localStorage.setItem('prospector_goals_view', 'partners'); localStorage.removeItem('prospector_sales_tab'); localStorage.removeItem('prospector_sales_view'); });
      await p.page.reload(); await p.page.locator('#main-content').getByText(NAME).first().waitFor({ timeout: 20000 }); await p.page.waitForTimeout(1500); await openSales(p.page);
      ok('stored prospector_goals_view=partners → Pipeline › Partner workflow, old key dropped', (await state(p.page)) === 'pipeline/partners' && (await p.page.evaluate(() => localStorage.getItem('prospector_goals_view'))) === null, await state(p.page));
      await p.page.context().close(); }
    // Viewer pass.
    const vw = await newPage(st, await session(st.users.Viewer));
    await openSales(vw.page);
    const vtabs = await vw.page.locator('#workspace-header-tabs button').allInnerTexts();
    ok('viewer: same 4 tabs', vtabs.map(t => t.trim()).join(' · ') === 'Today · Pipeline · Huddle · Reports');
    ok('viewer: read-only note, no Plan this week', (await vw.page.getByText(/read-only for you/).count()) === 1 && (await vw.page.getByRole('button', { name: 'Plan this week' }).count()) === 0);
    await tab(vw.page, 'Pipeline');
    ok('viewer: Pipeline board has no + Add employer / Update from sheet', (await vw.page.getByRole('button', { name: '+ Add employer' }).count()) === 0 && (await vw.page.getByRole('button', { name: 'Update from sheet' }).count()) === 0);
    await tab(vw.page, 'Reports');
    ok('viewer: Reports shows the sub-views', (await vw.page.locator('.ui-seg').getByRole('button', { name: 'Scorecard', exact: true }).count()) === 1);
    allErrs.push(...vw.errs.map(e => `viewer: ${e}`));
    // 390.
    const m = await newPage(st, owner, { width: 390, height: 844 });
    await openSales(m.page);
    for (const v of VIEWS) { await goView(m.page, v); ok(`390 ${v[2]}: no sideways scroll`, await noScroll(m.page), await m.page.evaluate(() => `${document.documentElement.scrollWidth} > ${window.innerWidth}`)); }
    allErrs.push(...m.errs.map(e => `390: ${e}`));
    const bundle = fs.readdirSync(ROOT + '/build/static/js').filter(f => /^main\..*\.js$/.test(f)).map(f => fs.readFileSync(`${ROOT}/build/static/js/${f}`, 'utf8')).join('');
    ok('bundle marker: data-sales-tab + the unknown-target warning are in build/', bundle.includes('data-sales-tab') && bundle.includes('sales-ia-v1: no home for link target'));
    ok('0 console errors', allErrs.length === 0, allErrs.slice(0, 6).join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(`checks: ${pass}/${total}`);
}

async function shots(file, out) {
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.mkdirSync(out, { recursive: true });
  await startServer(st);
  browser = await chromium.launch();
  const allErrs = [];
  try {
    const owner = await session(st.users.Owner);
    { const { page, errs } = await newPage(st, owner); await openSales(page);
      for (const v of VIEWS) { await goView(page, v); await shot(page, out, `${v[2].replace('/', '-')}-1440-dark`); }
      await tab(page, 'Reports'); await sub(page, 'Weekly report'); await page.emulateMedia({ media: 'print' }); await page.waitForTimeout(400); await shot(page, out, 'print-reports-weekly');
      await page.emulateMedia({ media: 'screen' }); await sub(page, 'Analytics'); await page.waitForTimeout(1500); await page.emulateMedia({ media: 'print' }); await page.waitForTimeout(400); await shot(page, out, 'print-reports-analytics');
      await page.emulateMedia({ media: 'screen' }); await tab(page, 'Huddle'); await page.emulateMedia({ media: 'print' }); await page.waitForTimeout(400); await shot(page, out, 'print-huddle');
      await page.emulateMedia({ media: 'screen' });
      allErrs.push(...errs.map(e => `1440 dark: ${e}`)); }
    { const { page, errs } = await newPage(st, owner, { light: true }); await openSales(page);
      ok('light mode class on body', await page.evaluate(() => document.body.classList.contains('mode-straight-shooter')));
      for (const v of VIEWS.filter(x => !x[1] || x[1] === 'Board' || x[1] === 'Weekly report')) { await goView(page, v); await shot(page, out, `${v[2].replace('/', '-')}-1440-light`); }
      allErrs.push(...errs.map(e => `light: ${e}`)); }
    { const { page, errs } = await newPage(st, owner, { width: 390, height: 844 }); await openSales(page);
      for (const v of VIEWS) { await goView(page, v); await shot(page, out, `${v[2].replace('/', '-')}-390-dark`); }
      allErrs.push(...errs.map(e => `390: ${e}`)); }
    ok('0 console errors', allErrs.length === 0, allErrs.slice(0, 6).join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(`shots -> ${out}: ${fs.readdirSync(out).filter(f => f.endsWith('.png')).length} png  ${pass}/${total}`);
}

async function teardown(file) {
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  await svc.from('auth_events').delete().eq('business_id', st.B);
  for (const u of Object.values(st.users)) { await svc.from('business_members').delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('actor_id', u.id); }
  await svc.from('businesses').delete().eq('id', st.B);
  for (const u of Object.values(st.users)) await svc.auth.admin.deleteUser(u.id);
  const afterC = await counts();
  const moved = WATCH.filter(t => afterC[t] !== st.before[t]);
  console.log(`teardown: before ${JSON.stringify(st.before)}\n          after  ${JSON.stringify(afterC)}\nrestored: ${moved.length ? 'NO - moved: ' + moved.join(', ') : 'yes'}`);
}

({ setup: () => setup(a1), checks: () => checks(a1), shots: () => shots(a1, a2), teardown: () => teardown(a1) }[mode] || (() => { console.log('usage: setup|checks|shots|teardown'); }))()
  .then(() => process.exit(total && pass !== total ? 1 : 0)).catch(e => { console.error(e); if (browser) browser.close(); if (srv) srv.kill(); process.exit(1); });
