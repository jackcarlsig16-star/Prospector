// weekly-funnel-v1 Stage 3 live check - as Jack (ownerSession) on the REAL HomeLover workspace.
// DECLARED before it runs:
//   default (localhost against the build; the server runs with the Apollo key empty and the Claude key ON for one ask):
//     reads    goals/weekly x5, 3 raw table reads (sales_email_daily_counts 4 weeks, sales_metrics_daily 4 weeks), 3 page
//              loads (Scorecard 1440 x2, Settings 1440), 2 local renders of the email HTML (640 / 390).
//     writes   through the real routes, each restored: (1) PUT goals/weekly/manual linkedin_posts last week = 1, then
//              = null, then the leftover row deleted (sales_manual_metrics back to its count); (2) PUT goals/targets
//              linkedin_posts NEXT week goal 1 (proves a goal can be set ahead), then that row deleted; (3) PUT
//              goals/targets on LAST week = the 409, nothing written (once by fetch, once from the page with the request
//              rewritten to last Monday so the page shows the route's own words). Jack's own goal is never typed.
//     Claude   ONE ask through POST /api/scout/ask ("how are we pacing this week"), cap 1, cached in
//              .screenshots/weekly-funnel-v1/stage3-ledger.json - a re-run answers from the cache (0 Claude).
//     Apollo   0. ~150 s, cap 235 s.
//   EMAIL_ONLY=1 the email renders alone: 1 route read, 2 local renders, 0 writes, 0 Claude. ~15 s.
//   PROD_SEND=1  the ONE declared test send through PROD's test route { kind: 'weekly' } (the local server has no
//              Microsoft keys): to the sending mailbox only; prints the subject and counts, never an address. 1 row
//              added to sales_team_email_sends (kept: it is the send log). ~15 s.
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
const PROD_SEND = process.env.PROD_SEND === '1';
const PROD = 'https://prospector-chtj.onrender.com';
const CLAUDE_CAP = 1, ASK = 'how are we pacing this week';
const OUT = path.join(ROOT, '.screenshots', 'weekly-funnel-v1');
const PORT = 3995, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const TABLES = ['sales_metric_targets', 'sales_manual_metrics', 'sales_funnel_days', 'sales_email_daily_counts', 'sales_flow_events', 'sales_partner_events', 'sales_job_slots', 'sales_team_email_sends'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data?.[0]?.id;
if (!HL) throw new Error('no HomeLover business');
async function count(t) { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq(t === 'sales_job_slots' ? 'scope' : 'business_id', HL); return r.error ? `n/a (${r.error.message.slice(0, 40)})` : r.count; }
const snapshot = async () => { const o = {}; for (const t of TABLES) o[t] = await count(t); return o; };
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
let srv, browser, owner;
const blocked = [], realCalls = [];
const results = { checks: [], errors: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 600)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 235000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));
const fmt = n => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const pct = r => (r == null ? '—' : `${(r * 100).toFixed(1)}%`);

