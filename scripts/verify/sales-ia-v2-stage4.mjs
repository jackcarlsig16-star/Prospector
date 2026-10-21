// sales-ia-v2 REV2 Stage 4 bar 4 (P5 People = Huddle Live on the kit table: real statuses labelled, closed + snoozed
// behind "Show closed (n)", one filter row, every column sorts, row actions with Undo, Open company -> the P4 panel;
// Focus 5 done items fold into "n done"; the N2 layout check).
// SCOPE (declared): TEMP data only - 1 workspace (goals_sales on, added to SALES_ANALYTICS_BUSINESS_IDS for the local
// server only) + 3 temp users (owner, member "Cyrus Temp", viewer) + 7 prospects, 8 messages, 13 activity rows,
// 1 sequences snapshot, 2 partners, 1 employer (made-up names; no emails or phones anywhere). HomeLover is READ-ONLY:
// its live rows are built once by the real route function (service key) for the real-data counts; its table counts are
// compared before/after. 0 Apollo (sync and apollo routes aborted in the browser; sales_sync_runs and
// apollo_credit_spend checked). 0 Claude. Runtime ~3 min, hard cap 285 s (tempGuard), teardown deletes everything.
// Usage: node scripts/verify/sales-ia-v2-stage4.mjs <outdir>   (run npm run build first)
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
const PORT = 3975;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const NAME = 'ZZ Sales IA v2 Stage4';
const HL = ['sales_prospect_state', 'sales_prospect_events', 'sales_email_messages', 'sales_email_activity', 'sales_week_goals', 'sales_week_goal_steps', 'sales_huddles', 'sales_sync_runs', 'sales_goals', 'sales_opportunities', 'sales_targets'];
const TEMP_TABLES = ['sales_week_goal_steps', 'sales_week_goals', 'sales_prospect_events', 'sales_email_activity', 'sales_email_messages', 'sales_prospect_state', 'sales_raw_snapshots', 'sales_sync_runs', 'sales_huddles',
  'sales_partner_events', 'sales_opportunity_events', 'sales_opportunities', 'sales_goals', 'business_anthropic_usage', 'auth_events', 'business_members'];
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const hlCounts = async () => { const o = {}; for (const t of HL) { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HOMELOVER); o[t] = r.error ? `n/a ${r.error.message.slice(0, 30)}` : r.count; } return o; };
let srv, browser, B, users = [], pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
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
const fake = () => { const r = { body: null, code: 200, status(c) { r.code = c; return r; }, json(b) { r.body = b; } }; return r; };
const laToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const PII = /@|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/;

