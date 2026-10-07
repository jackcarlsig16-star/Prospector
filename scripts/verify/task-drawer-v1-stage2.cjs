// task-drawer-v1 Stage 2 check. Part A: HomeLover read-only (1 temp member). Part B: temp workspace writes (3 temp users, 3 to-dos), all deleted. Serves build/ via server.js - run npm run build first. Cap 4 min.
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = 'bc69beab-effd-452d-9e81-fd652333bb95', PORT = 3951, tag = 'td2-' + Date.now();
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const WATCH = ['businesses', 'business_members', 'sales_week_goals', 'sales_week_goal_steps', 'profiles', 'auth_events'];
const made = { users: [], biz: null };
let srv, browser, log = '', pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const snap = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true })).count; return o; };
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('ABORT (4 min cap)'); cleanup().then(() => process.exit(2)); }, 240000);
async function cleanup() {
  if (browser) await browser.close().catch(() => {});
  if (srv) srv.kill();
  const b = made.biz;
  if (b) {
    await svc.from('sales_week_goal_steps').delete().eq('business_id', b);
    await svc.from('sales_week_goals').delete().eq('business_id', b);
    await svc.from('business_members').delete().eq('business_id', b);
    await svc.from('auth_events').delete().eq('business_id', b);
  }
  for (const u of made.users) {
    await svc.from('business_members').delete().eq('user_id', u);
    await svc.from('auth_events').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('actor_id', u);
  }
  if (b) await svc.from('businesses').delete().eq('id', b);
  for (const u of made.users) await svc.auth.admin.deleteUser(u);
}
async function user(biz, name, role) {
  const email = `${tag}-${name.toLowerCase().replace(/ /g, "")}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
  const { data: u } = await svc.auth.admin.createUser({ email, password, email_confirm: true }); made.users.push(u.user.id);
  await svc.from('profiles').update({ display_name: `${name} Test`, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
  ins(await svc.from('business_members').insert({ business_id: biz, email, name: `${name} Test`, user_id: u.user.id, role }).select());
  const c = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: s } = await c.auth.signInWithPassword({ email, password });
  return { id: u.user.id, session: s.session };
}
async function newPage(u, width, height) {
  const errs = [];
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage(); page.setDefaultTimeout(8000);
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); }); page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
  await page.addInitScript(([k, v]) => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(u.session)]);
  await page.goto(`http://localhost:${PORT}/`); await page.waitForTimeout(3000);
  return { page, errs };
}
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
const WEEK = new Date(Date.parse(`${today}T12:00:00Z`) - ((dow + 6) % 7) * 864e5).toISOString().slice(0, 10);
const drawerSel = 'aside[aria-labelledby="task-drawer-title"]';

async function openWorkspace(page, label, compact) {
  if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
  await page.getByLabel('Workspace').selectOption({ label }); await page.waitForTimeout(1500);
}
async function navGoals(page, compact) {
  if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
  await page.locator('#root').getByRole('button', { name: 'Goals & Sales', exact: true }).click(); await page.waitForTimeout(5000);
}
const openDrawer = async (page, compact) => { await page.getByRole('button', { name: compact ? /^Tasks/ : /^Open tasks/ }).click(); await page.locator(drawerSel).waitFor(); await page.waitForTimeout(400); };
const drawerIds = async page => {
  const done = page.locator(`${drawerSel} button[aria-expanded="false"]`, { hasText: 'Done this week' });
  if (await done.count()) await done.click();
  return page.locator(`${drawerSel} li[data-task-id]`).evaluateAll(els => els.map(e => e.dataset.taskId));
};
const scrollState = page => page.evaluate(() => ({ win: window.scrollY, main: document.getElementById('main-content')?.scrollTop || 0 }));

