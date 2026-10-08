// partner-360-v1 Stage 2 check. Part A = read-only on HomeLover (2 queries: the 75 partners + the latest accounts snapshot) - suggestion counts vs the audit (14 sheet domains, 11 name / 7 domain Apollo matches), 0 writes. Parts B/C = TEMP workspace only (2 temp users Jack member + Vera viewer, 4 temp partners, 1 temp sync run + accounts snapshot, a second temp workspace for the cross-workspace 404; all deleted). B = API (suggestions, confirm / dismiss / add / edit / primary / delete, viewer 403, foreign 404, workspace list, CSV). C = real browser (Playwright): Domains row in Intel, confirm from the UI, Export panel, viewer, 1440 + 390 screenshots, 0 console errors. 0 AI / 0 Apollo calls. ~1.5 min, cap 4 min. Serves build/ via server.js - run npm run build first. No contact data anywhere in this script.
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const OUT = process.argv[2] || '/tmp/partner-360-stage2'; fs.mkdirSync(OUT, { recursive: true });
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = 'bc69beab-effd-452d-9e81-fd652333bb95', PORT = 3959, tag = 'p360b-' + Date.now();
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
    // ── Part A: HomeLover, read-only - what the API would suggest today vs the audit ──
    const { data: hlGoals } = await svc.from('sales_goals').select('id,name,sources,category,tier,owner_user_id').eq('business_id', HL).eq('goal_type', 'partnership').is('archived_at', null);
    const { data: hlSnapRow } = await svc.from('sales_raw_snapshots').select('payload,captured_at').eq('business_id', HL).eq('entity', 'accounts').order('captured_at', { ascending: false }).limit(1).maybeSingle();
    const accs = hlSnapRow.payload;
    const sheet = hlGoals.filter(g => L.ownDomainFromSources(g.sources));
    const byName = hlGoals.filter(g => L.matchApolloAccounts({ name: g.name }, accs).byName.length);
    const byDom = sheet.filter(g => L.matchApolloAccounts({ name: g.name, domains: [L.ownDomainFromSources(g.sources)] }, accs).byDomain.length);
    const withSug = hlGoals.filter(g => L.suggestionsFor(g, [], accs).length);
    console.log(`A  HomeLover ${hlGoals.length} partners · ${accs.length} Apollo accounts (snapshot ${hlSnapRow.captured_at})`);
    console.log(`   sheet domains ${sheet.length} (audit 14): ${sheet.map(g => `${g.name}=${L.ownDomainFromSources(g.sources)}`).join(', ')}`);
    console.log(`   Apollo by name ${byName.length} (audit 11): ${byName.map(g => g.name).join(', ')}`);
    console.log(`   Apollo by domain ${byDom.length} (audit 7): ${byDom.map(g => g.name).join(', ')}`);
    console.log(`   partners with >=1 suggestion: ${withSug.length}; Apollo-only suggestions: ${withSug.filter(g => !sheet.includes(g)).map(g => g.name).join(', ')}`);
    const auditNames = ['PerkSpot', 'Access Development', 'BenefitHub', 'Corestream', 'OneDigital', 'Gallagher', 'Stake', 'Bilt', 'Domuso', 'Action Property Management', 'Gravy'];
    ok('A1 every audit name match is still matched by name', auditNames.every(n => byName.some(g => g.name === n)), auditNames.filter(n => !byName.some(g => g.name === n)).join(','));
    ok('A2 every audit domain match (PerkSpot, Access Development, BenefitHub, OneDigital, Gallagher, Piñata + Corestream only via corestream.com) is matched by domain or offered Apollo\'s domain', ['PerkSpot', 'Access Development', 'BenefitHub', 'OneDigital', 'Gallagher', 'Piñata'].every(n => byDom.some(g => g.name === n)) && L.suggestionsFor(hlGoals.find(g => g.name === 'Corestream'), [], accs).some(s => s.domain === 'corestream.com' && s.source === 'apollo'));
    ok('A3 Piñata: name match 0, domain match 1 (pinata.ai)', !byName.some(g => g.name === 'Piñata') && byDom.some(g => g.name === 'Piñata'));
    ok('A4 HomeLover has 0 partner_domains rows (nothing seeded, suggestions are live)', (await svc.from('partner_domains').select('*', { count: 'exact', head: true }).eq('business_id', HL)).count === 0);

    // ── TEMP workspace ──
    const B = await biz('p360b'), OTHER = await biz('other');
    bizLabel = (await svc.from('businesses').select('name').eq('id', B).single()).data.name;
    const jack = await user(B, 'Jack', 'member'), vera = await user(B, 'Vera', 'viewer');
    const partner = async (name, extra = {}) => ins(await svc.from('sales_goals').insert({ business_id: B, goal_type: 'partnership', name, pipeline_status: 'not_started', category: '3. PEOs', tier: '1', owner_user_id: jack.id, ...extra }).select().single());
    const CS = await partner('Corestream Test', { sources: 'corp.corestream-test.com; businesswire.com/news/home/x' });
    const ST = await partner('Stake Test');
    const JW = await partner('Justworks Test', { sources: 'justworks-test.com/about; justworks-test.com/press', category: '2. Perk Marketplaces & Benefit Platforms', tier: '2' });
    const NO = await partner('Nothing Test');
    const foreign = ins(await svc.from('sales_goals').insert({ business_id: OTHER, goal_type: 'partnership', name: 'Foreign Test', pipeline_status: 'not_started' }).select().single());
    const run = ins(await svc.from('sales_sync_runs').insert({ business_id: B, trigger: 'test', status: 'success', started_at: new Date().toISOString(), finished_at: new Date().toISOString() }).select().single());
    ins(await svc.from('sales_raw_snapshots').insert({ business_id: B, run_id: run.id, entity: 'accounts', captured_at: new Date().toISOString(), payload: [
      { id: 'acc-cs', name: 'Corestream Test', domain: 'corestream-test.com', num_contacts: 3 },
      { id: 'acc-st', name: 'Stake Test', domain: 'stake-test.rent', num_contacts: 6 },
      { id: 'acc-x', name: 'Unrelated Co', domain: 'unrelated.example', num_contacts: 1 },
    ] }).select());

    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B},${OTHER}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
    for (let i = 0; i < 60 && !log.includes(`${PORT}`); i++) await wait(250);
    const call = (u, method, path, body) => fetch(`http://localhost:${PORT}/api/sales/${B}/goals${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: u.cookie }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
    const pdCount = async () => (await svc.from('partner_domains').select('*', { count: 'exact', head: true }).eq('business_id', B)).count;

    // ── Part B: API ──
    let r = await call(vera, 'GET', `/partners/${CS.id}/domains`);
    ok('B1 viewer GET domains -> 200: 0 rows, 2 suggestions (sheet corp.corestream-test.com, Apollo corestream-test.com via name), Apollo account already identified by name', r.status === 200 && r.body.domains.length === 0 && JSON.stringify(r.body.suggestions.map(s => [s.domain, s.source, s.apollo_account?.name || null])) === JSON.stringify([['corp.corestream-test.com', 'sources', null], ['corestream-test.com', 'apollo', 'Corestream Test']]) && r.body.apollo_account?.name === 'Corestream Test', JSON.stringify(r.body).slice(0, 220));
    r = await call(jack, 'GET', `/partners/${ST.id}/domains`);
    ok('B2 Stake (no sources): 1 Apollo suggestion stake-test.rent', r.status === 200 && r.body.suggestions.length === 1 && r.body.suggestions[0].domain === 'stake-test.rent' && r.body.suggestions[0].source === 'apollo');
    r = await call(jack, 'GET', `/partners/${NO.id}/domains`);
    ok('B3 Nothing Test: 0 suggestions', r.status === 200 && r.body.suggestions.length === 0);
    r = await call(vera, 'POST', `/partners/${CS.id}/domains`, { domain: 'corp.corestream-test.com' });
    ok('B4 viewer POST -> 403, 0 rows written', r.status === 403 && (await pdCount()) === 0, String(r.status));
    r = await call(jack, 'POST', `/partners/${CS.id}/domains`, { domain: 'corp.corestream-test.com' });
    const d1 = r.body.domains?.[0];
    ok('B5 confirm the sheet suggestion -> 201: row confirmed, source sources, primary, created_by; suggestion gone; Apollo account still by name only (subdomain is no domain match)', r.status === 201 && d1 && d1.domain === 'corp.corestream-test.com' && d1.confirmed && d1.is_primary && d1.source === 'sources' && d1.created_by === jack.id && r.body.suggestions.length === 1 && r.body.suggestions[0].domain === 'corestream-test.com' && r.body.apollo_account?.name === 'Corestream Test', JSON.stringify(r.body).slice(0, 220));
    r = await call(jack, 'POST', `/partners/${CS.id}/domains`, { domain: 'corestream-test.com' });
    const d2 = r.body.domains?.find(d => d.domain === 'corestream-test.com');
    ok('B6 confirm the Apollo suggestion -> source apollo, not primary (second), apollo_account = Corestream Test, 0 suggestions left', r.status === 201 && d2 && d2.source === 'apollo' && d2.confirmed && !d2.is_primary && r.body.apollo_account?.name === 'Corestream Test' && r.body.suggestions.length === 0, JSON.stringify(r.body).slice(0, 220));
    r = await call(jack, 'PATCH', `/partners/${CS.id}/domains/${d2.id}`, { is_primary: true });
    ok('B7 PATCH is_primary -> swapped: corestream-test.com primary, corp. no longer', r.status === 200 && r.body.domains.find(d => d.id === d2.id).is_primary && !r.body.domains.find(d => d.id === d1.id).is_primary);
    r = await call(jack, 'PATCH', `/partners/${CS.id}/domains/${d1.id}`, { domain: 'Corestream-Test.com' });
    ok('B8 PATCH to a domain the partner already has -> 409', r.status === 409, String(r.status));
    r = await call(jack, 'PATCH', `/partners/${CS.id}/domains/${d1.id}`, { domain: 'https://www.Corestream-Test.io/x' });
    ok('B9 PATCH domain normalizes (scheme, www, path, case) -> corestream-test.io', r.status === 200 && r.body.domains.some(d => d.id === d1.id && d.domain === 'corestream-test.io'));
    const bads = await Promise.all([call(jack, 'POST', `/partners/${CS.id}/domains`, { domain: 'not a domain' }), call(jack, 'POST', `/partners/${CS.id}/domains`, {}), call(jack, 'POST', `/partners/${CS.id}/domains`, { domain: 'random.example', dismiss: true }), call(jack, 'PATCH', `/partners/${CS.id}/domains/${d1.id}`, {}), call(jack, 'PATCH', `/partners/${CS.id}/domains/${d1.id}`, { is_primary: 'yes' })]);
    ok('B10 bad domain / missing / dismiss a non-suggestion / empty PATCH / non-boolean -> 400 each', bads.every(b => b.status === 400), bads.map(b => b.status).join(','));
    r = await call(jack, 'POST', `/partners/${foreign.id}/domains`, { domain: 'foreign.example' });
    ok('B11 partner in another workspace -> 404', r.status === 404, String(r.status));
    r = await call(jack, 'POST', `/partners/${ST.id}/domains`, { domain: 'stake-test.rent', dismiss: true });
    const dis = r.body.domains?.[0];
    ok('B12 dismiss the Stake suggestion -> row confirmed=false, not primary, 0 suggestions; Apollo account still by name', r.status === 201 && dis && !dis.confirmed && !dis.is_primary && dis.source === 'apollo' && r.body.suggestions.length === 0 && r.body.apollo_account?.name === 'Stake Test', JSON.stringify(r.body).slice(0, 200));
    r = await call(jack, 'POST', `/partners/${ST.id}/domains`, { domain: 'stake-test.rent' });
    ok('B13 re-post the dismissed domain -> 200, same row now confirmed + primary, Apollo account Stake Test', r.status === 200 && r.body.domains.length === 1 && r.body.domains[0].id === dis.id && r.body.domains[0].confirmed && r.body.domains[0].is_primary && r.body.apollo_account?.name === 'Stake Test');
    r = await call(jack, 'POST', `/partners/${JW.id}/domains`, { domain: 'justworks-test.com' });
    ok('B14 Justworks: confirm sheet domain -> not in Apollo', r.status === 201 && r.body.apollo_account === null);
    r = await call(jack, 'POST', `/partners/${NO.id}/domains`, { domain: 'nothing-test.example' });
    const nd = r.body.domains?.[0];
    ok('B15 add by hand -> source manual, confirmed, primary', r.status === 201 && nd && nd.source === 'manual' && nd.confirmed && nd.is_primary);
    r = await call(jack, 'GET', '/partners/domains');
    ok('B16 workspace list: 5 rows, counts partners 4 / confirmed 4 / in_apollo 2, candidates = Justworks Test + Nothing Test (sorted)', r.status === 200 && r.body.domains.length === 5 && JSON.stringify(r.body.counts) === JSON.stringify({ partners: 4, confirmed: 4, in_apollo: 2 }) && JSON.stringify(r.body.candidates) === JSON.stringify([{ name: 'Justworks Test', domain: 'justworks-test.com' }, { name: 'Nothing Test', domain: 'nothing-test.example' }]), JSON.stringify(r.body.counts) + ' ' + JSON.stringify(r.body.candidates));
    const csvRes = await fetch(`http://localhost:${PORT}/api/sales/${B}/goals/partners/export-apollo.csv`, { headers: { Cookie: jack.cookie } });
    const csv = await csvRes.text();
    const lines = csv.split('\r\n').filter(Boolean);
    ok('B17 CSV: text/csv attachment, header + 2 rows, Justworks Test with its category/tier/owner, no @ anywhere', csvRes.status === 200 && /^text\/csv/.test(csvRes.headers.get('content-type')) && /attachment; filename="partners-for-apollo-\d{4}-\d{2}-\d{2}\.csv"/.test(csvRes.headers.get('content-disposition')) && lines[0] === 'Company Name,Website,Category,Tier,Owner' && lines.length === 3 && lines[1] === 'Justworks Test,justworks-test.com,Perk Marketplaces & Benefit Platforms,2,Jack Test' && lines[2] === 'Nothing Test,nothing-test.example,PEOs,1,Jack Test' && !csv.includes('@'), JSON.stringify(lines));
    const vcsv = await fetch(`http://localhost:${PORT}/api/sales/${B}/goals/partners/export-apollo.csv`, { headers: { Cookie: vera.cookie } });
    ok('B18 viewer GET CSV -> 200 (a read)', vcsv.status === 200, String(vcsv.status));
    r = await call(vera, 'DELETE', `/partners/${NO.id}/domains/${nd.id}`);
    ok('B19 viewer DELETE -> 403', r.status === 403, String(r.status));
    r = await call(jack, 'DELETE', `/partners/${NO.id}/domains/${nd.id}`);
    ok('B20 member DELETE -> 200, 0 rows for that partner; the manual domain is not re-suggested', r.status === 200 && r.body.domains.length === 0 && r.body.suggestions.length === 0);
    ok('B21 sales_goals.company_domain untouched on every temp partner', (await svc.from('sales_goals').select('company_domain').eq('business_id', B)).data.every(g => g.company_domain === null));

    // ── Part C: browser ──
    browser = await chromium.launch();
    const J = await newPage(jack, 1440, 1000); const P = J.page;
    await navPartners(P, false);
    await openRow(P, CS.id);
    const dd = row(P, CS.id);
    const dom = dd.getByRole('group', { name: 'Domains' });
    const domText = await dom.innerText();
    ok('C1 Corestream drop-down: Domains row visible under Intel while Intel is collapsed, ★ primary corestream-test.com, corestream-test.io, "Apollo account: Corestream Test"', (await dd.getByRole('button', { name: /^Intel/ }).getAttribute('aria-expanded')) === 'false' && /★\s*corestream-test\.com/.test(domText) && /corestream-test\.io/.test(domText) && /Apollo account: Corestream Test/.test(domText), domText.replace(/\n/g, ' | ').slice(0, 200));
    await dom.scrollIntoViewIfNeeded(); await P.waitForTimeout(300);
    await P.screenshot({ path: `${OUT}/p360b-1440-domains.png` });
    await openRow(P, CS.id);
    // Justworks: confirm from the UI? Already confirmed via API. Use Nothing Test: add by hand from the UI; then Stake's dismissed... use a fresh suggestion: delete Justworks' row first via API so the sheet suggestion comes back.
    await call(jack, 'DELETE', `/partners/${JW.id}/domains/${(await call(jack, 'GET', `/partners/${JW.id}/domains`)).body.domains[0].id}`);
    await openRow(P, JW.id);
    const jd = row(P, JW.id).getByRole('group', { name: 'Domains' });
    const sug = jd.getByRole('list', { name: 'Suggested domains' });
    ok('C2 Justworks: no confirmed domain, suggestion justworks-test.com (Sheet) with ✓ / ✕', /none confirmed/.test(await jd.innerText()) && /justworks-test\.com/.test(await sug.innerText()) && /Sheet/i.test(await sug.innerText()) && (await sug.getByRole('button', { name: 'Confirm justworks-test.com' }).count()) === 1);
    await sug.getByRole('button', { name: 'Confirm justworks-test.com' }).click(); await P.waitForTimeout(1500);
    const jdText = await jd.innerText();
    const jwRows = (await svc.from('partner_domains').select('domain,confirmed,is_primary,source').eq('goal_id', JW.id)).data;
    ok('C3 Confirm -> chip ★ justworks-test.com, "Not in Apollo - goes in the CSV export", DB row confirmed/primary/source sources, suggestions gone', /★\s*justworks-test\.com/.test(jdText) && /Not in Apollo/.test(jdText) && jwRows.length === 1 && jwRows[0].confirmed && jwRows[0].is_primary && jwRows[0].source === 'sources' && (await jd.getByRole('list', { name: 'Suggested domains' }).count()) === 0, jdText.replace(/\n/g, ' | ').slice(0, 200));
    await P.getByRole('button', { name: 'Export to Apollo (CSV)' }).click(); await P.waitForTimeout(1500);
    const ex = P.getByRole('region', { name: 'Export to Apollo' });
    const exText = await ex.innerText();
    ok('C4 Export panel: "3 of 4 partners have a confirmed domain · 2 already in Apollo · 1 to export", lists Justworks Test, Download enabled', /3 of 4 partners have a confirmed domain · 2 already in Apollo · 1 to export/.test(exText) && (await ex.getByRole('list', { name: 'Partners to export' }).getByRole('listitem').allInnerTexts()).join('|').includes('Justworks Test') && !(await ex.getByRole('button', { name: 'Download CSV' }).isDisabled()), exText.replace(/\n/g, ' | ').slice(0, 220));
    const dl = P.waitForEvent('download', { timeout: 8000 });
    await ex.getByRole('button', { name: 'Download CSV' }).click();
    const file = await dl;
    const dlText = fs.readFileSync(await file.path(), 'utf8');
    ok('C5 Download -> partners-for-apollo-<date>.csv with header + Justworks Test row, no @', /^partners-for-apollo-\d{4}-\d{2}-\d{2}\.csv$/.test(file.suggestedFilename()) && dlText.startsWith('Company Name,Website,Category,Tier,Owner\r\nJustworks Test,justworks-test.com,') && !dlText.includes('@'), file.suggestedFilename());
    await P.screenshot({ path: `${OUT}/p360b-1440-export.png` });
    ok('C6 Jack 1440: 0 console errors', J.errs.length === 0, J.errs.join(' | '));

    const V = await newPage(vera, 1440, 1000);
    await navPartners(V.page, false); await openRow(V.page, ST.id);
    const vd = row(V.page, ST.id).getByRole('group', { name: 'Domains' });
    ok('C7 viewer: sees ★ stake-test.rent + Apollo account, no buttons in Domains, no Export / Log touches buttons', /★\s*stake-test\.rent/.test(await vd.innerText()) && /Apollo account: Stake Test/.test(await vd.innerText()) && (await vd.getByRole('button').count()) === 0 && (await V.page.getByRole('button', { name: /Export to Apollo|Log touches/ }).count()) === 0, (await vd.innerText()).replace(/\n/g, ' | '));
    ok('C8 viewer: 0 console errors', V.errs.length === 0, V.errs.join(' | '));

    const M = await newPage(jack, 390, 844);
    await navPartners(M.page, true); await openRow(M.page, CS.id);
    const wide = await M.page.evaluate(() => document.documentElement.scrollWidth);
    ok('C9 390: Domains row shown, no sideways scroll', (await row(M.page, CS.id).getByRole('group', { name: 'Domains' }).count()) === 1 && wide <= 390, `scrollWidth ${wide}`);
    await M.page.screenshot({ path: `${OUT}/p360b-390-domains.png`, fullPage: true });
    ok('C10 390: 0 console errors', M.errs.length === 0, M.errs.join(' | '));
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
