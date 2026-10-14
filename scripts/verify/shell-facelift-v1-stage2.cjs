// shell-facelift-v1 Stage 2 - the workspace header row, before and after. TEMP data only: 1 businesses row (goals_sales on, tagline + website), 2 temp users (owner + viewer), 1 accounts row - all deleted by teardown. 0 AI / 0 Apollo. HomeLover is never touched (its counts come from the Stage 1 script's hl mode). ~40s per mode, cap 4 min each.
// Modes (fixtures persist between runs so before and after see the same names and data):
//   setup <state.json>            create fixtures, write ids + passwords + a fixed clock + temp-table counts
//   shoot <state.json> <outdir>   serve build/ via server.js, screenshot: Command Center / Goals & Sales Overview / Business Intel & Strategy at 1440 dark, Goals & Sales Overview light, Command Center + Goals & Sales at 390, viewer Command Center; 0 console errors
//   click <state.json>            every control still works: all 7 sidebar views, the 3 Goals & Sales tabs, Scout (focus, palette, business pills, Escape), avatar -> Social Links, emoji picker, website ✎ -> Website URL (on Business Intel & Strategy); viewer sees the page
//   after <state.json>            Stage 2 structure: one 56px row with avatar · name · tabs · Scout; sticky after scrolling; identity line (20px) only on Business Intel & Strategy; Scout 240px idle and wider engaged; 390 wraps, not sticky, no sideways scroll
//   teardown <state.json>         delete everything setup made, print table counts before/after
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3964;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const WATCH = ['businesses', 'business_members', 'accounts', 'profiles', 'auth_events'];
const NAME = 'ZZ Facelift Header';
const VIEWS = ['Command Center', 'Goals & Sales', 'Accounts', 'Projects', 'Business Intel & Strategy', 'Ideas', 'Tools'];
const [mode, a1, a2] = process.argv.slice(2);
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const counts = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true })).count; return o; };
let srv, browser, pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
setTimeout(() => { console.log('ABORT (4 min cap)'); if (browser) browser.close(); if (srv) srv.kill(); process.exit(2); }, 240000).unref();

