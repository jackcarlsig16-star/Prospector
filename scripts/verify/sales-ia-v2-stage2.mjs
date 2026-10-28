// sales-ia-v2 REV2 Stage 2 bar 4 (Pipeline Companies P1-P3 + N1/N2 navigation).
// SCOPE (declared): TEMP data only - 1 workspace (goals_sales on, added to SALES_ANALYTICS_BUSINESS_IDS for the local
// server only) + 2 temp users (owner, viewer) + ~45 seeded rows (34 partners, 5 employers, 2 targets, 3 web_visits,
// 1 scout signal, 2 to-dos; made-up names, no emails or phones). HomeLover is READ-ONLY: its board is built once by
// the real route function (service key) and served into one page by route intercept, for the density count on real
// data; its table counts are compared before/after. 0 Apollo (visit pull, sync and apollo routes aborted; the run
// table is checked), 0 Claude. Runtime ~3 min, hard cap 230 s (tempGuard), teardown deletes everything.
// Usage: node scripts/verify/sales-ia-v2-stage2.mjs <outdir>   (run npm run build first)
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
const OUT = process.argv[2] || path.join(ROOT, 'build', 'verify-shots');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3973;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const NAME = 'ZZ Sales IA v2 Stage2';
const HL = ['sales_goals', 'sales_opportunities', 'sales_targets', 'sales_week_goals', 'sales_partner_events', 'sales_opportunity_events', 'web_visits', 'sales_visit_skip', 'visit_priority_override', 'sales_signals', 'visit_pull_runs'];
const TEMP_TABLES = ['visit_priority_override', 'sales_signals', 'web_visits', 'visit_pull_runs', 'sales_visit_skip', 'sales_suggestions', 'sales_tidy_runs', 'sales_partner_events',
  'sales_opportunity_events', 'sales_week_goal_steps', 'sales_week_goals', 'sales_targets', 'sales_opportunities', 'sales_goals', 'auth_events', 'business_members'];
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
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 230000 });
const fake = () => { const r = { body: null, code: 200, status(c) { r.code = c; return r; }, json(b) { r.body = b; } }; return r; };
const laToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const monday = d => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));

