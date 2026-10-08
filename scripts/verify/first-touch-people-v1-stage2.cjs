// first-touch-people-v1 Stage 2 check. TEMP workspace only (2 temp users: Jack member, Vera viewer; 2 temp partners, their events, goal rows and week-report rows - all deleted). HomeLover untouched (counts snapshotted). Part C = API: report row + scorecard equal the hero card for this week and last week in the goal's unit; a week frozen BEFORE people existed gets people computed live and labeled; a finalize now freezes people + unit; partners stay frozen. Part D = browser (1440): scorecard row label + report chip follow the unit, 0 console errors. 0 AI / 0 Apollo calls. ~1 min, cap 4 min. Serves build/ via server.js - run npm run build first. Usage: node <this> <outdir>
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3958, tag = 'ftp2-' + Date.now(), OUT = process.argv[2] || '/tmp';
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HL = 'bc69beab-effd-452d-9e81-fd652333bb95';
const WATCH = ['businesses', 'business_members', 'sales_goals', 'sales_partner_events', 'partner_contacts', 'sales_metric_targets', 'sales_week_report', 'profiles', 'auth_events'];
const made = { users: [], biz: [] };
let srv, browser, pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const snap = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true })).count; return o; };
const hlSnap = async () => { const o = {}; for (const t of ['sales_goals', 'sales_partner_events', 'partner_contacts', 'sales_metric_targets', 'sales_week_report']) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL)).count; return JSON.stringify(o); };
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('ABORT (4 min cap)'); cleanup().then(() => process.exit(2)); }, 240000);
async function cleanup() {
  if (browser) await browser.close().catch(() => {});
  if (srv) srv.kill();
  for (const b of made.biz) {
    for (const t of ['sales_week_report', 'sales_metric_targets', 'partner_contacts', 'sales_partner_events', 'sales_week_goals', 'sales_goals', 'business_members', 'auth_events']) await svc.from(t).delete().eq('business_id', b);
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
async function navGoals(page) {
  try {
    await page.getByLabel('Workspace').selectOption({ label: bizLabel }); await page.waitForTimeout(1500);
    await page.locator('#root').getByRole('button', { name: 'Goals & Sales', exact: true }).click(); await page.waitForTimeout(3500);
    await page.locator('[data-hero-card]').first().waitFor();
  } catch (e) {
    await page.screenshot({ path: `${OUT}/ftp2-nav-fail.png`, fullPage: true }).catch(() => {});
    console.log('NAV TEXT:', (await page.locator('#root').innerText().catch(() => '')).replace(/\n+/g, ' | ').slice(0, 600));
    throw e;
  }
}
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const addDays = (v, n) => new Date(Date.parse(`${v}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const monday = d => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
const monthOf = d => `${d.slice(0, 7)}-01`;
const WEEK = monday(today), LAST = addDays(WEEK, -7), LAST_WED = addDays(LAST, 2);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const before = await snap(), hlBefore = await hlSnap();
  try {
    const B = await biz('ftp2');
    bizLabel = (await svc.from('businesses').select('name').eq('id', B).single()).data.name;
    const jack = await user(B, 'Jack', 'member'), vera = await user(B, 'Vera', 'viewer');
    const partner = async name => ins(await svc.from('sales_goals').insert({ business_id: B, goal_type: 'partnership', name: `${name} ${tag.slice(-4)}`, pipeline_status: 'not_started', owner_user_id: jack.id }).select().single());
    const [alpha, charlie] = await Promise.all([partner('Alpha'), partner('Charlie')]);
    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await wait(500); } }
    const call = (u, method, path, body) => fetch(`http://localhost:${PORT}/api/sales/${B}/goals${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: u.cookie }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
    const touch = (p, date, contacts) => call(jack, 'POST', `/partners/${p.id}/signal`, { type: 'touch', touch_type: 'email', date, contacts });
    const hero = async w => (await call(jack, 'GET', `/hero?week_start=${w}`)).body;
    const scoreWeek = async w => (await call(jack, 'GET', `/scorecard?month=${monthOf(w)}`)).body.weeks.find(x => x.week_start === w).metrics;
    const report = async w => (await call(jack, 'GET', `/report?week_start=${w}`)).body;

    await touch(alpha, LAST_WED, ['Lisa Park', 'Ken']);
    await touch(charlie, today, ['Pat Lee']);
    let r = await call(jack, 'PUT', '/targets', { period: 'week', period_start: LAST, metric_key: 'partners_first_touched', goal: 10, unit: 'people' });
    ok('setup: goal 10 people on last week', r.status === 200 && r.body.target?.unit === 'people', String(r.status));

    // ── Part C: API ──
    const hL = await hero(LAST), sL = await scoreWeek(LAST), rL = await report(LAST);
    const cardL = [...(hL.earlier || []), ...((hL.scorecard && hL.scorecard.weeks) || [])].find(x => x.week_start === LAST).metrics.people_first_touched.value;
    ok('C1 last week: card 2 people = scorecard 2 = report 2; unit people on the scorecard week and the report block; partners 1 everywhere', hL.first_touched.unit === 'people' && cardL === 2 && sL.people_first_touched.value === 2 && sL.partners_first_touched.unit === 'people' && sL.partners_first_touched.goal === 10
      && rL.partners.metrics.people_first_touched.value === 2 && rL.partners.first_touched_unit === 'people' && sL.partners_first_touched.value === 1 && rL.partners.metrics.partners_first_touched.value === 1, `${cardL} ${JSON.stringify(sL.people_first_touched)} ${JSON.stringify(sL.partners_first_touched)} ${JSON.stringify(rL.partners.metrics.people_first_touched)} ${rL.partners.first_touched_unit}`);
    const hW = await hero(WEEK), sW = await scoreWeek(WEEK), rW = await report(WEEK);
    const cardW = [...(hW.earlier || []), ...((hW.scorecard && hW.scorecard.weeks) || [])].find(x => x.week_start === WEEK).metrics.people_first_touched.value;
    ok('C2 this week: card 1 = scorecard 1 = report 1; unit carried as people (no goal on the scorecard week, goal null)', hW.first_touched.carried === true && hW.first_touched.unit === 'people' && cardW === 1 && sW.people_first_touched.value === 1 && sW.partners_first_touched.unit === 'people' && sW.partners_first_touched.goal === null
      && rW.partners.metrics.people_first_touched.value === 1 && rW.partners.first_touched_unit === 'people', `${cardW} ${JSON.stringify(sW.partners_first_touched)} ${JSON.stringify(rW.partners)}`);
    // A week frozen before first-touch-people-v1: its block has no people count
    const now = new Date().toISOString();
    ins(await svc.from('sales_week_report').insert({ business_id: B, week_start: LAST, status: 'final', snapshot: { taken_at: now, partners: { metrics: { partners_first_touched: { value: 7 }, partner_meetings: { value: 0 } }, by_owner: {} } }, finalized_at: now, finalized_by: jack.id }).select());
    const rOld = await report(LAST);
    const dbOld = (await svc.from('sales_week_report').select('snapshot').eq('business_id', B).eq('week_start', LAST).single()).data.snapshot;
    ok('C3 old frozen week: people 2 computed live + labeled, unit people, partners stay frozen at 7, the stored snapshot untouched', rOld.report.status === 'final' && rOld.report.snapshot.partners.metrics.people_first_touched.value === 2 && rOld.report.snapshot.partners.metrics.people_first_touched.computed === true
      && rOld.report.snapshot.partners.first_touched_unit === 'people' && rOld.report.snapshot.partners.metrics.partners_first_touched.value === 7 && !dbOld.partners.metrics.people_first_touched && !dbOld.partners.first_touched_unit, JSON.stringify(rOld.report.snapshot?.partners));
    // Finalize now: people + unit go into the block; a later touch doesn't move the frozen number
    r = await call(jack, 'POST', `/report/${WEEK}/finalize`);
    const frozenW = r.body.report?.snapshot?.partners;
    await touch(alpha, today, ['Dana Kim']);
    const rW2 = await report(WEEK);
    ok('C4 finalize this week: block freezes people 1 + unit people (no computed flag); scorecard snapshot week carries the unit; a touch logged after -> frozen 1, live 2', r.status === 200 && frozenW?.metrics?.people_first_touched?.value === 1 && !('computed' in frozenW.metrics.people_first_touched) && frozenW.first_touched_unit === 'people'
      && r.body.report.snapshot.scorecard.weeks.find(x => x.week_start === WEEK)?.metrics.partners_first_touched.unit === 'people'
      && rW2.report.snapshot.partners.metrics.people_first_touched.value === 1 && rW2.partners.metrics.people_first_touched.value === 2, JSON.stringify(frozenW) + ' ' + JSON.stringify(rW2.partners?.metrics?.people_first_touched));
    r = await call(jack, 'POST', `/report/${WEEK}/reopen`);
    ok('C5 reopen -> draft', r.status === 200 && r.body.report?.status === 'draft', String(r.status));
    r = await call(vera, 'PUT', '/targets', { period: 'week', period_start: WEEK, metric_key: 'partners_first_touched', goal: 10, unit: 'partners' });
    ok('C6 viewer cannot change the unit (403)', r.status === 403, String(r.status));

    // ── Part D: browser (1440) ──
    browser = await chromium.launch();
    const J = await newPage(jack, 1440, 1000); const P = J.page;
    await navGoals(P);
    const chipsS4 = async () => (await P.locator('#goals-sec-s4').innerText()).replace(/\n+/g, ' | ');
    ok('D1 weekly report section 4 chip "people first-touched 2"', /people first-touched/.test(await chipsS4()) && !/partners first-touched/.test(await chipsS4()), (await chipsS4()).slice(0, 300));
    await P.getByRole('button', { name: /^This week/ }).first().click(); await P.waitForTimeout(2500);
    const rowText = async () => (await P.locator('#score-row-partners_first_touched').innerText()).replace(/\n+/g, ' | ');
    ok('D2 scorecard row reads "People first-touched", this week 2 of 10 (carried goal is display-only on the card: scorecard cell has no goal)', /People first-touched/.test(await rowText()) && /people emailed/.test(await rowText()), (await rowText()).slice(0, 300));
    await P.locator('#score-row-partners_first_touched').scrollIntoViewIfNeeded(); await P.screenshot({ path: `${OUT}/ftp2-1440-scorecard.png` });
    // Flip the unit through the API, reload the view: row + chip follow
    await call(jack, 'PUT', '/targets', { period: 'week', period_start: WEEK, metric_key: 'partners_first_touched', goal: 10, unit: 'partners' });
    await P.goto(`http://localhost:${PORT}/`); await P.waitForTimeout(3000); await navGoals(P);
    await P.getByRole('button', { name: /^This week/ }).first().click(); await P.waitForTimeout(2500);
    ok('D3 unit partners: scorecard row "Partners first-touched" with the partner count and "of 10"', /Partners first-touched/.test(await rowText()) && /of 10/.test(await rowText()), (await rowText()).slice(0, 300));
    await P.getByRole('button', { name: /^Weekly report/ }).first().click(); await P.waitForTimeout(2500);
    ok('D4 unit partners: report chip "partners first-touched"', /partners first-touched/.test(await chipsS4()), (await chipsS4()).slice(0, 300));
    ok('D5 1440: 0 console errors', J.errs.length === 0, J.errs.join(' | '));
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
