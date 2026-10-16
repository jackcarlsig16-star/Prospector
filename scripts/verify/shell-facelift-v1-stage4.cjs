// shell-facelift-v1 Stage 4 - Admin (tab strip, Settings, Integrations), before and after. TEMP data only: 1 businesses row, 3 temp users - PlatOwner (profiles.is_platform_owner = true, member owner), WsOwner (workspace owner, NOT platform owner), Viewer - all deleted by teardown, which also clears is_platform_owner and checks the profile rows are gone. 0 AI / 0 Apollo / 0 Salesforce / 0 Hunter calls: /api/sfdc/auth is answered 204 in the browser (target recorded), /api/sfdc/accounts answers a fixture error (so nothing is merged or saved), /api/hunter/account answers a fixture quota. The only DB write the clicks make is the temp workspace's own features (flipped and flipped back). Every other workspace's features are snapshotted at setup and compared at teardown. HomeLover counts come from the Stage 1 script's hl mode. ~40s per mode, cap 4 min each.
// Modes (fixtures persist between runs so before and after see the same data):
//   setup <state.json>                          create fixtures, write ids + passwords + a fixed clock + counts + other workspaces' features
//   shoot <state.json> <outdir> before|after    serve build/ via server.js, screenshot Admin > Settings + Integrations: 1440 dark + light, 390, workspace owner (not platform owner); record tab lists + feature notes (before) or compare (after); 0 console errors
//   click <state.json> before|after             every control on Settings + Integrations; records localStorage end states (before) or compares them (after)
//   after <state.json>                          Stage 4 structure: one-row tab strip with group prefixes, ToggleRows with the old notes as hover help, collapsed cards, kit cards on Integrations, 390 no sideways scroll
//   teardown <state.json>                       delete everything setup made, clear is_platform_owner, print counts before/after
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3966;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const WATCH = ['businesses', 'business_members', 'profiles', 'auth_events', 'accounts'];
const NAME = 'ZZ Facelift Admin';
const TABS_ALL = ['👥 Members & Access', '🔌 Integrations', '💰 Pricing', '⚙️ Settings'];
const TABS_OWNER = ['👥 Members & Access', '🔌 Integrations', '💰 Pricing', '✉ Outreach Intelligence', '📋 Access Log', '☎ Zoom Events', '☁ Salesforce Tools', '⚙️ Settings'];
const FEATURE_LABELS = ['Goals & Sales', 'Outlook voice', 'Outlook meetings', 'Outlook reply times'];
const KEYS = ['prospector_diamonds_enabled', 'prospector_integrations', 'sfdc_access_token', 'sfdc_instance_url', 'sfdc_user_id', 'sfdc_user_name'];
const [mode, a1, a2, a3] = process.argv.slice(2);
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const counts = async () => { const o = {}; for (const t of WATCH) { const r = await svc.from(t).select('*', { count: 'exact', head: true }); o[t] = r.error ? 'n/a' : r.count; } return o; };
const otherFeatures = async B => Object.fromEntries((ins(await svc.from('businesses').select('id,features').neq('id', B).order('id'))).map(b => [b.id, b.features]));
let srv, browser, pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
require('./lib/tempGuard.cjs')(async () => { if (browser) await browser.close().catch(() => {}); if (srv) srv.kill(); }, { capMs: 240000 });

