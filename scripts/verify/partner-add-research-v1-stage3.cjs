// partner-add-research-v1 REV3 Stage 3 live check. TEMP data only: 1 workspace (goals_sales on, added to SALES_ANALYTICS_BUSINESS_IDS for the local server only), 2 temp users ("Jack Zz" owner, viewer), 2 partners: "Brown Zz" with a seeded done research run (site brownzz.example, not yet confirmed) whose domain is an Apollo account in a seeded accounts snapshot, and "Nowhere Zz" with a confirmed domain that isn't. The local server runs with FIXTURE APOLLO preloaded (api/sales/testing/apolloFixture.mjs: fetch to api.apollo.io answered from a fixture, the real allowlist + counter run) - 0 real Apollo calls, 0 Claude. API: Viewer 403, check found -> 2 people rows, no account -> one enrich to-do, again -> no second. UI (Playwright, serves build/ - run npm run build first): Confirm site -> "Apollo: 2 people" + People refreshed; Check Apollo -> enrich line + to-do in the drawer; Viewer no buttons; 1440 + 390 shots. HomeLover is only COUNTED. Teardown deletes everything. ~90s, cap 235s.
// Usage: node scripts/verify/partner-add-research-v1-stage3.cjs <outdir>
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3993, tag = 'par3-' + Date.now();
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const HL_TABLES = ['sales_goals', 'partner_contacts', 'partner_domains', 'sales_week_goals', 'research_runs', 'sales_sync_runs', 'sales_raw_snapshots'];
const OUT = process.argv[2] || '/tmp';
const FIXTURE = { 'acc-brownzz': [{ id: 'fx1', first_name: 'Dana', last_name: 'Zz', title: 'VP Partnerships' }, { id: 'fx2', first_name: 'Lee', last_name: 'Zz', title: 'Benefits Director' }] };
const made = { biz: null, users: [] };
let srv, browser, log = '', pass = 0, total = 0, blocked = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const wait = ms => new Promise(r => setTimeout(r, ms));
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
    for (const t of ['partner_contacts', 'partner_domains', 'sales_partner_events', 'sales_week_goal_steps', 'sales_week_goals', 'research_runs', 'sales_raw_snapshots', 'sales_sync_runs', 'sales_goals', 'business_members', 'auth_events']) {
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
  await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)/, r => { blocked++; r.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"blocked by verify script"}' }); });
  await page.route(/\/goals\/tidy\/run$/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ran":false,"reason":"blocked by verify script"}' }));
  await page.route(/\/research$/, r => (r.request().method() === 'POST' ? r.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"research blocked by verify script"}' }) : r.continue()));
  await page.addInitScript(([k, v]) => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(u.session)]);
  await page.goto(`http://localhost:${PORT}/?tab=pipeline&view=partners`); await page.waitForTimeout(3000);
  const compact = width < 900;
  const menu = async () => { if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); } };
  await menu(); await page.getByLabel('Workspace').selectOption({ label: WS_NAME }); await page.waitForTimeout(2500);
  await menu(); await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
  await page.locator('#workspace-header-tabs').getByRole('button', { name: /^Pipeline/ }).first().click(); await page.waitForTimeout(1800);
  await page.locator('.ui-seg').getByRole('button', { name: 'Partner workflow', exact: true }).first().click().catch(() => {}); await page.waitForTimeout(1800);
  await page.locator('[data-partner-id]').first().waitFor({ timeout: 15000 });
  return { page, errs };
}
const row = (page, name) => page.locator('[data-partner-id]', { hasText: name }).first();
const expand = async (page, name) => { const r = row(page, name); await r.locator('button[aria-expanded]').first().click(); await page.waitForTimeout(1500); return r; };
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, animations: 'disabled', caret: 'hide' });

