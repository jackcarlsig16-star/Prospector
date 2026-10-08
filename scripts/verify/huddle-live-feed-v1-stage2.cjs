// huddle-live-feed-v1 Stage 2 check - the Live tab in a real browser. Part A: real HomeLover, READ ONLY (2 temp users: Mara = Member, Vera = Viewer, both deleted): newest row vs the DB, sync line, numbers, closed toggle, expand, links, load more, viewer, 1440 + 390 screenshots. Part B: a TEMP workspace with 3 seeded prospects (Jack + Cyrus temp members) for the writes: Flag -> Cyrus, second flag offers reassign, Mark contacted + Undo. All deleted. 0 AI / 0 Apollo calls. ~2 min, cap 4 min. Serves build/ via server.js - run npm run build first.
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0].trim(), PORT = 3958, tag = 'hlf2-' + Date.now();
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const WATCH = ['sales_sync_runs', 'sales_email_activity', 'sales_email_messages', 'sales_prospect_state', 'sales_prospect_events', 'sales_week_goals', 'sales_week_goal_steps', 'business_members'];
const made = { users: [], biz: null };
let srv, browser, log = '', pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const snap = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL)).count; return o; };
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('ABORT (4 min cap)'); cleanup().then(() => process.exit(2)); }, 240000);
async function cleanup() {
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
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage(); page.setDefaultTimeout(10000);
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); }); page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
  await page.addInitScript(([k, v]) => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(u.session)]);
  await page.goto(`http://localhost:${PORT}/`); await page.waitForTimeout(3000);
  return { page, errs, ctx };
}
async function openHuddle(page, label, compact) {
  if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
  await page.getByLabel('Workspace').selectOption({ label }); await page.waitForTimeout(1500);
  if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
  await page.locator('#root').getByRole('button', { name: 'Goals & Sales', exact: true }).click(); await page.waitForTimeout(3000);
  await page.getByRole('button', { name: /^Daily Huddle/ }).first().click();
  await page.locator('[id^="live-row-"]').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);
}
const rowIds = page => page.locator('[id^="live-row-"]').evaluateAll(els => els.map(e => e.id.slice('live-row-'.length)));
const all = async (t, cols, f = q => q) => { let out = [], from = 0; for (;;) { const { data, error } = await f(svc.from(t).select(cols).eq('business_id', HL)).order(t === 'sales_email_messages' ? 'apollo_message_id' : t === 'sales_prospect_state' ? 'contact_id' : 'id').range(from, from + 999); if (error) throw new Error(error.message); out = out.concat(data); if (data.length < 1000) return out; from += 1000; } };
const botOpen = (e, d) => !!e.tracking_service || /generic linux/i.test(e.user_agent || '') || (!!d && (Date.parse(e.occurred_at) - Date.parse(d)) / 1000 <= 60);
const humanClick = (e, d) => !!d && (Date.parse(e.occurred_at) - Date.parse(d)) / 1000 > 120;

