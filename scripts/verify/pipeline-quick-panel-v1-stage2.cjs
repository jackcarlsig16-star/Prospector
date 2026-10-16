// pipeline-quick-panel-v1 Stage 2 live check. TEMP data only: 1 workspace (goals_sales on, added to SALES_ANALYTICS_BUSINESS_IDS for the local server only), 2 temp users (owner "Jack Zz", viewer). Seed: 1 partner (Gallagher, replied, with a next step) + 1 employer opportunity (next action + date). UI (Playwright, serves build/ - run npm run build first): Member 1440 - Next step cell on the partner row (real next_step save, Esc revert), Next step + Due on the employer row (real next_action save, Tab to Due, real date set then cleared), partner Due dash + title, pencil on hover, cell click never opens the panel, the quick panel sits over the shell's Tasks tab, Export row count unchanged across the edits, Weekly report PDF prints; Member 390 - the phone list (no cell editors); Viewer 1440 - text only. 0 Claude, 0 Apollo / 0 syncs. HomeLover is only COUNTED (head requests). Teardown deletes everything. ~60-120s, cap 235s.
// Usage: node scripts/verify/pipeline-quick-panel-v1-stage2.cjs <outdir>
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const ExcelJS = require(ROOT + '/node_modules/exceljs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3990, tag = 'pqp2-' + Date.now();
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
const NEXT = 7, DUE = 8;
const cellOf = (page, key, col) => page.locator(`tr[data-key="${key}"] td`).nth(col);
const cells = (page, key) => page.evaluate(k => [...document.querySelectorAll(`tr[data-key="${k}"] td`)].map(td => td.textContent), key);

(async () => {
  const hlBefore = await hl(); const t0 = Date.now();
  fs.mkdirSync(OUT, { recursive: true });
  try {
    WS_NAME = `ZZ CellEdit ${tag.slice(-4)}`;
    const T = made.biz = ins(await svc.from('businesses').insert({ name: WS_NAME, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}-jack@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
    const M = await user('Jack Zz', 'owner'), V = await user('Viewer Zz', 'viewer');
    const [gallagher] = ins(await svc.from('sales_goals').insert([
      { business_id: T, goal_type: 'partnership', name: 'Gallagher', pipeline_status: 'replied', owner_user_id: M.id, category: '4. Mid-Market Benefits Brokers', tier: '2', hot: false, owner_team: 'upside', next_step: 'Send the one-pager' },
    ]).select());
    const [solidcore] = ins(await svc.from('sales_opportunities').insert({ business_id: T, organization: '[solidcore]', org_type: 'employer', stage: 'contacted', source: 'manual', next_action: 'Call Crystal back', next_action_date: '2026-10-20', notes: 'Crystal replied' }).select());
    const PK = `partner-${gallagher.id}`, EK = `employer-${solidcore.id}`;
    console.log(`seed: workspace ${T}, 1 partner, 1 opportunity`);

    srv = spawn('node', ['--dns-result-order=ipv4first', 'server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${T}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
    for (let i = 0; i < 60 && !log.includes(`port ${PORT}`); i++) await wait(250);
    const hdr = u => ({ 'Content-Type': 'application/json', Cookie: `prospector_at=${encodeURIComponent(u.token)}` });
    const call = (u, method, path, body) => fetch(`http://localhost:${PORT}/api/sales/${T}${path}`, { method, headers: hdr(u), body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
    const exportRows = async () => {
      const r = await fetch(`http://localhost:${PORT}/api/sales/${T}/goals/pipeline-board/export`, { headers: hdr(M) });
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await r.arrayBuffer()));
      const ws = wb.worksheets[0]; const rows = []; ws.eachRow(row => rows.push(row.values.slice(1).map(v => (v && v.text) || v || '')));
      return { status: r.status, bytes: Number(r.headers.get('content-length')) || null, rows };
    };
    const opp = () => svc.from('sales_opportunities').select('next_action, next_action_date').eq('id', solidcore.id).single().then(ins);
    const partner = () => svc.from('sales_goals').select('next_step, pipeline_status').eq('id', gallagher.id).single().then(ins);

    console.log('--- API');
    const exp0 = await exportRows();
    ok('member export 200 with a header + 2 rows before any edit', exp0.status === 200 && exp0.rows.length === 3, JSON.stringify({ status: exp0.status, n: exp0.rows.length }));
    ok('viewer PATCH partner next_step refused (403)', (await call(V, 'PATCH', `/goals/land/${gallagher.id}`, { next_step: 'x' })).status === 403);
    ok('viewer PATCH opportunity next_action refused (403)', (await call(V, 'PATCH', `/opportunities/${solidcore.id}`, { next_action: 'x' })).status === 403);

    console.log('--- UI member 1440');
    browser = await chromium.launch();
    { const { page, errs } = await newPage(M, 1440, 900);
      const pRow = page.locator(`tr[data-key="${PK}"]`);
      await pRow.hover(); await page.waitForTimeout(200);
      const pencil = await cellOf(page, PK, NEXT).locator('button').evaluate(b => { const s = getComputedStyle(b, '::after'); return { content: s.content, opacity: s.opacity, cursor: getComputedStyle(b).cursor }; });
      ok('row hover: faint pencil (::after ✎, opacity .7) + cursor: text on the Next step cell', pencil.content.includes('✎') && pencil.opacity === '0.7' && pencil.cursor === 'text', JSON.stringify(pencil));
      await cellOf(page, PK, NEXT).locator('button').click(); await page.waitForTimeout(200);
      const pInput = page.getByRole('textbox', { name: 'Next step for Gallagher' });
      const sel = await pInput.evaluate(i => ({ focused: document.activeElement === i, value: i.value, all: i.selectionStart === 0 && i.selectionEnd === i.value.length }));
      ok('partner Next step cell click -> input prefilled, focused, text selected; no panel opened', sel.focused && sel.value === 'Send the one-pager' && sel.all && (await page.getByRole('complementary').count()) === 0, JSON.stringify(sel));
      await shot(page, 'pqp2-1440-editor-open');
      await pInput.fill('Book the pilot call'); await pInput.press('Enter'); await page.waitForTimeout(1500);
      const p1 = await partner();
      ok('Enter saves the partner next_step to the DB (PATCH /land); stage untouched', p1.next_step === 'Book the pilot call' && p1.pipeline_status === 'replied', JSON.stringify(p1));
      ok('the row shows the new next step in place; no editor, no dimming', (await cells(page, PK))[NEXT] === 'Book the pilot call' && (await page.locator('.ui-cell-input, .ui-cell--saving').count()) === 0, JSON.stringify(await cells(page, PK)));
      await cellOf(page, PK, NEXT).locator('button').click(); await pInput.fill('junk typed then escaped'); await pInput.press('Escape'); await page.waitForTimeout(800);
      ok('Esc cancels: cell back to the saved text, DB unchanged', (await cells(page, PK))[NEXT] === 'Book the pilot call' && (await partner()).next_step === 'Book the pilot call');
      const pDue = await cellOf(page, PK, DUE).evaluate(td => ({ text: td.textContent, title: td.title, buttons: td.querySelectorAll('button').length }));
      ok('partner Due cell: "—", title "Partners have no due date yet", not editable', pDue.text === '—' && pDue.title === 'Partners have no due date yet' && pDue.buttons === 0, JSON.stringify(pDue));

      await cellOf(page, EK, NEXT).locator('button').click(); await page.waitForTimeout(200);
      const eInput = page.getByRole('textbox', { name: 'Next step for [solidcore]' });
      await eInput.fill('Send the deck'); await eInput.press('Tab'); await page.waitForTimeout(1500);
      const dueInput = page.getByLabel('Due for [solidcore]');
      ok('employer Next step + Tab: next_action saved (changed field only), Due editor open and focused', (await opp()).next_action === 'Send the deck' && (await dueInput.count()) === 1 && (await dueInput.evaluate(i => document.activeElement === i && i.type === 'date' && i.value)) === '2026-10-20', JSON.stringify(await opp()));
      ok('employer Due column fits the native date editor (no overflow clip)', await dueInput.evaluate(i => i.getBoundingClientRect().width >= 80 && i.scrollWidth <= i.clientWidth + 1), JSON.stringify(await dueInput.evaluate(i => ({ w: i.getBoundingClientRect().width, sw: i.scrollWidth, cw: i.clientWidth }))));
      await dueInput.fill('2026-10-27'); await dueInput.press('Enter'); await page.waitForTimeout(1500);
      const o1 = await opp();
      ok('Due Enter saves next_action_date = 2026-10-27; cell shows Oct 27', o1.next_action_date === '2026-10-27' && (await cells(page, EK))[DUE] === 'Oct 27', JSON.stringify({ o1, cells: await cells(page, EK) }));
      ok('the employer next_action was not re-sent with the date (DB still "Send the deck")', o1.next_action === 'Send the deck');
      await cellOf(page, EK, DUE).locator('button').click(); await page.waitForTimeout(200);
      await dueInput.fill(''); await dueInput.press('Enter'); await page.waitForTimeout(1500);
      const o2 = await opp();
      ok('clearing the Due saves null; cell back to "—"', o2.next_action_date === null && (await cells(page, EK))[DUE] === '—', JSON.stringify({ o2, cells: await cells(page, EK) }));
      ok('cell clicks never opened a panel; URL still pipeline/board', (await page.getByRole('complementary').count()) === 0 && (await state(page)) === 'pipeline/board');

      await page.getByRole('button', { name: 'Gallagher', exact: true }).first().click();
      const panel = page.getByRole('complementary', { name: 'Gallagher' }); await panel.waitFor(); await page.waitForTimeout(300);
      const over = await page.evaluate(() => { const tab = document.querySelector('button[aria-label^="Open tasks"]'); if (!tab) return 'no tab'; const r = tab.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return el === tab || tab.contains(el) ? 'tab on top' : 'panel on top'; });
      ok('the quick panel (SidePanel) now sits over the shell\'s Tasks side tab', over === 'panel on top', over);
      ok('the quick panel shows the cell-saved next step', (await panel.getByLabel('Next step').inputValue()) === 'Book the pilot call');
      await page.keyboard.press('Escape'); await page.waitForTimeout(400);

      const exp1 = await exportRows();
      ok('Export joint sheet: same row count after the edits (header + 2); the sheet carries the new values', exp1.status === 200 && exp1.rows.length === exp0.rows.length && JSON.stringify(exp1.rows).includes('Book the pilot call') && JSON.stringify(exp1.rows).includes('Send the deck'), JSON.stringify({ n: exp1.rows.length, was: exp0.rows.length }));
      ok('Export joint sheet + Update from sheet buttons still on the Board', (await page.getByRole('button', { name: /Export joint sheet|Update from sheet/ }).count()) === 2);
      await page.locator('#workspace-header-tabs').getByRole('button', { name: /^Reports/ }).first().click(); await page.waitForTimeout(1500);
      await page.locator('.ui-seg').getByRole('button', { name: 'Scorecard', exact: true }).first().click(); await page.waitForTimeout(1000);
      await page.getByRole('button', { name: 'Export', exact: true }).click(); await page.waitForTimeout(300);
      await page.getByRole('menuitem', { name: 'Weekly report PDF' }).click(); await page.waitForTimeout(1200);
      ok('Export › Weekly report PDF prints once with one print area', (await page.evaluate(() => window.__prints)) === 1 && (await page.locator('#sales-analytics-print-area').count()) === 1);
      ok('1440 member: 0 console errors', !errs.length, errs.join(' | '));
      await page.context().close(); }

    console.log('--- UI member 390');
    { const { page, errs } = await newPage(M, 390, 844);
      ok('390: the phone list shows the saved next step; no cell editors on the phone list (edits go through the panels)', (await page.locator('li[data-row]').filter({ hasText: 'Book the pilot call' }).count()) === 1 && (await page.locator('.ui-cell').count()) === 0);
      await shot(page, 'pqp2-390-board');
      ok('390: no sideways scroll', await noSideScroll(page));
      ok('390 member: 0 console errors', !errs.length, errs.join(' | '));
      await page.context().close(); }

    console.log('--- UI viewer 1440');
    { const { page, errs } = await newPage(V, 1440, 900);
      const pc = await cells(page, PK), ec = await cells(page, EK);
      ok('viewer: Next step / Due are plain text (no .ui-cell buttons anywhere), values visible', pc[NEXT] === 'Book the pilot call' && ec[NEXT] === 'Send the deck' && (await page.locator('.ui-cell').count()) === 0, JSON.stringify({ pc, ec }));
      await shot(page, 'pqp2-1440-viewer');
      ok('1440 viewer: 0 console errors', !errs.length, errs.join(' | '));
      await page.context().close(); }

    const bundle = fs.readdirSync(ROOT + '/build/static/js').filter(f => /^main\..*\.js$/.test(f)).map(f => fs.readFileSync(`${ROOT}/build/static/js/${f}`, 'utf8')).join('');
    ok('bundle marker: ui-cell-input + ui-cell--saving + "Partners have no due date yet" are in build/', bundle.includes('ui-cell-input') && bundle.includes('ui-cell--saving') && bundle.includes('Partners have no due date yet'));
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
