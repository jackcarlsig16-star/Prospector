// visitor-trend-v1 Stage 2 - LIVE as Jack (ownerSession) on the REAL HomeLover workspace, localhost against build/,
// 0 Apollo, 0 Claude. READ-ONLY: every non-GET API call and every Supabase write from the browser is aborted at the
// network layer and counted; the server runs with the Claude and Apollo keys empty.
//   BEFORE / AFTER: Pipeline › Companies › Website visitors › Visitor report on prod (before) and on this build (after)
//     at 1440 and 390 - PNGs under .screenshots/visitor-trend-v1/; after = the 30-day chart (bars = the route's windows,
//     the summary line, the legend counts, hover, a bar click -> the Companies list filtered by ?window=), N2 (no
//     sideways scroll, the card fits), axe 0 on the report ([data-visitor-report] - the shared SidePanel's nested <aside>
//     landmark is a pre-existing axe note outside this stage); 390 = 14 bars in view, swipe for the rest.
//   SETTINGS: Team emails at 1440 - the weekend switch OFF with the measured copy; GET team-emails weekend_on false; the
//     DB row weekend_on false.
//   ROUTE vs RAW: GET goals/visitors/trend through the real wiring vs an independent re-count from web_visits for 3
//     windows (companies, new, returning, 7-day visits).
//   EMAIL: the visitor email built locally from the stored data (the builder + the trend), rendered at 640 and 390 -
//     PNGs, no sideways overflow, the 7-window strip with % widths only; subject + counts reported, never an address.
//   PROD_SEND=1: the ONE declared test send through PROD's test route (the local server has no Microsoft keys) - run
//     once Render is Live on this commit; prints status + counts and the sends-table count before / after.
// Declared scope: 1 owner session (released, last_seen_at restored) · 5 page loads (2 on prod, GET only) · ~40 GETs ·
// ~6 table reads (< 2k rows each) · 0 writes (PROD_SEND=1: exactly ONE POST = 1 Graph send to the sending mailbox +
// 1 sales_team_email_sends row, the send's own log, kept) · ~150 s, cap 235 s.
// Usage: node scripts/verify/visitor-trend-v1-stage2.mjs      PROD_SEND=1 node scripts/verify/visitor-trend-v1-stage2.mjs
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
const { seenBeforeKeys } = await import('../../api/sales/visitRules.js');
const { laClock } = await import('../../api/sales/teamEmails/scheduler.js');
const OUT = path.join(ROOT, '.screenshots', 'visitor-trend-v1');
const PORT = 3996, BASE = `http://localhost:${PORT}`, PROD = 'https://prospector-chtj.onrender.com';
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
let srv, browser, owner;
const blocked = [], realCalls = [], writes = [];
const results = { checks: [], errors: [], axe: {}, numbers: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 400)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 235000 });
fs.mkdirSync(OUT, { recursive: true });
const sendsCount = async () => (await svc.from('sales_team_email_sends').select('*', { count: 'exact', head: true }).eq('business_id', HL)).count;