async function setup(file) {
  const before = await counts();
  const tag = 'sfl4-' + Date.now();
  const B = ins(await svc.from('businesses').insert({ name: NAME, website_url: 'https://admin.example.com', tagline: 'Admin fixture', color: '#6F8CF0', owner_email: `${tag}-wsowner@example.com`, access_code: tag, features: {} }).select().single()).id;
  const users = {};
  for (const [name, role, plat] of [['PlatOwner', 'owner', true], ['WsOwner', 'owner', false], ['Viewer', 'viewer', false]]) {
    const email = `${tag}-${name.toLowerCase()}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
    const { data: u, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(error.message);
    ins(await svc.from('profiles').update({ display_name: `${name} Test`, welcomed_at: new Date().toISOString(), is_platform_owner: plat }).eq('id', u.user.id).select());
    ins(await svc.from('business_members').insert({ business_id: B, email, name: `${name} Test`, user_id: u.user.id, role }).select());
    users[name] = { id: u.user.id, email, password };
  }
  const others = await otherFeatures(B);
  fs.writeFileSync(file, JSON.stringify({ tag, B, users, clock: Date.now(), before, others }, null, 2));
  console.log(`setup done: workspace ${B}, 3 users (PlatOwner is_platform_owner=true). ${Object.keys(others).length} other workspaces' features snapshotted. Counts before: ${JSON.stringify(before)}`);
}

async function session(u) {
  const c = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: s, error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error(error.message);
  return s.session;
}
async function startServer(st) {
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); return; } catch { await new Promise(r => setTimeout(r, 250)); } }
  throw new Error('server did not start');
}
async function newPage(st, sess, { width = 1440, height = 900, light = false } = {}) {
  const errs = [], calls = [];
  const ctx = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(10000);
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); }); page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
  page.on('dialog', d => { calls.push(`dialog ${d.message()}`); d.accept(); });
  await page.clock.setFixedTime(new Date(st.clock));
  await page.addInitScript(([k, v, light]) => {
    if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
    if (light) localStorage.setItem('prospector_prefs', JSON.stringify({ displayMode: 'straight_shooter' }));
  }, [`sb-${REF}-auth-token`, JSON.stringify(sess), light]);
  await page.route(/\/api\/sfdc\/auth/, r => { calls.push('GET /api/sfdc/auth'); r.fulfill({ status: 204 }); });
  await page.route(/\/api\/sfdc\/accounts/, r => { calls.push(`POST /api/sfdc/accounts ${JSON.parse(r.request().postData() || '{}').mode}`); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ error: 'fixture - nothing pulled' }) }); });
  await page.route(/\/api\/hunter\/account/, r => { calls.push('GET /api/hunter/account'); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ plan: 'Fixture', searches: { used: 1, available: 25 }, verifications: { used: 2, available: 50 } }) }); });
  await page.goto(`http://localhost:${PORT}/`);
  await page.locator('#main-content').getByText(NAME).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
  page.compact = width < 900;
  return { page, errs, calls };
}
const shot = (page, out, name) => page.screenshot({ path: `${out}/${name}.png`, fullPage: true, animations: 'disabled', caret: 'hide' });
const main = page => page.locator('#main-content');
const noScroll = async (page, name) => ok(`${name}: no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), await page.evaluate(() => `${document.documentElement.scrollWidth} <= ${window.innerWidth}`));
async function openAdmin(page) {
  if (page.compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
  await page.getByRole('button', { name: /Admin$/ }).first().click(); await page.waitForTimeout(1500);
}
async function tab(page, label) { await main(page).getByRole('button', { name: label, exact: true }).click(); await page.waitForTimeout(900); }
const tabsShown = async (page, list) => { const r = []; for (const t of list) if (await main(page).getByRole('button', { name: t, exact: true }).count()) r.push(t); return r; };
const ls = page => page.evaluate(keys => Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)])), KEYS);
// Collapsed cards (after) open with their Show button; before has nothing to open.
async function expand(page) { const show = main(page).getByRole('button', { name: /^Show/ }); while (await show.count()) { await show.first().click(); await page.waitForTimeout(200); } }
// The innermost element holding both a card's name and the given control - same lookup on both builds.
const card = (page, name, has) => main(page).locator('div,section').filter({ has: page.getByText(name, { exact: true }) }).filter({ has }).last();

async function shoot(file, out, phase) {
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.mkdirSync(out, { recursive: true });
  await startServer(st);
  browser = await chromium.launch();
  const allErrs = [], rec = {};
  try {
    const owner = await session(st.users.PlatOwner);
    { const { page, errs } = await newPage(st, owner);
      await openAdmin(page);
      rec.tabsOwner = await tabsShown(page, TABS_OWNER);
      await tab(page, '⚙️ Settings'); await shot(page, out, 'settings-1440-dark'); await noScroll(page, 'settings-1440');
      if (phase === 'before') rec.notes = await main(page).locator('p').evaluateAll((ps, labels) => ps.map(p => p.innerText).filter(t => labels.some(l => t.startsWith(l + ': '))), FEATURE_LABELS);
      await tab(page, '🔌 Integrations'); await shot(page, out, 'integrations-1440-dark'); await noScroll(page, 'integrations-1440');
      allErrs.push(...errs.map(e => `owner 1440: ${e}`)); }
    { const { page, errs } = await newPage(st, owner, { light: true });
      await openAdmin(page);
      await tab(page, '⚙️ Settings'); await shot(page, out, 'settings-1440-light');
      await tab(page, '🔌 Integrations'); await shot(page, out, 'integrations-1440-light');
      allErrs.push(...errs.map(e => `owner light: ${e}`)); }
    { const { page, errs } = await newPage(st, owner, { width: 390, height: 844 });
      await openAdmin(page);
      await tab(page, '⚙️ Settings'); await shot(page, out, 'settings-390-dark'); await noScroll(page, 'settings-390');
      await tab(page, '🔌 Integrations'); await shot(page, out, 'integrations-390-dark'); await noScroll(page, 'integrations-390');
      allErrs.push(...errs.map(e => `owner 390: ${e}`)); }
    { const { page, errs } = await newPage(st, await session(st.users.WsOwner));
      await openAdmin(page);
      rec.tabsWsOwner = await tabsShown(page, TABS_OWNER);
      await tab(page, '⚙️ Settings'); await shot(page, out, 'settings-1440-wsowner');
      rec.wsOwnerSeesFeatures = (await main(page).getByText('Workspace features').count()) > 0;
      allErrs.push(...errs.map(e => `wsowner: ${e}`)); }
    { const { page, errs } = await newPage(st, await session(st.users.Viewer));
      if (page.compact) await page.getByRole('button', { name: 'Open menu' }).click();
      rec.viewerSeesAdmin = (await page.getByRole('button', { name: /Admin$/ }).count()) > 0;
      allErrs.push(...errs.map(e => `viewer: ${e}`)); }
    ok('0 console errors', allErrs.length === 0, allErrs.slice(0, 5).join(' | '));
    ok('platform owner: 8 tabs', JSON.stringify(rec.tabsOwner) === JSON.stringify(TABS_OWNER), JSON.stringify(rec.tabsOwner));
    ok('workspace owner (not platform): 4 tabs, no Workspace features', JSON.stringify(rec.tabsWsOwner) === JSON.stringify(TABS_ALL) && !rec.wsOwnerSeesFeatures, JSON.stringify(rec.tabsWsOwner));
    ok('viewer: no Admin entry', !rec.viewerSeesAdmin);
    if (phase === 'before') { ok('4 feature notes recorded', rec.notes.length === 4, JSON.stringify(rec.notes)); st.notesBefore = rec.notes; fs.writeFileSync(file, JSON.stringify(st, null, 2)); }
  } finally { await browser.close(); srv.kill(); }
  console.log(`shoot ${phase} -> ${out}: ${fs.readdirSync(out).filter(f => f.endsWith('.png')).join(', ')}  ${pass}/${total}`);
}

async function featureControl(page, phase, label) {
  if (phase === 'after') return main(page).locator(`[data-workspace="${JSON.parse(fs.readFileSync(a1, 'utf8')).B}"]`).getByRole('switch', { name: label, exact: true });
  return main(page).locator('span', { hasText: NAME }).locator('..').getByRole('checkbox', { name: label, exact: true });
}
const featureOn = (c, phase) => phase === 'after' ? c.getAttribute('aria-checked').then(v => v === 'true') : c.isChecked();

async function click(file, phase) {
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  await startServer(st);
  browser = await chromium.launch();
  const rec = {};
  try {
    const { page, errs, calls } = await newPage(st, await session(st.users.PlatOwner));
    await openAdmin(page);
    // Settings - workspace features on the temp workspace only
    await tab(page, '⚙️ Settings'); await expand(page);
    for (const label of FEATURE_LABELS) {
      const c = await featureControl(page, phase, label);
      const start = await featureOn(c, phase);
      await c.click(); await page.waitForTimeout(1200);
      const mid = (ins(await svc.from('businesses').select('features').eq('id', st.B).single())).features?.[label === 'Goals & Sales' ? 'goals_sales' : 'outlook_' + label.split(' ').slice(1).join('_')];
      const midUi = await featureOn(c, phase);
      await c.click(); await page.waitForTimeout(1200);
      const end = await featureOn(c, phase);
      ok(`feature "${label}": flips in the DB + UI and back`, !start && mid === true && midUi === true && end === false, `start ${start} db ${mid} ui ${midUi} end ${end}`);
    }
    ok('temp workspace features all off again', Object.values((ins(await svc.from('businesses').select('features').eq('id', st.B).single())).features || {}).every(v => !v));
    // Diamonds
    const dia = () => main(page).getByRole('button', { name: /Diamonds (ON|OFF)/ });
    rec.diamonds = [await ls(page).then(l => l.prospector_diamonds_enabled), (await dia().innerText()).trim()];
    await dia().click(); await page.waitForTimeout(300);
    rec.diamonds.push((await ls(page)).prospector_diamonds_enabled, (await dia().innerText()).trim());
    await dia().click(); await page.waitForTimeout(300);
    rec.diamonds.push((await ls(page)).prospector_diamonds_enabled, (await dia().innerText()).trim());
    ok('Diamonds: ON -> OFF -> ON, prospector_diamonds_enabled false then true', JSON.stringify(rec.diamonds) === JSON.stringify([null, '● Diamonds ON', 'false', '○ Diamonds OFF', 'true', '● Diamonds ON']), JSON.stringify(rec.diamonds));
    ok('Diamonds: still on Settings after the clicks', (await main(page).getByText('Data Backup & Restore').count()) === 1);
    // Backup export / import
    await page.evaluate(() => localStorage.setItem('prospector_zz_export_probe', '"x"'));
    const [dl] = await Promise.all([page.waitForEvent('download'), main(page).getByRole('button', { name: /Export all data/ }).click()]);
    const exported = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    const lsPrefixed = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('prospector_')).sort());
    ok('Export: file name + every prospector_* key', /^prospector-backup-\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename()) && JSON.stringify(Object.keys(exported).sort()) === JSON.stringify(lsPrefixed), `${dl.suggestedFilename()} ${Object.keys(exported).length} keys`);
    const imp = os.tmpdir() + `/sfl4-import-${st.tag}.json`;
    fs.writeFileSync(imp, JSON.stringify({ prospector_zz_import_probe: '"imported"', not_prefixed_probe: 'x' }));
    await Promise.all([page.waitForEvent('load'), main(page).locator('input[type=file][accept=".json"]').setInputFiles(imp)]);
    await page.waitForTimeout(1500); fs.unlinkSync(imp);
    const afterImport = await page.evaluate(() => [localStorage.getItem('prospector_zz_import_probe'), localStorage.getItem('not_prefixed_probe')]);
    ok('Import: prospector_* key written, other key ignored, alert + reload', afterImport[0] === '"imported"' && afterImport[1] === null && calls.some(c => c === 'dialog ✓ Imported 1 keys. Reloading…'), JSON.stringify(afterImport));
    await page.evaluate(() => { localStorage.removeItem('prospector_zz_import_probe'); localStorage.removeItem('prospector_zz_export_probe'); });
    // Integrations
    await page.locator('#main-content').getByText(NAME).first().waitFor({ timeout: 20000 });
    await openAdmin(page); await tab(page, '🔌 Integrations');
    await main(page).getByRole('button', { name: 'Connect via OAuth →' }).click(); await page.waitForTimeout(600);
    ok('SFDC: Connect via OAuth -> /api/sfdc/auth', calls.includes('GET /api/sfdc/auth'));
    await main(page).getByRole('button', { name: 'Paste token manually' }).click();
    await main(page).getByPlaceholder('eyJ0eXAiOiJKV1QiLCJh…').fill('fixture-token');
    await main(page).getByPlaceholder('https://your-org.my.salesforce.com').fill('https://fixture.my.salesforce.com/');
    await main(page).getByPlaceholder('0055g000000xxxABC').fill('005FIXTURE');
    await card(page, 'Access Token', page.getByRole('button', { name: 'Connect →', exact: true })).getByRole('button', { name: 'Connect →', exact: true }).click(); await page.waitForTimeout(400);
    const sf = await ls(page);
    ok('SFDC manual: 4 keys written, Connected', sf.sfdc_access_token === 'fixture-token' && sf.sfdc_instance_url === 'https://fixture.my.salesforce.com' && sf.sfdc_user_id === '005FIXTURE' && sf.sfdc_user_name === 'Manual token' && (await main(page).getByText(/Connected/).count()) >= 1);
    await main(page).getByRole('button', { name: /My Accounts/ }).click(); await page.waitForTimeout(600);
    await main(page).getByRole('button', { name: /Dormant/ }).click(); await page.waitForTimeout(600);
    ok('SFDC: My Accounts + Dormant POST their mode, fixture error shown, nothing saved', calls.includes('POST /api/sfdc/accounts my_accounts') && calls.includes('POST /api/sfdc/accounts dormant') && (await main(page).getByText(/fixture - nothing pulled/).count()) === 1);
    await card(page, 'Salesforce', page.getByRole('button', { name: /My Accounts/ })).getByRole('button', { name: 'Disconnect', exact: true }).click(); await page.waitForTimeout(400);
    const sf2 = await ls(page);
    ok('SFDC: Disconnect removes the 4 keys', ['sfdc_access_token', 'sfdc_instance_url', 'sfdc_user_id', 'sfdc_user_name'].every(k => sf2[k] === null) && (await main(page).getByRole('button', { name: 'Connect via OAuth →' }).count()) === 1);
    for (const [id, name] of [['hunter', 'Hunter.io'], ['resend', 'Resend'], ['zoominfo', 'ZoomInfo'], ['clearbit', 'Clearbit']]) {
      const c = card(page, name, page.getByPlaceholder('Paste API Key'));
      await c.getByPlaceholder('Paste API Key').fill(`${id}-fixture-key-123`);
      await c.getByRole('button', { name: 'Connect →', exact: true }).click(); await page.waitForTimeout(300);
      const stored = JSON.parse((await ls(page)).prospector_integrations || '{}')[id];
      const masked = await main(page).getByText(`${id}-fix`.slice(0, 8) + '•'.repeat(16), { exact: true }).count();
      if (id === 'hunter') {
        await main(page).getByRole('button', { name: /Test connection/ }).click(); await page.waitForTimeout(500);
        ok('Hunter: Test connection -> /api/hunter/account, quota shown', calls.includes('GET /api/hunter/account') && (await main(page).getByText('searches 1/25').count()) === 1);
      }
      await card(page, name, page.getByRole('button', { name: 'Disconnect', exact: true })).getByRole('button', { name: 'Disconnect', exact: true }).click(); await page.waitForTimeout(300);
      const gone = !(id in JSON.parse((await ls(page)).prospector_integrations || '{}'));
      ok(`${name}: paste -> Connect -> masked key -> Disconnect (prospector_integrations)`, stored === `${id}-fixture-key-123` && masked === 1 && gone, `stored ${stored} masked ${masked} gone ${gone}`);
    }
    const six = main(page).getByRole('button', { name: 'Go to Uploads →' });
    const before6 = page.url(); await six.click(); await page.waitForTimeout(400);
    ok('6sense: "Go to Uploads →" present and inert (no handler, unchanged)', (await six.count()) === 1 && page.url() === before6 && (await main(page).getByText('6sense', { exact: true }).count()) === 1);
    rec.endLs = await ls(page);
    ok('0 console errors', errs.length === 0, errs.slice(0, 5).join(' | '));
    if (phase === 'before') { st.clickBefore = rec; fs.writeFileSync(file, JSON.stringify(st, null, 2)); }
    else {
      ok('Diamonds sequence identical before / after (state swap, same key + values)', JSON.stringify(rec.diamonds) === JSON.stringify(st.clickBefore.diamonds), `before ${JSON.stringify(st.clickBefore.diamonds)} after ${JSON.stringify(rec.diamonds)}`);
      ok('localStorage end state identical before / after', JSON.stringify(rec.endLs) === JSON.stringify(st.clickBefore.endLs), JSON.stringify(rec.endLs));
    }
  } finally { await browser.close(); srv.kill(); }
  console.log(`click ${phase}: ${pass}/${total}`);
}

async function after(file) {
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  await startServer(st);
  browser = await chromium.launch();
  try {
    const { page, errs } = await newPage(st, await session(st.users.PlatOwner));
    await openAdmin(page);
    ok('PageHeader "Admin" (h1)', (await main(page).getByRole('heading', { level: 1, name: 'Admin', exact: true }).count()) === 1);
    const strip = main(page).getByTestId('admin-tabs');
    const tops = await strip.getByRole('button').evaluateAll(es => es.map(e => Math.round(e.getBoundingClientRect().top)));
    ok('tab strip: one row at 1440', tops.length === 8 && new Set(tops).size === 1, tops.join(','));
    ok('tab strip: group prefixes TEAM / PLATFORM / DATA inline', JSON.stringify(await strip.locator('[data-group-label]').allInnerTexts()) === JSON.stringify(['TEAM', 'PLATFORM', 'DATA']));
    await tab(page, '⚙️ Settings');
    const ws = main(page).locator(`[data-workspace="${st.B}"]`);
    ok('Workspace features: 4 ToggleRows for the temp workspace', (await ws.getByRole('switch').count()) === 4);
    const helps = await ws.locator('[title]').evaluateAll(es => es.map(e => e.getAttribute('title')));
    ok('hover help = the 4 old notes, word for word', JSON.stringify(helps) === JSON.stringify(st.notesBefore.map(n => n.replace(/^[^:]+: /, ''))), JSON.stringify(helps));
    ok('no note paragraphs left', (await main(page).locator('p').evaluateAll((ps, labels) => ps.filter(p => labels.some(l => p.innerText.startsWith(l + ': '))).length, FEATURE_LABELS)) === 0);
    ok('Backup + Diamonds collapsed by default', (await main(page).getByText('Export all data').count()) === 0 && (await main(page).getByRole('button', { name: /Diamonds (ON|OFF)/ }).count()) === 0 && (await main(page).getByRole('button', { name: /^Show/ }).count()) === 2);
    await expand(page);
    ok('Show opens both, Hide closes', (await main(page).getByText(/Export all data/).count()) === 1 && (await main(page).getByRole('button', { name: /Diamonds (ON|OFF)/ }).count()) === 1);
    await main(page).getByRole('button', { name: /^Hide/ }).first().click();
    ok('Hide works', (await main(page).getByText(/Export all data/).count()) === 0);
    await tab(page, '🔌 Integrations');
    ok('Integrations: kit cards (Salesforce + 4 keys + 6sense)', (await main(page).locator('section.ui-card').count()) === 6);
    ok('Integrations: a StatusPill per card', (await main(page).locator('section.ui-card [data-status]').count()) >= 6);
    const m = await newPage(st, await session(st.users.PlatOwner), { width: 390, height: 844 });
    await openAdmin(m.page);
    await noScroll(m.page, '390 Admin');
    const sw = await main(m.page).getByTestId('admin-tabs').evaluate(e => [getComputedStyle(e).overflowX, e.scrollWidth > e.clientWidth]);
    ok('390: tab strip scrolls sideways inside itself', sw[0] === 'auto' && sw[1], JSON.stringify(sw));
    await tab(m.page, '⚙️ Settings'); await noScroll(m.page, '390 Settings');
    ok('0 console errors', errs.length + m.errs.length === 0, [...errs, ...m.errs].slice(0, 5).join(' | '));
  } finally { await browser.close(); srv.kill(); }
  console.log(`after: ${pass}/${total}`);
}

async function teardown(file) {
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ids = Object.values(st.users).map(u => u.id);
  await svc.from('profiles').update({ is_platform_owner: false }).in('id', ids);
  for (const t of ['auth_events', 'business_members']) await svc.from(t).delete().eq('business_id', st.B);
  for (const id of ids) { await svc.from('business_members').delete().eq('user_id', id); await svc.from('auth_events').delete().eq('user_id', id); await svc.from('auth_events').delete().eq('actor_id', id); }
  const others = await otherFeatures(st.B);
  await svc.from('businesses').delete().eq('id', st.B);
  for (const id of ids) await svc.auth.admin.deleteUser(id);
  await svc.from('profiles').delete().in('id', ids);
  const left = (await svc.from('profiles').select('id,is_platform_owner').in('id', ids)).data || [];
  const platLeft = (await svc.from('profiles').select('id', { count: 'exact', head: true }).eq('is_platform_owner', true).in('id', ids)).count;
  const afterC = await counts();
  const moved = WATCH.filter(t => afterC[t] !== st.before[t]);
  const featSame = JSON.stringify(others) === JSON.stringify(st.others);
  console.log(`teardown: before ${JSON.stringify(st.before)}\n          after  ${JSON.stringify(afterC)}`);
  console.log(`temp profiles left: ${left.length} (is_platform_owner true: ${platLeft}); other workspaces' features identical: ${featSame}`);
  const bad = [...moved.map(t => 'count moved: ' + t), ...(left.length ? ['temp profile rows remain'] : []), ...(featSame ? [] : ['other workspace features changed'])];
  console.log(`restored: ${bad.length ? 'NO - ' + bad.join(', ') : 'yes (temp platform-owner profile cleared + deleted, 0 temp profiles left)'}`);
}

({ setup: () => setup(a1), shoot: () => shoot(a1, a2, a3 || 'after'), click: () => click(a1, a2 || 'after'), after: () => after(a1), teardown: () => teardown(a1) }[mode] || (() => { console.log('usage: setup|shoot|click|after|teardown'); }))()
  .then(() => process.exit(total && pass !== total ? 1 : 0)).catch(e => { console.error(e); if (browser) browser.close(); if (srv) srv.kill(); process.exit(1); });
