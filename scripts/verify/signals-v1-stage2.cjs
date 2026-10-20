// signals-v1 Stage 2 live check. TEMP data only: 1 workspace (goals_sales on, added to SALES_ANALYTICS_BUSINESS_IDS for the local server only), 2 temp users (owner "Jack Zz", viewer). Seed: 1 partner named after one Hit List row of the REAL Scout file (read at run time, never printed) + 1 unrelated employer. API: viewer gates, PII fixture refused whole, dry run writes nothing, apply proposes every Hit List row, re-apply adds 0, accept no-match / partner match / Upside joint, dismiss, second accept 409. UI (Playwright, serves build/ - run npm run build first): Today chip, drawer pill + list, re-upload through the panel -> "Nothing new to add", Viewer read-only, 1440 + 390 shots, report PDF prints. 0 Claude, 0 Apollo / 0 syncs. HomeLover is only COUNTED (head requests). Teardown deletes everything. ~60-120s, cap 4 min.
// Usage: node scripts/verify/signals-v1-stage2.cjs <outdir> <scout.xlsx>
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const ExcelJS = require(ROOT + '/node_modules/exceljs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3991, tag = 'sig2-' + Date.now();
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const HL_TABLES = ['business_members', 'sales_goals', 'sales_partner_events', 'sales_week_goals', 'sales_week_goal_steps', 'sales_targets', 'sales_opportunities', 'partner_domains', 'sales_suggestions', 'sales_tidy_runs', 'sales_signals', 'sales_call_notes'];
const OUT = process.argv[2] || '/tmp';
const SCOUT = process.argv[3];
const made = { biz: null, users: [] };
let srv, browser, log = '', pass = 0, total = 0, blocked = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const DAY = 864e5;
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
    for (const t of ['sales_signals', 'sales_suggestions', 'sales_tidy_runs', 'sales_partner_events', 'partner_domains', 'sales_week_goal_steps', 'sales_week_goals', 'sales_targets', 'sales_opportunities', 'sales_goals', 'business_members', 'auth_events']) {
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
  await page.goto(`http://localhost:${PORT}/?tab=today`); await page.waitForTimeout(3000);
  return { page, errs };
}
async function navSales(page, compact) {
  const menu = async () => { if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); } };
  await menu(); await page.getByLabel('Workspace').selectOption({ label: WS_NAME }); await page.waitForTimeout(2500);
  await menu(); await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(4000);
}
const drawerSel = 'aside[aria-labelledby="task-drawer-title"]';
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, animations: 'disabled', caret: 'hide' });
const tab = (page, name) => page.locator('#workspace-header-tabs').getByRole('button', { name }).first().click();

// The Hit List rows (company, upside) without printing a value.
async function hitList(buf) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('Hit List');
  let head = null; const rows = [];
  ws.eachRow((row, n) => {
    const v = (row.values || []).slice(1).map(x => (x == null ? '' : String(x.result ?? x.text ?? x).trim()));
    if (!head && v.includes('Company') && v.includes('Signal(s)')) { head = v; return; }
    if (head && v[head.indexOf('Company')]) rows.push({ company: v[head.indexOf('Company')], upside: /^y/i.test(v[head.findIndex(h => h.startsWith('Upside joint'))] || '') });
  });
  return rows;
}

