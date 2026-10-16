// shell-facelift-v1 Stage 1 - the Workspaces page, before and after. TEMP data only: 3 businesses rows (one with goals_sales + 2 partners + 2 partner events + 3 to-dos, one plain with 1 account, one empty), 2 temp users (owner + viewer on all three) - all deleted by teardown. 0 AI / 0 Apollo. HomeLover is only ever COUNTED (hl mode, read-only). ~30s per mode, cap 4 min each.
// Modes (fixtures persist between runs so before and after see the same names and data):
//   setup <state.json>            create fixtures, write ids + passwords + a fixed clock + temp-table counts
//   shoot <state.json> <outdir>   serve build/ via server.js, screenshot Workspaces: owner 1440 dark + light, 390 dark; viewer 1440 dark; 0 console errors
//   click <state.json>            every control on the page still works: cards, + New Business (open / Cancel / x), Scout (focus, palette, Escape), sidebar back; viewer sees everything
//   after <state.json>            Stage 1 structure: no territory toggles / deals in scope / stat tiles; title 34px; grid centered, <= 3 columns; live line per card; 390 one column, no sideways scroll
//   hl [out.json]                 HomeLover READ-ONLY row counts (head requests only), printed and optionally saved
//   teardown <state.json>         delete everything setup made, print table counts before/after
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3963;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const WATCH = ['businesses', 'business_members', 'accounts', 'profiles', 'auth_events', 'sales_goals', 'sales_partner_events', 'sales_week_goals', 'sales_week_goal_steps'];
const HL_TABLES = ['business_members', 'accounts', 'projects', 'sales_goals', 'sales_partner_events', 'sales_week_goals', 'sales_week_goal_steps', 'sales_email_messages', 'sales_email_activity', 'sales_prospect_state', 'partner_contacts', 'microsoft_messages', 'microsoft_events', 'microsoft_sync_runs'];
const [mode, a1, a2] = process.argv.slice(2);
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const counts = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true })).count; return o; };
let srv, browser, pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
require('./lib/tempGuard.cjs')(async () => { if (browser) await browser.close().catch(() => {}); if (srv) srv.kill(); }, { capMs: 240000 });

const laToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const addDays = (v, n) => new Date(Date.parse(`${v}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const weekStart = d => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));

async function setup(file) {
  const before = await counts();
  const tag = 'sfl1-' + Date.now();
  const biz = async (name, extra) => ins(await svc.from('businesses').insert({ name, website_url: 'https://example.com', owner_email: `${tag}-owner@example.com`, access_code: `${tag}-${name.slice(-5)}`, ...extra }).select().single()).id;
  const B1 = await biz('ZZ Facelift Sales', { color: '#6F8CF0', tagline: 'Partner outreach for a sales team', features: { goals_sales: true } });
  const B2 = await biz('ZZ Facelift Plain', { color: '#C97626', tagline: 'Accounts only, no sales module' });
  const B3 = await biz('ZZ Facelift Empty', { color: '#3DD68C' });
  const users = {};
  for (const [name, role] of [['Owner', 'owner'], ['Viewer', 'viewer']]) {
    const email = `${tag}-${name.toLowerCase()}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
    const { data: u, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(error.message);
    await svc.from('profiles').update({ display_name: `${name} Test`, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
    ins(await svc.from('business_members').insert([B1, B2, B3].map(b => ({ business_id: b, email, name: `${name} Test`, user_id: u.user.id, role }))).select());
    users[name] = { id: u.user.id, email, password };
  }
  const today = laToday(), WEEK = weekStart(today), LAST = addDays(WEEK, -7);
  const partner = async name => ins(await svc.from('sales_goals').insert({ business_id: B1, goal_type: 'partnership', name, pipeline_status: 'first_email_sent', owner_user_id: users.Owner.id }).select().single());
  const [p1, p2] = [await partner('Acme Benefits'), await partner('Beta PEO')];
  const at = (day, h) => new Date(Date.parse(`${day}T${h}:00:00-07:00`)).toISOString();
  ins(await svc.from('sales_partner_events').insert([
    { business_id: B1, goal_id: p1.id, event: 'status', from_status: 'not_started', to_status: 'first_email_sent', by_user: users.Owner.id, at: at(WEEK, '10') },
    { business_id: B1, goal_id: p2.id, event: 'status', from_status: 'not_started', to_status: 'first_email_sent', by_user: users.Owner.id, at: at(LAST, '10') },
  ]).select());
  ins(await svc.from('sales_week_goals').insert([
    { business_id: B1, week_start: WEEK, kind: 'todo', text: 'ZZ prep deck', owner_user_id: users.Owner.id, sort_order: 0, status: 'open' },
    { business_id: B1, week_start: WEEK, kind: 'todo', text: 'ZZ send recap', owner_user_id: users.Owner.id, sort_order: 1, due_date: today, status: 'open' },
    { business_id: B1, week_start: WEEK, kind: 'todo', text: 'ZZ already done', owner_user_id: users.Owner.id, sort_order: 2, status: 'done' },
  ]).select());
  const touched = '2026-09-30T17:00:00.000Z';
  const acc = { id: `${tag}-acc`, name: 'Acme Test Co', website: 'https://acme.example.com', stage: 'Prospect', tier: 'Gold', vertical: 'SaaS', notes: '', calls: [] };
  ins(await svc.from('accounts').insert({ id: acc.id, owner_email: users.Owner.email, business_id: B2, data: acc, updated_at: touched, last_touched_by: users.Owner.email, last_touched_at: touched }).select());
  fs.writeFileSync(file, JSON.stringify({ tag, B1, B2, B3, users, accId: acc.id, goals: [p1.id, p2.id], week: WEEK, clock: Date.now(), before }, null, 2));
  console.log(`setup done: 3 workspaces, 2 users, 1 account, 2 partners, 2 events, 3 to-dos (week ${WEEK}). Counts before: ${JSON.stringify(before)}`);
}

async function session(u) {
  const c = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: s, error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error(error.message);
  return s.session;
}
async function startServer(st) {
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${st.B1}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); return; } catch { await new Promise(r => setTimeout(r, 250)); } }
  throw new Error('server did not start');
}
async function newPage(st, sess, { width = 1440, height = 900, light = false } = {}) {
  const errs = [];
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage(); page.setDefaultTimeout(10000);
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); }); page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
  await page.clock.setFixedTime(new Date(st.clock));
  await page.addInitScript(([k, v, light]) => {
    if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
    if (light) localStorage.setItem('prospector_prefs', JSON.stringify({ displayMode: 'straight_shooter' }));
  }, [`sb-${REF}-auth-token`, JSON.stringify(sess), light]);
  await page.goto(`http://localhost:${PORT}/`);
  await page.locator('#main-content').getByText('ZZ Facelift Sales').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(3500);
  return { page, errs };
}
const shot = (page, out, name) => page.screenshot({ path: `${out}/${name}.png`, fullPage: true, animations: 'disabled', caret: 'hide' });
const card = (page, name) => page.locator('#main-content button, #main-content a').filter({ hasText: name }).first();
const scoutInput = page => page.locator('#main-content input[type="text"], #main-content input:not([type])').first();
// Inside a workspace the sidebar lists that workspace's pages; the way back to the list is the Workspace select's "All workspaces".
const backToList = async page => { await page.getByLabel('Workspace').selectOption(''); await page.waitForTimeout(1500); };

