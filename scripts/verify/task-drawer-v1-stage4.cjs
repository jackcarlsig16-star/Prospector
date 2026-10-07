// task-drawer-v1 Stage 4 check. Temp workspace only (temp users, commitments, partner, company, to-dos), all deleted; HomeLover read only. Serves build/ via server.js - run npm run build first. Cap 4 min.
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = 'bc69beab-effd-452d-9e81-fd652333bb95', PORT = 3953, tag = 'td4-' + Date.now();
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const WATCH = ['businesses', 'business_members', 'sales_week_goals', 'sales_week_goal_steps', 'sales_goals', 'sales_sequenced_accounts', 'profiles'];
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
    await svc.from('sales_goals').delete().eq('business_id', b);
    await svc.from('sales_sequenced_accounts').delete().eq('business_id', b);
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
  const hlState = async () => JSON.stringify((await svc.from('sales_week_goals').select('id,status,owner_user_id,link_type,link_id,updated_at').eq('business_id', HL).order('id')).data);
  const hlBefore = await hlState();
  const t0 = Date.now();
  try {
    made.biz = ins(await svc.from('businesses').insert({ name: `ZZ Tasks ${tag.slice(-5)}`, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
    const B = made.biz;
    const J = await user(B, 'Jack', 'member'), C = await user(B, 'Cyrus', 'member');
    const [C1] = ins(await svc.from('sales_week_goals').insert([{ business_id: B, week_start: WEEK, kind: 'commitment', text: 'Zeta commitment', owner_user_id: J.id, sort_order: 0 }]).select());
    const P1 = ins(await svc.from('sales_goals').insert({ business_id: B, goal_type: 'partnership', name: 'Zeta Partners Health', status: 'in_progress', owner_user_id: J.id }).select().single());
    ins(await svc.from('sales_sequenced_accounts').insert({ business_id: B, account_id: 'zzacct1', name: 'Zeta Corp', first_sequenced_at: `${WEEK}T15:00:00Z`, week_start: WEEK }).select());
    const td = (text, owner, extra) => ({ business_id: B, week_start: WEEK, kind: 'todo', text, owner_user_id: owner, sort_order: 0, created_by: owner, status: 'open', link_type: null, link_id: null, ...extra });
    const T = ins(await svc.from('sales_week_goals').insert([
      td('ZZ c1 jack open', J.id, { link_type: 'commitment', link_id: C1.id }),
      td('ZZ c1 cyrus done', C.id, { link_type: 'commitment', link_id: C1.id, status: 'done' }),
      td('ZZ c1 dropped', J.id, { link_type: 'commitment', link_id: C1.id, status: 'dropped' }),
      td('ZZ m jack open', J.id, { link_type: 'metric', link_id: 'partners_first_touched' }),
      td('ZZ m cyrus open', C.id, { link_type: 'metric', link_id: 'partners_first_touched' }),
      td('ZZ m jack done', J.id, { link_type: 'metric', link_id: 'partners_first_touched', status: 'done' }),
      td('ZZ co jack open', J.id, { link_type: 'company', link_id: 'zzacct1' }),
      td('ZZ mine to check', J.id, {}),
    ]).select());
    const id = text => T.find(t => t.text === text).id;

    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
    for (let i = 0; i < 50 && !log.includes(`port ${PORT}`); i++) await wait(200);
    browser = await chromium.launch();
    const label = `ZZ Tasks ${tag.slice(-5)}`;
    const dbLinked = async (type, lid) => (await svc.from('sales_week_goals').select('id,status,owner_user_id').eq('business_id', B).eq('kind', 'todo').eq('link_type', type).eq('link_id', lid)).data.filter(t => t.status !== 'dropped');
    const row = rid => svc.from('sales_week_goals').select('*').eq('id', rid).maybeSingle().then(r => r.data);

    const b = await newPage(J, 1440, 1000);
    const P = b.page; P.on('dialog', d => d.accept());
    let loads = 0; P.on('load', () => loads++);
    await openWorkspace(P, label, false);
    await navGoals(P, false);
    const D = P.locator(drawerSel);
    const views = P.locator('nav[aria-label="Views"]');
    const person = name => P.getByRole('group', { name: 'Filter by person' }).getByRole('button', { name, exact: true }).first().click().then(() => P.waitForTimeout(1200));
    const closeDrawer = async () => { if (await D.count()) { await D.getByRole('button', { name: 'Close tasks' }).click(); await P.waitForTimeout(300); } };
    const openIds = () => D.locator('section[aria-label="This week"] li[data-task-id], section[aria-label="Overdue"] li[data-task-id]').evaluateAll(els => els.map(e => e.dataset.taskId).sort());
    const same = (a, x) => JSON.stringify([...a].sort()) === JSON.stringify([...x].sort());
    await closeDrawer();
    await person('Team');

    // 1. Commitment: "N tasks · M done" matches DB, expands, opens drawer filtered
    await views.getByRole('button', { name: /^Weekly report/ }).first().click(); await P.waitForTimeout(2500);
    const dbC1 = await dbLinked('commitment', C1.id);
    const want = `${dbC1.length} tasks · ${dbC1.filter(t => t.status === 'done').length} done`;
    const sum = P.getByRole('button', { name: `${want} linked to Zeta commitment` });
    ok('commitment shows linked count = DB', await sum.count() === 1, `DB ${want}`);
    await sum.click();
    const list = await P.getByRole('list', { name: 'Tasks linked to Zeta commitment' }).innerText();
    ok('expands to the linked tasks (dropped left out)', list.includes('ZZ c1 jack open') && list.includes('ZZ c1 cyrus done') && !list.includes('ZZ c1 dropped'));
    await P.getByRole('list', { name: 'Tasks linked to Zeta commitment' }).getByRole('button', { name: 'Open in Tasks →' }).click(); await D.waitFor(); await P.waitForTimeout(1500);
    ok('drawer opens filtered to the commitment', (await D.getByRole('button', { name: /^Showing Commitment: Zeta commitment \(2\)/ }).count()) === 1);
    ok('drawer rows = DB linked rows', same(await drawerIds(P), dbC1.map(t => t.id)));
    await closeDrawer();

    // 2. Hero "N open tasks" (Team, then Jack) = DB, opens drawer filtered
    const dbM = await dbLinked('metric', 'partners_first_touched');
    const card = P.locator('section[aria-label="Partners first-touched"]');
    await card.waitFor({ timeout: 10000 });
    const teamOpen = dbM.filter(t => t.status !== 'done');
    ok('hero (Team): open tasks = DB', (await card.getByRole('button', { name: `${teamOpen.length} open tasks for Partners first-touched - open in Tasks` }).count()) === 1, `DB ${teamOpen.length}`);
    ok('cards with nothing linked show no tasks line', !(await P.locator('section[aria-label="Meetings set"]').getByRole('button', { name: /open task/ }).count()));
    await card.getByRole('button', { name: /open tasks? for/ }).click(); await D.waitFor(); await P.waitForTimeout(1200);
    ok('hero click: drawer filtered to the goal, Team', (await D.getByRole('button', { name: /^Showing Goal: Partners first-touched/ }).count()) === 1 && await D.getByRole('group', { name: 'Whose tasks' }).getByRole('button', { name: 'Team' }).getAttribute('aria-pressed') === 'true');
    ok('hero click: open rows = DB open rows', same(await openIds(), teamOpen.map(t => t.id)));
    await P.screenshot({ path: `${OUT}/td4-1440-hero-filtered.png` });
    await closeDrawer();
    await person('Jack');
    const jackOpen = teamOpen.filter(t => t.owner_user_id === J.id);
    ok('hero (Jack): open tasks = DB', await card.getByRole('button', { name: `${jackOpen.length} open task for Partners first-touched - open in Tasks` }).waitFor({ timeout: 8000 }).then(() => true, () => false), `DB ${jackOpen.length}`);
    await card.getByRole('button', { name: /open tasks? for/ }).click(); await D.waitFor(); await P.waitForTimeout(800);
    ok('hero (Jack) click: drawer on Me, rows = DB', await D.getByRole('group', { name: 'Whose tasks' }).getByRole('button', { name: 'Me' }).getAttribute('aria-pressed') === 'true' && same(await openIds(), jackOpen.map(t => t.id)));
    await D.getByRole('button', { name: /^Showing Goal/ }).click(); await P.waitForTimeout(300);
    ok('clearing the filter shows all my tasks again', (await openIds()).length > jackOpen.length && !(await D.getByRole('button', { name: /^Showing/ }).count()));
    await closeDrawer();
    await person('Team');

    // 3. Company row chip
    await views.getByRole('button', { name: /^Companies/ }).first().click(); await P.waitForTimeout(2500);
    const dbCo = await dbLinked('company', 'zzacct1');
    const chip = P.getByRole('button', { name: `${dbCo.length} task · 0 done for Zeta Corp - open in Tasks` });
    ok('company row chip = DB', await chip.count() === 1);
    await chip.click(); await D.waitFor(); await P.waitForTimeout(1200);
    ok('company chip: drawer filtered to the company', same(await drawerIds(P), dbCo.map(t => t.id)) && (await D.getByRole('button', { name: /^Showing Company: Zeta Corp/ }).count()) === 1);
    await closeDrawer();

    // 4. Another week: no drawer links (the drawer only holds this week)
    await views.getByRole('button', { name: /^Weekly report/ }).first().click(); await P.waitForTimeout(1500);
    await P.getByRole('button', { name: 'Previous week' }).click(); await P.waitForTimeout(2500);
    ok('previous week: no hero task links', !(await P.getByRole('button', { name: /open tasks? for/ }).count()));
    await P.getByRole('button', { name: 'This week', exact: true }).click(); await P.waitForTimeout(2000);
    ok('member: 0 console errors so far', b.errs.length === 0, b.errs.join(' | '));

    // 5. Bar 5 - from the Huddle: add a task for Cyrus linked to a partner, check off one of mine
    const loadsBefore = loads;
    await P.getByRole('button', { name: /^Daily Huddle/ }).first().click(); await P.waitForTimeout(2500);
    if (!(await D.count())) await openDrawer(P, false);
    ok('reopened drawer is the plain list (link filter cleared on close)', !(await D.getByRole('button', { name: /^Showing/ }).count()));
    await D.getByLabel('New task', { exact: true }).fill('ZZ Bar5 for Cyrus');
    await D.getByLabel('Owner of the new task').selectOption({ label: 'Cyrus' });
    await D.getByRole('button', { name: 'Link for the new task' }).click();
    await D.getByLabel('Search what to link for the new task').fill('zeta partners'); await P.waitForTimeout(1500);
    await D.getByLabel('Search what to link for the new task').press('Enter');
    await D.getByLabel('New task', { exact: true }).press('Enter'); await P.waitForTimeout(2000);
    const bar = (await svc.from('sales_week_goals').select('*').eq('business_id', B).eq('text', 'ZZ Bar5 for Cyrus')).data[0];
    ok('Bar 5: task saved for Cyrus, linked to the partner', bar && bar.owner_user_id === C.id && bar.link_type === 'partner' && bar.link_id === P1.id && bar.week_start === WEEK);
    await D.getByRole('button', { name: 'Me', exact: true }).click(); await P.waitForTimeout(300);
    await D.locator(`li[data-task-id="${id('ZZ mine to check')}"]`).getByRole('button', { name: 'Done: ZZ mine to check' }).click(); await P.waitForTimeout(1500);
    ok('Bar 5: my task checked off (DB done)', (await row(id('ZZ mine to check'))).status === 'done');
    await D.getByRole('button', { name: 'Open Goals → This week' }).click(); await P.waitForTimeout(5000);
    await closeDrawer();
    const weekText = await P.locator('section[aria-labelledby="h-todo"]').innerText();
    const mineRow = await P.locator('section[aria-labelledby="h-todo"] div', { hasText: /^ZZ mine to check/ }).first().innerText().catch(() => '');
    ok('Bar 5: Goals -> This week shows the Cyrus task and my done one, no reload', weekText.includes('ZZ Bar5 for Cyrus') && /ZZ mine to check\s*done/.test(weekText) && loads === loadsBefore, `loads ${loadsBefore}->${loads} ${mineRow.slice(0, 40)}`);
    await views.getByRole('button', { name: /^Partners/ }).first().click(); await P.waitForTimeout(2000);
    await P.locator('button[aria-expanded="false"]', { hasText: 'Zeta Partners Health' }).first().click(); await P.waitForTimeout(800);
    const dbP = await dbLinked('partner', P1.id);
    ok('partner drop-down: linked count = DB', (await P.getByRole('button', { name: `${dbP.length} task · 0 done linked to Zeta Partners Health` }).count()) === 1, `DB ${dbP.length}`);
    await P.screenshot({ path: `${OUT}/td4-1440-partner-dropdown.png` });
    ok('member: 0 console errors', b.errs.length === 0, b.errs.join(' | '));

    // 6. Phone: Cyrus taps the hero tasks link
    const ph = await newPage(C, 390, 844);
    await openWorkspace(ph.page, label, true);
    await ph.page.keyboard.press('Escape'); await ph.page.waitForTimeout(300);
    await navGoals(ph.page, true);
    const pd = ph.page.locator(drawerSel);
    if (await pd.count()) { await pd.getByRole('button', { name: 'Close tasks' }).click(); await ph.page.waitForTimeout(300); }
    await ph.page.getByRole('button', { name: /open tasks? for Partners first-touched/ }).click(); await pd.waitFor(); await ph.page.waitForTimeout(1000);
    const sw = await ph.page.evaluate(() => document.documentElement.scrollWidth);
    ok('390: hero link opens the filtered sheet, no sideways scroll', (await pd.getByRole('button', { name: /^Showing Goal: Partners first-touched/ }).count()) === 1 && sw <= 390, `sw=${sw}`);
    await ph.page.screenshot({ path: `${OUT}/td4-390-hero-filtered.png` });
    ok('390: 0 console errors', ph.errs.length === 0, ph.errs.join(' | '));
  } catch (e) { ok('harness ran', false, e.stack.split('\n').slice(0, 3).join(' / ')); }
  await cleanup();
  const after = await snap();
  ok('table counts back to before', JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} vs ${JSON.stringify(after)}`);
  ok('HomeLover to-dos untouched (status/owner/link/updated_at)', (await hlState()) === hlBefore);
  console.log(`\n${pass}/${total} in ${Math.round((Date.now() - t0) / 1000)}s`);
  process.exit(0);
})();
