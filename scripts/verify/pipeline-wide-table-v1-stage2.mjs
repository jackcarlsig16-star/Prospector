// pipeline-wide-table-v1 Stage 2 bar 4. TEMP data: 1 workspace + 2 temp users (owner, viewer), torn down via tempGuard. HomeLover: read-only - its board rows (and its opportunities list, for the employer click-through) are loaded
// once each through the real route functions with the service key and served into the temp page by route intercept. 0 Apollo
// (sync/apollo requests aborted), 0 Claude, 0 writes to HomeLover (counted before/after). Serves build/ (run npm run build first).
// Usage: node scripts/verify/pipeline-wide-table-v1-stage2.mjs <outdir>   ~2 min, cap 230 s.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const OUT = process.argv[2] || path.join(ROOT, 'build', 'verify-shots');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3971;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const NAME = 'ZZ Wide Table Stage2';
const WATCH = ['businesses', 'business_members', 'profiles', 'auth_events', 'sales_goals', 'sales_opportunities', 'sales_targets'];
const HL = ['sales_goals', 'sales_opportunities', 'sales_targets', 'sales_partner_events', 'sales_opportunity_events', 'business_members'];
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const counts = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true })).count; return o; };
const hlCounts = async () => { const o = {}; for (const t of HL) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HOMELOVER)).count; return o; };
let srv, browser, B, users = [], pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  if (B) { await svc.from('auth_events').delete().eq('business_id', B); await svc.from('business_members').delete().eq('business_id', B); await svc.from('businesses').delete().eq('id', B); B = null; }
  for (const u of users) { await svc.from('auth_events').delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('actor_id', u.id); await svc.auth.admin.deleteUser(u.id); }
  users = [];
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 230000 });
const fake = () => { const r = { body: null, status() { return this; }, json(b) { r.body = b; } }; return r; };