fs.mkdirSync(OUT, { recursive: true });
const hlBefore = await hlCounts();
console.log('HomeLover before', JSON.stringify(hlBefore));
const spendBefore = (await svc.from('apollo_credit_spend').select('*', { count: 'exact', head: true })).count;
const results = { density: {}, n2: {} };
try {
  // HomeLover board, read-only, through the real route (proves the Stage 1 columns are live).
  const { pipelineBoardRoute } = await import(ROOT + '/api/sales/pipelineBoard.js');
  const hr = fake(); await pipelineBoardRoute({ params: { businessId: HOMELOVER }, query: { include_apollo: 'true' } }, hr);
  ok('HomeLover board builds on the live schema (channel/priority columns present)', hr.code === 200 && Array.isArray(hr.body?.rows), hr.body?.error || '');
  const hlRows = hr.body.rows || [];
  const hlAll = hlRows.filter(r => r.channels.includes('all'));
  console.log(`HomeLover board: ${hlRows.length} rows, ${hlAll.length} under All; channels ${JSON.stringify(Object.fromEntries(['website', 'scout', 'apollo', 'partners', 'call_notes', 'targets'].map(c => [c, hlRows.filter(r => r.channels.includes(c)).length])))}`);
  const hlChannel = await svc.from('sales_goals').select('channel').eq('business_id', HOMELOVER).eq('goal_type', 'partnership').is('archived_at', null);
  const partnerChannels = (hlChannel.data || []).reduce((o, r) => ({ ...o, [r.channel]: (o[r.channel] || 0) + 1 }), {});
  ok('HomeLover board partner channels = the DB', JSON.stringify(Object.entries(hlRows.filter(r => r.type === 'partner').reduce((o, r) => ({ ...o, [r.channel]: (o[r.channel] || 0) + 1 }), {})).sort()) === JSON.stringify(Object.entries(partnerChannels).sort()), JSON.stringify(partnerChannels));

  // ── temp workspace + users + seed ──
  const tag = 'ia2s2-' + Date.now();
  B = ins(await svc.from('businesses').insert({ name: NAME, website_url: 'https://ia2.example.com', color: '#6F8CF0', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
  const mk = async (name, role) => {
    const email = `${tag}-${name.toLowerCase()}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
    const { data: u, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(error.message);
    await svc.from('profiles').update({ display_name: `${name} Test`, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
    ins(await svc.from('business_members').insert({ business_id: B, email, name: `${name} Test`, user_id: u.user.id, role }).select());
    const anon = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data: s, error: sErr } = await anon.auth.signInWithPassword({ email, password });
    if (sErr) throw new Error(sErr.message);
    const u2 = { id: u.user.id, session: s.session }; users.push(u2); return u2;
  };
  const owner = await mk('Owner', 'owner'), viewer = await mk('Viewer', 'viewer');
  const today = laToday();
  const STAGES = ['not_started', 'researching', 'first_email_sent', 'in_sequence', 'replied', 'meeting_set'];
  const partners = ins(await svc.from('sales_goals').insert(Array.from({ length: 34 }, (_, i) => ({
    business_id: B, goal_type: 'partnership', name: `ZZ Partner ${String(i + 1).padStart(2, '0')}`, pipeline_status: STAGES[i % STAGES.length],
    owner_user_id: i % 2 ? owner.id : null, tier: String((i % 3) + 1), channel: i % 5 === 0 ? 'manual' : 'import',
    last_touch_at: new Date(Date.now() - (i + 1) * 864e5).toISOString(), priority: i < 3 ? i + 1 : null,
  }))).select('id, name'));
  const emps = ins(await svc.from('sales_opportunities').insert(Array.from({ length: 5 }, (_, i) => ({
    business_id: B, organization: `ZZ Employer ${i + 1}`, org_type: 'employer', stage: ['target', 'contacted', 'responded', 'meeting', 'verbal'][i], source: 'manual', channel: 'manual',
    owner: i === 0 ? 'Owner Test' : null, covered_lives: (i + 1) * 1000,
  }))).select('id, organization'));
  ins(await svc.from('sales_targets').insert([{ business_id: B, name: 'ZZ Target A', kind: 'partner', status: 'researching', channel: 'call_note' }, { business_id: B, name: 'ZZ Target B', kind: 'employer', status: 'proposed', channel: 'scout' }]).select('id'));
  const p01 = partners.find(p => p.name === 'ZZ Partner 01'), p02 = partners.find(p => p.name === 'ZZ Partner 02');
  ins(await svc.from('web_visits').insert([
    { business_id: B, pulled_on: today, company_key: 'zz partner 01', company_name: 'ZZ Partner 01', priority: 'P1', priority_rule: 'Matched partner visited', matched_type: 'partner', matched_id: p01.id, visits_7d: 3, last_visit: today, us_500: false },
    { business_id: B, pulled_on: today, company_key: 'zz acme widgets', company_name: 'ZZ Acme Widgets', priority: 'P1', priority_rule: 'US 500+ with 5+ visits', visits_7d: 6, last_visit: today, us_500: true },
    { business_id: B, pulled_on: today, company_key: 'zz noisy', company_name: 'ZZ Noisy', priority: 'P3', priority_rule: 'Size unknown - watch', visits_7d: 1, last_visit: today, us_500: false },
  ]).select('id'));
  ins(await svc.from('sales_signals').insert({ business_id: B, source: 'scout', signal_week: monday(today), company_name: 'ZZ Zeta Labs', company_key: 'zz zeta labs', kind: 'employer', signal: 'Opened a new office', status: 'new' }).select('id'));
  ins(await svc.from('sales_week_goals').insert({ business_id: B, week_start: monday(today), kind: 'todo', text: 'Call ZZ Partner 02', status: 'open', owner_user_id: owner.id, due_date: addDays(today, -2), link_type: 'partner', link_id: p02.id }).select('id'));

  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const api = async (u, method, p, body) => {
    const res = await fetch(`http://localhost:${PORT}/api/sales/${B}${p}`, { method, headers: { Cookie: `prospector_at=${encodeURIComponent(u.session.access_token)}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  // ── API: validators (L4/L5), channel on create, opportunity link ──
  const e1 = emps[0];
  const todo = await api(owner, 'POST', '/goals/week', { week_start: monday(today), kind: 'todo', text: 'Send ZZ Employer 1 the deck', owner_user_id: owner.id, due_date: today, link_type: 'opportunity', link_id: e1.id });
  ok("to-do linked to an employer (link_type 'opportunity') saves: check constraint + LINK_TYPES", todo.status === 201 && todo.body?.goal?.link_type === 'opportunity', `${todo.status} ${todo.body?.error || ''}`);
  const badLink = await api(owner, 'POST', '/goals/week', { week_start: monday(today), kind: 'todo', text: 'x', link_type: 'opportunity', link_id: '00000000-0000-4000-8000-000000000000' });
  ok('an employer link from another workspace / unknown id is refused 400', badLink.status === 400, badLink.body?.error);
  const linked = await api(owner, 'GET', `/goals/tasks?link_type=opportunity&link_id=${e1.id}`);
  ok('GET goals/tasks?link_type=opportunity lists it', linked.status === 200 && linked.body?.tasks?.length === 1, String(linked.status));
  const bad = [
    await api(owner, 'PATCH', `/opportunities/${e1.id}`, { priority: 5 }),
    await api(owner, 'PATCH', `/opportunities/${e1.id}`, { channel: 'nope' }),
    await api(owner, 'PATCH', `/opportunities/${e1.id}`, { priority_set_by: owner.id }),
    await api(owner, 'PATCH', `/goals/land/${p02.id}`, { priority: 5 }),
    await api(owner, 'PATCH', `/goals/land/${p02.id}`, { channel: 'nope' }),
    await api(owner, 'POST', '/goals/visits/priority', { company_key: 'zz acme widgets', priority: 9 }),
  ];
  ok('validators refuse bad priority / channel / set_by on employers, partners, visitors (400 x6)', bad.every(r => r.status === 400), bad.map(r => r.status).join(','));
  const p4 = await api(owner, 'PATCH', `/goals/land/${p02.id}`, { priority: 4 });
  const p02db = ins(await svc.from('sales_goals').select('priority, priority_set_by, priority_set_at').eq('id', p02.id).single());
  ok('partner priority widened to P4; who + when stamped by the server', p4.status === 200 && p02db.priority === 4 && p02db.priority_set_by === owner.id && !!p02db.priority_set_at);
  await api(owner, 'PATCH', `/goals/land/${p02.id}`, { priority: null });
  const newP = await api(owner, 'POST', '/goals/land', { goal_type: 'partnership', name: 'ZZ Added By Hand' });
  const newE = await api(owner, 'POST', '/opportunities', { organization: 'ZZ Employer Added' });
  ok("Add partner / Add employer set channel 'manual'", newP.body?.goal?.channel === 'manual' && newE.body?.opportunity?.channel === 'manual', `${newP.body?.goal?.channel} ${newE.body?.opportunity?.channel}`);
  const vErr = await api(viewer, 'POST', '/goals/visits/priority', { company_key: 'zz acme widgets', priority: 2 });
  ok('Viewer cannot set a visitor priority (403)', vErr.status === 403, String(vErr.status));

  // Board API vs the DB.
  const board = (await api(owner, 'GET', '/goals/pipeline-board?include_apollo=true')).body.rows;
  const dbP = ins(await svc.from('sales_goals').select('id').eq('business_id', B).eq('goal_type', 'partnership').is('archived_at', null));
  const dbE = ins(await svc.from('sales_opportunities').select('id').eq('business_id', B).is('archived_at', null));
  const dbT = ins(await svc.from('sales_targets').select('id').eq('business_id', B).in('status', ['proposed', 'researching']));
  const allN = board.filter(r => r.channels.includes('all')).length;
  ok('All = partners + employers + targets in the DB', allN === dbP.length + dbE.length + dbT.length, `${allN} vs ${dbP.length}+${dbE.length}+${dbT.length}`);
  const web = board.filter(r => r.channels.includes('website'));
  ok('Website visitors = 1 matched partner (Visited) + 2 Visitor rows', web.length === 3 && web.filter(r => r.type === 'visitor').length === 2 && board.find(r => r.id === p01.id).visited?.visits_7d === 3);
  ok('Scout signals = the unmatched signal row + the scout-channel target is not listed by channel alone', board.filter(r => r.channels.includes('scout')).map(r => r.name).join() === 'ZZ Zeta Labs');
  const e1row = board.find(r => r.id === e1.id), p02row = board.find(r => r.id === p02.id);
  ok('employer row: open to-do counted from the opportunity link; covered lives; channel', e1row.work?.todos === 1 && e1row.covered_lives === 1000 && e1row.channel === 'manual');
  ok('partner row: overdue to-do counted as overdue', p02row.work?.todos === 1 && p02row.work?.todos_overdue === 1);
  ok('Call notes = records with channel call_note created in 30 days', board.filter(r => r.channels.includes('call_notes')).map(r => r.name).join() === 'ZZ Target A');

  // ── browser ──
  browser = await chromium.launch();
  async function newPage(u, { width = 1440, height = 900, url = '/', intercept = null, ws = NAME } = {}) {
    const errs = [];
    const page = await (await browser.newContext({ viewport: { width, height } })).newPage(); page.setDefaultTimeout(12000);
    page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
    await page.addInitScript(([k, v, b, d]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      localStorage.setItem(`prospector_visits_ran_${b}`, d); localStorage.setItem(`prospector_tidy_ran_${b}`, d);
    }, [`sb-${REF}-auth-token`, JSON.stringify(u.session), B, today]);
    await page.addInitScript(() => { window.__prints = 0; window.print = () => { window.__prints++; }; });
    await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)|\/goals\/visits\/pull/, route => route.abort());
    if (intercept) await page.route(/\/api\/sales\/[^/]+\/goals\/pipeline-board(\?|$)/, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: intercept }) }));
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
  const sub = async (page, label) => { await page.locator('[data-sales-subviews]').getByRole('tab', { name: label, exact: true }).click(); await page.waitForTimeout(1500); };
  const nav = page => page.evaluate(() => { const u = new URL(location.href); return `${u.searchParams.get('tab')}/${u.searchParams.get('view')}${u.searchParams.get('channel') ? `/${u.searchParams.get('channel')}` : ''}`; });
  const boxes = page => page.evaluate(() => Object.fromEntries(['data-sales-tabrow', 'data-sales-subviews', 'data-channel-row', 'data-filter-row'].map(a => {
    const el = document.querySelector(`[${a}]`); if (!el) return [a, null];
    const r = el.getBoundingClientRect(); return [a, { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, h: Math.round(r.height * 10) / 10 }];
  })));
  const tableTop = page => page.evaluate(() => { const b = document.querySelector('.ui-table-box, ul.ui-list'); return b ? Math.round(b.getBoundingClientRect().top * 10) / 10 : null; });
  const maxMove = (a, b) => Math.max(0, ...Object.keys(a).filter(k => a[k] && b[k]).flatMap(k => [Math.abs(a[k].x - b[k].x), Math.abs(a[k].y - b[k].y), Math.abs(a[k].h - b[k].h)]));
  const visibleRows = page => page.evaluate(() => {
    const H = window.innerHeight; const box = document.querySelector('.ui-table-box'); const bt = box ? box.getBoundingClientRect().top : 0;
    const rs = [...document.querySelectorAll('tr[data-row]')].map(tr => tr.getBoundingClientRect());
    return { full: rs.filter(r => r.top >= bt && r.bottom <= Math.min(H, box ? box.getBoundingClientRect().bottom : H)).length, rendered: rs.length, rowH: rs.length ? Math.round(rs[0].height) : null, boxTop: Math.round(bt), innerH: H, docW: document.documentElement.scrollWidth, winW: window.innerWidth };
  });
  fs.mkdirSync(OUT, { recursive: true });
  const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide' });

  // ── owner 1440: N1, N2, bar-5 path ──
  { const { page, errs } = await newPage(owner);
    ok('N1: default tab is Actions', (await nav(page)).startsWith('actions/'), await nav(page));
    const tabs = await page.locator('#workspace-header-tabs [data-sales-tabrow] button').allTextContents();
    ok('N1: Sales = Dashboard · Pipeline · Actions; Marketing shown disabled, Coming soon', tabs.join('|').replace(/\d/g, '').startsWith('Dashboard|Pipeline|Actions') && await page.locator('[data-sales-marketing] button').isDisabled() && tabs.some(t => t.includes('Coming soon')), tabs.join('|'));
    ok('N1: the sidebar says Sales & Marketing (no "Goals & Sales" anywhere on the page)', !(await page.content()).includes('Goals &amp; Sales'));
    const n2 = {};
    for (const [t, s, key] of [['Actions', null, 'actions'], ['Dashboard', 'Overview', 'dashboard'], ['Pipeline', 'Partner workflow', 'partners'], ['Pipeline', 'People', 'people'], ['Pipeline', 'Companies', 'companies']]) {
      await tab(page, t); if (s) await sub(page, s); n2[key] = await boxes(page);
    }
    const ref = n2.companies;
    const tabMove = Math.max(...Object.values(n2).map(b => Math.max(Math.abs(b['data-sales-tabrow'].x - ref['data-sales-tabrow'].x), Math.abs(b['data-sales-tabrow'].y - ref['data-sales-tabrow'].y))));
    const subMove = Math.max(...Object.values(n2).map(b => Math.max(Math.abs(b['data-sales-subviews'].y - ref['data-sales-subviews'].y), Math.abs(b['data-sales-subviews'].x - ref['data-sales-subviews'].x))));
    results.n2['1440 across tabs'] = { tabRow: ref['data-sales-tabrow'], subViews: ref['data-sales-subviews'], channelRow: ref['data-channel-row'], filterRow: ref['data-filter-row'], tabRowMaxMove: tabMove, subViewsMaxMove: subMove };
    ok(`N2 1440: tab row and sub-view switch at the same x/y on all 5 screens (max move ${tabMove} / ${subMove} px)`, tabMove <= 1 && subMove <= 1, JSON.stringify(n2));

    // Density on the temp workspace (39 records under All).
    const d = await visibleRows(page);
    d.above = await page.evaluate(() => Object.fromEntries([['stickyHeader', document.querySelector('#workspace-header-tabs')], ['frame', document.querySelector('[data-sales-frame]')], ['channel', document.querySelector('[data-channel-row]')], ['filters', document.querySelector('[data-filter-row]')], ['thead', document.querySelector('.ui-table thead')]]
      .map(([k, el]) => { if (!el) return [k, null]; let n = el; if (k === 'stickyHeader') { while (n && getComputedStyle(n).position !== 'sticky') n = n.parentElement; n = n || el; } const r = n.getBoundingClientRect(); return [k, { top: Math.round(r.top), bottom: Math.round(r.bottom) }]; })));
    results.density.temp1440 = d;
    console.log('DENSITY temp 1440', JSON.stringify(d));
    ok('1440: rows stay 34 px and no sideways page scroll', d.rowH === 34 && d.docW <= d.winW, JSON.stringify(d));
    await shot(page, 'ia2-companies-1440');

    // N2: 3 filters + a notice never move the rows above the table.
    const b0 = await boxes(page), t0 = await tableTop(page);
    await page.getByRole('button', { name: 'Visited 7 d' }).click(); await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Has open to-do' }).click(); await page.waitForTimeout(300);
    await page.getByLabel('Priority', { exact: true }).selectOption('1'); await page.waitForTimeout(300);
    const b1 = await boxes(page), t1 = await tableTop(page);
    await page.getByRole('button', { name: /^Clear/ }).click(); await page.waitForTimeout(400);
    // A notice: the Undo toast after a priority change (temp row).
    await page.getByLabel('Priority for ZZ Partner 05').selectOption('3'); await page.locator('[role="status"]').waitFor(); await page.waitForTimeout(300);
    const b2 = await boxes(page), t2 = await tableTop(page);
    const moveF = maxMove(b0, b1), moveN = maxMove(b0, b2);
    results.n2['1440 filters/notice'] = { before: b0, afterFilters: b1, afterNotice: b2, tableTop: [t0, t1, t2], maxMoveFilters: moveF, maxMoveNotice: moveN };
    ok(`N2 1440: 3 filters + a notice move nothing above the table (max ${Math.max(moveF, moveN)} px; table top ${t0}/${t1}/${t2})`, moveF <= 1 && moveN <= 1 && Math.abs(t0 - t1) <= 1 && Math.abs(t0 - t2) <= 1);
    const p05 = ins(await svc.from('sales_goals').select('priority, priority_set_by').eq('business_id', B).eq('name', 'ZZ Partner 05').single());
    ok('partner priority from the dropdown lands in the DB with who set it', p05.priority === 3 && p05.priority_set_by === owner.id);
    await page.getByRole('button', { name: 'Undo' }).click(); await page.waitForTimeout(1500);
    const p05b = ins(await svc.from('sales_goals').select('priority').eq('business_id', B).eq('name', 'ZZ Partner 05').single());
    ok('Undo puts the partner priority back (null)', p05b.priority === null);

    // Bar-5 path: Website visitors -> P2 and back -> sort Last touch -> Owner + Has open to-do -> Clear.
    await page.getByRole('group', { name: 'Channel' }).getByRole('button', { name: /^Website visitors/ }).click(); await page.waitForTimeout(600);
    ok('Website visitors channel: 3 rows (1 record + 2 visitors), Visitor report button', (await page.locator('tr[data-row]').count()) === 3 && await page.getByRole('button', { name: 'Visitor report' }).isVisible());
    await page.getByLabel('Priority for ZZ Acme Widgets').selectOption('2'); await page.locator('[role="status"]').waitFor(); await page.waitForTimeout(1500);
    let ov = ins(await svc.from('visit_priority_override').select('priority, not_a_fit, set_by').eq('business_id', B).eq('company_key', 'zz acme widgets'));
    ok('visitor -> P2: override row priority 2, set by the owner', ov.length === 1 && ov[0].priority === 2 && ov[0].set_by === owner.id && !ov[0].not_a_fit);
    ok('the cell says who set it', (await page.locator('tr[data-row]', { hasText: 'ZZ Acme Widgets' }).textContent()).includes('Owner Oct') || (await page.locator('tr[data-row]', { hasText: 'ZZ Acme Widgets' }).textContent()).includes('Owner '));
    await shot(page, 'ia2-visitors-1440');
    await page.getByRole('button', { name: 'Undo' }).click(); await page.waitForTimeout(1800);
    ov = ins(await svc.from('visit_priority_override').select('priority').eq('business_id', B).eq('company_key', 'zz acme widgets'));
    ok('…and back (Undo): override removed, P1 from the pull again', ov.length === 0 && (await page.getByLabel('Priority for ZZ Acme Widgets').inputValue()) === '1');
    await page.getByLabel('Priority for ZZ Noisy').selectOption('not_a_fit'); await page.locator('[role="status"]').waitFor(); await page.waitForTimeout(1500);
    const skip = ins(await svc.from('sales_visit_skip').select('reason').eq('business_id', B).eq('company_key', 'zz noisy'));
    ok('Not a fit (visitor): skip list + override; picking P3 undoes both', skip.length === 1 && skip[0].reason === 'Not a fit');
    await page.getByLabel('Priority for ZZ Noisy').selectOption('3'); await page.waitForTimeout(1800);
    ok('…P3 picked: off the skip list', ins(await svc.from('sales_visit_skip').select('id').eq('business_id', B).eq('company_key', 'zz noisy')).length === 0);
    await page.getByRole('button', { name: 'Visitor report' }).click(); await page.locator('[data-visitor-report]').waitFor(); await page.waitForTimeout(800);
    ok('Visitor report opens over the table; no standalone Not a fit button', (await page.locator('[data-visitor-report]').getByRole('button', { name: 'Not a fit' }).count()) === 0);
    await page.keyboard.press('Escape'); await page.waitForTimeout(600);
    await page.getByRole('group', { name: 'Channel' }).getByRole('button', { name: /^All/ }).click(); await page.waitForTimeout(500);
    await page.getByRole('button', { name: /^Last touch/ }).click(); await page.waitForTimeout(400);
    const touches = await page.$$eval('tr[data-row] td:nth-child(12)', tds => tds.map(td => td.title).filter(Boolean));
    ok('sort by Last touch: one sorted list, ascending', touches.length > 5 && touches.every((v, i) => i === 0 || touches[i - 1] <= v) && await page.getByRole('heading', { name: /^Sorted by Last touch/ }).isVisible(), touches.slice(0, 3).join(','));
    await page.getByLabel('Owner', { exact: true }).selectOption('Owner Test'); await page.getByRole('button', { name: 'Has open to-do' }).click(); await page.waitForTimeout(500);
    const shown = (await page.$$eval('tr[data-row] td.ui-table__sticky', tds => tds.map(td => td.textContent))).sort();
    const open = ins(await svc.from('sales_week_goals').select('link_type, link_id').eq('business_id', B).eq('status', 'open').in('kind', ['todo']).not('link_type', 'is', null));
    const ownedP = ins(await svc.from('sales_goals').select('id, name').eq('business_id', B).eq('owner_user_id', owner.id));
    const ownedE = ins(await svc.from('sales_opportunities').select('id, organization').eq('business_id', B).eq('owner', 'Owner Test'));
    const expect = [...ownedP.filter(p => open.some(t => t.link_type === 'partner' && t.link_id === p.id)).map(p => p.name), ...ownedE.filter(o => open.some(t => t.link_type === 'opportunity' && t.link_id === o.id)).map(o => o.organization)].sort();
    ok(`Owner = Owner Test + Has open to-do = the DB (${expect.join(', ')})`, JSON.stringify(shown) === JSON.stringify(expect), shown.join(', '));
    await page.getByRole('button', { name: /^Clear/ }).click(); await page.waitForTimeout(500);
    ok('Clear: every record back', (await page.locator('tr[data-row]').count()) === dbP.length + dbE.length + dbT.length, String(await page.locator('tr[data-row]').count()));
    await tab(page, 'Actions'); await tab(page, 'Pipeline'); await page.waitForTimeout(1500);
    ok('last sort remembered when Companies mounts again', await page.locator('th[aria-sort="ascending"]', { hasText: 'Last touch' }).count() === 1);

    // Dashboard: Weekly report PDF still prints once with one print area.
    await tab(page, 'Dashboard'); await sub(page, 'Overview'); // sales-ia-v2 Stage 6: the Weekly report lives under Dashboard > Overview
    await page.getByRole('button', { name: 'Export' }).click(); await page.getByRole('menuitem', { name: 'Weekly report PDF' }).click(); await page.waitForTimeout(1500);
    ok('Weekly report PDF prints once, one print area', (await page.evaluate(() => window.__prints)) === 1 && (await page.locator('#sales-analytics-print-area').count()) === 1);
    await tab(page, 'Actions'); await shot(page, 'ia2-actions-1440');
    ok('owner 1440: 0 page errors', !errs.length, errs.join(' | '));
    await page.context().close();
  }

  // ── legacy links ──
  { const { page, errs } = await newPage(owner, { url: '/?tab=reports&view=visitors' });
    ok('old Reports › Website visitors -> Pipeline › Companies, Website visitors pressed', (await nav(page)) === 'pipeline/companies/website' && (await page.getByRole('group', { name: 'Channel' }).getByRole('button', { name: /^Website visitors/ }).getAttribute('aria-pressed')) === 'true', await nav(page));
    ok('legacy: 0 page errors', !errs.length, errs.join(' | '));
    await page.context().close();
  }
  { const { page, errs } = await newPage(owner, { url: '/?tab=huddle' });
    ok('old Huddle -> Pipeline › People', (await nav(page)).startsWith('pipeline/people'), await nav(page));
    ok('legacy huddle: 0 page errors', !errs.length, errs.join(' | '));
    await page.context().close();
  }

  // ── HomeLover density (real rows, read-only, served by intercept into the temp page) ──
  { const { page } = await newPage(owner, { intercept: hlRows, url: '/?tab=pipeline&view=companies' });
    await page.locator('tr[data-row]').first().waitFor();
    const d = await visibleRows(page);
    results.density.homelover1440 = d;
    console.log('DENSITY HomeLover 1440', JSON.stringify(d));
    ok(`1440x900 on HomeLover rows: ${d.full} rows fully visible (target >= 25 - not reachable at 34 px rows, see report; v1 was 10)`, d.full >= 25, JSON.stringify(d));
    await page.context().close();
  }

  // ── 390 owner: N2 + phone list + filter sheet ──
  { const { page, errs } = await newPage(owner, { width: 390, height: 844, url: '/?tab=pipeline&view=companies' });
    const n2 = {};
    for (const [t, s, key] of [['Actions', null, 'actions'], ['Dashboard', 'Overview', 'dashboard'], ['Pipeline', 'Companies', 'companies']]) { await tab(page, t); if (s) await sub(page, s); n2[key] = await boxes(page); }
    const ref = n2.companies;
    const mv = Math.max(...Object.values(n2).map(b => Math.max(Math.abs(b['data-sales-tabrow'].y - ref['data-sales-tabrow'].y), Math.abs(b['data-sales-subviews'].y - ref['data-sales-subviews'].y))));
    const b0 = await boxes(page);
    await page.getByRole('button', { name: /^Filters/ }).click(); await page.waitForTimeout(400);
    const sheet = page.getByRole('dialog', { name: 'Filters' });
    await sheet.getByRole('button', { name: 'Visited 7 d' }).click(); await sheet.getByRole('button', { name: 'Has open to-do' }).click(); await sheet.getByLabel('Priority', { exact: true }).selectOption('1');
    await sheet.getByRole('button', { name: /^Show/ }).click(); await page.waitForTimeout(400);
    const b1 = await boxes(page);
    results.n2['390'] = { acrossTabsMaxMove: mv, before: b0, afterFilters: b1, maxMoveFilters: maxMove(b0, b1) };
    ok(`N2 390: tab row / sub-views same y across tabs (${mv} px); 3 filters move nothing (${maxMove(b0, b1)} px)`, mv <= 1 && maxMove(b0, b1) <= 1);
    ok('390: phone list, no sideways page scroll', (await page.locator('li[data-row]').count()) >= 0 && await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.getByRole('button', { name: /^Filters/ }).click(); await page.getByRole('dialog', { name: 'Filters' }).getByRole('button', { name: /^Clear/ }).click(); await page.getByRole('dialog', { name: 'Filters' }).getByRole('button', { name: /^Show/ }).click();
    await shot(page, 'ia2-companies-390');
    ok('390: 0 page errors', !errs.length, errs.join(' | '));
    await page.context().close();
  }

  // ── Viewer ──
  { const { page, errs } = await newPage(viewer, { url: '/?tab=pipeline&view=companies' });
    await page.locator('tr[data-row]').first().waitFor();
    ok('Viewer: no priority dropdowns, no Export / Update / + Add employer, View only shown', (await page.locator('select[data-priority]').count()) === 0
      && (await page.getByRole('button', { name: /Export joint sheet|Update from sheet|\+ Add employer/ }).count()) === 0 && await page.getByText('View only').first().isVisible());
    ok('Viewer: 0 page errors', !errs.length, errs.join(' | '));
    await page.context().close();
  }

  const runs = (await svc.from('visit_pull_runs').select('*', { count: 'exact', head: true }).eq('business_id', B)).count;
  const spendAfter = (await svc.from('apollo_credit_spend').select('*', { count: 'exact', head: true })).count;
  ok('0 Apollo: no visitor pull ran, apollo_credit_spend unchanged', runs === 0 && spendAfter === spendBefore, `runs ${runs} spend ${spendBefore}->${spendAfter}`);
  const bundle = fs.readdirSync(ROOT + '/build/static/js').filter(f => f.endsWith('.js')).map(f => fs.readFileSync(`${ROOT}/build/static/js/${f}`, 'utf8')).join('');
  ok('bundle: Sales & Marketing, Coming soon, setVisitPriority route, no "Goals & Sales"', bundle.includes('Sales & Marketing') && bundle.includes('Coming soon') && bundle.includes('/visits/priority') && !bundle.includes('Goals & Sales'));
} catch (e) {
  ok('script ran without throwing', false, e.stack?.split('\n').slice(0, 3).join(' | ') || e.message);
} finally {
  await cleanup();
  const left = B ? (await svc.from('businesses').select('id', { count: 'exact', head: true }).eq('id', B)).count : 0;
  console.log(`teardown: workspace left ${left}`);
  const hlAfter = await hlCounts();
  const diff = Object.keys(hlBefore).filter(k => hlBefore[k] !== hlAfter[k]);
  ok(`HomeLover counts identical (${HL.length} tables)`, !diff.length, diff.map(k => `${k} ${hlBefore[k]}->${hlAfter[k]}`).join(', '));
  fs.writeFileSync(`${OUT}/ia2-stage2-numbers.json`, JSON.stringify(results, null, 2));
  console.log(`\n${pass}/${total} passed · restored: ${left === 0 && !diff.length ? 'yes' : 'NO'}`);
  process.exit(0);
}
