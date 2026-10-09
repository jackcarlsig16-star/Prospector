// shell-facelift-v1 Stage 0 - token re-export must be pixel-identical. TEMP workspace only (1 businesses row with goals_sales, 2 temp users owner + viewer, 1 accounts row, 4 daily-count rows - all deleted by teardown). 0 AI / 0 Apollo / nothing read or written on HomeLover. ~40s per shoot, cap 4 min each.
// Modes (fixtures persist between shoots so both runs see the same names and data):
//   setup <state.json>                 create fixtures, write ids + sessions + a fixed clock
//   shoot <state.json> <outdir>        serve build/ via server.js, screenshot the 5 views at 1440 (and the 1440 + 390 gallery when present)
//   diff <dirA> <dirB>                 compare every PNG pixel by pixel; prints identical or the changed-pixel count + box
//   gate <state.json>                  ui-kit gallery: owner opens it; a viewer who sets the page directly lands on the workspace list
//   teardown <state.json>              delete everything setup made, print table counts before/after
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3962;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const WATCH = ['businesses', 'business_members', 'accounts', 'sales_email_daily_counts', 'profiles', 'auth_events'];
const [mode, a1, a2] = process.argv.slice(2);
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const counts = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true })).count; return o; };
let srv, browser, pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
setTimeout(() => { console.log('ABORT (4 min cap)'); if (browser) browser.close(); if (srv) srv.kill(); process.exit(2); }, 240000).unref();

