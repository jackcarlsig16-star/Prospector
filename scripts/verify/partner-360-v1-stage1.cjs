// partner-360-v1 Stage 1 check. TEMP workspace only (3 temp users: Jack + Cyrus members, Vera viewer; 5 temp partners, their events and 2 fake partner_contacts rows, all deleted; a second temp workspace for the cross-workspace 404). HomeLover untouched (counts snapshotted). Part A = API (people routes, people_count, backdated touch moves first-touched to the week of Sep 28). Part B = real browser (Playwright): the 5 sections, noise behind "Show all activity (n)", Log touch, bulk catch-up of 3, viewer, 1440 + 390 screenshots, 0 console errors. 0 AI / 0 Apollo calls. ~2 min, cap 4 min. Serves build/ via server.js - run npm run build first. Fake emails (example.com) only; nothing here prints an email.
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const OUT = process.argv[2] || '/tmp/partner-360-stage1'; fs.mkdirSync(OUT, { recursive: true });
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = 'bc69beab-effd-452d-9e81-fd652333bb95', PORT = 3958, tag = 'p360-' + Date.now();
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const WATCH = ['businesses', 'business_members', 'sales_goals', 'sales_partner_events', 'partner_contacts', 'sales_week_goals', 'profiles', 'auth_events'];
const made = { users: [], biz: [] };
let srv, browser, log = '', pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const snap = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true })).count; return o; };
const hlSnap = async () => JSON.stringify({ pc: (await svc.from('partner_contacts').select('*', { count: 'exact', head: true }).eq('business_id', HL)).count, ev: (await svc.from('sales_partner_events').select('*', { count: 'exact', head: true }).eq('business_id', HL)).count, goals: (await svc.from('sales_goals').select('id,updated_at').eq('business_id', HL).eq('goal_type', 'partnership').order('id')).data });
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('ABORT (4 min cap)'); cleanup().then(() => process.exit(2)); }, 240000);
async function cleanup() {
  if (browser) await browser.close().catch(() => {});
  if (srv) srv.kill();
  for (const b of made.biz) {
    await svc.from('sales_week_goal_steps').delete().eq('business_id', b);
    await svc.from('sales_week_goals').delete().eq('business_id', b);
    await svc.from('partner_contacts').delete().eq('business_id', b);
    await svc.from('sales_partner_events').delete().eq('business_id', b);
    await svc.from('sales_goals').delete().eq('business_id', b);
    await svc.from('business_members').delete().eq('business_id', b);
    await svc.from('auth_events').delete().eq('business_id', b);
  }
  for (const u of made.users) { await svc.from('business_members').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('actor_id', u); }
  for (const b of made.biz) await svc.from('businesses').delete().eq('id', b);
  for (const u of made.users) await svc.auth.admin.deleteUser(u);
}
const biz = async name => { const id = ins(await svc.from('businesses').insert({ name: `ZZ ${name} ${tag.slice(-5)}`, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}-${name}@example.com`, access_code: `${tag}-${name}`, features: { goals_sales: true } }).select().single()).id; made.biz.push(id); return id; };
async function user(b, name, role) {
  const email = `${tag}-${name.toLowerCase()}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
  const { data: u } = await svc.auth.admin.createUser({ email, password, email_confirm: true }); made.users.push(u.user.id);
  await svc.from('profiles').update({ display_name: `${name} Test`, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
  ins(await svc.from('business_members').insert({ business_id: b, email, name: `${name} Test`, user_id: u.user.id, role }).select());
  const c = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: s } = await c.auth.signInWithPassword({ email, password });
  return { id: u.user.id, session: s.session, cookie: `prospector_at=${encodeURIComponent(s.session.access_token)}` };
}
async function newPage(u, width, height) {
  const errs = [];
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage(); page.setDefaultTimeout(8000);
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); }); page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
  await page.addInitScript(([k, v]) => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(u.session)]);
  await page.goto(`http://localhost:${PORT}/`); await page.waitForTimeout(3000);
  return { page, errs };
}
let bizLabel = '';
async function navPartners(page, compact) {
  try {
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').selectOption({ label: bizLabel }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Goals & Sales', exact: true }).click(); await page.waitForTimeout(3000);
    const views = page.getByRole('button', { name: /^Partners/ }).first();
    if (await views.count()) { await views.click(); await page.waitForTimeout(2500); }
    await page.locator('section[aria-labelledby="h-part"]').waitFor();
  } catch (e) {
    await page.screenshot({ path: `${OUT}/nav-fail-${compact ? 390 : 1440}.png`, fullPage: true }).catch(() => {});
    console.log('NAV TEXT:', (await page.locator('#root').innerText().catch(() => '')).replace(/\n+/g, ' | ').slice(0, 600));
    throw e;
  }
}
const row = (page, id) => page.locator(`[data-partner-id="${id}"]`).first();
const openRow = async (page, id) => { await row(page, id).locator('button[aria-expanded]').first().click(); await page.waitForTimeout(1500); };
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const addDays = (v, n) => new Date(Date.parse(`${v}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const monday = d => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
const WEEK = monday(today), PAST = '2026-10-02', PAST_WEEK = monday(PAST);

(async () => {
  const before = await snap(), hlBefore = await hlSnap();
  try {
    const B = await biz('p360'), OTHER = await biz('other');
    bizLabel = (await svc.from('businesses').select('name').eq('id', B).single()).data.name;
    const jack = await user(B, 'Jack', 'member'), cyrus = await user(B, 'Cyrus', 'member'), vera = await user(B, 'Vera', 'viewer');
    const partner = async (name, extra = {}) => ins(await svc.from('sales_goals').insert({ business_id: B, goal_type: 'partnership', name, pipeline_status: 'not_started', category: '5. Rental Rewards & Renter Platforms', ...extra }).select().single());
    const JW = await partner(`Justworks ${tag.slice(-4)}`, { pipeline_status: 'replied', known_contacts: 'Pat Lee (intro)', angle: 'Payroll partner for renters', priority: 1 });
    const [A, Bv, C, Dl] = await Promise.all([partner('Alpha Test'), partner('Bravo Test'), partner('Charlie Test'), partner('Delta Test', { pipeline_status: 'first_email_drafted' })]);
    const foreign = ins(await svc.from('sales_goals').insert({ business_id: OTHER, goal_type: 'partnership', name: 'Foreign Test', pipeline_status: 'not_started' }).select().single());
    const t0 = Date.now() - 3 * 3600e3, at = i => new Date(t0 + i * 60e3).toISOString();
    // Justworks: 8 try-out clicks (noise) + the real moves this week (Sent, then Replied).
    ins(await svc.from('sales_partner_events').insert([
      { business_id: B, goal_id: JW.id, event: 'hot', meta: { hot: true, prev: { hot: false } }, at: at(0), recorded_at: at(0), by_user: jack.id },
      { business_id: B, goal_id: JW.id, event: 'hot', meta: { hot: false, prev: { hot: true } }, at: at(1), recorded_at: at(1), by_user: jack.id },
      { business_id: B, goal_id: JW.id, event: 'snooze', meta: { until: addDays(today, 7), prev: { snoozed_until: null } }, at: at(2), recorded_at: at(2), by_user: jack.id },
      { business_id: B, goal_id: JW.id, event: 'hot', meta: { hot: true, prev: { hot: false } }, at: at(4), recorded_at: at(4), by_user: jack.id },
      { business_id: B, goal_id: JW.id, event: 'hot', meta: { hot: false, prev: { hot: true } }, at: at(5), recorded_at: at(5), by_user: jack.id },
      { business_id: B, goal_id: JW.id, event: 'note', note: 'test note', meta: { prev: {} }, at: at(6), recorded_at: at(6), by_user: jack.id },
      { business_id: B, goal_id: JW.id, event: 'status', from_status: 'not_started', to_status: 'first_email_sent', meta: { prev: { pipeline_status: 'not_started' } }, at: at(10), recorded_at: at(10), by_user: jack.id },
      { business_id: B, goal_id: JW.id, event: 'status', from_status: 'first_email_sent', to_status: 'replied', meta: { prev: { pipeline_status: 'first_email_sent' } }, at: at(11), recorded_at: at(11), by_user: jack.id },
    ]).select());
    const [sn, nt] = (await svc.from('sales_partner_events').select('id,event').eq('goal_id', JW.id).in('event', ['snooze', 'note']).order('at')).data;
    ins(await svc.from('sales_partner_events').insert([
      { business_id: B, goal_id: JW.id, event: 'undo', meta: { undid: sn.id, undid_event: 'snooze', prev: {} }, at: at(3), recorded_at: at(3), by_user: jack.id },
      { business_id: B, goal_id: JW.id, event: 'undo', meta: { undid: nt.id, undid_event: 'note', prev: {} }, at: at(7), recorded_at: at(7), by_user: jack.id },
    ]).select());
    const dana = ins(await svc.from('partner_contacts').insert({ business_id: B, goal_id: JW.id, name: 'Dana Kim', title: 'VP Partnerships', email: `${tag}-dana@example.com`, source: 'apollo', apollo_contact_id: `${tag}-ac1` }).select().single());

    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B},${OTHER}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
    for (let i = 0; i < 60 && !log.includes(`${PORT}`); i++) await wait(250);
    const call = (u, method, path, body) => fetch(`http://localhost:${PORT}/api/sales/${B}/goals${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: u.cookie }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
    const firstTouched = async w => (await call(jack, 'GET', `/report?week_start=${w}`)).body.partners?.metrics?.partners_first_touched?.value;

    // ── Part A: API ──
    let r = await call(vera, 'GET', `/partners/${JW.id}/people`);
    ok('A1 viewer GET people -> 200, the 1 synced row', r.status === 200 && r.body.people.length === 1 && r.body.people[0].name === 'Dana Kim');
    r = await call(vera, 'POST', `/partners/${JW.id}/people`, { name: 'Nope' });
    ok('A2 viewer POST person -> 403', r.status === 403, String(r.status));
    r = await call(jack, 'POST', `/partners/${JW.id}/people`, { name: '  Sam   Roe ', title: 'VP', email: `${tag.toUpperCase()}-SAM@EXAMPLE.COM` });
    const sam = r.body.person;
    ok('A3 member POST person -> 201, name squeezed, email lowercased, source manual, created_by', r.status === 201 && sam.name === 'Sam Roe' && sam.email === `${tag}-sam@example.com` && sam.source === 'manual' && sam.created_by === jack.id);
    r = await call(cyrus, 'POST', `/partners/${JW.id}/people`, { name: 'Sam Again', email: `${tag}-sam@example.com` });
    ok('A4 same email again -> 409', r.status === 409, String(r.status));
    const bads = await Promise.all([call(jack, 'POST', `/partners/${JW.id}/people`, { name: 'X', email: 'not-an-email' }), call(jack, 'POST', `/partners/${JW.id}/people`, { title: 'no name' }), call(jack, 'POST', `/partners/${JW.id}/people`, { name: 'X', linkedin_url: 'https://evil.example.com/in/x' }), call(jack, 'POST', `/partners/${JW.id}/people`, { name: 'x'.repeat(121) })]);
    ok('A5 bad email / no name / non-LinkedIn url / long name -> 400 each', bads.every(b => b.status === 400), bads.map(b => b.status).join(','));
    r = await call(jack, 'POST', `/partners/${foreign.id}/people`, { name: 'X' });
    ok('A6 partner in another workspace -> 404', r.status === 404, String(r.status));
    r = await call(jack, 'DELETE', `/partners/${JW.id}/people/${dana.id}`);
    ok('A7a deleting a synced (Apollo) person -> 400', r.status === 400, String(r.status));
    r = await call(vera, 'DELETE', `/partners/${JW.id}/people/${sam.id}`);
    ok('A7b viewer DELETE -> 403', r.status === 403, String(r.status));
    r = await call(cyrus, 'DELETE', `/partners/${JW.id}/people/${sam.id}`);
    const after = await call(jack, 'GET', `/partners/${JW.id}/people`);
    ok('A7c member DELETE manual person -> 200, list back to 1', r.status === 200 && after.body.people.length === 1);
    let list = (await call(jack, 'GET', '/land?goal_type=partnership')).body.goals;
    const pc = id => list.find(g => g.id === id).people_count;
    ok('A8 people_count on the list = merge (Dana + Pat Lee from the sheet = 2; others 0)', pc(JW.id) === 2 && pc(A.id) === 0 && pc(Dl.id) === 0, `${pc(JW.id)}`);
    const ftThisBefore = await firstTouched(WEEK), ftPastBefore = await firstTouched(PAST_WEEK);
    r = await call(jack, 'POST', `/partners/${JW.id}/signal`, { type: 'touch', touch_type: 'call', date: PAST, contacts: ['Jane Doe', 'pat lee'], note: 'Intro call', expect: 'replied' });
    ok('A9a backdated call (Oct 2) -> 200, event dated Oct 2 midday LA, stage stays Replied', r.status === 200 && r.body.event.at.startsWith(`${PAST}T19:00:00`) && r.body.event.to_status === null && r.body.goal.pipeline_status === 'replied', JSON.stringify(r.body).slice(0, 160));
    const ftThis = await firstTouched(WEEK), ftPast = await firstTouched(PAST_WEEK);
    ok('A9b first-touched: this week -1, week of Sep 28 +1', ftThis === ftThisBefore - 1 && ftPast === ftPastBefore + 1, `this ${ftThisBefore}->${ftThis}, past ${ftPastBefore}->${ftPast}`);
    list = (await call(jack, 'GET', '/land?goal_type=partnership')).body.goals;
    ok('A9c people_count now 3 (Jane Doe logged; pat lee = the sheet\'s Pat Lee, once)', pc(JW.id) === 3, `${pc(JW.id)}`);
    r = await call(jack, 'POST', '/partners/touches', { dry_run: true, touches: [A, Bv, C].map(p => ({ goal_id: p.id, touch_type: 'email', date: today, move_to: 'auto' })) });
    ok('A10 bulk dry run -> 3 rows, each Not started -> Sent, first touch this week, 0 writes', r.status === 200 && r.body.preview.length === 3 && r.body.preview.every(p => p.to_status === 'first_email_sent' && p.first_touch && p.week_start === WEEK && !p.error) && (await svc.from('sales_partner_events').select('*', { count: 'exact', head: true }).eq('business_id', B)).count === 11);

    // ── Part B: browser ──
    browser = await chromium.launch();
    const J = await newPage(jack, 1440, 1000); const P = J.page;
    await navPartners(P, false);
    ok('B1 row shows 👤 3', (await row(P, JW.id).getByLabel('3 people known').count()) === 1);
    await openRow(P, JW.id);
    const dd = row(P, JW.id);
    const regions = await Promise.all(['Status and next step', 'People', 'Activity', 'Tasks', 'Intel'].map(n => dd.getByRole('region', { name: n }).count()));
    ok('B2 drop-down has the 5 sections in order', regions.every(c => c === 1), regions.join(','));
    const statusText = await dd.getByRole('region', { name: 'Status and next step' }).innerText();
    // The seeded move to Replied is dated today, so it is the latest contact; the Oct 2 call shows in People + Activity.
    ok('B3 Status: Replied · Last touch: Replied · <today> · Jack · today · Next: Meeting booked', /^Replied/.test(statusText) && new RegExp(`Last touch: Replied · ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · Jack`).test(statusText) && /\btoday\b/.test(statusText) && /Next: Meeting booked/.test(statusText), statusText.replace(/\n/g, ' | ').slice(0, 200));
    ok('B4 row\'s own Next/More moved down while open (one Next on screen for this partner)', (await dd.getByRole('button', { name: /^Next: / }).count()) === 1 && (await dd.getByRole('button', { name: /More actions/ }).count()) === 1);
    const people = await dd.getByRole('list', { name: 'People at this partner' }).getByRole('listitem').allInnerTexts();
    ok('B5 People: Jane Doe (Logged · Called Oct 2), Pat Lee (sheet spelling + note, Logged · Called Oct 2), Dana Kim (Apollo) = 3 rows', people.length === 3 && people.some(t => /Jane Doe/.test(t) && /logged/i.test(t) && /Called Oct 2/.test(t)) && people.some(t => /Pat Lee/.test(t) && /intro/.test(t) && /logged/i.test(t) && /Called Oct 2/.test(t)) && people.some(t => /Dana Kim/.test(t) && /apollo/i.test(t)), people.join(' || ').replace(/\n/g, ' '));
    const shownBefore = await dd.getByRole('list', { name: 'Activity timeline' }).getByRole('listitem').count();
    const showAll = dd.getByRole('button', { name: 'Show all activity (8)' });
    ok('B6 Activity shows the 3 real rows; the 8 try-out rows sit behind "Show all activity (8)"', shownBefore === 3 && (await showAll.count()) === 1, `${shownBefore} shown`);
    await showAll.click();
    ok('B7 Show all -> 11 rows, undone ones struck through', (await dd.getByRole('list', { name: 'Activity timeline' }).getByRole('listitem').count()) === 11 && (await dd.locator('li span[style*="line-through"]').count()) >= 2);
    ok('B8 Intel collapsed with a one-line preview', (await dd.getByRole('button', { name: /^Intel/ }).getAttribute('aria-expanded')) === 'false' && /Payroll partner for renters/.test(await dd.getByRole('button', { name: /^Intel/ }).innerText()));
    await P.screenshot({ path: `${OUT}/p360-1440-open.png`, fullPage: false });
    // Log a meeting today with Dana -> Replied -> Meeting; People + Activity update
    await dd.getByRole('button', { name: 'Log touch' }).click();
    const form = dd.getByRole('form', { name: /Log a touch on/ });
    await form.getByLabel('Type').selectOption('meeting');
    await form.getByRole('button', { name: 'Dana Kim' }).click();
    await form.getByLabel('Note').fill('Demo meeting');
    ok('B9 form says Auto · → Meeting before sending', (await form.getByRole('radio', { name: /Auto/ }).innerText()).includes('→ Meeting'));
    await form.getByRole('button', { name: 'Log touch' }).click(); await P.waitForTimeout(2500);
    const jwRow = (await svc.from('sales_goals').select('pipeline_status,last_touch_at').eq('id', JW.id).single()).data;
    const act = await dd.getByRole('list', { name: 'Activity timeline' }).getByRole('listitem').first().innerText();
    ok('B10 meeting logged: DB stage meeting_set, toast with Undo, top activity row "Met with Dana Kim → Meeting · Demo meeting"', jwRow.pipeline_status === 'meeting_set' && (await P.getByRole('button', { name: 'Undo' }).count()) === 1 && /Met with Dana Kim → Meeting/.test(act) && /Demo meeting/.test(act), act.replace(/\n/g, ' | '));
    ok('B11 People: Dana now "Met" today', /Met/.test((await dd.getByRole('list', { name: 'People at this partner' }).innerText())));
    await P.screenshot({ path: `${OUT}/p360-1440-logged.png` });
    // + Add person from the UI
    await dd.getByRole('button', { name: '+ Add person' }).click();
    const add = dd.getByRole('form', { name: 'Add person' });
    await add.getByLabel('Name').fill('Riley Ng'); await add.getByLabel('Title').fill('Director'); await add.getByRole('button', { name: 'Add' }).click(); await P.waitForTimeout(1500);
    ok('B12 + Add person -> row in People (Added badge) and 👤 4 on the row', (await dd.getByRole('list', { name: 'People at this partner' }).innerText()).includes('Riley Ng') && (await row(P, JW.id).getByLabel('4 people known').count()) === 1);
    // + Task prefilled with the partner link
    await dd.getByLabel(/New task for/).fill('Send the demo deck'); await dd.getByRole('button', { name: 'Add task' }).click(); await P.waitForTimeout(2500);
    const task = (await svc.from('sales_week_goals').select('text,link_type,link_id,week_start,kind').eq('business_id', B).maybeSingle()).data;
    ok('B13 + Task -> this-week to-do linked to the partner; shows under Tasks', task && task.link_type === 'partner' && task.link_id === JW.id && task.week_start === WEEK && task.kind === 'todo' && (await dd.getByRole('region', { name: 'Tasks' }).innerText()).includes('1 task'), JSON.stringify(task));
    // Bulk catch-up of 3 (Alpha, Bravo, Charlie; "Nobody" unmatched; Delta untouched)
    await P.getByRole('button', { name: '＋ Log touches' }).click();
    const bulk = P.getByRole('region', { name: 'Log touches for several partners' });
    await bulk.getByLabel('Partner names, one per line').fill('Alpha Test\nbravo test\nCharlie\nNobody Inc');
    await bulk.getByRole('button', { name: 'Preview' }).click(); await P.waitForTimeout(2000);
    const rows = await bulk.getByRole('table', { name: 'Touches to log' }).locator('tbody tr').allInnerTexts();
    ok('B14 bulk preview: 3 rows Not started → Sent this week, Nobody Inc reported unmatched, Apply 3', rows.length === 3 && rows.every(t => /Not started → Sent/.test(t) && /first/.test(t)) && (await bulk.innerText()).includes('Nobody Inc (no partner with that name)') && (await bulk.getByRole('button', { name: 'Apply 3' }).count()) === 1, rows.join(' || ').replace(/\n/g, ' '));
    const evBefore = (await svc.from('sales_partner_events').select('*', { count: 'exact', head: true }).eq('business_id', B)).count;
    await bulk.getByRole('button', { name: 'Apply 3' }).click(); await P.waitForTimeout(3000);
    const evAfter = (await svc.from('sales_partner_events').select('*', { count: 'exact', head: true }).eq('business_id', B)).count;
    const stages = (await svc.from('sales_goals').select('name,pipeline_status').eq('business_id', B).in('id', [A.id, Bv.id, C.id, Dl.id])).data;
    ok('B15 Apply -> exactly 3 events, Alpha/Bravo/Charlie at Sent, Delta untouched, toast "Logged 3 touches" without Undo', evAfter - evBefore === 3 && stages.filter(s => s.pipeline_status === 'first_email_sent').length === 3 && stages.find(s => s.name === 'Delta Test').pipeline_status === 'first_email_drafted' && (await P.getByText('Logged 3 touches').count()) === 1 && (await P.getByRole('button', { name: 'Undo' }).count()) === 0, JSON.stringify(stages));
    ok('B16 Jack 1440: 0 console errors', J.errs.length === 0, J.errs.join(' | '));

    // Viewer
    const V = await newPage(vera, 1440, 1000);
    await navPartners(V.page, false); await openRow(V.page, JW.id);
    const vdd = row(V.page, JW.id);
    const vText = await vdd.innerText();
    ok('B17 viewer sees all 5 sections, People + Activity filled, no Log touch / Add person / Add task / Next / Remove / Log touches', /Riley Ng/.test(vText) && /Met with Dana Kim/.test(vText)
      && (await vdd.getByRole('button', { name: /Log touch|Add person|Add task|^Next:|Remove|More actions/ }).count()) === 0 && (await V.page.getByRole('button', { name: '＋ Log touches' }).count()) === 0);
    ok('B18 viewer: 0 console errors', V.errs.length === 0, V.errs.join(' | '));

    // 390
    const M = await newPage(jack, 390, 844);
    await navPartners(M.page, true); await openRow(M.page, JW.id);
    const wide = await M.page.evaluate(() => document.documentElement.scrollWidth);
    ok('B19 390: drop-down open, no sideways scroll', (await row(M.page, JW.id).getByRole('region', { name: 'People' }).count()) === 1 && wide <= 390, `scrollWidth ${wide}`);
    await M.page.screenshot({ path: `${OUT}/p360-390-open.png`, fullPage: true });
    ok('B20 390: 0 console errors', M.errs.length === 0, M.errs.join(' | '));
  } catch (e) {
    console.log('ERROR', e.stack || e.message);
  } finally {
    await cleanup();
    const after = await snap(), hlAfter = await hlSnap();
    const same = JSON.stringify(after) === JSON.stringify(before);
    console.log(`\n${pass}/${total} passed · screenshots in ${OUT}`);
    if (!same) console.log('counts before', before, 'after', after);
    console.log(`HomeLover untouched: ${hlAfter === hlBefore ? 'yes' : 'NO'}`);
    console.log(`restored: ${same && hlAfter === hlBefore ? 'yes' : 'NO'}`);
    process.exit(pass === total && same ? 0 : 1);
  }
})();