(async () => {
  const before = await snap();
  const hlState = async () => JSON.stringify((await all('sales_prospect_state', 'contact_id,owner,status,updated_at,updated_by')));
  const hlBefore = await hlState();
  try {
    // Independent truth: newest real signal per person, closed = unsubscribed / not_interested / unsubscribe reply.
    const [prospects, messages, events] = await Promise.all([
      all('sales_prospect_state', 'contact_id,name,email_unsubscribed'),
      all('sales_email_messages', 'apollo_message_id,contact_id,delivered_at,replied,reply_class,replied_seen_at'),
      all('sales_email_activity', 'id,apollo_message_id,contact_id,event,occurred_at,user_agent,tracking_service', q => q.in('event', ['open', 'click'])),
    ]);
    const known = new Map(prospects.map(p => [p.contact_id, p]));
    const deliv = new Map(messages.map(m => [m.apollo_message_id, m.delivered_at]));
    const lastReal = new Map(), anyAct = new Set();
    const bump = (id, at) => { if (at && (!lastReal.has(id) || at > lastReal.get(id))) lastReal.set(id, at); };
    for (const e of events) { if (!known.has(e.contact_id)) continue; anyAct.add(e.contact_id); if (e.event === 'open' ? !botOpen(e, deliv.get(e.apollo_message_id)) : humanClick(e, deliv.get(e.apollo_message_id))) bump(e.contact_id, e.occurred_at); }
    for (const m of messages) if (m.replied && known.has(m.contact_id)) { anyAct.add(m.contact_id); bump(m.contact_id, m.replied_seen_at || m.delivered_at); }
    const closed = id => known.get(id).email_unsubscribed || messages.some(m => m.contact_id === id && m.replied && ['not_interested', 'unsubscribe'].includes(m.reply_class));
    const openIds = [...lastReal.keys()].filter(id => !closed(id)).sort((a, b) => lastReal.get(b).localeCompare(lastReal.get(a)) || a.localeCompare(b));
    const closedHuman = [...lastReal.keys()].filter(closed).length;
    console.log(`raw: ${lastReal.size} people with real activity, ${closedHuman} closed, newest open = ${known.get(openIds[0]).name} at ${lastReal.get(openIds[0])}`);

    const mara = await user(HL, 'Mara', 'member'), vera = await user(HL, 'Vera', 'viewer');
    // Part B workspace: 3 seeded prospects, all activity relative to now.
    made.biz = ins(await svc.from('businesses').insert({ name: `ZZ Live ${tag.slice(-5)}`, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
    const B = made.biz;
    const jack = await user(B, 'Jack', 'member'), cyrus = await user(B, 'Cyrus', 'member');
    const ago = h => new Date(Date.now() - h * 3600e3).toISOString();
    ins(await svc.from('sales_prospect_state').insert([
      { business_id: B, contact_id: 'zz-a', name: 'Avery Opener', company: 'Acme Rentals', title: 'HR Director', owner: 'jack', status: 'new' },
      { business_id: B, contact_id: 'zz-b', name: 'Blake Replier', company: 'Beta Benefits', owner: 'cyrus', status: 'new' },
      { business_id: B, contact_id: 'zz-c', name: 'Casey Clicker', company: 'Cobalt Co', owner: 'unassigned', status: 'new' },
    ]).select());
    ins(await svc.from('sales_email_messages').insert([
      { business_id: B, apollo_message_id: 'zm-a', contact_id: 'zz-a', step: 2, delivered_at: ago(50), replied: false, reply_class: null, replied_seen_at: null },
      { business_id: B, apollo_message_id: 'zm-b', contact_id: 'zz-b', step: 1, delivered_at: ago(60), replied: true, reply_class: 'willing_to_meet', replied_seen_at: ago(5) },
      { business_id: B, apollo_message_id: 'zm-c', contact_id: 'zz-c', step: 3, delivered_at: ago(40), replied: false, reply_class: null, replied_seen_at: null },
    ]).select());
    ins(await svc.from('sales_email_activity').insert([
      { business_id: B, apollo_message_id: 'zm-a', contact_id: 'zz-a', step: 2, event: 'open', occurred_at: ago(20) },
      { business_id: B, apollo_message_id: 'zm-a', contact_id: 'zz-a', step: 2, event: 'open', occurred_at: ago(3) },
      { business_id: B, apollo_message_id: 'zm-a', contact_id: 'zz-a', step: 2, event: 'open', occurred_at: ago(1) },
      { business_id: B, apollo_message_id: 'zm-c', contact_id: 'zz-c', step: 3, event: 'click', occurred_at: ago(8) },
    ]).select());

    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
    for (let i = 0; i < 50 && !log.includes(`port ${PORT}`); i++) await wait(200);
    browser = await chromium.launch();
    const hlName = (await svc.from('businesses').select('name').eq('id', HL).single()).data.name;

    // ── Part A: Mara (Member) on real HomeLover, 1440 ──
    const m = await newPage(mara, 1440, 1000), P = m.page;
    let live;
    P.on('response', async r => { if (r.url().includes('/huddle/live?') && r.ok()) live = await r.json().catch(() => live); });
    await openHuddle(P, hlName, false);
    ok('Huddle opens on the Live tab', (await P.getByRole('tab', { name: 'Live' }).getAttribute('aria-selected')) === 'true');
    const ids = await rowIds(P);
    ok('first row = newest real activity in the DB (closed hidden)', ids[0] === openIds[0], `${known.get(ids[0])?.name} vs ${known.get(openIds[0]).name}`);
    ok('first 25 rows = DB newest-first order', ids.length === Math.min(25, openIds.length) && ids.every((id, i) => id === openIds[i]), `${ids.length} rows`);
    const syncText = await P.getByLabel('Sync status').innerText();
    ok('sync line: stuck 10:07 run shown as failed + last good sync time, Sync now enabled', /Last sync failed · started Oct 7, 10:07 AM, never finished/.test(syncText) && /Synced \d+ (min|h|d) ago/.test(syncText) && await P.getByLabel('Sync status').getByRole('button', { name: 'Sync now' }).isEnabled(), syncText.replace(/\n/g, ' | '));
    ok('stale sync (>2 h) is amber', await P.getByLabel('Sync status').getByText(/over 2 hours old/).count() === 1);
    await P.screenshot({ path: `${OUT}/live-1440.png` });

    // closed toggle
    const closedLbl = P.getByRole('checkbox', { name: /Show closed/ });
    const closedCount = Number((await P.getByText(/Show closed \(\d+\)/).innerText()).match(/\d+/)[0]);
    ok('Show closed (n) = DB closed people with real activity', closedCount === closedHuman, `${closedCount} vs ${closedHuman}`);
    await closedLbl.check(); await P.waitForTimeout(2500);
    ok('Show closed on: total = all people with real activity', live.total === lastReal.size, `${live.total} vs ${lastReal.size}`);
    await closedLbl.uncheck(); await P.waitForTimeout(2500);

    // a number drills to its list
    const nums = live.numbers;
    const [f, lb] = [['clicked', 'Clicks'], ['opened2', 'Opened 2+ times'], ['replied', 'Replies']].find(([k]) => nums[k] > 0) || ['replied', 'Replies'];
    await P.locator(`button[title="Show ${lb.toLowerCase()} since the last huddle"]`).click(); await P.waitForTimeout(2500);
    ok(`${lb} number (${nums[f]}) -> list of exactly that many, "since last huddle" chip shown`, live.total === nums[f] && (await rowIds(P)).length === Math.min(25, nums[f]) && await P.getByRole('button', { name: /Showing since last huddle/ }).count() === 1, `${live.total} vs ${nums[f]}`);
    await P.getByRole('group', { name: 'Activity' }).getByRole('button', { name: 'All' }).click(); await P.waitForTimeout(2500);

    // expand + Escape
    const first = P.locator(`#live-row-${openIds[0]}`);
    await first.getByRole('button', { name: 'Expand timeline' }).click(); await P.waitForTimeout(300);
    const firstRow = live.rows.find(r => r.contact_id === openIds[0]);
    const lines = await first.locator('span', { hasText: /^(✉ Sent|👁 Opened|🖱 Clicked|↩ Replied)$/ }).count();
    ok('expand: one timeline line per event (sent/opened/clicked/replied)', lines === firstRow.timeline.length, `${lines} vs ${firstRow.timeline.length}`);
    await P.screenshot({ path: `${OUT}/live-1440-expanded.png` });
    await P.keyboard.press('Escape'); await P.waitForTimeout(200);
    ok('Escape closes the expand', await first.getByRole('button', { name: 'Expand timeline' }).count() === 1);

    // links open in a new tab
    const li = first.getByRole('link', { name: 'LinkedIn ↗' }), ap = first.getByRole('link', { name: 'Apollo ↗' });
    const liHref = await li.getAttribute('href');
    ok('LinkedIn link = profile or people search for name + company; Apollo = contact page', (liHref === firstRow.linkedin_url || liHref === firstRow.linkedin_search_url) && (await ap.getAttribute('href')) === `https://app.apollo.io/#/contacts/${openIds[0]}` && (await li.getAttribute('target')) === '_blank');
    const [tab] = await Promise.all([m.ctx.waitForEvent('page'), ap.click()]);
    ok('Apollo opens in a new tab', tab.url().startsWith('https://app.apollo.io') || (await tab.waitForURL(/apollo\.io/, { timeout: 5000 }).then(() => true, () => false)), tab.url());
    await tab.close();

    // load more
    if (openIds.length > 25) {
      await P.getByRole('button', { name: /^Load more/ }).click(); await P.waitForTimeout(2500);
      const more = await rowIds(P);
      ok('Load more appends the next page in order', more.length === Math.min(50, openIds.length) && more.every((id, i) => id === openIds[i]), `${more.length}`);
    }
    ok('Priorities tab still shows the ranked view', await P.getByRole('tab', { name: 'Priorities' }).click().then(() => P.getByRole('heading', { name: 'Needs action today' }).waitFor({ timeout: 8000 })).then(() => true, () => false));
    await P.getByRole('tab', { name: /^Done/ }).click(); await P.waitForTimeout(300);
    ok('Done tab shows the recap', await P.locator('#huddle-done').count() === 1);
    ok('Mara 1440: 0 console errors', m.errs.length === 0, m.errs.join(' | '));

    // Mara 390 + Vera 390
    const m3 = await newPage(mara, 390, 844);
    await openHuddle(m3.page, hlName, true);
    ok('390: no sideways scroll', await m3.page.evaluate(() => document.documentElement.scrollWidth <= 390 + 1), String(await m3.page.evaluate(() => document.documentElement.scrollWidth)));
    await m3.page.screenshot({ path: `${OUT}/live-390.png` });
    await m3.page.screenshot({ path: `${OUT}/live-390-full.png`, fullPage: true });
    ok('Mara 390: 0 console errors', m3.errs.length === 0, m3.errs.join(' | '));
    const v = await newPage(vera, 390, 844);
    await openHuddle(v.page, hlName, true);
    const vRow = v.page.locator('[id^="live-row-"]').first();
    ok('Viewer: rows shown, no Flag / Mark contacted / Sync now', await vRow.count() === 1 && !(await v.page.getByRole('button', { name: /^Flag →$|^✓ Contacted$|^Mark contacted$/ }).count()) && !(await v.page.getByLabel('Sync status').getByRole('button').count()));
    await v.page.screenshot({ path: `${OUT}/live-390-viewer.png` });
    ok('Vera 390: 0 console errors', v.errs.length === 0, v.errs.join(' | '));
    await m.ctx.close(); await m3.ctx.close(); await v.ctx.close();

    // ── Part B: writes in the temp workspace, Jack at 1440 ──
    const j = await newPage(jack, 1440, 1000), J = j.page;
    await openHuddle(J, `ZZ Live ${tag.slice(-5)}`, false);
    ok('temp: rows newest first (Avery 1 h, Blake reply 5 h, Casey click 8 h)', JSON.stringify(await rowIds(J)) === JSON.stringify(['zz-a', 'zz-b', 'zz-c']));
    const A = J.locator('#live-row-zz-a');
    ok('Avery: 👁 ×3 real opens, insight + next step text', /👁 ×3/.test(await A.innerText()) && /Opened 3×/.test(await A.innerText()) && /→ /.test(await A.innerText()), (await A.innerText()).replace(/\n/g, ' | '));
    await A.getByRole('button', { name: 'Flag →' }).click();
    const dlg = J.getByRole('dialog');
    ok('flag dialog defaults to Cyrus (the other owner)', (await dlg.getByLabel('Hand to').inputValue()) === cyrus.id);
    await dlg.getByRole('button', { name: 'Flag for Cyrus' }).click(); await J.waitForTimeout(2500);
    const flags = (await svc.from('sales_week_goals').select('id,owner_user_id,prospect_contact_id,status').eq('business_id', B)).data;
    ok('Flag -> Cyrus: exactly one open flag, owner Cyrus', flags.length === 1 && flags[0].owner_user_id === cyrus.id && flags[0].prospect_contact_id === 'zz-a');
    ok('row shows ⚑ Flagged to Cyrus', /⚑ Flagged to Cyrus/.test(await A.innerText()));
    await A.getByRole('button', { name: 'Flag →' }).click();
    await dlg.getByLabel('Hand to').selectOption(jack.id);
    await dlg.getByRole('button', { name: 'Flag for Jack' }).click(); await J.waitForTimeout(1500);
    ok('second flag: refused, offers "Reassign to Jack instead", still one flag', await dlg.getByRole('button', { name: 'Reassign to Jack instead' }).count() === 1 && (await svc.from('sales_week_goals').select('id', { count: 'exact', head: true }).eq('business_id', B)).count === 1);
    await J.screenshot({ path: `${OUT}/live-1440-reassign-offer.png` });
    await dlg.getByRole('button', { name: 'Cancel' }).click();

    const C = J.locator('#live-row-zz-c');
    await C.getByRole('button', { name: 'Mark contacted' }).click(); await J.waitForTimeout(2500);
    const st = async () => (await svc.from('sales_prospect_state').select('status').eq('business_id', B).eq('contact_id', 'zz-c').single()).data.status;
    ok('Mark contacted: DB status contacted, row shows ✓ Contacted today', (await st()) === 'contacted' && /✓ Contacted today/.test(await C.innerText()));
    await J.screenshot({ path: `${OUT}/live-1440-contacted-toast.png` });
    await J.getByRole('button', { name: 'Undo' }).click(); await J.waitForTimeout(2500);
    ok('Undo: DB status back to new, button enabled again', (await st()) === 'new' && await C.getByRole('button', { name: 'Mark contacted' }).isEnabled());
    ok('Jack: 0 console errors (besides the deliberate 409 on the second flag)', j.errs.filter(e => !/409/.test(e)).length === 0, j.errs.join(' | '));
  } catch (e) { ok('run without exceptions', false, e.stack); }
  await cleanup();
  const after = await snap();
  const moved = WATCH.filter(t => before[t] !== after[t]);
  const hlSame = (await hlState()) === hlBefore;
  ok('HomeLover: watched tables + every prospect row unchanged', !moved.length && hlSame, moved.map(t => `${t} ${before[t]}->${after[t]}`).join(', '));
  console.log(`\n${pass}/${total} passed`);
  console.log(!moved.length && hlSame ? 'restored: yes' : `restored: NO - moved: ${moved.join(', ')}${hlSame ? '' : ' + prospect rows'} (check who wrote it)`);
  process.exit(pass === total ? 0 : 1);
})();
