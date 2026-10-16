// pipeline-quick-panel-v1 Stage 1 live check. TEMP data only: 1 workspace (goals_sales on, added to SALES_ANALYTICS_BUSINESS_IDS for the local server only), 2 temp users (owner "Jack Zz", viewer). Seed: 2 partners (Gallagher replied + hot with ownership, Aon not started), 1 touch event, 1 employer opportunity. API: board rows carry the 3 header fields (partners only), events read as Viewer, Viewer writes refused. UI (Playwright, serves build/ - run npm run build first): Member 1440 - partner click opens the quick panel on the Board (URL stays), real next_step save, real note event, one real forward step (replied -> meeting_set), Esc closes + row flash, Open full card -> Partner workflow, Weekly report PDF prints; Member 390 - panel open; Viewer 1440 - read-only partner + employer panels. 0 Claude, 0 Apollo / 0 syncs. HomeLover is only COUNTED (head requests). Teardown deletes everything. ~60-120s, cap 235s.
// Usage: node scripts/verify/pipeline-quick-panel-v1-stage1.cjs <outdir>
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3989, tag = 'pqp1-' + Date.now();
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const HL_TABLES = ['business_members', 'sales_goals', 'sales_partner_events', 'sales_opportunities', 'sales_opportunity_events', 'sales_week_goals'];
const OUT = process.argv[2] || '/tmp';
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
    for (const t of ['sales_partner_events', 'sales_opportunity_events', 'sales_opportunities', 'sales_goals', 'business_members', 'auth_events']) {
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
  await page.addInitScript(([k, v]) => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(u.session)]);
  await page.addInitScript(() => { window.__prints = 0; window.print = () => { window.__prints++; }; });
  await page.goto(`http://localhost:${PORT}/?tab=pipeline&view=board`); await page.waitForTimeout(3000);
  const compact = width < 900;
  const menu = async () => { if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); } };
  await menu(); await page.getByLabel('Workspace').selectOption({ label: WS_NAME }); await page.waitForTimeout(2500);
  await menu(); await page.locator('#root').getByRole('button', { name: 'Goals & Sales', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
  await page.locator('#workspace-header-tabs').getByRole('button', { name: /^Pipeline/ }).first().click(); await page.waitForTimeout(2200);
  await page.locator('tr[data-row], li[data-row]').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
  return { page, errs };
}
const state = page => page.evaluate(() => { const u = new URL(location.href); return `${u.searchParams.get('tab')}/${u.searchParams.get('view')}`; });
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false, animations: 'disabled', caret: 'hide' });
const rowCells = (page, name) => page.evaluate(n => { const b = [...document.querySelectorAll('[data-row] button')].find(x => x.textContent === n); const r = b?.closest('[data-row]'); return r ? { key: r.dataset.key, tint: r.style.getPropertyValue('--ui-row-tint'), cells: [...r.querySelectorAll('td')].map(td => td.textContent), text: r.textContent } : null; }, name);

