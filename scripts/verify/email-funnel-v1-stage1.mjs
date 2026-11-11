// email-funnel-v1 Stage 1 - live as Jack on the REAL HomeLover workspace, READ-ONLY (0 Claude, 0 Apollo, 0 writes):
//   GET goals/funnel through the real wiring (a spawned server.js with the Anthropic / Apollo keys blanked) against an
//   independent re-count from the tables for yesterday / 7 d / 30 d (delivered = the delivered rows AND the counts
//   table's Σ for the fetched days; human opens / clicks / replies / meetings re-judged from the raw rows); the route's
//   body = the email builder's tables = Scout's intent items, to the digit; the email rendered at 640 / 390 (no sideways
//   overflow, the three tables in view); no address anywhere; the series' sides.
//   PROD_SEND=1: the ONE declared test send through PROD's test route (the local server has no Microsoft keys) - run once
//     Render is Live on this commit; prints status + counts and the sends-table count before / after.
// Declared scope: 1 owner session (released, last_seen_at restored) · ~10 table reads (< 2k rows each) · 3 GETs on the
// local server · 2 Playwright renders of a local HTML file · ~60 s, cap 235 s · PROD_SEND=1: exactly ONE POST.
// Usage: node scripts/verify/email-funnel-v1-stage1.mjs      PROD_SEND=1 node scripts/verify/email-funnel-v1-stage1.mjs
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { ownerSession } from './lib/ownerSession.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const { selectAllPages } = await import('../../api/lib/selectAllPages.js');
const { laClock } = await import('../../api/sales/teamEmails/scheduler.js');
const { laDateString } = await import('../../api/sales/laDate.js');
const { isBotOpen, isAutomated, HEAT } = await import('../../api/sales/heatScore.js');
const { SCANNER_CLICK_WITHIN_SECONDS } = await import('../../api/sales/nextBestAction.js');
const { countExternalMeetings } = await import('../../api/sales/scorecardMath.js');
const { laStartOfDayMs, addDays } = await import('../../api/sales/goalsShared.js');
const { windowRange, FUNNEL_SINCE } = await import('../../api/sales/funnelMath.js');
const { loadFunnel } = await import('../../api/sales/funnelRoutes.js');
const { loadVisitorData, loadRankedBook, loadCumulative, buildVisitorEmail, dayWindowFor, FUNNEL_WINDOWS } = await import('../../api/sales/teamEmails/visitorEmail.js');
const { loadMembers, loadSettings } = await import('../../api/sales/teamEmails/send.js');
const { visitorsTrend } = await import('../../api/sales/visitTrend.js');
const { salesIntents } = await import('../../api/sales/scoutIntents.js');
const OUT = path.join(ROOT, '.screenshots', 'email-funnel-v1');
const PORT = 3997, BASE = `http://localhost:${PORT}`, PROD = 'https://prospector-chtj.onrender.com';
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data?.[0]?.id;
if (!HL) throw new Error('no HomeLover business');
const nowD = new Date();
const minsToSix = ((6 - (nowD.getHours() % 6)) % 6) * 60 - nowD.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (nowD.getHours() % 6 === 0 && nowD.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
const PROD_SEND = process.env.PROD_SEND === '1';
const ADDRESS = /[^\s@<>()"',;=&#]+@[^\s@<>()"',;=&#]+\.[a-z]{2,}/i;
let srv, browser, owner;
const results = { checks: [], errors: [], numbers: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 500)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 235000 });
fs.mkdirSync(OUT, { recursive: true });
const sendsCount = async () => (await svc.from('sales_team_email_sends').select('*', { count: 'exact', head: true }).eq('business_id', HL)).count;
const pct = x => (x == null ? '—' : `${(100 * x).toFixed(1)} %`);

