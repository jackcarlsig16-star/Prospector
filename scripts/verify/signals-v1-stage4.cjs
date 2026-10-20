// signals-v1 Stage 4 live check. ONE real Apollo pull, declared: 4 calls (GET users/api_profile, POST
// mixed_companies/search all visitors, the same search with the US/500+ filters, GET users/api_profile), <= 2 credits;
// the script aborts if the run records more than 4 calls. TEMP data only: 1 workspace (goals_sales on, added to
// SALES_ANALYTICS_BUSINESS_IDS for the local server only), 2 temp users (owner "Jack Zz", viewer). Seed: HomeLover's
// live partner names (+ owner team, stage, last touch, confirmed domains) and employer names are COPIED into the temp
// workspace so matching behaves like prod - read-only on HomeLover, nothing printed. API: viewer gates, one pull,
// second load = 0 calls, rows/flags/priorities vs the DB, phone fields absent, P1/P2 -> signals, credit row. UI
// (Playwright, serves build/ - run npm run build first): Signals pull line, Board "Visited" column, Tidy "Visited"
// suggestions, Viewer read-only, 1440 + 390 shots, report PDF prints. 0 Claude. Company names are never printed.
// Teardown deletes everything (the temp credit row goes with the workspace; its measured delta is printed).
// ~90-150 s, cap 4 min.  Usage: node scripts/verify/signals-v1-stage4.cjs <outdir>
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3992, tag = 'sig4-' + Date.now();
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const HL_TABLES = ['business_members', 'sales_goals', 'sales_partner_events', 'sales_week_goals', 'sales_targets', 'sales_opportunities', 'partner_domains', 'sales_suggestions', 'sales_tidy_runs', 'sales_signals', 'web_visits', 'visit_pull_runs', 'sales_visit_skip', 'apollo_credit_spend'];
const OUT = process.argv[2] || '/tmp';
const made = { biz: null, users: [] };
let srv, browser, log = '', pass = 0, total = 0, measured = null;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const DAY = 864e5;
const PHONE_SHAPE = /\d{3}[-. )]\s?\d{3}[-. ]\d{4}/;
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
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage(); page.setDefaultTimeout(12000);
  page.on('console', m => { if (m.type() === 'error' && !/favicon|net::ERR_FAILED|Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 160)); });
  page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
  // Syncs and the forced "Pull now" never run from the browser; the page-load pull is allowed (the server guard answers it with 0 calls).
  await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)/, r => r.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"blocked by verify script"}' }));
  await page.route(/\/goals\/visits\/pull$/, r => (JSON.parse(r.request().postData() || '{}').force ? r.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"blocked by verify script"}' }) : r.continue()));
  await page.addInitScript(([k, v]) => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(u.session)]);
  await page.goto(`http://localhost:${PORT}/?tab=today`); await page.waitForTimeout(3000);
  return { page, errs };
}
async function navSales(page, compact) {
  const menu = async () => { if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); } };
  await menu(); await page.getByLabel('Workspace').selectOption({ label: WS_NAME }); await page.waitForTimeout(2500);
  await menu(); await page.locator('#root').getByRole('button', { name: 'Goals & Sales', exact: true }).dispatchEvent('click'); await page.waitForTimeout(4000);
}
const drawerSel = 'aside[aria-labelledby="task-drawer-title"]';
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, animations: 'disabled', caret: 'hide' });
const tab = (page, name) => page.locator('#workspace-header-tabs').getByRole('button', { name }).first().click();
const mdLabel = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

