// email-funnel-v1 Stage 2 + FIX email-simplify-v1 - LIVE as Jack (ownerSession) on the REAL HomeLover workspace,
// localhost against build/, 0 Apollo. READ-ONLY apart from the one declared Scout ask: every non-GET API call and every
// Supabase write from the browser is aborted at the network layer and counted; the server runs with the Apollo key empty.
//   ROUTE vs RAW: GET goals/funnel through the real wiring vs an independent re-count for yesterday / 7 d / 30 d.
//   BEFORE / AFTER: Pipeline › Web visitors (the Visitor report) and Dashboard › Home on prod (before) and on this build
//     (after) at 1440 and 390 - PNGs under .screenshots/email-funnel-v1/. After: the funnel section above the trend
//     chart, its cells = the route, the rate chart's points = the series, the Home tile = the route; N2; axe 0.
//   SETTINGS: Team emails at 1440 - the funnel switch (present once the migration has run; else absent, stated).
//   EMAIL: the visitor email built locally from the stored data BOTH ways (switch off = the default, and on), rendered
//     at 640 and 390 - PNGs, no sideways overflow; off = strip first, no funnel table in HTML or text.
//   SCOUT: ONE real POST /api/scout/ask "what's our email to site rate" (cap Claude 1) = the page's 30-day rate.
//   PROD_SEND=1: the ONE declared test send through PROD's test route - run once Render is Live on this commit.
// Declared scope: 1 owner session (released, last_seen_at restored) · 9 page loads (4 on prod, GET only) · ~70 GETs ·
// ~8 table reads (< 3k rows each) · 1 Claude call (~$0.01; its own business_anthropic_usage row, kept) · 0 Apollo ·
// 0 other writes (PROD_SEND=1: exactly ONE POST = 1 Graph send to the sending mailbox + 1 sales_team_email_sends row,
// kept) · ~200 s, cap 235 s.
// Usage: node scripts/verify/email-funnel-v1-stage2.mjs      PROD_SEND=1 node scripts/verify/email-funnel-v1-stage2.mjs
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
const AXE = fs.readFileSync(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const { selectAllPages } = await import('../../api/lib/selectAllPages.js');
const { laClock } = await import('../../api/sales/teamEmails/scheduler.js');
const { isBotOpen, isAutomated, HEAT } = await import('../../api/sales/heatScore.js');
const { SCANNER_CLICK_WITHIN_SECONDS } = await import('../../api/sales/nextBestAction.js');
const { countExternalMeetings } = await import('../../api/sales/scorecardMath.js');
const { laStartOfDayMs, addDays } = await import('../../api/sales/goalsShared.js');
const { windowRange } = await import('../../api/sales/funnelMath.js');
const OUT = path.join(ROOT, '.screenshots', 'email-funnel-v1');
const PORT = 3997, BASE = `http://localhost:${PORT}`, PROD = 'https://prospector-chtj.onrender.com';
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data?.[0]?.id;
if (!HL) throw new Error('no HomeLover business');
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
const PROD_SEND = process.env.PROD_SEND === '1';
const ADDRESS = /[^\s@<>()"',;=&#]+@[^\s@<>()"',;=&#]+\.[a-z]{2,}/i;
const ASK = "what's our email to site rate";
const pct = x => (x == null ? '—' : `${(100 * x).toFixed(1)} %`);
let srv, browser, owner, claudeSent = 0;
const blocked = [], realCalls = [], writes = [];
const results = { checks: [], errors: [], axe: {}, numbers: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 400)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 235000 });
fs.mkdirSync(OUT, { recursive: true });
const sendsCount = async () => (await svc.from('sales_team_email_sends').select('*', { count: 'exact', head: true }).eq('business_id', HL)).count;
const usageCount = async () => (await svc.from('business_anthropic_usage').select('*', { count: 'exact', head: true }).eq('business_id', HL)).count;