async function setup(file) {
  const before = await counts();
  const tag = 'sfl0-' + Date.now();
  const B = ins(await svc.from('businesses').insert({ name: 'ZZ Facelift Check', website_url: 'https://example.com', color: '#6F8CF0', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
  const users = {};
  for (const [name, role] of [['Owner', 'owner'], ['Viewer', 'viewer']]) {
    const email = `${tag}-${name.toLowerCase()}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
    const { data: u } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    await svc.from('profiles').update({ display_name: `${name} Test`, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
    ins(await svc.from('business_members').insert({ business_id: B, email, name: `${name} Test`, user_id: u.user.id, role }).select());
    users[name] = { id: u.user.id, email, password };
  }
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const addDays = (v, n) => new Date(Date.parse(`${v}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
  const WEEK = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7)), LAST = addDays(WEEK, -7);
  const dc = (day, mailbox, delivered, hard_bounced, spam_blocked, opened, replied) => ({ business_id: B, day, mailbox, delivered, hard_bounced, spam_blocked, opened, clicked: 0, replied });
  ins(await svc.from('sales_email_daily_counts').insert([dc(LAST, 'a@t.io', 100, 3, 3, 10, 1), dc(LAST, 'b@t.io', 50, 0, 1, 5, 0), dc(WEEK, 'a@t.io', 200, 4, 1, 15, 0), dc(WEEK, 'b@t.io', 100, 0, 0, 5, 2)]).select());
  const acc = { id: `${tag}-acc`, name: 'Acme Test Co', website: 'https://acme.example.com', stage: 'Prospect', tier: 'Gold', vertical: 'SaaS', notes: '', calls: [] };
  ins(await svc.from('accounts').insert({ id: acc.id, owner_email: users.Owner.email, business_id: B, data: acc, updated_at: new Date().toISOString(), last_touched_by: users.Owner.email, last_touched_at: new Date().toISOString() }).select());
  fs.writeFileSync(file, JSON.stringify({ tag, B, users, accId: acc.id, clock: Date.now(), before }, null, 2));
  console.log(`setup done: workspace ${B}, 2 users, 1 account, 4 daily-count rows. Counts before: ${JSON.stringify(before)}`);
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
  // Frozen clock: "x min ago" / week math in the browser read the same instant on every shoot.
  await page.clock.setFixedTime(new Date(st.clock));
  await page.addInitScript(([k, v, light]) => {
    if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
    if (light) localStorage.setItem('prospector_prefs', JSON.stringify({ displayMode: 'straight_shooter' }));
  }, [`sb-${REF}-auth-token`, JSON.stringify(sess), light]);
  await page.goto(`http://localhost:${PORT}/`); await page.getByLabel('Workspace').or(page.getByRole('button', { name: 'Open menu' })).first().waitFor({ state: 'attached', timeout: 20000 }); await page.waitForTimeout(3000);
  return { page, errs };
}
const openUserMenu = async page => { await page.getByRole('button', { name: /^My profile/ }).click(); await page.waitForTimeout(400); };
const shot = (page, out, name) => page.screenshot({ path: `${out}/${name}.png`, fullPage: true, animations: 'disabled', caret: 'hide' });
async function openWorkspace(page) { await page.getByLabel('Workspace').selectOption({ label: 'ZZ Facelift Check' }); await page.waitForTimeout(2500); }
async function openOverview(page) {
  await page.locator('#root').getByRole('button', { name: 'Goals & Sales', exact: true }).click(); await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.locator('[data-strip-tile]').first().waitFor(); await page.waitForTimeout(2500);
}

async function shoot(file, out) {
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.mkdirSync(out, { recursive: true });
  await startServer(st);
  browser = await chromium.launch();
  const sess = await session(st.users.Owner);
  const allErrs = [];
  try {
    { // dark: Scout bar (workspace landing), Overview, account card, Admin
      const { page, errs } = await newPage(st, sess);
      await openWorkspace(page); await page.waitForTimeout(1500); await shot(page, out, 'scout-dark');
      await openOverview(page); await shot(page, out, 'overview-dark');
      await page.locator('#root').getByRole('button', { name: 'Accounts', exact: true }).click(); await page.waitForTimeout(2500);
      await page.getByText('Acme Test Co').first().click(); await page.waitForTimeout(2000); await shot(page, out, 'account-card-dark');
      await page.getByRole('button', { name: 'Admin', exact: true }).click(); await page.waitForTimeout(3000); await shot(page, out, 'admin-dark');
      allErrs.push(...errs);
    }
    { // light: Overview under mode-straight-shooter
      const { page, errs } = await newPage(st, sess, { light: true });
      await openWorkspace(page); await openOverview(page);
      ok('light mode class on body', await page.evaluate(() => document.body.classList.contains('mode-straight-shooter')));
      await shot(page, out, 'overview-light');
      allErrs.push(...errs);
    }
    if (process.env.GALLERY) for (const [w, h] of [[1440, 900], [390, 844]]) for (const light of [false, true]) {
      const { page, errs } = await newPage(st, sess, { width: w, height: h, light });
      if (w < 900) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
      await openUserMenu(page); await page.getByRole('button', { name: 'UI kit', exact: true }).click(); await page.locator('[data-ui-gallery]').waitFor(); await page.waitForTimeout(1500);
      await shot(page, out, `gallery-${w}-${light ? 'light' : 'dark'}`);
      ok(`gallery ${w} ${light ? 'light' : 'dark'}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), await page.evaluate(() => `${document.documentElement.scrollWidth} <= ${window.innerWidth}`));
      allErrs.push(...errs);
    }
    ok('0 console errors', allErrs.length === 0, allErrs.slice(0, 5).join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(`shoot -> ${out}: ${fs.readdirSync(out).filter(f => f.endsWith('.png')).join(', ')}  ${pass}/${total}`);
}

// Pixel compare inside Chromium (no image-diff dependency in the repo): decode both PNGs on a canvas, count RGBA differences.
async function diff(dirA, dirB) {
  browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  for (const f of fs.readdirSync(dirA).filter(f => f.endsWith('.png') && !f.startsWith('gallery'))) {
    const A = fs.readFileSync(`${dirA}/${f}`), Bf = `${dirB}/${f}`;
    if (!fs.existsSync(Bf)) { ok(f, false, 'missing in second run'); continue; }
    const Bb = fs.readFileSync(Bf);
    if (A.equals(Bb)) { ok(f, true, 'byte-identical'); continue; }
    const r = await page.evaluate(async ([a, b]) => {
      const load = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = src; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return { size: `${ia.width}x${ia.height} vs ${ib.width}x${ib.height}` };
      const px = img => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, img.width, img.height).data; };
      const da = px(ia), db = px(ib); let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let i = 0; i < da.length; i += 4) if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2] || da[i + 3] !== db[i + 3]) { n++; const p = i / 4, x = p % ia.width, y = Math.floor(p / ia.width); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      return { n, box: n ? `${x0},${y0} -> ${x1},${y1}` : null };
    }, [`data:image/png;base64,${A.toString('base64')}`, `data:image/png;base64,${Bb.toString('base64')}`]);
    ok(f, !r.size && r.n === 0, r.size ? `size ${r.size}` : r.n === 0 ? 'pixel-identical (encoding differs)' : `${r.n} pixels differ, box ${r.box}`);
  }
  await browser.close();
  console.log(`diff ${dirA} vs ${dirB}: ${pass}/${total}`);
}

// Sets App's `page` state straight through React's own hook queue - what a user forcing the page name would have to do, since there is no URL route.
async function forcePage(page, name) {
  return page.evaluate(n => {
    const rootEl = document.getElementById('root');
    const key = Object.keys(rootEl).find(k => k.startsWith('__reactContainer'));
    const stack = [rootEl[key]];
    while (stack.length) {
      const f = stack.pop(); if (!f) continue;
      for (let h = f.memoizedState, i = 0; h && typeof h === 'object' && 'queue' in h && i < 400; h = h.next, i++) {
        if (h.memoizedState === 'businesses-home' && h.queue?.dispatch) { h.queue.dispatch(n); return true; }
      }
      if (f.sibling) stack.push(f.sibling); if (f.child) stack.push(f.child);
    }
    return false;
  }, name);
}
async function gate(file) {
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  await startServer(st);
  browser = await chromium.launch();
  try {
    const own = await newPage(st, await session(st.users.Owner));
    await openUserMenu(own.page);
    ok('owner: UI kit entry in the user menu', await own.page.getByRole('button', { name: 'UI kit', exact: true }).count() === 1);
    ok('owner: forcing ui-kit opens the gallery', await forcePage(own.page, 'ui-kit') && await own.page.locator('[data-ui-gallery]').waitFor({ timeout: 4000 }).then(() => true, () => false));
    const vw = await newPage(st, await session(st.users.Viewer));
    await openUserMenu(vw.page);
    ok('viewer: no UI kit entry in the user menu', await vw.page.getByRole('button', { name: 'UI kit', exact: true }).count() === 0);
    ok('viewer: page state found and set to ui-kit', await forcePage(vw.page, 'ui-kit'));
    await vw.page.waitForTimeout(1500);
    ok('viewer: gallery never renders', await vw.page.locator('[data-ui-gallery]').count() === 0);
    ok('viewer: lands back on the workspace list', await vw.page.getByRole('heading', { name: 'Businesses' }).count() === 1);
    ok('0 console errors', own.errs.length + vw.errs.length === 0, [...own.errs, ...vw.errs].slice(0, 5).join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(`gate: ${pass}/${total}`);
}

async function teardown(file) {
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  await svc.from('accounts').delete().eq('business_id', st.B);
  await svc.from('sales_email_daily_counts').delete().eq('business_id', st.B);
  for (const u of Object.values(st.users)) { await svc.from('business_members').delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('actor_id', u.id); }
  await svc.from('auth_events').delete().eq('business_id', st.B);
  await svc.from('businesses').delete().eq('id', st.B);
  for (const u of Object.values(st.users)) await svc.auth.admin.deleteUser(u.id);
  const after = await counts();
  const moved = WATCH.filter(t => after[t] !== st.before[t]);
  console.log(`teardown: before ${JSON.stringify(st.before)}\n          after  ${JSON.stringify(after)}\nrestored: ${moved.length ? 'NO - moved: ' + moved.join(', ') : 'yes'}`);
}

({ setup: () => setup(a1), shoot: () => shoot(a1, a2), diff: () => diff(a1, a2), gate: () => gate(a1), teardown: () => teardown(a1) }[mode] || (() => { console.log('usage: setup|shoot|diff|gate|teardown'); }))()
  .then(() => process.exit(total && pass !== total ? 1 : 0)).catch(e => { console.error(e); if (browser) browser.close(); if (srv) srv.kill(); process.exit(1); });
