// sales-ia-v2 REV2 Stage 3 bar 4 (P4 company panel + action bar for all five row types, Undo, Jump to stage
// with the L3 server guard; Stage 2 choice 1: 28 px rows + the table fills the window once the filters scroll away).
// SCOPE (declared): TEMP data only - 1 workspace (goals_sales on, added to SALES_ANALYTICS_BUSINESS_IDS for the local
// server only) + 3 temp users (owner, member "Cyrus Temp", viewer) + ~45 seeded rows (34 partners, 5 employers,
// 2 targets, 3 web_visits, 1 scout signal, 2 to-dos; made-up names, no emails or phones). HomeLover is READ-ONLY:
// its board is built once by the real route function (service key) and served into one page by route intercept,
// for the density count on real data; its table counts are compared before/after. 0 Apollo (visit pull, sync and
// apollo routes aborted in the browser; the Check Apollo API call on a temp employer has no snapshot -> enrich to-do,
// 0 calls; the run table and apollo_credit_spend are checked). 1 real Claude call (declared): the bar-5 path's
// Research on the target made from a visitor (~$0.08, business_anthropic_usage checked). Runtime ~4 min, hard cap
// 285 s (tempGuard), teardown deletes everything.
// Usage: node scripts/verify/sales-ia-v2-stage3.mjs <outdir> [--real-research]   (run npm run build first)
// Without --real-research the browser's research POST is answered with a fake 202 (0 Claude calls) and the three
// "run finished" checks are skipped; the declared real run was made once with the flag (results in the report).
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
const REAL_RESEARCH = process.argv.includes('--real-research');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3974;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const NAME = 'ZZ Sales IA v2 Stage3';
const HL = ['sales_goals', 'sales_opportunities', 'sales_targets', 'sales_week_goals', 'sales_partner_events', 'sales_opportunity_events', 'web_visits', 'sales_visit_skip', 'visit_priority_override', 'sales_signals', 'visit_pull_runs', 'partner_contacts', 'research_runs'];
const TEMP_TABLES = ['research_runs', 'partner_contacts', 'visit_priority_override', 'sales_signals', 'web_visits', 'visit_pull_runs', 'sales_visit_skip', 'sales_suggestions', 'sales_tidy_runs', 'sales_partner_events',
  'sales_opportunity_events', 'sales_week_goal_steps', 'sales_week_goals', 'sales_targets', 'sales_opportunities', 'sales_goals', 'business_anthropic_usage', 'auth_events', 'business_members'];
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
const monday = d => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));
const friday = d => addDays(d, (5 - new Date(`${d}T12:00:00Z`).getUTCDay() + 7) % 7);