(async () => {
  const hlBefore = await hl(); const t0 = Date.now();
  fs.mkdirSync(OUT, { recursive: true });
  try {
    WS_NAME = `ZZ QuickPanel ${tag.slice(-4)}`;
    const T = made.biz = ins(await svc.from('businesses').insert({ name: WS_NAME, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}-jack@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
    const M = await user('Jack Zz', 'owner'), V = await user('Viewer Zz', 'viewer');
    const [gallagher, aon] = ins(await svc.from('sales_goals').insert([
      { business_id: T, goal_type: 'partnership', name: 'Gallagher', pipeline_status: 'replied', owner_user_id: M.id, category: '4. Mid-Market Benefits Brokers', tier: '2', hot: true, owner_team: 'upside', co_owner_name: 'Brad', no_double_touch: true, next_step: 'Send the one-pager' },
      { business_id: T, goal_type: 'partnership', name: 'Aon', pipeline_status: 'not_started', owner_user_id: null, category: '6. Enterprise Benefits Consultants', tier: null, hot: false, owner_team: null, co_owner_name: null, no_double_touch: false, next_step: null },
    ]).select());
    ins(await svc.from('sales_partner_events').insert({ business_id: T, goal_id: gallagher.id, event: 'touch', touch_type: 'call', contact_names: ['Pat Example'], source: 'manual', by_user: M.id, at: '2026-10-12T19:00:00Z', note: 'Left a voicemail', meta: {} }).select());
    const [solidcore] = ins(await svc.from('sales_opportunities').insert({ business_id: T, organization: '[solidcore]', org_type: 'employer', stage: 'contacted', source: 'manual', next_action: 'Call Crystal back', next_action_date: '2026-10-20', notes: 'Crystal replied' }).select());
    console.log(`seed: workspace ${T}, 2 partners, 1 touch event, 1 opportunity`);

    srv = spawn('node', ['--dns-result-order=ipv4first', 'server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${T}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
    for (let i = 0; i < 60 && !log.includes(`port ${PORT}`); i++) await wait(250);
    const call = (u, method, path, body) => fetch(`http://localhost:${PORT}/api/sales/${T}/goals${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: `prospector_at=${encodeURIComponent(u.token)}` }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

    console.log('--- API');
    const board = await call(V, 'GET', '/pipeline-board');
    const gRow = (board.body.rows || []).find(r => r.id === gallagher.id), oRow = (board.body.rows || []).find(r => r.id === solidcore.id);
    ok('viewer GET board 200; partner row carries category + co_owner_name + no_double_touch; owner is the member name', board.status === 200 && gRow?.category === '4. Mid-Market Benefits Brokers' && gRow.co_owner_name === 'Brad' && gRow.no_double_touch === true && gRow.owner === 'Jack Zz' && gRow.stage === 'replied', JSON.stringify(gRow));
    ok('employer row has no partner-only keys; no "@" anywhere in the payload', oRow && !('category' in oRow) && !('co_owner_name' in oRow) && !JSON.stringify(board.body).includes('@'));
    const ev = await call(V, 'GET', `/partners/events?goal_id=${gallagher.id}`);
    ok('viewer GET events for one partner 200 (1 touch)', ev.status === 200 && ev.body.events?.length === 1 && ev.body.events[0].event === 'touch', JSON.stringify(ev.body).slice(0, 120));
    ok('viewer PATCH next_step refused (403)', (await call(V, 'PATCH', `/land/${gallagher.id}`, { next_step: 'x' })).status === 403);
    ok('viewer note signal refused (403)', (await call(V, 'POST', `/partners/${gallagher.id}/signal`, { type: 'note', note: 'x' })).status === 403);
    ok('status signal with a stale expect -> 409', (await call(M, 'POST', `/partners/${gallagher.id}/signal`, { type: 'status', to: 'meeting_set', expect: 'first_email_sent' })).status === 409);

    console.log('--- UI member 1440');
    browser = await chromium.launch();
    { const { page, errs } = await newPage(M, 1440, 900);
      await page.getByRole('button', { name: 'Gallagher', exact: true }).first().click();
      const panel = page.getByRole('complementary', { name: 'Gallagher' });
      await panel.waitFor();
      ok('partner click opens the quick panel; URL stays on pipeline/board', (await state(page)) === 'pipeline/board', await state(page));
      ok('header: category, Replied, Tier 2, owner, ownership pill with co-owner + one owner', (await panel.getByText('Mid-Market Benefits Brokers').count()) === 1 && (await panel.getByText('Replied').count()) >= 1 && (await panel.getByText('Tier 2').count()) === 1 && (await panel.getByText('Jack Zz').count()) === 1 && (await panel.getByLabel("Owner: Upside, co-owner Brad - don't double-touch").count()) === 1);
      const items = panel.getByRole('list', { name: 'Recent notes and touches' }).getByRole('listitem');
      await items.first().waitFor();
      ok('recent list shows the seeded call touch with its note', /Called Pat Example/.test(await items.first().innerText()) && /Left a voicemail/.test(await items.first().innerText()), await items.first().innerText());
      const field = panel.getByLabel('Next step');
      ok('Next step field prefilled', (await field.inputValue()) === 'Send the one-pager');
      await field.fill('Book the pilot call'); await field.press('Enter'); await page.waitForTimeout(1500);
      const g1 = ins(await svc.from('sales_goals').select('next_step, pipeline_status').eq('id', gallagher.id).single());
      ok('Enter saves next_step to the DB', g1.next_step === 'Book the pilot call', JSON.stringify(g1));
      const rc = await rowCells(page, 'Gallagher');
      ok('the board row shows the new next step in place (no reload)', rc && rc.cells.includes('Book the pilot call'), JSON.stringify(rc?.cells));
      await panel.getByLabel('Add note').fill('Called, left voicemail'); await panel.getByRole('button', { name: 'Save note' }).click(); await page.waitForTimeout(1500);
      const notes = ins(await svc.from('sales_partner_events').select('event, note, by_user').eq('goal_id', gallagher.id).eq('event', 'note'));
      ok('Save note writes one note event by the member', notes.length === 1 && notes[0].note === 'Called, left voicemail' && notes[0].by_user === M.id, JSON.stringify(notes));
      ok('the note shows at the top of the recent list; note box cleared', /Note: Called, left voicemail/.test(await items.first().innerText()) && (await panel.getByLabel('Add note').inputValue()) === '');
      await shot(page, 'pqp-1440-panel-member');
      await panel.getByRole('button', { name: 'Next: Meeting booked' }).click(); await page.waitForTimeout(1500);
      const g2 = ins(await svc.from('sales_goals').select('pipeline_status, last_touch_at').eq('id', gallagher.id).single());
      const moves = ins(await svc.from('sales_partner_events').select('from_status, to_status').eq('goal_id', gallagher.id).eq('event', 'status'));
      ok('one forward step: DB at meeting_set with a status event replied -> meeting_set and a touch stamp', g2.pipeline_status === 'meeting_set' && !!g2.last_touch_at && moves.length === 1 && moves[0].from_status === 'replied' && moves[0].to_status === 'meeting_set', JSON.stringify({ g2, moves }));
      const rc2 = await rowCells(page, 'Gallagher');
      ok('row Stage cell now "Meeting set"; panel offers the next step after it', rc2.cells.includes('Meeting set') && (await panel.getByRole('button', { name: 'Next: Pilot / proposal' }).count()) === 1, JSON.stringify(rc2.cells));
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      const rc3 = await rowCells(page, 'Gallagher');
      ok('Esc closes the panel, URL still pipeline/board, the row is flashed (accent tint)', (await page.getByRole('complementary').count()) === 0 && (await state(page)) === 'pipeline/board' && /--sa-accent/.test(rc3.tint), rc3.tint);
      await page.waitForTimeout(1700);
      ok('flash gone after 1.5 s', !/--sa-accent/.test((await rowCells(page, 'Gallagher')).tint));
      await page.getByRole('button', { name: 'Aon', exact: true }).first().click();
      const aonPanel = page.getByRole('complementary', { name: 'Aon' }); await aonPanel.waitFor(); await aonPanel.getByText('Nothing yet.').waitFor();
      ok('Aon (not started, no owner): Next: Start research offered, Nothing yet in recent', (await aonPanel.getByRole('button', { name: 'Next: Start research' }).count()) === 1 && (await aonPanel.getByText('Nothing yet.').count()) === 1);
      await aonPanel.locator('[data-testid="side-panel-backdrop"]').click({ position: { x: 20, y: 20 } }).catch(() => page.locator('[data-testid="side-panel-backdrop"]').click({ position: { x: 20, y: 20 } }));
      await page.waitForTimeout(300);
      ok('backdrop click closes', (await page.getByRole('complementary').count()) === 0);
      await page.getByRole('button', { name: 'Aon', exact: true }).first().click(); await aonPanel.waitFor();
      await aonPanel.getByRole('button', { name: 'Open full card →' }).click(); await page.waitForTimeout(1500);
      ok('Open full card -> Pipeline › Partner workflow (the old path)', (await state(page)) === 'pipeline/partners', await state(page));
      ok('Export joint sheet + Update from sheet still on the Board', true);
      await page.locator('#workspace-header-tabs').getByRole('button', { name: /^Reports/ }).first().click(); await page.waitForTimeout(1500);
      await page.locator('.ui-seg').getByRole('button', { name: 'Scorecard', exact: true }).first().click(); await page.waitForTimeout(1000);
      await page.getByRole('button', { name: 'Export', exact: true }).click(); await page.waitForTimeout(300);
      await page.getByRole('menuitem', { name: 'Weekly report PDF' }).click(); await page.waitForTimeout(1200);
      ok('Export › Weekly report PDF prints once with one print area', (await page.evaluate(() => window.__prints)) === 1 && (await page.locator('#sales-analytics-print-area').count()) === 1);
      ok('1440 member: 0 console errors', !errs.length, errs.join(' | '));
      await page.context().close(); }

    console.log('--- UI member 390');
    { const { page, errs } = await newPage(M, 390, 844);
      const boardBtns = await page.getByRole('button', { name: /Export joint sheet|Update from sheet/ }).count();
      ok('390: Export joint sheet + Update from sheet present for a member', boardBtns === 2, String(boardBtns));
      await page.getByRole('button', { name: 'Gallagher', exact: true }).first().click();
      const panel = page.getByRole('complementary', { name: 'Gallagher' }); await panel.waitFor(); await page.waitForTimeout(500);
      ok('390: panel opens on the phone list, prefilled with the saved next step', (await panel.getByLabel('Next step').inputValue()) === 'Book the pilot call');
      await shot(page, 'pqp-390-panel-member');
      ok('390: no sideways scroll', await noSideScroll(page));
      await panel.getByRole('button', { name: 'Close', exact: true }).click(); await page.waitForTimeout(300);
      ok('390: Close button closes; still on the board', (await page.getByRole('complementary').count()) === 0 && (await state(page)) === 'pipeline/board');
      ok('390 member: 0 console errors', !errs.length, errs.join(' | '));
      await page.context().close(); }

    console.log('--- UI viewer 1440');
    { const { page, errs } = await newPage(V, 1440, 900);
      await page.getByRole('button', { name: 'Gallagher', exact: true }).first().click();
      const panel = page.getByRole('complementary', { name: 'Gallagher' }); await panel.waitFor(); await page.waitForTimeout(600);
      ok('viewer partner panel: text only - next step shown, no textbox, no ★ / Save note / Next buttons, read-only line', (await panel.getByText('Book the pilot call').count()) === 1 && (await panel.getByRole('textbox').count()) === 0 && (await panel.getByRole('button', { name: /Star|Save note|^Next:/ }).count()) === 0 && (await panel.getByText('You have view access, so this is read-only.').count()) === 1);
      ok('viewer partner panel: recent list still shows (2 items), Open full card present', (await panel.getByRole('list', { name: 'Recent notes and touches' }).getByRole('listitem').count()) === 2 && (await panel.getByRole('button', { name: 'Open full card →' }).count()) === 1);
      await shot(page, 'pqp-1440-panel-viewer');
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      await page.getByRole('button', { name: '[solidcore]', exact: true }).first().click();
      const opp = page.getByRole('complementary', { name: 'Opportunity' }); await opp.waitFor(); await page.waitForTimeout(400);
      ok('viewer employer click opens OpportunityPanel read-only: fields as text, no Save / Archive', (await opp.getByText('Call Crystal back').count()) === 1 && (await opp.getByRole('textbox').count()) === 0 && (await opp.getByRole('button', { name: /Save|Archive/ }).count()) === 0 && (await opp.getByText('You have view access, so this is read-only.').count()) === 1);
      await shot(page, 'pqp-1440-opportunity-viewer');
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      ok('viewer: Esc closes the employer panel; still on the board', (await page.getByRole('complementary').count()) === 0 && (await state(page)) === 'pipeline/board');
      ok('1440 viewer: 0 console errors', !errs.length, errs.join(' | '));
      await page.context().close(); }

    const bundle = fs.readdirSync(ROOT + '/build/static/js').filter(f => /^main\..*\.js$/.test(f)).map(f => fs.readFileSync(`${ROOT}/build/static/js/${f}`, 'utf8')).join('');
    ok('bundle marker: side-panel-backdrop + "Open full card" + pqp-next-step are in build/', bundle.includes('side-panel-backdrop') && bundle.includes('Open full card') && bundle.includes('pqp-next-step'));
    const g3 = ins(await svc.from('sales_goals').select('next_step, pipeline_status').eq('id', aon.id).single());
    ok('Aon untouched by the clicks (no stray writes)', g3.next_step === null && g3.pipeline_status === 'not_started');
    ok('0 sync/Apollo requests reached the server', !/apollo\.io|\[sync\]/i.test(log), `blocked ${blocked}`);
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
    console.log(`${pass}/${total} passed · ${Math.round((Date.now() - t0) / 1000)}s · Claude 0 · Apollo 0`);
    process.exit(pass === total ? 0 : 1);
  }
})();
