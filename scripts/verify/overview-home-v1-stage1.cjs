// overview-home-v1 Stage 1 check. TEMP workspace (2 temp users member + viewer; fixtures: 4 daily-count rows, 4 tracked messages, 4 open events, 2 partners + 4 partner events, 1 manual meetings row - all deleted) and HomeLover READ-ONLY through a temp viewer membership (1 business_members row added, deleted after; counts snapshotted). Part A = hand count from raw rows (no app code) vs the rendered strip on the temp workspace: 7 tiles this week vs last, deltas by goodDirection, est. human sub-line, real-reply sub-line, typed meetings in the tooltip; widget order; pipeline hidden; goal line. Part B = 390 + print preview (band per page, deltas in ink). Part C = viewer sees the strip, no actions. Part D = HomeLover: hand count from its raw rows = the strip it shows, this week and last week. 0 AI / 0 Apollo. ~1.5 min, cap 4 min. Serves build/ via server.js - run npm run build first. Usage: node <this> <outdir>
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3961, tag = 'ohs1-' + Date.now(), OUT = process.argv[2] || '/tmp';
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HL = 'bc69beab-effd-452d-9e81-fd652333bb95';
const WATCH = ['businesses', 'business_members', 'sales_goals', 'sales_partner_events', 'sales_metric_targets', 'sales_email_daily_counts', 'sales_email_messages', 'sales_email_activity', 'profiles', 'auth_events'];
const HL_TABLES = ['business_members', 'sales_goals', 'sales_partner_events', 'sales_metric_targets', 'sales_email_daily_counts', 'sales_email_messages', 'sales_email_activity'];
const made = { users: [], biz: [] };
let srv, browser, pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const snap = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true })).count; return o; };
const hlSnap = async () => { const o = {}; for (const t of HL_TABLES) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL)).count; return JSON.stringify(o); };
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('ABORT (4 min cap)'); cleanup().then(() => process.exit(2)); }, 240000);
async function cleanup() {
  if (browser) await browser.close().catch(() => {});
  if (srv) srv.kill();
  for (const b of made.biz) {
    for (const t of ['sales_email_activity', 'sales_email_messages', 'sales_email_daily_counts', 'sales_metric_targets', 'sales_partner_events', 'sales_goals', 'business_members', 'auth_events']) await svc.from(t).delete().eq('business_id', b);
  }
  for (const u of made.users) { await svc.from('business_members').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('actor_id', u); }
  for (const b of made.biz) await svc.from('businesses').delete().eq('id', b);
  for (const u of made.users) await svc.auth.admin.deleteUser(u);
}
const biz = async name => { const id = ins(await svc.from('businesses').insert({ name: `ZZ ${name} ${tag.slice(-5)}`, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}-${name}@example.com`, access_code: `${tag}-${name}`, features: { goals_sales: true } }).select().single()).id; made.biz.push(id); return id; };
async function user(b, name, role) {
  const email = `${tag}-${name.toLowerCase()}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
  const { data: u } = await svc.auth.admin.createUser({ email, password, email_confirm: true }); made.users.push(u.user.id);
  await svc.from('profiles').update({ display_name: `${name} Test`, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
  ins(await svc.from('business_members').insert({ business_id: b, email, name: `${name} Test`, user_id: u.user.id, role }).select());
  const c = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: s } = await c.auth.signInWithPassword({ email, password });
  return { id: u.user.id, email, session: s.session, cookie: `prospector_at=${encodeURIComponent(s.session.access_token)}` };
}
async function newPage(u, width, height) {
  const errs = [];
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage(); page.setDefaultTimeout(10000);
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); }); page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
  await page.addInitScript(([k, v]) => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(u.session)]);
  await page.goto(`http://localhost:${PORT}/`); await page.waitForTimeout(3000);
  return { page, errs };
}
async function navOverview(page, label) {
  const compact = page.viewportSize().width < 900;
  if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
  await page.getByLabel('Workspace').selectOption({ label }); await page.waitForTimeout(1500);
  if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
  await page.locator('#root').getByRole('button', { name: 'Goals & Sales', exact: true }).click(); await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.locator('[data-strip-tile]').first().waitFor(); await page.waitForTimeout(2500);
}
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const addDays = (v, n) => new Date(Date.parse(`${v}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const monday = d => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
const WEEK = monday(today), LAST = addDays(WEEK, -7);
const laDay = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const n = v => Number(v).toLocaleString('en-US');
const pct = v => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);
const rate = (a, b) => (b > 0 ? a / b : null);
// The strip's own bot rule, copied here on purpose (api/sales/heatScore.js isBotOpen).
const isBot = (ev, deliveredAt) => !!ev.tracking_service || /generic linux/i.test(ev.user_agent || '') || (!!deliveredAt && (Date.parse(ev.occurred_at) - Date.parse(deliveredAt)) / 1000 <= 60);
const AUTO = ['out_of_office', 'unsubscribe', 'already_left_company_or_not_right_person'];

// Hand count for one workspace and one day range, straight from the rows.
async function hand(B, from, to) {
  const { data: counts } = await svc.from('sales_email_daily_counts').select('day,delivered,hard_bounced,spam_blocked,opened,replied').eq('business_id', B).gte('day', from).lte('day', to);
  const t = { delivered: 0, hard_bounced: 0, spam_blocked: 0, opened: 0, replied: 0 };
  for (const r of counts) for (const f of Object.keys(t)) t[f] += r[f];
  t.sent = t.delivered + t.hard_bounced + t.spam_blocked;
  const { data: opens } = await svc.from('sales_email_activity').select('apollo_message_id,occurred_at,user_agent,tracking_service').eq('business_id', B).eq('event', 'open');
  const ids = [...new Set(opens.map(o => o.apollo_message_id))];
  const { data: msgs } = ids.length ? await svc.from('sales_email_messages').select('apollo_message_id,delivered_at').eq('business_id', B).in('apollo_message_id', ids) : { data: [] };
  const dAt = new Map(msgs.map(m => [m.apollo_message_id, m.delivered_at]));
  const inRange = iso => { const d = laDay(iso); return d >= from && d <= to; };
  const weekOpens = opens.filter(o => inRange(o.occurred_at));
  const bots = weekOpens.filter(o => isBot(o, dAt.get(o.apollo_message_id))).length;
  const { data: replies } = await svc.from('sales_email_messages').select('reply_class,replied_seen_at').eq('business_id', B).eq('replied', true);
  const weekReplies = replies.filter(r => r.replied_seen_at && inRange(r.replied_seen_at));
  const { data: events } = await svc.from('sales_partner_events').select('id,event,from_status,to_status,meta,at').eq('business_id', B);
  const undone = new Set(events.filter(e => e.event === 'undo').map(e => e.meta?.undid));
  const meetings = events.filter(e => e.event !== 'undo' && !undone.has(e.id) && e.to_status === 'meeting_set' && e.from_status !== 'meeting_set' && inRange(e.at)).length;
  const { data: manual } = await svc.from('sales_metric_targets').select('period_start,actual').eq('business_id', B).eq('period', 'week').eq('metric_key', 'meetings_set').gte('period_start', from).lte('period_start', to).not('actual', 'is', null);
  const openRate = rate(t.opened, t.delivered), share = weekOpens.length ? 1 - bots / weekOpens.length : null;
  return {
    sent: n(t.sent), delivered_rate: pct(rate(t.delivered, t.sent)), bounce_rate: pct(rate(t.hard_bounced, t.sent)), spam_blocked: n(t.spam_blocked),
    open_rate: pct(openRate), reply_rate: pct(rate(t.replied, t.delivered)), meetings: n(meetings),
    open_sub: weekOpens.length ? `~${pct(openRate !== null && share !== null ? openRate * share : null)} human · est. from ${weekOpens.length} tracked` : 'no tracked opens yet',
    reply_sub: weekReplies.length ? `${weekReplies.filter(r => !AUTO.includes(r.reply_class)).length} real · of ${weekReplies.length} tracked` : 'no tracked replies yet',
    manual: manual.length ? manual.reduce((s, m) => s + Number(m.actual), 0) : null, raw: { ...t, opens: weekOpens.length, bots, replies: weekReplies.length, meetings },
  };
}
async function readStrip(page) {
  return page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-strip-tile]')].map(el => [el.dataset.stripTile, {
    number: el.querySelector('[data-part="number"]').textContent, sub: el.querySelector('[data-part="sub"]').textContent,
    delta: el.querySelector('[data-part="delta"]').textContent, deltaColor: el.querySelector('[data-part="delta"]').style.color, title: el.title,
  }])));
}
const sameStrip = (strip, h) => ['sent', 'delivered_rate', 'bounce_rate', 'spam_blocked', 'open_rate', 'reply_rate', 'meetings'].every(k => strip[k].number === h[k]) && strip.open_rate.sub === h.open_sub && strip.reply_rate.sub === h.reply_sub;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const before = await snap(), hlBefore = await hlSnap();
  try {
    const B = await biz('ohs');
    const bizLabel = (await svc.from('businesses').select('name').eq('id', B).single()).data.name;
    const jack = await user(B, 'Jack', 'member'), viewer = await user(B, 'Viewer', 'viewer'), seif = await user(HL, 'Seif', 'viewer');
    // Fixtures: this week on Monday (always <= today), last week on its Tue/Thu.
    const dc = (day, mailbox, delivered, hard_bounced, spam_blocked, opened, replied) => ({ business_id: B, day, mailbox, delivered, hard_bounced, spam_blocked, opened, clicked: 0, replied });
    ins(await svc.from('sales_email_daily_counts').insert([dc(LAST, 'a@t.io', 100, 3, 3, 10, 1), dc(LAST, 'b@t.io', 50, 0, 1, 5, 0), dc(WEEK, 'a@t.io', 200, 4, 1, 15, 0), dc(WEEK, 'b@t.io', 100, 0, 0, 5, 2)]).select());
    const dAt = `${WEEK}T15:00:00Z`, lAt = `${LAST}T15:00:00Z`, seen = `${WEEK}T16:00:00Z`;
    const msg = (id, delivered_at, extra = {}) => ({ business_id: B, apollo_message_id: `${tag}-${id}`, contact_id: `${tag}-c${id}`, sender: 'a@t.io', delivered_at, replied: false, reply_class: null, replied_seen_at: null, ...extra });
    ins(await svc.from('sales_email_messages').insert([msg('m1', dAt), msg('m2', dAt), msg('m3', lAt, { replied: true, reply_class: 'willing_to_meet', replied_seen_at: seen }), msg('m4', lAt, { replied: true, reply_class: 'out_of_office', replied_seen_at: seen })]).select());
    const op = (id, occurred_at, extra = {}) => ({ business_id: B, apollo_message_id: `${tag}-${id}`, contact_id: `${tag}-c${id}`, event: 'open', occurred_at, user_agent: null, tracking_service: null, ...extra });
    ins(await svc.from('sales_email_activity').insert([op('m1', `${WEEK}T15:00:30Z`), op('m1', `${WEEK}T17:00:00Z`, { tracking_service: 'proofpoint' }), op('m1', `${WEEK}T18:00:00Z`, { user_agent: 'Mozilla/5.0 (Macintosh)' }), op('m2', `${WEEK}T19:00:00Z`)]).select());
    const partner = async (name, status) => ins(await svc.from('sales_goals').insert({ business_id: B, goal_type: 'partnership', name: `${name} ${tag.slice(-4)}`, pipeline_status: status }).select().single());
    const [p1, p2] = await Promise.all([partner('Alpha', 'meeting_set'), partner('Bravo', 'replied')]);
    const ev = (goal_id, event, from_status, to_status, at, meta) => ({ business_id: B, goal_id, event, from_status, to_status, at, meta: meta || {} });
    const [e1] = ins(await svc.from('sales_partner_events').insert([ev(p1.id, 'status', 'replied', 'meeting_set', `${WEEK}T17:00:00Z`)]).select());
    const [e2] = ins(await svc.from('sales_partner_events').insert([ev(p2.id, 'status', 'replied', 'meeting_set', `${WEEK}T17:30:00Z`)]).select());
    ins(await svc.from('sales_partner_events').insert([ev(p2.id, 'undo', 'meeting_set', 'replied', `${WEEK}T17:40:00Z`, { undid: e2.id }), ev(p2.id, 'status', 'in_sequence', 'meeting_set', `${LAST}T17:00:00Z`)]).select());
    ins(await svc.from('sales_metric_targets').insert({ business_id: B, period: 'week', period_start: WEEK, metric_key: 'meetings_set', actual: 3 }).select());
    void e1;

    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await wait(500); } }
    const get = (u, b, path) => fetch(`http://localhost:${PORT}/api/sales/${b}${path}`, { headers: { Cookie: u.cookie } }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

    // Part A: temp workspace, hand count = API = strip
    // "This week" compares to the same weekdays of last week (weekStripData.compareRange).
    const LAST_TO = addDays(today, -7);
    const thisW = await hand(B, WEEK, today), lastW = await hand(B, LAST, LAST_TO);
    ok('A1 hand count this week: sent 305, 98.4% delivered, 1.3% bounce, 1 spam, 6.7% open (~3.3% human of 4 tracked), 0.7% reply (1 real of 2), 1 meeting', thisW.sent === '305' && thisW.delivered_rate === '98.4%' && thisW.bounce_rate === '1.3%' && thisW.spam_blocked === '1' && thisW.open_rate === '6.7%' && thisW.open_sub === '~3.3% human · est. from 4 tracked' && thisW.reply_rate === '0.7%' && thisW.reply_sub === '1 real · of 2 tracked' && thisW.meetings === '1' && thisW.manual === 3, JSON.stringify(thisW));
    ok('A2 hand count last week (same weekdays): sent 157, 1.9% bounce, 4 spam, 10.0% open, 0.7% reply, 1 meeting', lastW.sent === '157' && lastW.bounce_rate === '1.9%' && lastW.spam_blocked === '4' && lastW.open_rate === '10.0%' && lastW.reply_rate === '0.7%' && lastW.meetings === '1', JSON.stringify(lastW));
    const ws = await get(jack, B, `/week-strip?from=${LAST}`);
    const sum = (k, from, to) => ws.body.days.filter(d => d.day >= from && d.day <= to).reduce((s, d) => s + d[k], 0);
    ok('A3 GET /week-strip: this week 4 tracked opens / 2 bot / 2 replies / 1 real / 1 meeting; last week 1 meeting; manual 3', ws.status === 200 && sum('tracked_opens', WEEK, today) === 4 && sum('tracked_bot_opens', WEEK, today) === 2 && sum('tracked_replies', WEEK, today) === 2 && sum('tracked_real_replies', WEEK, today) === 1 && sum('meetings', WEEK, today) === 1 && sum('meetings', LAST, LAST_TO) === 1 && JSON.stringify(ws.body.manual_meetings) === JSON.stringify([{ week_start: WEEK, actual: 3 }]), JSON.stringify(ws.body));
    ok('A4 GET /week-strip refuses a bad from', (await get(jack, B, '/week-strip?from=nope')).status === 400);

    browser = await chromium.launch();
    const J = await newPage(jack, 1440, 1000); const P = J.page;
    await navOverview(P, bizLabel);
    const strip = await readStrip(P);
    ok('A5 strip 1440 = hand count (7 tiles, est. human sub-line, real-reply sub-line)', Object.keys(strip).length === 7 && sameStrip(strip, thisW), JSON.stringify(strip));
    ok('A6 deltas vs last week by goodDirection: sent ▲ 148 green, delivered ▲ 2.8 pts green, bounce ▼ 0.6 pts green, spam ▼ 3 green, open ▼ 3.3 pts red, reply no change (0.7 vs 0.7) muted, meetings no change muted', strip.sent.delta === '▲ 148 vs last week' && strip.sent.deltaColor === 'var(--sa-good)' && strip.delivered_rate.delta === '▲ 2.8 pts vs last week' && strip.delivered_rate.deltaColor === 'var(--sa-good)' && strip.bounce_rate.delta === '▼ 0.6 pts vs last week' && strip.bounce_rate.deltaColor === 'var(--sa-good)' && strip.spam_blocked.delta === '▼ 3 vs last week' && strip.spam_blocked.deltaColor === 'var(--sa-good)' && strip.open_rate.delta === '▼ 3.3 pts vs last week' && strip.open_rate.deltaColor === 'var(--sa-bad)' && strip.reply_rate.delta === 'no change vs last week' && strip.reply_rate.deltaColor === 'var(--sa-muted)' && strip.meetings.delta === 'no change vs last week' && strip.meetings.deltaColor === 'var(--sa-muted)', JSON.stringify(Object.fromEntries(Object.entries(strip).map(([k, v]) => [k, [v.delta, v.deltaColor]]))));
    ok('A7 open tooltip names Apollo + the tracked bot rule; meetings tooltip carries the typed count 3', /Apollo opens ÷ delivered \(20 \/ 300\)/.test(strip.open_rate.title) && /2 look automated/.test(strip.open_rate.title) && /typed count says 3/.test(strip.meetings.title));
    const period = await P.locator('[data-strip-period]').innerText();
    ok('A8 period line says this week vs last week, same weekdays', new RegExp(`vs last week \\(${new Date(`${LAST}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} – ${new Date(`${LAST_TO}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}\\)`).test(period), period);
    const order = await P.evaluate(() => [...document.querySelectorAll('[id^="sa-widget-"]')].map(e => e.id.replace('sa-widget-', '')));
    ok('A9 widget order strip · insights · mailbox · trend · leaderboard; pipeline, cohort, kpi tiles and delivery mix absent', JSON.stringify(order) === JSON.stringify(['week_strip', 'email_insights', 'mailbox_health', 'email_trend', 'sequence_leaderboard']), JSON.stringify(order));
    const line = await P.getByLabel('Goals this week').innerText();
    ok('A10 goal line: week label, meetings 1 (partner events are not the typed count - the line shows the scorecard\'s typed 3), in sequence, Goals link', /week \d · /i.test(line) && /3 meetings/.test(line) && /in sequence/.test(line) && /Goals →/.test(line), line.replace(/\n/g, ' '));
    ok('A11 partner summary still under the line', (await P.getByRole('region', { name: 'Partner pipeline' }).count()) === 1);
    const spark = await P.evaluate(() => { const t = [...document.querySelectorAll('[data-strip-tile]')]; return { d: document.querySelector('[data-strip-tile="sent"] svg path').getAttribute('d'), rows: new Set(t.map(e => Math.round(e.getBoundingClientRect().top))).size }; });
    ok('A11b sparkline draws a line through 8 weeks (7 line segments), 7 tiles on one row at 1440', (spark.d.match(/L /g) || []).length === 7 && spark.rows === 1, JSON.stringify(spark));
    await P.screenshot({ path: `${OUT}/ohs1-1440-overview.png`, fullPage: true });
    await P.locator('[data-strip-tile="meetings"] [data-part="number"]').click(); await P.waitForTimeout(1500);
    ok('A12 meetings number opens Goals › Partners', (await P.getByRole('button', { name: 'Goals', exact: true }).count()) >= 1 && (await P.locator('[data-strip-tile]').count()) === 0);
    await P.getByRole('button', { name: 'Overview', exact: true }).click(); await P.locator('[data-strip-tile]').first().waitFor(); await P.waitForTimeout(1500);
    await P.getByLabel('Goals this week').getByText('Goals →').click();
    const heroShown = await P.locator('[data-hero-card]').first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
    ok('A13 "Goals →" opens Goals', heroShown && (await P.locator('[data-strip-tile]').count()) === 0);
    await P.getByRole('button', { name: 'Overview', exact: true }).click(); await P.locator('[data-strip-tile]').first().waitFor(); await P.waitForTimeout(1500);
    await P.getByLabel('Compare to previous period').uncheck(); await P.waitForTimeout(800);
    const off = await readStrip(P);
    ok('A14 compare off: deltas gone, numbers unchanged', off.sent.delta === 'compare off' && off.sent.number === '305');
    await P.getByLabel('Compare to previous period').check(); await P.waitForTimeout(800);
    ok('A15 1440: 0 console errors', J.errs.length === 0, J.errs.join(' | '));

    // Part B: print preview + 390
    await P.emulateMedia({ media: 'print' }); await P.waitForTimeout(500);
    const pr = await P.evaluate(() => {
      const cs = el => getComputedStyle(el);
      const root = document.getElementById('sales-analytics-root');
      return { insightsBreak: cs(document.getElementById('sa-widget-email_insights')).breakBefore, stripBreak: cs(document.getElementById('sa-widget-week_strip')).breakBefore,
        order: [...document.querySelectorAll('[id^="sa-widget-"]')].map(e => [e.id.replace('sa-widget-', ''), cs(e).order]), deltaInk: cs(document.querySelector('[data-part="delta"]')).color === cs(root).color, bg: cs(root).backgroundColor };
    });
    ok('B1 print: band 1 starts a new page, band 0 does not, order strip 1 → leaderboard 5, deltas in text ink, white ground', pr.insightsBreak === 'page' && pr.stripBreak !== 'page' && JSON.stringify(pr.order) === JSON.stringify([['week_strip', '1'], ['email_insights', '2'], ['mailbox_health', '3'], ['email_trend', '4'], ['sequence_leaderboard', '5']]) && pr.deltaInk && pr.bg === 'rgb(255, 255, 255)', JSON.stringify(pr));
    await P.screenshot({ path: `${OUT}/ohs1-print-preview.png`, fullPage: true });
    await P.emulateMedia({ media: 'screen' });
    const M = await newPage(jack, 390, 844); await navOverview(M.page, bizLabel);
    const m = await M.page.evaluate(() => { const t = [...document.querySelectorAll('[data-strip-tile]')]; return { tiles: t.length, maxRight: Math.max(...t.map(e => e.getBoundingClientRect().right)), cols: new Set(t.map(e => Math.round(e.getBoundingClientRect().left))).size, scrollW: document.documentElement.scrollWidth }; });
    ok('B2 390: 7 tiles in 2 columns, no horizontal overflow', m.tiles === 7 && m.cols === 2 && m.maxRight <= 390 && m.scrollW <= 390, JSON.stringify(m));
    await M.page.screenshot({ path: `${OUT}/ohs1-390-overview.png`, fullPage: true });
    ok('B3 390: 0 console errors', M.errs.length === 0, M.errs.join(' | '));

    // Part C: viewer
    const V = await newPage(viewer, 1440, 1000); await navOverview(V.page, bizLabel);
    const vs = await readStrip(V.page);
    const vActions = await V.page.evaluate(() => [...document.querySelectorAll('#sa-widget-week_strip button, [aria-label="Goals this week"] button')].map(b => b.textContent.trim()).filter(t => /set goal|log touch|add|save|apply|edit/i.test(t)));
    ok('C1 viewer sees the same strip and goal line, no action buttons on them (drills only)', sameStrip(vs, thisW) && vActions.length === 0, JSON.stringify(vActions));
    const vOther = await V.page.evaluate(() => [...document.querySelectorAll('#sales-analytics-print-area button')].map(b => b.textContent.trim()).filter(t => /set goal|log touch|add|save|apply|edit/i.test(t)));
    console.log(`NOTE  viewer action buttons elsewhere on Overview (pre-existing, outside Stage 1): ${JSON.stringify(vOther)}`);
    ok('C2 viewer: 0 console errors', V.errs.length === 0, V.errs.join(' | '));

    // Part D: HomeLover read-only - hand count from its raw rows = its strip
    const hlThis = await hand(HL, WEEK, today), hlLast = await hand(HL, LAST, addDays(LAST, 6));
    // Last Week preset: a full week, compared to the week before (the header's own window).
    const S = await newPage(seif, 1440, 1000); await navOverview(S.page, 'HomeLover');
    const hs = await readStrip(S.page);
    ok('D1 HomeLover this week: strip = hand count', sameStrip(hs, hlThis), `strip ${JSON.stringify(Object.fromEntries(Object.entries(hs).map(([k, v]) => [k, v.number])))} hand ${JSON.stringify(hlThis)}`);
    await S.page.getByRole('button', { name: 'Last Week', exact: true }).click(); await S.page.waitForTimeout(1000);
    await S.page.locator('[data-strip-tile]').first().waitFor({ timeout: 20000 }); await S.page.waitForTimeout(2000);
    const hl2 = await readStrip(S.page);
    ok('D2 HomeLover last week: strip = hand count, compare says the week before', sameStrip(hl2, hlLast) && /vs the week before/.test(hl2.sent.delta), `strip ${JSON.stringify(Object.fromEntries(Object.entries(hl2).map(([k, v]) => [k, v.number])))} hand ${JSON.stringify(hlLast)}`);
    await S.page.getByRole('button', { name: 'This Week', exact: true }).click(); await S.page.waitForTimeout(1000); await S.page.locator('[data-strip-tile]').first().waitFor({ timeout: 20000 }); await S.page.waitForTimeout(1500);
    await S.page.screenshot({ path: `${OUT}/ohs1-1440-homelover.png`, fullPage: true });
    ok('D3 HomeLover: 0 console errors', S.errs.length === 0, S.errs.join(' | '));
    console.log('HomeLover raw this week', JSON.stringify(hlThis.raw), 'last week', JSON.stringify(hlLast.raw));
  } catch (e) {
    console.log('ERROR', e.stack || e.message);
  } finally {
    await cleanup();
    const after = await snap(), hlAfter = await hlSnap();
    const same = JSON.stringify(after) === JSON.stringify(before);
    console.log(`\n${pass}/${total} passed · screenshots in ${OUT}`);
    if (!same) console.log('counts before', before, 'after', after);
    console.log(`HomeLover untouched: ${hlAfter === hlBefore ? 'yes' : 'NO'}`);
    console.log(`restored: ${same && hlAfter === hlBefore ? 'yes' : 'NO'}`);
    process.exit(0);
  }
})();