fs.mkdirSync(OUT, { recursive: true });
const hlBefore = await hlCounts();
console.log('HomeLover before', JSON.stringify(hlBefore));
const spendBefore = (await svc.from('apollo_credit_spend').select('*', { count: 'exact', head: true })).count;
const results = { density: {}, n2: {}, research: null };
try {
  const { pipelineBoardRoute } = await import(ROOT + '/api/sales/pipelineBoard.js');
  const hr = fake(); await pipelineBoardRoute({ params: { businessId: HOMELOVER }, query: { include_apollo: 'true' } }, hr);
  ok('HomeLover board builds (read-only)', hr.code === 200 && Array.isArray(hr.body?.rows), hr.body?.error || '');
  const hlRows = hr.body.rows || [];

  // ── temp workspace + users + seed ──
  const tag = 'ia2s3-' + Date.now();
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
  const owner = await mk('Owner Test', 'owner'), cyrus = await mk('Cyrus Temp', 'member'), viewer = await mk('Viewer Test', 'viewer');
  const today = laToday();
  const STAGES = ['not_started', 'researching', 'first_email_sent', 'in_sequence', 'replied', 'meeting_set'];
  const partners = ins(await svc.from('sales_goals').insert(Array.from({ length: 34 }, (_, i) => ({
    business_id: B, goal_type: 'partnership', name: `ZZ Partner ${String(i + 1).padStart(2, '0')}`, pipeline_status: STAGES[i % STAGES.length],
    owner_user_id: i % 2 ? owner.id : null, tier: String((i % 3) + 1), channel: i % 5 === 0 ? 'manual' : 'import',
    last_touch_at: new Date(Date.now() - (i + 1) * 864e5).toISOString(), priority: i < 3 ? i + 1 : null,
  }))).select('id, name, pipeline_status'));
  const emps = ins(await svc.from('sales_opportunities').insert(Array.from({ length: 5 }, (_, i) => ({
    business_id: B, organization: `ZZ Employer ${i + 1}`, org_type: 'employer', stage: ['target', 'contacted', 'responded', 'meeting', 'verbal'][i], source: 'manual', channel: 'manual',
    owner: i === 0 ? 'Owner Test' : null, covered_lives: (i + 1) * 1000,
  }))).select('id, organization, stage'));
  const targets = ins(await svc.from('sales_targets').insert([{ business_id: B, name: 'ZZ Target A', kind: 'partner', status: 'researching', channel: 'call_note' }, { business_id: B, name: 'ZZ Target B', kind: 'employer', status: 'proposed', channel: 'scout' }]).select('id, name, status'));
  const p01 = partners.find(p => p.name === 'ZZ Partner 01'), p02 = partners.find(p => p.name === 'ZZ Partner 02'), p05 = partners.find(p => p.name === 'ZZ Partner 05');
  ins(await svc.from('web_visits').insert([
    { business_id: B, pulled_on: today, company_key: 'zz partner 01', company_name: 'ZZ Partner 01', priority: 'P1', priority_rule: 'Matched partner visited', matched_type: 'partner', matched_id: p01.id, visits_7d: 3, last_visit: today, us_500: false, top_paths: ['/partners'] },
    { business_id: B, pulled_on: today, company_key: 'zz acme widgets', company_name: 'ZZ Acme Widgets', priority: 'P1', priority_rule: 'US 500+ with 5+ visits', visits_7d: 6, last_visit: today, us_500: true, top_paths: ['/pricing', '/employers'] },
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

  // ── API: L3 guard on partners, employers, targets ──
  const e4 = emps.find(e => e.organization === 'ZZ Employer 4'); // meeting
  const pRep = partners.find(p => p.pipeline_status === 'replied');
  const back = await api(owner, 'POST', `/goals/partners/${pRep.id}/signal`, { type: 'status', to: 'researching', expect: 'replied' });
  ok('partner: a backward status signal without allow_backward is 409 and writes nothing', back.status === 409 && ins(await svc.from('sales_goals').select('pipeline_status').eq('id', pRep.id).single()).pipeline_status === 'replied', `${back.status} ${back.body?.error || ''}`);
  const backOk = await api(owner, 'POST', `/goals/partners/${pRep.id}/signal`, { type: 'status', to: 'researching', expect: 'replied', allow_backward: true });
  ok('partner: with allow_backward it moves and the event is marked backward', backOk.status === 200 && backOk.body?.goal?.pipeline_status === 'researching' && backOk.body?.event?.meta?.backward === true, `${backOk.status} ${backOk.body?.error || ''}`);
  const fwd = await api(owner, 'POST', `/goals/partners/${pRep.id}/signal`, { type: 'status', to: 'first_email_drafted', expect: 'researching' });
  ok('partner: a forward step needs no flag', fwd.status === 200, `${fwd.status} ${fwd.body?.error || ''}`);
  const eBack = await api(owner, 'PATCH', `/opportunities/${e4.id}`, { stage: 'contacted' });
  const eBackOk = await api(owner, 'PATCH', `/opportunities/${e4.id}`, { stage: 'contacted', allow_backward: true });
  const eFwd = await api(owner, 'PATCH', `/opportunities/${e4.id}`, { stage: 'meeting' });
  ok('employer: backward stage 409 (code backward_stage) without the flag, 200 with it, forward 200; parking needs no flag', eBack.status === 409 && eBack.body?.code === 'backward_stage' && eBackOk.status === 200 && eFwd.status === 200
    && (await api(owner, 'PATCH', `/opportunities/${e4.id}`, { stage: 'on_hold' })).status === 200 && (await api(owner, 'PATCH', `/opportunities/${e4.id}`, { stage: 'meeting', allow_backward: true })).status === 200, `${eBack.status}/${eBackOk.status}/${eFwd.status}`);
  const tA = targets.find(t => t.name === 'ZZ Target A');
  const tBack = await api(owner, 'PATCH', `/goals/company/target/${tA.id}`, { status: 'proposed' });
  const tBackOk = await api(owner, 'PATCH', `/goals/company/target/${tA.id}`, { status: 'proposed', allow_backward: true });
  const tFwd = await api(owner, 'PATCH', `/goals/company/target/${tA.id}`, { status: 'researching' });
  ok('target: back to proposed 409 without the flag, 200 with it, forward 200', tBack.status === 409 && tBackOk.status === 200 && tFwd.status === 200, `${tBack.status}/${tBackOk.status}/${tFwd.status}`);

  // ── API: the panel body per type, notes / contacts (L1), Check Apollo without a snapshot, Viewer refusals ──
  const bodies = {};
  for (const [type, id] of [['partner', p01.id], ['employer', e4.id], ['target', tA.id], ['visitor', 'zz acme widgets']]) bodies[type] = await api(owner, 'GET', `/goals/company?type=${type}&id=${encodeURIComponent(id)}`);
  ok('GET goals/company answers for partner / employer / target / visitor with every body section', Object.values(bodies).every(r => r.status === 200 && ['todos', 'waiting', 'visits', 'signals', 'recent', 'people', 'decisions', 'terms'].every(k => Array.isArray(r.body[k]))), Object.values(bodies).map(r => r.status).join(','));
  ok('partner body: the matched visit shows; visitor body: its 6 visits and no research block', bodies.partner.body.visits.length === 1 && bodies.partner.body.visits[0].visits_7d === 3 && bodies.visitor.body.visits[0].visits_7d === 6 && bodies.visitor.body.research === null);
  const noPii = Object.values(bodies).every(r => !/@|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/.test(JSON.stringify(r.body)));
  ok('no email or phone shape in any panel body', noPii);
  const note = await api(owner, 'POST', `/goals/company/employer/${e4.id}/note`, { note: 'Met Pat, call pat@example.com or 555-123-4567' });
  const e4db = ins(await svc.from('sales_opportunities').select('notes').eq('id', e4.id).single());
  ok('Add note on an employer appends a dated, scrubbed line to notes', note.status === 201 && /^\(\d+\/\d+\) Met Pat, call \[email removed\] or \[number removed\]$/.test(e4db.notes), e4db.notes);
  const badContact = [
    await api(owner, 'POST', `/goals/company/partner/${p01.id}/contact`, { name: 'Sam', email: 'sam@example.com' }),
    await api(owner, 'POST', `/goals/company/partner/${p01.id}/contact`, { name: 'Sam', phone: '555-1234' }),
    await api(owner, 'POST', `/goals/company/partner/${p01.id}/contact`, { name: 'Sam sam@example.com' }),
  ];
  const goodContact = await api(owner, 'POST', `/goals/company/partner/${p01.id}/contact`, { name: 'Sam Rivera', title: 'Head of Benefits', linkedin_url: 'https://www.linkedin.com/in/samr' });
  const pc = ins(await svc.from('partner_contacts').select('name, title, email, source').eq('business_id', B));
  ok('Add contact (L1): email / phone fields or shapes are 400; name + title + LinkedIn lands as a manual partner_contacts row with no email', badContact.every(r => r.status === 400) && goodContact.status === 201 && pc.length === 1 && pc[0].email === null && pc[0].source === 'manual', badContact.map(r => r.status).join(','));
  const ac = await api(owner, 'POST', `/goals/company/employer/${e4.id}/apollo-check`, {});
  const enrich = ins(await svc.from('sales_week_goals').select('text, link_type, link_id').eq('business_id', B).eq('link_type', 'opportunity'));
  ok('Check Apollo on an employer with no Apollo snapshot: no_account, 0 calls, one enrich to-do linked to the opportunity', ac.status === 200 && ac.body?.status === 'no_account' && ac.body?.calls === 0 && enrich.length === 1 && enrich[0].link_id === e4.id, `${ac.status} ${ac.body?.status} calls ${ac.body?.calls}`);
  const rs = await api(owner, 'GET', `/goals/company/employer/${e4.id}/research`);
  ok('GET company research for an employer: { runs, today, cap 5 }', rs.status === 200 && rs.body?.cap === 5 && rs.body?.today === 0 && Array.isArray(rs.body?.runs), String(rs.status));
  const vErr = [await api(viewer, 'POST', '/goals/company/add-to-pipeline', { type: 'visitor', id: 'zz noisy' }), await api(viewer, 'POST', `/goals/company/employer/${e4.id}/note`, { note: 'x' }), await api(viewer, 'PATCH', `/goals/company/target/${tA.id}`, { owner_team: 'both' })];
  ok('Viewer: every panel write is 403; the body GET is 200', vErr.every(r => r.status === 403) && (await api(viewer, 'GET', `/goals/company?type=partner&id=${p01.id}`)).status === 200, vErr.map(r => r.status).join(','));
  const addDup = await api(owner, 'POST', '/goals/company/add-to-pipeline', { type: 'visitor', id: 'zz partner 01', to: 'target' });
  ok('add-to-pipeline on a visitor whose name is a partner already answers "already" and creates nothing', addDup.status === 200 && addDup.body?.already?.type === 'partner' && ins(await svc.from('sales_targets').select('id').eq('business_id', B)).length === 2);

  // ── browser ──
  browser = await chromium.launch();
  async function newPage(u, { width = 1440, height = 900, url = '/', intercept = null, ws = NAME } = {}) {
    const errs = [];
    const ctx = await browser.newContext({ viewport: { width, height } });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    const page = await ctx.newPage(); page.setDefaultTimeout(12000);
    page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
    page.on('dialog', d => { page.__dialogs = (page.__dialogs || []).concat(d.message()); d.accept(); });
    await page.addInitScript(([k, v, b, d]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      localStorage.setItem(`prospector_visits_ran_${b}`, d); localStorage.setItem(`prospector_tidy_ran_${b}`, d);
    }, [`sb-${REF}-auth-token`, JSON.stringify(u.session), B, today]);
    await page.addInitScript(() => { window.__prints = 0; window.print = () => { window.__prints++; }; });
    await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)|\/goals\/visits\/pull/, route => route.abort());
    if (!REAL_RESEARCH) await page.route(/\/goals\/company\/[a-z]+\/[^/]+\/research$/, route => (route.request().method() === 'POST' ? route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ run: { status: 'running', fake: true } }) }) : route.continue()));
    page.__detail = [];
    page.on('response', async r => { if (/\/goals\/company\?/.test(r.url())) { try { const j = await r.json(); page.__detail.push({ url: r.url().split('/goals/company')[1], status: r.status(), todos: j.todos?.length, err: j.error }); } catch { /* not json */ } } });
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
  const sub = async (page, label) => { await page.locator('[data-sales-subviews]').getByRole('button', { name: label, exact: true }).click(); await page.waitForTimeout(1500); };
  const boxes = page => page.evaluate(() => Object.fromEntries(['data-sales-tabrow', 'data-sales-subviews', 'data-channel-row', 'data-filter-row'].map(a => {
    const el = document.querySelector(`[${a}]`); if (!el) return [a, null];
    const r = el.getBoundingClientRect(); return [a, { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, h: Math.round(r.height * 10) / 10 }];
  })));
  const tableTop = page => page.evaluate(() => { const b = document.querySelector('.ui-table-box, ul.ui-list'); return b ? Math.round(b.getBoundingClientRect().top * 10) / 10 : null; });
  const maxMove = (a, b) => Math.max(0, ...Object.keys(a).filter(k => a[k] && b[k]).flatMap(k => [Math.abs(a[k].x - b[k].x), Math.abs(a[k].y - b[k].y), Math.abs(a[k].h - b[k].h)]));
  const visibleRows = page => page.evaluate(() => {
    const H = window.innerHeight; const box = document.querySelector('.ui-table-box'); const bt = box ? box.getBoundingClientRect().top : 0;
    const rs = [...document.querySelectorAll('tr[data-row]')].map(tr => tr.getBoundingClientRect());
    const bb = box ? box.getBoundingClientRect() : null;
    const heads = [...document.querySelectorAll('tr.ui-table__group')].map(tr => tr.getBoundingClientRect()).filter(r => bb && r.top >= bb.top && r.bottom <= Math.min(H, bb.bottom)).length;
    const hdr = document.querySelector('[data-workspace-header]')?.getBoundingClientRect();
    return { full: rs.filter(r => r.top >= bt && r.bottom <= Math.min(H, bb ? bb.bottom : H)).length, headingsInView: heads, rendered: rs.length, rowH: rs.length ? Math.round(rs[0].height) : null, boxTop: Math.round(bt), boxH: bb ? Math.round(bb.height) : null, scrollY: Math.round(window.scrollY), docH: document.documentElement.scrollHeight, below: bb ? Math.round(document.documentElement.scrollHeight - (bb.bottom + window.scrollY)) : null, pin: hdr ? Math.round(hdr.bottom) : null, innerH: H, docW: document.documentElement.scrollWidth, winW: window.innerWidth };
  });
  // Scroll the page so the filters scroll away and the table pins under the sticky header (the wheel hand-off does
  // this for a person; here the page scrolls directly, then the box re-fits on the scroll event).
  const pinTable = async page => { await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(400); await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(400); };
  const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide' });
  const panelOf = (page, name) => page.getByRole('complementary', { name });
  const toast = page => page.locator('body > [role="status"], #sales-analytics-root > [role="status"]').last();

  // ── owner 1440: density + N2, then the bar-5 path ──
  { const { page, errs } = await newPage(owner, { url: '/?tab=pipeline&view=companies' });
    await page.locator('tr[data-row]').first().waitFor();
    const n2 = {};
    for (const [t, s, key] of [['Actions', null, 'actions'], ['Dashboard', 'Overview', 'dashboard'], ['Pipeline', 'Partner workflow', 'partners'], ['Pipeline', 'People', 'people'], ['Pipeline', 'Companies', 'companies']]) { await tab(page, t); if (s) await sub(page, s); n2[key] = await boxes(page); }
    const ref = n2.companies;
    const tabMove = Math.max(...Object.values(n2).map(b => Math.max(Math.abs(b['data-sales-tabrow'].x - ref['data-sales-tabrow'].x), Math.abs(b['data-sales-tabrow'].y - ref['data-sales-tabrow'].y))));
    const subMove = Math.max(...Object.values(n2).map(b => Math.max(Math.abs(b['data-sales-subviews'].y - ref['data-sales-subviews'].y), Math.abs(b['data-sales-subviews'].x - ref['data-sales-subviews'].x))));
    results.n2['1440 across tabs'] = { tabRow: ref['data-sales-tabrow'], subViews: ref['data-sales-subviews'], channelRow: ref['data-channel-row'], filterRow: ref['data-filter-row'], tabRowMaxMove: tabMove, subViewsMaxMove: subMove };
    ok(`N2 1440: tab row and sub-view switch at the same x/y on all 5 screens (max move ${tabMove} / ${subMove} px)`, tabMove <= 1 && subMove <= 1);
    await page.locator('tr[data-row]').first().waitFor();
    const d0 = await visibleRows(page);
    ok('1440: Companies rows are 28 px, no empty Top heading, no sideways page scroll', d0.rowH === 28 && d0.docW <= d0.winW && (await page.getByRole('heading', { name: /^Top 0 of/ }).count()) === 0, JSON.stringify(d0));
    await pinTable(page);
    const d1 = await visibleRows(page);
    results.density.temp1440 = { atTop: d0, pinned: d1 };
    console.log('DENSITY temp 1440', JSON.stringify(results.density.temp1440));
    ok(`1440: once the filters scroll away the table pins under the header and shows ${d1.full} rows (was ${d0.full} at the top)`, d1.full > d0.full && d1.boxTop < d0.boxTop);
    await shot(page, 'ia2s3-companies-pinned-1440');
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300);
    const b0 = await boxes(page), t0 = await tableTop(page);
    await page.getByRole('button', { name: 'Visited 7 d' }).click(); await page.getByRole('button', { name: 'Has open to-do' }).click(); await page.getByLabel('Priority', { exact: true }).selectOption('1'); await page.waitForTimeout(300);
    const b1 = await boxes(page), t1 = await tableTop(page);
    await page.getByRole('button', { name: /^Clear/ }).click(); await page.waitForTimeout(400);
    await page.getByLabel('Priority for ZZ Partner 05').selectOption('3'); await toast(page).waitFor(); await page.waitForTimeout(300);
    const b2 = await boxes(page), t2 = await tableTop(page);
    const moveF = maxMove(b0, b1), moveN = maxMove(b0, b2);
    results.n2['1440 filters/notice'] = { before: b0, afterFilters: b1, afterNotice: b2, tableTop: [t0, t1, t2], maxMoveFilters: moveF, maxMoveNotice: moveN };
    ok(`N2 1440: 3 filters + a notice move nothing above the table (max ${Math.max(moveF, moveN)} px; table top ${t0}/${t1}/${t2})`, moveF <= 1 && moveN <= 1 && Math.abs(t0 - t1) <= 1 && Math.abs(t0 - t2) <= 1);
    await toast(page).getByRole('button', { name: 'Undo' }).click(); await page.waitForTimeout(1500);
    ok('table priority Undo still works (P3 -> back to none)', ins(await svc.from('sales_goals').select('priority').eq('id', p05.id).single()).priority === null);

    // Bar-5 path 1: employer -> Add to-do (owner Cyrus, due Friday) -> appears in Actions for Cyrus.
    await page.getByRole('button', { name: 'ZZ Employer 2', exact: true }).click();
    const ep = panelOf(page, 'ZZ Employer 2'); await ep.waitFor();
    await ep.locator('[data-section="todos"]').waitFor();
    const epBits = [(await ep.locator('[data-company-panel="employer"]').count()) === 1, (await ep.getByTitle('Stage').textContent()) === 'Contacted', (await ep.getByRole('region', { name: 'Actions' }).count()) === 1, (await ep.locator('[data-section="todos"]').count()) === 1];
    ok('employer row opens the company panel: header chips (type, channel, stage, last touch), action bar, body sections', epBits.every(Boolean), JSON.stringify(epBits));
    await ep.getByRole('button', { name: 'Add to-do', exact: true }).click();
    await ep.getByLabel('To-do', { exact: true }).fill('Send ZZ Employer 2 the deck');
    await ep.getByLabel('To-do owner').selectOption(cyrus.id);
    const due = friday(today);
    await ep.getByLabel('To-do due date').fill(due);
    await ep.getByRole('button', { name: 'Save to-do' }).click(); await page.waitForTimeout(1500);
    const e2 = emps.find(e => e.organization === 'ZZ Employer 2');
    const todo = ins(await svc.from('sales_week_goals').select('id, text, owner_user_id, due_date, week_start, link_type, link_id, status').eq('business_id', B).eq('text', 'Send ZZ Employer 2 the deck'));
    ok(`Add to-do from the employer panel: one open to-do, owner Cyrus, due Friday ${due}, week ${monday(due)}, linked to the opportunity`, todo.length === 1 && todo[0].owner_user_id === cyrus.id && todo[0].due_date === due && todo[0].week_start === monday(due) && todo[0].link_type === 'opportunity' && todo[0].link_id === e2.id && todo[0].status === 'open', JSON.stringify(todo));
    await page.waitForTimeout(1500);
    const todosText = await ep.locator('[data-section="todos"]').textContent();
    ok('…the panel body now lists it; the toast offers Undo', todosText.includes('Send ZZ Employer 2 the deck') && (await toast(page).getByRole('button', { name: 'Undo' }).count()) === 1, `${todosText.slice(0, 80)} | detail calls ${JSON.stringify(page.__detail.slice(-3))} | toasts ${await toast(page).count()}`);
    await shot(page, 'ia2s3-employer-panel-1440');
    // Employer stage: Next -> Undo.
    await ep.getByRole('button', { name: /^Next: Responded/ }).click(); await page.waitForTimeout(1200);
    ok('employer Next moves the stage (contacted -> responded) and the panel + row follow', ins(await svc.from('sales_opportunities').select('stage').eq('id', e2.id).single()).stage === 'responded' && (await ep.getByTitle('Stage').textContent()) === 'Responded');
    await toast(page).getByRole('button', { name: 'Undo' }).click(); await page.waitForTimeout(1500);
    ok('…Undo puts the employer back to contacted (an allowed backward move)', ins(await svc.from('sales_opportunities').select('stage').eq('id', e2.id).single()).stage === 'contacted');
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);

    // Partner: Next (-> Undo), Jump back with confirm.
    await page.getByRole('button', { name: 'ZZ Partner 01', exact: true }).click();
    const pp = panelOf(page, 'ZZ Partner 01'); await pp.waitFor();
    ok('partner panel: the matched visit shows under Website visits, the open to-do count is 0 and Research says none yet', (await pp.locator('[data-section="visits"]').textContent()).includes('3 visits (7 d)') && (await pp.locator('[data-research-card]').textContent()).includes('None yet'));
    await pp.getByRole('button', { name: 'Next: Start research' }).click(); await page.waitForTimeout(1200);
    ok('partner Next: not_started -> researching through the status signal', ins(await svc.from('sales_goals').select('pipeline_status').eq('id', p01.id).single()).pipeline_status === 'researching');
    await toast(page).getByRole('button', { name: 'Undo' }).click(); await page.waitForTimeout(1500);
    const undone = ins(await svc.from('sales_goals').select('pipeline_status').eq('id', p01.id).single());
    const undoEv = ins(await svc.from('sales_partner_events').select('event').eq('goal_id', p01.id).order('recorded_at', { ascending: false }).limit(1));
    ok('…Undo restores not_started through the partner undo (an undo event, not a backward status)', undone.pipeline_status === 'not_started' && undoEv[0]?.event === 'undo');
    await pp.getByRole('button', { name: 'Next: Start research' }).click(); await page.waitForTimeout(1200);
    await pp.getByRole('button', { name: 'Jump to stage ▾' }).click();
    page.__dialogs = [];
    await pp.getByRole('group', { name: 'Jump to stage' }).getByRole('button', { name: '↩ Not started' }).click(); await page.waitForTimeout(1500);
    const jumped = ins(await svc.from('sales_goals').select('pipeline_status').eq('id', p01.id).single());
    const jumpEv = ins(await svc.from('sales_partner_events').select('event, meta').eq('goal_id', p01.id).order('recorded_at', { ascending: false }).limit(1));
    ok('Jump to stage backwards: a confirm dialog, then the move with allow_backward (event meta.backward)', (page.__dialogs || []).some(m => /Move ZZ Partner 01 back from Researching to Not started\?/.test(m)) && jumped.pipeline_status === 'not_started' && jumpEv[0]?.meta?.backward === true, JSON.stringify(page.__dialogs));
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);

    // Bar-5 path 2: Website visitors -> Visitor row -> Research -> "Add <X> to Pipeline as a target?" -> yes -> research card.
    await page.getByRole('group', { name: 'Channel' }).getByRole('button', { name: /^Website visitors/ }).click(); await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'ZZ Acme Widgets', exact: true }).click();
    const vp = panelOf(page, 'ZZ Acme Widgets'); await vp.waitFor();
    ok('visitor row opens the panel: Visitor type, website_visit channel, its visits and pages, Add to pipeline ▾ in the bar', (await vp.locator('[data-company-panel="visitor"]').count()) === 1 && (await vp.locator('[data-section="visits"]').textContent()).includes('/pricing') && (await vp.getByRole('button', { name: 'Add to pipeline ▾' }).count()) === 1);
    page.__dialogs = [];
    const usageBefore = (await svc.from('business_anthropic_usage').select('*', { count: 'exact', head: true }).eq('business_id', B)).count;
    await vp.getByRole('button', { name: 'Research', exact: true }).click(); await page.waitForTimeout(2500);
    const newTarget = ins(await svc.from('sales_targets').select('id, name, kind, status, channel, evidence, created_by').eq('business_id', B).eq('name', 'ZZ Acme Widgets'));
    ok('Research on a visitor asks "Add ZZ Acme Widgets to Pipeline as a target?" and, on yes, makes the target (researching, channel website_visit, evidence from the visit)', (page.__dialogs || []).includes('Add ZZ Acme Widgets to Pipeline as a target?') && newTarget.length === 1 && newTarget[0].status === 'researching' && newTarget[0].channel === 'website_visit' && /6 visits in 7 days/.test(newTarget[0].evidence) && newTarget[0].created_by === owner.id, JSON.stringify({ d: page.__dialogs, t: newTarget[0] }));
    const matched = ins(await svc.from('web_visits').select('matched_type, matched_id').eq('business_id', B).eq('company_key', 'zz acme widgets'));
    ok('…its web_visits rows are matched to the new target, so the Visited cell lands on the target row', matched.every(v => v.matched_type === 'target' && v.matched_id === newTarget[0]?.id));
    const tp = panelOf(page, 'ZZ Acme Widgets'); await tp.locator('[data-company-panel="target"]').waitFor(); await tp.locator('[data-research-card]').waitFor();
    if (REAL_RESEARCH) ok('…the panel switches to the target row and the research card says Researching…', (await tp.locator('[data-research-card]').textContent()).includes('Researching…'));
    else ok('…the panel switches to the target row (research card present)', (await tp.locator('[data-research-card]').count()) === 1);
    if (REAL_RESEARCH) {
      let run = null;
      for (let i = 0; i < 40 && !(run && run.status !== 'running'); i++) { await page.waitForTimeout(2500); run = ins(await svc.from('research_runs').select('status, entity_type, entity_id, cost_usd, error, result').eq('business_id', B).order('created_at', { ascending: false }).limit(1))[0] || null; }
      const usageAfter = (await svc.from('business_anthropic_usage').select('*', { count: 'exact', head: true }).eq('business_id', B)).count;
      results.research = run && { status: run.status, entity_type: run.entity_type, cost_usd: run.cost_usd, web_searches: run.result?.web_searches ?? null, error: run.error || null, usage_rows: usageAfter - usageBefore };
      console.log('RESEARCH (1 real Claude call, declared)', JSON.stringify(results.research));
      ok(`the one real Research run finished as a target run (${run?.status}${run?.cost_usd != null ? ` · $${run.cost_usd}` : ''}); 1 usage row`, run?.entity_type === 'target' && run?.entity_id === newTarget[0]?.id && ['done', 'error'].includes(run?.status) && usageAfter - usageBefore === 1, JSON.stringify(results.research));
      await page.waitForTimeout(3500);
      ok('…the research card now shows the result (or the failure line), not Researching…', !(await tp.locator('[data-research-card]').textContent()).includes('Researching…'));
    } else {
      const usageAfter = (await svc.from('business_anthropic_usage').select('*', { count: 'exact', head: true }).eq('business_id', B)).count;
      results.research = { skipped: 'fake 202 (no --real-research)', usage_rows: usageAfter - usageBefore };
      ok('0 Claude this run: the research POST was answered with a fake 202 (no --real-research); no usage row', usageAfter - usageBefore === 0);
      await page.waitForTimeout(1500);
    }
    await shot(page, 'ia2s3-target-research-1440');
    // Not a fit on the target -> Undo.
    await tp.getByRole('button', { name: 'Not a fit', exact: true }).click(); await page.waitForTimeout(2000);
    const naf = [ins(await svc.from('sales_targets').select('status').eq('id', newTarget[0].id).single()).status, await page.getByRole('complementary').count(), await page.getByRole('button', { name: 'ZZ Acme Widgets', exact: true }).count(), await toast(page).textContent().catch(() => '')];
    ok('target Not a fit: status rejected, the panel closes, the row leaves the table', naf[0] === 'rejected' && naf[1] === 0 && naf[2] === 0, JSON.stringify(naf));
    await toast(page).getByRole('button', { name: 'Undo' }).click(); await page.waitForTimeout(2000);
    const nafU = [ins(await svc.from('sales_targets').select('status').eq('id', newTarget[0].id).single()).status, await page.getByRole('button', { name: 'ZZ Acme Widgets', exact: true }).count()];
    ok('…Undo puts it back to researching and the row returns', nafU[0] === 'researching' && nafU[1] === 1, JSON.stringify(nafU));
    // Visitor priority from the panel: Not a fit -> Undo.
    await page.getByRole('button', { name: 'ZZ Noisy', exact: true }).click();
    const np = panelOf(page, 'ZZ Noisy'); await np.waitFor();
    await np.getByLabel('Priority').selectOption('not_a_fit'); await page.waitForTimeout(1500);
    ok('visitor panel Priority ▾ Not a fit: skip list + override', ins(await svc.from('sales_visit_skip').select('id').eq('business_id', B).eq('company_key', 'zz noisy')).length === 1 && ins(await svc.from('visit_priority_override').select('not_a_fit').eq('business_id', B).eq('company_key', 'zz noisy'))[0]?.not_a_fit === true);
    await toast(page).getByRole('button', { name: 'Undo' }).click(); await page.waitForTimeout(1800);
    ok('…Undo: off the skip list, override gone (back to the pull\'s P3)', ins(await svc.from('sales_visit_skip').select('id').eq('business_id', B).eq('company_key', 'zz noisy')).length === 0 && ins(await svc.from('visit_priority_override').select('id').eq('business_id', B).eq('company_key', 'zz noisy')).length === 0);
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    // Draft email in Claude copies the bundle + playbook, sends nothing.
    await page.getByRole('group', { name: 'Channel' }).getByRole('button', { name: /^All/ }).click(); await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'ZZ Employer 1', exact: true }).click();
    const e1p = panelOf(page, 'ZZ Employer 1'); await e1p.waitFor();
    await e1p.getByRole('button', { name: 'Draft email in Claude' }).click(); await page.waitForTimeout(1500);
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    ok('Draft email in Claude: the copy-bundle + playbook land on the clipboard; no email or phone in it; nothing sent', /# ZZ Employer 1 — employer/.test(clip) && /Draft one first email to ZZ Employer 1/.test(clip) && !/@/.test(clip), clip.split('\n')[0]);
    await page.keyboard.press('Escape');

    ok('owner 1440: 0 page errors', !errs.length, errs.join(' | '));
    await page.context().close();
  }
  // Actions for Cyrus shows the to-do (its own page: a goto would drop the workspace pick).
  { const { page, errs } = await newPage(owner, { url: '/?tab=actions&owner=cyrus' });
    await page.waitForTimeout(1500);
    const seen = await page.getByText('Send ZZ Employer 2 the deck').count();
    const wk = await api(owner, 'GET', `/goals/week?from=${monday(today)}&to=${monday(today)}&kind=todo`);
    const inWeek = (wk.body?.goals || []).some(g => g.text === 'Send ZZ Employer 2 the deck' && g.owner_user_id === cyrus.id);
    // Actions is still v1 Today until Stage 5: it lists overdue / due-today / flagged items only, so a Friday
    // to-do is in Cyrus's week (the Tasks drawer and the Actions week list read this) and lands on Today on Friday.
    ok(`Actions (owner Cyrus): the to-do is in Cyrus's week list (${inWeek}); on the Today page itself ${seen ? 'listed' : 'not until its due day (v1 Today shows overdue / due today only - Stage 5 rule A1 is the same)'}`, inWeek, `found on page ${seen}`);
    await shot(page, 'ia2s3-actions-cyrus-1440');
    await tab(page, 'Dashboard'); await sub(page, 'Overview'); // sales-ia-v2 Stage 6: the Weekly report lives under Dashboard > Overview
    await page.getByRole('button', { name: 'Export' }).click(); await page.getByRole('menuitem', { name: 'Weekly report PDF' }).click(); await page.waitForTimeout(1500);
    ok('Weekly report PDF prints once, one print area', (await page.evaluate(() => window.__prints)) === 1 && (await page.locator('#sales-analytics-print-area').count()) === 1);
    ok('owner 1440: 0 page errors', !errs.length, errs.join(' | '));
    await page.context().close();
  }

  // ── HomeLover density (real rows, read-only, served by intercept) ──
  { const { page } = await newPage(owner, { intercept: hlRows, url: '/?tab=pipeline&view=companies' });
    await page.locator('tr[data-row]').first().waitFor();
    const d0 = await visibleRows(page);
    await pinTable(page);
    const d1 = await visibleRows(page);
    results.density.homelover1440 = { atTop: d0, pinned: d1 };
    console.log('DENSITY HomeLover 1440', JSON.stringify(results.density.homelover1440));
    ok(`1440x900 on HomeLover rows: ${d0.full} rows at the top of the page, ${d1.full} once the filters scroll away (target >= 25)`, d1.full >= 25, JSON.stringify(results.density.homelover1440));
    await shot(page, 'ia2s3-homelover-pinned-1440');
    await page.getByRole('button', { name: /^Company/ }).click(); await page.waitForTimeout(500); await pinTable(page);
    const d2 = await visibleRows(page);
    results.density.homelover1440.sortedPinned = d2;
    console.log('DENSITY HomeLover 1440 sorted', JSON.stringify(d2));
    ok(`1440x900 on HomeLover rows, sorted (one list, one heading): ${d2.full} rows`, d2.full >= 25, JSON.stringify(d2));
    await page.context().close();
  }

  // ── 390 owner: the panel on the phone list ──
  { const { page, errs } = await newPage(owner, { width: 390, height: 844, url: '/?tab=pipeline&view=companies' });
    await page.locator('li[data-row]').first().waitFor();
    await page.getByRole('button', { name: 'ZZ Employer 3', exact: true }).click();
    const p = panelOf(page, 'ZZ Employer 3'); await p.waitFor();
    const w = await p.evaluate(el => el.getBoundingClientRect().width);
    ok('390: a row opens the panel at full width with the action bar wrapped, no sideways page scroll', w <= 390 && (await p.getByRole('region', { name: 'Actions' }).count()) === 1 && await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `width ${w}`);
    await shot(page, 'ia2s3-panel-390');
    await page.keyboard.press('Escape');
    ok('390: 0 page errors', !errs.length, errs.join(' | '));
    await page.context().close();
  }

  // ── Viewer ──
  { const { page, errs } = await newPage(viewer, { url: '/?tab=pipeline&view=companies' });
    await page.locator('tr[data-row]').first().waitFor();
    await page.getByRole('button', { name: 'ZZ Partner 03', exact: true }).click();
    const p = panelOf(page, 'ZZ Partner 03'); await p.waitFor();
    ok('Viewer: the panel has the body but no action bar, no dropdowns, no ★; View only shown', (await p.getByRole('region', { name: 'Actions' }).count()) === 0 && (await p.locator('select, textarea').count()) === 0 && (await p.getByText('You have view access, so this is read-only.').count()) === 1);
    ok('Viewer: 0 page errors', !errs.length, errs.join(' | '));
    await page.context().close();
  }

  const runs = (await svc.from('visit_pull_runs').select('*', { count: 'exact', head: true }).eq('business_id', B)).count;
  const spendAfter = (await svc.from('apollo_credit_spend').select('*', { count: 'exact', head: true })).count;
  ok('0 Apollo: no visitor pull ran, apollo_credit_spend unchanged', runs === 0 && spendAfter === spendBefore, `runs ${runs} spend ${spendBefore}->${spendAfter}`);
  const bundle = fs.readdirSync(ROOT + '/build/static/js').filter(f => f.endsWith('.js')).map(f => fs.readFileSync(`${ROOT}/build/static/js/${f}`, 'utf8')).join('');
  ok('bundle: company panel routes, Jump to stage, allow_backward, Add to pipeline; no PartnerQuickPanel', bundle.includes('/company/add-to-pipeline') && bundle.includes('Jump to stage') && bundle.includes('allow_backward') && bundle.includes('to Pipeline as a target?') && !bundle.includes('pqp-next-step'));
} catch (e) {
  ok('script ran without throwing', false, e.stack?.split('\n').slice(0, 3).join(' | ') || e.message);
} finally {
  await cleanup();
  const left = B ? (await svc.from('businesses').select('id', { count: 'exact', head: true }).eq('id', B)).count : 0;
  console.log(`teardown: workspace left ${left}`);
  const hlAfter = await hlCounts();
  const diff = Object.keys(hlBefore).filter(k => hlBefore[k] !== hlAfter[k]);
  ok(`HomeLover counts identical (${HL.length} tables)`, !diff.length, diff.map(k => `${k} ${hlBefore[k]}->${hlAfter[k]}`).join(', '));
  fs.writeFileSync(`${OUT}/ia2-stage3-numbers.json`, JSON.stringify(results, null, 2));
  console.log(`\n${pass}/${total} passed · restored: ${left === 0 && !diff.length ? 'yes' : 'NO'}`);
  process.exit(0);
}
