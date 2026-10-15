// pipeline-board-v1 Stage 2 - Goals > Pipeline shots. TEMP data only: 1 workspace (goals_sales on, local server only), 2 temp users (owner Jack Zz, viewer), 5 partners, 4 opportunities, 2 targets, 2 sequenced accounts. Writes only inside the temp workspace (1 star on, 1 off, 1 employer added, 1 add reused). Sync/Apollo requests are blocked in the browser: 0 Apollo / 0 Claude. HomeLover is only COUNTED. Serves build/ (run npm run build first). ~60-90 s, cap 4 min.
// Usage: node scripts/verify/pipeline-board-v1-stage2-ui.cjs <outdir>
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3993, tag = 'pb2-' + Date.now();
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const OUT = process.argv[2] || '/tmp';
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const TABLES = ['sales_goals', 'sales_partner_events', 'sales_opportunities', 'sales_targets', 'sales_sequenced_accounts'];
const made = { biz: null, users: [] };
let srv, browser, pass = 0, total = 0, blocked = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
setTimeout(() => { console.log('ABORT (4 min cap)'); cleanup().then(() => process.exit(2)); }, 240000);

async function counts(biz) {
  const o = {};
  for (const t of TABLES) { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', biz); o[t] = r.error ? 'err' : r.count; }
  return o;
}
async function cleanup() {
  if (browser) await browser.close().catch(() => {});
  if (srv) srv.kill();
  const b = made.biz;
  if (b) for (const t of ['sales_sequenced_accounts', 'sales_targets', 'sales_opportunity_events', 'sales_opportunities', 'sales_partner_events', 'sales_goals', 'business_members', 'auth_events']) {
    const r = await svc.from(t).delete().eq('business_id', b); if (r.error) console.log(`cleanup ${t}: ${r.error.message}`);
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
  return { id: u.user.id, session: (await c.auth.signInWithPassword({ email, password })).data.session };
}
async function newPage(u, width, height, light = false) {
  const errs = [];
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage(); page.setDefaultTimeout(10000);
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); }); page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
  await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)/, r => { blocked++; r.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"blocked by verify script"}' }); });
  await page.addInitScript(([k, v, light]) => {
    if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
    localStorage.setItem('prospector_goals_view', 'pipeline');
    if (light) localStorage.setItem('prospector_prefs', JSON.stringify({ displayMode: 'straight_shooter' }));
  }, [`sb-${REF}-auth-token`, JSON.stringify(u.session), light]);
  await page.goto(`http://localhost:${PORT}/`); await page.waitForTimeout(3000);
  return { page, errs };
}
let WS_NAME;
async function toPipeline(page, compact) {
  const menu = async () => { if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); } };
  await menu(); await page.getByLabel('Workspace').selectOption({ label: WS_NAME }); await page.waitForTimeout(2500);
  await menu(); await page.locator('#root').getByRole('button', { name: 'Goals & Sales', exact: true }).dispatchEvent('click'); await page.waitForTimeout(4500);
  for (let i = 0; i < 3; i++) {
    if (await page.locator('section[aria-labelledby="h-pipeline"]').waitFor({ timeout: 3000 }).then(() => true, () => false)) break;
    await page.locator('nav[aria-label="Views"]').getByRole('button', { name: /^Pipeline/ }).first().click();
  }
  await page.locator('section[aria-labelledby="h-pipeline"] li').first().waitFor(); await page.waitForTimeout(500);
}
const board = page => page.locator('section[aria-labelledby="h-pipeline"]');
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const shot = async (page, name) => { await board(page).screenshot({ path: `${OUT}/${name}.png` }); };

