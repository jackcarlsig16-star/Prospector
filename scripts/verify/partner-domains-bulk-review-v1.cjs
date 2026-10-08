// partner-domains-bulk-review-v1 check. Part A = read-only on HomeLover (2 queries: the partners + the latest accounts snapshot) - how many partners "Review domains (n)" would show today, 0 writes. Parts B/C = TEMP workspace only (2 temp users Jack member + Vera viewer, 3 temp partners, 1 temp sync run + accounts snapshot; all deleted). B = API (workspace GET returns the pending list for viewer and member). C = real browser (Playwright): header button, panel badges, dismiss one, Confirm all, header count -> hidden, Export count, viewer, 1440 + 390 screenshots, 0 console errors. 0 AI / 0 Apollo calls. ~1.5 min, cap 4 min. Serves build/ via server.js - run npm run build first. No contact data anywhere in this script.
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const OUT = process.argv[2] || '/tmp/partner-domains-bulk-review'; fs.mkdirSync(OUT, { recursive: true });
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = 'bc69beab-effd-452d-9e81-fd652333bb95', PORT = 3959, tag = 'pdbr-' + Date.now();
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const WATCH = ['businesses', 'business_members', 'sales_goals', 'sales_partner_events', 'partner_contacts', 'partner_domains', 'sales_raw_snapshots', 'sales_sync_runs', 'profiles', 'auth_events'];
const made = { users: [], biz: [] };
let srv, browser, log = '', pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const snap = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true })).count; return o; };
const hlSnap = async () => JSON.stringify({ pd: (await svc.from('partner_domains').select('*', { count: 'exact', head: true }).eq('business_id', HL)).count, goals: (await svc.from('sales_goals').select('id,updated_at').eq('business_id', HL).eq('goal_type', 'partnership').order('id')).data });
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('ABORT (4 min cap)'); cleanup().then(() => process.exit(2)); }, 240000);
async function cleanup() {
  if (browser) await browser.close().catch(() => {});
  if (srv) srv.kill();
  for (const b of made.biz) {
    for (const t of ['partner_domains', 'partner_contacts', 'sales_partner_events', 'sales_raw_snapshots', 'sales_sync_runs', 'sales_goals', 'business_members', 'auth_events']) await svc.from(t).delete().eq('business_id', b);
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
  const L = await import(ROOT + '/src/constants/partnerDomains.js');
  try {
    // ── Part A: HomeLover, read-only - what "Review domains (n)" would show today ──
    const { data: hlGoals } = await svc.from('sales_goals').select('id,name,sources,category,tier,owner_user_id').eq('business_id', HL).eq('goal_type', 'partnership').is('archived_at', null);
    const { data: hlRows } = await svc.from('partner_domains').select('*').eq('business_id', HL);
    const { data: hlSnapRow } = await svc.from('sales_raw_snapshots').select('payload,captured_at').eq('business_id', HL).eq('entity', 'accounts').order('captured_at', { ascending: false }).limit(1).maybeSingle();
    const byGoal = {}; for (const r of hlRows) (byGoal[r.goal_id] ||= []).push(r);
    const hlPending = L.pendingSuggestions(hlGoals, byGoal, hlSnapRow.payload);
    const hlN = new Set(hlPending.map(s => s.goal_id)).size;
    console.log(`A  HomeLover ${hlGoals.length} partners · ${hlRows.length} partner_domains rows · ${hlSnapRow.payload.length} Apollo accounts (snapshot ${hlSnapRow.captured_at})`);
    console.log(`   Review domains (n): n = ${hlN} partners, ${hlPending.length} suggestions · Both ${hlPending.filter(s => s.both).length} · Sheet ${hlPending.filter(s => !s.both && s.source === 'sources').length} · Apollo ${hlPending.filter(s => s.source === 'apollo').length}`);
    console.log(`   rows: ${hlPending.map(s => `${s.partner_name}=${s.domain}[${L.SUGGESTION_BADGE(s)}]`).join(', ')}`);
    ok('A1 HomeLover: n reported (spec expected 19 or today\'s number)', hlN > 0, `n = ${hlN}`);
    ok('A2 every Both row is a sheet domain that a same-name Apollo account also has', hlPending.filter(s => s.both).every(s => s.source === 'sources' && L.matchApolloAccounts({ name: s.partner_name, domains: [s.domain] }, hlSnapRow.payload).byName.some(a => L.normalizeDomain(a.domain || '') === s.domain)));

    // ── TEMP workspace: 3 partners, 4 suggestions, 1 Both ──
    const B = await biz('pdbr');
    bizLabel = (await svc.from('businesses').select('name').eq('id', B).single()).data.name;
    const jack = await user(B, 'Jack', 'member'), vera = await user(B, 'Vera', 'viewer');
    const partner = async (name, extra = {}) => ins(await svc.from('sales_goals').insert({ business_id: B, goal_type: 'partnership', name, pipeline_status: 'not_started', category: '3. PEOs', tier: '1', owner_user_id: jack.id, ...extra }).select().single());
    const CS = await partner('Corestream Test', { sources: 'corp.corestream-test.com; businesswire.com/news/home/x' });
    const PS = await partner('PerkSpot Test', { sources: 'perkspot-test.com/about; lincoln-test.com (Perkopolis)' });
    const JW = await partner('Justworks Test', { sources: 'justworks-test.com/about; justworks-test.com/press', category: '2. Perk Marketplaces & Benefit Platforms', tier: '2' });
    const run = ins(await svc.from('sales_sync_runs').insert({ business_id: B, trigger: 'test', status: 'success', started_at: new Date().toISOString(), finished_at: new Date().toISOString() }).select().single());
    ins(await svc.from('sales_raw_snapshots').insert({ business_id: B, run_id: run.id, entity: 'accounts', captured_at: new Date().toISOString(), payload: [
      { id: 'acc-cs', name: 'Corestream Test', domain: 'corestream-test.com', num_contacts: 3 },
      { id: 'acc-ps', name: 'PerkSpot Test', domain: 'perkspot-test.com', num_contacts: 6 },
      { id: 'acc-x', name: 'Unrelated Co', domain: 'unrelated.example', num_contacts: 1 },
    ] }).select());

    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
    for (let i = 0; i < 60 && !log.includes(`${PORT}`); i++) await wait(250);
    const call = (u, method, path, body) => fetch(`http://localhost:${PORT}/api/sales/${B}/goals${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: u.cookie }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
    const pdRows = async () => (await svc.from('partner_domains').select('goal_id,domain,confirmed,is_primary,source').eq('business_id', B).order('domain')).data;

    // ── Part B: API ──
    const expected = [
      [CS.id, 'Corestream Test', 'corp.corestream-test.com', 'sources', false], [CS.id, 'Corestream Test', 'corestream-test.com', 'apollo', false],
      [JW.id, 'Justworks Test', 'justworks-test.com', 'sources', false], [PS.id, 'PerkSpot Test', 'perkspot-test.com', 'sources', true],
    ];
    const flat = b => JSON.stringify((b.suggestions || []).map(s => [s.goal_id, s.partner_name, s.domain, s.source, s.both]));
    let r = await call(vera, 'GET', '/partners/domains');
    ok('B1 viewer GET /partners/domains -> 200: 4 pending suggestions (Corestream x2, Justworks, PerkSpot=Both) by partner name, counts.pending 3', r.status === 200 && flat(r.body) === JSON.stringify(expected) && r.body.counts.pending === 3, `${r.status} ${flat(r.body)} ${JSON.stringify(r.body.counts)}`);
    r = await call(jack, 'GET', '/partners/domains');
    ok('B2 member GET: same list, 0 rows, 0 candidates yet', r.status === 200 && flat(r.body) === JSON.stringify(expected) && r.body.domains.length === 0 && r.body.candidates.length === 0);

    // ── Part C: browser ──
    browser = await chromium.launch();
    const M = await newPage(jack, 390, 844);
    await navPartners(M.page, true);
    const mBtn = M.page.getByRole('button', { name: 'Review domains (3)' });
    ok('C1 390: header shows "Review domains (3)"', (await mBtn.count()) === 1);
    await mBtn.click(); await M.page.waitForTimeout(800);
    const mPanel = M.page.getByRole('region', { name: 'Review domains' });
    await mPanel.scrollIntoViewIfNeeded(); await M.page.waitForTimeout(300);
    const wide = await M.page.evaluate(() => document.documentElement.scrollWidth);
    ok('C2 390: panel open with 4 rows, no sideways scroll', (await mPanel.getByRole('list', { name: 'Pending domain suggestions' }).getByRole('listitem').count()) === 4 && wide <= 390, `scrollWidth ${wide}`);
    await M.page.screenshot({ path: `${OUT}/pdbr-390-review.png`, fullPage: true });
    ok('C3 390: 0 console errors', M.errs.length === 0, M.errs.join(' | '));

    const J = await newPage(jack, 1440, 1000); const P = J.page;
    await navPartners(P, false);
    const btn = P.getByRole('button', { name: 'Review domains (3)' });
    ok('C4 1440: "Review domains (3)" next to Export to Apollo (CSV)', (await btn.count()) === 1 && (await P.getByRole('button', { name: 'Export to Apollo (CSV)' }).count()) === 1);
    await btn.click(); await P.waitForTimeout(800);
    const panel = P.getByRole('region', { name: 'Review domains' });
    const items = panel.getByRole('list', { name: 'Pending domain suggestions' }).getByRole('listitem');
    const texts = (await items.allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
    ok('C5 panel: 4 rows with badges Sheet / Apollo / Sheet / Both, "Confirm all (4)" + "Confirm all \'Both\' (1)"', texts.length === 4 && /Corestream Test corp\.corestream-test\.com Sheet/i.test(texts[0]) && /Corestream Test corestream-test\.com Apollo/i.test(texts[1]) && /Justworks Test justworks-test\.com Sheet/i.test(texts[2]) && /PerkSpot Test perkspot-test\.com Both/i.test(texts[3]) && (await panel.getByRole('button', { name: 'Confirm all (4)' }).count()) === 1 && (await panel.getByRole('button', { name: "Confirm all 'Both' (1)" }).count()) === 1, texts.join(' || '));
    await panel.scrollIntoViewIfNeeded(); await P.waitForTimeout(300);
    await P.screenshot({ path: `${OUT}/pdbr-1440-review.png` });
    await panel.getByRole('button', { name: 'Dismiss corp.corestream-test.com for Corestream Test' }).click(); await P.waitForTimeout(1500);
    let rows = await pdRows();
    ok('C6 dismiss corp.corestream-test.com -> row leaves the list (3 pending), DB row confirmed=false, header now "Review domains (3)" still (Corestream still has one)', (await items.count()) === 3 && rows.length === 1 && rows[0].domain === 'corp.corestream-test.com' && rows[0].confirmed === false && (await P.getByRole('button', { name: 'Review domains (3)' }).count()) === 1, JSON.stringify(rows));
    await panel.getByRole('button', { name: 'Confirm all (3)' }).click();
    await P.getByText('3 of 3 confirmed', { exact: true }).waitFor({ timeout: 10000 }); await P.waitForTimeout(1200);
    rows = await pdRows();
    const conf = rows.filter(x => x.confirmed);
    ok('C7 Confirm all -> "3 of 3 confirmed", 3 confirmed + 1 dismissed rows in partner_domains, each confirmed row primary, sources apollo/sources/sources', conf.length === 3 && rows.length === 4 && conf.every(x => x.is_primary) && JSON.stringify(conf.map(x => [x.domain, x.source])) === JSON.stringify([['corestream-test.com', 'apollo'], ['justworks-test.com', 'sources'], ['perkspot-test.com', 'sources']]), JSON.stringify(rows));
    ok('C8 header: Review domains button gone (n = 0); panel says Nothing pending · 3 confirmed, 1 dismissed this session', (await P.getByRole('button', { name: /^Review domains/ }).count()) === 0 && /Nothing pending/.test(await panel.innerText()) && /3 confirmed, 1 dismissed this session/.test(await panel.innerText()), (await panel.innerText()).replace(/\n/g, ' | ').slice(0, 200));
    await P.screenshot({ path: `${OUT}/pdbr-1440-after.png` });
    await P.getByRole('button', { name: 'Export to Apollo (CSV)' }).click(); await P.waitForTimeout(1500);
    const exText = await P.getByRole('region', { name: 'Export to Apollo' }).innerText();
    ok('C9 Export panel after confirms: "3 of 3 partners have a confirmed domain · 2 already in Apollo · 1 to export" (Justworks Test)', /3 of 3 partners have a confirmed domain · 2 already in Apollo · 1 to export/.test(exText) && /Justworks Test/.test(exText), exText.replace(/\n/g, ' | ').slice(0, 220));
    r = await call(jack, 'GET', '/partners/domains');
    ok('C10 API after: 0 suggestions, counts pending 0 / confirmed 3 / in_apollo 2, candidates = Justworks Test', r.body.suggestions.length === 0 && JSON.stringify(r.body.counts) === JSON.stringify({ partners: 3, confirmed: 3, in_apollo: 2, pending: 0 }) && JSON.stringify(r.body.candidates) === JSON.stringify([{ name: 'Justworks Test', domain: 'justworks-test.com' }]), JSON.stringify(r.body.counts));
    ok('C11 Jack 1440: 0 console errors', J.errs.length === 0, J.errs.join(' | '));

    await svc.from('partner_domains').delete().eq('business_id', B);
    const V = await newPage(vera, 1440, 1000);
    await navPartners(V.page, false);
    ok('C12 viewer with 4 pending again: no Review domains / Export / Log touches buttons; GET works (200, 4 suggestions)', (await V.page.getByRole('button', { name: /Review domains|Export to Apollo|Log touches/ }).count()) === 0 && (await call(vera, 'GET', '/partners/domains')).body.suggestions.length === 4);
    ok('C13 viewer: 0 console errors', V.errs.length === 0, V.errs.join(' | '));
    ok('C14 sales_goals.company_domain untouched on every temp partner', (await svc.from('sales_goals').select('company_domain').eq('business_id', B)).data.every(g => g.company_domain === null));
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
