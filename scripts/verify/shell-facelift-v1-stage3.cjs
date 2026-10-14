// shell-facelift-v1 Stage 3 - ONE Connections page replacing Google connections + Microsoft connection, before and after. TEMP data only: 1 businesses row (goals_sales on), 2 temp users (owner + viewer), the owner's google_grants + microsoft_grants rows (fake sealed tokens - never decrypted: status routes only read them), 1 sales_mailbox_owners row, 1 sales_sync_runs + 1 sales_raw_snapshots (mailboxes) row - all deleted by teardown. 0 AI / 0 Apollo / 0 calls to Google or Microsoft (Connect clicks are answered 204 in the browser and only their target URL is recorded; Check / Preview / Sync are answered by a browser fixture). HomeLover is never touched (its counts come from the Stage 1 script's hl mode). ~40s per mode, cap 4 min each.
// Modes (fixtures persist between runs so before and after see the same names and data):
//   setup <state.json>                 create fixtures, write ids + passwords + a fixed clock + temp-table counts
//   shoot <state.json> <outdir> before|after   serve build/ via server.js, screenshot the connection page(s): 1440 dark + light, 390, viewer; record every Connect button's target URL into state (before) or compare to it (after); 0 console errors
//   return <state.json> before|after   the OAuth returns: /?microsoft_connected=1 and /?microsoft_error=... land on the Microsoft card with the status line and a cleaned URL (after: on the Connections page); /?google_connected=calendar stays on Workspaces (unchanged by this stage)
//   after <state.json>                 Stage 3 structure: user menu = one Connections row where the two were, nothing else moved; three cards; pills; 390 one column + no sideways scroll; viewer sees the cards
//   click <state.json>                 every control still works on the new page (Google feature Connects + Disconnect Google, Microsoft Reconnect / Check / Preview / Sync / Disconnect, Apollo read-only); run LAST - Disconnects really delete the temp grants
//   teardown <state.json>              delete everything setup made, print table counts before/after
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3965;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const WATCH = ['businesses', 'business_members', 'profiles', 'auth_events', 'google_grants', 'microsoft_grants', 'sales_mailbox_owners', 'sales_sync_runs', 'sales_raw_snapshots'];
const NAME = 'ZZ Facelift Connections';
const MENU_BEFORE = ['Profile & badges', 'Voice Profile', 'Google connections', 'Microsoft connection', 'UI kit', 'Sign out'];
const MENU_AFTER = ['Profile & badges', 'Voice Profile', 'Connections', 'UI kit', 'Sign out'];
const [mode, a1, a2, a3] = process.argv.slice(2);
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const counts = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true })).count; return o; };
let srv, browser, pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
setTimeout(() => { console.log('ABORT (4 min cap)'); if (browser) browser.close(); if (srv) srv.kill(); process.exit(2); }, 240000).unref();

