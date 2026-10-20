// FIX huddle-not-a-fit-v1 live check. TEMP data only: 1 workspace (goals_sales on, added to SALES_ANALYTICS_BUSINESS_IDS for the local server only), 3 temp users (Jack + Cyrus members, Vera viewer), 3 prospects with 1 delivered message + 1 real open each, 1 flag (via the real route). Browser: Not a fit + Undo, Not a fit -> flag dropped after the undo window, Show closed + Restore (previous status, no contacted event, not in Done), Not now 1 week -> hidden, back once snooze_until has passed, 390 confirm screen, Viewer read-only. 0 Apollo / 0 Claude / 0 syncs; HomeLover is only COUNTED. Serves build/ via server.js - run npm run build first. ~2 min, cap 4 min.
// Usage: node scripts/verify/huddle-not-a-fit-v1.cjs <outdir>
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const OUT = process.argv[2] || '/tmp'; fs.mkdirSync(OUT, { recursive: true });
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0].trim(), PORT = 3991, tag = 'naf-' + Date.now();
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const WATCH = ['sales_email_activity', 'sales_email_messages', 'sales_prospect_state', 'sales_prospect_events', 'sales_week_goals', 'sales_week_goal_steps', 'business_members'];
const made = { users: [], biz: null };
let srv, browser, log = '', pass = 0, total = 0, blocked = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const snap = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL)).count; return o; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const laToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const cleanup = require('./lib/tempGuard.cjs')(removeTemp, { capMs: 240000 });

async function removeTemp() {
  if (browser) await browser.close().catch(() => {});
  if (srv) srv.kill();
  const b = made.biz;
  if (b) for (const t of ['sales_week_goal_steps', 'sales_week_goals', 'sales_prospect_events', 'sales_email_activity', 'sales_email_messages', 'sales_prospect_state', 'business_members', 'auth_events']) await svc.from(t).delete().eq('business_id', b);
  for (const u of made.users) { await svc.from('business_members').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('actor_id', u); }
  if (b) await svc.from('businesses').delete().eq('id', b);
  for (const u of made.users) await svc.auth.admin.deleteUser(u);
}
async function user(biz, name, role) {
  const email = `${tag}-${name.toLowerCase()}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
  const { data: u } = await svc.auth.admin.createUser({ email, password, email_confirm: true }); made.users.push(u.user.id);
  await svc.from('profiles').update({ display_name: `${name} Test`, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
  ins(await svc.from('business_members').insert({ business_id: biz, email, name: `${name} Test`, user_id: u.user.id, role }).select());
  const c = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: s } = await c.auth.signInWithPassword({ email, password });
  return { id: u.user.id, session: s.session };
}
async function newPage(u, width, height) {
  const errs = [];
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage(); page.setDefaultTimeout(10000);
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); }); page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
  await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)/, r => { blocked++; r.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"blocked by verify script"}' }); });
  await page.addInitScript(([k, v]) => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(u.session)]);
  await page.goto(`http://localhost:${PORT}/`); await page.waitForTimeout(3000);
  return { page, errs };
}
async function openHuddle(page, label, compact) {
  if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
  await page.getByLabel('Workspace').selectOption({ label }); await page.waitForTimeout(1500);
  if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
  await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).click(); await page.waitForTimeout(3000);
  await page.getByRole('button', { name: /^Huddle/ }).first().click();
  await page.locator('[id^="live-row-"]').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);
}
const rowIds = page => page.locator('[id^="live-row-"]').evaluateAll(els => els.map(e => e.id.slice('live-row-'.length)));