fs.mkdirSync(OUT, { recursive: true });
const hlBefore = await hlCounts();
console.log('HomeLover before', JSON.stringify(hlBefore));
const spendBefore = (await svc.from('apollo_credit_spend').select('*', { count: 'exact', head: true })).count;
const results = { homelover: {}, n2: {}, density: {} };
try {
  // ── HomeLover real-data counts (read-only, the route function with the service key) ──
  const { liveRoute } = await import(ROOT + '/api/sales/huddleLive.js');
  const hr = fake(); await liveRoute({ params: { businessId: HOMELOVER }, query: { show_closed: '1', limit: '1000' }, auth: { user: { id: 'verify' } } }, hr);
  const hlRows = hr.body?.rows || [];
  results.homelover = { status: hr.code, people: hlRows.length, closed: hlRows.filter(r => r.closed).length, snoozed: hlRows.filter(r => r.snoozed).length, open: hlRows.filter(r => !r.closed).length, by_status: Object.fromEntries([...new Set(hlRows.map(r => r.status_label))].map(s => [s, hlRows.filter(r => r.status_label === s).length])), with_heat: hlRows.filter(r => r.heat_7d > 0).length, sequences: hr.body?.sequences?.length ?? null };
  console.log('HOMELOVER people (read-only)', JSON.stringify(results.homelover));
  ok(`HomeLover live rows build (read-only): ${results.homelover.open} open + ${results.homelover.closed} closed, one page`, hr.code === 200 && hr.body.next_offset === null && !PII.test(JSON.stringify(hlRows.map(r => ({ ...r, apollo_url: '', linkedin_search_url: '', timeline: [] })))), hr.body?.error || '');

  // ── temp workspace + users + seed ──
  const tag = 'ia2s4-' + Date.now();
  B = ins(await svc.from('businesses').insert({ name: NAME, website_url: 'https://ia2.example.com', color: '#6F8CF0', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
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
  const today = laToday();
  const ago = h => new Date(Date.now() - h * 3600e3).toISOString();
  const partners = ins(await svc.from('sales_goals').insert([
    { business_id: B, goal_type: 'partnership', name: 'Acme Rentals', pipeline_status: 'researching', channel: 'manual', tier: '1' },
    { business_id: B, goal_type: 'partnership', name: 'Gamma Gyms', pipeline_status: 'not_started', channel: 'manual' },
  ]).select('id, name'));
  const emp = ins(await svc.from('sales_opportunities').insert({ business_id: B, organization: 'Beta Benefits', org_type: 'employer', stage: 'contacted', source: 'manual', channel: 'apollo_outbound', covered_lives: 1200 }).select('id').single());
  const run = ins(await svc.from('sales_sync_runs').insert({ business_id: B, trigger: 'manual', status: 'success', started_at: ago(3), finished_at: ago(3) }).select('id').single());
  ins(await svc.from('sales_raw_snapshots').insert({ business_id: B, run_id: run.id, entity: 'sequences', payload: [{ id: 'zs-1', name: 'Car Rental' }, { id: 'zs-2', name: 'Benefits Leads' }] }).select('id'));
  ins(await svc.from('sales_prospect_state').insert([
    { business_id: B, contact_id: 'zz-a', name: 'Avery Opener', company: 'Acme Rentals', title: 'HR Director', owner: 'jack', status: 'new' },
    { business_id: B, contact_id: 'zz-b', name: 'Blake Replier', company: 'Beta Benefits', title: 'Benefits Lead', owner: 'cyrus', status: 'contacted', opportunity_id: emp.id },
    { business_id: B, contact_id: 'zz-c', name: 'Casey Clicker', company: 'Cobalt Co', owner: 'unassigned', status: 'new' },
    { business_id: B, contact_id: 'zz-d', name: 'Dana Booked', company: 'Delta Dental', owner: 'jack', status: 'booked' },
    { business_id: B, contact_id: 'zz-e', name: 'Eli Snoozed', company: 'Echo Energy', owner: 'cyrus', status: 'not_now', snooze_until: addDays(today, 10) },
    { business_id: B, contact_id: 'zz-f', name: 'Finn Dead', company: 'Foxtrot Foods', owner: 'jack', status: 'dead' },
    { business_id: B, contact_id: 'zz-g', name: 'Gale Quiet', company: 'Gamma Gyms', owner: 'jack', status: 'new' },
  ]).select('contact_id'));
  ins(await svc.from('sales_email_messages').insert([
    { business_id: B, apollo_message_id: 'zm-a', contact_id: 'zz-a', sequence_id: 'zs-1', step: 2, delivered_at: ago(50), replied: false, subject: 'ZZ: 40% of your team' },
    { business_id: B, apollo_message_id: 'zm-b', contact_id: 'zz-b', sequence_id: 'zs-2', step: 1, delivered_at: ago(60), replied: true, reply_class: 'willing_to_meet', replied_seen_at: ago(5) },
    { business_id: B, apollo_message_id: 'zm-c', contact_id: 'zz-c', sequence_id: 'zs-1', step: 3, delivered_at: ago(40), replied: false },
    { business_id: B, apollo_message_id: 'zm-d', contact_id: 'zz-d', sequence_id: 'zs-2', step: 1, delivered_at: ago(70), replied: false },
    { business_id: B, apollo_message_id: 'zm-e', contact_id: 'zz-e', sequence_id: 'zs-1', step: 1, delivered_at: ago(70), replied: false },
    { business_id: B, apollo_message_id: 'zm-f', contact_id: 'zz-f', sequence_id: 'zs-1', step: 1, delivered_at: ago(70), replied: false },
    { business_id: B, apollo_message_id: 'zm-g', contact_id: 'zz-g', sequence_id: 'zs-2', step: 1, delivered_at: ago(240), replied: false },
  ]).select('apollo_message_id'));
  ins(await svc.from('sales_email_activity').insert([
    { business_id: B, apollo_message_id: 'zm-a', contact_id: 'zz-a', step: 2, event: 'open', occurred_at: ago(20) },
    { business_id: B, apollo_message_id: 'zm-a', contact_id: 'zz-a', step: 2, event: 'open', occurred_at: ago(3) },
    { business_id: B, apollo_message_id: 'zm-a', contact_id: 'zz-a', step: 2, event: 'open', occurred_at: ago(1) },
    { business_id: B, apollo_message_id: 'zm-b', contact_id: 'zz-b', step: 1, event: 'open', occurred_at: ago(30) },
    { business_id: B, apollo_message_id: 'zm-c', contact_id: 'zz-c', step: 3, event: 'click', occurred_at: ago(8) },
    { business_id: B, apollo_message_id: 'zm-c', contact_id: 'zz-c', step: 3, event: 'open', occurred_at: ago(9) },
    { business_id: B, apollo_message_id: 'zm-d', contact_id: 'zz-d', step: 1, event: 'open', occurred_at: ago(48) },
    { business_id: B, apollo_message_id: 'zm-e', contact_id: 'zz-e', step: 1, event: 'open', occurred_at: ago(49) },
    { business_id: B, apollo_message_id: 'zm-f', contact_id: 'zz-f', step: 1, event: 'open', occurred_at: ago(47) },
    { business_id: B, apollo_message_id: 'zm-g', contact_id: 'zz-g', step: 1, event: 'open', occurred_at: ago(230) }, // 9+ days ago: no heat
    { business_id: B, apollo_message_id: 'zm-g', contact_id: 'zz-g', step: 1, event: 'open', occurred_at: ago(228) },
  ]).select('id'));

  // Gale is already flagged to Cyrus (a Huddle flag = a to-do linked to the person), so the Flag column has a row to show.
  const monday = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
  ins(await svc.from('sales_week_goals').insert({ business_id: B, week_start: monday, kind: 'todo', text: 'Follow up with Gale', status: 'open', owner_user_id: cyrus.id, prospect_contact_id: 'zz-g', flagged_by: owner.id, created_by: owner.id }).select('id'));

  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const api = async (u, method, p, body) => {
    const res = await fetch(`http://localhost:${PORT}/api/sales/${B}${p}`, { method, headers: { Cookie: `prospector_at=${encodeURIComponent(u.session.access_token)}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const status = async id => ins(await svc.from('sales_prospect_state').select('status, snooze_until, notes').eq('business_id', B).eq('contact_id', id).single());
  // Poll a condition for up to 8 s (the optimistic UI, the PATCH and the live reload land at their own pace).
  const until = async (fn, ms = 8000) => { const t0 = Date.now(); let v = await fn(); while (!v && Date.now() - t0 < ms) { await new Promise(r => setTimeout(r, 400)); v = await fn(); } return v; };

  // ── API ──
  const all = await api(owner, 'GET', '/huddle/live?show_closed=1&limit=5000');
  const dflt = await api(owner, 'GET', '/huddle/live?limit=1000');
  const byId = Object.fromEntries((all.body?.rows || []).map(r => [r.contact_id, r]));
  ok('GET huddle/live show_closed=1: all 7 people on one page (limit clamps to 1000); the default drops the 3 closed (booked, snoozed, dead)',
    all.status === 200 && all.body.rows.length === 7 && all.body.next_offset === null && dflt.body.rows.length === 4 && dflt.body.closed_count === 3, `${all.body?.rows?.length}/${dflt.body?.rows?.length}`);
  ok('statuses labelled Active · Contacted · Booked · Not now · Not a fit; snoozed flagged with its date; closed flags',
    byId['zz-a']?.status_label === 'Active' && byId['zz-b']?.status_label === 'Contacted' && byId['zz-d']?.status_label === 'Booked' && byId['zz-e']?.status_label === 'Not now' && byId['zz-f']?.status_label === 'Not a fit'
    && byId['zz-e']?.snoozed === true && byId['zz-e']?.snooze_until === addDays(today, 10) && byId['zz-g']?.closed === false && [byId['zz-d'], byId['zz-e'], byId['zz-f']].every(r => r?.closed));
  ok('heat_7d = real opens + clicks in 7 d (Avery 3, Casey 2, Gale 0 - opens 9 days old); default order newest activity first; Blake carries opportunity_id',
    byId['zz-a']?.heat_7d === 3 && byId['zz-c']?.heat_7d === 2 && byId['zz-g']?.heat_7d === 0 && dflt.body.rows[0].contact_id === 'zz-a' && byId['zz-b']?.opportunity_id === emp.id, JSON.stringify(dflt.body.rows.map(r => r.contact_id)));
  ok('no email or phone shape in the live body (L1)', !PII.test(JSON.stringify(all.body.rows.map(r => ({ ...r, apollo_url: '', linkedin_search_url: '' })))));
  // Snooze + its Undo at the API (the page's Undo sends the previous values with expect = what it set).
  const sz = await api(owner, 'PATCH', '/prospects/zz-d', { status: 'not_now', snooze_until: addDays(today, 7) });
  const szU = await api(owner, 'PATCH', '/prospects/zz-d', { status: 'booked', snooze_until: null, expect: { status: 'not_now', snooze_until: addDays(today, 7) } });
  ok('API: snooze (not_now + snooze_until) then Undo with expect puts the previous values back', sz.status === 200 && szU.status === 200 && (await status('zz-d')).status === 'booked' && (await status('zz-d')).snooze_until === null, `${sz.status} ${sz.body?.error || ''} / ${szU.status} ${szU.body?.error || ''}`);
  const vw = await api(viewer, 'PATCH', '/prospects/zz-a', { status: 'contacted' });
  ok('Viewer: PATCH prospect is 403; GET live is 200', vw.status === 403 && (await api(viewer, 'GET', '/huddle/live')).status === 200, String(vw.status));

  // ── browser ──
  browser = await chromium.launch();
  async function newPage(u, { width = 1440, height = 900, url = '/', ws = NAME } = {}) {
    const errs = [];
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage(); page.setDefaultTimeout(12000);
    page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
    page.on('dialog', d => d.accept());
    await page.addInitScript(([k, v, b, d]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      localStorage.setItem(`prospector_visits_ran_${b}`, d); localStorage.setItem(`prospector_tidy_ran_${b}`, d);
    }, [`sb-${REF}-auth-token`, JSON.stringify(u.session), B, today]);
    await page.addInitScript(() => { window.__prints = 0; window.print = () => { window.__prints++; }; });
    await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)|\/goals\/visits\/pull/, route => route.abort());
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
  const tab = async (page, label) => { await page.locator('#workspace-header-tabs').getByRole('button', { name: new RegExp(`^${label}`) }).first().click(); await page.waitForTimeout(1500); };
  const sub = async (page, label) => { await page.locator('[data-sales-subviews]').getByRole('button', { name: label, exact: true }).click(); await page.waitForTimeout(1500); };
  const boxes = page => page.evaluate(() => Object.fromEntries(['data-sales-tabrow', 'data-sales-subviews', 'data-channel-row', 'data-filter-row'].map(a => {
    const el = document.querySelector(`[${a}]`); if (!el) return [a, null];
    const r = el.getBoundingClientRect(); return [a, { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, h: Math.round(r.height * 10) / 10 }];
  })));
  const tableTop = page => page.evaluate(() => { const b = document.querySelector('.ui-table-box, ul.ui-list'); return b ? Math.round(b.getBoundingClientRect().top * 10) / 10 : null; });
  const maxMove = (a, b) => Math.max(0, ...Object.keys(a).filter(k => a[k] && b[k]).flatMap(k => [Math.abs(a[k].x - b[k].x), Math.abs(a[k].y - b[k].y), Math.abs(a[k].h - b[k].h)]));
  const visibleRows = page => page.evaluate(() => {
    const H = window.innerHeight; const box = document.querySelector('.ui-table-box'); const bb = box ? box.getBoundingClientRect() : null;
    const rs = [...document.querySelectorAll('tr[data-row]')].map(tr => tr.getBoundingClientRect());
    return { full: rs.filter(r => bb && r.top >= bb.top && r.bottom <= Math.min(H, bb.bottom)).length, rendered: rs.length, rowH: rs.length ? Math.round(rs[0].height) : null, boxTop: bb ? Math.round(bb.top) : null, boxH: bb ? Math.round(bb.height) : null, docW: document.documentElement.scrollWidth, winW: window.innerWidth, struck: [...document.querySelectorAll('[data-pipeline-people] *')].filter(el => getComputedStyle(el).textDecorationLine.includes('line-through')).length };
  });
  const pinTable = async page => { await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(400); await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(400); };
  const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide' });
  const table = page => page.getByRole('table', { name: 'Pipeline people' });
  const header = (page, col) => table(page).locator('thead').getByRole('button', { name: new RegExp(`^${col}`) });
  const rowOf = (page, name) => page.locator('tr[data-row]').filter({ has: page.getByTitle(name, { exact: true }) });
  const names = page => page.locator('tr[data-row] td:first-child span[title]').evaluateAll(els => els.map(e => e.getAttribute('title')));
  const toast = page => page.locator('[aria-live="polite"] > div').first();
  const panelOf = (page, name) => page.getByRole('complementary', { name });

  // ── owner 1440: N2 + the bar-5 path ──
  { const { page, errs } = await newPage(owner, { url: '/?tab=pipeline&view=people' });
    await page.locator('tr[data-row]').first().waitFor();
    const n2 = {};
    for (const [t, s, key] of [['Actions', null, 'actions'], ['Dashboard', 'Weekly report', 'dashboard'], ['Pipeline', 'Companies', 'companies'], ['Pipeline', 'Partner workflow', 'partners'], ['Pipeline', 'People', 'people']]) { await tab(page, t); if (s) await sub(page, s); n2[key] = await boxes(page); }
    const ref = n2.people;
    const tabMove = Math.max(...Object.values(n2).map(b => Math.max(Math.abs(b['data-sales-tabrow'].x - ref['data-sales-tabrow'].x), Math.abs(b['data-sales-tabrow'].y - ref['data-sales-tabrow'].y))));
    const subMove = Math.max(...Object.values(n2).map(b => Math.max(Math.abs(b['data-sales-subviews'].y - ref['data-sales-subviews'].y), Math.abs(b['data-sales-subviews'].x - ref['data-sales-subviews'].x))));
    const chMove = Math.max(Math.abs(n2.people['data-channel-row'].y - n2.companies['data-channel-row'].y), Math.abs(n2.people['data-channel-row'].h - n2.companies['data-channel-row'].h));
    results.n2['1440 across tabs'] = { tabRow: ref['data-sales-tabrow'], subViews: ref['data-sales-subviews'], peopleTabRow: ref['data-channel-row'], peopleFilterRow: ref['data-filter-row'], companiesChannelRow: n2.companies['data-channel-row'], companiesFilterRow: n2.companies['data-filter-row'], tabRowMaxMove: tabMove, subViewsMaxMove: subMove, peopleVsCompaniesRowMove: chMove };
    console.log('N2 1440', JSON.stringify(results.n2['1440 across tabs']));
    ok(`N2 1440: tab row and sub-view switch at the same x/y on all 5 screens (max move ${tabMove} / ${subMove} px); People's tab strip is the same height as Companies' channel row (strip y differs by ${chMove} px: Focus 5 sits above it)`, tabMove <= 1 && subMove <= 1 && n2.people['data-channel-row'].h === n2.companies['data-channel-row'].h);
    await page.locator('tr[data-row]').first().waitFor();
    const d0 = await visibleRows(page);
    ok(`People: 28 px rows, 4 open people shown, no struck-through text, no Done rows, no sideways page scroll`, d0.rowH === 28 && d0.rendered === 4 && d0.struck === 0 && d0.docW <= d0.winW && (await table(page).getByRole('cell', { name: 'Done' }).count()) === 0, JSON.stringify(d0));
    results.density.temp1440 = d0;
    const act0 = await page.evaluate(() => { const box = document.querySelector('.ui-table-box').getBoundingClientRect(); const td = document.querySelector('tr[data-row] td.ui-table__sticky-end')?.getBoundingClientRect(); const first = document.querySelector('tr[data-row] td.ui-table__sticky')?.getBoundingClientRect(); return td && first && { right: Math.round(td.right), boxRight: Math.round(box.right), left: Math.round(td.left), firstRight: Math.round(first.right), scrollW: document.querySelector('.ui-table-box').scrollWidth, boxW: Math.round(box.width) }; });
    ok(`1440: the Actions column is pinned in view at the right edge without scrolling the box (table ${act0?.scrollW} px wide in a ${act0?.boxW} px box)`, !!act0 && act0.right <= act0.boxRight + 1 && act0.left > act0.firstRight && act0.scrollW > act0.boxW, JSON.stringify(act0));
    ok('Person = first name + last initial until saved on a record; the full name is the cell title; Blake (linked to an opportunity) shows in full',
      (await rowOf(page, 'Avery Opener').locator('td').first().innerText()).trim() === 'Avery O.' && (await rowOf(page, 'Blake Replier').locator('td').first().innerText()).trim() === 'Blake Replier');
    ok('statuses read Active / Contacted (Huddle\'s new / claimed / contacted under their labels)', (await table(page).getByText('Active', { exact: true }).count()) === 3 && (await table(page).getByText('Contacted', { exact: true }).count()) === 1);
    await shot(page, 'ia2s4-people-1440');
    // N2 on People: 3 filters + a notice move nothing above the table.
    const b0 = await boxes(page), t0 = await tableTop(page);
    await page.getByLabel('Owner').selectOption('jack'); await page.getByLabel('Status').selectOption('active'); await page.getByLabel('Last activity').selectOption('open'); await page.waitForTimeout(500);
    const b1 = await boxes(page), t1 = await tableTop(page);
    ok('filters Owner=Jack + Status=Active + Last activity=Opened: Avery and Gale only; Clear (3) resets', (await names(page)).join(',') === 'Avery Opener,Gale Quiet' && (await page.getByRole('button', { name: /^Clear/ }).innerText()).includes('3'), (await names(page)).join(','));
    await page.getByRole('button', { name: /^Clear/ }).click(); await page.waitForTimeout(400);
    // Show closed (3): the booked, snoozed and dead rows appear with their labels, dimmed; off again hides them.
    const showClosed = page.getByRole('button', { name: /^Show closed/ });
    ok('"Show closed (3)" - one toggle for closed + snoozed', (await showClosed.innerText()).replace(/\s+/g, ' ').trim() === 'Show closed (3)', await showClosed.innerText());
    await showClosed.click(); await page.waitForTimeout(400);
    const b2 = await boxes(page), t2 = await tableTop(page);
    ok('Show closed on: 7 rows; Dana Booked · Eli Not now until <date> · Finn Not a fit', (await names(page)).length === 7 && (await rowOf(page, 'Dana Booked').innerText()).includes('Booked') && (await rowOf(page, 'Eli Snoozed').innerText()).includes('Not now') && (await rowOf(page, 'Eli Snoozed').innerText()).includes('until') && (await rowOf(page, 'Finn Dead').innerText()).includes('Not a fit'));
    ok('…a Not a fit row offers Restore (no Mark contacted / Flag / Not a fit)', (await rowOf(page, 'Finn Dead').getByRole('button', { name: 'Restore' }).count()) === 1 && (await rowOf(page, 'Finn Dead').getByRole('button', { name: /Mark contacted|Flag|Not a fit/ }).count()) === 0);
    await showClosed.click(); await page.waitForTimeout(400);
    const moveF = Math.max(maxMove(b0, b1), maxMove(b0, b2));
    // Sort by Heat: click = asc, click again = desc (Avery 3 first); the choice is remembered.
    const heat = header(page, 'Heat');
    await heat.click(); await page.waitForTimeout(300); const asc = await names(page);
    await heat.click(); await page.waitForTimeout(300); const desc = await names(page);
    ok(`sort by Heat: asc puts Gale (0) first, desc puts Avery (3) first; header aria-sort descending; remembered in prospector_people_sort`, asc[0] === 'Gale Quiet' && desc[0] === 'Avery Opener' && desc[1] === 'Casey Clicker' && (await table(page).locator('th[aria-sort="descending"]').count()) === 1
      && (await page.evaluate(() => localStorage.getItem('prospector_people_sort'))) === '{"id":"heat","dir":"desc"}', `${asc.join(',')} | ${desc.join(',')}`);
    for (const col of ['Person', 'Title', 'Company', 'Last activity', 'Sequence', 'Signal', 'Owner', 'Status', 'Flag']) { await header(page, col).click(); await page.waitForTimeout(150); }
    ok('every column header sorts (9 more headers clicked, no page error)', (await table(page).locator('th[aria-sort="ascending"]').count()) === 1 && !errs.length, errs.join(' | '));
    await header(page, 'Last activity').click(); await header(page, 'Last activity').click(); await page.waitForTimeout(200);
    // filter Sequence
    await page.getByLabel('Sequence').selectOption({ label: 'Car Rental' }); await page.waitForTimeout(400);
    ok('filter Sequence = Car Rental: Avery and Casey (open rows in that sequence)', (await names(page)).sort().join(',') === 'Avery Opener,Casey Clicker', (await names(page)).join(','));
    await page.getByRole('button', { name: /^Clear/ }).click(); await page.waitForTimeout(400);
    // Not a fit one person -> Undo (10 s).
    await rowOf(page, 'Casey Clicker').getByRole('button', { name: 'Not a fit' }).click();
    await until(async () => (await status('zz-c')).status === 'dead' && !(await names(page)).includes('Casey Clicker'));
    const naf = await status('zz-c');
    const b3 = await boxes(page), t3 = await tableTop(page);
    ok('Not a fit: status dead + a dated notes line, the row leaves the list (closed), toast with Undo + Apollo link', naf.status === 'dead' && /^\(\d+\/\d+\) Not a fit$/.test(naf.notes) && (await names(page)).includes('Casey Clicker') === false && (await toast(page).getByRole('button', { name: 'Undo' }).count()) === 1 && (await toast(page).getByRole('link', { name: 'Apollo ↗' }).count()) === 1, JSON.stringify(naf));
    const moveN = maxMove(b0, b3);
    results.n2['1440 filters/notice'] = { before: b0, afterFilters: b1, afterShowClosed: b2, afterNotice: b3, tableTop: [t0, t1, t2, t3], maxMoveFilters: moveF, maxMoveNotice: moveN };
    ok(`N2 1440 People: 3 filters, Show closed and a notice move nothing above the table (max ${Math.max(moveF, moveN)} px; table top ${t0}/${t1}/${t2}/${t3})`, moveF <= 1 && moveN <= 1 && Math.abs(t0 - t1) <= 1 && Math.abs(t0 - t2) <= 1 && Math.abs(t0 - t3) <= 1);
    await shot(page, 'ia2s4-not-a-fit-toast-1440');
    await toast(page).getByRole('button', { name: 'Undo' }).click();
    await until(async () => (await status('zz-c')).status === 'new' && (await names(page)).includes('Casey Clicker'));
    const nafU = await status('zz-c');
    ok('…Undo: status new again, notes as before, the row is back', nafU.status === 'new' && nafU.notes === null && (await names(page)).includes('Casey Clicker'), JSON.stringify(nafU));
    // Mark contacted -> Undo.
    await rowOf(page, 'Avery Opener').getByRole('button', { name: 'Mark contacted' }).click();
    const mc = await until(async () => (await status('zz-a')).status === 'contacted' && (await rowOf(page, 'Avery Opener').innerText()).includes('Contacted') && (await rowOf(page, 'Avery Opener').getByRole('button', { name: 'Mark contacted' }).isDisabled()));
    ok('Mark contacted: status contacted, row says Contacted, the button disables', mc, (await status('zz-a')).status);
    await toast(page).getByRole('button', { name: 'Undo' }).click();
    ok('…Undo: status new', await until(async () => (await status('zz-a')).status === 'new'));
    // Snooze 1 week -> Undo.
    await rowOf(page, 'Avery Opener').getByLabel('Snooze Avery Opener').selectOption('7');
    await until(async () => (await status('zz-a')).status === 'not_now');
    const sn = await status('zz-a');
    ok('Snooze 1 week: status not_now + snooze_until today+7 (a snoozed row is closed: hidden, counted by Show closed - proven above)', sn.status === 'not_now' && sn.snooze_until === addDays(today, 7), JSON.stringify(sn));
    await toast(page).getByRole('button', { name: 'Undo' }).click();
    const snU = await until(async () => (await status('zz-a')).status === 'new' && (await status('zz-a')).snooze_until === null && (await names(page)).includes('Avery Opener'));
    ok('…Undo: new again, no snooze, row back', snU, `${JSON.stringify(await status('zz-a'))} toast="${(await toast(page).innerText().catch(() => '')).replace(/\s+/g, ' ')}"`);
    // Flag for a teammate -> a to-do with steps -> Undo removes it.
    await rowOf(page, 'Avery Opener').getByRole('button', { name: 'Flag' }).click();
    const dlg = page.getByRole('dialog', { name: /Flag Avery/ }); await dlg.waitFor();
    await dlg.getByRole('button', { name: /^Flag for Cyrus/ }).click();
    const flagOf = id => svc.from('sales_week_goals').select('id, owner_user_id, status, prospect_contact_id').eq('business_id', B).eq('prospect_contact_id', id).then(ins);
    await until(async () => (await flagOf('zz-a')).length === 1);
    const flags = await flagOf('zz-a');
    const galeRow = (await rowOf(page, 'Gale Quiet').innerText()).replace(/\s+/g, ' ');
    ok('Flag: one open to-do for Cyrus linked to the person; the Flag column reads ⚑ Cyrus (Gale, flagged in the fixture)', flags.length === 1 && flags[0].owner_user_id === cyrus.id && flags[0].status === 'open' && galeRow.includes('⚑ Cyrus'), `${JSON.stringify(flags)} gale="${galeRow}"`);
    await toast(page).getByRole('button', { name: 'Undo' }).click();
    ok('…Undo: the to-do is gone', await until(async () => (await flagOf('zz-a')).length === 0 && !(await rowOf(page, 'Avery Opener').innerText()).includes('⚑')));
    ok('…and the Flag column sorts (Gale first, descending)', await (async () => { await header(page, 'Flag').click(); await header(page, 'Flag').click(); await page.waitForTimeout(300); return (await names(page))[0] === 'Gale Quiet'; })());
    await header(page, 'Last activity').click(); await header(page, 'Last activity').click(); await page.waitForTimeout(200);
    // Open company -> the P4 panel (partner by name, employer via opportunity_id, nothing for an unknown company).
    await rowOf(page, 'Avery Opener').getByRole('button', { name: 'Open company' }).click();
    const pp = panelOf(page, 'Acme Rentals'); await pp.waitFor();
    ok('Open company (Avery): the company panel opens on the partner Acme Rentals with its action bar', (await pp.locator('[data-company-panel="partner"]').count()) === 1 && (await pp.getByRole('region', { name: 'Actions' }).count()) === 1);
    await shot(page, 'ia2s4-company-panel-1440');
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    await rowOf(page, 'Blake Replier').getByRole('button', { name: 'Beta Benefits' }).click();
    const ep = panelOf(page, 'Beta Benefits'); await ep.waitFor();
    ok('Company cell (Blake): the panel opens on the linked employer', (await ep.locator('[data-company-panel="employer"]').count()) === 1);
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    await rowOf(page, 'Casey Clicker').getByRole('button', { name: 'Open company' }).click(); await page.waitForTimeout(1500);
    ok('Open company on a company with no Pipeline record: a notice, no panel', (await page.getByRole('complementary').count()) === 0 && (await toast(page).innerText()).includes("isn't in the Pipeline yet"));
    // Tools row: Print agenda prints once; Done tab has a count slot that never shifts the strip.
    await page.getByRole('button', { name: 'Print agenda' }).click(); await page.waitForTimeout(300);
    ok('Print agenda (frame row) prints the Huddle sheet once', (await page.evaluate(() => window.__prints)) === 1);
    const strip0 = await boxes(page);
    await page.getByRole('tab', { name: /^Priorities/ }).click(); await page.waitForTimeout(1000);
    const strip1 = await boxes(page);
    ok('Live | Priorities | Done is one fixed-height strip; switching tabs moves nothing above it', (await page.locator('[data-channel-row]').count()) === 1 && Math.abs(strip0['data-channel-row'].y - strip1['data-channel-row'].y) <= 1 && Math.abs(strip0['data-sales-subviews'].y - strip1['data-sales-subviews'].y) <= 1);
    await page.getByRole('tab', { name: /^Live/ }).click(); await page.waitForTimeout(800);
    await pinTable(page);
    const d1 = await visibleRows(page);
    results.density.temp1440Pinned = d1;
    ok('owner 1440: 0 page errors', !errs.length, errs.join(' | '));
    await page.context().close();
  }

  // ── 390 owner: the phone list + filter sheet ──
  { const { page, errs } = await newPage(owner, { width: 390, height: 844, url: '/?tab=pipeline&view=people' });
    await page.locator('li[data-row]').first().waitFor();
    const n = await page.locator('li[data-row]').count();
    await page.getByRole('button', { name: /^Filters/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Filters' }); await sheet.waitFor();
    ok('390: card list (4 open people), Filters opens a sheet with Owner · Sequence · Last activity · Status · Search · Show closed; no sideways page scroll', n === 4 && (await sheet.getByLabel('Owner').count()) === 1 && (await sheet.getByLabel('Sequence').count()) === 1 && (await sheet.getByLabel('Last activity').count()) === 1 && (await sheet.getByLabel('Status').count()) === 1 && (await sheet.getByLabel('Search people').count()) === 1 && (await sheet.getByRole('button', { name: /^Show closed/ }).count()) === 1
      && await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `rows ${n}`);
    await sheet.getByRole('button', { name: /^Show closed/ }).click(); await sheet.getByRole('button', { name: /^Show 7/ }).click(); await page.waitForTimeout(400);
    ok('390: Show closed lists all 7', (await page.locator('li[data-row]').count()) === 7);
    await shot(page, 'ia2s4-people-390');
    ok('390: 0 page errors', !errs.length, errs.join(' | '));
    await page.context().close();
  }

  // ── Viewer ──
  { const { page, errs } = await newPage(viewer, { url: '/?tab=pipeline&view=people' });
    await page.locator('tr[data-row]').first().waitFor();
    const vParts = [await page.locator('tr[data-row]').count(), (await table(page).locator('tbody').getByRole('button', { name: /^(Mark contacted|Flag|Not a fit|Open company|Restore)$/ }).count()) + (await page.getByRole('button', { name: 'Sync now' }).count()), await page.getByLabel(/^Snooze /).count(), await page.getByText('View only').count()];
    ok('Viewer: rows shown; no Mark contacted / Flag / Snooze / Not a fit / Open company / Sync now; View only chip', vParts[0] === 4 && vParts[1] === 0 && vParts[2] === 0 && vParts[3] === 1, `rows/buttons/snooze/viewonly = ${vParts.join('/')}`);
    await page.getByRole('button', { name: 'Acme Rentals', exact: true }).click();
    const p = panelOf(page, 'Acme Rentals'); await p.waitFor();
    ok('Viewer: the company panel opens read-only (no action bar)', (await p.getByRole('region', { name: 'Actions' }).count()) === 0 && (await p.getByText('You have view access, so this is read-only.').count()) === 1);
    await page.keyboard.press('Escape');
    await tab(page, 'Dashboard'); await sub(page, 'Weekly report');
    await page.getByRole('button', { name: 'Export' }).click(); await page.getByRole('menuitem', { name: 'Weekly report PDF' }).click(); await page.waitForTimeout(1500);
    ok('Weekly report PDF still prints once, one print area (L7)', (await page.evaluate(() => window.__prints)) === 1 && (await page.locator('#sales-analytics-print-area').count()) === 1);
    ok('Viewer: 0 page errors', !errs.length, errs.join(' | '));
    await page.context().close();
  }

  const syncRuns = (await svc.from('sales_sync_runs').select('*', { count: 'exact', head: true }).eq('business_id', B)).count;
  const spendAfter = (await svc.from('apollo_credit_spend').select('*', { count: 'exact', head: true })).count;
  ok('0 Apollo: no sync ran beyond the seeded run row, apollo_credit_spend unchanged', syncRuns === 1 && spendAfter === spendBefore, `runs ${syncRuns} spend ${spendBefore}->${spendAfter}`);
  const bundle = fs.readdirSync(ROOT + '/build/static/js').filter(f => f.endsWith('.js')).map(f => fs.readFileSync(`${ROOT}/build/static/js/${f}`, 'utf8')).join('');
  ok('bundle: People table, Show closed, remembered sort, Snooze; no old Live row ids or timeline expand', bundle.includes('Pipeline people') && bundle.includes('Show closed') && bundle.includes('prospector_people_sort') && (bundle.includes('Snooze…') || bundle.includes('Snooze\\u2026')) && !bundle.includes('live-row-') && !bundle.includes('Expand timeline'));
} catch (e) {
  ok('script ran without throwing', false, e.stack?.split('\n').slice(0, 3).join(' | ') || e.message);
} finally {
  await cleanup();
  const left = B ? (await svc.from('businesses').select('id', { count: 'exact', head: true }).eq('id', B)).count : 0;
  console.log(`teardown: workspace left ${left}`);
  const hlAfter = await hlCounts();
  const diff = Object.keys(hlBefore).filter(k => hlBefore[k] !== hlAfter[k]);
  ok(`HomeLover counts identical (${HL.length} tables)`, !diff.length, diff.map(k => `${k} ${hlBefore[k]}->${hlAfter[k]}`).join(', '));
  fs.writeFileSync(`${OUT}/ia2-stage4-numbers.json`, JSON.stringify(results, null, 2));
  console.log(`\n${pass}/${total} passed · restored: ${left === 0 && !diff.length ? 'yes' : 'NO'}`);
  process.exit(0);
}
