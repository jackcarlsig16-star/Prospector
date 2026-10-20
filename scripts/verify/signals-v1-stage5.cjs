// signals-v1 Stage 5 live check. ONE real Apollo pull, declared: 4 calls (GET users/api_profile, POST
// mixed_companies/search all visitors, the same search with the US/500+ filters, GET users/api_profile), <= 2 credits;
// the script aborts if the run records more than 4 calls. TEMP data only: 1 workspace (goals_sales on, added to
// SALES_ANALYTICS_BUSINESS_IDS for the local server only), 2 temp users (owner "Jack Zz", viewer). Seed: HomeLover's
// live partner names (+ owner team, stage, last touch, confirmed domains) and employer names are COPIED into the temp
// workspace so matching behaves like prod - read-only on HomeLover. Then: the report API vs the DB, the page-path rules
// (contact page / auth-only) on real data, Not a fit + skip list, Viewer gates, Brad's .xlsx downloaded in the browser
// by the Viewer and scanned cell by cell ("@", phone shapes, people's names from HomeLover members / partner contacts /
// prospects - compared in memory, never printed), 1440 + 390 shots, Weekly PDF prints. Also READ-ONLY on HomeLover:
// its own report + export built from its stored visits and scanned the same way. Company and people names are never
// printed. 0 Claude. Teardown deletes everything. ~2-3 min, cap 4 min.
// Usage: node scripts/verify/signals-v1-stage5.cjs <outdir>   (run npm run build first)
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const ExcelJS = require(ROOT + '/node_modules/exceljs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3993, tag = 'sig5-' + Date.now();
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const HL_TABLES = ['business_members', 'sales_goals', 'sales_partner_events', 'sales_week_goals', 'sales_targets', 'sales_opportunities', 'partner_domains', 'sales_suggestions', 'sales_signals', 'web_visits', 'visit_pull_runs', 'sales_visit_skip', 'apollo_credit_spend'];
const OUT = process.argv[2] || '/tmp';
const made = { biz: null, users: [] };
let srv, browser, log = '', pass = 0, total = 0, measured = null;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/g, ISO = /^\s*\d{4}-\d{2}-\d{2}\s*$/;
const piiCell = s => /@/.test(s) || (s.match(PHONE) || []).some(m => !ISO.test(m));
const CONTACT = /^\/(employer-partners|contact)/i;
const cleanup = require('./lib/tempGuard.cjs')(removeTemp, { capMs: 235000 });

async function hl() {
  const o = {};
  for (const t of HL_TABLES) { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HOMELOVER); o[t] = r.error ? `n/a (${r.error.message.slice(0, 40)})` : r.count; }
  return o;
}
async function removeTemp() {
  if (browser) await browser.close().catch(() => {});
  if (srv) srv.kill();
  const b = made.biz;
  if (b) {
    for (const t of ['sales_signals', 'web_visits', 'visit_pull_runs', 'sales_visit_skip', 'apollo_credit_spend', 'sales_suggestions', 'sales_tidy_runs', 'sales_partner_events', 'partner_domains', 'sales_week_goal_steps', 'sales_week_goals', 'sales_targets', 'sales_opportunities', 'sales_goals', 'business_members', 'auth_events']) {
      const r = await svc.from(t).delete().eq('business_id', b);
      if (r.error) console.log(`cleanup ${t}: ${r.error.message}`);
    }
  }
  for (const u of made.users) { await svc.from('auth_events').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('actor_id', u); }
  if (b) await svc.from('businesses').delete().eq('id', b);
  for (const u of made.users) await svc.auth.admin.deleteUser(u);
}
async function user(name, role) {
  const email = `${tag}-${name.split(' ')[0].toLowerCase()}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
  const { data: u } = await svc.auth.admin.createUser({ email, password, email_confirm: true }); made.users.push(u.user.id);
  await svc.from('profiles').update({ display_name: name, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
  ins(await svc.from('business_members').insert({ business_id: made.biz, email, name, user_id: u.user.id, role }).select());
  const c = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: s } = await c.auth.signInWithPassword({ email, password });
  return { id: u.user.id, token: s.session.access_token, session: s.session };
}
let WS_NAME;
async function newPage(u, width, height) {
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(12000);
  page.on('console', m => { if (m.type() === 'error' && !/favicon|net::ERR_FAILED|Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 160)); });
  page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
  await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)/, r => r.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"blocked by verify script"}' }));
  await page.route(/\/goals\/visits\/pull$/, r => (JSON.parse(r.request().postData() || '{}').force ? r.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"blocked by verify script"}' }) : r.continue()));
  await page.addInitScript(([k, v]) => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(u.session)]);
  await page.goto(`http://localhost:${PORT}/?tab=reports&view=visitors`); await page.waitForTimeout(3000);
  return { page, errs };
}
async function navSales(page, compact) {
  const menu = async () => { if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); } };
  await menu(); await page.getByLabel('Workspace').selectOption({ label: WS_NAME }); await page.waitForTimeout(2500);
  await menu(); await page.locator('#root').getByRole('button', { name: 'Goals & Sales', exact: true }).dispatchEvent('click'); await page.waitForTimeout(4000);
}
async function openVisitors(page) {
  await page.locator('#workspace-header-tabs').getByRole('button', { name: /^Reports/ }).first().click(); await page.waitForTimeout(1500);
  await page.getByRole('group', { name: 'Reports views' }).getByRole('button', { name: 'Website visitors' }).click();
  await page.locator('[data-visitor-report]').waitFor(); await page.waitForTimeout(800);
}
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, animations: 'disabled', caret: 'hide' });
async function cellsOf(buf) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('Website visitors');
  const rows = [];
  ws.eachRow((row, n) => rows.push({ n, values: row.values.slice(1).map(v => (v == null ? '' : String(v))) }));
  return rows;
}
// People's names: HomeLover members, partner contacts, Apollo prospects + the temp users. Compared in memory only.
async function peopleNames() {
  const page = async (table, cols) => { const out = []; for (let from = 0; ; from += 1000) { const r = ins(await svc.from(table).select(cols).eq('business_id', HOMELOVER).range(from, from + 999)); out.push(...r); if (r.length < 1000) return out; } };
  const [m, pc, ps] = await Promise.all([page('business_members', 'name'), page('partner_contacts', 'name'), page('sales_prospect_state', 'name')]);
  return [...new Set([...m, ...pc, ...ps].map(r => String(r.name || '').trim().toLowerCase()).filter(n => n.includes(' ') && n.length >= 5).concat(['jack zz', 'viewer zz']))];
}
function scan(rows, names) {
  const cells = rows.flatMap(r => r.values);
  return { cells: cells.length, pii: cells.filter(piiCell).length, names: cells.filter(c => names.some(n => c.toLowerCase().includes(n))).length };
}