try {
  owner = await ownerSession(svc);
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const api = async (base, p, init = {}) => { const r = await fetch(`${base}/api/sales/${HL}${p}`, { ...init, headers: { cookie, 'content-type': 'application/json', ...(init.headers || {}) } }); return { status: r.status, body: await r.json().catch(() => null) }; };

  if (PROD_SEND) {
    // ---- The ONE declared test send, through prod's real wiring (sendTest -> visitorEmailJob test:true -> the sending mailbox only).
    const before = await sendsCount();
    const r = await api(PROD, '/goals/team-emails/test', { method: 'POST', body: JSON.stringify({ kind: 'visitor' }) });
    const after = await sendsCount();
    ok(`PROD test send: HTTP ${r.status} · status ${r.body?.status} · recipients ${r.body?.recipients} · rows ${r.body?.rows} · new_rows ${r.body?.new_rows} · sales_team_email_sends ${before} -> ${after}`, r.status === 200 && r.body?.status === 'sent' && after === before + 1);
    ok('the reply carries no address', !ADDRESS.test(JSON.stringify(r.body || {})));
    throw Object.assign(new Error('done'), { done: true });
  }

  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', ANTHROPIC_API_KEY: '', APOLLO_API_KEY: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const today = laClock().date;

  // ---- ROUTE vs RAW: the trend through the real wiring against an independent re-count from web_visits.
  const trend = await api(BASE, '/goals/visitors/trend?days=30');
  ok(`GET goals/visitors/trend: HTTP ${trend.status} · ${trend.body?.windows?.length} windows · since ${trend.body?.since} · summary ${JSON.stringify(trend.body?.summary)}`, trend.status === 200 && trend.body?.windows?.length > 0);
  results.numbers.trend = trend.body?.summary;
  const rows = await selectAllPages(() => svc.from('web_visits').select('id, company_key, pulled_on, seen_from, seen_to, visits_7d, matched_type, matched_id').eq('business_id', HL).order('id'));
  const candidates = (trend.body?.windows || []).filter(w => w.merged === 1).slice(-3);
  for (const w of candidates) {
    const mine = rows.filter(r => r.pulled_on === w.pulled_on && r.seen_from === w.start && r.seen_to === w.end);
    const latest = new Map();
    for (const r of mine) { const c = latest.get(r.company_key); if (!c || r.seen_to > c.seen_to || (r.seen_to === c.seen_to && String(r.id) > String(c.id))) latest.set(r.company_key, r); }
    const keys = [...latest.keys()];
    const seen = seenBeforeKeys(rows, w.start);
    const fresh = keys.filter(k => !seen.has(k)).length;
    const visits = [...latest.values()].reduce((n, r) => n + (r.visits_7d || 0), 0);
    const raw = { companies: keys.length, new: fresh, returning: keys.length - fresh, visits_7d: visits };
    const route = { companies: w.companies, new: w.new, returning: w.returning, visits_7d: w.visits_7d };
    ok(`route vs raw ${w.label}: route ${JSON.stringify(route)} · raw ${JSON.stringify(raw)}`, JSON.stringify(route) === JSON.stringify(raw));
  }
  ok(`3 windows compared (${candidates.length})`, candidates.length === 3);
  ok('the trend carries no name and no address', !/company_name|@/.test(JSON.stringify(trend.body)));

  // ---- SETTINGS reads OFF.
  const te = await api(BASE, '/goals/team-emails');
  const dbRow = (await svc.from('sales_team_email_settings').select('weekend_on').eq('business_id', HL).maybeSingle()).data;
  ok(`team-emails: weekend_on ${te.body?.weekend_on} (DB ${dbRow?.weekend_on}) · pull_runs_month ${JSON.stringify(te.body?.pull_runs_month)}`, te.status === 200 && te.body?.weekend_on === false && dbRow?.weekend_on === false && te.body?.pull_runs_month?.month === today.slice(0, 7));
  results.numbers.pull_runs_month = te.body?.pull_runs_month;

  // ---- Browser.
  browser = await chromium.launch();
  async function open(width, base, { settings = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 }, hasTouch: width < 900 });
    await ctx.addInitScript(([k, v, bz, dd]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      localStorage.setItem('prospector_goals_owner', 'team');
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, dd);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today]);
    const host = new URL(base).host;
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (u.protocol === 'file:' || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isApp = u.host === host, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      const apiWrite = isApp && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname);
      if (apiWrite) writes.push(`${req.method()} ${u.pathname}`);
      const deny = apiWrite || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isApp && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.pathname}`); return route.abort(); }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(25000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    await page.goto(`${base}/?tab=${settings ? 'settings&view=team-emails' : 'pipeline&view=companies&channel=website_visit'}`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 25000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    if (settings) {
      await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: /^Settings/ }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
      await page.locator('[data-team-emails]').waitFor({ timeout: 30000 }); await page.waitForTimeout(1500);
      return { ctx, page, errors };
    }
    await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: /^Pipeline/ }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
    await page.locator('[data-sales-subviews]').getByRole('tab', { name: 'Companies', exact: true }).dispatchEvent('click'); await page.waitForTimeout(1500);
    await page.locator('[data-pipeline-companies] [data-channel="website"]').waitFor({ timeout: 30000 });
    await page.locator('[data-pipeline-companies] [data-channel="website"]').dispatchEvent('click'); await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Visitor report' }).first().dispatchEvent('click'); await page.waitForTimeout(1000);
    await page.locator('aside[aria-label="Website visitors"] [data-visitor-report]').waitFor({ timeout: 30000 }); await page.waitForTimeout(2500);
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
    const card = aside?.querySelector('[data-visitor-trend]');
    const plot = card?.querySelector('[data-trend-plot]');
    return {
      hasChart: !!card, bars: Number(card?.dataset.bars || 0), newRects: card?.querySelectorAll('rect[data-col="new"]').length || 0, retRects: card?.querySelectorAll('rect[data-col="returning"]').length || 0,
      line: !!card?.querySelector('[data-line="visits_7d"] path'), summary: card?.querySelector('[data-trend-summary]')?.textContent || '', legend: card?.querySelector('[data-trend-legend]')?.textContent || '',
      plotWidth: plot?.style.width || '', swipe: !!card?.querySelector('[role="region"][aria-label^="Chart (swipe"]'),
      sideways: document.documentElement.scrollWidth > window.innerWidth + 1, cardFits: card ? card.scrollWidth <= card.clientWidth + 1 : null,
      order: [...(aside?.querySelectorAll('[data-visitor-report] > section') || [])].map(s => s.getAttribute('aria-label')).slice(0, 3),
      axisLabels: [...(card?.querySelectorAll('svg > text') || [])].map(t => t.textContent).filter(t => /^[A-Z][a-z]{2}/.test(t)),
    };
  });

  // ---- BEFORE (prod, GET only) at 1440 + 390.
  for (const width of [1440, 390]) {
    try {
      const { ctx, page, errors } = await open(width, PROD);
      const m = await measure(page);
      if (width === 390) { await page.locator('[data-visitor-report] section[aria-label="Hot"]').scrollIntoViewIfNeeded().catch(() => {}); await page.waitForTimeout(300); }
      await page.screenshot({ path: `${OUT}/before-visitors-${width}.png`, animations: 'disabled' });
      ok(`before@${width} (prod): report open, chart ${m.hasChart ? 'present' : 'absent'} · errors ${errors.length}`, !m.hasChart);
      await ctx.close();
    } catch (e) { ok(`before@${width} (prod) loaded`, false, e.message); }
  }

  // ---- AFTER 1440: the chart, hover, N2, axe, then a bar click -> the filtered list.
  {
    const { ctx, page, errors } = await open(1440, BASE);
    const m = await measure(page);
    const W = trend.body.windows;
    await page.screenshot({ path: `${OUT}/after-visitors-1440.png`, animations: 'disabled' });
    ok(`after@1440: bars ${m.bars} = route windows ${W.length} · rects new ${m.newRects} / returning ${m.retRects} · line ${m.line} · errors ${errors.length}`, m.bars === W.length && m.newRects === W.length && m.retRects === W.length && m.line && errors.length === 0);
    ok(`summary line: "${m.summary}"`, m.summary.includes(`${trend.body.summary.companies} companies identified`) && m.summary.includes(`${trend.body.summary.new} new`) && m.summary.includes(`busiest: ${trend.body.summary.busiest.label} (${trend.body.summary.busiest.companies})`));
    ok(`legend counts: "${m.legend.slice(0, 120)}"`, m.legend.includes(`New ${trend.body.summary.new}`) && m.legend.includes(`Returning ${trend.body.summary.returning}`) && m.legend.includes(`rolling count ${trend.body.summary.visits_7d.toLocaleString('en-US')}`));
    ok(`order: summary · chart · Hot (${m.order.join(' · ')})`, m.order[0] === 'Website visitors summary' && m.order[1] === 'Visitors, last 30 days' && m.order[2] === 'Hot');
    ok(`N2@1440: no sideways scroll (${!m.sideways}), the chart fits its card (${m.cardFits})`, !m.sideways && m.cardFits);
    await axeOn(page, '[data-visitor-report]', 'visitors@1440');
    const svg = page.locator('[data-visitor-trend] svg');
    await svg.scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
    const box = await svg.boundingBox();
    // The chart's viewBox is 1340 wide with a 44 px left / 48 px right pad (explorerModel GEOM): a bar's center in page
    // pixels is the plot's share of the box, not the box's - a pointer in the pad reads as "no bar" and clears the hover.
    const last = W.length - 1, VB = 1340, PAD_L = 44, PLOT = VB - PAD_L - 48;
    const barX = i => box.x + box.width * ((PAD_L + (i + 0.5) * (PLOT / W.length)) / VB);
    await page.evaluate(() => { window.__ev = []; for (const t of ['mousemove', 'mousedown', 'mouseup', 'click']) document.addEventListener(t, e => window.__ev.push(`${t}:${e.target.tagName}@${e.clientX},${e.clientY}`), true); });
    const events = () => page.evaluate(() => { const l = window.__ev.slice(0, 6).join(' | '); window.__ev.length = 0; return l; });
    // A pointer path like a hand's (several mousemoves, then press / release): a single synthetic jump never opens the card.
    const tx = barX(last), ty = box.y + box.height / 2;
    await page.mouse.move(tx - 12, ty + 4); await page.mouse.move(tx, ty, { steps: 8 }); await page.waitForTimeout(500);
    const hover = await page.locator('[data-trend-hover]').textContent({ timeout: 3000 }).catch(() => '');
    ok(`hover on the last bar: "${hover.slice(0, 160)}" (events ${await events()})`, hover.includes(W[last].label) && hover.includes(`${W[last].companies} (${W[last].new} new · ${W[last].returning} returning)`) && hover.includes(`7-day visits${W[last].visits_7d.toLocaleString('en-US')}`));
    await page.screenshot({ path: `${OUT}/after-visitors-1440-hover.png`, animations: 'disabled' });
    await page.mouse.move(tx + 2, ty + 1, { steps: 3 }); await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up(); await page.waitForTimeout(1500);
    const clickEvents = await events();
    const after = await page.evaluate(() => ({
      url: window.location.search, panel: !!document.querySelector('aside[aria-label="Website visitors"]'),
      chip: document.querySelector('[data-active-filters] button[aria-label^="Remove filter Visited"]')?.getAttribute('aria-label') || '',
      showing: [...document.querySelectorAll('[data-active-filters] span')].map(e => e.textContent.trim()).find(t => /^Showing \d+ of \d+/.test(t)) || '',
      rows: document.querySelectorAll('[data-pipeline-companies] [data-row]').length,
    }));
    const expectKeys = new Set([...(W[last].company_keys || []), ...(W[last].record_keys || [])]);
    ok(`bar click -> the list: ?window=${W[last].start}_${W[last].end} (${after.url}) · panel closed ${!after.panel} · chip "${after.chip}" · "${after.showing}" · ${after.rows} rows (the window names ${W[last].companies} companies, ${W[last].record_keys?.length || 0} on records) (events ${clickEvents})`, after.url.includes(`window=${W[last].start}_${W[last].end}`) && !after.panel && after.chip.includes(`Visited ${W[last].label}`) && after.rows > 0 && after.rows <= expectKeys.size);
    await page.screenshot({ path: `${OUT}/after-list-window-1440.png`, animations: 'disabled' });
    results.numbers.window_click = { window: W[last].label, rows: after.rows, companies: W[last].companies, records: W[last].record_keys?.length || 0 };
    await ctx.close();
  }

  // ---- AFTER 390: 14 bars in view, swipe for the rest.
  {
    const { ctx, page, errors } = await open(390, BASE);
    const m = await measure(page);
    const n = trend.body.windows.length;
    // The report is a fixed side panel with its own scroll, so a full-page shot never reaches the chart: scroll it into view.
    await page.locator('[data-visitor-trend] svg').scrollIntoViewIfNeeded(); await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/after-visitors-390.png`, animations: 'disabled' });
    const swiped = await page.evaluate(() => { const r = document.querySelector('[data-visitor-trend] [role="region"]'); if (!r) return null; r.scrollLeft = r.scrollWidth; return { scrollWidth: r.scrollWidth, clientWidth: r.clientWidth, scrollLeft: r.scrollLeft }; });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/after-visitors-390-swiped.png`, animations: 'disabled' });
    ok(`390 swipe: the plot is ${swiped?.scrollWidth} px wide in a ${swiped?.clientWidth} px region, scrolled to ${swiped?.scrollLeft}`, swiped && swiped.scrollWidth > swiped.clientWidth && swiped.scrollLeft > 0);
    ok(`after@390: bars ${m.bars} · plot width ${m.plotWidth || '(100 %)'} (${n > 14 ? `${n} bars -> 14 in view` : 'all in view'}) · swipe region ${m.swipe} · sideways ${m.sideways} · errors ${errors.length}`, m.bars === n && (n > 14 ? Math.abs(parseFloat(m.plotWidth) - (n / 14) * 100) < 0.01 : m.plotWidth === '') && m.swipe && !m.sideways && errors.length === 0);
    await axeOn(page, '[data-visitor-report]', 'visitors@390');
    await ctx.close();
  }

  // ---- SETTINGS 1440: the weekend switch OFF with the measured copy.
  {
    const { ctx, page, errors } = await open(1440, BASE, { settings: true });
    const s = await page.evaluate(() => ({
      copy: document.querySelector('[data-weekend-copy]')?.textContent || '', checked: document.querySelector('input[aria-label="Weekend pulls and emails"]')?.checked,
      cadence: [...document.querySelectorAll('[data-team-email-kind="visitor"] span')].map(e => e.textContent).find(t => /7:00 AM PT/.test(t)) || '',
      scheduler: document.querySelector('[data-scheduler-line]')?.textContent || '',
    }));
    const prm = te.body.pull_runs_month;
    await page.screenshot({ path: `${OUT}/after-settings-1440.png`, animations: 'disabled' });
    ok(`settings: switch checked ${s.checked} · "${s.copy}" · "${s.cadence.slice(0, 40)}" · errors ${errors.length}`, s.checked === false && s.copy.includes(`measured ${prm.credits / prm.runs} Apollo credits per run this month (${prm.runs} runs`) && /^Weekdays at 7:00 AM PT/.test(s.cadence) && errors.length === 0);
    await axeOn(page, '[data-team-emails]', 'settings@1440');
    await ctx.close();
  }

  // ---- EMAIL: built locally from the stored data, rendered at 640 / 390.
  {
    const { loadVisitorData, loadRankedBook, loadCumulative, buildVisitorEmail, dayWindowFor } = await import('../../api/sales/teamEmails/visitorEmail.js');
    const { loadMembers, loadSettings } = await import('../../api/sales/teamEmails/send.js');
    const settings = await loadSettings(svc, HL);
    const members = await loadMembers(svc, HL);
    const date = today, window = dayWindowFor(date, { weekendOn: !!settings.weekend_on });
    const [companies, overall, cumulative] = await Promise.all([loadVisitorData(svc, HL, { window, members }), loadRankedBook(svc, HL, { members }), loadCumulative(svc, HL)]);
    const mail = buildVisitorEmail(companies, { date, window, overall, cumulative, trend: trend.body });
    results.numbers.email = { subject: mail.subject, visited: mail.visited, new: mail.new, returning: mail.returning, qualified: mail.qualified, strip: mail.strip };
    ok(`email built: subject "${mail.subject}" · visited ${mail.visited} · new ${mail.new} · returning ${mail.returning} · strip ${mail.strip} windows`, mail.strip === Math.min(7, trend.body.windows.length) && !ADDRESS.test(mail.html + mail.text));
    const stripHtml = mail.html.slice(mail.html.indexOf('Companies identified · last'), mail.html.indexOf('30-day graph'));
    const widths = [...stripHtml.matchAll(/width="([^"]+)"/g)].map(x => x[1]);
    ok(`strip: ${widths.length} widths, all % (${[...new Set(widths)].slice(0, 8).join(' ')}) · no px width · no img / svg`, widths.length > 10 && widths.every(w => /^\d+%$/.test(w)) && !/width:\s*\d+px|width="\d+"/.test(stripHtml) && !/<img|<svg/i.test(mail.html));
    for (const width of [640, 390]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      await ctx.route('**/*', r => (new URL(r.request().url()).protocol === 'data:' || r.request().url() === 'about:blank' ? r.continue() : r.abort()));
      const page = await ctx.newPage();
      await page.setContent(mail.html, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);
      const e = await page.evaluate(() => {
        const cells = [...document.querySelectorAll('td[valign="bottom"]')];
        const vis = cells.filter(td => { const b = td.getBoundingClientRect(); return b.left >= 0 && b.right <= window.innerWidth + 1; }).length;
        return { sideways: document.documentElement.scrollWidth > window.innerWidth + 1, cells: cells.length, visible: vis, strip: document.body.textContent.includes('Companies identified · last') };
      });
      await page.screenshot({ path: `${OUT}/email-${width}.png`, animations: 'disabled', fullPage: true });
      ok(`email@${width}: strip ${e.strip} · ${e.cells} cells, ${e.visible} fully in view · sideways ${e.sideways}`, e.strip && e.cells === mail.strip && e.visible === e.cells && !e.sideways);
      await ctx.close();
    }
  }
} catch (e) {
  if (!e.done) { results.errors.push(e.stack || e.message); log('ERROR', e.message); }
} finally {
  await cleanup();
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, PROD_SEND ? 'stage2-prod-send.json' : 'stage2-report.json'), JSON.stringify({ ...results, blocked, writes, when: new Date().toISOString() }, null, 2));
  console.log(`\nvisitor-trend-v1 Stage 2 ${PROD_SEND ? 'PROD SEND' : 'live'}: ${passed}/${results.checks.length} passed · Claude 0 · Apollo ${realCalls.length} · API writes ${PROD_SEND ? 1 : 0} (${writes.length} aborted from the browser) · ${Math.round((Date.now() - T0) / 1000)} s`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
