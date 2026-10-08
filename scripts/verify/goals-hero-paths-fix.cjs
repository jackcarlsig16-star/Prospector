// FIX goals-hero-paths check. TEMP workspace only (2 temp members Jack + Cyrus; 3 temp partners + touches, 3 sequenced-account rows, 2 mailbox-owner rows, 1 goal row - all deleted). HomeLover untouched (counts snapshotted). Part A = API: the Goals path (GET /scorecard) and the Overview path (GET /hero) equal a hand count made from raw rows for audience and first-touched, Team and Jack; carried goal on the scorecard week. Part B = browser 1440: Goals with ?owner=jack says "Goals · Jack" with Jack's numbers and the carried cell; Overview says team numbers; 0 console errors. 0 AI / 0 Apollo. ~1 min, cap 4 min. Serves build/ via server.js - run npm run build first. Usage: node <this> <outdir>
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3959, tag = 'ghp-' + Date.now(), OUT = process.argv[2] || '/tmp';
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HL = 'bc69beab-effd-452d-9e81-fd652333bb95';
const WATCH = ['businesses', 'business_members', 'sales_goals', 'sales_partner_events', 'partner_contacts', 'sales_metric_targets', 'sales_sequenced_accounts', 'sales_mailbox_owners', 'profiles', 'auth_events'];
const made = { users: [], biz: [] };
let srv, browser, pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const snap = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true })).count; return o; };
const hlSnap = async () => { const o = {}; for (const t of ['sales_goals', 'sales_partner_events', 'partner_contacts', 'sales_metric_targets', 'sales_sequenced_accounts']) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL)).count; return JSON.stringify(o); };
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('ABORT (4 min cap)'); cleanup().then(() => process.exit(2)); }, 240000);
async function cleanup() {
  if (browser) await browser.close().catch(() => {});
  if (srv) srv.kill();
  for (const b of made.biz) {
    for (const t of ['sales_sequenced_accounts', 'sales_mailbox_owners', 'sales_week_report', 'sales_metric_targets', 'partner_contacts', 'sales_partner_events', 'sales_week_goals', 'sales_goals', 'business_members', 'auth_events']) await svc.from(t).delete().eq('business_id', b);
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
  return { id: u.user.id, email, session: s.session, cookie: `prospector_at=${encodeURIComponent(s.session.access_token)}` };
}
async function newPage(u, width, height, query = '') {
  const errs = [];
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage(); page.setDefaultTimeout(8000);
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); }); page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
  await page.addInitScript(([k, v]) => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(u.session)]);
  await page.goto(`http://localhost:${PORT}/${query}`); await page.waitForTimeout(3000);
  return { page, errs };
}
let bizLabel = '';
async function navGoals(page) {
  await page.getByLabel('Workspace').selectOption({ label: bizLabel }); await page.waitForTimeout(1500);
  await page.locator('#root').getByRole('button', { name: 'Goals & Sales', exact: true }).click(); await page.waitForTimeout(3500);
  await page.locator('[data-hero-card]').first().waitFor();
}
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const addDays = (v, n) => new Date(Date.parse(`${v}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const monday = d => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
const monthOf = d => `${d.slice(0, 7)}-01`;
const WEEK = monday(today), LAST = addDays(WEEK, -7);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const before = await snap(), hlBefore = await hlSnap();
  try {
    const B = await biz('ghp');
    bizLabel = (await svc.from('businesses').select('name').eq('id', B).single()).data.name;
    const jack = await user(B, 'Jack', 'member'), cy = await user(B, 'Cyrus', 'member');
    ins(await svc.from('sales_mailbox_owners').insert([{ business_id: B, mailbox_email: jack.email, user_id: jack.id }, { business_id: B, mailbox_email: cy.email, user_id: cy.id }]).select());
    const seq = (i, mailbox, employees) => ({ business_id: B, account_id: `${tag}-a${i}`, name: `Co ${i}`, first_sequenced_at: `${WEEK}T15:00:00Z`, week_start: WEEK, mailbox_email: mailbox, employees });
    ins(await svc.from('sales_sequenced_accounts').insert([seq(1, jack.email, 1000), seq(2, jack.email, 140), seq(3, cy.email, 50000)]).select());
    const partner = async (name, owner) => ins(await svc.from('sales_goals').insert({ business_id: B, goal_type: 'partnership', name: `${name} ${tag.slice(-4)}`, pipeline_status: 'not_started', owner_user_id: owner }).select().single());
    const [alpha, bravo, charlie] = await Promise.all([partner('Alpha', jack.id), partner('Bravo', cy.id), partner('Charlie', null)]);
    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await wait(500); } }
    const call = (u, method, path, body) => fetch(`http://localhost:${PORT}/api/sales/${B}/goals${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: u.cookie }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
    const touch = (p, contacts) => call(jack, 'POST', `/partners/${p.id}/signal`, { type: 'touch', touch_type: 'email', date: today, contacts });
    await touch(alpha, ['Lisa Park', 'Ken']); await touch(bravo, ['Pat Lee']); await touch(charlie, ['Dana Kim']);
    await call(jack, 'PUT', '/targets', { period: 'week', period_start: LAST, metric_key: 'partners_first_touched', goal: 10, unit: 'people' });

    // Hand count straight from the rows (no app code)
    const { data: rows } = await svc.from('sales_sequenced_accounts').select('employees, mailbox_email').eq('business_id', B).eq('week_start', WEEK);
    const { data: ev } = await svc.from('sales_partner_events').select('goal_id, event, touch_type, contact_names, at').eq('business_id', B);
    const { data: goals } = await svc.from('sales_goals').select('id, owner_user_id').eq('business_id', B);
    const ownerOf = new Map(goals.map(g => [g.id, g.owner_user_id]));
    const hand = owner => {
      const mine = r => !owner || r.mailbox_email === jack.email;
      const audience = rows.filter(mine).reduce((n, r) => n + r.employees, 0);
      const mineGoal = g => !owner || ownerOf.get(g) === owner;
      const partners = new Set(ev.filter(e => e.event === 'touch' && e.touch_type === 'email' && mineGoal(e.goal_id)).map(e => e.goal_id)).size;
      const people = new Set(ev.filter(e => e.event === 'touch' && mineGoal(e.goal_id)).flatMap(e => e.contact_names.map(n => `${e.goal_id}|${n.toLowerCase()}`))).size;
      return { audience, partners, people };
    };
    const H = { team: hand(null), jack: hand(jack.id) };
    ok('hand count: team audience 51,140 / 3 partners / 4 people; Jack 1,140 / 1 / 2', H.team.audience === 51140 && H.team.partners === 3 && H.team.people === 4 && H.jack.audience === 1140 && H.jack.partners === 1 && H.jack.people === 2, JSON.stringify(H));

    // Part A: both paths
    for (const [label, owner] of [['team', null], ['Jack', jack.id]]) {
      const h = H[label === 'team' ? 'team' : 'jack'];
      const sc = (await call(jack, 'GET', `/scorecard?month=${monthOf(WEEK)}${owner ? `&owner=${owner}` : ''}`)).body;
      const he = (await call(jack, 'GET', `/hero?week_start=${WEEK}${owner ? `&owner=${owner}` : ''}`)).body;
      const pick = s => { const m = s.weeks.find(w => w.week_start === WEEK).metrics; return { audience: s.month_total.outbound_audience.value, partners: m.partners_first_touched.value, people: m.people_first_touched.value }; };
      const a = pick(sc), b = pick(he.scorecard);
      ok(`A ${label}: Goals path (GET /scorecard) = Overview path (GET /hero) = hand count`, JSON.stringify(a) === JSON.stringify(h) && JSON.stringify(b) === JSON.stringify(h) && he.first_touched.goal === 10 && he.first_touched.carried === true, `scorecard ${JSON.stringify(a)} hero ${JSON.stringify(b)} hand ${JSON.stringify(h)}`);
      if (!owner) ok('A carried: scorecard week carries carried_goal 10 with goal null, unit people', sc.weeks.find(w => w.week_start === WEEK).metrics.partners_first_touched.goal === null && sc.weeks.find(w => w.week_start === WEEK).metrics.partners_first_touched.carried_goal === 10 && sc.weeks.find(w => w.week_start === WEEK).metrics.partners_first_touched.unit === 'people');
    }

    // Part B: browser
    browser = await chromium.launch();
    const J = await newPage(jack, 1440, 1000, '?owner=jack'); const P = J.page;
    await navGoals(P);
    const num = async name => (await P.getByRole('region', { name }).locator('[data-part="number"]').innerText());
    ok('B1 Goals with ?owner=jack: header "Goals · Jack", Audience 1,140, People first-touched 2', (await P.getByText('Goals · Jack').count()) === 1 && (await num('Audience reached')) === '1,140' && (await num('People first-touched')) === '2', `${await num('Audience reached')} ${await num('People first-touched')}`);
    await P.screenshot({ path: `${OUT}/ghp-1440-goals-jack.png` });
    await P.getByRole('button', { name: /^This week/ }).first().click(); await P.waitForTimeout(2500);
    const cell = (await P.locator('#score-row-partners_first_touched').getByRole('cell').nth(1).innerText()).replace(/\n+/g, ' | ');
    ok('B2 scorecard cell for the carried week: "of 10 · carried" (no "set goal"), 20%', /of 10 · carried/.test(cell) && !/set goal/.test(cell) && /20%/.test(cell), cell);
    await P.locator('#score-row-partners_first_touched').scrollIntoViewIfNeeded(); await P.screenshot({ path: `${OUT}/ghp-1440-scorecard-carried.png` });
    await P.getByRole('button', { name: 'Overview', exact: true }).click(); await P.waitForTimeout(3500); await P.locator('[data-hero-card]').first().waitFor();
    ok('B3 Overview hero: header "Goals" (team), Audience 51K (51,140 short-formatted), People first-touched 4', (await P.getByText('Goals · Jack').count()) === 0 && (await num('Audience reached')) === '51K' && (await num('People first-touched')) === '4', `${await num('Audience reached')} ${await num('People first-touched')}`);
    await P.screenshot({ path: `${OUT}/ghp-1440-overview.png` });
    ok('B4 1440: 0 console errors', J.errs.length === 0, J.errs.join(' | '));
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
    process.exit(0);
  }
})();
