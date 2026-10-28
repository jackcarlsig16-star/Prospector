// ui-clarity-v1 Stage 2 - the Stage 0 measurement, re-run on every Sales & Marketing screen + the Tasks drawer after the
// rollout, with the N2 layout check and the Weekly report print check. Shares scripts/verify/lib/contrastMeasure.cjs.
// SCOPE (declared): TEMP data only - 1 workspace (goals_sales on, added to SALES_ANALYTICS_BUSINESS_IDS for the local
// server only) + 2 temp users (owner "Jack Test", member "Cyrus Temp"); ~50 rows across 14 tables (partners, employers,
// target, web visits incl. a P4, signals, email counts, week goals, report, people rows + messages + activity, 1 fake
// research run). Made-up names; no emails or phones. HomeLover never written (counts compared before/after).
// 0 Apollo and 0 Claude: the sync / apollo / visit-pull / tidy / research / anthropic routes are aborted in the browser,
// and research_runs + visit_pull_runs for the temp workspace are counted before teardown (must equal the fixture's 1 + 0).
// Runtime ~4-5 min, hard cap 330 s (tempGuard), teardown deletes everything. Reads computed colours of every rendered text
// node + control on 8 screens x 2 widths + the Tasks drawer (2 lists) x 2 widths, the /kit StatusPill box, N2 landmarks.
// Outputs uic2-*.png + uic2-contrast.json + uic2-report.txt into .screenshots/ui-clarity-v1 (gitignored; NOT build/,
// which npm run build empties).
// Usage: node scripts/verify/ui-clarity-v1-stage2.mjs [outdir]   (run npm run build first)
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const { measureScript, summarize, formatWorst } = require(ROOT + '/scripts/verify/lib/contrastMeasure.cjs');
const OUT = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(ROOT, '.screenshots', 'ui-clarity-v1');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3982;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const NAME = 'ZZ UI Clarity Stage2';
const HL = ['sales_week_goals', 'sales_signals', 'sales_targets', 'sales_goals', 'sales_opportunities', 'sales_partner_events', 'sales_opportunity_events', 'web_visits', 'sales_email_daily_counts', 'sales_week_report', 'sales_prospect_state', 'sales_email_messages', 'sales_email_activity', 'sales_sync_runs', 'research_runs'];
const TEMP_TABLES = ['sales_week_goal_steps', 'sales_week_goals', 'sales_week_plans', 'sales_week_report_sections', 'sales_week_report', 'sales_signals', 'sales_suggestions', 'web_visits', 'visit_pull_runs', 'sales_email_daily_counts', 'research_runs', 'sales_prospect_events', 'sales_email_activity', 'sales_email_messages', 'sales_prospect_state', 'sales_raw_snapshots', 'sales_sync_runs', 'sales_huddles', 'sales_partner_events', 'sales_opportunity_events', 'sales_targets', 'sales_opportunities', 'sales_goals', 'auth_events', 'business_members'];
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const count = async (t, col, v) => (await svc.from(t).select('*', { count: 'exact', head: true }).eq(col, v)).count;
const hlCounts = async () => { const o = {}; for (const t of HL) o[t] = await count(t, 'business_id', HOMELOVER); return o; };
let srv, browser, B, users = [];
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  if (B) {
    for (const t of TEMP_TABLES) { const r = await svc.from(t).delete().eq('business_id', B); if (r.error) console.log(`cleanup ${t}: ${r.error.message}`); }
    await svc.from('businesses').delete().eq('id', B);
  }
  for (const u of users) { await svc.from('auth_events').delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('actor_id', u.id); await svc.auth.admin.deleteUser(u.id); }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 330000 });
const laToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const monday = d => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));
fs.mkdirSync(OUT, { recursive: true });
const hlBefore = await hlCounts();
log('HomeLover before', JSON.stringify(hlBefore));
const results = { screens: {}, n2: {}, statusPill: null, print: null, calls: null, checks: [], errors: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${detail}` : ''); };

const SCREEN = measureScript({ scope: '#sales-analytics-root' });
const WINDOW = measureScript({ scope: 'aside[data-center-window]' });
const DRAWER = measureScript({ scope: 'aside[aria-labelledby="task-drawer-title"]' });
// N2 landmarks: the rows that must never move or change height between screens (sales-ia-v2) and after this stage.
const BOXES = `(() => Object.fromEntries(['data-workspace-header', 'data-sales-tabrow', 'data-sales-subviews', 'data-sales-frame', 'data-channel-row', 'data-filter-row'].map(a => {
  const el = document.querySelector('[' + a + ']'); if (!el) return [a, null];
  const r = el.getBoundingClientRect(); return [a, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }];
})))()`;

try {
  const tag = 'uic2-' + Date.now();
  B = ins(await svc.from('businesses').insert({ name: NAME, website_url: 'https://uic2.example.com', color: '#6F8CF0', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
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
  const owner = await mk('Jack Test', 'owner'), cyrus = await mk('Cyrus Temp', 'member');
  const today = laToday(), week = monday(today), lastWeek = addDays(week, -7), yesterday = addDays(today, -1);
  const ago = h => new Date(Date.now() - h * 3600e3).toISOString();
  const [p1, p2] = ins(await svc.from('sales_goals').insert([
    { business_id: B, goal_type: 'partnership', name: 'ZZ Lakeshore Mutual', category: '3. Brokers', pipeline_status: 'meeting_set', priority: 1, owner_user_id: owner.id, owner_team: 'homelover', channel: 'manual', tier: '1', last_touch_at: ago(30) },
    { business_id: B, goal_type: 'partnership', name: 'ZZ Northwind Benefits', category: '3. Brokers', pipeline_status: 'first_email_sent', owner_user_id: cyrus.id, owner_team: 'both', channel: 'import', tier: '2', last_touch_at: ago(200) },
    { business_id: B, goal_type: 'partnership', name: 'ZZ Current Co', category: '1. Current partners', pipeline_status: 'live', owner_team: 'upside', channel: 'partner_referral' },
    { business_id: B, goal_type: 'partnership', name: 'ZZ Quiet Gyms', category: '2. Gyms', pipeline_status: 'not_started', channel: 'manual' },
  ]).select('id, name'));
  const [mill] = ins(await svc.from('sales_opportunities').insert([
    { business_id: B, organization: 'ZZ Old Mill Union', org_type: 'employer', stage: 'contacted', source: 'manual', channel: 'call_note', owner: 'Jack Test', owner_team: 'homelover', covered_lives: 1200, notes: '(10/20) Named on a call' },
    { business_id: B, organization: 'ZZ Riverbend Schools', org_type: 'employer', stage: 'contacted', source: 'manual', channel: 'scout', owner: 'Cyrus Temp', owner_team: 'upside', covered_lives: 800 },
  ]).select('id'));
  ins(await svc.from('sales_opportunities').update({ stage: 'meeting' }).eq('id', mill.id).select('id'));
  ins(await svc.from('sales_opportunity_events').update({ changed_at: `${addDays(week, -7)}T12:00:00Z` }).eq('business_id', B).eq('event_type', 'created').select('id'));
  ins(await svc.from('sales_targets').insert({ business_id: B, name: 'ZZ Zeta Labs', kind: 'employer', status: 'researching', channel: 'scout' }).select('id'));
  const visit = (pulled_on, company_key, priority) => ({ business_id: B, pulled_on, company_key, company_name: company_key.toUpperCase(), priority, priority_rule: 'test', visits_7d: 3, last_visit: pulled_on, us_500: true, top_paths: ['/pricing'] });
  ins(await svc.from('web_visits').insert([visit(yesterday, 'zz acme', 'P1'), visit(yesterday, 'zz bolt', 'P3'), visit(today, 'zz acme', 'P1'), visit(today, 'zz cove', 'P2'), visit(today, 'zz dune', 'P2'), visit(today, 'zz echo', 'P4'), visit(yesterday, 'zz echo', 'P4')]).select('id'));
  ins(await svc.from('sales_signals').insert([
    { business_id: B, source: 'scout', signal_week: week, company_name: 'ZZ Scout Co', company_key: 'zz scout co', kind: 'partner', kind_guessed: false, signal: 'Opened an office', why_now: 'Hiring', score: 55, status: 'new', created_by: owner.id },
    { business_id: B, source: 'scout', signal_week: week, company_name: 'ZZ Scout Two', company_key: 'zz scout two', kind: 'partner', kind_guessed: false, signal: 'Raised a round', why_now: 'Growth', score: 70, status: 'accepted', created_by: owner.id, decided_by: owner.id, decided_at: new Date().toISOString() },
    { business_id: B, source: 'web_visit', signal_week: week, company_name: 'ZZ Dune', company_key: 'zz dune', kind: 'employer', kind_guessed: true, signal: '3 visits', why_now: 'P2 This week', status: 'new', created_by: owner.id },
  ]).select('id'));
  const mail = (day, counts) => ({ business_id: B, day, mailbox: 'zz-mailbox', sequence_id: '', step: 0, delivered: 0, hard_bounced: 0, spam_blocked: 0, opened: 0, clicked: 0, replied: 0, ...counts });
  ins(await svc.from('sales_email_daily_counts').insert([mail(addDays(today, -8), { delivered: 100, hard_bounced: 3, spam_blocked: 2, opened: 40, clicked: 5, replied: 4 }), mail(yesterday, { delivered: 50, opened: 20, clicked: 2, replied: 3 }), mail(today, { delivered: 10, opened: 1, replied: 1 })]).select('day'));
  ins(await svc.from('sales_partner_events').insert({ business_id: B, goal_id: p1.id, event: 'status', from_status: 'replied', to_status: 'meeting_set', by_user: owner.id, at: new Date().toISOString() }).select('id'));
  const plan = ins(await svc.from('sales_week_plans').insert({ business_id: B, week_start: week, owner_user_id: owner.id, prompt: '', inputs: {}, proposals: [], chosen_count: 2, created_by: owner.id }).select('id').single());
  const wgRows = [
    { business_id: B, week_start: week, kind: 'todo', status: 'open', text: 'ZZ Send the deck', owner_user_id: owner.id, due_date: addDays(today, -2), link_type: 'partner', link_id: p2.id, created_by: owner.id },
    { business_id: B, week_start: week, kind: 'todo', status: 'done', text: 'ZZ Call back Old Mill', owner_user_id: owner.id, due_date: today, link_type: 'opportunity', link_id: mill.id, created_by: owner.id },
    { business_id: B, week_start: week, kind: 'todo', status: 'open', text: 'ZZ Draft the one-pager', owner_user_id: cyrus.id, due_date: addDays(today, 2), created_by: cyrus.id },
    { business_id: B, week_start: lastWeek, kind: 'waiting', status: 'open', text: 'the signed MSA', waiting_on: 'Pat', due_date: addDays(today, -5), link_type: 'partner', link_id: p1.id, created_by: owner.id },
    { business_id: B, week_start: week, kind: 'commitment', status: 'open', text: 'ZZ Book two partner meetings', owner_user_id: owner.id, plan_id: plan.id, plan_rank: 1, plan_reason: 'Pipeline is thin', created_by: owner.id },
    { business_id: B, week_start: week, kind: 'commitment', status: 'done', text: 'ZZ Ship the deck', owner_user_id: owner.id, plan_id: plan.id, plan_rank: 2, created_by: owner.id },
    { business_id: B, week_start: week, kind: 'todo', text: 'Follow up with Gale', status: 'open', owner_user_id: cyrus.id, prospect_contact_id: 'zz-g', flagged_by: owner.id, created_by: owner.id },
  ];
  ins(await svc.from('sales_week_goals').insert(wgRows.map(r => ({ contacts: [], sort_order: 0, ...r }))).select('id'));
  ins(await svc.from('sales_week_report').insert({ business_id: B, week_start: lastWeek, status: 'final', finalized_at: new Date(Date.now() - 3 * 864e5).toISOString(), finalized_by: owner.id, snapshot: { commitments: [{ id: 'x' }, { id: 'y' }], kpi: [] } }).select('week_start'));
  ins(await svc.from('research_runs').insert({ business_id: B, entity_type: 'partner', entity_id: p1.id, trigger: 'manual', status: 'done', model: 'fake', cost_usd: 0.001, created_by: owner.id, result: { summary: 'Fake research for the contrast check', size: '2,000 employees', hq_city: 'Chicago', first_angle: 'Housing perk for relocating staff', website: 'https://uic2.example.com', domain: 'uic2.example.com', website_confidence: 'low', source_urls: [] } }).select('id'));
  const run = ins(await svc.from('sales_sync_runs').insert({ business_id: B, trigger: 'manual', status: 'success', started_at: ago(3), finished_at: ago(3) }).select('id').single());
  ins(await svc.from('sales_raw_snapshots').insert({ business_id: B, run_id: run.id, entity: 'sequences', payload: [{ id: 'zs-1', name: 'Car Rental' }, { id: 'zs-2', name: 'Benefits Leads' }] }).select('id'));
  ins(await svc.from('sales_prospect_state').insert([
    { business_id: B, contact_id: 'zz-a', name: 'Avery Opener', company: 'ZZ Lakeshore Mutual', title: 'HR Director', owner: 'jack', status: 'new' },
    { business_id: B, contact_id: 'zz-b', name: 'Blake Replier', company: 'ZZ Old Mill Union', title: 'Benefits Lead', owner: 'cyrus', status: 'contacted', opportunity_id: mill.id },
    { business_id: B, contact_id: 'zz-c', name: 'Casey Clicker', company: 'Cobalt Co', owner: 'unassigned', status: 'new' },
    { business_id: B, contact_id: 'zz-d', name: 'Dana Booked', company: 'Delta Dental', owner: 'jack', status: 'booked' },
    { business_id: B, contact_id: 'zz-e', name: 'Eli Snoozed', company: 'Echo Energy', owner: 'cyrus', status: 'not_now', snooze_until: addDays(today, 10) },
    { business_id: B, contact_id: 'zz-g', name: 'Gale Quiet', company: 'ZZ Quiet Gyms', owner: 'jack', status: 'new' },
  ]).select('contact_id'));
  ins(await svc.from('sales_email_messages').insert([
    { business_id: B, apollo_message_id: 'zm-a', contact_id: 'zz-a', sequence_id: 'zs-1', step: 2, delivered_at: ago(50), replied: false, subject: 'ZZ: 40% of your team' },
    { business_id: B, apollo_message_id: 'zm-b', contact_id: 'zz-b', sequence_id: 'zs-2', step: 1, delivered_at: ago(60), replied: true, reply_class: 'willing_to_meet', replied_seen_at: ago(5) },
    { business_id: B, apollo_message_id: 'zm-c', contact_id: 'zz-c', sequence_id: 'zs-1', step: 3, delivered_at: ago(40), replied: false },
    { business_id: B, apollo_message_id: 'zm-d', contact_id: 'zz-d', sequence_id: 'zs-2', step: 1, delivered_at: ago(70), replied: false },
    { business_id: B, apollo_message_id: 'zm-e', contact_id: 'zz-e', sequence_id: 'zs-1', step: 1, delivered_at: ago(70), replied: false },
    { business_id: B, apollo_message_id: 'zm-g', contact_id: 'zz-g', sequence_id: 'zs-2', step: 1, delivered_at: ago(240), replied: false },
  ]).select('apollo_message_id'));
  ins(await svc.from('sales_email_activity').insert([
    { business_id: B, apollo_message_id: 'zm-a', contact_id: 'zz-a', step: 2, event: 'open', occurred_at: ago(20) },
    { business_id: B, apollo_message_id: 'zm-a', contact_id: 'zz-a', step: 2, event: 'open', occurred_at: ago(3) },
    { business_id: B, apollo_message_id: 'zm-b', contact_id: 'zz-b', step: 1, event: 'open', occurred_at: ago(30) },
    { business_id: B, apollo_message_id: 'zm-c', contact_id: 'zz-c', step: 3, event: 'click', occurred_at: ago(8) },
  ]).select('id'));
  log('fixture in');

  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }

  browser = await chromium.launch();
  const blocked = [];
  async function newPage(u, { width = 1440, height = 900, url = '/?tab=dashboard' } = {}) {
    const errs = [];
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
    page.on('dialog', d => d.accept());
    await page.addInitScript(([k, v, b, dd]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      // actions-v2 REV2: Actions opens on the signed-in person with Housekeeping folded; these checks read the whole team, unfolded.
      localStorage.setItem('prospector_goals_owner', 'team'); localStorage.setItem('prospector_actions_folded', '[]');
      localStorage.setItem(`prospector_visits_ran_${b}`, dd); localStorage.setItem(`prospector_tidy_ran_${b}`, dd);
    }, [`sb-${REF}-auth-token`, JSON.stringify(u.session), B, today]);
    // Real-call guard: anything that could spend Apollo or Claude never leaves the browser.
    await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)|\/goals\/visits\/pull|\/goals\/tidy\/run|\/research\/run|\/research$|\/proxy\/anthropic/, route => { blocked.push(route.request().url()); route.abort(); });
    await page.goto(`http://localhost:${PORT}${url}`);
    await page.locator('#main-content').getByText(NAME).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').selectOption({ label: NAME }); await page.waitForTimeout(1200);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    return { page, errs, compact };
  }
  const tab = async (page, label) => { await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: new RegExp(`^${label}`) }).first().dispatchEvent('click'); await page.waitForTimeout(1200); };
  const sub = async (page, label) => { await page.locator('[data-sales-subviews]').getByRole('tab', { name: label, exact: true }).dispatchEvent('click'); await page.waitForTimeout(1200); };
  const settle = async (page, loc) => { if (loc) await page.locator(loc).first().waitFor({ timeout: 20000 }).catch(e => results.errors.push(`wait ${loc}: ${e.message.split('\n')[0]}`)); await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(1200); };
  const shot = (page, n, full) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide', fullPage: full });
  const measure = async (page, key, script) => {
    const m = await page.evaluate(script);
    if (m.error) { results.errors.push(`${key}: ${m.error}`); return null; }
    const s = summarize(m);
    results.screens[key] = s;
    log(key, `text ${s.textFails}/${s.texts} (<4.5)`, `controls ${s.controlFails}/${s.controls} (<3, ${s.controlFailsTextOnly} text-only)`, `scroll ${m.scrollW}/${m.vw}`);
    return s;
  };
  const maxMove = (a, b, keys) => Math.max(...keys.map(k => (a[k] && b[k] ? Math.max(Math.abs(a[k].x - b[k].x), Math.abs(a[k].y - b[k].y), Math.abs(a[k].h - b[k].h)) : 0)));

  const SCREENS = [
    ['dashboard-overview', ['Dashboard', 'Overview'], '[data-chart]'],
    ['dashboard-analytics', ['Dashboard', 'Analytics'], null],
    ['dashboard-sequenced', ['Dashboard', 'Sequenced'], null],
    ['pipeline-companies', ['Pipeline', 'Companies'], '[data-pipeline-companies] [data-row]'],
    ['pipeline-people', ['Pipeline', 'People'], '[data-pipeline-people] [data-row]'],
    ['pipeline-partners', ['Pipeline', 'Partner workflow'], null],
    ['actions', ['Actions', null], '[data-actions] [data-row]'],
  ];
  for (const width of [1440, 390]) {
    const { page, errs, compact } = await newPage(owner, { width, height: width === 390 ? 844 : 900 });
    const boxes = {};
    for (const [key, [t, s], wait] of SCREENS) {
      await tab(page, t); if (s) await sub(page, s);
      await settle(page, wait);
      await shot(page, `uic2-${key}-${width}`, true);
      await measure(page, `${key}@${width}`, SCREEN);
      boxes[key] = await page.evaluate(BOXES);
    }
    // N2 across screens: the header, tab row, sub-view switch and frame row sit at one x/y/height everywhere.
    const ref = boxes['dashboard-overview'];
    const mv = Math.max(...Object.values(boxes).map(b => maxMove(ref, b, ['data-workspace-header', 'data-sales-tabrow', 'data-sales-subviews', 'data-sales-frame'])));
    results.n2[`${width} across screens`] = { ref, maxMove: mv };
    ok(`N2 ${width}: header, tab row, sub-view switch and frame row at the same x/y/height on all 7 screens (max move ${mv} px)`, mv <= 1, JSON.stringify(ref));
    ok(`N2 ${width}: the tab row is 38 px, the channel and filter rows 36 px (sales-ia-v2 constants)`, ref['data-sales-tabrow']?.h === 38 && boxes['pipeline-companies']['data-channel-row']?.h === 36 && boxes['pipeline-companies']['data-filter-row']?.h === 36 && boxes['pipeline-people']['data-channel-row']?.h === 36, JSON.stringify({ tab: ref['data-sales-tabrow'], channel: boxes['pipeline-companies']['data-channel-row'], filter: boxes['pipeline-companies']['data-filter-row'], people: boxes['pipeline-people']['data-channel-row'] }));
    // N2 on Companies: three filters + the channel change move nothing above the table.
    await tab(page, 'Pipeline'); await sub(page, 'Companies'); await settle(page, '[data-pipeline-companies] [data-row]');
    const above = () => page.evaluate(() => Object.fromEntries([['frame', document.querySelector('[data-sales-frame]')], ['channel', document.querySelector('[data-channel-row]')], ['filters', document.querySelector('[data-filter-row]')], ['table', document.querySelector('.ui-table-box, .ui-list')]].map(([k, el]) => [k, el ? Math.round(el.getBoundingClientRect().y) : null])));
    const b0 = await above();
    if (!compact) {
      await page.getByRole('button', { name: 'Visited 7 d' }).click(); await page.getByRole('button', { name: 'Has open to-do' }).click(); await page.getByLabel('Priority', { exact: true }).selectOption('1'); await page.waitForTimeout(400);
      await page.locator('[data-channel-row]').getByRole('button', { name: /^Website visitors/ }).click(); await page.waitForTimeout(600);
    } else {
      await page.getByRole('button', { name: /^Filters/ }).click(); await page.waitForTimeout(400);
      const sheet = page.getByRole('dialog', { name: 'Filters' });
      await sheet.getByRole('button', { name: 'Visited 7 d' }).click(); await sheet.getByRole('button', { name: /^Show / }).click(); await page.waitForTimeout(400);
    }
    const b1 = await above();
    const mvF = Math.max(...Object.keys(b0).map(k => (b0[k] != null && b1[k] != null ? Math.abs(b0[k] - b1[k]) : 0)));
    results.n2[`${width} filters`] = { before: b0, after: b1, maxMove: mvF };
    ok(`N2 ${width}: filters + a channel change move nothing above the table (max ${mvF} px)`, mvF <= 1, JSON.stringify({ b0, b1 }));
    await shot(page, `uic2-pipeline-companies-filtered-${width}`, false);
    // Leave and come back: the filters reset on remount; the channel (kept in the URL) goes back to All by its chip.
    await tab(page, 'Actions'); await tab(page, 'Pipeline'); await sub(page, 'Companies'); await settle(page, '[data-pipeline-companies] [data-row]');
    await page.locator('[data-channel-row]').getByRole('button', { name: /^All/ }).dispatchEvent('click').catch(e => results.errors.push(`All chip@${width}: ${e.message.split('\n')[0]}`)); await page.waitForTimeout(600);
    // Company window: the partner row's name.
    await page.getByRole('button', { name: 'ZZ Lakeshore Mutual', exact: true }).first().dispatchEvent('click');
    const w = page.locator('aside[data-center-window]');
    await w.waitFor({ timeout: 15000 }).catch(e => results.errors.push(`window@${width}: ${e.message.split('\n')[0]}`));
    await settle(page, null);
    await shot(page, `uic2-company-window-${width}`, false);
    await measure(page, `company-window@${width}`, WINDOW);
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(400);
    // Tasks drawer: the tasks list, then Signals (Accept / Dismiss buttons + the pull line).
    await page.getByRole('button', { name: compact ? /^Tasks/ : /^Open tasks/ }).first().click(); await page.waitForTimeout(900);
    const drawer = page.locator('aside[aria-labelledby="task-drawer-title"]');
    await drawer.waitFor({ timeout: 15000 }).catch(e => results.errors.push(`drawer@${width}: ${e.message.split('\n')[0]}`));
    await page.waitForTimeout(600);
    await shot(page, `uic2-tasks-drawer-${width}`, false);
    await measure(page, `tasks-drawer@${width}`, DRAWER);
    await drawer.getByRole('button', { name: /^⚡ Signals/ }).click(); await page.waitForTimeout(900);
    await shot(page, `uic2-tasks-drawer-signals-${width}`, false);
    await measure(page, `tasks-drawer-signals@${width}`, DRAWER);
    await page.keyboard.press('Escape').catch(() => {});
    if (errs.length) results.errors.push(...errs.map(e => `${width}: ${e}`));
    await page.context().close();
  }

  // Weekly report PDF: the Dashboard under print media resolves the light print palette; /kit's StatusPill keeps its 24 px box.
  {
    const { page, errs } = await newPage(owner, { width: 1440, height: 900 });
    await page.emulateMedia({ media: 'print' }); await page.waitForTimeout(500);
    results.print = await page.evaluate(() => {
      const root = document.getElementById('sales-analytics-root'); const cs = getComputedStyle(root);
      return { ground: cs.getPropertyValue('--sa-ground').trim(), text: cs.getPropertyValue('--sa-text').trim(), bg: cs.backgroundColor };
    });
    await shot(page, 'uic2-dashboard-print', false);
    await page.emulateMedia({ media: 'screen' });
    ok('Weekly report PDF still prints light (--sa-ground #FFFFFF under print media)', results.print.ground.toUpperCase() === '#FFFFFF', JSON.stringify(results.print));
    await page.getByRole('button', { name: /^My profile/ }).first().click(); await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'UI kit' }).first().click();
    await page.locator('[data-ui-gallery]').waitFor({ timeout: 20000 }); await page.waitForTimeout(800);
    results.statusPill = await page.evaluate(() => [...document.querySelectorAll('[data-status]')].map(el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { h: Math.round(r.height), border: cs.borderTopWidth, borderColor: cs.borderTopColor }; }));
    ok(`StatusPill keeps its pre-Stage-1 box: 22 px tall (border-box) with a 1 px edge, now transparent, on all ${results.statusPill.length} pills`, results.statusPill.length > 0 && results.statusPill.every(p => p.h === 22 && p.border === '1px' && /rgba\(0, 0, 0, 0\)|transparent/.test(p.borderColor)), JSON.stringify(results.statusPill.slice(0, 3)));
    if (errs.length) results.errors.push(...errs.map(e => `print/kit: ${e}`));
    await page.context().close();
  }
  results.calls = { research_runs: await count('research_runs', 'business_id', B), visit_pull_runs: await count('visit_pull_runs', 'business_id', B), blockedRequests: blocked.length };
  ok('0 Claude / 0 Apollo: research_runs stayed at the fixture\'s 1, visit_pull_runs 0', results.calls.research_runs === 1 && results.calls.visit_pull_runs === 0, JSON.stringify(results.calls));
} catch (e) {
  results.errors.push('THROW ' + (e.stack?.split('\n').slice(0, 3).join(' | ') || e.message));
  log('THROW', e.message);
} finally {
  await cleanup();
  const left = B ? await count('businesses', 'id', B) : 0;
  const hlAfter = await hlCounts();
  const diff = Object.keys(hlBefore).filter(k => hlBefore[k] !== hlAfter[k]);
  results.restored = { workspaceLeft: left, homeloverDiff: diff.map(k => `${k} ${hlBefore[k]}->${hlAfter[k]}`), usersDeleted: users.length };
  fs.writeFileSync(`${OUT}/uic2-contrast.json`, JSON.stringify(results, null, 2));
  const totals = Object.values(results.screens).reduce((t, s) => ({ textFails: t.textFails + s.textFails, texts: t.texts + s.texts, controlFails: t.controlFails + s.controlFails, controls: t.controls + s.controls }), { textFails: 0, texts: 0, controlFails: 0, controls: 0 });
  const lines = [`ui-clarity-v1 Stage 2 - contrast after the rollout (${new Date().toISOString().slice(0, 10)}, temp workspace, 0 Apollo, 0 Claude)`, '', 'Per screen (text fails/total · controls fails/total · text-only · disabled · page scroll)'];
  for (const [k, s] of Object.entries(results.screens)) lines.push(`  ${k.padEnd(28)} text ${String(s.textFails).padStart(3)}/${String(s.texts).padEnd(4)} controls ${String(s.controlFails).padStart(3)}/${String(s.controls).padEnd(4)} text-only ${s.controlFailsTextOnly} · disabled ${s.controlFailsDisabled + s.textFailsDisabled} · scroll ${s.scrollW}/${s.vw}`);
  lines.push(`  TOTAL text ${totals.textFails}/${totals.texts} · controls ${totals.controlFails}/${totals.controls}`, '');
  for (const c of results.checks) lines.push(`${c.pass ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` - ${c.detail}` : ''}`);
  lines.push('');
  for (const [k, s] of Object.entries(results.screens)) if (s.worst.length) lines.push(formatWorst(k, s), '');
  if (results.errors.length) lines.push('errors:', ...results.errors.map(e => '  ' + e));
  fs.writeFileSync(`${OUT}/uic2-report.txt`, lines.join('\n'));
  console.log(lines.join('\n'));
  const pass = results.checks.filter(c => c.pass).length;
  console.log(`\nchecks ${pass}/${results.checks.length} · text fails ${totals.textFails} · control fails ${totals.controlFails} · workspace left ${left} · HomeLover diff ${diff.length ? diff.join(', ') : 'none'} · errors ${results.errors.length} · restored: ${left === 0 && !diff.length ? 'yes' : 'NO'}`);
  process.exit(0);
}