const LEDGER = path.join(OUT, 'stage3-ledger.json');
const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : { spent: 0, asks: {} };
const saveLedger = () => fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const ADDRESS = /[^\s"<>]+@[^\s"<>]+\.[a-z]{2,}/i;
let claudeThisRun = 0;
try {
  owner = await ownerSession(svc);
  if (PROD_SEND) {
    const cookieP = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
    const r = await fetch(`${PROD}/api/sales/${HL}/goals/team-emails/test`, { method: 'POST', headers: { cookie: cookieP, 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'weekly' }) });
    const b = await r.json().catch(() => null);
    ok(`PROD test send: HTTP ${r.status} · status ${b?.status} · recipients ${b?.recipients} · rows ${b?.rows} · strips ${b?.strips} · goals ${b?.goals} · subject "${b?.subject}"${b?.error ? ` · ${b.error}` : ''}`, r.status === 200 && b?.status === 'sent' && b?.recipients === 1 && b?.rows === 20);
    ok('the reply carries no address', !ADDRESS.test(JSON.stringify(b || {})));
    throw Object.assign(new Error('done'), { done: true });
  }
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', APOLLO_API_KEY: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const get = async p => { const r = await fetch(`${BASE}/api/sales/${HL}${p}`, { headers: { cookie } }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const put = async (p, body) => { const r = await fetch(`${BASE}/api/sales/${HL}${p}`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
  browser = await chromium.launch();
  const rewritten = [];
  async function openView(width, tabName, ready, { viewer = false, height = null, rewrite = null, tab = /^Dashboard/ } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: height || (width < 900 ? 844 : 1000) }, hasTouch: width < 900 });
    await ctx.addInitScript(([k, v, bz, dd]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      localStorage.setItem('prospector_goals_owner', 'team');
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, dd);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (u.protocol === 'file:' || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      const apiWrite = isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname);
      if (apiWrite && rewrite && req.method() === 'PUT' && u.pathname === `/api/sales/${HL}/goals/targets`) {
        let body; try { body = JSON.parse(req.postData() || '{}'); } catch { return route.abort(); }
        if (body.period !== 'week' || body.metric_key !== 'linkedin_posts') { blocked.push('PUT goals/targets (not the declared one)'); return route.abort(); }
        rewritten.push(body.period_start);
        return route.continue({ postData: JSON.stringify({ ...body, period_start: rewrite }) });
      }
      const deny = apiWrite || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.pathname.replace(HL, ':b')}`); return route.abort(); }
      if (viewer && isLocal && u.pathname === '/api/me') {
        const r = await route.fetch(); const j = await r.json();
        j.profile = { ...j.profile, is_platform_owner: false };
        j.memberships = (j.memberships || []).map(m => (m.business_id === HL ? { ...m, role: 'viewer' } : m));
        return route.fulfill({ response: r, json: j });
      }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(25000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    await page.goto(`${BASE}/?tab=dashboard&view=overview`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 25000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: tab }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
    await page.locator('[data-sales-subviews]').getByRole('tab', { name: tabName, exact: true }).dispatchEvent('click'); await page.waitForTimeout(1500);
    await page.locator(ready).first().waitFor({ timeout: 40000 }); await page.waitForTimeout(2500);
    return { ctx, page, errors };
  }
  const n2 = page => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
  const axeOn = async (page, key, sel) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async s => { const r = await window.axe.run(document.querySelector(s) || document, { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); }, sel);
    ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v));
  };
  const SCORE_READY = '[data-scorecard] [data-value]', HOME_READY = '[data-pulse] [data-pulse-tile]';
  const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, animations: 'disabled' });

  {
    const { buildWeeklyEmail } = await import('../../api/sales/teamEmails/weeklyEmail.js');
    const W = (await get('/goals/weekly?weeks=12')).body;
    const mon = W.week_start, last = addDays(mon, -7), next = addDays(mon, 7);
    const of = (b, k) => b.metrics.find(m => m.key === k);

    // ---- A. the email, built from the route's body, rendered at 640 and 390
    const mail = buildWeeklyEmail(W);
    fs.writeFileSync(`${OUT}/weekly-email.html`, mail.html); fs.writeFileSync(`${OUT}/weekly-email.txt`, mail.text);
    for (const w of [640, 390]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
      const page = await ctx.newPage();
      const outside = []; page.on('request', r => { if (!r.url().startsWith('data:') && !r.url().startsWith('about:')) outside.push(r.url().slice(0, 60)); });
      await page.setContent(mail.html, { waitUntil: 'load' });
      const m = await page.evaluate(() => ({ over: Math.max(0, document.documentElement.scrollWidth - window.innerWidth), svg: document.querySelectorAll('svg, img, link, style, script').length, tables: document.querySelectorAll('table').length, strips: [...document.querySelectorAll('table')].filter(t => t.querySelectorAll(':scope > tbody > tr > td').length === 12).length }));
      await page.screenshot({ path: `${OUT}/weekly-email-${w}.png`, fullPage: true });
      ok(`email @${w}: ${m.tables} tables, ${m.strips} strips of 12 cells, svg / img / style / script / link ${m.svg}, sideways overflow ${m.over} px, requests made by the page ${outside.length}`, m.svg === 0 && m.over === 0 && m.strips === mail.strips && outside.length === 0, outside.join(' '));
      await ctx.close();
    }
    ok(`email: subject "${mail.subject}" · ${mail.rows} rows in ${mail.groups} groups · ${mail.strips} strips · ${mail.goals} goals · LinkedIn entered ${mail.entered} / not entered ${mail.not_entered} · no address in either part`, mail.rows === 20 && mail.groups === 4 && !mail.html.includes('@') && !mail.text.includes('@') && mail.subject.startsWith('Weekly funnel · '));

    if (process.env.EMAIL_ONLY === '1') throw Object.assign(new Error('done'), { done: true });

    // ---- B. route vs raw: 3 metrics x the last 3 whole weeks
    const weeks3 = W.weeks.slice(-4, -1);
    const { data: counts } = await svc.from('sales_email_daily_counts').select('day, delivered, hard_bounced, spam_blocked').eq('business_id', HL).gte('day', weeks3[0]).lte('day', addDays(weeks3[2], 6)).limit(5000);
    const { data: levels } = await svc.from('sales_metrics_daily').select('metric_date, value').eq('business_id', HL).eq('metric_key', 'prospects_in_cadence').eq('dim_type', 'all').gte('metric_date', weeks3[0]).lte('metric_date', addDays(weeks3[2], 6)).limit(5000);
    const off = [], shown = [];
    for (const w of weeks3) {
      const rows = counts.filter(r => r.day >= w && r.day <= addDays(w, 6));
      const sum = f => rows.reduce((n, r) => n + (r[f] || 0), 0);
      const d = sum('delivered'), sent = d + sum('hard_bounced') + sum('spam_blocked');
      const lv = levels.filter(r => r.metric_date >= w && r.metric_date <= addDays(w, 6)).sort((a, b) => (a.metric_date < b.metric_date ? 1 : -1))[0];
      const raw = { delivered: rows.length ? d : null, deliverability: sent ? d / sent : null, total_in_sequence: lv ? Number(lv.value) : null };
      for (const k of Object.keys(raw)) {
        const route = of(W, k).series.find(s => s.week_start === w).value;
        const same = raw[k] == null || route == null ? raw[k] === route : Math.abs(raw[k] - route) < 1e-12;
        if (!same) off.push(`${k} ${w}: route ${route} vs raw ${raw[k]}`);
        shown.push(`${k} ${w.slice(5)} ${k === 'deliverability' ? pct(route) : fmt(route)}`);
      }
    }
    ok(`route vs raw, 3 metrics x 3 weeks (${counts.length} count rows, ${levels.length} level rows): ${off.length} of 9 off - ${shown.join(' · ')}`, off.length === 0, off.join(' ; '));

    // ---- C. LinkedIn: one value typed for last week, then cleared, through the real route; the leftover row removed
    const manualBefore = await count('sales_manual_metrics');
    const existing = (await svc.from('sales_manual_metrics').select('metric_key').eq('business_id', HL).eq('metric_key', 'linkedin_posts').eq('week_start', last)).data || [];
    if (existing.length) ok('LinkedIn: linkedin_posts for last week already has a typed row - not touched', false, 'a real row exists; the check will not overwrite it');
    else {
      const a = await put('/goals/weekly/manual', { metric_key: 'linkedin_posts', week_start: last, value: 1 });
      const w1 = of((await get('/goals/weekly?weeks=12')).body, 'linkedin_posts');
      const b = await put('/goals/weekly/manual', { metric_key: 'linkedin_posts', week_start: last, value: null });
      const w2 = of((await get('/goals/weekly?weeks=12')).body, 'linkedin_posts');
      const del = await svc.from('sales_manual_metrics').delete().eq('business_id', HL).eq('metric_key', 'linkedin_posts').eq('week_start', last).select('metric_key');
      const manualAfter = await count('sales_manual_metrics');
      ok(`LinkedIn (posts, week of ${last}): typed 1 -> HTTP ${a.status}, the route reads ${w1.last_week.value} "entered by ${w1.entered.last_week?.by} ${String(w1.entered.last_week?.at).slice(0, 10)}"; cleared -> HTTP ${b.status}, the route reads ${w2.last_week.value === null ? '—' : w2.last_week.value}, entered ${w2.entered.last_week === null ? 'nobody' : 'still set'}; leftover row deleted (${del.data?.length}); sales_manual_metrics ${manualBefore} -> ${manualAfter}`,
        a.status === 200 && w1.last_week.value === 1 && !!w1.entered.last_week?.by && b.status === 200 && w2.last_week.value === null && w2.entered.last_week === null && del.data?.length === 1 && manualAfter === manualBefore);
    }

    // ---- D. the 409 on an ended week (fetch), and E. a goal a week ahead (written, read back, removed)
    const targetsBefore = await count('sales_metric_targets');
    const ended = await put('/goals/targets', { period: 'week', period_start: last, metric_key: 'linkedin_posts', goal: 1 });
    ok(`409: PUT goals/targets for the week of ${last} -> HTTP ${ended.status} code ${ended.body?.code} "${ended.body?.error}"; sales_metric_targets ${targetsBefore} -> ${await count('sales_metric_targets')}`, ended.status === 409 && ended.body?.code === 'week_ended' && (await count('sales_metric_targets')) === targetsBefore);
    const hasNext = (await svc.from('sales_metric_targets').select('metric_key').eq('business_id', HL).eq('period', 'week').eq('period_start', next).eq('metric_key', 'linkedin_posts')).data || [];
    if (hasNext.length) ok('next week: linkedin_posts already has a goal for next week - not touched', false);
    else {
      const ahead = await put('/goals/targets', { period: 'week', period_start: next, metric_key: 'linkedin_posts', goal: 1 });
      const nw = of((await get('/goals/weekly?weeks=12')).body, 'linkedin_posts').next_week;
      const del = await svc.from('sales_metric_targets').delete().eq('business_id', HL).eq('period', 'week').eq('period_start', next).eq('metric_key', 'linkedin_posts').select('metric_key');
      ok(`next week: PUT goals/targets for the week of ${next} -> HTTP ${ahead.status}; the route's next_week reads ${JSON.stringify(nw)}; the test row deleted (${del.data?.length}); sales_metric_targets ${targetsBefore} -> ${await count('sales_metric_targets')}`, ahead.status === 200 && nw.week_start === next && nw.goal === 1 && del.data?.length === 1 && (await count('sales_metric_targets')) === targetsBefore);
    }

    // ---- the Scorecard: the next-week line, and the 409 as the page shows it (the page's PUT is rewritten to last Monday)
    {
      const { ctx, page, errors } = await openView(1440, 'Scorecard', '[data-scorecard-table] [data-row]', { height: 1500, rewrite: last });
      const lines = await page.locator('[data-next-goal]').count();
      await shot(page, 'stage3-scorecard-1440');
      await axeOn(page, 'scorecard@1440', '[data-scorecard]');
      await page.locator('[data-cell="linkedin_posts|goal"] button').first().click(); await page.waitForTimeout(200);
      await page.keyboard.type('1'); await page.keyboard.press('Enter');
      const alert = await page.locator('[data-save-error]').innerText({ timeout: 15000 }).catch(() => '');
      await page.locator('[data-save-error]').scrollIntoViewIfNeeded().catch(() => {});
      await page.screenshot({ path: `${OUT}/stage3-scorecard-409.png`, animations: 'disabled' });
      await page.keyboard.press('Escape');
      ok(`Scorecard 1440: ${lines} "next wk" goal lines (owner: one per row); a goal typed with its week rewritten to ${last} (the page asked for ${rewritten.join()}) shows "${alert}"; sales_metric_targets ${targetsBefore} -> ${await count('sales_metric_targets')}; N2 ${await n2(page)} px; page errors ${errors.length}`,
        lines === 20 && rewritten.length === 1 && rewritten[0] === mon && /That week has ended/.test(alert) && (await count('sales_metric_targets')) === targetsBefore && (await n2(page)) === 0 && errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
    // ---- Settings › Team emails: the weekly row (absent until the migration has run)
    {
      const state = (await get('/goals/team-emails')).body;
      const { ctx, page, errors } = await openView(1440, 'Team emails', '[data-team-emails]', { height: 1300, tab: /^Settings/ });
      const row = await page.locator('[data-team-email-kind="weekly"]').innerText().catch(() => null);
      await shot(page, 'stage3-settings-1440');
      await axeOn(page, 'team emails@1440', '[data-team-emails]');
      const migrated = 'weekly_on' in state;
      ok(`Settings: the route ${migrated ? `carries weekly_on = ${state.weekly_on}, weekly count ${state.counts.weekly?.count}` : 'has no weekly_on (the migration has not run)'}; the page ${row ? `shows "${row.split('\n').slice(0, 2).join(' · ')}"` : 'shows no weekly row'}; scheduler line "${state.scheduler?.line}"; page errors ${errors.length}`,
        (migrated ? !!row && state.weekly_on === false : row === null) && /team-weekly-email 07:00 Fri/.test(state.scheduler?.line || '') && errors.length === 0, errors.join(' | '));
      await ctx.close();
    }

    // ---- F. Scout: "how are we pacing this week" = the page (ONE ask, cap 1, cached)
    {
      let entry = ledger.asks[ASK];
      const cached = !!entry;
      if (!entry) {
        if (ledger.spent >= CLAUDE_CAP) ok('Scout: the cap is spent and no cached reply exists', false);
        else {
          ledger.spent += 1; claudeThisRun += 1; saveLedger();
          const t = Date.now(), startIso = new Date(t - 5000).toISOString();
          const r = await fetch(`${BASE}/api/scout/ask`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ q: ASK, scope: HL }) });
          const body = await r.json().catch(() => ({}));
          const usage = (await svc.from('business_anthropic_usage').select('input_tokens, output_tokens, cost_usd, model').eq('call_type', 'scout_ask').eq('user_id', owner.userId).gte('created_at', startIso).order('created_at', { ascending: false }).limit(1)).data?.[0] || null;
          entry = { status: r.status, body, usage, elapsed: Math.round((Date.now() - t) / 100) / 10, at: new Date().toISOString(), route: { delivered: of(W, 'delivered').this_week, open: of(W, 'human_open_rate').this_week, day: W.elapsed.days } };
          ledger.asks[ASK] = entry; saveLedger();
        }
      }
      if (entry) {
        const all = JSON.stringify(entry.body), ans = String(entry.body.answer_md || '');
        const d = entry.route.delivered, o = entry.route.open;
        const has = v => v != null && (ans.includes(fmt(v)) || ans.includes(String(v)));
        const read = (all.match(/goals\/weekly[^"\\]*/) || [])[0] || null;
        ok(`Scout "${ASK}"${cached ? ' (from the cache, 0 Claude)' : ''}: HTTP ${entry.status} · read "${read}" · the answer carries delivered to date ${fmt(d.to_date)} (${has(d.to_date)}), its pace ~${fmt(d.pace)} (${has(d.pace)}), the open rate ${pct(o.to_date)} (${ans.includes((o.to_date * 100).toFixed(1))}) = the route the page reads; ${entry.usage ? `${entry.usage.input_tokens} in / ${entry.usage.output_tokens} out · $${Number(entry.usage.cost_usd).toFixed(4)} · ${entry.usage.model} · ${entry.elapsed} s` : 'no usage row found'}`,
          entry.status === 200 && !!read && has(d.to_date) && has(d.pace) && ans.includes((o.to_date * 100).toFixed(1)), ans.replace(/\s+/g, ' ').slice(0, 500));
        log(`Scout answer: ${ans.replace(/\s+/g, ' ').slice(0, 700)}`);
      }
    }
  }
  ok(`browser calls to Claude / Apollo hosts: ${realCalls.length}; Claude asks this run: ${claudeThisRun} (spent ${ledger.spent} of cap ${CLAUDE_CAP}); non-GET aborted in the browser: ${blocked.length}${blocked.length ? ` (${[...new Set(blocked)].slice(0, 6).join(', ')})` : ''}`, realCalls.length === 0 && ledger.spent <= CLAUDE_CAP);
} catch (e) {
  if (!e.done) { results.errors.push(e.message); log('ERROR', e.stack?.split('\n').slice(0, 4).join(' | ')); }
} finally {
  await cleanup();
  let line;
  try {
    const after = await snapshot();
    const moved = TABLES.filter(t => after[t] !== before[t]);
    const expected = PROD_SEND ? ['sales_team_email_sends'] : [];
    const odd = moved.filter(t => !expected.includes(t));
    line = odd.length ? `counts moved on ${odd.map(t => `${t} ${before[t]} -> ${after[t]}`).join(', ')} - not this run's declared writes; check who wrote them` : PROD_SEND ? `yes (the one test send's log row kept: sales_team_email_sends ${before.sales_team_email_sends} -> ${after.sales_team_email_sends}; every other count identical)` : `yes (${TABLES.length} table counts identical: the typed LinkedIn row and the next-week goal row were deleted, the 409s wrote nothing; Jack's sign-in rows kept by rule)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  console.log(`\n${passed}/${results.checks.length} checks passed${results.errors.length ? ` · errors: ${results.errors.join(' | ')}` : ''}`);
  console.log(`restored: ${line}`);
  process.exit(results.errors.length || passed !== results.checks.length ? 1 : 0);
}
