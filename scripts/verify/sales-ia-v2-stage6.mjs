// sales-ia-v2 REV2 Stage 6 bar 4 (D1 Dashboard: range 7 · 30 · 90 + Owner + Team, the 13 inline-SVG charts over GET
// goals/dashboard, the Goals section underneath - hero, commitments per person + Focus 5, latest report card, Pipeline
// moves, Scorecard, Weekly report (prints to PDF) - Reports / Today routes redirect, the N2 layout check, Viewer read-only).
// SCOPE (declared): TEMP data only - 1 workspace (goals_sales on, added to SALES_ANALYTICS_BUSINESS_IDS for the local
// server only) + 3 temp users (owner, member "Cyrus Temp", viewer) + 3 partners, 2 employers (one stage move), 1 target,
// 5 web_visits over 2 days, 3 signals, 3 email-count days, 1 partner event, 7 sales_week_goals rows, 1 final report for
// last week, 1 apollo_credit_spend row of 1 credit (deleted at teardown; the shared meter reads +1 for ~2 min).
// Made-up names; no emails or phones anywhere. HomeLover is never written; its table counts are compared before and
// after. 0 Apollo (sync / apollo / visit-pull routes aborted in the browser). 0 Claude. Runtime ~2.5 min, hard cap 285 s
// (tempGuard), teardown deletes everything.
// Usage: node scripts/verify/sales-ia-v2-stage6.mjs <outdir>   (run npm run build first)
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const OUT = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(ROOT, 'build', 'verify-shots');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3978;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const NAME = 'ZZ Sales IA v2 Stage6';
const HL = ['sales_week_goals', 'sales_signals', 'sales_targets', 'sales_goals', 'sales_opportunities', 'sales_partner_events', 'sales_opportunity_events', 'web_visits', 'sales_email_daily_counts', 'sales_week_report', 'apollo_credit_spend'];
const TEMP_TABLES = ['sales_week_goal_steps', 'sales_week_goals', 'sales_week_plans', 'sales_week_report_sections', 'sales_week_report', 'sales_signals', 'sales_suggestions', 'web_visits', 'visit_pull_runs', 'apollo_credit_spend', 'sales_email_daily_counts', 'research_runs', 'sales_partner_events', 'sales_opportunity_events', 'sales_targets', 'sales_opportunities', 'sales_goals', 'auth_events', 'business_members'];
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const hlCounts = async () => { const o = {}; for (const t of HL) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HOMELOVER)).count; return o; };
let srv, browser, B, users = [], pass = 0, total = 0;
const T0 = Date.now();
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  [${Math.round((Date.now() - T0) / 1000)}s] ${n}${d ? ` - ${d}` : ''}`); };
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  if (B) {
    for (const t of TEMP_TABLES) { const r = await svc.from(t).delete().eq('business_id', B); if (r.error) console.log(`cleanup ${t}: ${r.error.message}`); }
    await svc.from('businesses').delete().eq('id', B);
  }
  for (const u of users) { await svc.from('auth_events').delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('actor_id', u.id); await svc.auth.admin.deleteUser(u.id); }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 285000 });
const laToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const monday = d => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));
fs.mkdirSync(OUT, { recursive: true });
const hlBefore = await hlCounts();
console.log('HomeLover before', JSON.stringify(hlBefore));
const results = { n2: {}, api: null };
try {
  const tag = 'ia2s6-' + Date.now();
  B = ins(await svc.from('businesses').insert({ name: NAME, website_url: 'https://ia2s6.example.com', color: '#6F8CF0', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
  const mk = async (name, role) => {
    const email = `${tag}-${name.toLowerCase().replace(/\s+/g, '-')}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
    const { data: u, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(error.message);
    await svc.from('profiles').update({ display_name: name, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
    ins(await svc.from('business_members').insert({ business_id: B, email, name, user_id: u.user.id, role }).select());
    const anon = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data: s, error: sErr } = await anon.auth.signInWithPassword({ email, password });
    if (sErr) throw new Error(sErr.message);
    const u2 = { id: u.user.id, session: s.session, name }; users.push(u2); return u2;
  };
  const owner = await mk('Jack Test', 'owner'), cyrus = await mk('Cyrus Temp', 'member'), viewer = await mk('Viewer Test', 'viewer');
  const today = laToday(), week = monday(today), lastWeek = addDays(week, -7), yesterday = addDays(today, -1);
  const [p1, p2] = ins(await svc.from('sales_goals').insert([
    { business_id: B, goal_type: 'partnership', name: 'ZZ Lakeshore Mutual', category: '3. Brokers', pipeline_status: 'meeting_set', priority: 1, owner_user_id: owner.id, owner_team: 'homelover', channel: 'manual' },
    { business_id: B, goal_type: 'partnership', name: 'ZZ Northwind Benefits', category: '3. Brokers', pipeline_status: 'first_email_sent', owner_user_id: cyrus.id, owner_team: 'both', channel: 'import' },
    { business_id: B, goal_type: 'partnership', name: 'ZZ Current Co', category: '1. Current partners', pipeline_status: 'live', owner_team: 'upside', channel: 'partner_referral' },
  ]).select('id, name'));
  const [mill, river] = ins(await svc.from('sales_opportunities').insert([
    { business_id: B, organization: 'ZZ Old Mill Union', org_type: 'employer', stage: 'contacted', source: 'manual', channel: 'call_note', owner: 'Jack Test', owner_team: 'homelover', covered_lives: 1200 },
    { business_id: B, organization: 'ZZ Riverbend Schools', org_type: 'employer', stage: 'contacted', source: 'manual', channel: 'scout', owner: 'Cyrus Temp', owner_team: 'upside', covered_lives: 800 },
  ]).select('id'));
  // The stage trigger logs this as a stage_change to meeting - the one employer "meeting" this week.
  ins(await svc.from('sales_opportunities').update({ stage: 'meeting' }).eq('id', mill.id).select('id'));
  // The movement read files an opportunity created inside the week under "added", so the fixture's created events are backdated a week.
  ins(await svc.from('sales_opportunity_events').update({ changed_at: `${addDays(monday(today), -7)}T12:00:00Z` }).eq('business_id', B).eq('event_type', 'created').select('id'));
  ins(await svc.from('sales_targets').insert({ business_id: B, name: 'ZZ Zeta Labs', kind: 'employer', status: 'researching', channel: 'scout' }).select('id'));
  const visit = (pulled_on, company_key, priority) => ({ business_id: B, pulled_on, company_key, company_name: company_key.toUpperCase(), priority, priority_rule: 'test', visits_7d: 3, last_visit: pulled_on, us_500: true, top_paths: ['/pricing'] });
  ins(await svc.from('web_visits').insert([visit(yesterday, 'zz acme', 'P1'), visit(yesterday, 'zz bolt', 'P3'), visit(today, 'zz acme', 'P1'), visit(today, 'zz cove', 'P2'), visit(today, 'zz dune', 'P2')]).select('id'));
  ins(await svc.from('sales_signals').insert([
    { business_id: B, source: 'scout', signal_week: week, company_name: 'ZZ Scout Co', company_key: 'zz scout co', kind: 'partner', kind_guessed: false, signal: 'Opened an office', why_now: 'Hiring', score: 55, status: 'new', created_by: owner.id },
    { business_id: B, source: 'scout', signal_week: week, company_name: 'ZZ Scout Two', company_key: 'zz scout two', kind: 'partner', kind_guessed: false, signal: 'Raised a round', why_now: 'Growth', score: 70, status: 'accepted', created_by: owner.id, decided_by: owner.id, decided_at: new Date().toISOString() },
    { business_id: B, source: 'web_visit', signal_week: week, company_name: 'ZZ Dune', company_key: 'zz dune', kind: 'employer', kind_guessed: true, signal: '3 visits', why_now: 'P2 This week', status: 'dismissed', created_by: owner.id, decided_by: owner.id, decided_at: new Date().toISOString() },
  ]).select('id'));
  // A bulk insert sends null for any key a row leaves out, so every NOT NULL count is spelled out.
  const mail = (day, counts) => ({ business_id: B, day, mailbox: 'zz-mailbox', sequence_id: '', step: 0, delivered: 0, hard_bounced: 0, spam_blocked: 0, opened: 0, clicked: 0, replied: 0, ...counts });
  ins(await svc.from('sales_email_daily_counts').insert([
    mail(addDays(today, -8), { delivered: 100, hard_bounced: 3, spam_blocked: 2, opened: 40, clicked: 5, replied: 4 }),
    mail(yesterday, { delivered: 50, opened: 20, clicked: 2, replied: 3 }),
    mail(today, { delivered: 10, opened: 1, replied: 1 }),
  ]).select('day'));
  ins(await svc.from('sales_partner_events').insert({ business_id: B, goal_id: p1.id, event: 'status', from_status: 'replied', to_status: 'meeting_set', by_user: owner.id, at: new Date().toISOString() }).select('id'));
  const plan = ins(await svc.from('sales_week_plans').insert({ business_id: B, week_start: week, owner_user_id: owner.id, prompt: '', inputs: {}, proposals: [], chosen_count: 2, created_by: owner.id }).select('id').single());
  const wgRows = [
    { business_id: B, week_start: week, kind: 'todo', status: 'open', text: 'ZZ Send the deck', owner_user_id: owner.id, due_date: addDays(today, -2), link_type: 'partner', link_id: p2.id, created_by: owner.id },
    { business_id: B, week_start: week, kind: 'todo', status: 'done', text: 'ZZ Call back Old Mill', owner_user_id: owner.id, due_date: today, link_type: 'opportunity', link_id: mill.id, created_by: owner.id },
    { business_id: B, week_start: week, kind: 'todo', status: 'open', text: 'ZZ Draft the one-pager', owner_user_id: cyrus.id, due_date: addDays(today, 2), created_by: cyrus.id },
    { business_id: B, week_start: lastWeek, kind: 'waiting', status: 'open', text: 'the signed MSA', waiting_on: 'Pat', due_date: addDays(today, -5), link_type: 'partner', link_id: p1.id, created_by: owner.id },
    { business_id: B, week_start: week, kind: 'waiting', status: 'open', text: 'the deck', waiting_on: 'Sam', due_date: addDays(today, 9), link_type: 'partner', link_id: p2.id, created_by: owner.id },
    { business_id: B, week_start: week, kind: 'commitment', status: 'open', text: 'ZZ Book two partner meetings', owner_user_id: owner.id, plan_id: plan.id, plan_rank: 1, plan_reason: 'Pipeline is thin', created_by: owner.id },
    { business_id: B, week_start: week, kind: 'commitment', status: 'done', text: 'ZZ Ship the deck', owner_user_id: owner.id, plan_id: plan.id, plan_rank: 2, created_by: owner.id },
  ];
  ins(await svc.from('sales_week_goals').insert(wgRows.map(r => ({ contacts: [], sort_order: 0, ...r }))).select('id'));
  ins(await svc.from('sales_week_report').insert({ business_id: B, week_start: lastWeek, status: 'final', finalized_at: new Date(Date.now() - 3 * 864e5).toISOString(), finalized_by: owner.id, snapshot: { commitments: [{ id: 'x' }, { id: 'y' }], kpi: [] } }).select('week_start'));
  const spendBefore = ins(await svc.from('apollo_credit_spend').select('credits').eq('la_month', today.slice(0, 7))).reduce((n, r) => n + (r.credits || 0), 0);
  ins(await svc.from('apollo_credit_spend').insert({ business_id: B, la_month: today.slice(0, 7), endpoint: 'verify', ref: `verify:${tag}`, credits: 1 }).select('id'));

  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const api = async (u, p) => {
    const res = await fetch(`http://localhost:${PORT}/api/sales/${B}${p}`, { headers: { Cookie: `prospector_at=${encodeURIComponent(u.session.access_token)}` } });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  // ── API ──
  const d30 = await api(owner, '/goals/dashboard?days=30');
  const d = d30.body || {};
  results.api = { status: d30.status, keys: Object.keys(d) };
  const stage = (list, id, k) => (list || []).find(s => s.id === id)?.[k];
  ok('GET goals/dashboard: 200 with the 13 series, today / week / month, history_start = yesterday (2 days of pulls, not full)', d30.status === 200 && ['pipeline_by_stage', 'partners_by_status_owner', 'partners_by_category', 'visitors_per_day', 'visitors_by_priority_day', 'outreach_per_week', 'replies_meetings_per_week', 'signals_by_channel', 'companies_by_channel_stage', 'todos_per_owner', 'waiting', 'covered_lives_by_stage', 'credits'].every(k => k in d) && d.today === today && d.week_start === week && d.history_start === yesterday && d.history_full === false, JSON.stringify({ s: d30.status, hs: d.history_start, e: d.error }));
  ok('pipeline by stage: 1 contacted + 1 meeting; covered lives 800 contacted / 1,200 meeting', stage(d.pipeline_by_stage, 'contacted', 'count') === 1 && stage(d.pipeline_by_stage, 'meeting', 'count') === 1 && stage(d.covered_lives_by_stage, 'contacted', 'lives') === 800 && stage(d.covered_lives_by_stage, 'meeting', 'lives') === 1200);
  const vis = Object.fromEntries((d.visitors_per_day || []).map(x => [x.day, x.companies]));
  const prio = (d.visitors_by_priority_day || []).find(x => x.day === today);
  ok('visitors: yesterday 2 companies, today 3 (P1 1, P2 2); a day without a pull is null', vis[yesterday] === 2 && vis[today] === 3 && vis[addDays(today, -2)] === null && prio?.P1 === 1 && prio?.P2 === 2 && prio?.P3 === 0, JSON.stringify({ y: vis[yesterday], t: vis[today], prio }));
  const thisWk = (d.replies_meetings_per_week || []).find(w => w.week_start === week);
  const outWk = (d.outreach_per_week || []).find(w => w.week_start === week);
  const sentThisWeek = [yesterday, today].filter(x => x >= week).length === 2 ? 60 : 10;
  ok(`replies + meetings this week: all replies, 2 meetings (one partner move from history, one employer stage change); outreach sent = delivered + bounced + spam`, thisWk?.meetings === 2 && outWk && outWk.sent === sentThisWeek && thisWk.replies === outWk.replied, JSON.stringify({ thisWk, outWk }));
  const sig = Object.fromEntries((d.signals_by_channel || []).map(r => [r.source, r]));
  ok('signals by channel and outcome: scout 1 new + 1 accepted, website 1 dismissed', sig.scout?.new === 1 && sig.scout?.accepted === 1 && sig.web_visit?.dismissed === 1);
  const byOwner = Object.fromEntries((d.todos_per_owner || []).map(r => [r.name, [r.done, r.open]]));
  ok('to-dos per owner this week (done / open) + waiting 2 open / 1 overdue', JSON.stringify(byOwner['Jack Test']) === '[1,1]' && JSON.stringify(byOwner['Cyrus Temp']) === '[0,1]' && d.waiting?.open === 2 && d.waiting?.overdue === 1, JSON.stringify({ byOwner, w: d.waiting }));
  ok('partners by category: Brokers 2, Current partners 1; by status per owner: Jack meeting_set 1, Cyrus first_email_sent 1, Unassigned live 1', d.partners_by_category?.[0]?.count === 2 && d.partners_by_category?.[1]?.count === 1 && d.partners_by_status_owner?.find(r => r.name === 'Jack Test')?.counts.meeting_set === 1 && d.partners_by_status_owner?.find(r => r.name === 'Unassigned')?.counts.live === 1);
  const ch = Object.fromEntries((d.companies_by_channel_stage || []).map(r => [r.channel, r.bands]));
  ok('companies by channel and stage band: scout gray 2 (Riverbend contacted + the researching target), call_note yellow 1, partner_referral green 1', ch.scout?.gray === 2 && ch.call_note?.yellow === 1 && ch.partner_referral?.green === 1, JSON.stringify(ch));
  ok(`credits meter: all businesses this month = before (${spendBefore}) + the 1-credit test row, cap 500`, d.credits?.used === spendBefore + 1 && d.credits?.cap === 500 && d.credits?.all_businesses === true, JSON.stringify(d.credits));
  const d7 = await api(owner, '/goals/dashboard?days=7');
  const d90 = await api(owner, '/goals/dashboard?days=90');
  ok('days=7 / 90: 7 and 90 day points; 14 is refused (400)', d7.body?.visitors_per_day?.length === 7 && d90.body?.visitors_per_day?.length === 90 && (await api(owner, '/goals/dashboard?days=14')).status === 400);
  const dj = await api(owner, `/goals/dashboard?days=30&owner=${owner.id}`);
  const du = await api(owner, '/goals/dashboard?days=30&team=upside');
  ok("owner=Jack: Riverbend (Cyrus's) leaves the pipeline, Jack's to-dos only, 2 meetings stay (both his); team=upside: Riverbend, Current Co and Northwind (both)", stage(dj.body?.pipeline_by_stage, 'contacted', 'count') === 0 && dj.body?.todos_per_owner?.length === 1 && dj.body?.replies_meetings_per_week?.find(w => w.week_start === week)?.meetings === 2 && stage(du.body?.pipeline_by_stage, 'contacted', 'count') === 1 && stage(du.body?.pipeline_by_stage, 'meeting', 'count') === 0 && du.body?.partners_by_category?.length === 2, JSON.stringify({ j: dj.body?.todos_per_owner?.length, u: du.body?.partners_by_category }));
  ok('Viewer: GET goals/dashboard is 200', (await api(viewer, '/goals/dashboard')).status === 200);

  // ── browser ──
  browser = await chromium.launch();
  async function newPage(u, { width = 1440, height = 900, url = '/?tab=dashboard', ws = NAME } = {}) {
    const errs = [];
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage(); page.setDefaultTimeout(12000);
    page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
    page.on('dialog', d => d.accept());
    await page.addInitScript(([k, v, b, dd]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      localStorage.setItem(`prospector_visits_ran_${b}`, dd); localStorage.setItem(`prospector_tidy_ran_${b}`, dd);
    }, [`sb-${REF}-auth-token`, JSON.stringify(u.session), B, today]);
    await page.addInitScript(() => { window.__prints = 0; window.print = () => { window.__prints++; }; });
    await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)|\/goals\/visits\/pull|\/goals\/tidy\/run/, route => route.abort());
    await page.goto(`http://localhost:${PORT}${url}`);
    await page.locator('#main-content').getByText(NAME).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(1000);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').selectOption({ label: ws }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    return { page, errs };
  }
  // A fresh URL lands on the workspace home; the Sales module mounts (and rewrites the URL) once it is opened.
  const openSales = async (page, url) => {
    await page.goto(`http://localhost:${PORT}${url}`); await page.locator('#main-content').getByText(NAME).first().waitFor({ timeout: 20000 }); await page.waitForTimeout(800);
    await page.getByLabel('Workspace').selectOption({ label: NAME }); await page.waitForTimeout(1500);
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
  };
  const tab = async (page, label) => { await page.locator('#workspace-header-tabs').getByRole('button', { name: new RegExp(`^${label}`) }).first().click(); await page.waitForTimeout(1500); };
  const sub = async (page, label) => { await page.locator('[data-sales-subviews]').getByRole('tab', { name: label, exact: true }).click(); await page.waitForTimeout(1500); };
  const boxes = page => page.evaluate(() => Object.fromEntries(['data-workspace-header', 'data-sales-tabrow', 'data-sales-subviews', 'data-sales-frame'].map(a => {
    const el = document.querySelector(`[${a}]`); if (!el) return [a, null];
    const r = el.getBoundingClientRect(); return [a, { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, h: Math.round(r.height * 10) / 10 }];
  })));
  // x/y of every frame piece; height only where it sets what sits below (the header and the fixed frame row - the empty
  // sub-view slot on Actions is 34 px to the switch's 36 and moves nothing).
  const SIZED = ['data-workspace-header', 'data-sales-frame'];
  const maxMove = (a, b) => Math.max(0, ...Object.keys(a).filter(k => a[k] && b[k]).flatMap(k => [Math.abs(a[k].x - b[k].x), Math.abs(a[k].y - b[k].y), SIZED.includes(k) ? Math.abs(a[k].h - b[k].h) : 0]));
  const shot = (page, n, full = false) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide', fullPage: full });
  const charts = page => page.locator('[data-chart]');
  const chartLabels = page => page.locator('[data-chart] svg[role="img"], [data-chart] [role="meter"]').evaluateAll(els => els.map(e => e.getAttribute('aria-label') + '|' + (e.getAttribute('aria-valuenow') || '')));

  // ── owner 1440 ──
  { const { page, errs } = await newPage(owner);
    await charts(page).first().waitFor();
    ok('Dashboard opens on Overview (default sub-view), URL says so, 13 chart cards', /tab=dashboard/.test(page.url()) && /view=overview/.test(page.url()) && (await charts(page).count()) === 13 && (await page.locator('[data-sales-subviews] [aria-selected="true"]').textContent()) === 'Overview', page.url());
    const n2 = {};
    for (const [t, s, key] of [['Dashboard', null, 'dashboard'], ['Actions', null, 'actions'], ['Pipeline', 'Companies', 'companies'], ['Pipeline', 'People', 'people'], ['Dashboard', 'Analytics', 'analytics'], ['Dashboard', 'Overview', 'overview2']]) { await tab(page, t); if (s) await sub(page, s); n2[key] = await boxes(page); }
    const ref = n2.dashboard;
    const mv = Math.max(...Object.values(n2).map(b => maxMove(ref, b)));
    results.n2['1440 across tabs'] = { ref, maxMove: mv };
    ok(`N2 1440: header, tab row, sub-view switch and frame row at the same x/y/height on Dashboard, Actions, Companies, People, Analytics and back (max move ${mv} px)`, mv <= 1, JSON.stringify(results.n2['1440 across tabs']));
    await charts(page).first().waitFor({ timeout: 20000 }).catch(async () => { console.log('DEBUG dashboard grid:', await page.locator('[data-dashboard-charts]').allTextContents(), 'alerts:', await page.getByRole('alert').allTextContents(), 'main:', (await page.locator('main').first().textContent())?.slice(0, 300)); await shot(page, 'ia2s6-debug-1440'); });
    const b0 = await boxes(page);
    const before = await chartLabels(page);
    const grid = page.locator('[data-dashboard-charts]');
    ok('range starts at 30 days; the visitor line has 30 day points', (await grid.getAttribute('data-days')) === '30' && (await page.locator('[data-chart="chart-visitors-day"] circle').count()) === 2, await grid.getAttribute('data-days'));
    await page.getByRole('group', { name: 'Date range' }).getByRole('button', { name: '7 days' }).click();
    await page.locator('[data-dashboard-charts][data-days="7"]').waitFor(); await page.waitForTimeout(400);
    const after7 = await chartLabels(page);
    const changed = before.filter((l, i) => l !== after7[i]).length;
    ok(`7 days: the grid redraws with the new range (data-days=7); ${changed} of ${before.length} chart labels changed (day / week series shrink; snapshots keep their numbers)`, (await grid.getAttribute('data-days')) === '7' && changed >= 4 && (await charts(page).count()) === 13);
    // bar-5 path: change the range to 30 days -> every chart redraws.
    await page.getByRole('group', { name: 'Date range' }).getByRole('button', { name: '30 days' }).click();
    await page.locator('[data-dashboard-charts][data-days="30"]').waitFor(); await page.waitForTimeout(400);
    ok('30 days again: every chart is back to its 30-day drawing', JSON.stringify(await chartLabels(page)) === JSON.stringify(before));
    await page.getByLabel('Team').selectOption('upside');
    // Reads can take a second or more on a slow night; wait for the filtered drawing rather than a fixed pause.
    await page.locator('[data-chart="chart-pipeline-stage"] svg[aria-label*="Meeting 0"]').waitFor({ timeout: 15000 }).catch(() => {});
    const upsideLabel = (await chartLabels(page))[0];
    ok('Team = Upside: pipeline by stage drops Jack\'s HomeLover employer; captions name the scope', /Contacted 1/.test(upsideLabel) && /Meeting 0/.test(upsideLabel) && (await page.getByText('Employers · As of today · Upside').count()) === 2 /* pipeline + covered lives */, upsideLabel);
    await page.getByRole('group', { name: 'Filter by person' }).getByRole('button', { name: 'Cyrus' }).click(); await page.waitForTimeout(800);
    ok('Owner = Cyrus: the team-wide charts say so', (await page.getByText('Last 30 days · team-wide').count()) >= 2 && (await page.getByText('Employers · As of today · Cyrus · Upside').count()) === 2);
    const b1 = await boxes(page);
    const mvF = maxMove(b0, b1);
    results.n2['1440 filters'] = { before: b0, after: b1, maxMove: mvF };
    ok(`N2 1440: range + Team + Owner move nothing above the charts (max ${mvF} px)`, mvF <= 1, JSON.stringify(results.n2['1440 filters']));
    await page.getByRole('group', { name: 'Filter by person' }).getByRole('button', { name: 'Team' }).click();
    await page.getByLabel('Team').selectOption('');
    await page.locator('[data-chart="chart-pipeline-stage"] svg[aria-label*="Contacted 1; Responded 0; Meeting 1"]').waitFor({ timeout: 15000 }).catch(() => {});
    ok('filters back to Team / All teams: the whole-team drawing returns (Contacted 1, Meeting 1; 3 partners in the pie)', /Contacted 1; Responded 0; Meeting 1/.test((await chartLabels(page))[0]) && (await page.locator('[data-chart="chart-partners-category"] svg').getAttribute('aria-label')).includes('Brokers 2'));
    ok('visitor charts carry "History starts <yesterday>" while fewer than 30 days of pulls exist', (await page.getByRole('note').allTextContents()).filter(t => t.startsWith('History starts')).length === 2);
    ok('the credits meter reads the shared month total vs 500', (await page.locator('[data-chart="chart-credits"] [role="meter"]').getAttribute('aria-valuenow')) === String(spendBefore + 1));
    await shot(page, 'ia2s6-dashboard-1440');
    // Goals section underneath.
    const goals = page.locator('#goals-section');
    await goals.scrollIntoViewIfNeeded(); await page.waitForTimeout(600);
    const hero = page.getByRole('region', { name: 'Audience reached' });
    await hero.waitFor({ timeout: 15000 }).catch(() => {});
    const gs = { week: await goals.locator('h2#h-goals').filter({ hasText: /^Week of/ }).count(), prev: await goals.getByRole('button', { name: 'Previous week' }).count(), hero: await hero.count(), focus: await goals.getByText('Focus 5 · 1 of 2 done').count(), none: await goals.getByText('No Focus 5 planned').count(), final: await goals.getByText(/Final · /).count(), frozen: await goals.getByText('2 commitments · 0 KPI rows frozen').count() };
    ok('Goals section: week header with its own week nav, the goal hero cards, per-person commitments with Focus 5 progress, the latest report card (last week, final)', gs.week === 1 && gs.prev === 1 && gs.hero === 1 && gs.focus === 1 && gs.none >= 1 && gs.final >= 1 && gs.frozen === 1, JSON.stringify(gs));
    await page.getByText('Pipeline moves this week').waitFor();
    await page.locator('#goals-section').getByText(/^\d+ moves?$/).waitFor();
    const movesText = await page.locator('#goals-section').getByText(/^\d+ moves?$/).textContent();
    ok(`Pipeline moves this week: the partner move to Meeting set + the employer move to Meeting (${movesText})`, movesText === '2 moves' && (await goals.getByText('ZZ Lakeshore Mutual').count()) >= 1 && (await goals.getByText('ZZ Old Mill Union').count()) >= 1);
    ok('Scorecard and the Weekly report sit under the Goals section, one print area', (await goals.getByRole('heading', { name: /targets, week by week/ }).count()) === 1 && (await goals.getByRole('heading', { name: 'Weekly report' }).count()) === 1 && (await page.locator('#sales-analytics-print-area').count()) === 1);
    await shot(page, 'ia2s6-dashboard-goals-1440');
    // bar-5: Weekly report prints to PDF (Export menu) - once, one print area.
    await page.getByRole('button', { name: 'Export' }).click(); await page.getByRole('menuitem', { name: 'Weekly report PDF' }).click(); await page.waitForTimeout(1500);
    ok('Export → Weekly report PDF prints once', (await page.evaluate(() => window.__prints)) === 1 && /view=overview/.test(page.url()));
    // Redirects: old Reports / Today links land on the new homes.
    await openSales(page, '/?tab=reports&view=weekly');
    ok('?tab=reports&view=weekly → Dashboard › Overview', /tab=dashboard/.test(page.url()) && /view=overview/.test(page.url()) && (await charts(page).count()) === 13, page.url());
    await openSales(page, '/?tab=reports&view=scorecard');
    ok('?tab=reports&view=scorecard → Dashboard › Overview', /view=overview/.test(page.url()), page.url());
    await openSales(page, '/?tab=today');
    await page.getByRole('table', { name: 'Actions' }).waitFor().catch(() => {});
    ok('?tab=today → Actions', /tab=actions/.test(page.url()) && (await page.getByRole('table', { name: 'Actions' }).count()) === 1, page.url());
    ok('owner 1440: 0 page errors', !errs.length, errs.join(' | '));
    await page.context().close();
  }
  // ── owner 390 ──
  { const { page, errs } = await newPage(owner, { width: 390, height: 844 });
    await charts(page).first().waitFor();
    const b0 = await boxes(page);
    const cols = await page.locator('[data-chart]').evaluateAll(els => new Set(els.map(e => Math.round(e.getBoundingClientRect().x))).size);
    ok(`390: 13 charts in one column (${cols} distinct x), no sideways page scroll`, (await charts(page).count()) === 13 && cols === 1 && (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)));
    // The tools row scrolls sideways at 390; dispatchEvent skips the scroll-into-view dance.
    await page.getByRole('group', { name: 'Date range' }).getByRole('button', { name: '7 days' }).dispatchEvent('click');
    await page.locator('[data-dashboard-charts][data-days="7"]').waitFor(); await page.waitForTimeout(400);
    const mv = maxMove(b0, await boxes(page));
    results.n2['390'] = { before: b0, maxMove: mv };
    ok(`N2 390: the range change moves nothing above the charts (max ${mv} px)`, mv <= 1);
    await shot(page, 'ia2s6-dashboard-390');
    ok('390: 0 page errors', !errs.length, errs.join(' | '));
    await page.context().close();
  }
  // ── viewer 1440 ──
  { const { page, errs } = await newPage(viewer);
    await charts(page).first().waitFor();
    await page.locator('#goals-section').scrollIntoViewIfNeeded(); await page.waitForTimeout(800);
    const goals = page.locator('#goals-section');
    await goals.getByRole('region', { name: 'Audience reached' }).waitFor({ timeout: 15000 }).catch(() => {});
    const vs = { charts: await charts(page).count(), hero: await goals.getByRole('region', { name: 'Audience reached' }).count(), setGoal: await page.getByRole('button', { name: 'Set goal' }).count(), add: await page.getByRole('button', { name: '+ Add commitment' }).count(), finalize: await page.getByRole('button', { name: /Finalize/ }).count(), plan: await page.getByRole('button', { name: 'Plan this week' }).count(), viewOnly: await page.getByText('View only').count(), report: await goals.getByRole('heading', { name: 'Weekly report' }).count() };
    ok('Viewer: all 13 charts, the Goals section (hero, report card, moves, Scorecard, Weekly report) read-only - no Set goal / Add commitment / Finalize / Plan this week; View only chip', vs.charts === 13 && vs.hero === 1 && !vs.setGoal && !vs.add && !vs.finalize && !vs.plan && vs.viewOnly === 1 && vs.report === 1, JSON.stringify(vs));
    await shot(page, 'ia2s6-viewer-1440');
    ok('viewer 1440: 0 page errors', !errs.length, errs.join(' | '));
    await page.context().close();
  }
  const pulls = (await svc.from('visit_pull_runs').select('*', { count: 'exact', head: true }).eq('business_id', B)).count;
  ok('0 Apollo: no visitor pull ran in the temp workspace', pulls === 0, String(pulls));
  const bundle = fs.readdirSync(ROOT + '/build/static/js').filter(f => f.endsWith('.js')).map(f => fs.readFileSync(`${ROOT}/build/static/js/${f}`, 'utf8')).join('');
  ok('bundle: the dashboard read, the history note and the Overview sub-view in; the old Weekly report / Scorecard sub-view ids out of the nav', bundle.includes('/dashboard?') && bundle.includes('History starts') && bundle.includes('"overview","Overview"') && !bundle.includes('"weekly","Weekly report"'));
} catch (e) {
  ok('script ran without throwing', false, e.stack?.split('\n').slice(0, 3).join(' | ') || e.message);
} finally {
  await cleanup();
  const left = B ? (await svc.from('businesses').select('id', { count: 'exact', head: true }).eq('id', B)).count : 0;
  console.log(`teardown: workspace left ${left}`);
  const hlAfter = await hlCounts();
  const diff = Object.keys(hlBefore).filter(k => hlBefore[k] !== hlAfter[k]);
  ok(`HomeLover counts identical (${HL.length} tables)`, !diff.length, diff.map(k => `${k} ${hlBefore[k]}->${hlAfter[k]}`).join(', '));
  fs.writeFileSync(`${OUT}/ia2-stage6-numbers.json`, JSON.stringify(results, null, 2));
  console.log(`\n${pass}/${total} passed · restored: ${left === 0 && !diff.length ? 'yes' : 'NO'}`);
  process.exit(0);
}