(async () => {
  const hlBefore = await hl(); const t0 = Date.now();
  fs.mkdirSync(OUT, { recursive: true });
  try {
    WS_NAME = `ZZ Visits ${tag.slice(-4)}`;
    const T = made.biz = ins(await svc.from('businesses').insert({ name: WS_NAME, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}-jack@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
    const M = await user('Jack Zz', 'owner'), V = await user('Viewer Zz', 'viewer');
    const hlPartners = ins(await svc.from('sales_goals').select('id, name, pipeline_status, owner_team, co_owner_name, last_touch_at').eq('business_id', HOMELOVER).eq('goal_type', 'partnership').is('archived_at', null).limit(1000));
    const hlEmployers = ins(await svc.from('sales_opportunities').select('organization, org_type, stage, owner_team').eq('business_id', HOMELOVER).is('archived_at', null).limit(1000));
    const hlDomains = ins(await svc.from('partner_domains').select('goal_id, domain').eq('business_id', HOMELOVER).eq('confirmed', true).limit(2000));
    const idMap = new Map();
    for (const p of hlPartners) {
      const row = ins(await svc.from('sales_goals').insert({ business_id: T, goal_type: 'partnership', name: p.name, owner_user_id: M.id, pipeline_status: p.pipeline_status, owner_team: p.owner_team, co_owner_name: p.co_owner_name, last_touch_at: p.last_touch_at }).select('id').single());
      idMap.set(p.id, row.id);
    }
    if (hlEmployers.length) ins(await svc.from('sales_opportunities').insert(hlEmployers.map(o => ({ business_id: T, organization: o.organization, org_type: o.org_type, stage: o.stage, owner_team: o.owner_team, source: 'manual' }))).select('id'));
    const doms = hlDomains.filter(d => idMap.has(d.goal_id)).map(d => ({ business_id: T, goal_id: idMap.get(d.goal_id), domain: d.domain, confirmed: true, source: 'manual' }));
    if (doms.length) { const r = await svc.from('partner_domains').insert(doms); if (r.error) console.log(`seed domains skipped: ${r.error.message.slice(0, 80)}`); }
    console.log(`seed: workspace ${T}, ${hlPartners.length} partners + ${hlEmployers.length} opportunities + ${doms.length} confirmed domains copied by name (values not printed)`);

    srv = spawn('node', ['--dns-result-order=ipv4first', 'server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${T}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
    for (let i = 0; i < 60 && !log.includes(`port ${PORT}`); i++) await wait(250);
    const call = (u, method, path, body) => fetch(`http://localhost:${PORT}/api/sales/${T}/goals${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: `prospector_at=${encodeURIComponent(u.token)}` }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

    console.log('--- gates');
    ok('viewer GET visits/status 200 (not pulled yet)', (await call(V, 'GET', '/visits/status')).body.last_run === null);
    ok('viewer POST visits/pull refused (403) before any call', (await call(V, 'POST', '/visits/pull', { trigger: 'manual' })).status === 403);

    console.log('--- ONE real pull (declared: 4 Apollo calls, <= 2 credits)');
    const p1 = await call(M, 'POST', '/visits/pull', { trigger: 'manual' });
    const run = ins(await svc.from('visit_pull_runs').select('*').eq('business_id', T));
    const spend = ins(await svc.from('apollo_credit_spend').select('*').eq('business_id', T));
    measured = spend[0]?.credits ?? null;
    console.log(`pull: HTTP ${p1.status}, calls ${run[0]?.calls}, measured credits ${measured}, counts ${JSON.stringify(p1.body.counts || p1.body.error)}`);
    if (!run[0] || run[0].calls > 4) throw new Error(`pull made ${run[0]?.calls} calls - over the declared 4, aborting`);
    ok('pull: 200, ran, exactly 4 Apollo calls, run ok', p1.status === 200 && p1.body.ran && run.length === 1 && run[0].calls === 4 && run[0].status === 'ok', JSON.stringify(p1.body).slice(0, 160));
    ok('credit row: one, la_month this LA month, before/after balances, credits = before - after (<= 2)', spend.length === 1 && spend[0].la_month === today.slice(0, 7) && spend[0].credits === spend[0].balance_before - spend[0].balance_after && spend[0].credits <= 2, JSON.stringify({ c: spend[0]?.credits }));
    const visits = ins(await svc.from('web_visits').select('*').eq('business_id', T));
    ok(`web_visits: ${visits.length} rows for ${today}, one per company, counts match the reply`, visits.length === p1.body.counts.companies && visits.every(v => v.pulled_on === today) && new Set(visits.map(v => v.company_key)).size === visits.length);
    const pc = { P1: 0, P2: 0, P3: 0, P4: 0 }; for (const v of visits) pc[v.priority]++;
    console.log(`priorities: ${JSON.stringify(pc)} · us_500 ${visits.filter(v => v.us_500).length} · matched ${visits.filter(v => v.matched_id).length} · maybe_user ${visits.filter(v => v.maybe_user).length}`);
    ok('priority counts in the DB = the reply', ['P1', 'P2', 'P3', 'P4'].every(k => pc[k] === p1.body.counts[k]));
    ok('us_500 count in the DB = the reply (filtered search membership)', visits.filter(v => v.us_500).length === p1.body.counts.us_500);
    ok('no phone column and no phone shape or "@" in stored text', visits.every(v => !Object.keys(v).some(k => /phone/i.test(k))) && !visits.some(v => /@/.test(JSON.stringify([v.company_name, v.top_paths, v.priority_rule])) || PHONE_SHAPE.test(JSON.stringify([v.company_name, v.top_paths]))));
    ok('every row has a priority rule; P4 rows a noise reason; matched rows a type + id', visits.every(v => v.priority_rule && (v.priority !== 'P4' || v.noise_reason) && (!v.matched_id || ['partner', 'opportunity', 'target'].includes(v.matched_type))));
    ok('seed skip list written (4 rows)', (await svc.from('sales_visit_skip').select('id', { count: 'exact', head: true }).eq('business_id', T)).count === 4);
    const sigs = ins(await svc.from('sales_signals').select('*').eq('business_id', T));
    ok(`signals: ${sigs.length} web_visit rows = P1 + P2, status new, no person`, sigs.length === p1.body.counts.signals && sigs.length === pc.P1 + pc.P2 && sigs.every(s => s.source === 'web_visit' && s.status === 'new' && s.who === null), `${sigs.length} vs ${pc.P1 + pc.P2}`);
    ok('signal text has no "@" or phone shape', !sigs.some(s => /@/.test(`${s.signal} ${s.why_now}`) || PHONE_SHAPE.test(`${s.signal} ${s.why_now}`)));
    const again = await call(M, 'POST', '/visits/pull', { trigger: 'pageload' });
    const run2 = ins(await svc.from('visit_pull_runs').select('calls').eq('business_id', T));
    ok('second load the same day: ran false, still 4 calls, 1 credit row', again.status === 200 && again.body.ran === false && run2[0].calls === 4 && (await svc.from('apollo_credit_spend').select('id', { count: 'exact', head: true }).eq('business_id', T)).count === 1);
    const st = (await call(V, 'GET', '/visits/status')).body;
    ok('status: last run ok today, today counts = DB, not paused', st.last_run?.la_date === today && st.last_run.status === 'ok' && st.paused === null && ['P1', 'P2', 'P3', 'P4'].every(k => st.today[k] === pc[k]));
    const board = (await call(V, 'GET', '/pipeline-board')).body.rows;
    const matchedKeys = new Set(visits.filter(v => v.matched_id).map(v => `${{ partner: 'partner', opportunity: 'employer', target: 'target' }[v.matched_type]}:${v.matched_id}`));
    const visitedRows = board.filter(r => r.visited);
    ok(`board: ${visitedRows.length} rows carry "visited" = matched records shown on the board`, visitedRows.every(r => matchedKeys.has(`${r.type}:${r.id}`)) && visitedRows.length === board.filter(r => matchedKeys.has(`${r.type}:${r.id}`)).length);
    const tidy = await call(M, 'POST', '/tidy/run', { trigger: 'manual' });
    const sugg = ins(await svc.from('sales_suggestions').select('kind, ref_id, text').eq('business_id', T).eq('kind', 'visited_no_touch'));
    const eligible = visits.filter(v => v.matched_type === 'partner' && ['P1', 'P2'].includes(v.priority)).filter(v => { const p = hlPartners.find(x => idMap.get(x.id) === v.matched_id); return !p?.last_touch_at || Date.now() - Date.parse(p.last_touch_at) >= 14 * DAY; });
    ok(`Tidy: ${sugg.length} "visited, no touch" = matched P1/P2 partners untouched 14 d (${eligible.length})`, tidy.status === 200 && sugg.length === new Set(eligible.map(v => v.matched_id)).size && sugg.every(s => s.text.startsWith('Reach out to ')));

    console.log('--- UI');
    const build = fs.readdirSync(`${ROOT}/build/static/js`).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(`${ROOT}/build/static/js/${f}`, 'utf8')).join('\n');
    ok('bundle marker: "Website visits pulled" + "/visits/pull" + "Visited" in build/', build.includes('Website visits pulled') && build.includes('/visits/pull') && build.includes('Last website visit'));
    browser = await chromium.launch();
    const line = `Website visits pulled ${mdLabel(today)} · P1 ${pc.P1} · P2 ${pc.P2} · P3 ${pc.P3} · P4 ${pc.P4}`;
    for (const [width, height, compact] of [[1440, 900, false], [390, 844, true]]) {
      const { page, errs } = await newPage(M, width, height);
      await navSales(page, compact);
      const chip = page.locator('[data-today-chips] button', { hasText: 'Signals' });
      await chip.waitFor();
      ok(`${width}: Today chip "⚡ Signals (${sigs.length})"`, (await chip.innerText()).trim() === `⚡ Signals (${sigs.length})`, await chip.innerText());
      await chip.click();
      const drawer = page.locator(drawerSel);
      await drawer.getByRole('region', { name: 'Signals' }).waitFor(); await page.waitForTimeout(800);
      ok(`${width}: Signals shows the pull line with today's counts + Pull now`, (await drawer.getByRole('status', { name: 'Website visitor pull' }).innerText()).includes(line) && (await drawer.getByRole('button', { name: 'Pull now' }).count()) === 1);
      ok(`${width}: ${sigs.length} visit signals listed as "Website visit"`, (await drawer.locator('li[data-signal-id]').count()) === sigs.length && (await drawer.locator('li[data-signal-id]', { hasText: 'Website visit' }).count()) === sigs.length);
      await shot(page, `sig4-${width}-signals`);
      if (sugg.length) {
        await drawer.getByRole('button', { name: /^✦ Suggested/ }).click(); await page.waitForTimeout(800);
        ok(`${width}: Suggested lists the "Reach out to" rows`, (await drawer.getByText(/^Reach out to /).count()) >= sugg.length);
        await shot(page, `sig4-${width}-suggested`);
      }
      await page.keyboard.press('Escape'); await page.waitForTimeout(400);
      await page.goto(`http://localhost:${PORT}/?tab=pipeline`); await page.waitForTimeout(3000);
      await navSales(page, compact);
      await tab(page, /^Pipeline/); await page.waitForTimeout(3000);
      if (!compact) ok('1440: Board has a "Visited" column', (await page.getByRole('columnheader', { name: /Visited/ }).count()) >= 1);
      if (compact && visitedRows.length) ok('390: a matched row reads "Visited …" in the list', (await page.getByText(/Visited [A-Z][a-z]{2} \d/).count()) >= 1);
      await shot(page, `sig4-${width}-board`);
      ok(`${width}: no sideways scroll`, await noSideScroll(page));
      ok(`${width}: 0 console errors`, !errs.length, errs.join(' | '));
      await page.context().close();
    }
    const { page: rp, errs: rerrs } = await newPage(M, 1440, 900);
    await navSales(rp, false);
    await tab(rp, /^Reports/); await rp.waitForTimeout(2500);
    await rp.pdf({ path: `${OUT}/sig4-report.pdf`, landscape: true });
    ok('Weekly report PDF still prints', fs.statSync(`${OUT}/sig4-report.pdf`).size > 1000);
    ok('reports page: 0 console errors', !rerrs.length, rerrs.join(' | '));
    await rp.context().close();

    const { page: vp, errs: verrs } = await newPage(V, 1440, 900);
    await navSales(vp, false);
    await vp.getByRole('button', { name: /^Open tasks/ }).click();
    const vd = vp.locator(drawerSel);
    await vd.getByRole('button', { name: `⚡ Signals (${sigs.length})` }).click();
    await vd.getByRole('region', { name: 'Signals' }).waitFor(); await vp.waitForTimeout(800);
    ok('viewer: the pull line shows, no Pull now / Accept / Dismiss', (await vd.getByRole('status', { name: 'Website visitor pull' }).innerText()).includes(line) && (await vd.getByRole('button', { name: /Pull now|Accept|Dismiss|Upload/ }).count()) === 0);
    await shot(vp, 'sig4-1440-viewer-signals');
    ok('viewer: 0 console errors', !verrs.length, verrs.join(' | '));
    await vp.context().close();
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
