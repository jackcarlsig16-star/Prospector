// call-notes-to-tasks-v1 Stage 2 check. Temp workspace only: 3 temp users (Jack + Cyrus members, Vera viewer; Seif is named in the notes but is not a member), 1 partner, the note + to-dos it creates, all deleted. ONE real AI extraction of the short made-up note below (~$0.01-0.03, its usage row deleted with the workspace); the 390 run replays that reply. HomeLover read only. Serves build/ via server.js - run npm run build first. Cap 4 min.
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = 'bc69beab-effd-452d-9e81-fd652333bb95', PORT = 3953, tag = 'cn2-' + Date.now();
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const WATCH = ['businesses', 'business_members', 'sales_week_goals', 'sales_week_goal_steps', 'sales_goals', 'sales_call_notes', 'business_anthropic_usage', 'profiles', 'auth_events'];
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
    await svc.from('sales_call_notes').delete().eq('business_id', b);
    await svc.from('business_anthropic_usage').delete().eq('business_id', b);
    await svc.from('sales_goals').delete().eq('business_id', b);
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


const NOTES = `Weekly sales sync
Jack, Cyrus. Seif joined for the first half.
- Jack will send the BenefitHub merchant deck by Friday.
- Cyrus to call Brad at Upside after the Thursday call and ask for 15 minutes.
- Seif will finish Exhibit C on attribution and send it to Jack.
- Jack to re-review the employer and channel partner decks.
- Cyrus will follow up with Christina at Norton about pilot dates.
- Someone needs to fix the calendar scheduling links on the partner pages.`;
// The first page on a cold server can render Goals after the click lands - retry until the To-dos card shows.
async function thisWeek(page) {
  for (let i = 0; i < 3; i++) {
    await page.locator('nav[aria-label="Views"]').getByRole('button', { name: /^This week/ }).first().click();
    if (await page.locator('section[aria-labelledby="h-todo"]').waitFor({ timeout: 4000 }).then(() => true, () => false)) return;
  }
}
// Signed-in requests from the page (the API reads the session cookie).
const api = (page, method, path, body) => page.evaluate(async ([url, method, body]) => {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}, [`/api/sales/${made.biz}/goals${path}`, method, body]);

