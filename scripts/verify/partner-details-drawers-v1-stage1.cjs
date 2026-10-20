// partner-details-drawers-v1 Stage 1 live check. TEMP data only: 1 workspace (goals_sales on, added to SALES_ANALYTICS_BUSINESS_IDS for the local server only), 2 temp users (owner "Jack Zz", viewer). Seed: 2 partners - "Equifax Zz" (replied; 2 contacts names + titles only, 3 events, 1 linked to-do due yesterday, 1 confirmed domain) and "Blank Zz" (nothing). UI (Playwright, serves build/ - run npm run build first): Member 1440 - Key closed on a fresh browser; expanded Equifax = header (stage, Next, Log touch, More, Quick note) + five closed drawers in order with summaries from the data; real quick-note write; open Activity -> only it opens, stays open on Blank; Enter/Space on a drawer head toggle once; Key choice survives a reload; Weekly report PDF prints. Member 390 - same, no sideways scroll. Viewer 1440 - drawers, no forms. Expanded height of the empty partner measured here and, with --before <worktree with build/>, against the previous build served from that tree. 0 Claude, 0 Apollo / 0 syncs. HomeLover is only COUNTED (head requests). Teardown deletes everything. ~90-150s, cap 235s.
// Usage: node scripts/verify/partner-details-drawers-v1-stage1.cjs <outdir> [--before <dir>]
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3992, BEFORE_PORT = 3993, tag = 'pdd1-' + Date.now();
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const HL_TABLES = ['business_members', 'sales_goals', 'sales_partner_events', 'partner_contacts', 'partner_domains', 'sales_week_goals'];
const args = process.argv.slice(2);
const OUT = args.find(a => !a.startsWith('--')) || '/tmp';
const BEFORE = args.includes('--before') ? args[args.indexOf('--before') + 1] : null;
const made = { biz: null, users: [] };
let srv, srvBefore, browser, log = '', pass = 0, total = 0, blocked = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const cleanup = require('./lib/tempGuard.cjs')(removeTemp, { capMs: 235000 });
const DRAWERS = ['People', 'Activity', 'Tasks', 'Intel', 'Domains'];

async function hl() {
  const o = {};
  for (const t of HL_TABLES) { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HOMELOVER); o[t] = r.error ? `n/a (${r.error.message.slice(0, 40)})` : r.count; }
  return o;
}
async function removeTemp() {
  if (browser) await browser.close().catch(() => {});
  if (srv) srv.kill();
  if (srvBefore) srvBefore.kill();
  const b = made.biz;
  if (b) {
    for (const t of ['sales_partner_events', 'partner_contacts', 'partner_domains', 'sales_week_goal_steps', 'sales_week_goals', 'sales_goals', 'business_members', 'auth_events']) {
      const r = await svc.from(t).delete().eq('business_id', b);
      if (r.error && !/column/.test(r.error.message)) console.log(`cleanup ${t}: ${r.error.message}`);
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
async function newPage(u, width, height, port = PORT) {
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage(); page.setDefaultTimeout(12000);
  page.on('console', m => { if (m.type() === 'error' && !/favicon|net::ERR_FAILED|Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 160)); });
  page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
  await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)/, r => { blocked++; r.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"blocked by verify script"}' }); });
  await page.addInitScript(([k, v]) => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(u.session)]);
  await page.addInitScript(() => { window.__prints = 0; window.print = () => { window.__prints++; }; });
  await page.goto(`http://localhost:${port}/?tab=pipeline&view=partners`);
  await nav(page, width < 900);
  return { page, errs };
}
async function nav(page, compact) {
  await page.waitForTimeout(3000);
  const menu = async () => { if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); } };
  await menu(); await page.getByLabel('Workspace').selectOption({ label: WS_NAME }); await page.waitForTimeout(2500);
  await menu(); await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
  await page.locator('#workspace-header-tabs').getByRole('button', { name: /^Pipeline/ }).first().click(); await page.waitForTimeout(1800);
  await page.locator('.ui-seg').getByRole('button', { name: 'Partner workflow', exact: true }).first().click().catch(() => {}); await page.waitForTimeout(1800);
  await page.locator('[data-partner-id]').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
}
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false, animations: 'disabled', caret: 'hide' });
const row = (page, name) => page.locator('[data-partner-id]', { hasText: name }).first();
const expand = async (page, name) => { const r = row(page, name); await r.locator('button[aria-expanded]').first().click(); await page.waitForTimeout(1500); return r; };
const head = (r, name) => r.getByRole('button', { name: new RegExp(`^${name}`) });
const states = async r => { const o = {}; for (const d of DRAWERS) o[d] = await head(r, d).getAttribute('aria-expanded'); return o; };
const texts = async r => { const o = {}; for (const d of DRAWERS) o[d] = (await head(r, d).evaluate(el => el.textContent)).replace(/\s+/g, ' ').trim(); return o; };
const allClosedBut = (s, open) => DRAWERS.every(d => s[d] === (open.includes(d) ? 'true' : 'false'));
const height = r => r.evaluate(el => Math.round(el.getBoundingClientRect().height));