async function shoot(file, out) {
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.mkdirSync(out, { recursive: true });
  await startServer(st);
  browser = await chromium.launch();
  const allErrs = [];
  try {
    const owner = await session(st.users.Owner);
    for (const [name, opts] of [['workspaces-1440-dark', {}], ['workspaces-1440-light', { light: true }], ['workspaces-390-dark', { width: 390, height: 844 }]]) {
      const { page, errs } = await newPage(st, owner, opts);
      if (opts.light) ok('light mode class on body', await page.evaluate(() => document.body.classList.contains('mode-straight-shooter')));
      await shot(page, out, name);
      ok(`${name}: no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), await page.evaluate(() => `${document.documentElement.scrollWidth} <= ${window.innerWidth}`));
      allErrs.push(...errs.map(e => `${name}: ${e}`));
    }
    const { page, errs } = await newPage(st, await session(st.users.Viewer));
    await shot(page, out, 'workspaces-1440-viewer');
    allErrs.push(...errs.map(e => `viewer: ${e}`));
    ok('0 console errors', allErrs.length === 0, allErrs.slice(0, 5).join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(`shoot -> ${out}: ${fs.readdirSync(out).filter(f => f.endsWith('.png')).join(', ')}  ${pass}/${total}`);
}

async function click(file) {
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  await startServer(st);
  browser = await chromium.launch();
  try {
    const { page, errs } = await newPage(st, await session(st.users.Owner));
    const wsSelect = page.getByLabel('Workspace');
    ok('owner: 3 workspace cards', (await page.locator('#main-content').getByText(/^ZZ Facelift (Sales|Plain|Empty)$/).count()) === 3);
    await card(page, 'ZZ Facelift Sales').click(); await page.waitForTimeout(2500);
    ok('owner: card opens the workspace', (await wsSelect.evaluate(s => s.selectedOptions[0]?.label)) === 'ZZ Facelift Sales');
    await backToList(page);
    ok('owner: All workspaces comes back to the list', (await page.locator('#main-content').getByText('ZZ Facelift Plain').count()) === 1);
    await card(page, 'ZZ Facelift Empty').click(); await page.waitForTimeout(2500);
    ok('owner: the empty workspace opens too', (await wsSelect.evaluate(s => s.selectedOptions[0]?.label)) === 'ZZ Facelift Empty');
    await backToList(page);
    const newBiz = page.getByRole('button', { name: '+ New Business' });
    ok('owner: one + New Business control', (await newBiz.count()) === 1);
    await newBiz.click(); await page.waitForTimeout(400);
    ok('owner: + New Business opens the modal', (await page.getByText('New business', { exact: true }).count()) === 1);
    ok('owner: Create is disabled until name + website', await page.getByRole('button', { name: /Create/ }).isDisabled());
    await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await page.waitForTimeout(300);
    ok('owner: Cancel closes the modal', (await page.getByText('New business', { exact: true }).count()) === 0);
    await newBiz.click(); await page.waitForTimeout(300); await page.getByRole('button', { name: '✕' }).click(); await page.waitForTimeout(300);
    ok('owner: x closes the modal', (await page.getByText('New business', { exact: true }).count()) === 0);
    const inp = scoutInput(page);
    await inp.click(); await page.waitForTimeout(400);
    ok('owner: Scout focus opens the palette', (await page.getByText('Suggested', { exact: true }).count()) === 1);
    await inp.fill('Rank my'); await page.waitForTimeout(400);
    ok('owner: typing keeps the palette with Ask Scout', (await page.getByText(/ASK SCOUT/).count()) >= 1);
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    ok('owner: Escape closes the palette', (await page.getByText('Suggested', { exact: true }).count()) === 0);
    await inp.fill(''); await page.keyboard.press('Escape');
    const vw = await newPage(st, await session(st.users.Viewer));
    ok('viewer: sees all 3 cards', (await vw.page.locator('#main-content').getByText(/^ZZ Facelift (Sales|Plain|Empty)$/).count()) === 3);
    await card(vw.page, 'ZZ Facelift Sales').click(); await vw.page.waitForTimeout(2500);
    ok('viewer: card opens the workspace', (await vw.page.getByLabel('Workspace').evaluate(s => s.selectedOptions[0]?.label)) === 'ZZ Facelift Sales');
    await backToList(vw.page);
    console.log(`note: viewer sees + New Business: ${(await vw.page.getByRole('button', { name: '+ New Business' }).count()) === 1 ? 'yes (as before; the POST is platform-owner only)' : 'no'}`);
    ok('0 console errors', errs.length + vw.errs.length === 0, [...errs, ...vw.errs].slice(0, 5).join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(`click: ${pass}/${total}`);
}

async function after(file) {
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  await startServer(st);
  browser = await chromium.launch();
  try {
    const owner = await session(st.users.Owner);
    const { page, errs } = await newPage(st, owner);
    const main = page.locator('#main-content');
    for (const t of ['Full territory', 'Active/Qualified', 'deals in scope', 'Total Accounts', 'Accounts At Risk', 'Still Researching']) ok(`gone: "${t}"`, (await main.getByText(t).count()) === 0);
    const h1 = page.getByRole('heading', { level: 1, name: 'Workspaces' });
    ok('title "Workspaces" at 34px', (await h1.count()) === 1 && (await h1.evaluate(e => getComputedStyle(e).fontSize)) === '34px');
    const grid = page.locator('[data-workspace-grid]');
    ok('card grid present', (await grid.count()) === 1);
    const cols = await grid.evaluate(g => getComputedStyle(g).gridTemplateColumns.split(' ').length);
    ok('grid has 3 columns at 1440', cols === 3, `${cols} columns`);
    const centered = await grid.evaluate(g => { const r = g.getBoundingClientRect(), m = document.getElementById('main-content').getBoundingClientRect(); return Math.abs((r.left - m.left) - (m.right - r.right)); });
    ok('grid centered in the content area', centered <= 2, `left/right gap differ by ${centered}px`);
    ok('+ New Business is a header button, not a card', (await grid.getByRole('button', { name: '+ New Business' }).count()) === 0 && (await main.getByRole('button', { name: '+ New Business' }).count()) === 1);
    ok('sales card: 1 partner touched this week · 2 tasks due', (await card(page, 'ZZ Facelift Sales').getByText('1 partner touched this week · 2 tasks due').count()) === 1);
    ok('plain card: last activity Sep 30', (await card(page, 'ZZ Facelift Plain').getByText(/^last activity Sep 30/).count()) === 1);
    ok('empty card: no sales module', (await card(page, 'ZZ Facelift Empty').getByText('no sales module').count()) === 1);
    ok('Scout is a search input with a hint line', (await scoutInput(page).getAttribute('placeholder') || '').length > 0 && (await main.getByText(/Enter to ask Scout/).count()) === 1);
    const m = await newPage(st, owner, { width: 390, height: 844 });
    ok('390: one column', (await m.page.locator('[data-workspace-grid]').evaluate(g => getComputedStyle(g).gridTemplateColumns.split(' ').length)) === 1);
    ok('390: no sideways scroll', await m.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    ok('0 console errors', errs.length + m.errs.length === 0, [...errs, ...m.errs].slice(0, 5).join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(`after: ${pass}/${total}`);
}

async function hl(out) {
  const o = { businesses: (await svc.from('businesses').select('*', { count: 'exact', head: true }).eq('id', HOMELOVER)).count };
  for (const t of HL_TABLES) { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HOMELOVER); o[t] = r.error ? `n/a (${r.error.message.slice(0, 40)})` : r.count; }
  const line = JSON.stringify(o);
  if (out) fs.writeFileSync(out, line + '\n');
  console.log(`HomeLover READ-ONLY counts: ${line}`);
}

async function teardown(file) {
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  const bs = [st.B1, st.B2, st.B3];
  await svc.from('sales_week_goal_steps').delete().in('goal_id', (await svc.from('sales_week_goals').select('id').in('business_id', bs)).data?.map(g => g.id) || []);
  for (const t of ['sales_week_goals', 'sales_partner_events', 'sales_goals', 'accounts', 'auth_events']) await svc.from(t).delete().in('business_id', bs);
  for (const u of Object.values(st.users)) { await svc.from('business_members').delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('actor_id', u.id); }
  await svc.from('businesses').delete().in('id', bs);
  for (const u of Object.values(st.users)) await svc.auth.admin.deleteUser(u.id);
  const afterC = await counts();
  const moved = WATCH.filter(t => afterC[t] !== st.before[t]);
  console.log(`teardown: before ${JSON.stringify(st.before)}\n          after  ${JSON.stringify(afterC)}\nrestored: ${moved.length ? 'NO - moved: ' + moved.join(', ') : 'yes'}`);
}

({ setup: () => setup(a1), shoot: () => shoot(a1, a2), click: () => click(a1), after: () => after(a1), hl: () => hl(a1), teardown: () => teardown(a1) }[mode] || (() => { console.log('usage: setup|shoot|click|after|hl|teardown'); }))()
  .then(() => process.exit(total && pass !== total ? 1 : 0)).catch(e => { console.error(e); if (browser) browser.close(); if (srv) srv.kill(); process.exit(1); });
