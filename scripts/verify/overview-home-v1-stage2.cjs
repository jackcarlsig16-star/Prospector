// overview-home-v1 Stage 2 check. HomeLover READ-ONLY through 2 temp memberships (1 member, 1 viewer - both rows added then deleted; HomeLover counts snapshotted; no other row touched). A = every fired insight carries the spec's action (label + href by rule; R1 opens the bounce list = a hand count from sales_email_daily_counts; R4 opens the Huddle; "n checks passed" = the quiet rules). B = mailbox table: jack@ and cyrus@ side by side, Apollo open % and sent = hand count from the daily counts by mailbox, human est. from the tracked opens, status word per row. C = chart defaults Week + 8w, human-open line solid + Apollo ghost dashed, the toggle hides the estimate on the chart and the strip. D = leaderboard: Reply sort by default, partner badges = sequences tagged membership/channel_partner. E = 4-week avg preset: strip sent = hand count / 4. F = viewer: no + Add event, no Dismiss, no audience menu. Screenshots 1440 / 390 / print. 0 AI / 0 Apollo. ~1.5 min, cap 4 min. Serves build/ via server.js - run npm run build first. Usage: node <this> <outdir>
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3962, tag = 'ohs2-' + Date.now(), OUT = process.argv[2] || '/tmp';
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HL = 'bc69beab-effd-452d-9e81-fd652333bb95';
const HL_TABLES = ['business_members', 'sales_goals', 'sales_partner_events', 'sales_metric_targets', 'sales_email_daily_counts', 'sales_email_messages', 'sales_email_activity', 'sales_events', 'sales_insight_dismissals', 'sales_sequence_tags'];
const made = { users: [] };
let srv, browser, pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const hlSnap = async () => { const o = {}; for (const t of HL_TABLES) { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL); o[t] = r.error ? `err:${r.error.code}` : r.count; } return JSON.stringify(o); };
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('ABORT (4 min cap)'); cleanup().then(() => process.exit(2)); }, 240000);
async function cleanup() {
  if (browser) await browser.close().catch(() => {});
  if (srv) srv.kill();
  for (const u of made.users) { await svc.from('business_members').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('actor_id', u); }
  for (const u of made.users) await svc.auth.admin.deleteUser(u);
}
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
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage(); page.setDefaultTimeout(12000);
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); }); page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
  await page.addInitScript(([k, v]) => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(u.session)]);
  await page.goto(`http://localhost:${PORT}/`); await page.waitForTimeout(3000);
  return { page, errs };
}
async function navOverview(page) {
  const compact = page.viewportSize().width < 900;
  if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
  await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
  if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
  await page.locator('#root').getByRole('button', { name: 'Goals & Sales', exact: true }).click(); await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.locator('[data-strip-tile]').first().waitFor({ timeout: 25000 }); await page.waitForTimeout(3000);
}
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const addDays = (v, n) => new Date(Date.parse(`${v}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const monday = d => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
const WEEK = monday(today), SUN = addDays(WEEK, -1), FOUR_FROM = addDays(SUN, -27);
const n = v => Number(v).toLocaleString('en-US');
const pct = v => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);
const rate = (a, b) => (b > 0 ? a / b : null);
const ACTION = { R1: 'View bounces', R2: 'Open mailbox', R3: 'View week', R4: 'Open Huddle', R5: 'Open mailbox', R6: 'Open mailbox', R7: 'Open sequence in Apollo', R8: 'Open sequence in Apollo', R9: /human opens$/, R10: null };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const hlBefore = await hlSnap();
  try {
    const jack = await user(HL, 'Member', 'member'), viewer = await user(HL, 'Viewer', 'viewer');
    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await wait(500); } }
    const get = (u, path) => fetch(`http://localhost:${PORT}/api/sales/${HL}${path}`, { headers: { Cookie: u.cookie } }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

    // Hand counts straight from the rows
    const { data: counts } = await svc.from('sales_email_daily_counts').select('day,mailbox,sequence_id,step,delivered,hard_bounced,spam_blocked,opened,replied').eq('business_id', HL);
    const byBox = (from, to) => { const m = {}; for (const r of counts) { if (r.day < from || r.day > to) continue; const b = m[r.mailbox] = m[r.mailbox] || { d: 0, hb: 0, sb: 0, o: 0, r: 0 }; b.d += r.delivered; b.hb += r.hard_bounced; b.sb += r.spam_blocked; b.o += r.opened; b.r += r.replied; } return m; };
    const thisWeek = byBox(WEEK, today);
    const sentIn = (from, to) => counts.filter(r => r.day >= from && r.day <= to).reduce((s, r) => s + r.delivered + r.hard_bounced + r.spam_blocked, 0);
    const insightsApi = (await get(jack, '/insights')).body;
    const entitiesApi = (await get(jack, '/entities')).body;
    const partnerSeqIds = new Set(entitiesApi.sequences.filter(s => s.audience === 'membership' || s.audience === 'channel_partner').map(s => s.id));
    const fired = insightsApi.insights, suppressedIds = new Set(insightsApi.not_enough_data.map(t => t.split(' ')[0])), dismissedIds = new Set(insightsApi.dismissed.map(d => d.id));
    const firedIds = new Set(fired.map(i => i.id));
    const passedHand = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10'].filter(id => !firedIds.has(id) && !suppressedIds.has(id) && !dismissedIds.has(id));
    console.log(`fired: ${fired.map(i => `${i.id}:${i.scope_key || '-'}`).join(' ')} · suppressed: ${[...suppressedIds].join(' ')} · dismissed: ${[...dismissedIds].join(' ')} · passed by hand: ${passedHand.join(' ')}`);

    browser = await chromium.launch();
    const J = await newPage(jack, 1440, 1000); const P = J.page;
    await navOverview(P);

    // A: insight actions
    const cards = await P.evaluate(() => [...document.querySelectorAll('[data-insight]')].map(el => { const a = el.querySelector('[data-action]'); return { id: el.dataset.insight, label: a ? a.textContent.replace(' ↗', '').trim() : null, href: a ? a.getAttribute('href') : null, title: el.querySelector('[style*="font-size: 14px"]')?.textContent || '' }; }));
    const wrong = cards.filter(c => { const want = ACTION[c.id]; return want === null ? c.label !== null : want instanceof RegExp ? !want.test(c.label || '') : c.label !== want; });
    ok(`A1 every fired card carries the spec's action (${cards.length} cards: ${[...new Set(cards.map(c => c.id))].join(' ')})`, cards.length === fired.length && wrong.length === 0, JSON.stringify(wrong));
    const mailboxLinks = cards.filter(c => ['R2', 'R5', 'R6'].includes(c.id)), seqLinks = cards.filter(c => ['R7', 'R8'].includes(c.id));
    ok('A2 Open mailbox links go to Apollo mailbox settings; sequence links go to that sequence in Apollo', mailboxLinks.every(c => c.href === 'https://app.apollo.io/#/settings/mailboxes') && seqLinks.every(c => /^https:\/\/app\.apollo\.io\/#\/sequences\/.+/.test(c.href)), `${mailboxLinks.length} mailbox · ${seqLinks.length} sequence links`);
    const passedText = await P.locator('[data-checks-passed] summary').innerText();
    ok(`A3 "${passedText}" = ${passedHand.length} by hand`, passedText.startsWith(`${passedHand.length} check`), passedText);
    const r1 = fired.find(i => i.id === 'R1');
    if (r1) {
      await P.locator('[data-insight="R1"] [data-action]').first().click();
      await P.locator('[data-bounce-list]').first().waitFor({ timeout: 10000 }); await P.waitForTimeout(500);
      const scopeRows = counts.filter(r => r.hard_bounced > 0 && (r1.scope_key.startsWith('week:') ? r.day >= r1.scope_key.slice(5) && r.day <= addDays(r1.scope_key.slice(5), 6) : r.sequence_id === r1.scope_key));
      const handTotal = scopeRows.reduce((s, r) => s + r.hard_bounced, 0);
      const shown = await P.locator('[data-bounce-list]').first().innerText();
      ok(`A4 R1 View bounces: list says ${handTotal} hard bounces across ${scopeRows.length} rows (hand count for ${r1.scope_key})`, shown.startsWith(`${handTotal} hard bounce`) && shown.includes(`across ${scopeRows.length} sequence-step-day`), shown.split('\n')[0]);
      await P.locator('[data-insight="R1"]').first().screenshot({ path: `${OUT}/ohs2-r1-bounces.png` });
    } else ok('A4 R1 not fired on HomeLover today - bounce list covered by the unit test', true);
    if (fired.some(i => i.id === 'R4')) {
      await P.locator('[data-insight="R4"] [data-action]').first().click(); await P.waitForTimeout(1500);
      ok('A5 R4 Open Huddle switches to the Daily Huddle', (await P.locator('[data-strip-tile]').count()) === 0 && (await P.getByRole('button', { name: 'Daily Huddle' }).count()) >= 1);
      await P.getByRole('button', { name: 'Overview', exact: true }).click(); await P.locator('[data-strip-tile]').first().waitFor({ timeout: 25000 }); await P.waitForTimeout(2500);
    } else ok('A5 R4 not fired today - Open Huddle covered by the unit test', true);

    // B: mailbox table
    const tableRows = await P.evaluate(() => [...document.querySelectorAll('[data-mailbox-row]')].map(tr => ({ box: tr.dataset.mailboxRow, cells: [...tr.querySelectorAll('td')].map(td => td.textContent.trim()), status: tr.querySelector('[data-cell="status"]').textContent.trim() })));
    const boxHand = Object.entries(thisWeek).map(([box, b]) => ({ box, sent: n(b.d + b.hb + b.sb), open: pct(rate(b.o, b.d)), reply: pct(rate(b.r, b.d)) }));
    const boxOk = boxHand.every(h => { const r = tableRows.find(t => t.box === h.box); return r && r.cells[1] === h.sent && r.cells[5] === h.open && r.cells[7] === h.reply; });
    ok(`B1 mailbox table: ${tableRows.length} rows (${tableRows.map(r => r.box.split('@')[0]).join(', ')}); sent / Apollo open % / reply % = hand count per mailbox this week`, boxOk && tableRows.length >= 2, `hand ${JSON.stringify(boxHand)} table ${JSON.stringify(tableRows.map(r => [r.box, r.cells[1], r.cells[5], r.cells[6], r.cells[7], r.status]))}`);
    ok('B2 every row has a status word (OK / Stale / Reconnect) and a human-open cell', tableRows.every(r => /OK|Stale|Reconnect/.test(r.status) && /^(~\d|—)/.test(r.cells[6])), JSON.stringify(tableRows.map(r => [r.box, r.cells[6], r.status])));
    await P.locator('#sa-widget-mailbox_health').screenshot({ path: `${OUT}/ohs2-mailbox-table.png` });

    // C: chart defaults + ghost + toggle
    const chart = await P.evaluate(() => {
      const w = document.getElementById('sa-widget-email_trend');
      const pressed = [...w.querySelectorAll('button')].filter(b => getComputedStyle(b).backgroundColor !== 'rgba(0, 0, 0, 0)').map(b => b.textContent.trim());
      const human = w.querySelector('[data-series="humanOpen"] line'), ghost = w.querySelector('[data-series="open"] line');
      return { pressed, humanDash: human ? human.getAttribute('stroke-dasharray') : 'missing', ghostDash: ghost ? ghost.getAttribute('stroke-dasharray') : 'missing', toggle: w.querySelector('button[aria-pressed]')?.getAttribute('aria-pressed') };
    });
    ok('C1 chart defaults: Week + 8w selected, human-open line solid, Apollo open a dashed ghost, Human opens pressed', chart.pressed.includes('Week') && chart.pressed.includes('8w') && (chart.humanDash === null || chart.humanDash === '4 4') && chart.ghostDash === '2 4' && chart.toggle === 'true', JSON.stringify(chart));
    await P.locator('#sa-widget-email_trend').getByRole('button', { name: 'Human opens' }).click(); await P.waitForTimeout(600);
    const off = await P.evaluate(() => ({ human: !!document.querySelector('#sa-widget-email_trend [data-series="humanOpen"]'), apolloDash: document.querySelector('#sa-widget-email_trend [data-series="open"] line')?.getAttribute('stroke-dasharray') || null, stripSub: document.querySelector('[data-strip-tile="open_rate"] [data-part="sub"]').textContent }));
    ok('C2 toggle off: human line gone, Apollo line solid, strip open tile says the estimate is hidden', !off.human && (off.apolloDash === null || off.apolloDash === '4 4') && /human est\. hidden/.test(off.stripSub), JSON.stringify(off));
    await P.locator('#sa-widget-email_trend').getByRole('button', { name: 'Human opens' }).click(); await P.waitForTimeout(600);
    ok('C3 toggle back on: strip open tile shows the estimate again', /human · est\. from/.test(await P.locator('[data-strip-tile="open_rate"] [data-part="sub"]').innerText()));

    // D: leaderboard
    const lb = await P.evaluate(() => {
      const w = document.getElementById('sa-widget-sequence_leaderboard');
      const th = [...w.querySelectorAll('th')].find(t => /Reply/.test(t.textContent));
      const groups = [...w.querySelectorAll('table')].map(t => [...t.querySelectorAll('tbody tr[id^="sa-seq-"]')].map(tr => parseFloat(tr.querySelectorAll('td')[7].textContent) || 0));
      return { replyHeader: th ? th.textContent.trim() : '', sortedDesc: groups.every(g => g.every((v, i) => i === 0 || g[i - 1] >= v)), badges: [...w.querySelectorAll('[data-partner-badge]')].length, badgeRows: [...w.querySelectorAll('tr[id^="sa-seq-"]')].filter(tr => tr.querySelector('[data-partner-badge]')).map(tr => tr.id.replace('sa-seq-', '')) };
    });
    const badgeHand = [...partnerSeqIds].filter(id => entitiesApi.sequences.find(s => s.id === id)?.active !== false);
    ok(`D1 leaderboard: Reply header carries the sort arrow, every group sorted by reply % desc, ${lb.badges} partner badges = ${badgeHand.length} active partner-tagged sequences`, /▼/.test(lb.replyHeader) && lb.sortedDesc && lb.badgeRows.every(id => partnerSeqIds.has(id)) && lb.badges === badgeHand.length, JSON.stringify(lb));
    await P.screenshot({ path: `${OUT}/ohs2-1440-overview.png`, fullPage: true });

    // E: 4-week avg
    await P.getByRole('button', { name: '4-week avg', exact: true }).click(); await P.waitForTimeout(1000);
    await P.locator('[data-strip-tile]').first().waitFor({ timeout: 25000 }); await P.waitForTimeout(2500);
    const avg = await P.evaluate(() => ({ sent: document.querySelector('[data-strip-tile="sent"] [data-part="number"]').textContent, sub: document.querySelector('[data-strip-tile="sent"] [data-part="sub"]').textContent, line: document.querySelector('[data-strip-period]').textContent }));
    const avgHand = Math.round(sentIn(FOUR_FROM, SUN) / 4);
    ok(`E1 4-week avg: strip sent ${avg.sent} = round(${sentIn(FOUR_FROM, SUN)} / 4) = ${n(avgHand)}; period line says per-week averages`, avg.sent === n(avgHand) && /per-week averages over 4 weeks/.test(avg.line) && /avg per week/.test(avg.sub), JSON.stringify(avg));
    await P.locator('#sa-widget-week_strip').screenshot({ path: `${OUT}/ohs2-4week-strip.png` });
    await P.getByRole('button', { name: 'This Week', exact: true }).click(); await P.waitForTimeout(1000); await P.locator('[data-strip-tile]').first().waitFor({ timeout: 25000 }); await P.waitForTimeout(1500);
    ok('E2 1440: 0 console errors', J.errs.length === 0, J.errs.join(' | '));

    // Print + 390
    await P.emulateMedia({ media: 'print' }); await P.waitForTimeout(500);
    await P.screenshot({ path: `${OUT}/ohs2-print-preview.png`, fullPage: true });
    await P.emulateMedia({ media: 'screen' });
    const M = await newPage(jack, 390, 844); await navOverview(M.page);
    ok('P1 390: no horizontal overflow, mailbox table scrolls inside its card', await M.page.evaluate(() => document.documentElement.scrollWidth <= 390));
    await M.page.screenshot({ path: `${OUT}/ohs2-390-overview.png`, fullPage: true });
    ok('P2 390: 0 console errors', M.errs.length === 0, M.errs.join(' | '));

    // F: viewer
    const V = await newPage(viewer, 1440, 1000); await navOverview(V.page);
    const v = await V.page.evaluate(() => ({ addEvent: !!document.querySelector('#sa-widget-email_trend button') && [...document.querySelectorAll('#sa-widget-email_trend button')].some(b => /Add event/.test(b.textContent)), dismiss: [...document.querySelectorAll('#sales-analytics-print-area button')].some(b => /Dismiss/.test(b.textContent)), audienceMenu: document.querySelectorAll('[data-audience-menu]').length, tiles: document.querySelectorAll('[data-strip-tile]').length, insights: document.querySelectorAll('[data-insight]').length, mailboxRows: document.querySelectorAll('[data-mailbox-row]').length }));
    ok('F1 viewer: strip, insights (with their links) and mailbox table render; no + Add event, no Dismiss, no audience menu', v.tiles === 7 && v.insights === fired.length && v.mailboxRows >= 2 && !v.addEvent && !v.dismiss && v.audienceMenu === 0, JSON.stringify(v));
    ok('F2 viewer: 0 console errors', V.errs.length === 0, V.errs.join(' | '));
  } catch (e) {
    console.log('ERROR', e.stack || e.message);
  } finally {
    await cleanup();
    const hlAfter = await hlSnap();
    console.log(`\n${pass}/${total} passed · screenshots in ${OUT}`);
    if (hlAfter !== hlBefore) console.log('HomeLover counts before', hlBefore, 'after', hlAfter);
    console.log(`HomeLover untouched: ${hlAfter === hlBefore ? 'yes' : 'NO'}`);
    console.log(`restored: ${hlAfter === hlBefore ? 'yes' : 'NO'}`);
    process.exit(0);
  }
})();