try {
  owner = await ownerSession(svc);
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const api = async (base, p, init = {}) => { const r = await fetch(`${base}/api/sales/${HL}${p}`, { ...init, headers: { cookie, 'content-type': 'application/json', ...(init.headers || {}) } }); return { status: r.status, body: await r.json().catch(() => null) }; };

  if (PROD_SEND) {
    const before = await sendsCount();
    const r = await api(PROD, '/goals/team-emails/test', { method: 'POST', body: JSON.stringify({ kind: 'visitor' }) });
    const after = await sendsCount();
    results.numbers.send = r.body;
    ok(`PROD test send: HTTP ${r.status} · status ${r.body?.status} · recipients ${r.body?.recipients} · subject "${r.body?.subject}" · rows ${r.body?.rows} · new_rows ${r.body?.new_rows} · strip ${r.body?.strip} windows · funnel tables ${r.body?.funnel} · sales_team_email_sends ${before} -> ${after}`, r.status === 200 && r.body?.status === 'sent' && r.body?.recipients === 1 && after === before + 1 && r.body?.strip >= 1 && r.body?.funnel === 0 && typeof r.body?.subject === 'string');
    ok('the reply carries no address', !ADDRESS.test(JSON.stringify(r.body || {})));
    throw Object.assign(new Error('done'), { done: true });
  }

  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', APOLLO_API_KEY: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const today = laClock().date;
  const usageBefore = await usageCount();

  // ---- ROUTE vs RAW for the three windows.
  const route = await api(BASE, '/goals/funnel?windows=yesterday,7d,30d,this_week,last_week&days=30');
  const F = route.body || {}, W = F.windows || {};
  ok(`GET goals/funnel: HTTP ${route.status} · ready ${F.ready} · series ${F.series?.length} days · step_words ${Object.keys(F.step_words || {}).length}`, route.status === 200 && F.ready === true && Object.keys(F.step_words || {}).length === F.steps?.length);
  const [delivered, events, messages, cal] = await Promise.all([
    selectAllPages(() => svc.from('sales_email_delivered').select('apollo_message_id, contact_id, delivered_at, delivered_day').eq('business_id', HL).order('apollo_message_id')),
    selectAllPages(() => svc.from('sales_email_activity').select('id, apollo_message_id, event, occurred_at, user_agent, tracking_service').eq('business_id', HL).order('id')),
    selectAllPages(() => svc.from('sales_email_messages').select('apollo_message_id, replied, reply_class').eq('business_id', HL).order('apollo_message_id')),
    selectAllPages(() => svc.from('microsoft_events').select('id, graph_id, ical_uid, external_domains, start_at, is_cancelled, created_at_graph').eq('business_id', HL).order('id')),
  ]);
  const at = new Map(delivered.map(d => [d.apollo_message_id, d.delivered_at]));
  const rep = new Map(messages.filter(m => m.replied).map(m => [m.apollo_message_id, m]));
  for (const key of ['yesterday', '7d', '30d']) {
    const { from, to } = windowRange(key, today);
    const inW = delivered.filter(d => d.delivered_day >= from && d.delivered_day <= to), ids = new Set(inW.map(d => d.apollo_message_id));
    const raw = {
      delivered: inW.length, people_emailed: new Set(inW.map(d => d.contact_id)).size,
      human_opens: new Set(events.filter(e => e.event === 'open' && ids.has(e.apollo_message_id) && !isBotOpen(e, at.get(e.apollo_message_id))).map(e => e.apollo_message_id)).size,
      human_clicks: new Set(events.filter(e => e.event === 'click' && ids.has(e.apollo_message_id) && !isAutomated(e, at.get(e.apollo_message_id), SCANNER_CLICK_WITHIN_SECONDS)).map(e => e.apollo_message_id)).size,
      replies: inW.filter(d => rep.has(d.apollo_message_id) && !HEAT.excludedReplyClasses.includes(rep.get(d.apollo_message_id).reply_class)).length,
      meetings: countExternalMeetings({ events: cal, weekStartMs: laStartOfDayMs(from), weekEndMs: laStartOfDayMs(addDays(to, 1)) }).booked,
    };
    const r = W[key] || {};
    const got = Object.fromEntries(Object.keys(raw).map(k => [k, r[k]]));
    ok(`route vs raw ${key} (${from} → ${to}): route ${JSON.stringify(got)} · raw ${JSON.stringify(raw)} · company rate ${pct(r.company_rate?.rate)} (${r.company_rate?.n} of ${r.company_rate?.d}) · person rate ${pct(r.person_rate?.rate)} (${r.person_rate?.n} of ${r.person_rate?.d})`, JSON.stringify(got) === JSON.stringify(raw));
  }
  results.numbers.windows = Object.fromEntries(Object.entries(W).map(([k, w]) => [k, { from: w.from, to: w.to, delivered: w.delivered, company_rate: w.company_rate, person_rate: w.person_rate }]));
  ok('the route carries no address', !ADDRESS.test(JSON.stringify(F)));
  const te = await api(BASE, '/goals/team-emails');
  const hasSwitch = 'funnel_tables' in (te.body || {});
  ok(`team-emails state: funnel_tables ${hasSwitch ? te.body.funnel_tables : '(absent - migration 20261111_email_simplify_v1.sql not run yet; the email builds with the tables off)'}`, te.status === 200 && (!hasSwitch || te.body.funnel_tables === false));
  results.numbers.switch = hasSwitch ? te.body.funnel_tables : 'migration pending';

  // ---- Browser.
  browser = await chromium.launch();
  async function open(width, base, where) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 }, hasTouch: width < 900 });
    await ctx.addInitScript(([k, v, bz, dd]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      localStorage.setItem('prospector_goals_owner', 'team');
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, dd);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today]);
    const host = new URL(base).host;
    await ctx.route('**/*', async r => {
      const req = r.request(); const u = new URL(req.url());
      if (u.protocol === 'file:' || u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isApp = u.host === host, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      const apiWrite = isApp && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname);
      if (apiWrite) writes.push(`${req.method()} ${u.pathname}`);
      const deny = apiWrite || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isApp && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.pathname}`); return r.abort(); }
      return r.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(25000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    await page.goto(`${base}/?tab=${where === 'settings' ? 'settings&view=team-emails' : where === 'home' ? 'dashboard' : 'pipeline&view=companies&channel=website_visit'}`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 25000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    const tabs = page.locator('#workspace-header-tabs, [data-sales-tabrow]');
    if (where === 'settings') {
      await tabs.getByRole('button', { name: /^Settings/ }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
      await page.locator('[data-team-emails]').waitFor({ timeout: 30000 }); await page.waitForTimeout(1500);
    } else if (where === 'home') {
      await tabs.getByRole('button', { name: /^Dashboard/ }).first().dispatchEvent('click'); await page.waitForTimeout(1500);
      await page.locator('[data-home]').waitFor({ timeout: 30000 }); await page.locator('[data-pulse-tile="sent"]').waitFor({ timeout: 30000 }); await page.waitForTimeout(2500);
    } else {
      await tabs.getByRole('button', { name: /^Pipeline/ }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
      await page.locator('[data-sales-subviews]').getByRole('tab', { name: 'Companies', exact: true }).dispatchEvent('click'); await page.waitForTimeout(1500);
      await page.locator('[data-pipeline-companies] [data-channel="website"]').waitFor({ timeout: 30000 });
      await page.locator('[data-pipeline-companies] [data-channel="website"]').dispatchEvent('click'); await page.waitForTimeout(800);
      await page.getByRole('button', { name: 'Visitor report' }).first().dispatchEvent('click'); await page.waitForTimeout(1000);
      await page.locator('aside[aria-label="Website visitors"] [data-visitor-report]').waitFor({ timeout: 30000 }); await page.waitForTimeout(3000);
    }
    return { ctx, page, errors };
  }
  const axeOn = async (page, sel, key) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async s => { const r = await window.axe.run(document.querySelector(s) || document, { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); }, sel);
    results.axe[key] = v;
    ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v).slice(0, 300));
  };
  const measure = page => page.evaluate(() => {
    const aside = document.querySelector('aside[aria-label="Website visitors"]');
    const card = aside?.querySelector('[data-email-funnel]');
    const cells = (table, row) => [...(card?.querySelectorAll(`[data-funnel-table="${table}"] [data-row="${row}"] td`) || [])].map(td => td.textContent);
    return {
      has: !!card, tables: card?.querySelectorAll('[data-funnel-table]').length || 0,
      delivered: cells('steps', 'delivered'), visited: cells('steps', 'companies_visited'), company: cells('rates', 'company_rate'), person: cells('rates', 'person_rate'), week: cells('week', 'delivered'),
      how: [...(card?.querySelectorAll('[data-how]') || [])].map(e => e.textContent), since: card?.querySelector('[data-funnel-since]')?.textContent || '',
      points: [...(card?.querySelectorAll('[data-rate-point]') || [])].map(p => [p.dataset.ratePoint, Number(p.dataset.rate)]), days: Number(card?.querySelector('[data-rate-chart]')?.dataset.points || 0),
      order: [...(aside?.querySelectorAll('[data-visitor-report] > section') || [])].map(s => s.getAttribute('aria-label')).slice(0, 4),
      sideways: document.documentElement.scrollWidth > window.innerWidth + 1, cardFits: card ? card.scrollWidth <= card.clientWidth + 1 : null,
      overflow: [...(card?.querySelectorAll('[data-funnel-table]') || [])].filter(t => t.scrollWidth > t.clientWidth + 1).length,
    };
  });
  const tileOf = page => page.evaluate(() => { const t = document.querySelector('[data-pulse-tile="email_site"]'); return { has: !!t, tiles: document.querySelectorAll('[data-pulse-tile]').length, label: t?.querySelector('span')?.textContent || '', value: t?.querySelector('[data-value]')?.textContent || '', delta: t?.querySelector('[data-delta]')?.textContent || '', sideways: document.documentElement.scrollWidth > window.innerWidth + 1 }; });

  // ---- BEFORE (prod, GET only).
  for (const width of [1440, 390]) {
    for (const where of ['visitors', 'home']) {
      try {
        const { ctx, page } = await open(width, PROD, where);
        const had = where === 'home' ? (await tileOf(page)).has : (await measure(page)).has;
        await page.screenshot({ path: `${OUT}/stage2-before-${where}-${width}.png`, animations: 'disabled' });
        ok(`before ${where}@${width} (prod): loaded, the new ${where === 'home' ? 'tile' : 'funnel section'} ${had ? 'present' : 'absent'}`, !had);
        await ctx.close();
      } catch (e) { ok(`before ${where}@${width} (prod) loaded`, false, e.message); }
    }
  }

  // ---- AFTER: Web visitors.
  const cols = [W.yesterday, W['7d'], W['30d']];
  const expectPoints = (F.series || []).filter(r => r.companies_emailed > 0).map(r => [r.day, r.companies_visited / r.companies_emailed]);
  for (const width of [1440, 390]) {
    const { ctx, page, errors } = await open(width, BASE, 'visitors');
    const m = await measure(page);
    await page.locator('[data-email-funnel]').scrollIntoViewIfNeeded(); await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/stage2-after-visitors-${width}.png`, animations: 'disabled' });
    ok(`after visitors@${width}: ${m.tables} tables · order ${m.order.join(' · ')} · errors ${errors.length}`, m.has && m.tables === 3 && m.order[1] === 'Email to site funnel' && m.order[2] === 'Visitors, last 30 days' && errors.length === 0);
    ok(`tables = route @${width}: delivered ${m.delivered.join(' | ')} · company rate ${m.company.join(' | ')} · person rate ${m.person.join(' | ')}`,
      JSON.stringify(m.delivered) === JSON.stringify(cols.map(w => w.delivered.toLocaleString('en-US')))
      && JSON.stringify(m.company) === JSON.stringify(cols.map(w => `${pct(w.company_rate.rate)}· ${w.company_rate.n} of ${w.company_rate.d} companies`))
      && JSON.stringify(m.person) === JSON.stringify(cols.map(w => `${pct(w.person_rate.rate)}· ${w.person_rate.n} of ${w.person_rate.d} people`))
      && JSON.stringify(m.visited) === JSON.stringify(cols.map(w => `${w.companies_visited}· ${pct(w.delivered ? w.companies_visited / w.delivered : null)}`))
      && m.week[0] === String(W.this_week.delivered) && m.week[1] === String(W.last_week.delivered));
    ok(`words = route @${width}: how-it's-computed ×${m.how.length} · "${m.since}"`, m.how.length === 2 && m.how[0] === F.wording.company && m.how[1] === F.wording.person && m.since === F.wording.since);
    ok(`rate line = series @${width}: ${m.points.length} points over ${m.days} day rows (series ${F.series.length}, ${expectPoints.length} with a company emailed)`, m.days === F.series.length && m.points.length === expectPoints.length && m.points.every((p, i) => p[0] === expectPoints[i][0] && Math.abs(p[1] - expectPoints[i][1]) < 1e-9));
    ok(`N2@${width}: no sideways scroll (${!m.sideways}) · the section fits its card (${m.cardFits}) · tables overflowing ${m.overflow}`, !m.sideways && m.cardFits && m.overflow === 0);
    if (width === 1440) {
      const lastDay = expectPoints[expectPoints.length - 1]?.[0];
      await page.locator(`[data-rate-day="${lastDay}"]`).hover({ force: true }); await page.waitForTimeout(300);
      const hv = await page.locator('[data-rate-hover]').textContent();
      const row = F.series.find(r => r.day === lastDay);
      ok(`rate hover on ${lastDay}: "${hv}"`, hv.includes(`${pct(row.companies_visited / row.companies_emailed)} · ${row.companies_visited} of ${row.companies_emailed} companies`));
      await page.screenshot({ path: `${OUT}/stage2-after-visitors-1440-hover.png`, animations: 'disabled' });
    }
    await axeOn(page, '[data-visitor-report]', `visitors@${width}`);
    await ctx.close();
  }

  // ---- AFTER: Home tile.
  const r30 = W['30d'].company_rate;
  for (const width of [1440, 390]) {
    const { ctx, page, errors } = await open(width, BASE, 'home');
    await page.locator('[data-pulse-tile="email_site"]').waitFor({ timeout: 20000 }).catch(() => {});
    const t = await tileOf(page);
    await page.screenshot({ path: `${OUT}/stage2-after-home-${width}.png`, animations: 'disabled' });
    ok(`tile = route @${width}: "${t.label}" ${t.value} · ${t.delta} · ${t.tiles} tiles · sideways ${t.sideways} · errors ${errors.length}`, t.has && t.label === 'Email → site (30 d)' && t.value === `${(r30.rate * 100).toFixed(1)}%` && t.delta.startsWith(`${r30.n} of ${r30.d} companies`) && t.tiles === 8 && !t.sideways && errors.length === 0);
    await axeOn(page, '[data-pulse]', `home@${width}`);
    await ctx.close();
  }

  // ---- SETTINGS 1440.
  {
    const { ctx, page, errors } = await open(1440, BASE, 'settings');
    const s = await page.evaluate(() => ({ row: document.querySelector('[data-funnel-row]')?.textContent || null, checked: document.querySelector('input[aria-label="Show the email funnel tables"]')?.checked ?? null }));
    await page.screenshot({ path: `${OUT}/stage2-after-settings-1440.png`, animations: 'disabled' });
    ok(`settings: ${hasSwitch ? `the switch "${s.row?.slice(0, 110)}" checked ${s.checked}` : 'no switch drawn (migration pending)'} · errors ${errors.length}`, errors.length === 0 && (hasSwitch ? s.checked === false && s.row.includes('Show the email funnel tables (delivered → visits → replies)') && s.row.includes('on when the delivered history is complete') : s.row === null));
    await axeOn(page, '[data-team-emails]', 'settings@1440');
    await ctx.close();
  }

  // ---- EMAIL both ways, 640 / 390.
  {
    const { loadVisitorData, loadRankedBook, loadCumulative, buildVisitorEmail, dayWindowFor, FUNNEL_WINDOWS } = await import('../../api/sales/teamEmails/visitorEmail.js');
    const { loadMembers, loadSettings } = await import('../../api/sales/teamEmails/send.js');
    const { visitorsTrend } = await import('../../api/sales/visitTrend.js');
    const { loadFunnel } = await import('../../api/sales/funnelRoutes.js');
    const settings = await loadSettings(svc, HL);
    const members = await loadMembers(svc, HL);
    const window = dayWindowFor(today, { weekendOn: !!settings.weekend_on });
    const [companies, overall, cumulative, trend, funnel] = await Promise.all([loadVisitorData(svc, HL, { window, members }), loadRankedBook(svc, HL, { members }), loadCumulative(svc, HL), visitorsTrend(svc, HL, {}).then(r => r.body), loadFunnel(svc, HL, { windows: FUNNEL_WINDOWS, custom: { from: window.days[0], to: window.days[window.days.length - 1] } }).then(r => r.body)]);
    const off = buildVisitorEmail(companies, { date: today, window, overall, cumulative, trend, funnel });
    const on = buildVisitorEmail(companies, { date: today, window, overall, cumulative, trend, funnel, funnelTablesOn: true });
    results.numbers.email = { subject: off.subject, visited: off.visited, new: off.new, returning: off.returning, qualified: off.qualified, strip: off.strip, funnel_off: off.funnel, funnel_on: on.funnel, settings_funnel_tables: settings.funnel_tables ?? null, pending: !!settings.funnel_tables_pending };
    const iStrip = h => h.indexOf('Companies identified · last'), iTiles = h => h.indexOf('companies on the site'), iFunnel = h => h.indexOf('>Email funnel<');
    ok(`email OFF (the default): subject "${off.subject}" · visited ${off.visited} · new ${off.new} · strip ${off.strip} · funnel tables ${off.funnel} · the strip sits under the subhead, above the tiles · caption present`, off.funnel === 0 && off.strip >= 1 && iFunnel(off.html) === -1 && !/EMAIL FUNNEL|EMAIL → SITE/.test(off.text) && iStrip(off.html) > off.html.indexOf('Open the Map →') && iStrip(off.html) < iTiles(off.html) && off.html.includes('Companies identified per day · new / returning ·') && off.text.indexOf('COMPANIES IDENTIFIED') < off.text.indexOf(' visited · '));
    ok(`email ON: funnel tables ${on.funnel} · order strip < tables < tiles · same subject`, on.funnel === 3 && iStrip(on.html) < iFunnel(on.html) && iFunnel(on.html) < iTiles(on.html) && on.text.indexOf('COMPANIES IDENTIFIED') < on.text.indexOf('EMAIL FUNNEL') && on.subject === off.subject);
    ok('both emails: no address, no img / svg', !ADDRESS.test(off.html + off.text + on.html + on.text) && !/<img|<svg|<style|<script/i.test(off.html + on.html));
    for (const [name, mail] of [['off', off], ['on', on]]) for (const width of [640, 390]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      await ctx.route('**/*', r => (new URL(r.request().url()).protocol === 'data:' || r.request().url() === 'about:blank' ? r.continue() : r.abort()));
      const page = await ctx.newPage();
      await page.setContent(mail.html, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(400);
      const e = await page.evaluate(() => ({ sideways: document.documentElement.scrollWidth > window.innerWidth + 1, strip: document.body.textContent.includes('Companies identified · last'), funnel: document.body.textContent.includes('Email funnel') }));
      await page.screenshot({ path: `${OUT}/stage2-email-${name}-${width}.png`, animations: 'disabled', fullPage: true });
      ok(`email ${name}@${width}: strip ${e.strip} · funnel tables ${e.funnel} · sideways ${e.sideways}`, e.strip && e.funnel === (name === 'on') && !e.sideways);
      await ctx.close();
    }
  }

  // ---- ONE real Scout ask through the real wiring.
  const startIso = new Date().toISOString();
  claudeSent += 1;
  const t2 = Date.now();
  const ar = await fetch(`${BASE}/api/scout/ask`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ q: ASK, scope: HL }) });
  const ab = await ar.json().catch(() => ({}));
  const usageRow = (await svc.from('business_anthropic_usage').select('input_tokens, output_tokens, cost_usd').eq('business_id', HL).gte('created_at', startIso).order('created_at', { ascending: false }).limit(1)).data?.[0] || null;
  const answer = String(ab.answer_md || '');
  results.numbers.scout = { status: ar.status, intent: ab.context_stats?.intent, answer, cost_usd: usageRow?.cost_usd ?? null, tokens: usageRow ? [usageRow.input_tokens, usageRow.output_tokens] : null, elapsed_s: Math.round((Date.now() - t2) / 100) / 10 };
  const rateWord = (r30.rate * 100).toFixed(1);
  ok(`Scout "${ASK}" -> ${ar.status} in ${results.numbers.scout.elapsed_s} s · intent ${ab.context_stats?.intent} · $${usageRow?.cost_usd} (${usageRow?.input_tokens}/${usageRow?.output_tokens} tokens) · the page's 30-day rate ${rateWord} % = ${r30.n} of ${r30.d} · answer: ${answer.replace(/\s+/g, ' ').slice(0, 260)}`, ar.status === 200 && ab.context_stats?.intent === 'email_site' && new RegExp(`${rateWord.replace('.', '\\.')}\\s?%`).test(answer) && new RegExp(`\\b${r30.n} of ${r30.d}\\b`).test(answer) && !ADDRESS.test(JSON.stringify(ab)));
  const usageAfter = await usageCount();
  ok(`Claude calls ${claudeSent} (cap 1); HomeLover usage rows ${usageBefore} -> ${usageAfter}; Apollo 0 (no key on the server, browser calls ${realCalls.length}); browser API writes attempted ${writes.length} (all aborted)`, usageAfter - usageBefore === claudeSent && realCalls.length === 0);
} catch (e) {
  if (!e.done) { results.errors.push(e.stack || e.message); log('ERROR', e.message); }
} finally {
  await cleanup();
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, PROD_SEND ? 'stage2-prod-send.json' : 'stage2-report.json'), JSON.stringify({ ...results, blocked, writes, when: new Date().toISOString() }, null, 2));
  console.log(`\nemail-funnel-v1 Stage 2 ${PROD_SEND ? 'PROD SEND' : 'live'}: ${passed}/${results.checks.length} passed · Claude ${claudeSent} · Apollo ${realCalls.length} · API writes ${PROD_SEND ? 1 : 0} (${writes.length} aborted from the browser) · ${Math.round((Date.now() - T0) / 1000)} s`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