function startServer(cwd, port) {
  const p = spawn('node', ['--dns-result-order=ipv4first', 'server.js'], { cwd, env: { ...process.env, PORT: String(port), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${made.biz}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', d => log += d); p.stderr.on('data', d => log += d);
  return p;
}

(async () => {
  const hlBefore = await hl(); const t0 = Date.now();
  fs.mkdirSync(OUT, { recursive: true });
  try {
    WS_NAME = `ZZ Drawers ${tag.slice(-4)}`;
    const T = made.biz = ins(await svc.from('businesses').insert({ name: WS_NAME, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}-jack@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
    const M = await user('Jack Zz', 'owner'), V = await user('Viewer Zz', 'viewer');
    const [equifax, blank] = ins(await svc.from('sales_goals').insert([
      { business_id: T, goal_type: 'partnership', name: 'Equifax Zz', pipeline_status: 'replied', owner_user_id: M.id, category: '4. Mid-Market Benefits Brokers', tier: '2', angle: 'Verification data for renter screening partners', partner_role: 'Data partner', next_step: 'Send the one-pager', sequence_to_use: 'Brokers v2' },
      { business_id: T, goal_type: 'partnership', name: 'Blank Zz', pipeline_status: 'not_started', owner_user_id: null, category: '6. Enterprise Benefits Consultants' },
    ]).select());
    ins(await svc.from('sales_partner_events').insert([
      { business_id: T, goal_id: equifax.id, event: 'status', from_status: 'first_email_sent', to_status: 'replied', contact_names: [], source: 'manual', by_user: M.id, at: '2026-10-10T17:00:00Z', meta: {} },
      { business_id: T, goal_id: equifax.id, event: 'touch', touch_type: 'call', contact_names: ['Pat Example'], source: 'manual', by_user: M.id, at: '2026-10-12T19:00:00Z', note: 'Left a voicemail', meta: {} },
      { business_id: T, goal_id: equifax.id, event: 'note', note: 'Sent the deck', contact_names: [], source: 'manual', by_user: M.id, at: '2026-10-14T16:00:00Z', meta: {} },
    ]).select());
    ins(await svc.from('partner_contacts').insert([
      { business_id: T, goal_id: equifax.id, name: 'Pat Example', title: 'VP Benefits', source: 'manual', created_by: M.id },
      { business_id: T, goal_id: equifax.id, name: 'Sam Sample', title: 'Director', source: 'manual', created_by: M.id },
    ]).select());
    const { laWeekStart, laDateString } = await import(ROOT + '/src/components/salesAnalytics/periods.js');
    const monday = laWeekStart(), yesterday = laDateString(new Date(Date.now() - 864e5));
    ins(await svc.from('sales_week_goals').insert({ business_id: T, kind: 'todo', text: 'Send the deck to Pat', status: 'open', week_start: monday, owner_user_id: M.id, link_type: 'partner', link_id: equifax.id, created_by: M.id, sort_order: 0, due_date: yesterday, created_at: '2026-10-09T12:00:00Z' }).select());
    ins(await svc.from('partner_domains').insert({ business_id: T, goal_id: equifax.id, domain: 'equifax-test.com', source: 'manual', confirmed: true, created_by: M.id }).select());
    console.log(`seed: workspace ${T}, 2 partners, 3 events, 2 contacts, 1 to-do (due ${yesterday}, week ${monday}), 1 domain`);

    srv = startServer(ROOT, PORT);
    for (let i = 0; i < 60 && !log.includes(`port ${PORT}`); i++) await wait(250);
    browser = await chromium.launch();
    let afterEmpty = null, afterEquifax = null;

    console.log('--- UI member 1440');
    { const { page, errs } = await newPage(M, 1440, 900);
      ok('Key legend closed on a fresh browser (no stored choice)', (await page.getByRole('button', { name: /^Key/ }).getAttribute('aria-expanded')) === 'false');
      const r = await expand(page, 'Equifax Zz');
      ok('header: Replied, Next: Meeting booked, Log touch, More, Quick note box', (await r.getByText('Replied', { exact: true }).count()) >= 1 && (await r.getByRole('button', { name: 'Next: Meeting booked' }).count()) === 1 && (await r.getByRole('button', { name: 'Log touch' }).count()) === 1 && (await r.getByRole('button', { name: 'More actions for Equifax Zz' }).count()) === 1 && (await r.getByRole('textbox', { name: 'Quick note' }).count()) === 1);
      await page.waitForTimeout(800);
      const st = await states(r), tx = await texts(r);
      ok('five drawers, all closed, in order People · Activity · Tasks · Intel · Domains', allClosedBut(st, []) && (await r.locator('.ui-drawer__label').evaluateAll(els => els.map(e => e.textContent))).join(',') === DRAWERS.join(','), JSON.stringify(st));
      ok('People summary "2 people · Pat Example (VP Benefits) +1"', tx.People === 'People2 people · Pat Example (VP Benefits) +1Show ▸', tx.People);
      ok('Activity summary = newest line "Note: Sent the deck · Oct 14"', tx.Activity === 'ActivityNote: Sent the deck · Oct 14Show ▸', tx.Activity);
      ok('Tasks summary "1 this week · 1 overdue"', tx.Tasks === 'Tasks1 this week · 1 overdueShow ▸', tx.Tasks);
      ok('Intel summary = the angle', tx.Intel === 'IntelVerification data for renter screening partnersShow ▸', tx.Intel);
      ok('Domains summary "1 confirmed" without opening (no extra read)', tx.Domains === 'Domains1 confirmedShow ▸', tx.Domains);
      ok('closed drawers render no bodies (no People list, no timeline, no domain chip, no Angle field)', (await r.getByRole('list', { name: 'People at this partner' }).count()) === 0 && (await r.getByRole('list', { name: 'Activity timeline' }).count()) === 0 && (await r.getByText('equifax-test.com').count()) === 0 && (await r.getByText('Angle', { exact: true }).count()) === 0);
      afterEquifax = await height(r);
      await shot(page, 'pdd-1440-closed');
      await r.getByRole('textbox', { name: 'Quick note' }).fill('Called, left voicemail'); await r.getByRole('textbox', { name: 'Quick note' }).press('Enter'); await page.waitForTimeout(1500);
      const notes = ins(await svc.from('sales_partner_events').select('event, note, by_user').eq('goal_id', equifax.id).eq('event', 'note').order('at', { ascending: false }));
      ok('Quick note + Enter writes one note event by the member; the box clears', notes.length === 2 && notes[0].note === 'Called, left voicemail' && notes[0].by_user === M.id && (await r.getByRole('textbox', { name: 'Quick note' }).inputValue()) === '', JSON.stringify(notes));
      await page.waitForTimeout(600);
      ok('Activity summary now shows the new note', /^ActivityNote: Called, left voicemail · /.test((await texts(r)).Activity), (await texts(r)).Activity);
      await head(r, 'Activity').click(); await page.waitForTimeout(500);
      const st2 = await states(r);
      ok('open Activity: only Activity opens; timeline lists 5 items (2 notes, call, reply, task)', allClosedBut(st2, ['Activity']) && (await r.getByRole('list', { name: 'Activity timeline' }).getByRole('listitem').count()) === 5, JSON.stringify(st2) + ' ' + (await r.getByRole('list', { name: 'Activity timeline' }).getByRole('listitem').count()));
      ok('Activity filter chips present inside the drawer', (await r.getByRole('group', { name: 'Activity filter' }).getByRole('button').count()) === 4);
      await shot(page, 'pdd-1440-activity-open');
      await head(r, 'People').focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
      ok('Enter on the People head opens it exactly once', (await states(r)).People === 'true' && (await r.getByRole('list', { name: 'People at this partner' }).getByRole('listitem').count()) === 2);
      await page.keyboard.press('Space'); await page.waitForTimeout(300);
      ok('Space on the People head closes it exactly once', (await states(r)).People === 'false');
      ok('persisted: prospector_partner_drawer_activity = open, people = closed', (await page.evaluate(() => [localStorage.getItem('prospector_partner_drawer_activity'), localStorage.getItem('prospector_partner_drawer_people')])).join() === 'open,closed');
      await r.locator('button[aria-expanded]').first().click(); await page.waitForTimeout(500);
      const b = await expand(page, 'Blank Zz'); await page.waitForTimeout(800);
      const sb = await states(b), tb = await texts(b);
      ok('Blank: Activity still open (remembered), the other four closed', allClosedBut(sb, ['Activity']), JSON.stringify(sb));
      ok('Blank summaries: nobody yet · none this week · nothing yet · none confirmed', tb.People === 'Peoplenobody yetShow ▸' && tb.Tasks === 'Tasksnone this weekShow ▸' && tb.Intel === 'Intelnothing yetShow ▸' && tb.Domains === 'Domainsnone confirmedShow ▸' && (await b.getByText('Nothing yet. Log a touch or move the stage and it shows here.').count()) === 1, JSON.stringify(tb));
      await head(b, 'Activity').click(); await page.waitForTimeout(500);
      afterEmpty = await height(b);
      console.log(`  empty partner expanded row height (all drawers closed): ${afterEmpty}px; Equifax closed: ${afterEquifax}px`);
      await page.getByRole('button', { name: /^Key/ }).click(); await page.waitForTimeout(300);
      ok('Key opens on click and the legend shows', (await page.getByRole('button', { name: /^Key/ }).getAttribute('aria-expanded')) === 'true' && (await page.getByText(/Stages, in order/).count()) === 1);
      await page.reload(); await nav(page, false);
      ok('after a reload the Key stays open (stored choice wins)', (await page.getByRole('button', { name: /^Key/ }).getAttribute('aria-expanded')) === 'true');
      await page.locator('#workspace-header-tabs').getByRole('button', { name: /^Dashboard/ }).first().click(); await page.waitForTimeout(1500);
      await page.locator('.ui-seg').getByRole('button', { name: 'Scorecard', exact: true }).first().click(); await page.waitForTimeout(1000);
      await page.getByRole('button', { name: 'Export', exact: true }).click(); await page.waitForTimeout(300);
      await page.getByRole('menuitem', { name: 'Weekly report PDF' }).click(); await page.waitForTimeout(1200);
      ok('Export › Weekly report PDF prints once with one print area', (await page.evaluate(() => window.__prints)) === 1 && (await page.locator('#sales-analytics-print-area').count()) === 1);
      ok('1440 member: 0 console errors', !errs.length, errs.join(' | '));
      await page.context().close(); }

    console.log('--- UI member 390');
    { const { page, errs } = await newPage(M, 390, 844);
      const r = await expand(page, 'Equifax Zz'); await page.waitForTimeout(800);
      ok('390: header + five closed drawers', allClosedBut(await states(r), []) && (await r.getByRole('textbox', { name: 'Quick note' }).count()) === 1);
      await r.scrollIntoViewIfNeeded(); await shot(page, 'pdd-390-closed');
      await head(r, 'Activity').click(); await page.waitForTimeout(500);
      ok('390: Activity opens with the timeline', (await r.getByRole('list', { name: 'Activity timeline' }).count()) === 1);
      await shot(page, 'pdd-390-activity-open');
      ok('390: no sideways scroll', await noSideScroll(page));
      ok('390 member: 0 console errors', !errs.length, errs.join(' | '));
      await page.context().close(); }

    console.log('--- UI viewer 1440');
    { const { page, errs } = await newPage(V, 1440, 900);
      const r = await expand(page, 'Equifax Zz'); await page.waitForTimeout(800);
      ok('viewer: five closed drawers, no Quick note, no Log touch, no Next', allClosedBut(await states(r), []) && (await r.getByRole('textbox', { name: 'Quick note' }).count()) === 0 && (await r.getByRole('button', { name: /Log touch|^Next:|More actions/ }).count()) === 0);
      for (const d of DRAWERS) { await head(r, d).click(); await page.waitForTimeout(250); }
      ok('viewer: all five open read-only - people list, timeline, task, Angle, domain chip; no add forms / Priority / Remove', (await r.getByRole('list', { name: 'People at this partner' }).getByRole('listitem').count()) === 2 && (await r.getByRole('list', { name: 'Activity timeline' }).count()) === 1 && (await r.getByText('Send the deck to Pat').count()) >= 1 && (await r.getByText('Angle', { exact: true }).count()) === 1 && (await r.getByText('equifax-test.com').count()) === 1 && (await r.getByRole('button', { name: /Add person|Add task|Add domain|Remove|Make .* primary|Edit equifax/ }).count()) === 0 && (await r.getByLabel('Priority').count()) === 0 && (await r.getByLabel(/New task for/).count()) === 0);
      await shot(page, 'pdd-1440-viewer-open');
      ok('1440 viewer: 0 console errors', !errs.length, errs.join(' | '));
      await page.context().close(); }

    if (BEFORE) {
      console.log('--- BEFORE build (previous tree) for the height comparison');
      srvBefore = startServer(BEFORE, BEFORE_PORT);
      for (let i = 0; i < 60 && !log.includes(`port ${BEFORE_PORT}`); i++) await wait(250);
      const { page } = await newPage(M, 1440, 900, BEFORE_PORT);
      const b = await expand(page, 'Blank Zz'); await page.waitForTimeout(1200);
      const beforeEmpty = await height(b);
      const e = row(page, 'Equifax Zz'); await b.locator('button[aria-expanded]').first().click(); await page.waitForTimeout(300);
      await e.locator('button[aria-expanded]').first().click(); await page.waitForTimeout(1500);
      const beforeEquifax = await height(e);
      console.log(`  BEFORE (fdac26e): empty partner expanded ${beforeEmpty}px, Equifax expanded ${beforeEquifax}px`);
      console.log(`  AFTER: empty partner expanded ${afterEmpty}px (${afterEmpty - beforeEmpty >= 0 ? '+' : ''}${afterEmpty - beforeEmpty}px), Equifax closed drawers ${afterEquifax}px (${afterEquifax - beforeEquifax >= 0 ? '+' : ''}${afterEquifax - beforeEquifax}px)`);
      ok('the empty partner is shorter than before', afterEmpty < beforeEmpty, `${afterEmpty} vs ${beforeEmpty}`);
      await page.context().close();
    }

    const bundle = fs.readdirSync(ROOT + '/build/static/js').filter(f => /^main\..*\.js$/.test(f)).map(f => fs.readFileSync(`${ROOT}/build/static/js/${f}`, 'utf8')).join('');
    ok('bundle marker: ui-drawer__head + prospector_partner_drawer_ + "Quick note" are in build/', bundle.includes('ui-drawer__head') && bundle.includes('prospector_partner_drawer_') && bundle.includes('Quick note'));
    const g = ins(await svc.from('sales_goals').select('pipeline_status, next_step, priority, updated_at').in('id', [equifax.id, blank.id]).order('name'));
    ok('no stray partner writes (Blank untouched, Equifax stage + next step unchanged)', g[0].pipeline_status === 'not_started' && g[0].next_step === null && g[1].pipeline_status === 'replied' && g[1].next_step === 'Send the one-pager', JSON.stringify(g));
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
