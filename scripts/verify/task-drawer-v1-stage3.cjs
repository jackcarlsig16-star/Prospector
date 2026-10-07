// task-drawer-v1 Stage 3 check. Temp workspace only: 4 temp users, 1 commitment, 1 partner, 1 company, 3 to-dos (+ ones it adds), all deleted. HomeLover read only for the untouched check. Serves build/ via server.js - run npm run build first. Cap 4 min.
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = 'bc69beab-effd-452d-9e81-fd652333bb95', PORT = 3952, tag = 'td3-' + Date.now();
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const WATCH = ['businesses', 'business_members', 'sales_week_goals', 'sales_week_goal_steps', 'sales_goals', 'sales_sequenced_accounts', 'profiles', 'auth_events'];
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
  const hlState = async () => JSON.stringify((await svc.from('sales_week_goals').select('id,status,owner_user_id,updated_at').eq('business_id', HL).order('id')).data);
  const hlBefore = await hlState();
  const t0 = Date.now();
  try {
    made.biz = ins(await svc.from('businesses').insert({ name: `ZZ Tasks ${tag.slice(-5)}`, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
    const B = made.biz;
    const M1 = await user(B, 'Jack', 'member'), M2 = await user(B, 'Cyrus', 'member'), A = await user(B, 'Ana', 'admin'), V = await user(B, 'Seif', 'viewer');
    const [C1] = ins(await svc.from('sales_week_goals').insert([{ business_id: B, week_start: WEEK, kind: 'commitment', text: 'Zeta commitment', owner_user_id: M1.id, sort_order: 0 }]).select());
    const P1 = ins(await svc.from('sales_goals').insert({ business_id: B, goal_type: 'partnership', name: 'Zeta Partners Health', status: 'in_progress', owner_user_id: M1.id }).select().single());
    ins(await svc.from('sales_sequenced_accounts').insert({ business_id: B, account_id: 'zzacct1', name: 'Zeta Corp', first_sequenced_at: `${WEEK}T15:00:00Z`, week_start: WEEK }).select());
    const [T1, T2, T3] = ins(await svc.from('sales_week_goals').insert([
      { business_id: B, week_start: WEEK, kind: 'todo', text: 'ZZ prep deck', owner_user_id: M1.id, sort_order: 0 },
      { business_id: B, week_start: WEEK, kind: 'todo', text: 'ZZ old task', owner_user_id: M1.id, sort_order: 1 },
      { business_id: B, week_start: WEEK, kind: 'todo', text: 'ZZ admin only', owner_user_id: M1.id, sort_order: 2 },
    ]).select().order('sort_order'));

    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
    for (let i = 0; i < 50 && !log.includes(`port ${PORT}`); i++) await wait(200);
    browser = await chromium.launch();
    const label = `ZZ Tasks ${tag.slice(-5)}`;
    const row = id => svc.from('sales_week_goals').select('*').eq('id', id).maybeSingle().then(r => r.data);
    const byText = text => svc.from('sales_week_goals').select('*').eq('business_id', B).eq('text', text).maybeSingle().then(r => r.data);

    // ── Member (Jack) on Goals -> This week, drawer open ──
    const b = await newPage(M1, 1440, 1000);
    const P = b.page; P.on('dialog', d => d.accept());
    await openWorkspace(P, label, false);
    await navGoals(P, false);
    await P.locator('nav[aria-label="Views"]').getByRole('button', { name: /^This week/ }).first().click(); await P.waitForTimeout(1500);
    await P.getByRole('group', { name: 'Filter by person' }).getByRole('button', { name: 'Team', exact: true }).first().click(); await P.waitForTimeout(800);
    await openDrawer(P, false);
    const D = P.locator(drawerSel);
    ok('chips hidden until there is text', !(await D.getByLabel('Owner of the new task').count()));

    // 1. plain quick-add, Enter, timed
    await D.getByLabel('New task', { exact: true }).fill('ZZ quick one');
    const s0 = Date.now();
    await D.getByLabel('New task', { exact: true }).press('Enter');
    await D.locator('li[data-task-id]', { hasText: 'ZZ quick one' }).waitFor({ timeout: 5000 });
    const ms = Date.now() - s0;
    const q1 = await byText('ZZ quick one');
    ok('Enter adds a task in under 5 s (owner me, this week, to-do)', ms < 5000 && q1 && q1.owner_user_id === M1.id && q1.week_start === WEEK && q1.kind === 'todo' && q1.created_by === M1.id && !q1.due_date && !q1.link_type, `${ms} ms`);
    ok('input cleared after add', (await D.getByLabel('New task', { exact: true }).inputValue()) === '');
    ok('Goals -> This week shows it without reload', (await P.locator('section[aria-labelledby="h-todo"]').innerText()).includes('ZZ quick one'));

    // 2. quick-add with Owner / Due / Link (partner) chips
    await D.getByLabel('New task', { exact: true }).fill('ZZ for Cyrus');
    await D.getByLabel('Owner of the new task').selectOption({ label: 'Cyrus' });
    const due = WEEK.slice(0, 8) + String(Number(WEEK.slice(8)) + 4).padStart(2, '0');
    await D.getByLabel('Due date of the new task').fill(due);
    await D.getByRole('button', { name: 'Link for the new task' }).click();
    const search = D.getByLabel('Search what to link for the new task');
    await search.fill('zeta'); await P.waitForTimeout(1500);
    const groupNames = await D.getByRole('listbox', { name: 'Link to' }).getByRole('group').evaluateAll(gs => gs.map(g => g.getAttribute('aria-label')));
    ok('typeahead groups commitments, partners, companies', JSON.stringify(groupNames) === JSON.stringify(['Commitments this week', 'Partners', 'Companies']), groupNames.join(','));
    await search.fill('meetings s');
    ok('typeahead finds metric goals', (await D.getByRole('listbox').getByRole('group', { name: 'Goals' }).innerText()).includes('Meetings set'));
    await search.press('Escape'); await P.waitForTimeout(200);
    ok('Escape closes the picker, not the drawer', await D.isVisible() && !(await D.getByRole('listbox').count()));
    await D.getByRole('button', { name: 'Link for the new task' }).click();
    await D.getByLabel('Search what to link for the new task').fill('zeta partners');
    await D.getByLabel('Search what to link for the new task').press('Enter'); await P.waitForTimeout(200);
    ok('picked link shows as a chip', (await D.getByRole('button', { name: 'Change link for the new task' }).innerText()) === 'Partner: Zeta Partners Health');
    await D.getByLabel('New task', { exact: true }).press('Enter'); await P.waitForTimeout(2000);
    const q2 = await byText('ZZ for Cyrus');
    ok('chips save: owner Cyrus, due date, partner link', q2 && q2.owner_user_id === M2.id && q2.due_date === due && q2.link_type === 'partner' && q2.link_id === P1.id, JSON.stringify(q2 && { o: q2.owner_user_id === M2.id, d: q2.due_date, l: q2.link_type }));
    ok('toast says who it was added for', (await D.getByRole('status').innerText()).includes('Added for Cyrus'));
    ok('Goals -> This week shows the Cyrus task without reload', (await P.locator('section[aria-labelledby="h-todo"]').innerText()).includes('ZZ for Cyrus'));
    await P.screenshot({ path: `${OUT}/td3-1440-after-add.png` });

    // 3. edit an existing row: due, link company -> metric -> clear, add step
    const R1 = D.locator(`li[data-task-id="${T1.id}"]`);
    await R1.getByRole('button', { name: 'ZZ prep deck', exact: true }).click();
    await R1.getByLabel('Due date of ZZ prep deck').fill(due); await P.waitForTimeout(1500);
    ok('row: due date saves', (await row(T1.id)).due_date === due);
    await R1.getByRole('button', { name: 'Link for ZZ prep deck' }).click();
    await R1.getByLabel('Search what to link for ZZ prep deck').fill('zeta corp');
    await R1.getByRole('option', { name: 'Zeta Corp' }).click(); await P.waitForTimeout(1500);
    let r = await row(T1.id);
    ok('row: link to a company saves (Apollo account id)', r.link_type === 'company' && r.link_id === 'zzacct1');
    ok('row: chip shows the company name', (await R1.getByRole('button', { name: 'Change link for ZZ prep deck' }).innerText()) === 'Company: Zeta Corp');
    await R1.getByRole('button', { name: 'Change link for ZZ prep deck' }).click();
    await R1.getByLabel('Search what to link for ZZ prep deck').fill('zeta comm');
    await R1.getByLabel('Search what to link for ZZ prep deck').press('Enter'); await P.waitForTimeout(1500);
    r = await row(T1.id);
    ok('row: relink to a commitment', r.link_type === 'commitment' && r.link_id === C1.id);
    await R1.getByRole('button', { name: 'Remove link for ZZ prep deck' }).click(); await P.waitForTimeout(1500);
    r = await row(T1.id);
    ok('row: remove link clears both fields', r.link_type === null && r.link_id === null);
    await R1.getByLabel('Add a step to ZZ prep deck').fill('ZZ step one');
    await R1.getByLabel('Add a step to ZZ prep deck').press('Enter'); await P.waitForTimeout(1500);
    const { data: steps } = await svc.from('sales_week_goal_steps').select('text, done').eq('goal_id', T1.id);
    ok('row: add a step (DB + 0/1 count)', steps.length === 1 && steps[0].text === 'ZZ step one' && (await R1.innerText()).includes('0/1'));
    ok('row: Goals shows the new step without reload', (await P.locator('section[aria-labelledby="h-todo"]').innerText()).includes('ZZ step one'));

    // 4. Delete (own, < 2 min) vs Drop (not mine)
    const RQ = D.locator(`li[data-task-id="${q1.id}"]`);
    await RQ.getByRole('button', { name: 'ZZ quick one', exact: true }).click();
    ok('own task within 2 min shows Delete, not Drop', await RQ.getByRole('button', { name: 'Delete' }).isVisible() && !(await RQ.getByRole('button', { name: 'Drop' }).count()));
    await RQ.getByRole('button', { name: 'Delete' }).click(); await P.waitForTimeout(1500);
    ok('Delete removes it (DB)', !(await row(q1.id)));
    const R2 = D.locator(`li[data-task-id="${T2.id}"]`);
    await R2.getByRole('button', { name: 'ZZ old task', exact: true }).click();
    ok('task I did not add shows Drop, not Delete', await R2.getByRole('button', { name: 'Drop' }).isVisible() && !(await R2.getByRole('button', { name: 'Delete' }).count()));
    await R2.getByRole('button', { name: 'Drop' }).click(); await P.waitForTimeout(1500);
    ok('Drop -> DB dropped, row hidden', (await row(T2.id)).status === 'dropped' && !(await D.locator(`li[data-task-id="${T2.id}"]`).count()));
    await D.getByRole('status').getByRole('button', { name: 'Undo' }).click(); await P.waitForTimeout(1500);
    ok('Undo drop -> DB open, row back', (await row(T2.id)).status === 'open' && await D.locator(`li[data-task-id="${T2.id}"]`).count() === 1);
    ok('member: 0 console errors', b.errs.length === 0, b.errs.join(' | '));

    // 5. Admin deletes a task someone else added
    const a = await newPage(A, 1440, 1000); a.page.on('dialog', d => d.accept());
    await openWorkspace(a.page, label, false);
    await openDrawer(a.page, false);
    const AD = a.page.locator(drawerSel);
    await AD.getByRole('button', { name: 'Team', exact: true }).click(); await a.page.waitForTimeout(300);
    const R3 = AD.locator(`li[data-task-id="${T3.id}"]`);
    await R3.getByRole('button', { name: 'ZZ admin only', exact: true }).click();
    await R3.getByRole('button', { name: 'Delete' }).click(); await a.page.waitForTimeout(1500);
    ok('admin: Delete on any task (DB)', !(await row(T3.id)));
    ok('admin: 0 console errors', a.errs.length === 0, a.errs.join(' | '));

    // 6. Viewer: no add, no chips
    const v = await newPage(V, 1440, 1000);
    await openWorkspace(v.page, label, false);
    await openDrawer(v.page, false);
    const VD = v.page.locator(drawerSel);
    await VD.getByRole('button', { name: 'Team', exact: true }).click(); await v.page.waitForTimeout(300);
    await VD.locator('li[data-task-id] button[aria-expanded="false"]').first().click();
    ok('viewer: no quick-add, no date/link/step editors, no Delete/Drop', !(await VD.getByLabel('New task', { exact: true }).count()) && !(await VD.locator('input').count()) && !(await VD.getByRole('button', { name: /^(Delete|Drop|Link|Change link)/ }).count()));
    ok('viewer: 0 console errors', v.errs.length === 0, v.errs.join(' | '));

    // 7. Phone
    const ph = await newPage(M2, 390, 844);
    await openWorkspace(ph.page, label, true);
    await ph.page.keyboard.press('Escape'); await ph.page.waitForTimeout(300);
    await openDrawer(ph.page, true);
    const PD = ph.page.locator(drawerSel);
    await PD.getByLabel('New task', { exact: true }).fill('ZZ phone task');
    await PD.getByRole('button', { name: 'Link for the new task' }).click();
    await PD.getByLabel('Search what to link for the new task').fill('zeta'); await ph.page.waitForTimeout(1500);
    const sw = await ph.page.evaluate(() => document.documentElement.scrollWidth);
    ok('390: quick-add + chips + picker fit, no sideways scroll', sw <= 390, `sw=${sw}`);
    await ph.page.screenshot({ path: `${OUT}/td3-390-quick-add.png` });
    await PD.getByLabel('Search what to link for the new task').press('Enter');
    await PD.getByLabel('New task', { exact: true }).press('Enter'); await ph.page.waitForTimeout(2000);
    const q3 = await byText('ZZ phone task');
    ok('390: add with a commitment link (owner = me)', q3 && q3.owner_user_id === M2.id && q3.link_type === 'commitment' && q3.link_id === C1.id);
    ok('390: 0 console errors', ph.errs.length === 0, ph.errs.join(' | '));
  } catch (e) { ok('harness ran', false, e.stack.split('\n').slice(0, 3).join(' / ')); }
  await cleanup();
  const after = await snap();
  ok('table counts back to before', JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} vs ${JSON.stringify(after)}`);
  ok('HomeLover to-dos untouched (status/owner/updated_at)', (await hlState()) === hlBefore);
  console.log(`\n${pass}/${total} in ${Math.round((Date.now() - t0) / 1000)}s`);
  process.exit(0);
})();