try {
  owner = await ownerSession(svc);
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const api = async (base, p, init = {}) => { const r = await fetch(`${base}/api/sales/${HL}${p}`, { ...init, headers: { cookie, 'content-type': 'application/json', ...(init.headers || {}) } }); return { status: r.status, body: await r.json().catch(() => null) }; };

  if (PROD_SEND) {
    const before = await sendsCount();
    const r = await api(PROD, '/goals/team-emails/test', { method: 'POST', body: JSON.stringify({ kind: 'visitor' }) });
    const after = await sendsCount();
    ok(`PROD test send: HTTP ${r.status} · status ${r.body?.status} · recipients ${r.body?.recipients} · rows ${r.body?.rows} · funnel tables ${r.body?.funnel} · strip ${r.body?.strip} · sales_team_email_sends ${before} -> ${after}`, r.status === 200 && r.body?.status === 'sent' && after === before + 1 && r.body?.strip >= 1 && [0, 3].includes(r.body?.funnel) && typeof r.body?.subject === 'string');
    log(`   subject "${r.body?.subject}" · strip ${r.body?.strip} windows · funnel tables ${r.body?.funnel} (0 = the owner's switch is off, FIX email-simplify-v1 E2)`);
    ok('the reply carries no address', !ADDRESS.test(JSON.stringify(r.body || {})));
    throw Object.assign(new Error('done'), { done: true });
  }

  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', ANTHROPIC_API_KEY: '', APOLLO_API_KEY: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const today = laClock().date;

  // ---- ROUTE through the real wiring.
  const route = await api(BASE, '/goals/funnel?windows=yesterday,7d,30d,this_week,last_week&days=30');
  ok(`GET goals/funnel: HTTP ${route.status} · ready ${route.body?.ready} · delivered_since ${route.body?.delivered_since} · since ${route.body?.since} · series ${route.body?.series?.length} days`, route.status === 200 && route.body?.ready === true && route.body?.delivered_since <= FUNNEL_SINCE);
  ok('a Viewer-level GET only - 400 on an unknown window key', (await api(BASE, '/goals/funnel?windows=fortnight')).status === 400);
  const W = route.body?.windows || {};
  results.numbers.windows = Object.fromEntries(Object.entries(W).map(([k, w]) => [k, { from: w.from, to: w.to, delivered: w.delivered, companies_emailed: w.companies_emailed, companies_visited: w.companies_visited, people_emailed: w.people_emailed, people_identified: w.people_identified, human_opens: w.human_opens, human_clicks: w.human_clicks, replies: w.replies, meetings: w.meetings, company_rate: w.company_rate, person_rate: w.person_rate, visited: w.companies_visited_names }]));

  // ---- RAW re-count, independent of funnelMath: delivered from the delivered rows AND the counts table; the steps from
  // the raw activity / message / calendar rows with the rules applied here.
  const [delivered, counts, events, messages, cal] = await Promise.all([
    selectAllPages(() => svc.from('sales_email_delivered').select('apollo_message_id, contact_id, delivered_at, delivered_day').eq('business_id', HL).order('apollo_message_id')),
    selectAllPages(() => svc.from('sales_email_daily_counts').select('day, delivered').eq('business_id', HL).gte('day', FUNNEL_SINCE).order('day')),
    selectAllPages(() => svc.from('sales_email_activity').select('id, apollo_message_id, event, occurred_at, user_agent, tracking_service').eq('business_id', HL).order('id')),
    selectAllPages(() => svc.from('sales_email_messages').select('apollo_message_id, replied, reply_class').eq('business_id', HL).order('apollo_message_id')),
    selectAllPages(() => svc.from('microsoft_events').select('id, graph_id, ical_uid, external_domains, start_at, is_cancelled, created_at_graph').eq('business_id', HL).order('id')),
  ]);
  const at = new Map(delivered.map(d => [d.apollo_message_id, d.delivered_at]));
  const rep = new Map(messages.filter(m => m.replied).map(m => [m.apollo_message_id, m]));
  for (const key of ['yesterday', '7d', '30d']) {
    const { from, to } = windowRange(key, today);
    const inW = delivered.filter(d => d.delivered_day >= from && d.delivered_day <= to), ids = new Set(inW.map(d => d.apollo_message_id));
    const countsSum = counts.filter(c => c.day >= from && c.day <= to && c.day < today).reduce((n, c) => n + c.delivered, 0);
    const rowsBeforeToday = inW.filter(d => d.delivered_day < today).length;
    const opens = new Set(events.filter(e => e.event === 'open' && ids.has(e.apollo_message_id) && !isBotOpen(e, at.get(e.apollo_message_id))).map(e => e.apollo_message_id)).size;
    const clicks = new Set(events.filter(e => e.event === 'click' && ids.has(e.apollo_message_id) && !isAutomated(e, at.get(e.apollo_message_id), SCANNER_CLICK_WITHIN_SECONDS)).map(e => e.apollo_message_id)).size;
    const replies = inW.filter(d => rep.has(d.apollo_message_id) && !HEAT.excludedReplyClasses.includes(rep.get(d.apollo_message_id).reply_class)).length;
    const meetings = countExternalMeetings({ events: cal, weekStartMs: laStartOfDayMs(from), weekEndMs: laStartOfDayMs(addDays(to, 1)) }).booked;
    const raw = { delivered: inW.length, people_emailed: new Set(inW.map(d => d.contact_id)).size, human_opens: opens, human_clicks: clicks, replies, meetings };
    const r = W[key] || {};
    const got = { delivered: r.delivered, people_emailed: r.people_emailed, human_opens: r.human_opens, human_clicks: r.human_clicks, replies: r.replies, meetings: r.meetings };
    ok(`route vs raw ${key} (${from} → ${to}): route ${JSON.stringify(got)} · raw ${JSON.stringify(raw)} · counts table ${countsSum} for the fetched days = rows ${rowsBeforeToday}`, JSON.stringify(got) === JSON.stringify(raw) && countsSum === rowsBeforeToday);
    log(`   ${key}: companies ${r.companies_emailed} (${r.companies_no_record} without a record) · visited ${r.companies_visited} = ${pct(r.company_rate?.rate)} [${(r.companies_visited_names || []).join(', ')}] · people ${r.people_emailed} · identified ${r.people_identified} = ${pct(r.person_rate?.rate)}`);
  }
  ok('the route carries no address', !ADDRESS.test(JSON.stringify(route.body)));

  // ---- BUILDER = ROUTE = SCOUT, to the digit (the builder and Scout read loadFunnel with the service key - the same
  // function the route runs; the route's body above came through HTTP as Jack).
  const settings = await loadSettings(svc, HL);
  const window = dayWindowFor(today, { weekendOn: !!settings?.weekend_on });
  const members = await loadMembers(svc, HL);
  const [companies, overall, cumulative, trend, funnel] = await Promise.all([loadVisitorData(svc, HL, { window, members }), loadRankedBook(svc, HL, { now: Date.now(), members }), loadCumulative(svc, HL), visitorsTrend(svc, HL, {}).then(r => r.body), loadFunnel(svc, HL, { windows: FUNNEL_WINDOWS, custom: { from: window.days[0], to: window.days[window.days.length - 1] } }).then(r => r.body)]);
  const mail = buildVisitorEmail(companies, { date: today, window, overall, cumulative, trend, funnel, funnelTablesOn: true }); // the tables as built (F4); the switch ships off (FIX email-simplify-v1 E2)
  const r30 = W['30d'];
  const rateText = `${pct(r30.company_rate.rate)}</b></span> <span style="color:#6B7480">· ${r30.company_rate.n} of ${r30.company_rate.d} companies`;
  ok(`builder = route: ${mail.funnel} tables · the 30-day company rate "${pct(r30.company_rate.rate)} · ${r30.company_rate.n} of ${r30.company_rate.d} companies" is in the html and the text`, mail.funnel === 3 && mail.html.includes(rateText) && mail.text.includes(`${pct(r30.company_rate.rate)} (${r30.company_rate.n} of ${r30.company_rate.d})`));
  ok(`builder = route: delivered 7 d ${W['7d'].delivered} and 30 d ${r30.delivered} in the text part`, new RegExp(`delivered\\s+\\d+\\s+${W['7d'].delivered}\\s+${r30.delivered}`).test(mail.text));
  ok('the email: no address, no img / svg', !ADDRESS.test(mail.html + mail.text) && !/<img|<svg|<style|<script/i.test(mail.html));
  const intent = salesIntents.find(i => i.id === 'email_site');
  const scout = await intent.run(svc, { businessId: HL, now: Date.now() });
  const scout30 = scout.items.find(i => i.id === 'email_site:30d');
  ok(`Scout = route: "${scout30?.text?.slice(0, 160)}…"`, scout.read === 'goals/funnel?windows=yesterday,7d,30d' && scout30?.text?.includes(`company rate ${pct(r30.company_rate.rate)} = ${r30.company_rate.n} of ${r30.company_rate.d} companies emailed`) && scout30.text.includes(`person rate ${pct(r30.person_rate.rate)} = ${r30.person_rate.n} of ${r30.person_rate.d} people`) && scout30.text.includes(`of ${r30.delivered} emails delivered, so far: ${r30.human_opens} human opens · ${r30.human_clicks} clicks · ${r30.replies} replies · ${r30.meetings} meetings`));
  ok('Scout items carry no address', !ADDRESS.test(JSON.stringify(scout.items)));

  // ---- The series.
  const sides = {}; for (const row of route.body.series || []) sides[row.sides_present] = (sides[row.sides_present] || 0) + 1;
  ok(`series: ${route.body.series?.length} day rows · sides ${JSON.stringify(sides)} · every step <= delivered`, (route.body.series || []).every(row => ['human_opens', 'human_clicks', 'replies', 'companies_visited', 'people_identified'].every(k => row[k] <= Math.max(row.delivered, row.companies_emailed))));
  results.numbers.sides = sides;

  // ---- The email rendered at 640 and 390.
  const htmlPath = path.join(OUT, 'stage1-email.html');
  fs.writeFileSync(htmlPath, mail.html);
  fs.writeFileSync(path.join(OUT, 'stage1-email.txt'), mail.text);
  browser = await chromium.launch();
  for (const width of [640, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`file://${htmlPath}`);
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, tables: [...document.querySelectorAll('div')].filter(d => /^(Email funnel|Email → site|This week vs last week)$/.test(d.textContent.trim())).length }));
    await page.screenshot({ path: path.join(OUT, `stage1-email-${width}.png`), fullPage: true });
    ok(`email at ${width}: no sideways overflow (${m.sw} <= ${m.cw}) · 3 table headings (${m.tables})`, m.sw <= m.cw && m.tables === 3);
    await page.close();
  }
} catch (e) {
  if (!e.done) { results.errors.push(String(e.stack || e.message)); log('ERROR', e.message); }
} finally {
  await teardown();
  cleanup();
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, PROD_SEND ? 'stage1-prod-send.json' : 'stage1-report.json'), JSON.stringify({ ...results, when: new Date().toISOString() }, null, 2));
  console.log(`\nemail-funnel-v1 Stage 1 ${PROD_SEND ? 'PROD SEND' : 'live'}: ${passed}/${results.checks.length} passed · Claude 0 · Apollo 0 · writes ${PROD_SEND ? 1 : 0} · ${Math.round((Date.now() - T0) / 1000)} s`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
