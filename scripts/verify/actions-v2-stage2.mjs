// actions-v2 REV2 Stage 2 - the Actions UI in a temp workspace: A1 the frame's one Who control (opens on the signed-in
// person; Team = all; Unassigned (n)); A2 Now / Today / This week / Housekeeping sections (Housekeeping folded, the fold
// remembered); A3 the same three slots on every row, lined up; A4 the owner of a signal changed to Cyrus = accepted as
// Cyrus's to-do (DB), a to-do's due date moved to Friday, a to-do's text edited in the row detail, each with Undo; a
// Viewer pass; 1440 + 390 (Primary + More ▾), the ui-clarity measure, N2.
// SCOPE (declared): TEMP data only - 1 goals_sales workspace (added to SALES_ANALYTICS_BUSINESS_IDS for the local server
// only), 3 temp users (Jack Test owner, Cyrus Temp member, Viewer Test viewer); seeds 1 partner, 2 signals, 2 Tidy
// suggestions, 3 to-dos, 1 waiting-on row. The run writes <= 1 target + 2 to-dos (accept) and a handful of PATCHes.
// Made-up names; no addresses. HomeLover never written (counts compared). 0 Claude / 0 Apollo / 0 Graph: sync, apollo,
// visit pull, tidy, research, anthropic and /api/microsoft are aborted in the browser (count reported); run tables
// counted. Runtime ~2 min, hard cap 300 s (tempGuard). Shots + report: .screenshots/actions-v2/. Run npm run build first.
// Usage: node scripts/verify/actions-v2-stage2.mjs [outdir]
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
const OUT = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(ROOT, '.screenshots', 'actions-v2');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3985;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const NAME = 'ZZ Actions v2 Stage2';
const HL = ['sales_week_goals', 'sales_signals', 'sales_suggestions', 'sales_targets', 'sales_goals'];
const RUNS = ['research_runs', 'visit_pull_runs', 'sales_sync_runs', 'sales_tidy_runs'];
const TEMP_TABLES = ['sales_source_events', 'sales_partner_events', 'sales_week_goal_steps', 'sales_week_goals', 'sales_signals', 'sales_suggestions', ...RUNS, 'sales_targets', 'sales_opportunities', 'sales_goals', 'auth_events', 'business_members'];
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
  for (const u of users) {
    await svc.from('auth_events').delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('actor_id', u.id);
    await svc.from('microsoft_sync_runs').delete().eq('user_id', u.id);
    await svc.auth.admin.deleteUser(u.id);
  }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 300000 });
const laToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const monday = d => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));
const friday = d => addDays(d, ((5 - new Date(`${d}T12:00:00Z`).getUTCDay() + 7) % 7) || 7);
fs.mkdirSync(OUT, { recursive: true });
const hlBefore = await hlCounts();
log('HomeLover before', JSON.stringify(hlBefore));
const results = { screens: {}, checks: [], errors: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${detail}` : ''); };
const SCREEN = measureScript({ scope: '#sales-analytics-root' });
const BOXES = `(() => Object.fromEntries(['data-workspace-header', 'data-sales-tabrow', 'data-sales-subviews', 'data-sales-frame', 'data-filter-row'].map(a => {
  const el = document.querySelector('[' + a + ']'); if (!el) return [a, null];
  const r = el.getBoundingClientRect(); return [a, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }];
})))()`;
const maxMove = (a, b, keys) => Math.max(...keys.map(k => (a[k] && b[k] ? Math.max(Math.abs(a[k].x - b[k].x), Math.abs(a[k].y - b[k].y), Math.abs(a[k].h - b[k].h)) : 0)));

try {
  const tag = 'av2-' + Date.now();
  B = ins(await svc.from('businesses').insert({ name: NAME, website_url: 'https://av2.example.com', color: '#6F8CF0', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
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
  const p1 = ins(await svc.from('sales_goals').insert({ business_id: B, goal_type: 'partnership', name: 'ZZ Lakeshore Mutual', pipeline_status: 'replied', priority: 1, channel: 'manual' }).select('id').single());
  ins(await svc.from('sales_signals').insert([
    { business_id: B, source: 'scout', signal_week: week, company_name: 'ZZ Scout Co', company_key: 'zz scout co', kind: 'employer', kind_guessed: false, who: 'Head of People', signal: 'Opened a Chicago office', why_now: 'Hiring', score: 55, status: 'new', created_by: owner.id },
    { business_id: B, source: 'scout', signal_week: week, company_name: 'ZZ Beacon Labs', company_key: 'zz beacon labs', kind: 'employer', kind_guessed: false, who: null, signal: 'Raised a round', why_now: null, score: 40, status: 'new', created_by: owner.id },
  ]).select('id'));
  const wg = ins(await svc.from('sales_week_goals').insert([
    { business_id: B, week_start: week, kind: 'todo', status: 'open', text: 'ZZ Call back Lakeshore', owner_user_id: owner.id, due_date: today, link_type: 'partner', link_id: p1.id, created_by: owner.id },
    { business_id: B, week_start: week, kind: 'todo', status: 'open', text: 'ZZ Draft the one-pager', owner_user_id: cyrus.id, due_date: addDays(today, 1), created_by: cyrus.id },
    { business_id: B, week_start: week, kind: 'todo', status: 'open', text: 'ZZ Read the annual report', owner_user_id: owner.id, due_date: null, created_by: owner.id },
    { business_id: B, week_start: monday(addDays(today, -7)), kind: 'waiting', status: 'open', text: 'the signed MSA', waiting_on: 'Pat', due_date: addDays(today, -4), link_type: 'partner', link_id: p1.id, created_by: owner.id },
  ].map(r => ({ contacts: [], sort_order: 0, ...r }))).select('id, text'));
  const undated = wg.find(r => r.text === 'ZZ Read the annual report');
  ins(await svc.from('sales_suggestions').insert([
    { business_id: B, kind: 'follow_up', ref_type: 'partner', ref_id: p1.id, text: 'Follow up ZZ Lakeshore Mutual', reason: 'Replied · last touch 12 d ago', status: 'proposed' },
    { business_id: B, kind: 'set_a_date', ref_type: 'todo', ref_id: undated.id, text: 'Set a date or drop: ZZ Read the annual report', reason: 'Open with no due date', status: 'proposed' },
  ]).select('id'));
  const runsBefore = {}; for (const t of RUNS) runsBefore[t] = await count(t, 'business_id', B);
  log('fixture in');

  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  const blocked = [];
  async function newPage(u, { width = 1440, height = 900 } = {}) {
    const errs = [];
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', e => errs.push(`PAGE ${u.name}@${width}: ${e.message.slice(0, 160)}`));
    page.on('requestfailed', r => { if (!blocked.includes(r.url())) results.errors.push(`request failed ${u.name}@${width}: ${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')} ${r.failure()?.errorText}`); });
    // Fresh browser: no remembered Who, no folds - the defaults are what this checks.
    await page.addInitScript(([k, v, b, dd]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      localStorage.setItem(`prospector_visits_ran_${b}`, dd); localStorage.setItem(`prospector_tidy_ran_${b}`, dd); localStorage.setItem(`prospector_apollo_sync_ran_${b}`, dd);
    }, [`sb-${REF}-auth-token`, JSON.stringify(u.session), B, today]);
    await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)|\/goals\/visits\/pull|\/goals\/tidy\/run|\/research\/run|\/research$|\/proxy\/anthropic|\/api\/microsoft\//, route => { blocked.push(route.request().url()); route.abort(); });
    await page.goto(`http://localhost:${PORT}/`);
    await page.locator('#main-content').getByText(NAME).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').selectOption({ label: NAME }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    await page.locator('[data-actions]').waitFor({ timeout: 20000 });
    await page.locator('[data-actions] .ui-table__toggle, [data-actions] [data-row]').first().waitFor({ timeout: 20000 }); await page.waitForTimeout(1500);
    return { page, errs };
  }
  const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide', fullPage: true });
  const measure = async (page, key) => {
    const m = await page.evaluate(SCREEN);
    if (m.error) { results.errors.push(`${key}: ${m.error}`); return null; }
    const s = summarize(m); results.screens[key] = { ...s, scrollW: m.scrollW, vw: m.vw };
    log(key, `text ${s.textFails}/${s.texts}`, `controls ${s.controlFails}/${s.controls}`, `scroll ${m.scrollW}/${m.vw}`);
    if (s.textFails || s.controlFails) log(formatWorst(key, s));
    return s;
  };
  const keys = page => page.locator('[data-actions] [data-row]').evaluateAll(rs => rs.map(r => r.querySelector('td:nth-child(2), [data-compact]')?.textContent?.trim() || r.textContent.trim().slice(0, 60)));
  const texts = page => page.locator('[data-actions] [data-row]').allInnerTexts();
  const person = (page, label) => page.getByRole('group', { name: 'Filter by person' }).getByRole('button', { name: label });
  const todos = async () => ins(await svc.from('sales_week_goals').select('id, text, owner_user_id, due_date, status').eq('business_id', B).eq('kind', 'todo'));

  // ---- Owner, 1440: opens on Jack; sections; Unassigned; Team.
  const J = await newPage(owner);
  ok('A1: Actions opens on the signed-in person (Who = Jack) - no second Who control in the filter row', (await person(J.page, 'Jack').getAttribute('aria-pressed')) === 'true' && !(await J.page.locator('[data-filter-row]').getByRole('button', { name: 'Mine' }).count()));
  const t0 = await texts(J.page);
  ok('A1: Jack sees only his rows (no Cyrus to-do, no unowned signal / Tidy / waiting rows)', !t0.some(t => /ZZ Draft the one-pager|ZZ Scout Co|Follow up ZZ Lakeshore|signed MSA/.test(t)) && t0.some(t => t.includes('ZZ Call back Lakeshore')), JSON.stringify(t0.map(t => t.split('\n')[1] || t).slice(0, 8)));
  const chip = J.page.locator('[data-unassigned-chip]');
  const chipText = (await chip.innerText()).replace(/\s+/g, ' ');
  ok('A1: Unassigned (n) counts what nobody owns (2 signals + 2 Tidy + 1 waiting = 5)', /Unassigned \(5\)/.test(chipText), chipText);
  const heads = await J.page.locator('[data-actions] .ui-table__toggle').allInnerTexts();
  ok('A2: four sections Now / Today / This week / Housekeeping with counts', ['Now', 'Today', 'This week', 'Housekeeping'].every((b, i) => (heads[i] || '').startsWith(b)), JSON.stringify(heads));
  const hk = J.page.locator('[data-actions] .ui-table__toggle').filter({ hasText: /^Housekeeping/ });
  ok('A2: Housekeeping starts folded', (await hk.getAttribute('aria-expanded')) === 'false' && !t0.some(t => t.includes('ZZ Read the annual report')));
  const box0 = await J.page.evaluate(BOXES);
  await person(J.page, 'Team').click(); await J.page.waitForTimeout(600);
  await hk.click(); await J.page.waitForTimeout(400);
  const fold = await J.page.evaluate(() => localStorage.getItem('prospector_actions_folded'));
  const t1 = await texts(J.page);
  ok('A1/A2: Team shows everything; opening Housekeeping lists the set-a-date + undated to-do and is remembered', t1.some(t => t.includes('ZZ Draft the one-pager')) && t1.some(t => t.includes('Set a date or drop')) && t1.some(t => t.includes('ZZ Read the annual report')) && fold === '[]', JSON.stringify({ fold, n: t1.length }));
  const band = await J.page.locator('[data-actions] [data-row]').evaluateAll(rs => rs.map(r => r.textContent));
  const order = ['signed MSA', 'Follow up ZZ Lakeshore', 'ZZ Scout Co', 'Set a date or drop'].map(k => band.findIndex(t => t.includes(k)));
  ok('A2: band order - the overdue waiting row (Now) before the follow-up (Today) before the Scout signal (This week) before set-a-date (Housekeeping)', order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), JSON.stringify(order));
  // A3: the slots line up - every row's group starts at the same x and its children at the same offsets.
  const slots = await J.page.locator('[data-actions] [data-slots]').evaluateAll(gs => gs.map(g => [...g.children].map(c => Math.round(c.getBoundingClientRect().x))));
  const firstX = slots.map(s => s[0]), secondX = slots.map(s => s[1]), thirdX = slots.map(s => s[2]);
  const spread = a => Math.max(...a) - Math.min(...a);
  ok(`A3: the three slots line up on every row (spread ${spread(firstX)} / ${spread(secondX)} / ${spread(thirdX)} px)`, slots.length >= 8 && slots.every(s => s.length === 3) && spread(firstX) <= 1 && spread(secondX) <= 1 && spread(thirdX) <= 1, JSON.stringify(slots.slice(0, 3)));
  const box1 = await J.page.evaluate(BOXES);
  const mv = maxMove(box0, box1, ['data-workspace-header', 'data-sales-tabrow', 'data-sales-subviews', 'data-sales-frame', 'data-filter-row']);
  ok(`N2 1440: Who, the fold and the chip move nothing above the table (max ${mv} px); filter row 36 px`, mv <= 1 && box1['data-filter-row']?.h === 36, JSON.stringify(box1['data-filter-row']));
  const fit = await J.page.locator('[data-actions] .ui-table-box').evaluate(el => ({ s: el.scrollWidth, c: el.clientWidth }));
  ok(`1440: the Member table fits without a sideways scroll (${fit.s} in ${fit.c})`, fit.s <= fit.c + 1, JSON.stringify(fit));
  await measure(J.page, 'actions-team@1440'); await shot(J.page, 'av2-actions-team-1440');

  // ---- A4: the signal's owner -> Cyrus = accepted as his to-do; Undo takes it back; then for real.
  const sigRow = J.page.locator('[data-actions] [data-row]').filter({ hasText: 'ZZ Scout Co' }).first();
  await sigRow.getByLabel(/^Owner of /).selectOption({ label: 'Cyrus' }); await J.page.waitForTimeout(2000);
  let td = (await todos()).find(t => /ZZ Scout Co/.test(t.text));
  const sig = ins(await svc.from('sales_signals').select('status, decided_by, todo_id').eq('business_id', B).eq('company_name', 'ZZ Scout Co').single());
  ok('A4: owner -> Cyrus on a signal = accepted, the to-do is Cyrus\'s, Jack decided it', td?.owner_user_id === cyrus.id && sig.status === 'accepted' && sig.decided_by === owner.id && sig.todo_id === td.id, JSON.stringify({ td, sig }));
  ok('A4: the toast says "Accepted for Cyrus" with Undo', /Accepted for Cyrus/.test(await J.page.getByRole('status').innerText()));
  await J.page.getByRole('status').getByRole('button', { name: 'Undo' }).click(); await J.page.waitForTimeout(2000);
  ok('A4: Undo puts the signal back (new) and removes Cyrus\'s to-do', !(await todos()).some(t => /ZZ Scout Co/.test(t.text)) && ins(await svc.from('sales_signals').select('status').eq('business_id', B).eq('company_name', 'ZZ Scout Co').single()).status === 'new');
  await J.page.locator('[data-actions] [data-row]').filter({ hasText: 'ZZ Scout Co' }).first().getByLabel(/^Owner of /).selectOption({ label: 'Cyrus' }); await J.page.waitForTimeout(2500);
  td = (await todos()).find(t => /ZZ Scout Co/.test(t.text));
  await J.page.waitForTimeout(1500);
  await person(J.page, 'Jack').click(); await J.page.waitForTimeout(800);
  const tj = await texts(J.page);
  await person(J.page, 'Cyrus').click(); await J.page.waitForTimeout(500);
  const tc = await texts(J.page);
  ok('bar-5: the signal left Jack\'s list and shows as Cyrus\'s to-do', td?.owner_user_id === cyrus.id && !tj.some(t => t.includes('ZZ Scout Co')) && tc.some(t => t.includes('ZZ Scout Co')), JSON.stringify({ jack: tj.map(t => t.split('\n').slice(0, 3).join(' ')), cyrus: tc.map(t => t.split('\n').slice(0, 3).join(' ')) }));
  // Due date -> Friday on Jack's to-do; Undo; then Friday for real.
  await person(J.page, 'Jack').click(); await J.page.waitForTimeout(500);
  const callRow = () => J.page.locator('[data-actions] [data-row]').filter({ hasText: 'ZZ Call back Lakeshore' }).first();
  await callRow().getByLabel(/^Due date for /).selectOption({ label: 'Friday' }); await J.page.waitForTimeout(1500);
  const fri = friday(today);
  ok(`A4: Due ▾ Friday moves the to-do to ${fri}`, (await todos()).find(t => t.text === 'ZZ Call back Lakeshore')?.due_date === fri);
  await J.page.getByRole('status').getByRole('button', { name: 'Undo' }).click(); await J.page.waitForTimeout(1500);
  ok('A4: Undo puts the due date back to today', (await todos()).find(t => t.text === 'ZZ Call back Lakeshore')?.due_date === today);
  // Text edit in the row detail.
  await callRow().locator('.ui-table__disclose').click(); await J.page.waitForTimeout(400);
  await J.page.getByRole('button', { name: 'Change the text: ZZ Call back Lakeshore' }).click();
  await J.page.getByLabel('Edit ZZ Call back Lakeshore').fill('ZZ Call back Lakeshore about the pilot');
  await J.page.getByLabel('Edit ZZ Call back Lakeshore').press('Enter'); await J.page.waitForTimeout(1800);
  ok('A4: the text edits in place (Enter saves)', (await todos()).some(t => t.text === 'ZZ Call back Lakeshore about the pilot'));
  await J.page.getByRole('status').getByRole('button', { name: 'Undo' }).click(); await J.page.waitForTimeout(1800);
  ok('A4: Undo restores the text', (await todos()).some(t => t.text === 'ZZ Call back Lakeshore'));
  // A to-do's owner select lists members only (no Viewer).
  const opts = await callRow().getByLabel(/^Owner of /).locator('option').allTextContents();
  ok('A4: the owner choices are Unassigned + the Members (no Viewer)', JSON.stringify(opts) === JSON.stringify(['Unassigned', 'Jack', 'Cyrus']), JSON.stringify(opts));
  await measure(J.page, 'actions-jack@1440'); await shot(J.page, 'av2-actions-jack-1440');

  // ---- 390: Primary + More ▾.
  const P = await newPage(owner, { width: 390, height: 844 });
  await person(P.page, 'Team').dispatchEvent('click'); await P.page.waitForTimeout(900);
  const card = P.page.locator('[data-actions] [data-row]').filter({ hasText: 'Follow up ZZ Lakeshore' }).first();
  const cardBtns = await card.locator('[data-slots]').getByRole('button').allTextContents();
  const cardMore = await card.locator('[data-slots] select').locator('option').allTextContents();
  ok('390: a card carries Primary + More ▾ (Done folds into More)', JSON.stringify(cardBtns) === JSON.stringify(['Accept']) && cardMore.includes('Done') && cardMore.includes('Dismiss for 7 days'), JSON.stringify({ cardBtns, cardMore }));
  await measure(P.page, 'actions@390'); await shot(P.page, 'av2-actions-390');
  ok('390: no sideways page scroll', results.screens['actions@390'].scrollW <= results.screens['actions@390'].vw + 1);

  // ---- Viewer: Team, read-only.
  const V = await newPage(viewer);
  const vTeam = await person(V.page, 'Team').getAttribute('aria-pressed');
  ok('Viewer: opens on Team; no slots, no owner / due selects, no edit', vTeam === 'true' && !(await V.page.locator('[data-actions] [data-slots]').count()) && !(await V.page.locator('[data-actions] [data-row] select').count()), JSON.stringify({ vTeam, slots: await V.page.locator('[data-actions] [data-slots]').count(), selects: await V.page.locator('[data-actions] [data-row] select').count() }));
  await V.page.locator('[data-actions] [data-row] .ui-table__disclose').first().click(); await V.page.waitForTimeout(300);
  ok('Viewer: the row detail is read-only (no Change the text)', !(await V.page.getByRole('button', { name: /^Change the text/ }).count()));
  await measure(V.page, 'viewer@1440'); await shot(V.page, 'av2-viewer-1440');

  const fails = Object.entries(results.screens).filter(([, s]) => s.textFails || s.controlFails);
  ok(`ui-clarity measure: 0 failures on ${Object.keys(results.screens).length} screens`, !fails.length, JSON.stringify(fails.map(([k, s]) => [k, s.textFails, s.controlFails])));
  const errs = [...J.errs, ...P.errs, ...V.errs];
  ok('No page errors', !errs.length, JSON.stringify(errs.slice(0, 5)));
  const runsAfter = {}; for (const t of RUNS) runsAfter[t] = await count(t, 'business_id', B);
  ok('Real-call guard: 0 research / pull / sync / tidy runs', JSON.stringify(runsBefore) === JSON.stringify(runsAfter), `blocked ${blocked.length} browser calls`);
  results.calls = { claude: 0, apollo: 0, graph: 0, blocked: blocked.length };
} catch (e) {
  results.errors.push(e.stack || e.message);
  log('ERROR', e.message);
} finally {
  await cleanup();
  const hlAfter = await hlCounts();
  const restored = JSON.stringify(hlBefore) === JSON.stringify(hlAfter) && !(await count('businesses', 'id', B)) && !(await count('sales_week_goals', 'business_id', B));
  results.restored = restored;
  const pass = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'actions-v2-stage2.json'), JSON.stringify(results, null, 2));
  console.log(`\n${pass}/${results.checks.length} checks passed${results.errors.length ? ` · ${results.errors.length} errors` : ''}`);
  for (const e of results.errors) console.log('ERROR:', e.split('\n').slice(0, 3).join(' | '));
  console.log(`restored: ${restored ? 'yes' : `NO - HomeLover ${JSON.stringify(hlBefore)} -> ${JSON.stringify(hlAfter)}`}`);
  process.exit(0);
}
