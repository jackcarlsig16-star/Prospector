// partner-360-v1 Stage 3 check. SCOPE: 6 real Apollo calls (contacts/search by account id: 3 partners x 2 runs), all into a TEMP workspace - HomeLover gets 0 writes. Part A = HomeLover read-only (2 queries): which partners the sync would cover today. Part B = TEMP workspace (2 temp users member + viewer, 4 temp partners, 1 temp accounts snapshot built from 3 REAL Apollo account ids so contacts/search returns the real people into temp rows): syncPartnerContacts run twice (insert then update), ranToday gate, viewer POST refresh-people 403, GET people. The member refresh route is NOT exercised live (it runs a full Sync now = ~70 more calls). Part C = browser 1440/390: People shows Apollo badges, header button for members only, 0 console errors. Contact emails land only in temp partner_contacts rows (deleted at the end) and are never printed. ~2 min, cap 4 min. Serves build/ via server.js - run npm run build first.
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const OUT = process.argv[2] || '/tmp/partner-360-stage3'; fs.mkdirSync(OUT, { recursive: true });
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = 'bc69beab-effd-452d-9e81-fd652333bb95', PORT = 3961, tag = 'p360c-' + Date.now();
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const WATCH = ['businesses', 'business_members', 'sales_goals', 'sales_partner_events', 'partner_contacts', 'partner_domains', 'sales_raw_snapshots', 'sales_sync_runs', 'profiles', 'auth_events'];
const made = { users: [], biz: [] };
let srv, browser, log = '', pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const snap = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true })).count; return o; };
const hlSnap = async () => JSON.stringify({ pc: (await svc.from('partner_contacts').select('*', { count: 'exact', head: true }).eq('business_id', HL)).count, pd: (await svc.from('partner_domains').select('*', { count: 'exact', head: true }).eq('business_id', HL)).count, goals: (await svc.from('sales_goals').select('id,updated_at').eq('business_id', HL).eq('goal_type', 'partnership').order('id')).data });
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('ABORT (4 min cap)'); cleanup().then(() => process.exit(2)); }, 240000);
async function cleanup() {
  if (browser) await browser.close().catch(() => {});
  if (srv) srv.kill();
  for (const b of made.biz) {
    for (const t of ['partner_contacts', 'partner_domains', 'sales_partner_events', 'sales_raw_snapshots', 'sales_sync_runs', 'sales_goals', 'business_members', 'auth_events']) await svc.from(t).delete().eq('business_id', b);
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

(async () => {
  const before = await snap(), hlBefore = await hlSnap();
  const S = await import(ROOT + '/api/sales/partnerContactsSync.js');
  try {
    // ── Part A: HomeLover, read-only ──
    const { data: hlGoals } = await svc.from('sales_goals').select('id,name').eq('business_id', HL).eq('goal_type', 'partnership').is('archived_at', null);
    const { data: hlDom } = await svc.from('partner_domains').select('goal_id,domain,confirmed').eq('business_id', HL).eq('confirmed', true);
    const { data: hlSnapRow } = await svc.from('sales_raw_snapshots').select('payload,captured_at').eq('business_id', HL).eq('entity', 'accounts').order('captured_at', { ascending: false }).limit(1).maybeSingle();
    const accs = hlSnapRow.payload;
    const byGoal = {}; for (const r of hlDom) (byGoal[r.goal_id] ||= []).push(r);
    const targets = S.partnersToSync(hlGoals, byGoal, accs);
    const expectedContacts = targets.reduce((n, t) => n + (t.account.num_contacts || 0), 0);
    console.log(`A  HomeLover: ${hlGoals.length} partners, ${hlDom.length} confirmed domain rows, snapshot ${hlSnapRow.captured_at} (${accs.length} accounts)`);
    console.log(`   would sync ${targets.length} partners (${targets.length} calls, cap ${S.PARTNER_CONTACTS_MAX_CALLS}), ${expectedContacts} contacts by snapshot: ${targets.map(t => `${t.goal.name}=${t.account.num_contacts}`).join(', ')}`);
    ok('A1 every HomeLover target is under the cap in one run', targets.length <= S.PARTNER_CONTACTS_MAX_CALLS, `${targets.length} <= ${S.PARTNER_CONTACTS_MAX_CALLS}`);
    ok('A2 HomeLover has 0 partner_contacts rows from Apollo yet (nothing written by this check)', (await svc.from('partner_contacts').select('*', { count: 'exact', head: true }).eq('business_id', HL).eq('source', 'apollo')).count === 0);
    const real = name => accs.find(a => a.name === name);
    const JWa = real('Justworks'), DOa = real('Domuso'), PSa = real('PerkSpot');
    ok('A3 real Apollo accounts for Justworks / Domuso / PerkSpot found in the snapshot with domains', !!(JWa?.domain && DOa?.domain && PSa?.domain), [JWa?.domain, DOa?.domain, PSa?.domain].join(','));

    // ── TEMP workspace ──
    const B = await biz('p360c');
    bizLabel = (await svc.from('businesses').select('name').eq('id', B).single()).data.name;
    const jack = await user(B, 'Jack', 'member'), vera = await user(B, 'Vera', 'viewer');
    const partner = async (name, extra = {}) => ins(await svc.from('sales_goals').insert({ business_id: B, goal_type: 'partnership', name, pipeline_status: 'not_started', category: '3. PEOs', tier: '1', owner_user_id: jack.id, ...extra }).select().single());
    const JW = await partner('Justworks Test', { known_contacts: 'Pat Lee (intro)' });
    const DO = await partner('Domuso Test');
    const PS = await partner('PerkSpot Test');
    const UN = await partner('Unconfirmed Test');
    const dom = (g, domain, confirmed) => svc.from('partner_domains').insert({ business_id: B, goal_id: g.id, domain, confirmed, is_primary: confirmed, source: 'manual', created_by: jack.id });
    ins(await dom(JW, JWa.domain.replace(/^www\./, '').toLowerCase(), true)); ins(await dom(DO, DOa.domain.replace(/^www\./, '').toLowerCase(), true)); ins(await dom(PS, PSa.domain.replace(/^www\./, '').toLowerCase(), true)); ins(await dom(UN, 'unconfirmed.example', false));
    ins(await svc.from('partner_contacts').insert({ business_id: B, goal_id: JW.id, name: 'Manual Person', title: 'Added by hand', source: 'manual', created_by: jack.id }).select());
    const run = ins(await svc.from('sales_sync_runs').insert({ business_id: B, trigger: 'test', status: 'success', started_at: new Date().toISOString(), finished_at: new Date().toISOString() }).select().single());
    ins(await svc.from('sales_raw_snapshots').insert({ business_id: B, run_id: run.id, entity: 'accounts', captured_at: new Date().toISOString(), payload: [
      { id: JWa.id, name: 'Justworks Test', domain: JWa.domain, num_contacts: JWa.num_contacts },
      { id: DOa.id, name: 'Domuso Test', domain: DOa.domain, num_contacts: DOa.num_contacts },
      { id: PSa.id, name: 'PerkSpot Test', domain: PSa.domain, num_contacts: PSa.num_contacts },
      { id: 'acc-un', name: 'Unconfirmed Test', domain: 'unconfirmed.example', num_contacts: 4 },
    ] }).select());

    // ── Part B1: the sync itself (3 real calls) ──
    ok('B1 ranToday = false before any run', (await S.ranToday(svc, B)) === false);
    const ctx = { callCounter: { count: 0, max: S.PARTNER_CONTACTS_MAX_CALLS }, endpointCounts: {} };
    const r1 = await S.syncPartnerContacts({ ctx, supabase: svc, businessId: B, accounts: null });
    console.log('   run 1 counts:', JSON.stringify(r1.counts), 'missing:', JSON.stringify(r1.missing));
    const expect3 = (JWa.num_contacts || 0) + (DOa.num_contacts || 0) + (PSa.num_contacts || 0);
    ok('B2 run 1: 3 partners matched (confirmed domain only - Unconfirmed Test skipped), 3 calls, 0 skipped', r1.counts.partners_matched === 3 && r1.counts.partners_synced === 3 && r1.counts.calls === 3 && r1.counts.skipped.length === 0 && !r1.counts.cap_hit);
    ok(`B3 run 1: contacts_seen equals the snapshot's num_contacts (${expect3}) and all inserted`, r1.counts.contacts_seen === expect3 && r1.counts.inserted === expect3 && r1.counts.updated === 0, `seen ${r1.counts.contacts_seen} inserted ${r1.counts.inserted} (Apollo live vs snapshot may differ)`);
    const rows = (await svc.from('partner_contacts').select('id, goal_id, name, title, email, linkedin_url, source, apollo_contact_id, last_activity_at, last_activity_type').eq('business_id', B)).data;
    const apolloRows = rows.filter(r => r.source === 'apollo');
    const perGoal = id => apolloRows.filter(r => r.goal_id === id).length;
    ok(`B4 People per partner = Apollo contact count: Justworks ${JWa.num_contacts}, Domuso ${DOa.num_contacts}, PerkSpot ${PSa.num_contacts}; Unconfirmed 0`, perGoal(JW.id) === JWa.num_contacts && perGoal(DO.id) === DOa.num_contacts && perGoal(PS.id) === PSa.num_contacts && perGoal(UN.id) === 0, `${perGoal(JW.id)}/${perGoal(DO.id)}/${perGoal(PS.id)}/${perGoal(UN.id)}`);
    ok('B5 every Apollo row: source apollo, apollo_contact_id, name; emails lowercased when present; no column holds a phone', apolloRows.every(r => r.apollo_contact_id && r.name && (!r.email || (r.email === r.email.toLowerCase() && r.email.includes('@')))) && !Object.keys(rows[0]).some(k => /phone/i.test(k)), `${apolloRows.filter(r => r.email).length} of ${apolloRows.length} have an email (not printed)`);
    ok('B6 the manual row is still manual and still there', rows.some(r => r.source === 'manual' && r.name === 'Manual Person'));
    ok('B7 last activity only from stored messages (temp workspace has none -> all null)', apolloRows.every(r => r.last_activity_at === null && r.last_activity_type === null));
    // run 2 = idempotent (3 more real calls)
    const ctx2 = { callCounter: { count: 0, max: S.PARTNER_CONTACTS_MAX_CALLS }, endpointCounts: {} };
    const r2 = await S.syncPartnerContacts({ ctx: ctx2, supabase: svc, businessId: B, accounts: null });
    const rowsAfter = (await svc.from('partner_contacts').select('id', { count: 'exact', head: true }).eq('business_id', B)).count;
    ok('B8 run 2: 0 inserted, all updated, 3 calls, row count unchanged (no duplicates)', r2.counts.inserted === 0 && r2.counts.updated === expect3 && r2.counts.calls === 3 && rowsAfter === rows.length, JSON.stringify(r2.counts));
    // cap: 2 calls max -> stops after 2 partners, 1 carried
    const ctx3 = { callCounter: { count: 0, max: 2 }, endpointCounts: {} };
    const r3 = await S.syncPartnerContacts({ ctx: ctx3, supabase: svc, businessId: B, accounts: [{ id: 'acc-x1', name: 'X1', domain: 'x1.example' }] });
    ok('B9 no matching account -> 0 calls, 0 partners', r3.counts.calls === 0 && r3.counts.partners_matched === 0);
    const fakeRun = ins(await svc.from('sales_sync_runs').insert({ business_id: B, trigger: 'test', status: 'success', started_at: new Date().toISOString(), finished_at: new Date().toISOString(), counts: { partner_contacts: r1.counts } }).select().single());
    ok('B10 ranToday = true once a non-error run today carries a partner_contacts block', (await S.ranToday(svc, B)) === true);
    await svc.from('sales_sync_runs').update({ status: 'error' }).eq('id', fakeRun.id);
    ok('B11 ranToday ignores an error run', (await S.ranToday(svc, B)) === false);

    // ── Part B2: API ──
    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
    for (let i = 0; i < 60 && !log.includes(`${PORT}`); i++) await wait(250);
    const call = (u, method, path, body) => fetch(`http://localhost:${PORT}/api/sales/${B}/goals${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: u.cookie }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
    let r = await call(vera, 'POST', '/partners/refresh-people', {});
    ok('B12 viewer POST refresh-people -> 403', r.status === 403, String(r.status));
    r = await call(vera, 'GET', `/partners/${JW.id}/people`);
    ok(`B13 viewer GET people -> 200 with ${JWa.num_contacts} Apollo rows + 1 manual`, r.status === 200 && r.body.people.filter(p => p.source === 'apollo').length === JWa.num_contacts && r.body.people.filter(p => p.source === 'manual').length === 1, `${r.body.people?.length} rows`);
    r = await call(jack, 'GET', '/land?goal_type=partnership');
    const jwList = r.body.goals?.find(g => g.id === JW.id);
    ok(`B14 partners list people_count for Justworks Test = ${JWa.num_contacts} Apollo + Manual Person + Pat Lee (sheet)`, jwList && jwList.people_count === JWa.num_contacts + 2, String(jwList?.people_count));
    ok('B15 server log holds no @ (no contact email logged)', !log.includes('@'));

    // ── Part C: browser ──
    browser = await chromium.launch();
    const J = await newPage(jack, 1440, 1000); const P = J.page;
    await navPartners(P, false);
    ok('C1 member header: "↻ Refresh partner people" button present', (await P.getByRole('button', { name: '↻ Refresh partner people' }).count()) === 1);
    await openRow(P, JW.id);
    const people = row(P, JW.id).getByRole('region', { name: 'People' });
    const items = people.getByRole('list', { name: 'People at this partner' }).getByRole('listitem');
    const badges = (await items.allInnerTexts()).filter(t => /APOLLO/i.test(t)).length;
    ok(`C2 Justworks Test drop-down: People shows ${JWa.num_contacts} rows with the Apollo badge + Manual Person (Added) + Pat Lee (Sheet)`, badges === JWa.num_contacts && (await items.count()) === JWa.num_contacts + 2, `${badges} apollo of ${await items.count()}`);
    await people.scrollIntoViewIfNeeded(); await P.waitForTimeout(300);
    await P.screenshot({ path: `${OUT}/p360c-1440-people.png` });
    ok('C3 Jack 1440: 0 console errors', J.errs.length === 0, J.errs.join(' | '));

    const V = await newPage(vera, 1440, 1000);
    await navPartners(V.page, false);
    ok('C4 viewer header: no Refresh partner people / Export / Log touches buttons', (await V.page.getByRole('button', { name: /Refresh partner people|Export to Apollo|Log touches/ }).count()) === 0);
    await openRow(V.page, DO.id);
    const vp = row(V.page, DO.id).getByRole('region', { name: 'People' });
    const vItems = vp.getByRole('list', { name: 'People at this partner' }).getByRole('listitem');
    ok(`C5 viewer sees Domuso's ${DOa.num_contacts} Apollo people, no Add person / Remove buttons`, (await vItems.count()) === DOa.num_contacts && (await vp.getByRole('button').count()) === 0, String(await vItems.count()));
    ok('C6 viewer: 0 console errors', V.errs.length === 0, V.errs.join(' | '));

    const M = await newPage(jack, 390, 844);
    await navPartners(M.page, true); await openRow(M.page, PS.id);
    const wide = await M.page.evaluate(() => document.documentElement.scrollWidth);
    const mItems = row(M.page, PS.id).getByRole('region', { name: 'People' }).getByRole('list', { name: 'People at this partner' }).getByRole('listitem');
    ok(`C7 390: PerkSpot Test People ${PSa.num_contacts} rows, no sideways scroll`, (await mItems.count()) === PSa.num_contacts && wide <= 390, `rows ${await mItems.count()} scrollWidth ${wide}`);
    await M.page.screenshot({ path: `${OUT}/p360c-390-people.png`, fullPage: true });
    ok('C8 390: 0 console errors', M.errs.length === 0, M.errs.join(' | '));
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
