// sales-ia-v2 REV2 Stage 5 bar 4 (A1 Actions: one ranked list of signals, Tidy, overdue waiting-on, to-dos, flags and Focus 5
// on the kit table; Mine | Team | Kind | Search; every column sorts; finishing removes the row with a 10 s Undo; Company opens
// the P4 company window; Viewers get the read-only Team list; the N2 layout check; the Weekly report PDF still prints).
// SCOPE (declared): TEMP data only - 1 workspace (goals_sales on, added to SALES_ANALYTICS_BUSINESS_IDS for the local
// server only) + 3 temp users (owner, member "Cyrus Temp", viewer) + 2 partners, 1 employer, 1 target, 1 web visit,
// 2 signals, 1 Tidy suggestion, 1 week plan, 7 sales_week_goals rows (made-up names; no emails or phones anywhere).
// HomeLover is never written; its table counts are compared before and after. 0 Apollo (sync / apollo / visit-pull
// routes aborted in the browser). 0 Claude. Runtime ~2.5 min, hard cap 285 s (tempGuard), teardown deletes everything.
// Usage: node scripts/verify/sales-ia-v2-stage5.mjs <outdir>   (run npm run build first)
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
const PORT = 3977;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const NAME = 'ZZ Sales IA v2 Stage5';
const HL = ['sales_week_goals', 'sales_signals', 'sales_suggestions', 'sales_targets', 'sales_goals', 'sales_opportunities', 'sales_partner_events', 'web_visits', 'research_runs'];
const TEMP_TABLES = ['sales_week_goal_steps', 'sales_week_goals', 'sales_week_plans', 'sales_signals', 'sales_suggestions', 'sales_tidy_runs', 'web_visits', 'visit_pull_runs', 'research_runs', 'sales_partner_events', 'sales_opportunity_events', 'sales_targets', 'sales_opportunities', 'sales_goals', 'auth_events', 'business_members'];
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const hlCounts = async () => { const o = {}; for (const t of HL) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HOMELOVER)).count; return o; };
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
const laToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const monday = d => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));
fs.mkdirSync(OUT, { recursive: true });
const hlBefore = await hlCounts();
console.log('HomeLover before', JSON.stringify(hlBefore));
const results = { n2: {}, ranking: null };
try {
  const tag = 'ia2s5-' + Date.now();
  B = ins(await svc.from('businesses').insert({ name: NAME, website_url: 'https://ia2s5.example.com', color: '#6F8CF0', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
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
  const today = laToday(), week = monday(today);
  const [p1, p2] = ins(await svc.from('sales_goals').insert([
    { business_id: B, goal_type: 'partnership', name: 'ZZ Lakeshore Mutual', pipeline_status: 'replied', priority: 1, channel: 'manual' },
    { business_id: B, goal_type: 'partnership', name: 'ZZ Northwind Benefits', pipeline_status: 'first_email_sent', channel: 'manual' },
  ]).select('id, name'));
  const emp = ins(await svc.from('sales_opportunities').insert({ business_id: B, organization: 'ZZ Old Mill Union', org_type: 'employer', stage: 'contacted', source: 'manual', channel: 'manual' }).select('id').single());
  ins(await svc.from('sales_targets').insert({ business_id: B, name: 'ZZ Zeta Labs', kind: 'employer', status: 'researching', channel: 'scout' }).select('id'));
  ins(await svc.from('web_visits').insert({ business_id: B, pulled_on: today, company_key: 'zz visitor co', company_name: 'ZZ Visitor Co', priority: 'P1', priority_rule: 'US 500+ with 5+ visits', visits_7d: 6, last_visit: today, us_500: true, top_paths: ['/pricing'] }).select('id'));
  const [webSig, scoutSig] = ins(await svc.from('sales_signals').insert([
    { business_id: B, source: 'web_visit', signal_week: week, company_name: 'ZZ Visitor Co', company_key: 'zz visitor co', kind: 'employer', kind_guessed: true, signal: '6 visits in 7 days / 2 unique visitors (Apollo); top pages /pricing', why_now: 'P1 Act today: US 500+ with 5+ visits', status: 'new', created_by: owner.id },
    { business_id: B, source: 'scout', signal_week: week, company_name: 'ZZ Scout Co', company_key: 'zz scout co', kind: 'partner', kind_guessed: false, who: 'Head of People', signal: 'Opened a Chicago office', why_now: 'Hiring 40 people', score: 55, status: 'new', created_by: owner.id },
  ]).select('id, company_name'));
  const sug = ins(await svc.from('sales_suggestions').insert({ business_id: B, kind: 'follow_up', ref_type: 'partner', ref_id: p1.id, text: 'Follow up ZZ Lakeshore Mutual', reason: 'Replied · last touch 12 d ago · no open to-do', status: 'proposed' }).select('id').single());
  const plan = ins(await svc.from('sales_week_plans').insert({ business_id: B, week_start: week, owner_user_id: owner.id, prompt: '', inputs: {}, proposals: [], chosen_count: 2, created_by: owner.id }).select('id').single());
  const wgRows = [
    { business_id: B, week_start: week, kind: 'todo', status: 'open', text: 'ZZ Send the deck', owner_user_id: owner.id, due_date: addDays(today, -2), link_type: 'partner', link_id: p2.id, created_by: owner.id },
    { business_id: B, week_start: week, kind: 'todo', status: 'open', text: 'ZZ Call back Old Mill', owner_user_id: owner.id, due_date: today, link_type: 'opportunity', link_id: emp.id, created_by: owner.id },
    { business_id: B, week_start: week, kind: 'todo', status: 'open', text: 'ZZ Draft the one-pager', owner_user_id: cyrus.id, due_date: addDays(today, 2), created_by: cyrus.id },
    { business_id: B, week_start: week, kind: 'todo', status: 'open', text: 'ZZ Follow up the benefits lead', owner_user_id: owner.id, prospect_contact_id: 'zz-c1', flagged_by: cyrus.id, flag_note: 'opened 3x', contacts: ['Benefits lead'], created_by: cyrus.id },
    { business_id: B, week_start: monday(addDays(today, -7)), kind: 'waiting', status: 'open', text: 'the signed MSA', waiting_on: 'Pat', due_date: addDays(today, -5), link_type: 'partner', link_id: p1.id, created_by: owner.id },
    { business_id: B, week_start: week, kind: 'commitment', status: 'open', text: 'ZZ Book two partner meetings', owner_user_id: owner.id, plan_id: plan.id, plan_rank: 1, plan_reason: 'Pipeline is thin', created_by: owner.id },
    { business_id: B, week_start: week, kind: 'commitment', status: 'done', text: 'ZZ Ship the deck', owner_user_id: owner.id, plan_id: plan.id, plan_rank: 2, created_by: owner.id },
  ];
  // A bulk insert sends null for any key a row leaves out, so the NOT NULL defaults are spelled out.
  const wg = ins(await svc.from('sales_week_goals').insert(wgRows.map(r => ({ contacts: [], sort_order: 0, ...r }))).select('id, text'));

  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const api = async (u, method, p, body) => {
    const res = await fetch(`http://localhost:${PORT}/api/sales/${B}${p}`, { method, headers: { Cookie: `prospector_at=${encodeURIComponent(u.session.access_token)}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  // ── API ──
  const a0 = await api(owner, 'GET', '/goals/actions');
  const keys = (a0.body?.items || []).map(i => `${i.kind}:${i.text}`);
  results.ranking = (a0.body?.items || []).map(i => ({ kind: i.kind, text: i.text, p: i.priority, overdue: i.overdue, due: i.due_date, company: i.company?.name || null }));
  console.log('RANKING', JSON.stringify(results.ranking));
  ok('GET goals/actions: 200, 10 items (the done Focus item rides along for the fold), all six kinds, the two overdue rows first (waiting 5 d late, then the to-do 2 d late)', a0.status === 200 && a0.body.items.length === 10 && new Set(a0.body.items.map(i => i.kind)).size === 6 && keys[0] === 'waiting:Waiting on Pat: the signed MSA' && keys[1] === 'todo:ZZ Send the deck', JSON.stringify({ s: a0.status, keys }));
  const by = Object.fromEntries((a0.body?.items || []).map(i => [i.text, i]));
  ok('priority: the Tidy row on the P1 partner is P1; the P1 website signal is P1; the flag is P1; the scout signal (score 55) is P2; a to-do due later is P3', by['Follow up ZZ Lakeshore Mutual']?.priority === 1 && by['Reach out: ZZ Visitor Co']?.priority === 1 && by['ZZ Follow up the benefits lead']?.priority === 1 && by['Reach out: ZZ Scout Co — Head of People']?.priority === 2 && by['ZZ Draft the one-pager']?.priority === 3, JSON.stringify(Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.priority]))));
  ok('company: to-dos name their partner / employer, the website signal names the visitor row, the scout company has no Pipeline row yet', by['ZZ Send the deck']?.company?.name === 'ZZ Northwind Benefits' && by['ZZ Call back Old Mill']?.company?.type === 'employer' && by['Reach out: ZZ Visitor Co']?.company?.type === 'visitor' && by['Reach out: ZZ Scout Co — Head of People']?.company?.type === null);
  const v0 = await api(viewer, 'GET', '/goals/actions');
  ok('Viewer: GET goals/actions is 200; POST signal undo is 403', v0.status === 200 && (await api(viewer, 'POST', `/goals/signals/${webSig.id}/undo`)).status === 403);
  // Accept the website signal -> a new target + a to-do (due Friday) that joins the list; Undo takes both back.
  const acc = await api(owner, 'POST', `/goals/signals/${webSig.id}/accept`);
  const a1 = await api(owner, 'GET', '/goals/actions');
  const newTodo = a1.body.items.find(i => i.kind === 'todo' && i.text === 'Reach out: ZZ Visitor Co');
  ok('Accept a signal: 200 via new_target; its to-do (Signals, due Friday) is now on the list and the signal row is gone', acc.status === 200 && acc.body.via === 'new_target' && !!newTodo && newTodo.why === 'Signals' && !a1.body.items.some(i => i.kind === 'signal' && i.text === 'Reach out: ZZ Visitor Co'), JSON.stringify({ s: acc.status, via: acc.body?.via, newTodo: newTodo && { why: newTodo.why, due: newTodo.due_date } }));
  const und = await api(owner, 'POST', `/goals/signals/${webSig.id}/undo`);
  const a2 = await api(owner, 'GET', '/goals/actions');
  const tgtLeft = ins(await svc.from('sales_targets').select('id').eq('business_id', B).eq('name', 'ZZ Visitor Co'));
  ok('Undo accept: 200, the signal is new again on the list, its to-do and the target it made are gone', und.status === 200 && und.body.signal.status === 'new' && a2.body.items.some(i => i.kind === 'signal' && i.text === 'Reach out: ZZ Visitor Co') && !a2.body.items.some(i => i.kind === 'todo' && i.text === 'Reach out: ZZ Visitor Co') && tgtLeft.length === 0, JSON.stringify({ s: und.status, e: und.body?.error }));
  const sa = await api(owner, 'POST', `/goals/suggestions/${sug.id}/accept`);
  const su = await api(owner, 'POST', `/goals/suggestions/${sug.id}/undo`, { todo_id: sa.body?.todo?.id });
  ok('Tidy Accept then Undo with the to-do id: suggestion proposed again, the Tidy to-do deleted', sa.status === 200 && su.status === 200 && su.body.suggestion.status === 'proposed' && ins(await svc.from('sales_week_goals').select('id').eq('id', sa.body.todo.id)).length === 0, JSON.stringify({ sa: sa.status, su: su.status, e: su.body?.error }));

  // ── browser ──
  browser = await chromium.launch();
  async function newPage(u, { width = 1440, height = 900, url = '/?tab=actions', ws = NAME } = {}) {
    const errs = [];
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage(); page.setDefaultTimeout(12000);
    page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
    page.on('dialog', d => d.accept());
    await page.addInitScript(([k, v, b, d]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      // actions-v2 REV2: Actions opens on the signed-in person with Housekeeping folded; these checks read the whole team, unfolded.
      localStorage.setItem('prospector_goals_owner', 'team'); localStorage.setItem('prospector_actions_folded', '[]');
      localStorage.setItem(`prospector_visits_ran_${b}`, d); localStorage.setItem(`prospector_tidy_ran_${b}`, d);
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
  const tab = async (page, label) => { await page.locator('#workspace-header-tabs').getByRole('button', { name: new RegExp(`^${label}`) }).first().click(); await page.waitForTimeout(1500); };
  const sub = async (page, label) => { await page.locator('[data-sales-subviews]').getByRole('tab', { name: label, exact: true }).click(); await page.waitForTimeout(1500); };
  const boxes = page => page.evaluate(() => Object.fromEntries(['data-workspace-header', 'data-sales-tabrow', 'data-sales-subviews', 'data-filter-row'].map(a => {
    const el = document.querySelector(`[${a}]`); if (!el) return [a, null];
    const r = el.getBoundingClientRect(); return [a, { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, h: Math.round(r.height * 10) / 10 }];
  }).concat([['table', (() => { const b = document.querySelector('.ui-table-box, ul.ui-list'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, h: 0 }; })()]])));
  const maxMove = (a, b) => Math.max(0, ...Object.keys(a).filter(k => a[k] && b[k]).flatMap(k => [Math.abs(a[k].x - b[k].x), Math.abs(a[k].y - b[k].y), Math.abs(a[k].h - b[k].h)]));
  const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide' });
  const table = page => page.getByRole('table', { name: 'Actions' });
  const rowTexts = page => page.locator('tr[data-row]').evaluateAll(trs => trs.map(tr => ({ key: tr.dataset.key, p: tr.children[0].textContent, text: tr.children[1].textContent })));
  const acts = (page, text) => page.getByRole('group', { name: `Actions for ${text}` });
  const toast = page => page.locator('#sales-analytics-root > [role="status"]').last();

  // ── owner 1440 ──
  { const { page, errs } = await newPage(owner);
    await page.locator('tr[data-row]').first().waitFor();
    const n2 = {};
    for (const [t, s, key] of [['Actions', null, 'actions'], ['Dashboard', 'Overview', 'dashboard'], ['Pipeline', 'Companies', 'companies'], ['Pipeline', 'People', 'people'], ['Actions', null, 'actions2']]) { await tab(page, t); if (s) await sub(page, s); n2[key] = await boxes(page); }
    const ref = n2.actions;
    const tabMove = Math.max(...Object.values(n2).map(b => Math.max(Math.abs(b['data-sales-tabrow'].x - ref['data-sales-tabrow'].x), Math.abs(b['data-sales-tabrow'].y - ref['data-sales-tabrow'].y))));
    const subMove = Math.max(...Object.values(n2).map(b => Math.max(Math.abs(b['data-sales-subviews'].y - ref['data-sales-subviews'].y), Math.abs(b['data-sales-subviews'].x - ref['data-sales-subviews'].x))));
    results.n2['1440 across tabs'] = { tabRow: ref['data-sales-tabrow'], subViews: ref['data-sales-subviews'], actionsFilterRow: ref['data-filter-row'], tabRowMaxMove: tabMove, subViewsMaxMove: subMove };
    ok(`N2 1440: tab row and sub-view switch at the same x/y on Actions, Dashboard, Companies, People and back (max move ${tabMove} / ${subMove} px)`, tabMove <= 1 && subMove <= 1, JSON.stringify(results.n2['1440 across tabs']));
    await page.locator('tr[data-row]').first().waitFor();
    const rows0 = await rowTexts(page);
    // actions-v2 REV2 A1: whose list = the frame's one Who control (this page starts on Team); the top row sits in Now.
    ok(`bar-5: Team - the top row is overdue in Now (${rows0[0]?.p}); 9 open rows incl. Cyrus's to-do + the "1 done ▸" fold`, /^Overdue/.test(rows0[0]?.p || '') && rows0.some(r => r.text === 'ZZ Draft the one-pager') && rows0.length === 9 && (await page.getByRole('button', { name: '1 done ▸' }).count()) === 1, JSON.stringify(rows0));
    const b0 = await boxes(page);
    await page.getByRole('group', { name: 'Filter by person' }).getByRole('button', { name: 'Jack' }).click(); await page.waitForTimeout(300);
    const rowsJ = await rowTexts(page);
    ok('Who = Jack: only Jack\'s rows - Cyrus\'s to-do and the unowned signals leave', !rowsJ.some(r => r.text === 'ZZ Draft the one-pager') && !rowsJ.some(r => r.key.startsWith('signal-')) && rowsJ.length > 0, JSON.stringify(rowsJ.map(r => r.key)));
    await page.getByRole('group', { name: 'Filter by person' }).getByRole('button', { name: 'Team' }).click(); await page.waitForTimeout(300);
    const rows1 = await rowTexts(page);
    ok('Team shows the teammate\'s to-do again (9 open rows)', rows1.length === 9 && rows1.some(r => r.text === 'ZZ Draft the one-pager'));
    await page.getByLabel('Kind').selectOption('signal'); await page.waitForTimeout(200);
    await page.getByLabel('Search actions').fill('scout'); await page.waitForTimeout(300);
    const b1 = await boxes(page);
    ok('Kind + Search narrow to the one scout signal', (await rowTexts(page)).map(r => r.text).join('|') === 'Reach out: ZZ Scout Co — Head of People');
    await page.getByRole('button', { name: /^Clear/ }).click(); await page.waitForTimeout(300);
    // Every column sorts: Due asc puts the overdue waiting row first; a third click returns to the ranking.
    const due = table(page).locator('thead').getByRole('button', { name: /^Due/ });
    await due.click(); await page.waitForTimeout(200);
    ok('sort by Due: the oldest due first; header says ascending', (await rowTexts(page))[0].text === 'Waiting on Pat: the signed MSA' && (await table(page).locator('thead th[aria-sort="ascending"]').count()) === 1);
    await due.click(); await due.click(); await page.waitForTimeout(200);
    const heads = await table(page).locator('thead th').evaluateAll(ths => ths.map(th => th.getAttribute('aria-sort')));
    ok('every column but Actions sorts (7 sortable headers), back to the ranking after the third click', heads.filter(Boolean).length === 7 && heads.every(h => h !== 'ascending' && h !== 'descending'));
    await page.locator('.ui-table-box').evaluate(el => { el.scrollLeft = 0; });
    const fit = await page.locator('.ui-table-box').evaluate(el => ({ scrollW: el.scrollWidth, clientW: el.clientWidth }));
    ok(`1440: the Member table fits without a sideways scroll (${fit.scrollW} in ${fit.clientW})`, fit.scrollW <= fit.clientW + 1, JSON.stringify(fit));
    await shot(page, 'ia2s5-actions-1440');
    // bar-5: Accept a signal -> its to-do appears -> Done -> Undo.
    await acts(page, 'Reach out: ZZ Visitor Co').getByRole('button', { name: 'Accept' }).click();
    await toast(page).waitFor(); await page.waitForTimeout(1500);
    const b2 = await boxes(page);
    const afterAccept = await rowTexts(page);
    const todoRow = afterAccept.find(r => r.key.startsWith('todo-') && r.text === 'Reach out: ZZ Visitor Co');
    ok('Accept a signal: the signal row left at once, the toast names the to-do with Undo, and the to-do row appeared', !!todoRow && !afterAccept.some(r => r.key.startsWith('signal-') && r.text === 'Reach out: ZZ Visitor Co') && (await toast(page).textContent()).includes('Accepted · to-do added: Reach out: ZZ Visitor Co') && (await toast(page).getByRole('button', { name: 'Undo' }).count()) === 1, JSON.stringify(afterAccept.map(r => r.key)));
    await shot(page, 'ia2s5-accept-toast-1440');
    await acts(page, 'Reach out: ZZ Visitor Co').getByRole('button', { name: 'Done' }).click(); await page.waitForTimeout(1200);
    const todoId = todoRow.key.slice(5);
    ok('Done on that to-do: the row leaves, the DB row is done', !(await rowTexts(page)).some(r => r.key === todoRow.key) && ins(await svc.from('sales_week_goals').select('status').eq('id', todoId).single()).status === 'done');
    await toast(page).getByRole('button', { name: 'Undo' }).click();
    let undone = false;
    for (let i = 0; i < 12 && !undone; i++) { await page.waitForTimeout(500); undone = ins(await svc.from('sales_week_goals').select('status').eq('id', todoId).single()).status === 'open' && (await rowTexts(page)).some(r => r.key === todoRow.key); }
    ok('Undo: the to-do is open again and back on the list (within 6 s)', undone);
    const mv = Math.max(maxMove(b0, b1), maxMove(b0, b2));
    results.n2['1440 filters/notice'] = { before: b0, afterFilters: b1, afterToast: b2, maxMove: mv };
    ok(`N2 1440: Who + Kind + Search and a toast move nothing above the table (max ${mv} px)`, mv <= 1, JSON.stringify(results.n2['1440 filters/notice']));
    // Company opens the P4 window (Part B's CenterWindow); Esc closes it.
    await page.getByRole('button', { name: 'ZZ Northwind Benefits' }).first().click();
    const win = page.locator('aside[data-center-window]'); await win.waitFor(); await win.locator('[data-company-panel="partner"]').waitFor();
    ok('Company opens the centered company window on the partner', (await win.count()) === 1);
    await shot(page, 'ia2s5-company-window-1440');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    ok('Esc closes it', (await win.count()) === 0);
    // Focus: Done folds the item into "2 done ▸"; the fold opens with Reopen.
    await acts(page, 'ZZ Book two partner meetings').getByRole('button', { name: 'Done' }).click(); await page.waitForTimeout(1500);
    const fold = page.getByRole('button', { name: '2 done ▸' });
    await fold.waitFor({ timeout: 8000 }).catch(() => {}); // the list reloads after the write (TODOS_CHANGED)
    ok('Focus Done: no struck-through row, the item folds into "2 done ▸"', (await fold.count()) === 1 && !(await rowTexts(page)).some(r => r.text === 'ZZ Book two partner meetings'), JSON.stringify({ toggles: await page.locator('.ui-table__toggle').allInnerTexts(), rows: (await rowTexts(page)).map(r => r.text) }));
    await fold.click(); await page.waitForTimeout(300);
    ok('…opening the fold lists it with Reopen', (await acts(page, 'ZZ Book two partner meetings').getByRole('button', { name: 'Reopen' }).count()) === 1);
    await toast(page).getByRole('button', { name: 'Undo' }).click(); await page.waitForTimeout(1200);
    ok('…Undo reopens it', ins(await svc.from('sales_week_goals').select('status').eq('text', 'ZZ Book two partner meetings').single()).status === 'open');
    // L7: the Weekly report PDF still prints once.
    await tab(page, 'Dashboard'); await sub(page, 'Overview'); // sales-ia-v2 Stage 6: the Weekly report lives under Dashboard > Overview
    await page.getByRole('button', { name: 'Export' }).click(); await page.getByRole('menuitem', { name: 'Weekly report PDF' }).click(); await page.waitForTimeout(1500);
    ok('Weekly report PDF still prints once, one print area (L7)', (await page.evaluate(() => window.__prints)) === 1 && (await page.locator('#sales-analytics-print-area').count()) === 1);
    ok('owner 1440: 0 page errors', !errs.length, errs.join(' | '));
    await page.context().close();
  }
  // ── owner 390 ──
  { const { page, errs } = await newPage(owner, { width: 390, height: 844 });
    await page.locator('[data-row]').first().waitFor();
    const b0 = await boxes(page);
    await page.getByRole('button', { name: /^Filters/ }).click(); await page.getByRole('dialog', { name: 'Filters' }).waitFor();
    await page.getByRole('dialog', { name: 'Filters' }).getByRole('button', { name: /^Show / }).click(); await page.waitForTimeout(400);
    const b1 = await boxes(page);
    const n = await page.locator('[data-row]').count();
    ok(`390: the card list with the filter sheet; Team (the frame's Who) shows 9 open cards (${n}); no sideways scroll`, n >= 9 && (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)));
    const mv = maxMove(b0, b1);
    results.n2['390'] = { before: b0, afterSheet: b1, maxMove: mv };
    ok(`N2 390: the filter sheet moves nothing above the list (max ${mv} px)`, mv <= 1, JSON.stringify(results.n2['390']));
    await shot(page, 'ia2s5-actions-390');
    ok('390: 0 page errors', !errs.length, errs.join(' | '));
    await page.context().close();
  }
  // ── viewer 1440 ──
  { const { page, errs } = await newPage(viewer);
    await page.locator('tr[data-row]').first().waitFor();
    const rows = await rowTexts(page);
    const kinds = new Set(rows.map(r => r.key.split('-')[0]));
    ok('Viewer: the Team list - to-dos (both people), the flag, Focus 5; no signals, Tidy or waiting rows', [...kinds].sort().join(',') === 'flag,focus,todo' && rows.some(r => r.text === 'ZZ Draft the one-pager') && rows.length === 6, JSON.stringify(rows.map(r => r.key)));
    ok('Viewer: no action buttons (no Actions column), no selects, no Mine/Team, no Plan this week; View only chip shown', (await page.getByRole('group', { name: /^Actions for/ }).count()) === 0 && (await table(page).locator('thead th').count()) === 7 && (await table(page).locator('select').count()) === 0 && (await page.getByRole('group', { name: 'Who' }).count()) === 0 && (await page.getByRole('button', { name: 'Plan this week' }).count()) === 0 && (await page.getByText('View only').count()) === 1);
    await shot(page, 'ia2s5-viewer-1440');
    ok('viewer 1440: 0 page errors', !errs.length, errs.join(' | '));
    await page.context().close();
  }
  const spendAfter = (await svc.from('visit_pull_runs').select('*', { count: 'exact', head: true }).eq('business_id', B)).count;
  ok('0 Apollo: no visitor pull ran in the temp workspace', spendAfter === 0, String(spendAfter));
  const bundle = fs.readdirSync(ROOT + '/build/static/js').filter(f => f.endsWith('.js')).map(f => fs.readFileSync(`${ROOT}/build/static/js/${f}`, 'utf8')).join('');
  ok('bundle: Actions list + undo routes in, the v1 Today strings out', bundle.includes('/actions') && bundle.includes('prospector_actions_sort') && !bundle.includes('h-your-day') && !bundle.includes('This week at a glance') && !bundle.includes('The team today'));
} catch (e) {
  ok('script ran without throwing', false, e.stack?.split('\n').slice(0, 3).join(' | ') || e.message);
} finally {
  await cleanup();
  const left = B ? (await svc.from('businesses').select('id', { count: 'exact', head: true }).eq('id', B)).count : 0;
  console.log(`teardown: workspace left ${left}`);
  const hlAfter = await hlCounts();
  const diff = Object.keys(hlBefore).filter(k => hlBefore[k] !== hlAfter[k]);
  ok(`HomeLover counts identical (${HL.length} tables)`, !diff.length, diff.map(k => `${k} ${hlBefore[k]}->${hlAfter[k]}`).join(', '));
  fs.writeFileSync(`${OUT}/ia2-stage5-numbers.json`, JSON.stringify(results, null, 2));
  console.log(`\n${pass}/${total} passed · restored: ${left === 0 && !diff.length ? 'yes' : 'NO'}`);
  process.exit(0);
}