(async () => {
  const hlBefore = await hl(); const t0 = Date.now();
  fs.mkdirSync(OUT, { recursive: true });
  try {
    const buf = fs.readFileSync(SCOUT);
    const file = { name: 'signal-scout.xlsx', data: buf.toString('base64') };
    const hit = await hitList(buf);
    const nonUpside = hit.filter(r => !r.upside);
    const partnerRow = nonUpside[1], newRow = nonUpside[0], upsideRow = hit.find(r => r.upside);
    console.log(`file: ${hit.length} Hit List rows (${hit.filter(r => r.upside).length} Upside joint) - names not printed`);

    WS_NAME = `ZZ Signals ${tag.slice(-4)}`;
    const T = made.biz = ins(await svc.from('businesses').insert({ name: WS_NAME, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}-jack@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
    const M = await user('Jack Zz', 'owner'), V = await user('Viewer Zz', 'viewer');
    const partner = ins(await svc.from('sales_goals').insert({ business_id: T, goal_type: 'partnership', name: partnerRow.company, owner_user_id: M.id, pipeline_status: 'replied' }).select().single());
    ins(await svc.from('sales_opportunities').insert({ business_id: T, organization: 'Zz Unrelated Employer', org_type: 'employer', stage: 'contacted', source: 'manual' }).select());
    console.log(`seed: workspace ${T}, 1 partner (a Hit List company, at Replied), 1 unrelated employer`);

    srv = spawn('node', ['--dns-result-order=ipv4first', 'server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${T}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
    for (let i = 0; i < 60 && !log.includes(`port ${PORT}`); i++) await wait(250);
    const call = (u, method, path, body) => fetch(`http://localhost:${PORT}/api/sales/${T}/goals${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: `prospector_at=${encodeURIComponent(u.token)}` }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
    const count = async (t, extra = q => q) => (await extra(svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', T))).count;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
    const friday = new Date(Date.parse(`${today}T00:00:00Z`) + ((5 - dow + 7) % 7) * DAY).toISOString().slice(0, 10);
    const fridayMonday = new Date(Date.parse(`${friday}T00:00:00Z`) - 4 * DAY).toISOString().slice(0, 10);

    console.log('--- gates + PII wall');
    ok('viewer GET signals 200 (empty)', (await call(V, 'GET', '/signals')).body.signals?.length === 0);
    ok('viewer upload refused (403)', (await call(V, 'POST', '/signals/scout-import', { file, dryRun: true })).status === 403);
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Hit List');
    ws.getRow(4).values = ['Rank', 'Name', 'Title', 'Company', 'Program', 'Signal(s)']; ws.getRow(5).values = [1, 'Zz A.', 'VP', 'Zz Co', 'Employer', 'mail zz@example.test'];
    const pii = await call(M, 'POST', '/signals/scout-import', { file: { name: 'pii.xlsx', data: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64') }, dryRun: false });
    ok('a file with an "@" is refused whole (400, no value echoed, 0 rows)', pii.status === 400 && pii.body.refused && !/example/.test(pii.body.error) && (await count('sales_signals')) === 0, JSON.stringify(pii.body).slice(0, 160));

    console.log('--- real Scout file: dry run, apply, re-apply');
    const dry = await call(M, 'POST', '/signals/scout-import', { file, dryRun: true });
    ok(`dry run: header row 4, ${hit.length} rows, Also Watch counted, all "propose", 0 written`, dry.status === 200 && dry.body.header_row === 4 && dry.body.rows.length === hit.length && dry.body.also_watch > 0 && dry.body.counts.propose === hit.length && (await count('sales_signals')) === 0, JSON.stringify(dry.body.counts));
    ok('dry run: the seeded partner shows as an exact partner match', dry.body.rows.find(r => r.company === partnerRow.company)?.match?.type === 'partner' && !dry.body.rows.find(r => r.company === partnerRow.company).match.possible);
    const ap = await call(M, 'POST', '/signals/scout-import', { file, dryRun: false });
    const sigs = ins(await svc.from('sales_signals').select('*').eq('business_id', T));
    ok(`apply: ${hit.length} new rows, source scout, status new, this LA week`, ap.body.added === hit.length && sigs.length === hit.length && sigs.every(s => s.source === 'scout' && s.status === 'new' && new Date(`${s.signal_week}T12:00:00Z`).getUTCDay() === 1), JSON.stringify(ap.body.counts));
    ok('apply wrote only signals (0 targets, 0 to-dos, 0 events)', (await count('sales_targets')) === 0 && (await count('sales_week_goals')) === 0 && (await count('sales_partner_events')) === 0);
    ok('stored text has no "@" or phone shape', sigs.every(s => !/@|\+?\d[\d\s().-]{7,}\d/.test([s.who, s.signal, s.why_now, s.first_line].join(' ').replace(/\d{4}-\d{2}-\d{2}/g, ''))));
    const again = await call(M, 'POST', '/signals/scout-import', { file, dryRun: false });
    ok('re-apply: 0 added, every row "already proposed"', again.body.added === 0 && again.body.counts['already proposed'] === hit.length && (await count('sales_signals')) === hit.length);

    console.log('--- accept / dismiss');
    const sid = c => sigs.find(s => s.company_name === c.company).id;
    const a1 = await call(M, 'POST', `/signals/${sid(newRow)}/accept`, {});
    const t1 = a1.body.record && ins(await svc.from('sales_targets').select('*').eq('id', a1.body.record.id).single());
    ok(`accept, no match: new target (source scout, researching) + 1 to-do due ${friday} linked to it`, a1.status === 200 && a1.body.via === 'new_target' && t1.source === 'scout' && t1.status === 'researching' && t1.signal_id === sid(newRow) && a1.body.todo.due_date === friday && a1.body.todo.week_start === fridayMonday && a1.body.todo.link_type === 'target' && a1.body.todo.link_id === t1.id && a1.body.todo.owner_user_id === M.id, JSON.stringify(a1.body).slice(0, 200));
    const a2 = await call(M, 'POST', `/signals/${sid(partnerRow)}/accept`, {});
    const ev = ins(await svc.from('sales_partner_events').select('event, from_status, to_status, meta').eq('goal_id', partner.id));
    const pAfter = ins(await svc.from('sales_goals').select('pipeline_status').eq('id', partner.id).single());
    ok('accept, partner match: exactly 1 note event, 0 status events, stage still Replied, to-do linked to the partner', a2.status === 200 && a2.body.via === 'partner' && ev.length === 1 && ev[0].event === 'note' && pAfter.pipeline_status === 'replied' && a2.body.todo.link_type === 'partner' && a2.body.todo.link_id === partner.id, JSON.stringify(ev).slice(0, 160));
    const a3 = await call(M, 'POST', `/signals/${sid(upsideRow)}/accept`, {});
    const t3 = a3.body.via === 'new_target' && ins(await svc.from('sales_targets').select('*').eq('id', a3.body.record.id).single());
    ok('accept, Upside joint: target owner_team both + co-owner Brad, to-do ends "(cc Brad)"', a3.status === 200 && t3 && t3.owner_team === 'both' && t3.co_owner_name === 'Brad' && / \(cc Brad\)$/.test(a3.body.todo.text), JSON.stringify(a3.body).slice(0, 200));
    ok('a second accept -> 409, nothing more written', (await call(M, 'POST', `/signals/${sid(newRow)}/accept`, {})).status === 409 && (await count('sales_week_goals')) === 3 && (await count('sales_targets')) === 2);
    const dismissRow = nonUpside[2];
    const d1 = await call(M, 'POST', `/signals/${sid(dismissRow)}/dismiss`, {});
    ok('dismiss -> dismissed, until +7 d', d1.status === 200 && d1.body.signal.status === 'dismissed' && (Date.parse(d1.body.signal.dismissed_until) - Date.parse(today)) === 7 * DAY);
    ok('viewer cannot accept (403)', (await call(V, 'POST', `/signals/${sigs.find(s => s.status === 'new' && ![newRow, partnerRow, upsideRow, dismissRow].some(r => r.company === s.company_name)).id}/accept`, {})).status === 403);
    const re = await call(M, 'POST', '/signals/scout-import', { file, dryRun: false });
    ok('re-upload after deciding: 0 new (the dismissed row stays dismissed)', re.body.added === 0 && re.body.rows.find(r => r.company === dismissRow.company).would === 'dismissed' && (await count('sales_signals')) === hit.length);
    const open = hit.length - 4;
    ok(`GET signals: ${open} still new`, (await call(V, 'GET', '/signals')).body.signals.length === open);

    console.log('--- UI');
    const build = fs.readdirSync(`${ROOT}/build/static/js`).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(`${ROOT}/build/static/js/${f}`, 'utf8')).join('\n');
    ok('bundle marker: "Upload Scout file" + "No signals to review" + "/signals/scout-import" in build/', build.includes('Upload Scout file') && build.includes('No signals to review') && build.includes('/signals/scout-import'));
    browser = await chromium.launch();
    for (const [width, height, compact] of [[1440, 900, false], [390, 844, true]]) {
      const { page, errs } = await newPage(M, width, height);
      await navSales(page, compact);
      const chip = page.locator('[data-today-chips] button', { hasText: 'Signals' });
      await chip.waitFor();
      ok(`${width}: Today chip "⚡ Signals (${open})"`, (await chip.innerText()).trim() === `⚡ Signals (${open})`, await chip.innerText());
      await shot(page, `sig2-${width}-today-chip`);
      await chip.click();
      const drawer = page.locator(drawerSel);
      await drawer.getByRole('region', { name: 'Signals' }).waitFor(); await page.waitForTimeout(600);
      ok(`${width}: chip opens the drawer on Signals - ${open} rows, pill pressed`, (await drawer.locator('li[data-signal-id]').count()) === open && (await drawer.getByRole('button', { name: /^⚡ Signals/ }).getAttribute('aria-pressed')) === 'true');
      ok(`${width}: Member sees Accept + Dismiss per row and Upload Scout file`, (await drawer.getByRole('button', { name: 'Accept → to-do' }).count()) === open && (await drawer.getByRole('button', { name: 'Dismiss · 7 d' }).count()) === open && (await drawer.getByRole('button', { name: 'Upload Scout file' }).count()) === 1);
      await shot(page, `sig2-${width}-signals-list`);
      if (!compact) {
        await drawer.getByRole('button', { name: 'Upload Scout file' }).click();
        await drawer.getByLabel('Signal Scout file').setInputFiles(SCOUT);
        await drawer.getByRole('button', { name: 'Nothing new to add' }).waitFor();
        ok('1440: re-upload through the panel previews "0 new" and writes nothing', /· 0 new/.test(await drawer.getByRole('region', { name: 'Upload Scout file' }).innerText()) && (await count('sales_signals')) === hit.length);
        await shot(page, 'sig2-1440-upload-preview');
      }
      ok(`${width}: no sideways scroll`, await noSideScroll(page));
      ok(`${width}: 0 console errors`, !errs.length, errs.join(' | '));
      await page.context().close();
    }
    const { page: rp, errs: rerrs } = await newPage(M, 1440, 900);
    await navSales(rp, false);
    await tab(rp, /^Reports/); await rp.waitForTimeout(2500);
    await rp.pdf({ path: `${OUT}/sig2-report.pdf`, landscape: true });
    ok('Weekly report PDF still prints', fs.statSync(`${OUT}/sig2-report.pdf`).size > 1000);
    ok('reports page: 0 console errors', !rerrs.length, rerrs.join(' | '));
    await rp.context().close();

    const { page: vp, errs: verrs } = await newPage(V, 1440, 900);
    await navSales(vp, false);
    // A Viewer's Today (TodayViewer) has no chips row - the drawer's pill is their way in.
    await vp.getByRole('button', { name: /^Open tasks/ }).click();
    const vd = vp.locator(drawerSel);
    await vd.getByRole('button', { name: `⚡ Signals (${open})` }).click();
    await vd.getByRole('region', { name: 'Signals' }).waitFor(); await vp.waitForTimeout(400);
    ok('viewer: list rows, no Accept / Dismiss / Upload, read-only note', (await vd.locator('li[data-signal-id]').count()) === open && (await vd.getByRole('button', { name: /Accept|Dismiss|Upload/ }).count()) === 0 && (await vd.getByText('You have view access, so signals are read-only.').count()) === 1);
    await shot(vp, 'sig2-1440-viewer-signals');
    ok('viewer: 0 console errors', !verrs.length, verrs.join(' | '));
    await vp.context().close();
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
    ok(`HomeLover counts identical (${HL_TABLES.length} tables, incl. sales_signals = ${hlAfter.sales_signals})`, !diff.length, diff.map(k => `${k} ${hlBefore[k]}->${hlAfter[k]}`).join(', '));
    console.log(`${pass}/${total} passed · ${Math.round((Date.now() - t0) / 1000)}s · Claude 0 · Apollo 0`);
    process.exit(pass === total ? 0 : 1);
  }
})();