async function setup(file) {
  const before = await counts();
  const tag = 'sfl2-' + Date.now();
  const B = ins(await svc.from('businesses').insert({ name: NAME, website_url: 'https://header.example.com', tagline: 'A tagline long enough to read', color: '#6F8CF0', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
  const users = {};
  for (const [name, role] of [['Owner', 'owner'], ['Viewer', 'viewer']]) {
    const email = `${tag}-${name.toLowerCase()}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
    const { data: u, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(error.message);
    await svc.from('profiles').update({ display_name: `${name} Test`, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
    ins(await svc.from('business_members').insert({ business_id: B, email, name: `${name} Test`, user_id: u.user.id, role }).select());
    users[name] = { id: u.user.id, email, password };
  }
  const acc = { id: `${tag}-acc`, name: 'Acme Test Co', website: 'https://acme.example.com', stage: 'Prospect', tier: 'Gold', vertical: 'SaaS', notes: '', calls: [] };
  ins(await svc.from('accounts').insert({ id: acc.id, owner_email: users.Owner.email, business_id: B, data: acc, updated_at: new Date().toISOString(), last_touched_by: users.Owner.email, last_touched_at: new Date().toISOString() }).select());
  fs.writeFileSync(file, JSON.stringify({ tag, B, users, accId: acc.id, clock: Date.now(), before }, null, 2));
  console.log(`setup done: workspace ${B}, 2 users, 1 account. Counts before: ${JSON.stringify(before)}`);
}

async function session(u) {
  const c = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: s, error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error(error.message);
  return s.session;
}
async function startServer(st) {
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${st.B}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); return; } catch { await new Promise(r => setTimeout(r, 250)); } }
  throw new Error('server did not start');
}
async function newPage(st, sess, { width = 1440, height = 900, light = false } = {}) {
  const errs = [];
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage(); page.setDefaultTimeout(10000);
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); }); page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
  await page.clock.setFixedTime(new Date(st.clock));
  await page.addInitScript(([k, v, light]) => {
    if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
    if (light) localStorage.setItem('prospector_prefs', JSON.stringify({ displayMode: 'straight_shooter' }));
  }, [`sb-${REF}-auth-token`, JSON.stringify(sess), light]);
  await page.goto(`http://localhost:${PORT}/`);
  await page.locator('#main-content').getByText(NAME).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(2000);
  page.compact = width < 900;
  return { page, errs };
}
const shot = (page, out, name) => page.screenshot({ path: `${out}/${name}.png`, fullPage: true, animations: 'disabled', caret: 'hide' });
async function openWorkspace(page) {
  if (page.compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
  await page.getByLabel('Workspace').selectOption({ label: NAME }); await page.waitForTimeout(3000);
}
async function nav(page, label) {
  if (page.compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
  // dispatchEvent, not click: the Projects view leaves an invisible position:fixed inset:0 div over the whole app (pre-existing, not this stage), which swallows real pointer events on the sidebar.
  await page.locator('#root').getByRole('button', { name: label, exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
}
async function salesTab(page, label) { await page.locator('#main-content').getByRole('button', { name: label, exact: true }).click(); await page.waitForTimeout(2500); }
const mainText = page => page.locator('#main-content').innerText();
const header = page => page.locator('[data-workspace-header]');
const scoutInput = page => page.locator('#main-content').getByLabel('Scout');

async function shoot(file, out) {
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.mkdirSync(out, { recursive: true });
  await startServer(st);
  browser = await chromium.launch();
  const allErrs = [];
  const noScroll = async (page, name) => ok(`${name}: no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), await page.evaluate(() => `${document.documentElement.scrollWidth} <= ${window.innerWidth}`));
  try {
    const owner = await session(st.users.Owner);
    { const { page, errs } = await newPage(st, owner);
      await openWorkspace(page); await shot(page, out, 'command-center-1440-dark'); await noScroll(page, 'command-center-1440');
      await nav(page, 'Goals & Sales'); await salesTab(page, 'Overview'); await page.locator('[data-strip-tile]').first().waitFor(); await page.waitForTimeout(2000);
      await shot(page, out, 'sales-overview-1440-dark'); await noScroll(page, 'sales-overview-1440');
      await nav(page, 'Business Intel & Strategy'); await shot(page, out, 'intel-1440-dark'); await noScroll(page, 'intel-1440');
      allErrs.push(...errs.map(e => `owner 1440: ${e}`)); }
    { const { page, errs } = await newPage(st, owner, { light: true });
      await openWorkspace(page); ok('light mode class on body', await page.evaluate(() => document.body.classList.contains('mode-straight-shooter')));
      await nav(page, 'Goals & Sales'); await salesTab(page, 'Overview'); await page.locator('[data-strip-tile]').first().waitFor(); await page.waitForTimeout(2000);
      await shot(page, out, 'sales-overview-1440-light');
      allErrs.push(...errs.map(e => `owner light: ${e}`)); }
    { const { page, errs } = await newPage(st, owner, { width: 390, height: 844 });
      await openWorkspace(page); await shot(page, out, 'command-center-390-dark'); await noScroll(page, 'command-center-390');
      await nav(page, 'Goals & Sales'); await shot(page, out, 'sales-390-dark'); await noScroll(page, 'sales-390');
      allErrs.push(...errs.map(e => `owner 390: ${e}`)); }
    { const { page, errs } = await newPage(st, await session(st.users.Viewer));
      await openWorkspace(page); await shot(page, out, 'command-center-1440-viewer');
      allErrs.push(...errs.map(e => `viewer: ${e}`)); }
    ok('0 console errors', allErrs.length === 0, allErrs.slice(0, 5).join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(`shoot -> ${out}: ${fs.readdirSync(out).filter(f => f.endsWith('.png')).join(', ')}  ${pass}/${total}`);
}

async function click(file) {
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  await startServer(st);
  browser = await chromium.launch();
  try {
    const { page, errs } = await newPage(st, await session(st.users.Owner));
    await openWorkspace(page);
    let prev = await mainText(page);
    for (const v of VIEWS.slice(1)) {
      await nav(page, v); const now = await mainText(page);
      ok(`owner: sidebar "${v}" switches the view`, now !== prev && (await page.locator('#main-content').getByText(NAME).count()) >= (v === 'Ideas' || v === 'Tools' ? 0 : 1));
      prev = now;
    }
    await nav(page, 'Accounts'); ok('owner: Accounts lists the account', (await page.getByText('Acme Test Co').count()) >= 1);
    await nav(page, 'Goals & Sales');
    const goals = await mainText(page);
    await salesTab(page, 'Overview'); ok('owner: Overview tab', (await page.locator('[data-strip-tile]').count()) >= 1);
    await salesTab(page, 'Daily Huddle'); const huddle = await mainText(page); ok('owner: Daily Huddle tab', huddle !== goals && (await page.locator('[data-strip-tile]').count()) === 0);
    await salesTab(page, 'Goals'); ok('owner: Goals tab again', (await mainText(page)) !== huddle);
    const inp = scoutInput(page);
    await inp.click(); await page.waitForTimeout(500);
    ok('owner: Scout focus opens the palette', (await page.getByText('Suggested', { exact: true }).count()) === 1);
    ok('owner: business pills show (this workspace + All businesses)', (await page.getByRole('button', { name: 'All businesses' }).count()) === 1 && (await page.getByRole('button', { name: NAME, exact: true }).count()) >= 1);
    await inp.fill('Rank my'); await page.waitForTimeout(400);
    ok('owner: typing keeps the palette with Ask Scout', (await page.getByText(/ASK SCOUT/).count()) >= 1);
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    ok('owner: Escape closes the palette', (await page.getByText('Suggested', { exact: true }).count()) === 0);
    await inp.fill(''); await page.keyboard.press('Escape'); await page.mouse.click(700, 850); await page.waitForTimeout(300);
    await page.getByTitle('Edit social links').click(); await page.waitForTimeout(400);
    ok('owner: avatar opens Social Links', (await page.getByText('Social Links', { exact: true }).count()) === 1);
    await page.getByRole('button', { name: 'Cancel', exact: true }).first().click(); await page.waitForTimeout(300);
    ok('owner: Social Links closes', (await page.getByText('Social Links', { exact: true }).count()) === 0);
    const emoji = page.getByTitle(/emoji/i).first();
    const siblingsBefore = await emoji.evaluate(b => b.parentElement.children.length);
    await emoji.click(); await page.waitForTimeout(1500);
    ok('owner: emoji button opens the picker', (await emoji.evaluate(b => b.parentElement.children.length)) > siblingsBefore);
    await page.mouse.click(900, 700); await page.waitForTimeout(400);
    ok('owner: picker closes on click outside', (await emoji.evaluate(b => b.parentElement.children.length)) === siblingsBefore);
    await nav(page, 'Business Intel & Strategy');
    ok('owner: website link shows on Business Intel & Strategy', (await page.locator('#main-content').getByRole('link', { name: 'https://header.example.com' }).count()) === 1);
    await page.getByTitle('Edit website URL').click(); await page.waitForTimeout(400);
    ok('owner: ✎ opens Website URL', (await page.getByText('Website URL', { exact: true }).count()) === 1);
    await page.getByRole('button', { name: 'Cancel', exact: true }).first().click(); await page.waitForTimeout(300);
    ok('owner: Website URL closes', (await page.getByText('Website URL', { exact: true }).count()) === 0);
    const vw = await newPage(st, await session(st.users.Viewer));
    await openWorkspace(vw.page);
    ok('viewer: workspace name in the page', (await vw.page.locator('#main-content').getByText(NAME).count()) >= 1);
    await nav(vw.page, 'Goals & Sales');
    ok('viewer: Goals & Sales tabs visible', (await vw.page.locator('#main-content').getByRole('button', { name: 'Daily Huddle', exact: true }).count()) === 1);
    const vwSales = await mainText(vw.page); await nav(vw.page, 'Accounts'); ok('viewer: Accounts view switches (list access is per member, so the owner\'s account may be hidden)', (await mainText(vw.page)) !== vwSales);
    ok('0 console errors', errs.length + vw.errs.length === 0, [...errs, ...vw.errs].slice(0, 5).join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(`click: ${pass}/${total}`);
}

async function after(file) {
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  await startServer(st);
  browser = await chromium.launch();
  try {
    const owner = await session(st.users.Owner);
    const { page, errs } = await newPage(st, owner);
    await openWorkspace(page);
    const h = header(page);
    ok('header row present once', (await h.count()) === 1);
    const rowH = await h.locator('[data-workspace-row]').evaluate(e => e.getBoundingClientRect().height);
    ok('row is 56px', Math.round(rowH) === 56, `${rowH}px`);
    const hr = await h.evaluate(e => { const c = getComputedStyle(e); return [c.borderBottomLeftRadius, c.borderBottomRightRadius]; });
    ok('header bottom corners = KIT_RADIUS.inner (10px)', hr[0] === '10px' && hr[1] === '10px', hr.join(' / '));
    ok('row: avatar · name · emoji · Scout', (await h.getByTitle('Edit social links').count()) === 1 && (await h.getByRole('heading', { level: 1, name: NAME }).count()) === 1 && (await h.getByTitle(/emoji/i).count()) === 1 && (await h.getByLabel('Scout').count()) === 1);
    ok('no identity line on Command Center', (await page.locator('[data-workspace-identity]').count()) === 0 && (await page.locator('#main-content').getByText('A tagline long enough to read').count()) === 0);
    ok('no tabs in the row outside Goals & Sales', (await page.locator('#workspace-header-tabs button').count()) === 0);
    ok('no old territory Scout bar above the page', (await page.locator('#main-content').getByText('Full territory').count()) === 0 && (await page.locator('#main-content').getByText('deals in scope').count()) === 0);
    const idle = await h.getByLabel('Scout').evaluate(e => e.getBoundingClientRect().width);
    ok('Scout idle width <= 240', idle <= 240, `${idle}px`);
    await h.getByLabel('Scout').click(); await page.waitForTimeout(600);
    const wide = await h.getByLabel('Scout').evaluate(e => e.getBoundingClientRect().width);
    ok('Scout expands on focus (>= 480)', wide >= 480, `${wide}px`);
    ok('pill strip drops under the input', (await page.locator('[data-scout-pills]').count()) === 1 && (await page.locator('[data-scout-pills]').evaluate((e, rh) => e.getBoundingClientRect().top >= rh, rowH)));
    const palTop = await page.getByText('Suggested', { exact: true }).evaluate(e => e.getBoundingClientRect().top);
    const pillBottom = await page.locator('[data-scout-pills]').evaluate(e => e.getBoundingClientRect().bottom);
    ok('palette starts below the pill strip', palTop >= pillBottom, `${Math.round(palTop)} >= ${Math.round(pillBottom)}`);
    await page.keyboard.press('Escape'); await page.mouse.click(700, 850); await page.waitForTimeout(500);
    ok('Scout collapses again', (await h.getByLabel('Scout').evaluate(e => e.getBoundingClientRect().width)) <= 240);
    await nav(page, 'Goals & Sales');
    ok('Goals & Sales: 3 tabs inside the row', (await page.locator('#workspace-header-tabs button').count()) === 3 && (await h.locator('[data-workspace-row]').evaluate(e => Math.round(e.getBoundingClientRect().height))) === 56);
    await salesTab(page, 'Overview'); await page.locator('[data-strip-tile]').first().waitFor(); await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollTo(0, 900)); await page.waitForTimeout(400);
    const stuck = await page.evaluate(() => { const r = document.querySelector('[data-workspace-header]').getBoundingClientRect(); return { scrolled: window.scrollY, top: Math.round(r.top), visible: r.bottom > 0 }; });
    ok('row is sticky after scrolling the page', stuck.scrolled > 500 && stuck.top <= 1 && stuck.visible, JSON.stringify(stuck));
    await page.evaluate(() => window.scrollTo(0, 0));
    await nav(page, 'Business Intel & Strategy');
    const idh = await page.locator('[data-workspace-identity]').evaluate(e => e.getBoundingClientRect().height).catch(() => -1);
    ok('identity line (20px) only on Business Intel & Strategy', Math.round(idh) === 20 && (await page.locator('[data-workspace-identity]').getByText('A tagline long enough to read').count()) === 1 && (await page.locator('[data-workspace-identity]').getByRole('link', { name: 'https://header.example.com' }).count()) === 1, `${idh}px`);
    ok('no tabs in the row on Business Intel & Strategy', (await page.locator('#workspace-header-tabs button').count()) === 0);
    const m = await newPage(st, owner, { width: 390, height: 844 });
    await openWorkspace(m.page);
    ok('390: row wraps and is not sticky', (await header(m.page).evaluate(e => getComputedStyle(e).position)) === 'static' && (await header(m.page).getByLabel('Scout').evaluate(e => e.getBoundingClientRect().width)) >= 300);
    ok('390: no sideways scroll', await m.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    ok('0 console errors', errs.length + m.errs.length === 0, [...errs, ...m.errs].slice(0, 5).join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(`after: ${pass}/${total}`);
}

async function teardown(file) {
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  await svc.from('accounts').delete().eq('business_id', st.B);
  await svc.from('auth_events').delete().eq('business_id', st.B);
  for (const u of Object.values(st.users)) { await svc.from('business_members').delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('actor_id', u.id); }
  await svc.from('businesses').delete().eq('id', st.B);
  for (const u of Object.values(st.users)) await svc.auth.admin.deleteUser(u.id);
  const afterC = await counts();
  const moved = WATCH.filter(t => afterC[t] !== st.before[t]);
  console.log(`teardown: before ${JSON.stringify(st.before)}\n          after  ${JSON.stringify(afterC)}\nrestored: ${moved.length ? 'NO - moved: ' + moved.join(', ') : 'yes'}`);
}

({ setup: () => setup(a1), shoot: () => shoot(a1, a2), click: () => click(a1), after: () => after(a1), teardown: () => teardown(a1) }[mode] || (() => { console.log('usage: setup|shoot|click|after|teardown'); }))()
  .then(() => process.exit(total && pass !== total ? 1 : 0)).catch(e => { console.error(e); if (browser) browser.close(); if (srv) srv.kill(); process.exit(1); });