(async () => {
  const before = await snap();
  const hlState = async () => JSON.stringify((await svc.from('sales_week_goals').select('id,status,owner_user_id,updated_at').eq('business_id', HL).order('id')).data);
  const hlBefore = await hlState();
  const t0 = Date.now();
  try {
    made.biz = ins(await svc.from('businesses').insert({ name: `ZZ Calls ${tag.slice(-5)}`, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
    const B = made.biz;
    const J = await user(B, 'Jack', 'member'), C = await user(B, 'Cyrus', 'member'), V = await user(B, 'Vera', 'viewer');
    const P1 = ins(await svc.from('sales_goals').insert({ business_id: B, goal_type: 'partnership', name: 'BenefitHub', status: 'in_progress', owner_user_id: J.id }).select().single());

    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
    for (let i = 0; i < 50 && !log.includes(`port ${PORT}`); i++) await wait(200);
    browser = await chromium.launch();
    const label = `ZZ Calls ${tag.slice(-5)}`;
    const fromCalls = () => svc.from('sales_week_goals').select('*, steps:sales_week_goal_steps(*)').eq('business_id', B).not('source_note_id', 'is', null).order('sort_order').then(r => r.data);
    const count = t => svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', B).then(r => r.count);

    // ── Jack, 1440: Goals -> This week, drawer open, paste -> review -> create 3 of N ──
    const j = await newPage(J, 1440, 1000);
    const P = j.page;
    await openWorkspace(P, label, false);
    await navGoals(P, false);
    await thisWeek(P);
    await P.getByRole('group', { name: 'Filter by person' }).getByRole('button', { name: 'Team', exact: true }).first().click(); await P.waitForTimeout(800);
    await openDrawer(P, false);
    const D = P.locator(drawerSel);
    await D.getByRole('button', { name: '📝 Paste call notes' }).click();
    await D.getByLabel('Call title').fill('Weekly sales sync');
    await D.getByLabel('Call notes', { exact: true }).fill(NOTES);
    await P.screenshot({ path: `${OUT}/cn2-1440-paste.png` });
    let extract;
    P.on('response', async r => { if (!extract && r.url().includes('/call-notes/extract')) extract = await r.json().catch(() => null); });
    const s0 = Date.now();
    await D.getByRole('button', { name: 'Find tasks' }).click();
    await D.getByRole('list', { name: 'Proposed tasks' }).waitFor({ timeout: 95000 });
    await P.waitForTimeout(300);
    const props = extract.tasks;
    console.log(`  AI: ${Math.round((Date.now() - s0) / 1000)} s, ${extract.usage.input_tokens} in / ${extract.usage.output_tokens} out, $${extract.usage.cost_usd}`);
    for (const t of props) console.log(`  - ${t.text} | ${t.owner_user_id === J.id ? 'Jack' : t.owner_user_id === C.id ? 'Cyrus' : t.owner_user_id ? '??' : 'Unassigned'}${t.due_date ? ' | due ' + t.due_date : ''}${t.link_type ? ' | ' + t.link_type : ''}`);
    ok('extract: >= 5 proposals, 0 rows written', props.length >= 5 && (await count('sales_week_goals')) === 0 && (await count('sales_call_notes')) === 0, `${props.length} proposals`);
    ok('extract: 1 AI usage row (call_tasks, Jack, cost)', await svc.from('business_anthropic_usage').select('call_type,user_id,cost_usd').eq('business_id', B).then(r => r.data.length === 1 && r.data[0].call_type === 'call_tasks' && r.data[0].user_id === J.id && r.data[0].cost_usd > 0));
    const seif = props.filter(t => /seif|exhibit c/i.test(t.text + t.evidence));
    ok('Seif (not a member) stays Unassigned', seif.length > 0 && seif.every(t => !t.owner_user_id), seif.map(t => t.text).join('; '));
    const bh = props.find(t => /benefithub/i.test(t.text));
    ok('BenefitHub task: Jack + partner link', bh && bh.owner_user_id === J.id && bh.link_type === 'partner' && bh.link_id === P1.id);
    await P.screenshot({ path: `${OUT}/cn2-1440-review.png` });

    // keep the first 3, untick the rest
    for (const t of props.slice(3)) await D.getByRole('button', { name: `Create: ${t.text}` }).click();
    ok('button reads Create 3 tasks', await D.getByRole('button', { name: 'Create 3 tasks' }).isEnabled());
    await D.getByRole('button', { name: 'Create 3 tasks' }).click();
    await D.getByRole('status').filter({ hasText: 'Created 3 tasks' }).waitFor({ timeout: 10000 });
    await P.waitForTimeout(1500);
    const made3 = await fromCalls();
    const notes = await svc.from('sales_call_notes').select('*').eq('business_id', B).then(r => r.data);
    ok('exactly 3 to-dos, one note', made3.length === 3 && notes.length === 1 && (await count('sales_week_goals')) === 3);
    ok('to-dos match the kept proposals (text, owner, due, link, steps)', made3.every((g, i) => g.text === props[i].text && g.owner_user_id === props[i].owner_user_id && g.due_date === props[i].due_date
      && g.link_type === props[i].link_type && g.link_id === props[i].link_id && g.steps.length === props[i].steps.length));
    const note = notes[0];
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    ok('this week, kind todo, category From calls · date · title, back-link, created_by Jack', made3.every(g => g.week_start === WEEK && g.kind === 'todo' && g.status === 'open' && g.source_note_id === note.id && g.created_by === J.id
      && /^From calls · \w{3} \d{1,2} · Weekly sales sync$/.test(g.category)) && note.call_date === today && note.text === NOTES && note.created_by === J.id, made3[0].category);
    const DC = D.getByRole('region', { name: 'From calls' });
    await D.getByRole('button', { name: 'Team', exact: true }).click(); await P.waitForTimeout(300);
    ok('drawer: From calls group lists all 3', (await DC.locator('li[data-task-id]').count()) === 3);
    ok('Goals -> This week shows them without reload', await P.locator('section[aria-labelledby="h-todo"]').innerText().then(t => made3.every(g => t.includes(g.text)) && /from calls · /i.test(t)));
    await P.screenshot({ path: `${OUT}/cn2-1440-created.png` });

    // source note opens from a to-do
    const R = DC.locator(`li[data-task-id="${made3[0].id}"]`);
    await R.getByRole('button', { name: made3[0].text, exact: true }).click();
    await R.getByRole('button', { name: /From call: .* · notes/ }).click(); await P.waitForTimeout(1200);
    ok('to-do opens its source notes', (await R.getByLabel(/^Call notes:/).innerText()).includes('Seif will finish Exhibit C'));
    await P.screenshot({ path: `${OUT}/cn2-1440-source-note.png` });

    // re-paste the same notes -> 0 new, no second AI call
    await D.getByRole('button', { name: '📝 Paste call notes' }).click();
    await D.getByLabel('Call notes', { exact: true }).fill(NOTES + '\n');
    await D.getByRole('button', { name: 'Find tasks' }).click();
    await D.getByText(/already pasted as “Weekly sales sync”.* - 3 tasks came from them/).waitFor({ timeout: 10000 });
    ok('re-paste: says already pasted, Find disabled', await D.getByRole('button', { name: 'Find tasks' }).isDisabled());
    await P.screenshot({ path: `${OUT}/cn2-1440-repaste.png` });
    ok('re-paste: 0 new to-dos, 1 note, still 1 AI call', (await count('sales_week_goals')) === 3 && (await count('sales_call_notes')) === 1 && (await count('business_anthropic_usage')) === 1);
    ok('Jack: 0 console errors', j.errs.length === 0, j.errs.join(' | '));
    // (after the console check: Chrome logs any 4xx response as a console error)
    const again = await api(P, 'POST', '/call-notes', { text: NOTES, call_date: today, tasks: [{ text: 'dup' }] });
    ok('re-paste via API create -> 409, nothing written', again.status === 409 && (await count('sales_week_goals')) === 3, String(again.status));

    // ── Cyrus, 1440: sees them in Goals and the drawer ──
    const c = await newPage(C, 1440, 1000);
    await openWorkspace(c.page, label, false);
    await navGoals(c.page, false);
    await thisWeek(c.page);
    await c.page.getByRole('group', { name: 'Filter by person' }).getByRole('button', { name: 'Team', exact: true }).first().click(); await c.page.waitForTimeout(800);
    ok('Cyrus: Goals -> This week shows the 3', await c.page.locator('section[aria-labelledby="h-todo"]').innerText().then(t => made3.every(g => t.includes(g.text))));
    await openDrawer(c.page, false);
    const CD = c.page.locator(drawerSel);
    await CD.getByRole('button', { name: 'Team', exact: true }).click(); await c.page.waitForTimeout(300);
    ok('Cyrus: drawer From calls lists the 3', (await CD.getByRole('region', { name: 'From calls' }).locator('li[data-task-id]').count()) === 3);
    ok('Cyrus: 0 console errors', c.errs.length === 0, c.errs.join(' | '));

    // ── Viewer: no panel, API refuses ──
    const v = await newPage(V, 1440, 1000);
    await openWorkspace(v.page, label, false);
    await openDrawer(v.page, false);
    const VD = v.page.locator(drawerSel);
    await VD.getByRole('button', { name: 'Team', exact: true }).click(); await v.page.waitForTimeout(300);
    ok('viewer: no Paste call notes button', !(await VD.getByRole('button', { name: /Paste call notes/ }).count()));
    const VR = VD.locator(`li[data-task-id="${made3[0].id}"]`);
    await VR.getByRole('button', { name: made3[0].text, exact: true }).click();
    ok('viewer: sees which call, no notes button', (await VR.innerText()).includes('From call: ') && !(await VR.getByRole('button', { name: /· notes/ }).count()));
    ok('viewer: 0 console errors', v.errs.length === 0, v.errs.join(' | '));
    const [vx, vc, vn] = await Promise.all([
      api(v.page, 'POST', '/call-notes/extract', { text: 'x' }), api(v.page, 'POST', '/call-notes', { text: 'y', call_date: today, tasks: [{ text: 'z' }] }), api(v.page, 'GET', `/call-notes/${note.id}`),
    ]);
    ok('viewer: API extract/create/read note all 403, no AI call', vx.status === 403 && vc.status === 403 && vn.status === 403 && (await count('business_anthropic_usage')) === 1, [vx.status, vc.status, vn.status].join(','));

    // ── Cyrus, 390: review panel replayed (no AI), drawer fits ──
    const ph = await newPage(C, 390, 844);
    await ph.page.route('**/call-notes/extract', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(extract) }));
    await openWorkspace(ph.page, label, true);
    await ph.page.keyboard.press('Escape'); await ph.page.waitForTimeout(300);
    await openDrawer(ph.page, true);
    const PD = ph.page.locator(drawerSel);
    await PD.getByRole('button', { name: 'Team', exact: true }).click(); await ph.page.waitForTimeout(300);
    await ph.page.screenshot({ path: `${OUT}/cn2-390-drawer.png` });
    await PD.getByRole('button', { name: '📝 Paste call notes' }).click();
    await PD.getByLabel('Call notes', { exact: true }).fill('replayed');
    await PD.getByRole('button', { name: 'Find tasks' }).click();
    await PD.getByRole('list', { name: 'Proposed tasks' }).waitFor();
    const sw = await ph.page.evaluate(() => document.documentElement.scrollWidth);
    ok('390: review fits, no sideways scroll', sw <= 390, `sw=${sw}`);
    await ph.page.screenshot({ path: `${OUT}/cn2-390-review.png` });
    await PD.getByRole('button', { name: 'Cancel' }).click();
    ok('390: Cancel returns to the list, nothing written', await PD.getByRole('region', { name: 'From calls' }).isVisible() && (await count('sales_week_goals')) === 3);
    ok('390: 0 console errors', ph.errs.length === 0, ph.errs.join(' | '));
  } catch (e) { ok('harness ran', false, e.stack.split('\n').slice(0, 3).join(' / ')); }
  await cleanup();
  const after = await snap();
  ok('table counts back to before', JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} vs ${JSON.stringify(after)}`);
  ok('HomeLover to-dos untouched (status/owner/updated_at)', (await hlState()) === hlBefore);
  console.log(`\n${pass}/${total} in ${Math.round((Date.now() - t0) / 1000)}s`);
  process.exit(0);
})();