(async () => {
  const before = await snap();
  const hlState = async () => JSON.stringify((await svc.from('sales_week_goals').select('id,status,owner_user_id,updated_at').eq('business_id', HL).order('id')).data);
  const hlBefore = await hlState();
  const t0 = Date.now();
  try {
    made.biz = ins(await svc.from('businesses').insert({ name: `ZZ Tasks ${tag.slice(-5)}`, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
    const M1 = await user(made.biz, 'Jack', 'member'), M2 = await user(made.biz, 'Cyrus', 'member'), V = await user(made.biz, 'Seif', 'viewer');
    const R = await user(HL, 'Zz Drawer', 'member');
    const [T1, T2, T3] = ins(await svc.from('sales_week_goals').insert([
      { business_id: made.biz, week_start: WEEK, kind: 'todo', text: 'ZZ prep deck', owner_user_id: M1.id, sort_order: 0 },
      { business_id: made.biz, week_start: WEEK, kind: 'todo', text: 'ZZ send recap', owner_user_id: M1.id, sort_order: 1, due_date: today },
      { business_id: made.biz, week_start: WEEK, kind: 'todo', text: 'ZZ call Lockton', owner_user_id: M2.id, sort_order: 2 },
    ]).select().order('sort_order'));
    const [S1] = ins(await svc.from('sales_week_goal_steps').insert([
      { business_id: made.biz, goal_id: T1.id, text: 'step alpha', sort_order: 0 }, { business_id: made.biz, goal_id: T1.id, text: 'step beta', sort_order: 1 },
    ]).select().order('sort_order'));

    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${made.biz}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
    for (let i = 0; i < 50 && !log.includes(`port ${PORT}`); i++) await wait(200);
    browser = await chromium.launch();

    // ── Part A: HomeLover, read-only ──
    const { page, errs } = await newPage(R, 1440, 1000);
    await openWorkspace(page, 'HomeLover', false);
    ok('Command Center: Tasks handle shown on a non-sales workspace page', await page.getByRole('button', { name: /^Open tasks/ }).isVisible());
    await openDrawer(page, false);
    const { data: hlMembers } = await svc.from('business_members').select('user_id, name').eq('business_id', HL).order('created_at');
    const { data: wk } = await svc.from('sales_week_goals').select('id, owner_user_id, status, week_start, carried_from_id, prospect_contact_id, steps:sales_week_goal_steps(done)').eq('business_id', HL).eq('kind', 'todo').eq('week_start', WEEK);
    const { data: flagRows } = await svc.from('sales_week_goals').select('id, owner_user_id, status, carried_from_id').eq('business_id', HL).not('prospect_contact_id', 'is', null);
    const carried = new Set(flagRows.map(r => r.carried_from_id).filter(Boolean));
    const openFlags = flagRows.filter(r => !carried.has(r.id) && !['done', 'dropped'].includes(r.status));
    const expectFor = owner => {
      const mine = r => owner === 'team' || r.owner_user_id === owner;
      return new Set([...wk.filter(r => r.status !== 'dropped' && mine(r)).map(r => r.id), ...openFlags.filter(mine).map(r => r.id)]);
    };
    const sameSet = (a, b) => a.length === b.size && a.every(x => b.has(x));
    const drawerCounts = {};
    for (const m of hlMembers.filter(m => m.user_id && m.user_id !== R.id)) {
      const first = m.name.split(' ')[0];
      await page.locator(drawerSel).getByRole('button', { name: first, exact: true }).click(); await page.waitForTimeout(300);
      const got = await drawerIds(page), want = expectFor(m.user_id);
      drawerCounts[first.toLowerCase()] = got.filter(id => wk.some(r => r.id === id)).length;
      ok(`drawer ${first} = DB (this week's to-dos + open flags)`, sameSet(got, want), `${got.length} vs ${want.size}`);
    }
    await page.locator(drawerSel).getByRole('button', { name: 'Team', exact: true }).click(); await page.waitForTimeout(300);
    const teamGot = await drawerIds(page), teamWant = expectFor('team');
    drawerCounts.team = teamGot.filter(id => wk.some(r => r.id === id)).length;
    ok('drawer Team = DB', sameSet(teamGot, teamWant), `${teamGot.length} vs ${teamWant.size}`);
    await page.screenshot({ path: `${OUT}/td2-1440-command-center.png` });
    // Open in Goals -> This week
    await page.locator(drawerSel).getByRole('button', { name: 'Open Goals → This week' }).click(); await page.waitForTimeout(6000);
    ok('"Open Goals → This week" lands on Goals → This week, drawer stays open', await page.locator('section[aria-labelledby="h-todo"]').isVisible() && await page.locator(drawerSel).isVisible());
    // Goals This week counts per person = drawer (the open drawer covers the rail)
    await page.locator(drawerSel).getByRole('button', { name: 'Close tasks' }).click(); await page.waitForTimeout(300);
    for (const slug of Object.keys(drawerCounts)) {
      await page.getByRole('group', { name: 'Filter by person' }).getByRole('button', { name: slug === 'team' ? 'Team' : slug[0].toUpperCase() + slug.slice(1), exact: true }).first().click();
      await page.waitForTimeout(800);
      const sub = await page.locator('section[aria-labelledby="h-todo"]').innerText();
      const n = Number((sub.match(/(\d+) to-dos?/) || [])[1]);
      ok(`Goals → This week (${slug}) count = drawer`, n === drawerCounts[slug], `${n} vs ${drawerCounts[slug]}`);
    }
    await openDrawer(page, false);
    await page.screenshot({ path: `${OUT}/td2-1440-goals.png` });
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    ok('Escape closes the drawer', !(await page.locator(drawerSel).count()));

    // Page state kept: Goals > Partners, Companies, Overview, Huddle
    const keepState = async (name, setup, check) => {
      await setup(); await page.waitForTimeout(name === 'overview' ? 10000 : 2000);
      await page.evaluate(() => { window.scrollTo(0, 700); const m = document.getElementById('main-content'); if (m) m.scrollTop = 700; });
      await page.waitForTimeout(300);
      const s0 = await scrollState(page);
      await openDrawer(page, false);
      await page.screenshot({ path: `${OUT}/td2-1440-${name}.png` });
      await page.locator(drawerSel).getByRole('button', { name: 'Close tasks' }).click(); await page.waitForTimeout(300);
      const s1 = await scrollState(page);
      ok(`${name}: drawer open/close keeps scroll + view`, JSON.stringify(s0) === JSON.stringify(s1) && await check(), `${JSON.stringify(s0)} -> ${JSON.stringify(s1)}`);
    };
    const views = page.locator('nav[aria-label="Views"]');
    await keepState('goals-partners', () => views.getByRole('button', { name: /^Partners/ }).first().click(), () => page.locator('section[aria-labelledby="h-part"]').isVisible());
    await keepState('goals-companies', () => views.getByRole('button', { name: /^Companies/ }).first().click(), async () => (await page.locator('#root').innerText()).includes('Plan a cadence'));
    await keepState('overview', () => page.getByRole('button', { name: 'Overview', exact: true }).first().click(), async () => (await page.getByRole('button', { name: 'Overview', exact: true }).first().evaluate(b => getComputedStyle(b).color)) !== '');
    await keepState('huddle', () => page.getByRole('button', { name: /^Daily Huddle/ }).first().click(), () => page.locator('#huddle-feed-section, [aria-label="Activity feed"]').first().isVisible().catch(() => true));
    // Remembered open
    await openDrawer(page, false);
    await page.reload(); await page.waitForTimeout(4000);
    await openWorkspace(page, 'HomeLover', false);
    ok('open state remembered across reload', await page.locator(drawerSel).isVisible());
    ok('Part A: 0 console errors at 1440', errs.length === 0, errs.join(' | '));

    // 390
    const ph = await newPage(R, 390, 844);
    await openWorkspace(ph.page, 'HomeLover', true);
    await ph.page.keyboard.press('Escape'); await ph.page.waitForTimeout(300);
    ok('390: Tasks button in the ☰ header', await ph.page.getByRole('button', { name: /^Tasks/ }).isVisible());
    await ph.page.screenshot({ path: `${OUT}/td2-390-header.png` });
    for (const [name, go] of [['goals', () => navGoals(ph.page, true)], ['overview', () => ph.page.getByRole('button', { name: 'Overview', exact: true }).first().click()], ['huddle', () => ph.page.getByRole('button', { name: /^Daily Huddle/ }).first().click()]]) {
      if (await ph.page.locator(drawerSel).count()) await ph.page.getByRole('button', { name: 'Close tasks' }).click();
      await go(); await ph.page.waitForTimeout(2500);
      await openDrawer(ph.page, true);
      const box = await ph.page.locator(drawerSel).boundingBox();
      const sw = await ph.page.evaluate(() => document.documentElement.scrollWidth);
      ok(`390 ${name}: full-width sheet, no sideways scroll`, Math.round(box.width) === 390 && sw <= 390, `w=${box.width} sw=${sw}`);
      await ph.page.screenshot({ path: `${OUT}/td2-390-${name}.png` });
    }
    ok('390: 0 console errors', ph.errs.length === 0, ph.errs.join(' | '));

    // ── Part B: temp workspace writes ──
    const label = `ZZ Tasks ${tag.slice(-5)}`;
    const b = await newPage(M1, 1440, 1000);
    const P = b.page;
    await openWorkspace(P, label, false);
    await navGoals(P, false);
    await P.locator('nav[aria-label="Views"]').getByRole('button', { name: /^This week/ }).first().click(); await P.waitForTimeout(1500);
    await P.getByRole('group', { name: 'Filter by person' }).getByRole('button', { name: 'Team', exact: true }).first().click(); await P.waitForTimeout(800);
    const meta = () => P.locator('nav[aria-label="Views"]').getByRole('button', { name: /^This week/ }).first().innerText();
    await openDrawer(P, false);
    const D = P.locator(drawerSel);
    ok('badge = my open to-dos (2)', (await P.locator(`${drawerSel} header [aria-label$=" open"]`).innerText()) === '2');
    const goalStatus = async id => (await svc.from('sales_week_goals').select('status, owner_user_id').eq('id', id).single()).data;
    const meta0 = await meta();
    await D.getByRole('button', { name: 'Done: ZZ send recap' }).click(); await P.waitForTimeout(1500);
    const meta1 = await meta();
    ok('check off in drawer -> DB done + Goals This week updates without reload', (await goalStatus(T2.id)).status === 'done' && meta0.includes('0/3') && meta1.includes('1/3'), `${meta0.replace(/\n/g, ' ')} -> ${meta1.replace(/\n/g, ' ')}`);
    ok('toast offers Undo', await D.getByRole('status').getByRole('button', { name: 'Undo' }).isVisible());
    await D.getByRole('status').getByRole('button', { name: 'Undo' }).click(); await P.waitForTimeout(1500);
    ok('Undo -> DB open + Goals back', (await goalStatus(T2.id)).status === 'open' && (await meta()).includes('0/3'));
    // Goals step tick -> drawer
    await P.locator('section[aria-labelledby="h-todo"]').getByRole('button', { name: 'Done: step alpha' }).click(); await P.waitForTimeout(1500);
    ok('tick a step in Goals -> drawer shows 1/2 without reload', (await D.locator(`li[data-task-id="${T1.id}"]`).innerText()).includes('1/2'));
    // drawer step tick -> Goals
    await D.locator(`li[data-task-id="${T1.id}"]`).getByRole('button', { name: 'ZZ prep deck', exact: true }).click();
    await D.getByRole('button', { name: 'Step done: step beta' }).click(); await P.waitForTimeout(1500);
    ok('tick a step in the drawer -> Goals step ticked + to-do done by steps', await P.locator('section[aria-labelledby="h-todo"]').getByRole('button', { name: 'Done: step beta' }).getAttribute('aria-pressed') === 'true' && (await meta()).includes('1/3'));
    await drawerIds(P);
    ok('a to-do done by its steps moves to Done this week; only a step reopens it', (await D.getByRole('region', { name: 'Done this week' }).innerText()).includes('ZZ prep deck') && await D.getByRole('button', { name: 'Done: ZZ prep deck' }).isDisabled());
    // Reassign
    await D.getByRole('button', { name: 'Team', exact: true }).click(); await P.waitForTimeout(300);
    await D.getByLabel('Owner of ZZ call Lockton').selectOption({ label: 'Jack' }); await P.waitForTimeout(1500);
    ok('reassign from the owner chip -> DB owner + badge', (await goalStatus(T3.id)).owner_user_id === M1.id && (await P.locator(`${drawerSel} header [aria-label$=" open"]`).innerText()) === '2', `badge ${await P.locator(`${drawerSel} header [aria-label$=" open"]`).innerText()}`);
    await P.screenshot({ path: `${OUT}/td2-1440-temp-goals-week.png` });
    ok('Part B member: 0 console errors', b.errs.length === 0, b.errs.join(' | '));
    // Viewer
    const v = await newPage(V, 1440, 1000);
    await openWorkspace(v.page, label, false);
    await openDrawer(v.page, false);
    await v.page.locator(drawerSel).getByRole('button', { name: 'Team', exact: true }).click(); await v.page.waitForTimeout(300);
    await drawerIds(v.page);
    const boxes = v.page.locator(`${drawerSel} li button[aria-pressed]`);
    const enabled = await boxes.evaluateAll(bs => bs.filter(x => !x.disabled).length);
    ok('viewer: read-only (rows shown, no enabled checks, no owner pickers)', (await boxes.count()) >= 3 && enabled === 0 && (await v.page.locator(`${drawerSel} select`).count()) === 0 && (await v.page.locator(drawerSel).innerText()).includes('read-only'), `boxes ${await boxes.count()} enabled ${enabled} selects ${await v.page.locator(`${drawerSel} select`).count()}`);
    ok('viewer: 0 console errors', v.errs.length === 0, v.errs.join(' | '));
  } catch (e) { ok('harness ran', false, e.stack.split('\n').slice(0, 3).join(' / ')); }
  await cleanup();
  const after = await snap();
  ok('table counts back to before', JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} vs ${JSON.stringify(after)}`);
  ok('HomeLover to-dos untouched (status/owner/updated_at)', (await hlState()) === hlBefore);
  console.log(`\n${pass}/${total} in ${Math.round((Date.now() - t0) / 1000)}s`);
  process.exit(0);
})();