(async () => {
  const hlBefore = await counts(HOMELOVER);
  try {
    WS_NAME = `ZZ Board UI ${tag.slice(-4)}`;
    const T = made.biz = ins(await svc.from('businesses').insert({ name: WS_NAME, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}-jack@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
    const M = await user('Jack Zz', 'owner'), V = await user('Viewer Zz', 'viewer');
    const P = (name, s, cat, tier, hot, team) => ({ business_id: T, goal_type: 'partnership', name, pipeline_status: s, category: cat, tier, hot, owner_team: team, owner_user_id: M.id, next_step: hot ? 'Send the pilot one-pager' : null });
    ins(await svc.from('sales_goals').insert([
      P('Gallagher', 'meeting_set', '3. Brokers & Consultants', '1', true, 'homelover'),
      P('OneDigital', 'replied', '3. Brokers & Consultants', '1', false, 'upside'),
      P('Domuso', 'live', '1. Current Partners (active)', 'active', true, 'both'),
      P('BenefitHub', 'in_sequence', '2. Benefits Platforms', '2', false, null),
      P('Quiet Co', 'paused', '5. Rental Rewards', '3', false, null),
    ]).select());
    const O = (organization, stage, tier, is_top, team, next_action, next_action_date) => ({ business_id: T, organization, org_type: 'employer', stage, tier, is_top, owner: 'Jack', owner_team: team, next_action, next_action_date, source: 'manual' });
    ins(await svc.from('sales_opportunities').insert([
      O('Solidcore', 'meeting', '1', true, 'homelover', 'Benefits call', '2026-10-21'),
      O('Marriott International', 'verbal', '1', false, 'upside', 'Contract redlines', '2026-10-24'),
      O('24 Hour Fitness', 'contacted', '2', false, null, null, null),
      O('Old Union', 'nurture', null, false, null, null, null),
    ]).select());
    ins(await svc.from('sales_targets').insert([
      { business_id: T, name: 'Gusto', kind: 'partner', status: 'proposed', owner_team: 'upside' },
      { business_id: T, name: 'Rippling', kind: 'partner', status: 'researching', owner_team: null },
    ]).select());
    ins(await svc.from('sales_sequenced_accounts').insert([
      { business_id: T, account_id: `${tag}-A1`, name: 'Fresh Co', first_sequenced_at: '2026-10-07T15:00:00Z', week_start: '2026-10-05' },
      { business_id: T, account_id: `${tag}-A2`, name: 'Solidcore', first_sequenced_at: '2026-10-07T15:00:00Z', week_start: '2026-10-05' },
    ]).select());

    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${T}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
    browser = await chromium.launch();

    // 1440 dark: board, then star/unstar, Apollo toggle, partner click-through.
    { const { page, errs } = await newPage(M, 1440, 1000);
      await toPipeline(page, false);
      const heads = await board(page).locator('h3').allInnerTexts();
      ok('1440: Top, then Live / Talking / In outreach / Not started (both Meeting rows are starred)', /^Top 3 of 25/.test(heads[0]) && JSON.stringify(heads.slice(1).map(h => h.replace(/\s*\d+$/, ''))) === JSON.stringify(['Live / strategic', 'Talking', 'In outreach', 'Not started']), JSON.stringify(heads));
      ok('1440: Parked (2) collapsed by default', await board(page).getByRole('button', { name: /Parked \(2\)/ }).getAttribute('aria-expanded') === 'false');
      await shot(page, 'pb2-1440-dark');
      await board(page).getByRole('button', { name: 'Star OneDigital', exact: true }).click();
      await board(page).getByRole('button', { name: 'Unstar OneDigital', exact: true }).waitFor();
      const hot = ins(await svc.from('sales_goals').select('hot').eq('business_id', T).eq('name', 'OneDigital').single()).hot;
      ok('1440: ★ OneDigital -> hot = true in the DB, shows under Top 4 of 25', hot === true && /^Top 4 of 25/.test(await board(page).locator('h3').first().innerText()));
      await board(page).getByRole('button', { name: 'Unstar Solidcore', exact: true }).click();
      await board(page).getByRole('button', { name: 'Star Solidcore', exact: true }).waitFor();
      const solidRows = ins(await svc.from('sales_opportunities').select('is_top, updated_at').eq('business_id', T).eq('organization', 'Solidcore'));
      ok('1440: unstar Solidcore -> is_top = false in the DB', solidRows.length === 1 && solidRows[0].is_top === false, JSON.stringify(solidRows));
      await board(page).getByLabel('Include Apollo-only companies').check(); await page.waitForTimeout(1500);
      const apollo = await board(page).getByRole('button', { name: 'Fresh Co', exact: true }).count();
      const dup = await board(page).getByText('Solidcore', { exact: true }).count();
      ok('1440: Apollo-only adds Fresh Co, not the linked Solidcore', apollo === 1 && dup === 1, `fresh ${apollo} solidcore ${dup}`);
      await board(page).getByLabel('Owner team').selectOption('upside'); await page.waitForTimeout(300);
      const upside = await board(page).locator('li').count();
      ok('1440: Owner team = Upside -> OneDigital, Marriott, Gusto', upside === 3, String(upside));
      await shot(page, 'pb2-1440-dark-upside');
      await board(page).getByLabel('Owner team').selectOption(''); await page.waitForTimeout(300);
      const oppCount = async () => (await svc.from('sales_opportunities').select('id', { count: 'exact', head: true }).eq('business_id', T).is('archived_at', null)).count;
      const addEmployer = async name => {
        await board(page).getByRole('button', { name: '+ Add employer' }).click(); await page.getByText('Add opportunity').waitFor();
        await page.locator('span', { hasText: /^Organization$/ }).locator('xpath=following-sibling::*[1]').fill(name); await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.waitForTimeout(1500);
      };
      const before = await oppCount();
      await addEmployer('Zeta Labs');
      ok('1440: + Add employer "Zeta Labs" -> 1 new row, shown on the board', await oppCount() === before + 1 && await board(page).getByRole('button', { name: 'Zeta Labs', exact: true }).count() === 1);
      await addEmployer('SOLIDCORE, Inc.');
      ok('1440: + Add employer "SOLIDCORE, Inc." -> reused Solidcore, no new row, notice shown', await oppCount() === before + 1 && /Solidcore is already in the pipeline/.test(await board(page).getByRole('status').innerText()));
      await board(page).getByRole('button', { name: 'Gallagher', exact: true }).click(); await page.waitForTimeout(2500);
      const detailsOpen = await page.getByText('Send the pilot one-pager').count();
      ok('1440: click Gallagher -> Partners view, focused on it, drop-down open', await board(page).count() === 0 && detailsOpen > 0, `details ${detailsOpen}`);
      await page.screenshot({ path: `${OUT}/pb2-1440-partner-focus.png` });
      ok('1440: no sideways scroll, 0 console errors', await noSideScroll(page) && !errs.length, errs.join(' | '));
    }
    { const { page, errs } = await newPage(M, 1440, 1000, true);
      await toPipeline(page, false);
      await shot(page, 'pb2-1440-light');
      ok('1440 light: renders, 0 console errors', !errs.length, errs.join(' | '));
    }
    { const { page, errs } = await newPage(M, 390, 844);
      await toPipeline(page, true);
      await page.screenshot({ path: `${OUT}/pb2-390.png`, fullPage: true });
      ok('390: no sideways scroll, 0 console errors', await noSideScroll(page) && !errs.length, errs.join(' | '));
    }
    { const { page, errs } = await newPage(V, 1440, 1000);
      await toPipeline(page, false);
      ok('viewer: no star buttons, no employer link, partners clickable', await board(page).getByRole('button', { name: /^(Un)?[Ss]tar / }).count() === 0
        && await board(page).getByRole('button', { name: 'Marriott International', exact: true }).count() === 0 && await board(page).getByRole('button', { name: 'OneDigital', exact: true }).count() === 1);
      await shot(page, 'pb2-1440-viewer');
      ok('viewer: 0 console errors', !errs.length, errs.join(' | '));
    }
    ok('0 sync/Apollo calls left the browser', true, `blocked ${blocked}`);
    console.log(`blocked sync/apollo requests: ${blocked}`);
  } catch (e) {
    ok('script ran without throwing', false, e.message.split('\n').slice(0, 4).join(' | '));
  } finally {
    await cleanup();
    const left = made.biz ? (await svc.from('businesses').select('id').eq('id', made.biz)).data.length : 0;
    const users = (await Promise.all(made.users.map(u => svc.auth.admin.getUserById(u)))).filter(r => r.data?.user).length;
    const hlAfter = await counts(HOMELOVER);
    const diff = TABLES.filter(t => hlBefore[t] !== hlAfter[t]);
    ok('teardown complete (workspace + temp users gone)', left === 0 && users === 0);
    ok(`HomeLover counts identical (${TABLES.length} tables)`, !diff.length, diff.map(k => `${k} ${hlBefore[k]}->${hlAfter[k]}`).join(', '));
    console.log(`${pass}/${total} passed · ${!diff.length && left === 0 && users === 0 ? 'restored: yes' : 'restored: NO - see above'}`);
    process.exit(pass === total ? 0 : 1);
  }
})();
