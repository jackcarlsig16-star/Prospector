// call-notes-targets-v1 REV3 Stage 1 - review-screen shots. TEMP data only: 1 workspace (goals_sales on, local server only), 2 temp users (owner M, viewer V). The extract call is answered from <outdir>/fixture-b-extract.json (saved by call-notes-targets-v1-stage1.cjs from a real run): 0 Claude, 0 Apollo / 0 syncs, nothing is accepted. Needs a fresh `npm run build`. ~40-60s, cap 4 min.
// Usage: node scripts/verify/call-notes-targets-v1-stage1-ui.cjs <outdir>
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3987, tag = 'cnt1ui-' + Date.now();
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const OUT = process.argv[2] || '/tmp';
const fixture = JSON.parse(fs.readFileSync(`${OUT}/fixture-b-extract.json`, 'utf8'));
const made = { biz: null, users: [] };
let srv, browser, pass = 0, total = 0, blocked = 0, extractCalls = 0, writes = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const cleanup = require('./lib/tempGuard.cjs')(removeTemp, { capMs: 240000 });

async function removeTemp() {
  if (browser) await browser.close().catch(() => {});
  if (srv) srv.kill();
  const b = made.biz;
  if (b) for (const t of ['sales_goals', 'business_members', 'auth_events']) { const r = await svc.from(t).delete().eq('business_id', b); if (r.error) console.log(`cleanup ${t}: ${r.error.message}`); }
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
  return { id: u.user.id, session: (await c.auth.signInWithPassword({ email, password })).data.session };
}
async function newPage(u, width, height) {
  const errs = [];
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage(); page.setDefaultTimeout(10000);
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); }); page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
  await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)/, r => { blocked++; r.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"blocked by verify script"}' }); });
  await page.route(/\/goals\/call-notes\/extract$/, r => { extractCalls++; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) }); });
  await page.route(/\/goals\/call-notes$/, r => { writes++; r.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"accept blocked by verify script"}' }); });
  await page.addInitScript(([k, v]) => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(u.session)]);
  await page.goto(`http://localhost:${PORT}/`); await page.waitForTimeout(3000);
  return { page, errs };
}
let WS_NAME;
async function navSales(page, compact) {
  const menu = async () => { if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); } };
  await menu(); await page.getByLabel('Workspace').selectOption({ label: WS_NAME }); await page.waitForTimeout(3000);
  await menu(); await page.locator('#root').getByRole('button', { name: 'Goals & Sales', exact: true }).dispatchEvent('click'); await page.waitForTimeout(4500);
}
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

(async () => {
  try {
    WS_NAME = `ZZ Intake UI ${tag.slice(-4)}`;
    made.biz = ins(await svc.from('businesses').insert({ name: WS_NAME, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}-jack@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
    const M = await user('Jack Zz', 'owner'), V = await user('Viewer Zz', 'viewer');
    ins(await svc.from('sales_goals').insert({ business_id: made.biz, goal_type: 'partnership', name: 'Gallagher', pipeline_status: 'replied', owner_user_id: M.id }).select());
    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${made.biz}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
    browser = await chromium.launch();

    for (const [width, height, compact] of [[1440, 900, false], [390, 844, true]]) {
      const { page, errs } = await newPage(M, width, height);
      await navSales(page, compact);
      await page.getByRole('button', { name: /^(Open tasks|Tasks)/ }).click();
      await page.getByRole('button', { name: '📝 Paste notes' }).click();
      await page.getByLabel('What these notes are').selectOption('partner_update');
      await page.getByLabel('Source label').fill('Brad weekly 10/13');
      await page.getByRole('textbox', { name: 'Call notes' }).fill('Upside x HomeLover joint plan - Oct 13 (fixture B text; the reply is the saved real extract).');
      await page.getByRole('button', { name: 'Read notes' }).click();
      await page.getByRole('region', { name: 'Companies mentioned' }).waitFor();
      const regions = await page.getByRole('region').evaluateAll(els => els.map(e => e.getAttribute('aria-label')).filter(l => l !== 'Intake'));
      ok(`${width}: five sections in order`, JSON.stringify(regions.filter(l => ['Companies mentioned', 'People', 'Touches', 'Tasks', 'Ownership & intel'].includes(l))) === JSON.stringify(['Companies mentioned', 'People', 'Touches', 'Tasks', 'Ownership & intel']), JSON.stringify(regions));
      const text = await page.locator('section[aria-label="Intake"]').innerText();
      ok(`${width}: kept-with-note, pipeline add and ownership lines visible`, /Kept with the note/.test(text) && /Will add Marriott/.test(text) && /owner Upside/.test(text));
      ok(`${width}: Accept button counts the ticked rows`, await page.getByRole('button', { name: /^Accept \d+$/ }).count() === 1);
      await page.screenshot({ path: `${OUT}/cnt1-${width}-review-top.png` });
      await page.getByRole('region', { name: 'Ownership & intel' }).scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/cnt1-${width}-review-intel.png` });
      ok(`${width}: no sideways scroll`, await noSideScroll(page));
      ok(`${width}: 0 console errors`, !errs.length, errs.join(' | '));
    }
    const { page: vp } = await newPage(V, 1440, 900);
    await navSales(vp, false);
    await vp.getByRole('button', { name: /^(Open tasks|Tasks)/ }).click(); await vp.waitForTimeout(800);
    ok('viewer: no Paste notes button', await vp.getByRole('button', { name: '📝 Paste notes' }).count() === 0);
    ok('0 real extract calls left the browser, 0 accepts, 0 sync/Apollo', extractCalls === 2 && writes === 0, `extract ${extractCalls} accept ${writes} blocked ${blocked}`);
  } catch (e) {
    ok('script ran without throwing', false, e.message);
  } finally {
    await cleanup();
    console.log(`teardown complete · ${pass}/${total} passed`);
    process.exit(pass === total ? 0 : 1);
  }
})();