async function setup(file) {
  const before = await counts();
  const tag = 'sfl3-' + Date.now();
  const B = ins(await svc.from('businesses').insert({ name: NAME, website_url: 'https://connections.example.com', tagline: 'Connections fixture', color: '#6F8CF0', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
  const users = {};
  for (const [name, role] of [['Owner', 'owner'], ['Viewer', 'viewer']]) {
    const email = `${tag}-${name.toLowerCase()}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
    const { data: u, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(error.message);
    await svc.from('profiles').update({ display_name: `${name} Test`, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
    ins(await svc.from('business_members').insert({ business_id: B, email, name: `${name} Test`, user_id: u.user.id, role }).select());
    users[name] = { id: u.user.id, email, password };
  }
  const now = new Date().toISOString();
  ins(await svc.from('google_grants').insert({ user_id: users.Owner.id, google_email: users.Owner.email, features: ['calendar'], refresh_token_enc: 'fixture-never-decrypted' }).select());
  ins(await svc.from('microsoft_grants').insert({ user_id: users.Owner.id, account_email: users.Owner.email, tenant_id: 'fixture-tenant', scopes: ['openid', 'offline_access', 'User.Read', 'Mail.Read', 'Calendars.Read'], refresh_token_enc: 'fixture-never-decrypted', connected_at: now }).select());
  ins(await svc.from('sales_mailbox_owners').insert({ business_id: B, mailbox_email: users.Owner.email, user_id: users.Owner.id }).select());
  const run = ins(await svc.from('sales_sync_runs').insert({ business_id: B, trigger: 'manual', status: 'success', started_at: now, finished_at: now, counts: { apollo_calls: 3 } }).select().single());
  ins(await svc.from('sales_raw_snapshots').insert({ business_id: B, run_id: run.id, entity: 'mailboxes', captured_at: now, payload: [
    { id: 'mb-1', email: 'one@connections.example.com', active: true, last_synced_at: now },
    { id: 'mb-2', email: 'two@connections.example.com', active: false, unlink_error_code: 'needs_reauth', last_synced_at: null },
  ] }).select());
  fs.writeFileSync(file, JSON.stringify({ tag, B, users, runId: run.id, clock: Date.now(), before }, null, 2));
  console.log(`setup done: workspace ${B}, 2 users, owner has Google (calendar) + Microsoft grants, 2 Apollo mailboxes. Counts before: ${JSON.stringify(before)}`);
}

async function session(u) {
  const c = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: s, error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error(error.message);
  return s.session;
}
async function startServer(st) {
  // Fake Microsoft creds so the server reports configured (the Connect button is otherwise disabled); nothing here ever reaches Microsoft - Connect is answered in the browser, Check / Sync by a browser fixture, and the fixture grant's token is never decrypted.
  const FAKE_MS = { MICROSOFT_CLIENT_ID: '00000000-0000-0000-0000-00000000c1d0', MICROSOFT_TENANT_ID: '00000000-0000-0000-0000-0000000071d0', MICROSOFT_CLIENT_SECRET: 'fake-secret-' + st.tag, MICROSOFT_TOKEN_KEY: process.env.MICROSOFT_TOKEN_KEY || require('crypto').randomBytes(32).toString('base64'), MICROSOFT_AUTHORITY: `http://localhost:${PORT}/never`, MICROSOFT_GRAPH_URL: `http://localhost:${PORT}/never` };
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, ...FAKE_MS, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${st.B}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); return; } catch { await new Promise(r => setTimeout(r, 250)); } }
  throw new Error('server did not start');
}
async function newPage(st, sess, { width = 1440, height = 900, light = false, path = '/' } = {}) {
  const errs = [], targets = [];
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage(); page.setDefaultTimeout(10000);
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); }); page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
  await page.clock.setFixedTime(new Date(st.clock));
  await page.addInitScript(([k, v, light]) => {
    if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
    if (light) localStorage.setItem('prospector_prefs', JSON.stringify({ displayMode: 'straight_shooter' }));
  }, [`sb-${REF}-auth-token`, JSON.stringify(sess), light]);
  // A Connect click leaves for the provider's consent screen; here it is answered 204 (the browser stays) and only the target URL is kept.
  await page.route(/\/api\/(google|microsoft)\/connect/, r => { const u = new URL(r.request().url()); targets.push(u.pathname + u.search); r.fulfill({ status: 204 }); });
  await page.goto(`http://localhost:${PORT}${path}`);
  // "/" and a Google return land on Workspaces (the fixture's card); a Microsoft return lands on the page with the Microsoft card.
  await page.locator('#main-content').getByText(path.includes('microsoft') ? 'Microsoft 365' : NAME).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  page.compact = width < 900;
  return { page, errs, targets };
}
const shot = (page, out, name) => page.screenshot({ path: `${out}/${name}.png`, fullPage: true, animations: 'disabled', caret: 'hide' });
async function openUserMenu(page) {
  if (page.compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
  if (!(await page.locator('#user-menu').count())) { await page.getByRole('button', { name: /^My profile/ }).click(); await page.waitForTimeout(400); }
}
async function menuRows(page) { await openUserMenu(page); return (await page.locator('#user-menu').getByRole('button').allInnerTexts()).map(t => t.split('\n').pop().trim()); }
async function go(page, label) {
  await openUserMenu(page);
  await page.locator('#user-menu').getByRole('button', { name: label, exact: true }).click(); await page.waitForTimeout(2500);
}
const main = page => page.locator('#main-content');
const mainText = page => main(page).innerText();
const noScroll = async (page, name) => ok(`${name}: no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), await page.evaluate(() => `${document.documentElement.scrollWidth} <= ${window.innerWidth}`));

// The Microsoft check / sync routes would mint a token from the fixture grant; a browser fixture answers them instead, so the buttons prove their wiring with 0 calls to Microsoft.
async function fixtureMicrosoft(page, calls) {
  await page.route(/\/api\/microsoft\/(check|sync)(\?|$)/, r => {
    const u = new URL(r.request().url()); calls.push(`${r.request().method()} ${u.pathname}${u.search}`);
    if (u.pathname.endsWith('/check')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, email: 'fixture@connections.example.com', checked_at: new Date().toISOString(), folders: [{ folder: 'inbox', total: 12, window: 4 }, { folder: 'sentitems', total: 9, window: 2 }] }) });
    const dry = /dry_run=1/.test(u.search);
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ dry_run: dry, folders: [{ folder: 'sentitems', pages: 1, seen: 9, stored: 2, skipped_draft: 0, skipped_internal: 6, skipped_personal: 1, capped: false, error: null }], moves: { recorded: 0, people: 0, applied: 0, held: 0 } }) });
  });
}

async function shoot(file, out, phase) {
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.mkdirSync(out, { recursive: true });
  await startServer(st);
  browser = await chromium.launch();
  const allErrs = [], targets = {};
  const pages = phase === 'before' ? [['google', 'Google connections'], ['microsoft', 'Microsoft connection']] : [['connections', 'Connections']];
  try {
    const owner = await session(st.users.Owner);
    { const { page, errs, targets: t } = await newPage(st, owner);
      for (const [key, label] of pages) {
        await go(page, label); await shot(page, out, `${key}-1440-dark`); await noScroll(page, `${key}-1440`);
        for (const name of ['Connect Gmail →', 'Connect Google Slides →', 'Reconnect / switch account →']) {
          const b = main(page).getByRole('button', { name });
          if (await b.count()) { t.length = 0; await b.click(); await page.waitForTimeout(600); targets[name] = t[0] || null; }
        }
      }
      allErrs.push(...errs.map(e => `owner 1440: ${e}`)); }
    { const { page, errs } = await newPage(st, owner, { light: true });
      ok('light mode class on body', await page.evaluate(() => document.body.classList.contains('mode-straight-shooter')));
      for (const [key, label] of pages) { await go(page, label); await shot(page, out, `${key}-1440-light`); }
      allErrs.push(...errs.map(e => `owner light: ${e}`)); }
    { const { page, errs } = await newPage(st, owner, { width: 390, height: 844 });
      for (const [key, label] of pages) { await go(page, label); await shot(page, out, `${key}-390-dark`); await noScroll(page, `${key}-390`); }
      allErrs.push(...errs.map(e => `owner 390: ${e}`)); }
    { const { page, errs } = await newPage(st, await session(st.users.Viewer));
      for (const [key, label] of pages) { await go(page, label); await shot(page, out, `${key}-1440-viewer`); }
      allErrs.push(...errs.map(e => `viewer: ${e}`)); }
    ok('0 console errors', allErrs.length === 0, allErrs.slice(0, 5).join(' | '));
    ok('3 Connect targets recorded', Object.values(targets).filter(Boolean).length === 3, JSON.stringify(targets));
    if (phase === 'before') { st.targetsBefore = targets; fs.writeFileSync(file, JSON.stringify(st, null, 2)); }
    else ok('Connect targets identical before / after', JSON.stringify(targets) === JSON.stringify(st.targetsBefore), `before ${JSON.stringify(st.targetsBefore)} after ${JSON.stringify(targets)}`);
  } finally { await browser.close(); srv.kill(); }
  console.log(`shoot ${phase} -> ${out}: ${fs.readdirSync(out).filter(f => f.endsWith('.png')).join(', ')}  ${pass}/${total}`);
}

async function oauthReturn(file, phase) {
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  await startServer(st);
  browser = await chromium.launch();
  try {
    const owner = await session(st.users.Owner);
    const heading = phase === 'before' ? 'Microsoft connection' : 'Connections';
    for (const [q, text, good] of [['microsoft_connected=1', 'Microsoft connected', true], ['microsoft_error=Microsoft%20access%20was%20not%20granted', 'Microsoft access was not granted', false]]) {
      const { page, errs } = await newPage(st, owner, { path: `/?${q}` });
      const status = main(page).getByRole('status');
      ok(`/?${q}: lands on "${heading}" with the Microsoft card`, (await main(page).getByRole('heading', { name: heading, exact: true }).count()) === 1 && (await main(page).getByText('Microsoft 365').count()) >= 1);
      ok(`/?${q}: status line "${text}" (${good ? 'ok' : 'error'} color)`, (await status.filter({ hasText: text }).count()) === 1 && (await status.filter({ hasText: text }).evaluate(e => getComputedStyle(e).color)) !== (await main(page).getByRole('heading', { name: heading }).evaluate(e => getComputedStyle(e).color)));
      ok(`/?${q}: URL cleaned to /`, await page.evaluate(() => location.pathname + location.search) === '/');
      ok(`/?${q}: 0 console errors`, errs.length === 0, errs.slice(0, 3).join(' | '));
    }
    { const { page, errs } = await newPage(st, owner, { path: '/?google_connected=calendar' });
      ok('/?google_connected=calendar: stays on Workspaces (unchanged)', (await main(page).getByRole('heading', { name: 'Workspaces', exact: true }).count()) === 1 && (await main(page).getByText('Microsoft 365').count()) === 0);
      ok('/?google_connected=calendar: URL cleaned to /', await page.evaluate(() => location.pathname + location.search) === '/');
      ok('/?google_connected: 0 console errors', errs.length === 0, errs.slice(0, 3).join(' | ')); }
  } finally { await browser.close(); srv.kill(); }
  console.log(`return ${phase}: ${pass}/${total}`);
}

async function after(file) {
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  await startServer(st);
  browser = await chromium.launch();
  try {
    const owner = await session(st.users.Owner);
    const { page, errs } = await newPage(st, owner);
    const rows = await menuRows(page);
    ok('user menu: one Connections row where the two were, nothing else moved', JSON.stringify(rows) === JSON.stringify(MENU_AFTER), JSON.stringify(rows));
    await go(page, 'Connections');
    ok('PageHeader "Connections"', (await main(page).getByRole('heading', { level: 1, name: 'Connections', exact: true }).count()) === 1);
    const cards = main(page).locator('[data-provider]');
    ok('three provider cards: Google · Microsoft · Apollo', JSON.stringify(await cards.evaluateAll(es => es.map(e => e.dataset.provider))) === JSON.stringify(['google', 'microsoft', 'apollo']));
    const tops = await cards.evaluateAll(es => es.map(e => Math.round(e.getBoundingClientRect().top)));
    ok('1440: cards side by side', new Set(tops).size === 1, tops.join(','));
    ok('Google: card pill ok, rows ok Calendar / off Gmail / off Slides', JSON.stringify(await main(page).locator('[data-provider="google"] [data-status]').evaluateAll(es => es.map(e => e.dataset.status))) === JSON.stringify(['ok', 'off', 'ok', 'off']), 'card pill, then Gmail / Calendar / Slides');
    ok('Google: Connect buttons only for the ungranted features (consent-once rows unchanged)', (await main(page).getByRole('button', { name: 'Connect Gmail →' }).count()) === 1 && (await main(page).getByRole('button', { name: 'Connect Google Slides →' }).count()) === 1 && (await main(page).getByRole('button', { name: 'Connect Google Calendar →' }).count()) === 0 && (await main(page).getByRole('button', { name: 'Disconnect Google' }).count()) === 1);
    ok('Microsoft: connected pill with the account, Reconnect / Check / Disconnect, Outlook sync block', (await main(page).locator('[data-provider="microsoft"] [data-status="ok"]').count()) === 1 && (await main(page).locator('[data-provider="microsoft"]').getByText(st.users.Owner.email).count()) >= 1 && (await main(page).getByRole('button', { name: 'Reconnect / switch account →' }).count()) === 1 && (await main(page).getByRole('button', { name: 'Check connection' }).count()) === 1 && (await main(page).getByRole('button', { name: 'Disconnect' , exact: true }).count()) === 1 && (await main(page).getByTestId('outlook-sync').count()) === 1 && (await main(page).getByRole('button', { name: 'Sync Outlook' }).count()) === 1);
    ok('Apollo: 2 mailboxes from the snapshot + last sync, no buttons', (await main(page).locator('[data-provider="apollo"]').getByText('one@connections.example.com').count()) === 1 && (await main(page).locator('[data-provider="apollo"]').getByText('two@connections.example.com').count()) === 1 && (await main(page).locator('[data-provider="apollo"] [data-status="ok"]').count()) >= 1 && (await main(page).locator('[data-provider="apollo"]').getByRole('button').count()) === 0 && /Last sync/i.test(await main(page).locator('[data-provider="apollo"]').innerText()));
    const mbRadius = await main(page).locator('[data-provider="apollo"]').getByText('one@connections.example.com', { exact: true }).evaluate(e => getComputedStyle(e.parentElement).borderRadius);
    ok('Apollo: mailbox row radius = KIT_RADIUS.inner (10px)', mbRadius === '10px', mbRadius);
    const m = await newPage(st, owner, { width: 390, height: 844 });
    await go(m.page, 'Connections');
    const mTops = await main(m.page).locator('[data-provider]').evaluateAll(es => es.map(e => Math.round(e.getBoundingClientRect().top)));
    ok('390: one column', new Set(mTops).size === 3, mTops.join(','));
    await noScroll(m.page, '390 Connections');
    const v = await newPage(st, await session(st.users.Viewer));
    const vRows = await menuRows(v.page);
    ok('viewer: menu = Profile & badges · Voice Profile · Connections · Sign out', JSON.stringify(vRows) === JSON.stringify(MENU_AFTER.filter(r => r !== 'UI kit')), JSON.stringify(vRows));
    await go(v.page, 'Connections');
    ok('viewer: three cards, own grants not connected, Apollo read-only', (await main(v.page).locator('[data-provider]').count()) === 3 && (await main(v.page).locator('[data-provider="google"] [data-status="off"]').count()) === 4 && (await main(v.page).locator('[data-provider="microsoft"] [data-status="off"]').count()) === 1 && (await main(v.page).locator('[data-provider="apollo"]').getByText('one@connections.example.com').count()) === 1 && (await main(v.page).getByTestId('outlook-sync').count()) === 0);
    ok('0 console errors', errs.length + m.errs.length + v.errs.length === 0, [...errs, ...m.errs, ...v.errs].slice(0, 5).join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(`after: ${pass}/${total}`);
}

async function click(file) {
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  await startServer(st);
  browser = await chromium.launch();
  try {
    const { page, errs, targets } = await newPage(st, await session(st.users.Owner));
    const calls = [];
    await fixtureMicrosoft(page, calls);
    await go(page, 'Connections');
    targets.length = 0; await main(page).getByRole('button', { name: 'Connect Gmail →' }).click(); await page.waitForTimeout(500);
    ok('Google: Connect Gmail -> /api/google/connect?feature=gmail&return=/', targets[0] === '/api/google/connect?feature=gmail&return=%2F', targets[0]);
    targets.length = 0; await main(page).getByRole('button', { name: 'Connect Google Slides →' }).click(); await page.waitForTimeout(500);
    ok('Google: Connect Google Slides -> feature=slides', targets[0] === '/api/google/connect?feature=slides&return=%2F', targets[0]);
    targets.length = 0; await main(page).getByRole('button', { name: 'Reconnect / switch account →' }).click(); await page.waitForTimeout(500);
    ok('Microsoft: Reconnect -> /api/microsoft/connect?return=/', targets[0] === '/api/microsoft/connect?return=%2F', targets[0]);
    await main(page).getByRole('button', { name: 'Check connection' }).click(); await page.waitForTimeout(800);
    ok('Microsoft: Check connection -> POST /api/microsoft/check, note shows the folders', calls.includes('POST /api/microsoft/check') && (await main(page).getByRole('status').filter({ hasText: /Checked just now - reading fixture@connections.example.com · Inbox 12 total · 4 in the 90-day window/ }).count()) === 1);
    await main(page).getByRole('button', { name: /Preview sync/ }).click(); await page.waitForTimeout(800);
    ok('Microsoft: Preview sync -> POST sync?dry_run=1, per-folder line', calls.includes('POST /api/microsoft/sync?dry_run=1') && (await main(page).getByText('Preview - nothing stored:').count()) === 1 && (await main(page).getByText(/^Sent: 9 seen · 2 kept · 7 skipped/).count()) === 1);
    await main(page).getByRole('button', { name: 'Sync Outlook' }).click(); await page.waitForTimeout(800);
    ok('Microsoft: Sync Outlook -> POST sync, Partners line', calls.includes('POST /api/microsoft/sync') && (await main(page).getByText('Synced:').count()) === 1 && (await main(page).getByText(/^Partners: 0 touches recorded/).count()) === 1);
    await main(page).getByRole('button', { name: 'Disconnect Google' }).click(); await page.waitForTimeout(1200);
    ok('Google: Disconnect Google -> all three rows off, three Connect buttons', (await main(page).locator('[data-provider="google"] [data-status="off"]').count()) === 4 && (await main(page).getByRole('button', { name: 'Connect Google Calendar →' }).count()) === 1 && (await main(page).getByRole('button', { name: 'Disconnect Google' }).count()) === 0);
    ok('Google: grant row really gone', (await svc.from('google_grants').select('*', { count: 'exact', head: true }).eq('user_id', st.users.Owner.id)).count === 0);
    await main(page).getByRole('button', { name: 'Disconnect', exact: true }).click(); await page.waitForTimeout(1500);
    ok('Microsoft: Disconnect -> Not connected, Connect Microsoft, no Outlook block', (await main(page).locator('[data-provider="microsoft"] [data-status="off"]').count()) === 1 && (await main(page).getByRole('button', { name: 'Connect Microsoft →' }).count()) === 1 && (await main(page).getByTestId('outlook-sync').count()) === 0 && (await main(page).getByRole('status').filter({ hasText: 'Disconnected - Prospector deleted its stored Microsoft token' }).count()) === 1);
    ok('Microsoft: grant row really gone', (await svc.from('microsoft_grants').select('*', { count: 'exact', head: true }).eq('user_id', st.users.Owner.id)).count === 0);
    targets.length = 0; await main(page).getByRole('button', { name: 'Connect Microsoft →' }).click(); await page.waitForTimeout(500);
    ok('Microsoft: Connect -> same target as Reconnect', targets[0] === '/api/microsoft/connect?return=%2F', targets[0]);
    await go(page, 'Voice Profile'); ok('user menu: Voice Profile still opens', (await main(page).getByText('Voice Profile').count()) >= 1);
    await go(page, 'Profile & badges'); ok('user menu: Profile & badges still opens', (await page.getByText(/badges/i).count()) >= 1);
    ok('0 console errors', errs.length === 0, errs.slice(0, 5).join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(`click: ${pass}/${total}`);
}

async function teardown(file) {
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const t of ['sales_raw_snapshots', 'sales_sync_runs', 'sales_mailbox_owners', 'auth_events', 'business_members']) await svc.from(t).delete().eq('business_id', st.B);
  for (const u of Object.values(st.users)) { for (const t of ['google_grants', 'microsoft_grants', 'business_members']) await svc.from(t).delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('actor_id', u.id); }
  await svc.from('businesses').delete().eq('id', st.B);
  for (const u of Object.values(st.users)) await svc.auth.admin.deleteUser(u.id);
  const afterC = await counts();
  const moved = WATCH.filter(t => afterC[t] !== st.before[t]);
  console.log(`teardown: before ${JSON.stringify(st.before)}\n          after  ${JSON.stringify(afterC)}\nrestored: ${moved.length ? 'NO - moved: ' + moved.join(', ') : 'yes'}`);
}

({ setup: () => setup(a1), shoot: () => shoot(a1, a2, a3 || 'after'), return: () => oauthReturn(a1, a2 || 'after'), after: () => after(a1), click: () => click(a1), teardown: () => teardown(a1) }[mode] || (() => { console.log('usage: setup|shoot|return|after|click|teardown'); }))()
  .then(() => process.exit(total && pass !== total ? 1 : 0)).catch(e => { console.error(e); if (browser) browser.close(); if (srv) srv.kill(); process.exit(1); });