const before = await counts(); const hlBefore = await hlCounts();
console.log('counts before', JSON.stringify(before)); console.log('HomeLover before', JSON.stringify(hlBefore));
const errsAll = [];
try {
  const { pipelineBoardRoute } = await import(ROOT + '/api/sales/pipelineBoard.js');
  const { listOpportunitiesRoute } = await import(ROOT + '/api/sales/pipelineRoutes.js');
  const r1 = fake(); await pipelineBoardRoute({ params: { businessId: HOMELOVER }, query: {} }, r1);
  const r2 = fake(); await pipelineBoardRoute({ params: { businessId: HOMELOVER }, query: { include_apollo: 'true' } }, r2);
  const r3 = fake(); await listOpportunitiesRoute({ params: { businessId: HOMELOVER }, query: {} }, r3);
  const rows = r1.body.rows, rowsApollo = r2.body.rows, opps = r3.body.opportunities;
  console.log(`HomeLover board: ${rows.length} rows (+Apollo ${rowsApollo.length}); opportunities ${opps.length}`);

  const tag = 'pwt2-' + Date.now();
  B = ins(await svc.from('businesses').insert({ name: NAME, website_url: 'https://wide2.example.com', color: '#6F8CF0', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
  const mk = async (name, role) => {
    const email = `${tag}-${name}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
    const { data: u, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(error.message);
    await svc.from('profiles').update({ display_name: `${name} Test`, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
    ins(await svc.from('business_members').insert({ business_id: B, email, name: `${name} Test`, user_id: u.user.id, role }).select());
    const anon = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data: s, error: sErr } = await anon.auth.signInWithPassword({ email, password });
    if (sErr) throw new Error(sErr.message);
    const u2 = { id: u.user.id, session: s.session }; users.push(u2); return u2;
  };
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const owner = await mk('Owner', 'owner'), viewer = await mk('Viewer', 'viewer');
  browser = await chromium.launch();

  async function newPage(u, { width = 1440, height = 900, light = false } = {}) {
    const errs = [];
    const page = await (await browser.newContext({ viewport: { width, height } })).newPage(); page.setDefaultTimeout(10000);
    page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
    await page.addInitScript(([k, v, light]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      if (light) localStorage.setItem('prospector_prefs', JSON.stringify({ displayMode: 'straight_shooter' }));
    }, [`sb-${REF}-auth-token`, JSON.stringify(u.session), light]);
    await page.addInitScript(() => { window.__prints = 0; window.print = () => { window.__prints++; }; });
    await page.route(/\/api\/sales\/[^/]+\/goals\/pipeline-board(\?|$)/, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: /include_apollo=true/.test(route.request().url()) ? rowsApollo : rows }) }));
    await page.route(/\/api\/sales\/[^/]+\/opportunities(\?|$)/, route => (route.request().method() === 'GET' ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ opportunities: opps }) }) : route.abort()));
    await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)/, route => route.abort());
    await page.goto(`http://localhost:${PORT}/?tab=pipeline&view=board`);
    await page.locator('#main-content').getByText(NAME).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(1200);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').selectOption({ label: NAME }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2000);
    await page.locator('#workspace-header-tabs').getByRole('button', { name: /^Pipeline/ }).first().click(); await page.waitForTimeout(2200);
    await page.locator('tr[data-row], li[data-row]').first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(600);
    return { page, errs };
  }
  const state = page => page.evaluate(() => { const u = new URL(location.href); return `${u.searchParams.get('tab')}/${u.searchParams.get('view')}`; });
  const measure = page => page.evaluate(() => {
    const box = document.querySelector('.ui-table-box'); const b = box.getBoundingClientRect();
    const H = Math.min(window.innerHeight, b.bottom);
    const rects = [...document.querySelectorAll('tr[data-row]')].map(tr => tr.getBoundingClientRect());
    const hs = rects.map(r => Math.round(r.height));
    return { rendered: rects.length, full: rects.filter(r => r.top >= b.top && r.bottom <= H).length, partial: rects.filter(r => r.top < H && r.bottom > H).length,
      boxTop: Math.round(b.top), boxBottom: Math.round(b.bottom), boxH: Math.round(b.height), rowH: [Math.min(...hs), Math.max(...hs)], docW: document.documentElement.scrollWidth, winW: window.innerWidth,
      pageScrollH: document.documentElement.scrollHeight, innerH: window.innerHeight };
  });
  const bandOrder = (page, band, col) => page.evaluate(([band, col]) => {
    let tr = document.querySelector(`tr[data-group="${band}"]`).nextElementSibling; const out = [];
    while (tr && tr.hasAttribute('data-row')) { const td = tr.querySelectorAll('td')[col]; out.push(td.title || td.textContent); tr = tr.nextElementSibling; }
    return out;
  }, [band, col]);
  const sortedAsc = a => a.every((v, i) => i === 0 || v === '—' || a[i - 1] === '—' ? true : a[i - 1].localeCompare(v, undefined, { numeric: true, sensitivity: 'base' }) <= 0);
  const noBlankBeforeValue = a => { const firstBlank = a.indexOf('—'); return firstBlank === -1 || a.slice(firstBlank).every(v => v === '—'); };
  const groupsOf = page => page.evaluate(() => [...document.querySelectorAll('tr[data-group]')].map(tr => tr.dataset.group));

  // ── 1440 owner ──
  { const { page, errs } = await newPage(owner);
    const m = await measure(page);
    console.log('MEASURE 1440', JSON.stringify(m));
    ok(`1440x900: ${m.full} company rows fully visible (before: 7)`, m.full > 7, JSON.stringify(m));
    ok('1440: one line per row (34px) and no sideways page scroll', m.rowH[0] === 34 && m.rowH[1] === 34 && m.docW <= m.winW, `rowH ${m.rowH} docW ${m.docW}`);
    const fit = await page.evaluate(() => { const b = document.querySelector('.ui-table-box'); return { boxW: b.clientWidth, tableW: b.scrollWidth, xScroll: b.scrollWidth > b.clientWidth }; });
    ok('1440: every column fits the box (no inner sideways scroll)', !fit.xScroll, JSON.stringify(fit));
    ok('1440: table box ends inside the viewport (its own scroll box)', m.boxBottom <= m.innerH + 1, `boxBottom ${m.boxBottom} innerH ${m.innerH}`);
    const firstBand = (await groupsOf(page))[1];
    const beforeGroups = await groupsOf(page);
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: `${OUT}/pipeline-table-1440.png`, animations: 'disabled' });
    // Sort Due / Stage / Company inside a band (column indexes: 1 Company, 3 Stage, 8 Due).
    const server = await bandOrder(page, firstBand, 1);
    await page.getByRole('button', { name: /^Due/ }).click(); await page.waitForTimeout(300);
    const due = await bandOrder(page, firstBand, 8);
    ok(`sort Due asc inside "${firstBand}": dates ascending, blanks last (${due.length} rows)`, sortedAsc(due.filter(v => v !== '—')) && noBlankBeforeValue(due) && (await page.locator('th[aria-sort="ascending"]').count()) === 1, due.slice(0, 6).join(','));
    await page.getByRole('button', { name: /^Due/ }).click(); await page.waitForTimeout(300);
    const dueD = await bandOrder(page, firstBand, 8).then(a => a.filter(v => v !== '—'));
    ok('sort Due desc: reversed', sortedAsc([...dueD].reverse()) && (await page.locator('th[aria-sort="descending"]').count()) === 1);
    await page.getByRole('button', { name: /^Due/ }).click(); await page.waitForTimeout(300);
    ok('sort Due off: back to server order', JSON.stringify(await bandOrder(page, firstBand, 1)) === JSON.stringify(server) && (await page.locator('th[aria-sort="none"]').count()) >= 8);
    await page.getByRole('button', { name: /^Stage/ }).click(); await page.waitForTimeout(300);
    const stage = await bandOrder(page, firstBand, 3);
    ok(`sort Stage asc inside "${firstBand}"`, sortedAsc(stage.filter(v => v !== '—')), stage.slice(0, 5).join(','));
    await page.getByRole('button', { name: /^Company/ }).click(); await page.waitForTimeout(300);
    const co = await bandOrder(page, firstBand, 1).then(a => a.map(t => t.split(' · ')[0]));
    ok(`sort Company asc inside "${firstBand}"`, sortedAsc(co) && (await page.locator('th[aria-sort="ascending"]').first().textContent()).startsWith('Company'), co.slice(0, 4).join(','));
    ok('groups keep their order under every sort', JSON.stringify(await groupsOf(page)) === JSON.stringify(beforeGroups), (await groupsOf(page)).join(','));
    await page.getByRole('button', { name: /^Company/ }).click(); await page.getByRole('button', { name: /^Company/ }).click(); await page.waitForTimeout(200);
    // Sticky header over 300+ rows: expand every band, scroll the box to the bottom.
    for (const tgl of await page.locator('.ui-table__toggle[aria-expanded="false"]').all()) { await tgl.click(); await page.waitForTimeout(150); }
    const total = await page.locator('tr[data-row]').count();
    const stick = await page.evaluate(() => { const box = document.querySelector('.ui-table-box'); box.scrollTop = box.scrollHeight; const th = document.querySelector('.ui-table thead th'); const b = box.getBoundingClientRect(), t = th.getBoundingClientRect(); return { boxTop: Math.round(b.top), thTop: Math.round(t.top), scrollTop: box.scrollTop, lastRowIn: (() => { const trs = document.querySelectorAll('tr[data-row]'); const r = trs[trs.length - 1].getBoundingClientRect(); return r.bottom <= b.bottom + 1 && r.top >= b.top; })() }; });
    ok(`sticky header holds with every band open (${total} rows, box scrolled ${stick.scrollTop}px)`, total >= 300 && Math.abs(stick.thTop - stick.boxTop) <= 1 && stick.lastRowIn, JSON.stringify(stick));
    // Sticky first column: scroll the box sideways at a narrow width.
    await page.setViewportSize({ width: 1000, height: 900 }); await page.waitForTimeout(500);
    const stickyCol = await page.evaluate(() => { const box = document.querySelector('.ui-table-box'); box.scrollLeft = 400; const td = document.querySelector('tr[data-row] td.ui-table__sticky'); const b = box.getBoundingClientRect(), t = td.getBoundingClientRect(); return { left: Math.round(t.left - b.left), scrollLeft: box.scrollLeft, bg: getComputedStyle(td).backgroundImage !== 'none' }; });
    ok('sticky first column stays at the left edge with a solid background when the box scrolls sideways', stickyCol.scrollLeft > 0 && stickyCol.left <= 1 && stickyCol.bg, JSON.stringify(stickyCol));
    await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(400);
    // Click-through per row type.
    await page.evaluate(() => { document.querySelector('.ui-table-box').scrollTop = 0; });
    const rowOf = type => page.locator('tr[data-row]').filter({ has: page.locator('.ui-table__label', { hasText: new RegExp(`^${type}$`) }) }).first();
    const partnerName = await rowOf('Partner').locator('td.ui-table__sticky button').textContent();
    await rowOf('Partner').locator('td.ui-table__sticky button').click(); await page.waitForTimeout(1500);
    ok(`partner click → Pipeline › Partner workflow (${partnerName.slice(0, 20)})`, (await state(page)) === 'pipeline/partners', await state(page));
    await page.locator('#workspace-header-tabs').getByRole('button', { name: /^Pipeline/ }).first().click(); await page.waitForTimeout(800);
    await page.locator('.ui-seg').getByRole('button', { name: 'Companies', exact: true }).first().click(); await page.waitForTimeout(1800);
    const empRow = rowOf('Employer');
    const empName = await empRow.locator('td.ui-table__sticky').textContent();
    await empRow.locator('td.ui-table__sticky button').click(); await page.waitForTimeout(1200);
    ok(`employer click → OpportunityPanel "Edit opportunity" (${empName.slice(0, 20)})`, (await page.getByText('Edit opportunity').count()) === 1);
    await page.locator('text="×"').first().click(); await page.waitForTimeout(500);
    ok('employer panel closes with × (no save)', (await page.getByText('Edit opportunity').count()) === 0);
    await page.getByRole('button', { name: 'Targets' }).click(); await page.waitForTimeout(600);
    const tgtRows = page.locator('tr[data-row] td.ui-table__sticky button');
    console.log('target rows with a name button:', await tgtRows.count(), 'rows:', await page.locator('tr[data-row]').count());
    if (await tgtRows.count()) {
      await tgtRows.first().click(); await page.waitForTimeout(1200);
      ok('target click → Tasks drawer opens', (await page.getByRole('dialog').count()) >= 1);
      await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    } else console.log('SKIP  target click - no target rows');
    await page.getByRole('button', { name: 'All' }).click(); await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'In Apollo' }).click(); await page.waitForTimeout(1500);
    const apRows = page.locator('tr[data-row]').filter({ has: page.locator('.ui-table__label', { hasText: /^Apollo$/ }) });
    console.log('apollo rows:', await apRows.count());
    if (await apRows.count()) {
      await apRows.first().locator('td.ui-table__sticky button').click(); await page.waitForTimeout(1500);
      ok('Apollo click → Pipeline › Sequenced', (await state(page)) === 'pipeline/sequenced', await state(page));
    } else console.log('SKIP  Apollo click - no Apollo-only rows');
    // Print path.
    await page.locator('#workspace-header-tabs').getByRole('button', { name: /^Dashboard/ }).first().click(); await page.waitForTimeout(1500);
    await page.locator('.ui-seg').getByRole('button', { name: 'Scorecard', exact: true }).first().click(); await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Export', exact: true }).click(); await page.waitForTimeout(300);
    await page.getByRole('menuitem', { name: 'Weekly report PDF' }).click(); await page.waitForTimeout(1200);
    ok('Export › Weekly report PDF prints once with one print area', (await page.evaluate(() => window.__prints)) === 1 && (await page.locator('#sales-analytics-print-area').count()) === 1);
    errsAll.push(...errs.map(e => '1440: ' + e)); await page.context().close(); }
  // ── 1920 + light ──
  { const { page, errs } = await newPage(owner, { width: 1920, height: 1080 });
    const m = await measure(page); console.log('MEASURE 1920', JSON.stringify(m));
    ok(`1920x1080: ${m.full} rows fully visible, no sideways scroll`, m.full > 7 && m.docW <= m.winW);
    await page.screenshot({ path: `${OUT}/pipeline-table-1920.png`, animations: 'disabled' });
    errsAll.push(...errs.map(e => '1920: ' + e)); await page.context().close(); }
  { const { page, errs } = await newPage(owner, { light: true });
    await page.screenshot({ path: `${OUT}/pipeline-table-1440-light.png`, animations: 'disabled' });
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.ui-table-box')).backgroundColor);
    ok(`light mode: the table stays dark inside the dark module (${bg})`, bg === 'rgb(18, 22, 27)');
    errsAll.push(...errs.map(e => 'light: ' + e)); await page.context().close(); }
  // ── Viewer ──
  { const { page, errs } = await newPage(viewer);
    ok('viewer: no + Add employer / Update from sheet / Export', (await page.getByRole('button', { name: '+ Add employer' }).count()) === 0 && (await page.getByRole('button', { name: 'Update from sheet' }).count()) === 0 && (await page.getByRole('button', { name: 'Export joint sheet' }).count()) === 0);
    ok('viewer: no star buttons; starred rows still marked', (await page.locator('button[aria-label^="Star "], button[aria-label^="Unstar "]').count()) === 0 && (await page.locator('[aria-label="Top"]').count()) >= 1);
    const empBtn = await page.locator('tr[data-row]').filter({ has: page.locator('.ui-table__label', { hasText: /^Employer$/ }) }).first().locator('td.ui-table__sticky button').count();
    ok('viewer: employer names are not buttons', empBtn === 0);
    await page.locator('tr[data-row]').filter({ has: page.locator('.ui-table__label', { hasText: /^Partner$/ }) }).first().locator('td.ui-table__sticky button').click(); await page.waitForTimeout(1500);
    ok('viewer: partner still opens', (await state(page)) === 'pipeline/partners');
    errsAll.push(...errs.map(e => 'viewer: ' + e)); await page.context().close(); }
  // ── 390 ──
  { const { page, errs } = await newPage(owner, { width: 390, height: 844 });
    const m = await page.evaluate(() => ({ list: !!document.querySelector('ul.ui-list'), table: !!document.querySelector('table.ui-table'), rows: document.querySelectorAll('li[data-row]').length, docW: document.documentElement.scrollWidth, winW: window.innerWidth, minH: Math.min(...[...document.querySelectorAll('li[data-row]')].map(li => li.getBoundingClientRect().height)) }));
    ok('390: phone list (no table), no sideways scroll, rows ≥ 60px', m.list && !m.table && m.docW <= m.winW && m.minH >= 60, JSON.stringify(m));
    await page.screenshot({ path: `${OUT}/pipeline-list-390.png`, animations: 'disabled' });
    const toggles = page.locator('.ui-table__toggle[aria-expanded="false"]');
    if (await toggles.count()) { await toggles.first().click(); await page.waitForTimeout(300); ok('390: a collapsed band expands', (await page.locator('li[data-row]').count()) > m.rows); }
    await page.locator('li[data-row]').filter({ has: page.locator('text=/Partner/') }).first().locator('button').first().click(); await page.waitForTimeout(1500);
    ok('390: partner row opens Partner workflow', (await state(page)) === 'pipeline/partners', await state(page));
    errsAll.push(...errs.map(e => '390: ' + e)); await page.context().close(); }
  const bundle = fs.readdirSync(ROOT + '/build/static/js').filter(f => /^main\..*\.js$/.test(f)).map(f => fs.readFileSync(`${ROOT}/build/static/js/${f}`, 'utf8')).join('');
  ok('bundle marker: ui-table-box + "In Apollo" in build/', bundle.includes('ui-table-box') && bundle.includes('In Apollo'));
  ok('0 page errors', errsAll.length === 0, errsAll.slice(0, 5).join(' | '));
} catch (e) { console.error('ERROR', e.stack?.split('\n').slice(0, 3).join(' | ')); }
finally {
  await cleanup();
  const after = await counts(); const hlAfter = await hlCounts();
  const moved = WATCH.filter(t => after[t] !== before[t]); const hlMoved = HL.filter(t => hlAfter[t] !== hlBefore[t]);
  console.log(`HomeLover ${hlMoved.length ? 'MOVED: ' + hlMoved.join(',') : 'identical'} ${JSON.stringify(hlAfter)}`);
  console.log(`checks: ${pass}/${total}  shots: ${OUT && fs.existsSync(OUT) ? fs.readdirSync(OUT).filter(f => f.endsWith('.png')).length : 0} png -> ${OUT}`);
  console.log(`restored: ${moved.length ? 'NO - moved: ' + moved.join(', ') : 'yes'}`);
  process.exit(pass === total && !moved.length ? 0 : 1);
}