(async () => {
  const hlBefore = await hl(); const t0 = Date.now();
  fs.mkdirSync(OUT, { recursive: true });
  try {
    WS_NAME = `ZZ Apollo ${tag.slice(-4)}`;
    const T = made.biz = ins(await svc.from('businesses').insert({ name: WS_NAME, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}-jack@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
    const J = await user('Jack Zz', 'owner'), V = await user('Viewer Zz', 'viewer');
    const goals = ins(await svc.from('sales_goals').insert([
      { business_id: T, goal_type: 'partnership', name: 'Brown Zz', owner_user_id: J.id, pipeline_status: 'not_started' },
      { business_id: T, goal_type: 'partnership', name: 'Nowhere Zz', owner_user_id: J.id, pipeline_status: 'not_started' },
    ]).select());
    const gid = n => goals.find(g => g.name === n).id;
    ins(await svc.from('partner_domains').insert({ business_id: T, goal_id: gid('Nowhere Zz'), domain: 'nowherezz.example', confirmed: true, source: 'manual' }).select());
    const run = ins(await svc.from('sales_sync_runs').insert({ business_id: T, trigger: 'manual', status: 'success', finished_at: new Date().toISOString() }).select().single());
    ins(await svc.from('sales_raw_snapshots').insert({ business_id: T, run_id: run.id, entity: 'accounts', payload: [{ id: 'acc-brownzz', name: 'Brown Zz', domain: 'brownzz.example' }] }).select());
    ins(await svc.from('research_runs').insert({ business_id: T, entity_type: 'partner', entity_id: gid('Brown Zz'), trigger: 'manual', status: 'done', created_by: J.id,
      result: { website: 'https://brownzz.example/', domain: 'brownzz.example', website_confidence: 'high', source_urls: ['https://brownzz.example/about'], summary: 'Fixture broker (seeded research, no Claude).', web_searches: 0 } }).select());
    console.log(`seed: workspace ${T}, 2 partners, 1 confirmed domain, 1 accounts snapshot, 1 seeded research run`);

    srv = spawn('node', ['--dns-result-order=ipv4first', '--import', './api/sales/testing/apolloFixture.mjs', 'server.js'], { cwd: ROOT, env: { ...process.env, APOLLO_FIXTURE: JSON.stringify(FIXTURE), PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${T}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
    for (let i = 0; i < 60 && !log.includes(`port ${PORT}`); i++) await wait(250);
    ok('server runs with the fixture Apollo installed', log.includes('[apollo fixture] installed'));
    const call = (u, method, path, body) => fetch(`http://localhost:${PORT}/api/sales/${T}/goals${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: `prospector_at=${encodeURIComponent(u.token)}` }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
    const rows = async (t, f = q => q) => ins(await f(svc.from(t).select('*').eq('business_id', T)));

    console.log('--- API');
    ok('Viewer cannot run the check (403)', (await call(V, 'POST', `/partners/${gid('Nowhere Zz')}/apollo-check`)).status === 403);
    const n1 = await call(J, 'POST', `/partners/${gid('Nowhere Zz')}/apollo-check`);
    ok('no Apollo account -> no_account, 0 calls, ONE open enrich to-do for Jack, due +2 d', n1.status === 200 && n1.body.status === 'no_account' && n1.body.calls === 0 && n1.body.todo_created === true && n1.body.todo.text === 'Enrich Nowhere Zz in Apollo: not in Apollo yet' && n1.body.todo.owner_user_id === J.id, JSON.stringify(n1.body).slice(0, 200));
    const n2 = await call(J, 'POST', `/partners/${gid('Nowhere Zz')}/apollo-check`);
    const enrich = (await rows('sales_week_goals')).filter(t => t.link_id === gid('Nowhere Zz') && t.status === 'open');
    ok('a second check makes no second to-do', n2.body.todo_created === false && n2.body.todo.id === n1.body.todo.id && enrich.length === 1);
    ok('the to-do is a plain open to-do linked to the partner, category Apollo', enrich[0].kind === 'todo' && enrich[0].link_type === 'partner' && enrich[0].category === 'Apollo');
    await svc.from('sales_week_goals').delete().eq('id', enrich[0].id);

    console.log('--- UI');
    browser = await chromium.launch();
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      await svc.from('partner_contacts').delete().eq('business_id', T);
      await svc.from('partner_domains').delete().eq('business_id', T).eq('goal_id', gid('Brown Zz'));
      await svc.from('sales_week_goals').delete().eq('business_id', T);
      await svc.from('sales_goals').update({ company_domain: null }).eq('id', gid('Brown Zz'));
      const { page, errs } = await newPage(J, width, height);
      const b = await expand(page, 'Brown Zz');
      const card = b.locator('section[aria-label="Research on Brown Zz"]');
      await card.getByRole('button', { name: 'Confirm site' }).click();
      await card.getByText('Apollo: 2 people').waitFor();
      ok(`${width}: Confirm site -> "Apollo: 2 people" with names + titles`, /Dana Zz · VP Partnerships/.test(await card.getByRole('list', { name: 'Apollo people found' }).innerText()));
      const people = await rows('partner_contacts', q => q.eq('goal_id', gid('Brown Zz')));
      ok(`${width}: 2 partner_contacts rows (source apollo, no email)`, people.length === 2 && people.every(p => p.source === 'apollo' && !p.email));
      await page.waitForTimeout(1200);
      ok(`${width}: People drawer summary refreshed to 2 people`, /PEOPLE\s*2 people/i.test(await b.innerText()), (await b.innerText()).match(/PEOPLE[^\n]*/i)?.[0]);
      await shot(page, `par3-${width}-found`);
      await b.locator('button[aria-expanded]').first().click(); await page.waitForTimeout(500);
      const nz = await expand(page, 'Nowhere Zz');
      const ncard = nz.locator('section[aria-label="Research on Nowhere Zz"]');
      await ncard.getByRole('button', { name: 'Check Apollo' }).click();
      await ncard.getByText(/Nowhere Zz is not in Apollo yet · to-do added/).waitFor();
      ok(`${width}: Check Apollo -> enrich line + Export to Apollo (CSV) link`, (await ncard.getByRole('link', { name: 'Export to Apollo (CSV)' }).count()) === 1);
      await ncard.getByRole('button', { name: 'Check again' }).click(); await page.waitForTimeout(1200);
      ok(`${width}: Check again -> "to-do already open", still one`, /to-do already open/.test(await ncard.innerText()) && (await rows('sales_week_goals', q => q.eq('status', 'open'))).length === 1);
      await shot(page, `par3-${width}-enrich`);
      ok(`${width}: no sideways scroll`, await noSideScroll(page));
      ok(`${width}: 0 console errors`, !errs.length, errs.join(' | '));
      await page.context().close();
    }
    const { page: vp, errs: verrs } = await newPage(V, 1440, 900);
    const vr = await expand(vp, 'Nowhere Zz');
    ok('viewer: no Check Apollo / Confirm site buttons', (await vr.getByRole('button', { name: /Check Apollo|Check again|Confirm site/ }).count()) === 0);
    await shot(vp, 'par3-1440-viewer');
    ok('viewer: 0 console errors', !verrs.length, verrs.join(' | '));
    await vp.context().close();
    const answered = (log.match(/\[apollo fixture\] answered POST \/contacts\/search/g) || []).length;
    ok(`0 real Apollo calls: the fixture answered all ${answered} /contacts/search reads (expected 2 - one per Confirm site; no-account checks make none)`, answered === 2, String(answered));
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
    console.log(`${pass}/${total} passed · ${Math.round((Date.now() - t0) / 1000)}s · Claude 0 · real Apollo 0 (fixture)`);
    process.exit(pass === total ? 0 : 1);
  }
})();
