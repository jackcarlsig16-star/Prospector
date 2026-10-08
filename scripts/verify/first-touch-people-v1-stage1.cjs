// first-touch-people-v1 Stage 1 check. TEMP workspace only (3 temp users: Jack + Cyrus members, Vera viewer; 3 temp partners, their events, 1 fake partner_contacts row, their goal rows - all deleted). HomeLover untouched (counts snapshotted). Part A = API: people vs partners per week, same person twice, Apollo sequence start, owner filter, unit validation, carried goal. Part B = real browser (Playwright): the card at 1440 + 390, drill list, unit toggle, viewer, 0 console errors. 0 AI / 0 Apollo calls. ~1.5 min, cap 4 min. Serves build/ via server.js - run npm run build first. Usage: node <this> <outdir>
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3957, tag = 'ftp-' + Date.now(), OUT = process.argv[2] || '/tmp';
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HL = 'bc69beab-effd-452d-9e81-fd652333bb95';
const WATCH = ['businesses', 'business_members', 'sales_goals', 'sales_partner_events', 'partner_contacts', 'sales_metric_targets', 'profiles', 'auth_events'];
const made = { users: [], biz: [] };
let srv, browser, pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const snap = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true })).count; return o; };
const hlSnap = async () => { const o = {}; for (const t of ['sales_goals', 'sales_partner_events', 'partner_contacts', 'sales_metric_targets']) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL)).count; return JSON.stringify(o); };
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('ABORT (4 min cap)'); cleanup().then(() => process.exit(2)); }, 240000);
async function cleanup() {
  if (browser) await browser.close().catch(() => {});
  if (srv) srv.kill();
  for (const b of made.biz) {
    for (const t of ['sales_metric_targets', 'partner_contacts', 'sales_partner_events', 'sales_week_goals', 'sales_goals', 'business_members', 'auth_events']) await svc.from(t).delete().eq('business_id', b);
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
async function navGoals(page, compact) {
  try {
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').selectOption({ label: bizLabel }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Goals & Sales', exact: true }).click(); await page.waitForTimeout(3500);
    await page.locator('[data-hero-card]').first().waitFor();
  } catch (e) {
    await page.screenshot({ path: `${OUT}/ftp-nav-fail-${compact ? 390 : 1440}.png`, fullPage: true }).catch(() => {});
    console.log('NAV TEXT:', (await page.locator('#root').innerText().catch(() => '')).replace(/\n+/g, ' | ').slice(0, 600));
    throw e;
  }
}
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const addDays = (v, n) => new Date(Date.parse(`${v}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const monday = d => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
const WEEK = monday(today), LAST = addDays(WEEK, -7);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const before = await snap(), hlBefore = await hlSnap();
  try {
    const B = await biz('ftp');
    bizLabel = (await svc.from('businesses').select('name').eq('id', B).single()).data.name;
    const jack = await user(B, 'Jack', 'member'), cy = await user(B, 'Cyrus', 'member'), vera = await user(B, 'Vera', 'viewer');
    const partner = async (name, owner) => ins(await svc.from('sales_goals').insert({ business_id: B, goal_type: 'partnership', name: `${name} ${tag.slice(-4)}`, pipeline_status: 'not_started', owner_user_id: owner }).select().single());
    const [alpha, bravo, charlie] = await Promise.all([partner('Alpha', jack.id), partner('Bravo', cy.id), partner('Charlie', jack.id)]);
    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await wait(500); } }
    const call = (u, method, path, body) => fetch(`http://localhost:${PORT}/api/sales/${B}/goals${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: u.cookie }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
    const hero = async (w, owner) => (await call(jack, 'GET', `/hero?week_start=${w}${owner ? `&owner=${owner}` : ''}`)).body;
    const weekOf = (h, w) => [...(h.earlier || []), ...((h.scorecard && h.scorecard.weeks) || [])].find(x => x.week_start === w)?.metrics;
    const touch = (u, p, date, contacts) => call(u, 'POST', `/partners/${p.id}/signal`, { type: 'touch', touch_type: 'email', date, contacts });

    // ── Part A: API ──
    let r = await touch(jack, alpha, '2026-09-30', ['Lisa Park', 'Ken']);
    let h = await hero('2026-09-28'), m = weekOf(h, '2026-09-28');
    ok('A1 2 people on one partner Sep 30 -> week of Sep 28: people 2, partners 1; list = Ken, Lisa Park (Logged)', r.status === 200 && m?.people_first_touched.value === 2 && m?.partners_first_touched.value === 1
      && JSON.stringify(h.first_touched.people.map(p => [p.name, p.partner.split(' ')[0], p.source])) === JSON.stringify([['Ken', 'Alpha', 'logged'], ['Lisa Park', 'Alpha', 'logged']]), `${r.status} ${JSON.stringify(m)} ${JSON.stringify(h.first_touched?.people)}`);
    r = await touch(jack, alpha, '2026-10-01', ['lisa park']);
    h = await hero('2026-09-28'); m = weekOf(h, '2026-09-28');
    const hOct = await hero('2026-10-05');
    ok('A2 the same person again Oct 1 -> still 2 people / 1 partner, nothing in the week of Oct 5', r.status === 200 && m?.people_first_touched.value === 2 && m?.partners_first_touched.value === 1 && weekOf(hOct, '2026-10-05')?.people_first_touched.value === 0 && hOct.first_touched.people.length === 0, JSON.stringify(m));
    ins(await svc.from('partner_contacts').insert({ business_id: B, goal_id: bravo.id, name: 'Seq Person', source: 'apollo', apollo_contact_id: `${tag}-c1`, sequence_added_at: '2026-08-27T15:00:00Z', sequence_status: 'active' }).select());
    h = await hero('2026-08-24'); m = weekOf(h, '2026-08-24');
    ok('A3 Apollo sequence start Aug 27 -> week of Aug 24: 1 person (Apollo), 0 partners', m?.people_first_touched.value === 1 && m?.partners_first_touched.value === 0 && h.first_touched.people.length === 1 && h.first_touched.people[0].name === 'Seq Person' && h.first_touched.people[0].source === 'apollo', JSON.stringify(m));
    const hj = await hero('2026-09-28', jack.id), hc = await hero('2026-09-28', cy.id);
    ok('A4 owner filter follows the partner: Jack 2 people, Cyrus 0', weekOf(hj, '2026-09-28')?.people_first_touched.value === 2 && hj.first_touched.people.length === 2 && weekOf(hc, '2026-09-28')?.people_first_touched.value === 0 && hc.first_touched.people.length === 0);
    ok('A5 no goal row anywhere -> unit people, goal null, not carried', h.first_touched.unit === 'people' && h.first_touched.goal === null && h.first_touched.carried === false, JSON.stringify(h.first_touched));
    const r1 = await call(jack, 'PUT', '/targets', { period: 'week', period_start: WEEK, metric_key: 'meetings_set', goal: 3, unit: 'people' });
    const r2 = await call(jack, 'PUT', '/targets', { period: 'week', period_start: WEEK, metric_key: 'partners_first_touched', goal: 10, unit: 'cats' });
    const r3 = await call(vera, 'PUT', '/targets', { period: 'week', period_start: WEEK, metric_key: 'partners_first_touched', goal: 10, unit: 'people' });
    ok('A6 unit refused on another metric (400), bad unit (400), viewer (403); no rows written', r1.status === 400 && r2.status === 400 && r3.status === 403 && (await svc.from('sales_metric_targets').select('*', { count: 'exact', head: true }).eq('business_id', B)).count === 0, `${r1.status} ${r2.status} ${r3.status}`);
    r = await call(jack, 'PUT', '/targets', { period: 'week', period_start: LAST, metric_key: 'partners_first_touched', goal: 10, unit: 'people' });
    const hThis = await hero(WEEK), hLast = await hero(LAST);
    ok('A7 goal 10 people on last week only -> this week shows it carried; last week not carried', r.status === 200 && r.body.target?.unit === 'people' && hThis.first_touched.goal === 10 && hThis.first_touched.unit === 'people' && hThis.first_touched.carried === true && hLast.first_touched.carried === false, JSON.stringify([hThis.first_touched, hLast.first_touched].map(f => ({ ...f, people: f.people.length }))));
    await touch(jack, alpha, today, ['Dana Kim', 'Sam Lee']); await touch(jack, charlie, today, ['Pat Lee']);
    h = await hero(WEEK); m = weekOf(h, WEEK);
    // Alpha was first-touched Sep 30, so only Charlie is a new partner this week
    ok('A8 this week: 3 people / 1 partner (Dana Kim, Sam Lee at Alpha; Pat Lee at Charlie)', m?.people_first_touched.value === 3 && m?.partners_first_touched.value === 1 && h.first_touched.people.length === 3, JSON.stringify(m));
    const rep = (await call(jack, 'GET', `/report?week_start=${WEEK}`)).body;
    ok('A9 weekly report partner block carries people_first_touched too (3)', rep.partners?.metrics?.people_first_touched?.value === 3, JSON.stringify(rep.partners?.metrics));

    // ── Part B: browser ──
    browser = await chromium.launch();
    const J = await newPage(jack, 1440, 1000); const P = J.page;
    await navGoals(P, false);
    const card = P.getByRole('region', { name: 'People first-touched' });
    const sub = async () => (await card.locator('[data-part="goal"]').innerText()).replace(/\n/g, ' ');
    ok('B1 card "People first-touched": 3, ring 30%, sub-line "of 10 people · 1 partner · … · carried"', (await card.count()) === 1 && (await card.locator('[data-part="number"]').innerText()) === '3' && /of 10 people · 1 partner · week \d · \w+ \d+ · carried/.test(await sub()) && (await card.getByRole('img', { name: /to goal: Reached 300, Left 700/ }).count()) === 1, await sub());
    await P.screenshot({ path: `${OUT}/ftp-1440-card.png` });
    await card.locator('[data-part="number"]').click(); await P.waitForTimeout(500);
    const dlg = P.getByRole('dialog', { name: 'People first-touched' });
    const rows = await dlg.getByRole('listitem').allInnerTexts();
    ok('B2 drill list: 3 rows, name · partner · date · Logged', rows.length === 3 && rows.every(t => /logged/i.test(t)) && /Dana Kim/.test(rows.join()) && /Sam Lee/.test(rows.join()) && /Pat Lee/.test(rows.join()), rows.join(' | ').replace(/\n/g, ' '));
    await P.screenshot({ path: `${OUT}/ftp-1440-drill.png` });
    await P.keyboard.press('Escape'); await P.waitForTimeout(300);
    ok('B3 Escape closes the list', (await P.getByRole('dialog').count()) === 0);
    await card.getByRole('group', { name: 'Count for People first-touched' }).getByRole('button', { name: 'Partners' }).click(); await P.waitForTimeout(3000);
    const pcard = P.getByRole('region', { name: 'Partners first-touched' });
    const psub = (await pcard.locator('[data-part="goal"]').innerText()).replace(/\n/g, ' ');
    const rowNow = (await svc.from('sales_metric_targets').select('goal, unit').eq('business_id', B).eq('period_start', WEEK).eq('metric_key', 'partners_first_touched').maybeSingle()).data;
    ok('B4 toggle -> "Partners first-touched": 1 of 10 partners · 3 people, no longer carried; DB row for this week unit partners goal 10', (await pcard.count()) === 1 && (await P.getByRole('region', { name: 'People first-touched' }).count()) === 0 && (await pcard.locator('[data-part="number"]').innerText()) === '1' && /^of 10 partners · 3 people · week \d · \w+ \d+$/.test(psub) && rowNow?.unit === 'partners' && Number(rowNow?.goal) === 10, `${psub} ${JSON.stringify(rowNow)}`);
    await pcard.getByRole('group', { name: 'Count for Partners first-touched' }).getByRole('button', { name: 'People' }).click(); await P.waitForTimeout(3000);
    ok('B5 toggle back -> People first-touched, DB unit people', (await P.getByRole('region', { name: 'People first-touched' }).count()) === 1 && (await svc.from('sales_metric_targets').select('unit').eq('business_id', B).eq('period_start', WEEK).eq('metric_key', 'partners_first_touched').single()).data.unit === 'people');
    ok('B6 Jack 1440: 0 console errors', J.errs.length === 0, J.errs.join(' | '));
    const V = await newPage(vera, 1440, 1000);
    await navGoals(V.page, false);
    const vcard = V.page.getByRole('region', { name: 'People first-touched' });
    ok('B7 viewer: card with number + sub-line, no unit toggle, no Set goal', (await vcard.count()) === 1 && (await vcard.locator('[data-part="number"]').innerText()) === '3' && (await vcard.getByRole('group').count()) === 0 && (await vcard.getByRole('button', { name: 'Set goal' }).count()) === 0);
    ok('B8 viewer: 0 console errors', V.errs.length === 0, V.errs.join(' | '));
    const M = await newPage(jack, 390, 844);
    await navGoals(M.page, true);
    const mcard = M.page.getByRole('region', { name: 'People first-touched' });
    const wide = await M.page.evaluate(() => document.documentElement.scrollWidth);
    ok('B9 390: card present, no sideways scroll', (await mcard.count()) === 1 && wide <= 390, `scrollWidth ${wide}`);
    await mcard.scrollIntoViewIfNeeded(); await M.page.screenshot({ path: `${OUT}/ftp-390-card.png` });
    await mcard.locator('[data-part="number"]').click(); await M.page.waitForTimeout(500);
    ok('B10 390: drill list opens with 3 rows', (await M.page.getByRole('dialog', { name: 'People first-touched' }).getByRole('listitem').count()) === 3);
    await M.page.screenshot({ path: `${OUT}/ftp-390-drill.png` });
    ok('B11 390: 0 console errors', M.errs.length === 0, M.errs.join(' | '));
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