(async () => {
  const hlBefore = await hl(); const t0 = Date.now();
  fs.mkdirSync(OUT, { recursive: true });
  const { visitReport, buildVisitorSheet, EXPORT_COLUMNS } = await import(ROOT + '/api/sales/visitReport.js');
  try {
    const names = await peopleNames();
    console.log(`people-name list loaded: ${names.length} names (not printed)`);

    console.log('--- HomeLover, READ-ONLY: its own report + export from stored visits');
    const hlr = await visitReport(svc, HOMELOVER);
    const since = hlr.since;
    const hlVisits = ins(await svc.from('web_visits').select('company_key, pulled_on').eq('business_id', HOMELOVER).gte('pulled_on', since));
    console.log(`HomeLover: ${hlVisits.length} stored visit rows since ${since} -> report counts ${JSON.stringify(hlr.counts)} · rows with an "In sequence" source ${hlr.rows.filter(r => r.sources.length).length}`);
    ok('HomeLover report: one row per company in web_visits (7 LA days)', hlr.rows.length === new Set(hlVisits.map(v => v.company_key)).size);
    const hlScan = scan(await cellsOf(await buildVisitorSheet(hlr)), names);
    ok(`HomeLover export (built, not saved): ${hlScan.cells} cells, 0 "@"/phone shapes, 0 people's names`, hlScan.pii === 0 && hlScan.names === 0, JSON.stringify(hlScan));

    WS_NAME = `ZZ Visitors ${tag.slice(-4)}`;
    const T = made.biz = ins(await svc.from('businesses').insert({ name: WS_NAME, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}-jack@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
    const M = await user('Jack Zz', 'owner'), V = await user('Viewer Zz', 'viewer');
    const hlPartners = ins(await svc.from('sales_goals').select('id, name, category, record_id, pipeline_status, owner_team, co_owner_name, last_touch_at').eq('business_id', HOMELOVER).eq('goal_type', 'partnership').is('archived_at', null).limit(1000));
    const hlEmployers = ins(await svc.from('sales_opportunities').select('organization, org_type, stage, owner_team, record_id').eq('business_id', HOMELOVER).is('archived_at', null).limit(1000));
    const hlDomains = ins(await svc.from('partner_domains').select('goal_id, domain').eq('business_id', HOMELOVER).eq('confirmed', true).limit(2000));
    const idMap = new Map();
    for (const p of hlPartners) {
      const row = ins(await svc.from('sales_goals').insert({ business_id: T, goal_type: 'partnership', name: p.name, category: p.category, owner_user_id: M.id, pipeline_status: p.pipeline_status, owner_team: p.owner_team, co_owner_name: p.co_owner_name, last_touch_at: p.last_touch_at }).select('id').single());
      idMap.set(p.id, row.id);
    }
    if (hlEmployers.length) ins(await svc.from('sales_opportunities').insert(hlEmployers.map(o => ({ business_id: T, organization: o.organization, org_type: o.org_type, stage: o.stage, owner_team: o.owner_team, source: 'manual' }))).select('id'));
    const doms = hlDomains.filter(d => idMap.has(d.goal_id)).map(d => ({ business_id: T, goal_id: idMap.get(d.goal_id), domain: d.domain, confirmed: true, source: 'manual' }));
    if (doms.length) { const r = await svc.from('partner_domains').insert(doms); if (r.error) console.log(`seed domains skipped: ${r.error.message.slice(0, 80)}`); }
    console.log(`seed: ${hlPartners.length} partners + ${hlEmployers.length} opportunities + ${doms.length} confirmed domains copied by name (values not printed)`);

    srv = spawn('node', ['--dns-result-order=ipv4first', 'server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${T}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
    for (let i = 0; i < 60 && !log.includes(`port ${PORT}`); i++) await wait(250);
    const call = (u, method, path, body) => fetch(`http://localhost:${PORT}/api/sales/${T}/goals${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: `prospector_at=${encodeURIComponent(u.token)}` }, body: body ? JSON.stringify(body) : undefined });
    const json = async (...a) => { const r = await call(...a); return { status: r.status, body: await r.json().catch(() => ({})) }; };

    console.log('--- ONE real pull (declared: 4 Apollo calls, <= 2 credits)');
    const p1 = await json(M, 'POST', '/visits/pull', { trigger: 'manual' });
    const run = ins(await svc.from('visit_pull_runs').select('*').eq('business_id', T));
    const spend = ins(await svc.from('apollo_credit_spend').select('*').eq('business_id', T));
    measured = spend[0]?.credits ?? null;
    if (!run[0] || run[0].calls > 4) throw new Error(`pull made ${run[0]?.calls} calls - over the declared 4, aborting`);
    ok('pull: 200, ran, exactly 4 Apollo calls, measured credits <= 2', p1.status === 200 && p1.body.ran && run[0].calls === 4 && measured != null && measured <= 2, JSON.stringify(p1.body).slice(0, 160));
    const visits = ins(await svc.from('web_visits').select('*').eq('business_id', T));
    const pc = { P1: 0, P2: 0, P3: 0, P4: 0 }; for (const v of visits) pc[v.priority]++;
    const contactVisited = visits.filter(v => (v.top_paths || []).some(p => CONTACT.test(p.path)));
    const contactRule = visits.filter(v => v.priority_rule === 'Employer/contact page plus a repeat visit');
    const authOnly = visits.filter(v => v.maybe_user);
    const rawPaths = visits.flatMap(v => (v.top_paths || []).map(p => p.path));
    console.log(`real data: ${visits.length} companies · P1 ${pc.P1} / P2 ${pc.P2} / P3 ${pc.P3} / P4 ${pc.P4} · contact page visited ${contactVisited.length}, contact-page rule fired ${contactRule.length} · /auth-only (maybe a user) ${authOnly.length} · us_500 ${visits.filter(v => v.us_500).length} · matched ${visits.filter(v => v.matched_id).length}`);
    ok(`page-path fix on real data: all ${rawPaths.length} stored paths start with "/" (no "homelover.ai/x" host prefix)`, rawPaths.length > 0 && rawPaths.every(p => p.startsWith('/') && !/homelover\./i.test(p)));
    ok('contact-page rule rows all visited a contact page with 2+ visits; /auth-only rows are P4', contactRule.every(v => contactVisited.includes(v) && v.visits_7d >= 2) && authOnly.every(v => v.priority === 'P4'));

    console.log('--- report API');
    const rep = await json(V, 'GET', '/visits/report');
    ok('viewer GET report 200; one row per company; P1-P4 = DB', rep.status === 200 && rep.body.rows.length === visits.length && ['P1', 'P2', 'P3', 'P4'].every(k => rep.body.counts[k] === pc[k]), JSON.stringify(rep.body.counts));
    const upside = visits.filter(v => v.matched_id).filter(v => {
      if (v.matched_type === 'partner') { const p = hlPartners.find(x => idMap.get(x.id) === v.matched_id); return ['upside', 'both'].includes(p?.owner_team); }
      return false;
    }).length;
    ok(`"On Brad's list" = matched Upside-owned/joint records (${rep.body.counts.on_brads_list})`, rep.body.counts.on_brads_list >= upside);
    ok('every row: Type + size, Apollo-labeled uniques, next action; matched rows carry match label', rep.body.rows.every(r => r.type && ['US 500+', 'size unknown'].includes(r.size) && Number.isFinite(r.unique_visitors_apollo) && r.next_action && (!r.match || r.match.label)));
    const strings = v => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);
    ok('report JSON: no string value has "@" or a phone shape', !strings(rep.body).some(piiCell));

    console.log('--- skip list');
    ok('viewer POST skip refused 403', (await json(V, 'POST', '/visits/skip', { name: 'Anything' })).status === 403);
    const target = rep.body.rows.find(r => r.priority === 'P3') || rep.body.rows.find(r => r.priority !== 'P4');
    const fit = await json(M, 'POST', '/visits/skip', { company_key: target.company_key, reason: 'Not a fit' });
    const after = (await json(V, 'GET', '/visits/report')).body.rows.find(r => r.company_key === target.company_key);
    ok('Not a fit: 201, the row reads P4 "On the skip list" at once', fit.status === 201 && after.priority === 'P4' && after.skipped);
    ok('viewer DELETE skip refused 403', (await json(V, 'DELETE', `/visits/skip/${fit.body.id}`)).status === 403);
    const rm = await json(M, 'DELETE', `/visits/skip/${fit.body.id}`);
    const back = (await json(V, 'GET', '/visits/report')).body.rows.find(r => r.company_key === target.company_key);
    ok('remove: 200, the row is back to its stored priority', rm.status === 200 && back.priority === target.priority);
    const skipList = (await json(V, 'GET', '/visits/skip')).body.skip;
    ok('viewer GET skip list 200: the 4 seed rows', skipList.length === 4);

    console.log('--- UI');
    const build = fs.readdirSync(`${ROOT}/build/static/js`).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(`${ROOT}/build/static/js/${f}`, 'utf8')).join('\n');
    ok('bundle marker: "Export for Brad (.xlsx)" + "/visits/report" + "Unique visitors (Apollo)" in build/', build.includes('Export for Brad (.xlsx)') && build.includes('/visits/report') && build.includes('Unique visitors (Apollo)'));
    browser = await chromium.launch();
    const shown = pc.P1 + pc.P2 + pc.P3;
    for (const [width, height, compact] of [[1440, 900, false], [390, 844, true]]) {
      const { page, errs } = await newPage(M, width, height);
      await navSales(page, compact);
      await openVisitors(page);
      const summary = await page.getByRole('region', { name: 'Website visitors summary' }).innerText();
      ok(`${width}: headline P1-P4 + companies = DB`, ['P1', 'P2', 'P3', 'P4'].every(k => new RegExp(`${k} · [A-Za-z ]+\\s+${pc[k]}\\b`).test(summary)) && new RegExp(`Companies \\(7 d\\)\\s+${visits.length}\\b`, 'i').test(summary), summary.replace(/\s+/g, ' ').slice(0, 200));
      ok(`${width}: Act today lists ${pc.P1} rows`, (await page.getByRole('heading', { name: `Act today (${pc.P1})` }).count()) === 1);
      ok(`${width}: ${shown} P1-P3 rows shown, P4 hidden by default`, (await page.locator('[data-visit-row]').count()) === shown && (await page.locator('[data-visit-row="P4"]').count()) === 0);
      if (!compact) ok('1440: table header "Unique visitors (Apollo)"', (await page.getByRole('columnheader', { name: 'Unique visitors (Apollo)' }).count()) === 1);
      if (compact) ok('390: list rows say "unique visitors (Apollo)"', shown === 0 || (await page.getByText(/unique visitors \(Apollo\)/).count()) >= 1);
      ok(`${width}: Member sees Not a fit`, shown === 0 || (await page.getByRole('button', { name: 'Not a fit' }).count()) >= 1);
      await shot(page, `sig5-${width}-visitors`);
      await page.getByRole('button', { name: 'Skip list' }).click(); await page.waitForTimeout(800);
      await shot(page, `sig5-${width}-skiplist`);
      ok(`${width}: no sideways scroll`, await noSideScroll(page));
      ok(`${width}: 0 console errors`, !errs.length, errs.join(' | '));
      await page.context().close();
    }

    const { page: vp, errs: verrs } = await newPage(V, 1440, 900);
    await navSales(vp, false);
    await openVisitors(vp);
    ok('viewer: no Not a fit; skip list has no Add/Remove', (await vp.getByRole('button', { name: 'Not a fit' }).count()) === 0 && await (async () => { await vp.getByRole('button', { name: 'Skip list' }).click(); await vp.waitForTimeout(600); const s = vp.getByRole('region', { name: 'Skip list' }); return (await s.getByRole('button').count()) === 0; })());
    const [dl] = await Promise.all([vp.waitForEvent('download'), vp.getByRole('button', { name: 'Export for Brad (.xlsx)' }).click()]);
    const file = `${OUT}/${dl.suggestedFilename()}`;
    await dl.saveAs(file);
    const rows = await cellsOf(fs.readFileSync(file));
    const dataRows = rows.filter(r => /^P[1-3]$/.test(r.values[0]));
    const sc = scan(rows, names);
    console.log(`export opened: ${file.split('/').pop()} · ${rows.length} rows, ${dataRows.length} company rows, ${sc.cells} cells`);
    ok('viewer export: header = the 15 columns incl. "Unique visitors (Apollo)"', rows[0].values.join('|') === EXPORT_COLUMNS.map(c => c.header).join('|'));
    ok(`viewer export: ${dataRows.length} rows = P1-P3 (${shown}), no P4`, dataRows.length === shown && !rows.some(r => r.values[0] === 'P4'));
    ok('viewer export: Upside-owned/joint rows first', (() => { const u = dataRows.map(r => /Upside-owned|joint/.test(r.values[5])); return u.indexOf(false) === -1 || u.slice(u.indexOf(false)).every(x => !x); })());
    ok(`viewer export scanned: 0 "@" / phone shapes, 0 people's names (${names.length} checked)`, sc.pii === 0 && sc.names === 0, JSON.stringify(sc));
    await shot(vp, 'sig5-1440-viewer');
    ok('viewer: 0 console errors', !verrs.length, verrs.join(' | '));
    await vp.context().close();

    const { page: rp, errs: rerrs } = await newPage(M, 1440, 900);
    await navSales(rp, false);
    await rp.locator('#workspace-header-tabs').getByRole('button', { name: /^Reports/ }).first().click(); await rp.waitForTimeout(1200);
    await rp.getByRole('group', { name: 'Reports views' }).getByRole('button', { name: 'Weekly report' }).click(); await rp.waitForTimeout(2500);
    await rp.pdf({ path: `${OUT}/sig5-report.pdf`, landscape: true });
    ok('Weekly report PDF still prints', fs.statSync(`${OUT}/sig5-report.pdf`).size > 1000);
    ok('weekly page: 0 console errors', !rerrs.length, rerrs.join(' | '));
    await rp.context().close();
    const runEnd = ins(await svc.from('visit_pull_runs').select('calls').eq('business_id', T));
    ok('after the UI: still exactly 1 run with 4 Apollo calls (page loads made 0)', runEnd.length === 1 && runEnd[0].calls === 4);
  } catch (e) {
    ok('script ran without throwing', false, e.stack?.split('\n').slice(0, 3).join(' | ') || e.message);
  } finally {
    await cleanup();
    const left = await svc.from('businesses').select('id', { count: 'exact', head: true }).eq('id', made.biz);
    const profiles = await svc.from('profiles').select('id', { count: 'exact', head: true }).in('id', made.users.length ? made.users : ['00000000-0000-0000-0000-000000000000']);
    console.log(`teardown: workspace left ${left.count}, temp profiles left ${profiles.count}`);
    const hlAfter = await hl();
    const diff = Object.keys(hlBefore).filter(k => hlBefore[k] !== hlAfter[k]);
    ok(`HomeLover counts identical (${HL_TABLES.length} tables)`, !diff.length, diff.map(k => `${k} ${hlBefore[k]}->${hlAfter[k]}`).join(', '));
    console.log(`${pass}/${total} passed · ${Math.round((Date.now() - t0) / 1000)}s · Claude 0 · Apollo 4 calls declared · measured credits ${measured}`);
    process.exit(pass === total ? 0 : 1);
  }
})();