(async () => {
  const before = await snap();
  try {
    const B = made.biz = ins(await svc.from('businesses').insert({ name: `ZZ NotFit ${tag.slice(-5)}`, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
    const WS = `ZZ NotFit ${tag.slice(-5)}`;
    const jack = await user(B, 'Jack', 'member'), cyrus = await user(B, 'Cyrus', 'member'), vera = await user(B, 'Vera', 'viewer');
    const ago = h => new Date(Date.now() - h * 3600e3).toISOString();
    ins(await svc.from('sales_prospect_state').insert([
      { business_id: B, contact_id: 'zz-a', name: 'Avery Wrong', company: 'Acme Rentals', title: 'Office Manager', owner: 'jack', status: 'new' },
      { business_id: B, contact_id: 'zz-b', name: 'Blake Later', company: 'Beta Benefits', owner: 'jack', status: 'new' },
      { business_id: B, contact_id: 'zz-c', name: 'Casey Stay', company: 'Cobalt Co', owner: 'cyrus', status: 'new' },
    ]).select());
    ins(await svc.from('sales_email_messages').insert(['a', 'b', 'c'].map((c, i) => ({ business_id: B, apollo_message_id: `zm-${c}`, contact_id: `zz-${c}`, step: 1, delivered_at: ago(50 + i), replied: false }))).select());
    ins(await svc.from('sales_email_activity').insert(['a', 'b', 'c'].map((c, i) => ({ business_id: B, apollo_message_id: `zm-${c}`, contact_id: `zz-${c}`, step: 1, event: 'open', occurred_at: ago(1 + i) }))).select());

    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
    for (let i = 0; i < 50 && !log.includes(`port ${PORT}`); i++) await wait(200);
    const flagRes = await fetch(`http://localhost:${PORT}/api/sales/${B}/prospects/zz-a/flag`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `prospector_at=${encodeURIComponent(jack.session.access_token)}` }, body: JSON.stringify({ assignee_user_id: cyrus.id, steps: ['Call her'] }) });
    ok('seed: one open flag on Avery through the real route', flagRes.status === 201 || flagRes.status === 200, String(flagRes.status));
    const flagRow = async () => (await svc.from('sales_week_goals').select('id,status').eq('business_id', B).eq('prospect_contact_id', 'zz-a').single()).data;
    const state = async c => (await svc.from('sales_prospect_state').select('status,notes,snooze_until').eq('business_id', B).eq('contact_id', c).single()).data;
    const d = laToday(), mmdd = `${d.slice(5, 7)}/${d.slice(8, 10)}`;

    browser = await chromium.launch();
    const j = await newPage(jack, 1440, 1000), J = j.page;
    await openHuddle(J, WS, false);
    ok('Live lists all 3', JSON.stringify((await rowIds(J)).sort()) === '["zz-a","zz-b","zz-c"]');
    const A = J.locator('#live-row-zz-a');
    await A.getByRole('button', { name: 'Not a fit…' }).click();
    ok('Not a fit confirm: reason chips + says it closes the flag', /closes the flag/.test(await A.innerText()) && await A.getByRole('button', { name: 'Not a decision maker' }).count() === 1);
    await J.screenshot({ path: `${OUT}/naf-1440-confirm.png` });
    await A.getByRole('button', { name: 'Wrong person' }).click();
    await A.getByRole('button', { name: 'Mark not a fit' }).click(); await J.waitForTimeout(2000);
    let s = await state('zz-a');
    const toast = J.getByText(/marked not a fit - remove them from the Apollo sequence in Apollo/);
    ok('Not a fit: dead + notes line, toast names Apollo with a link, row gone from Live, flag still open inside the undo window',
      s.status === 'dead' && s.notes === `(${mmdd}) Not a fit: Wrong person` && await toast.count() === 1 && await J.getByRole('link', { name: 'Apollo ↗' }).filter({ hasNot: J.locator('[id^="live-row-"]') }).count() >= 1
      && !(await rowIds(J)).includes('zz-a') && (await flagRow()).status === 'open', JSON.stringify({ s, ids: await rowIds(J), flag: await flagRow() }));
    await J.screenshot({ path: `${OUT}/naf-1440-toast.png` });
    await J.getByRole('button', { name: 'Undo' }).click(); await J.waitForTimeout(2500);
    s = await state('zz-a');
    await wait(4000);
    ok('Undo: status + notes back, Avery back on Live, flag never dropped (checked after the window)', s.status === 'new' && s.notes === null && (await rowIds(J)).includes('zz-a') && (await flagRow()).status === 'open', JSON.stringify({ s, flag: await flagRow() }));

    await A.getByRole('button', { name: 'Not a fit…' }).click();
    await A.getByRole('button', { name: 'Mark not a fit' }).click(); await J.waitForTimeout(7000);
    s = await state('zz-a');
    const dropEv = (await svc.from('sales_prospect_events').select('field').eq('business_id', B).eq('contact_id', 'zz-a').eq('field', 'flag_dropped')).data;
    ok('Not a fit (no reason) + no Undo: flag dropped through the drop path once the window closed (logged), notes line has no reason', s.status === 'dead' && s.notes === `(${mmdd}) Not a fit` && (await flagRow()).status === 'dropped' && dropEv.length === 1, JSON.stringify({ s, flag: await flagRow(), dropEv }));

    await J.getByRole('checkbox', { name: /Show closed/ }).check(); await J.waitForTimeout(2000);
    ok('Show closed: Avery listed with "Not a fit" + Restore', /Not a fit/.test(await A.innerText()) && await A.getByRole('button', { name: 'Restore' }).count() === 1 && await A.getByRole('button', { name: 'Not a fit…' }).count() === 0);
    await J.screenshot({ path: `${OUT}/naf-1440-show-closed.png` });
    await A.getByRole('button', { name: 'Restore' }).click(); await J.waitForTimeout(2500);
    s = await state('zz-a');
    ok('Restore with nothing before but new: status new, notes keep the history line', s.status === 'new' && s.notes === `(${mmdd}) Not a fit`, JSON.stringify(s));
    await J.getByRole('checkbox', { name: /Show closed/ }).uncheck(); await J.waitForTimeout(2000);
    ok('Avery back on Live after Restore', (await rowIds(J)).includes('zz-a'));

    const Bl = J.locator('#live-row-zz-b');
    await Bl.getByRole('button', { name: 'Not now…' }).click();
    await Bl.getByRole('button', { name: '1 week' }).click(); await J.waitForTimeout(2500);
    s = await state('zz-b');
    ok('Not now 1 week: not_now until today + 7, hidden from Live', s.status === 'not_now' && s.snooze_until === addDays(d, 7) && !(await rowIds(J)).includes('zz-b'), JSON.stringify({ s, ids: await rowIds(J) }));
    await J.waitForTimeout(4000);
    ins(await svc.from('sales_prospect_state').update({ snooze_until: addDays(d, -1) }).eq('business_id', B).eq('contact_id', 'zz-b').select());
    await J.reload(); await J.waitForTimeout(3000); await openHuddle(J, WS, false);
    ok('snooze_until in the past: Blake is back on Live on his own', (await rowIds(J)).includes('zz-b'));
    ok('Jack: 0 console errors', j.errs.length === 0, j.errs.join(' | '));

    // Casey: a real Mark contacted, then Not a fit, then Restore -> contacted again, but only the real contact counts.
    const Cj = J.locator('#live-row-zz-c');
    await Cj.getByRole('button', { name: 'Mark contacted' }).click(); await J.waitForTimeout(6500);
    await Cj.getByRole('button', { name: 'Not a fit…' }).click();
    await Cj.getByRole('button', { name: 'Mark not a fit' }).click(); await J.waitForTimeout(6500);
    await J.getByRole('checkbox', { name: /Show closed/ }).check(); await J.waitForTimeout(2000);
    await Cj.getByRole('button', { name: 'Restore' }).click(); await J.waitForTimeout(2500);
    await J.getByRole('checkbox', { name: /Show closed/ }).uncheck(); await J.waitForTimeout(1500);
    const huddle = await (await fetch(`http://localhost:${PORT}/api/sales/${B}/huddle`, { headers: { Cookie: `prospector_at=${encodeURIComponent(jack.session.access_token)}` } })).json();
    const contactedEvents = (await svc.from('sales_prospect_events').select('from_value,to_value').eq('business_id', B).eq('contact_id', 'zz-c').eq('field', 'status').eq('to_value', 'contacted')).data;
    const doneC = (huddle.done_recent || []).filter(e => e.contact_id === 'zz-c').length, doneA = (huddle.done_recent || []).filter(e => e.contact_id === 'zz-a').length;
    ok('Restore after contacted -> Not a fit: status contacted again; Done lists only the real Mark contacted (1), the restore (dead -> contacted) is not counted; Avery\'s restores not in Done',
      (await state('zz-c')).status === 'contacted' && contactedEvents.length === 2 && contactedEvents.some(e => e.from_value === 'dead') && doneC === 1 && doneA === 0 && huddle.since_last_huddle?.done === 1,
      JSON.stringify({ st: (await state('zz-c')).status, contactedEvents, doneC, doneA, since: huddle.since_last_huddle?.done }));
    ins(await svc.from('sales_prospect_state').update({ status: 'new' }).eq('business_id', B).eq('contact_id', 'zz-c').select());

    const p = await newPage(jack, 390, 844), P = p.page;
    await openHuddle(P, WS, true);
    const Cp = P.locator('#live-row-zz-c');
    await Cp.getByRole('button', { name: 'Not a fit…' }).click(); await P.waitForTimeout(300);
    await Cp.scrollIntoViewIfNeeded();
    await P.screenshot({ path: `${OUT}/naf-390-confirm.png` });
    ok('390: confirm open, no sideways page scroll, 0 console errors', await Cp.getByRole('button', { name: 'Mark not a fit' }).isVisible() && await P.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1) && !p.errs.length, p.errs.join(' | '));
    await Cp.getByRole('button', { name: 'Cancel' }).click();
    ok('Cancel writes nothing', (await state('zz-c')).status === 'new');

    const v = await newPage(vera, 1440, 1000), V = v.page;
    await openHuddle(V, WS, false);
    ok('Viewer: no Not a fit / Not now / Restore buttons', await V.getByRole('button', { name: /Not a fit…|Not now…|Restore/ }).count() === 0 && !v.errs.length, v.errs.join(' | '));
    ok('0 sync / Apollo requests left the browser', blocked === 0, `blocked ${blocked}`);
  } catch (e) { ok('run without exceptions', false, e.stack?.split('\n').slice(0, 3).join(' ')); } finally {
    await cleanup();
  }
  const after = await snap();
  const left = made.biz ? (await svc.from('businesses').select('id').eq('id', made.biz)).data.length : 0;
  const moved = WATCH.filter(t => before[t] !== after[t]);
  ok('teardown complete (workspace gone)', left === 0);
  ok(`HomeLover counts identical (${WATCH.length} tables)`, !moved.length, moved.map(t => `${t} ${before[t]}->${after[t]}`).join(', '));
  console.log(`${pass}/${total} passed · ${!moved.length && left === 0 ? 'restored: yes' : `restored: NO - moved: ${moved.join(', ')} (check who wrote it)`}`);
  process.exit(pass === total ? 0 : 1);
})();
