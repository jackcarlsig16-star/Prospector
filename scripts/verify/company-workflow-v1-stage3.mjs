// company-workflow-v1 Stage 3 - the guided steps, one Add to pipeline, owner people, employees / reach, live in a temp
// workspace. Bar-5 path: a website visitor -> only "Research — adds it as a target" glows -> run it (the ONE real
// research call) -> Size & type -> Owner (Cyrus) -> Add to pipeline (Promote) -> employer; Pipeline sorts by Employees;
// a PEO partner shows Reach and Clients as separate numbers; Owner pickers on the create dialogs; a Viewer pass;
// 1440 + 390 contrast (ui-clarity measure, window-scoped for the company window) and N2.
// SCOPE (declared): TEMP data only - 1 goals_sales workspace (added to SALES_ANALYTICS_BUSINESS_IDS for the local server
// only), 3 temp users (Jack Test owner, Cyrus Temp member, Viewer Test viewer); seeds 1 web visit (a real public company
// name so research has something to read), 1 PEO partner, 1 employer. Writes: 1 target -> 1 employer (promote), a few
// field edits. EXACTLY ONE real Claude call: the visitor's Research (MODELS.STANDARD, <= 3 web searches, ~$0.08) - its
// cost is read back from research_runs and printed; any further research request is aborted in the browser. 0 Apollo
// (sync / apollo / visit pull / tidy aborted). HomeLover never written (counts compared). Runtime ~3-4 min, hard cap
// 400 s (tempGuard). Shots + report: .screenshots/company-workflow-v1/. Run npm run build first.
// Usage: node scripts/verify/company-workflow-v1-stage3.mjs [outdir] [--skip-research]
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
const OUT = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(ROOT, '.screenshots', 'company-workflow-v1');
const SKIP_RESEARCH = process.argv.includes('--skip-research');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3987;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const NAME = 'ZZ Company Workflow S3';
const VISITOR = 'Gusto';
const HL = ['sales_goals', 'sales_opportunities', 'sales_targets', 'research_runs'];
const RUNS = ['visit_pull_runs', 'sales_sync_runs', 'sales_tidy_runs'];
const TEMP_TABLES = ['sales_source_events', 'sales_partner_events', 'partner_domains', 'sales_week_goals', 'research_runs', 'business_anthropic_usage', 'sales_signals', 'web_visits', ...RUNS, 'sales_targets', 'sales_opportunities', 'sales_goals', 'auth_events', 'business_members'];
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
    for (const t of TEMP_TABLES) { const r = await svc.from(t).delete().eq('business_id', B); if (r.error && !/does not exist/.test(r.error.message)) console.log(`cleanup ${t}: ${r.error.message}`); }
    await svc.from('businesses').delete().eq('id', B);
  }
  for (const u of users) {
    await svc.from('auth_events').delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('actor_id', u.id);
    await svc.from('microsoft_sync_runs').delete().eq('user_id', u.id);
    await svc.auth.admin.deleteUser(u.id);
  }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 400000 });
const laToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
fs.mkdirSync(OUT, { recursive: true });
const hlBefore = await hlCounts();
log('HomeLover before', JSON.stringify(hlBefore));
const results = { screens: {}, checks: [], errors: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${detail}` : ''); };
const SCREEN = measureScript({ scope: '#sales-analytics-root' });
const WINDOW = measureScript({ scope: 'aside[data-center-window]' });
const BOXES = `(() => Object.fromEntries(['data-workspace-header', 'data-sales-tabrow', 'data-sales-subviews', 'data-sales-frame', 'data-filter-row'].map(a => {
  const el = document.querySelector('[' + a + ']'); if (!el) return [a, null];
  const r = el.getBoundingClientRect(); return [a, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }];
})))()`;
const maxMove = (a, b, keys) => Math.max(...keys.map(k => (a[k] && b[k] ? Math.max(Math.abs(a[k].x - b[k].x), Math.abs(a[k].y - b[k].y), Math.abs(a[k].h - b[k].h)) : 0)));

try {
  const tag = 'cw3-' + Date.now();
  B = ins(await svc.from('businesses').insert({ name: NAME, website_url: 'https://cw3.example.com', color: '#6F8CF0', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
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
  ins(await svc.from('web_visits').insert({ business_id: B, pulled_on: today, company_key: 'gusto', company_name: VISITOR, domain: 'gusto.com', priority: 'P2', priority_rule: 'test', visits_7d: 4, last_visit: today, us_500: true, top_paths: ['/employer-partners'] }).select('id'));
  const peo = ins(await svc.from('sales_goals').insert({ business_id: B, goal_type: 'partnership', name: 'ZZ Payroll PEO', category: '3. PEOs', pipeline_status: 'replied', channel: 'manual', owner_user_id: owner.id, last_touch_at: new Date().toISOString() }).select('id').single());
  ins(await svc.from('sales_opportunities').insert({ business_id: B, organization: 'ZZ Elm Health', org_type: 'employer', stage: 'contacted', source: 'manual', channel: 'manual', employees: 800, employees_source: 'manual', employees_at: new Date().toISOString() }).select('id'));
  const runsBefore = {}; for (const t of RUNS) runsBefore[t] = await count(t, 'business_id', B);
  log('fixture in');

  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  const blocked = [];
  let researchPosts = 0;
  async function newPage(u, { width = 1440, height = 900 } = {}) {
    const errs = [];
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', e => errs.push(`PAGE ${u.name}@${width}: ${e.message.slice(0, 160)}`));
    page.on('requestfailed', r => { if (!blocked.includes(r.url())) results.errors.push(`request failed ${u.name}@${width}: ${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')} ${r.failure()?.errorText}`); });
    await page.addInitScript(([k, v, b, dd]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      localStorage.setItem(`prospector_visits_ran_${b}`, dd); localStorage.setItem(`prospector_tidy_ran_${b}`, dd); localStorage.setItem(`prospector_apollo_sync_ran_${b}`, dd);
      localStorage.setItem('prospector_goals_owner', 'team');
    }, [`sb-${REF}-auth-token`, JSON.stringify(u.session), B, today]);
    // Real-call guard: ONE research POST is let through (declared), every other one aborts; no Apollo / pulls / Graph.
    await page.route(/\/research$/, route => {
      if (route.request().method() !== 'POST') return route.continue();
      if (!SKIP_RESEARCH && researchPosts === 0) { researchPosts++; return route.continue(); }
      blocked.push(route.request().url()); return route.abort();
    });
    await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)|\/apollo-check|\/goals\/visits\/pull|\/goals\/tidy\/run|\/proxy\/anthropic|\/api\/microsoft\//, route => { blocked.push(route.request().url()); route.abort(); });
    await page.goto(`http://localhost:${PORT}/`);
    await page.locator('#main-content').getByText(NAME).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').selectOption({ label: NAME }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: /^Pipeline/ }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
    await page.locator('[data-sales-subviews]').getByRole('button', { name: 'Companies', exact: true }).dispatchEvent('click'); await page.waitForTimeout(1500);
    await page.locator('[data-row]').first().waitFor({ timeout: 20000 });
    return { page, errs };
  }
  const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide', fullPage: true });
  const measure = async (page, key, scope = SCREEN) => {
    const m = await page.evaluate(scope);
    if (m.error) { results.errors.push(`${key}: ${m.error}`); return null; }
    const s = summarize(m); results.screens[key] = { ...s, scrollW: m.scrollW, vw: m.vw };
    log(key, `text ${s.textFails}/${s.texts}`, `controls ${s.controlFails}/${s.controls}`, `scroll ${m.scrollW}/${m.vw}`);
    if (s.textFails || s.controlFails) log(formatWorst(key, s));
    return s;
  };
  const win = page => page.locator('aside[data-center-window]');
  const openRow = async (page, name) => { await page.getByRole('button', { name, exact: true }).first().click(); await win(page).locator('[data-panel-body]').waitFor({ timeout: 20000 }); await page.waitForTimeout(800); };
  const CH = { 'Website visitors': 'website', Targets: 'targets', All: 'all' };
  const channel = async (page, label) => { await page.locator(`[data-channel-row] [data-channel="${CH[label]}"]`).click(); await page.waitForTimeout(800); };
  const glow = page => win(page).locator('[data-steps] .ui-btn--primary');
  const db = async (t, f) => ins(await f(svc.from(t).select('*').eq('business_id', B)));

  // ---- Owner, 1440: the visitor.
  const J = await newPage(owner);
  const box0 = await J.page.evaluate(BOXES);
  await channel(J.page, 'Website visitors');
  await openRow(J.page, VISITOR);
  ok('W1: a visitor - exactly one glowing step, "1 Research — adds it as a target"', (await glow(J.page).count()) === 1 && /^1 Research — adds it as a target$/.test((await glow(J.page).innerText()).trim()), await glow(J.page).innerText().catch(() => ''));
  ok('W2: exactly one Add to pipeline in the window; the Interest band has none', (await win(J.page).getByRole('button', { name: /^Add to pipeline/ }).count()) === 1 && (await win(J.page).locator('[data-interest-band] button').count()) === 0);
  await measure(J.page, 'visitor-window@1440', WINDOW); await shot(J.page, 'cw3-visitor-1440');
  await glow(J.page).click(); await J.page.waitForTimeout(2500);
  const target = (await db('sales_targets', q => q.eq('name', VISITOR)))[0];
  ok('Research on a visitor: a target is made (owner = me), research started on it, the window switches to the target', !!target && target.owner_user_id === owner.id && (await win(J.page).locator('[data-company-panel="target"]').count()) === 1, JSON.stringify(target && { status: target.status, owner: target.owner_user_id === owner.id }));
  let run = null;
  if (!SKIP_RESEARCH) {
    for (let i = 0; i < 50 && !(run && run.status !== 'running'); i++) { await J.page.waitForTimeout(3000); run = (await db('research_runs', q => q.eq('entity_id', target.id).order('created_at', { ascending: false }).limit(1)))[0]; }
    results.research = run && { status: run.status, cost_usd: run.cost_usd, web_searches: run.result?.web_searches, employees_count: run.result?.employees_count ?? null, size: run.result?.size || null, error: run.error || null };
    ok(`the ONE real research call finished (${run?.status}, $${run?.cost_usd}); employees_count ${run?.result?.employees_count ?? 'not stated'}`, run?.status === 'done', JSON.stringify(results.research));
    const t2 = (await db('sales_targets', q => q.eq('id', target.id)))[0];
    ok('research filled the target\'s employees (source research) when it found a number', run?.result?.employees_count == null ? t2.employees == null : t2.employees === run.result.employees_count && t2.employees_source === 'research', JSON.stringify({ employees: t2.employees, source: t2.employees_source }));
  } else {
    // Dry run: a fixture run stands in for the real one so the later steps can be exercised (0 Claude).
    ins(await svc.from('research_runs').insert({ business_id: B, entity_type: 'target', entity_id: target.id, trigger: 'manual', status: 'done', model: 'fixture', result: { size: 'fixture' }, created_by: owner.id }).select('id'));
    ok('Research skipped (--skip-research): a fixture run stands in', true);
  }
  // Re-open the target fresh (out and back in).
  await J.page.keyboard.press('Escape'); await J.page.waitForTimeout(600);
  await J.page.locator('[data-sales-subviews]').getByRole('button', { name: 'People', exact: true }).dispatchEvent('click'); await J.page.waitForTimeout(800);
  await J.page.locator('[data-sales-subviews]').getByRole('button', { name: 'Companies', exact: true }).dispatchEvent('click'); await J.page.waitForTimeout(1500);
  await channel(J.page, 'Targets');
  await openRow(J.page, VISITOR);
  const next1 = (await glow(J.page).innerText().catch(() => '')).trim();
  ok('after research: one glowing step and it is Size & type (or Owner when research gave the number)', (await glow(J.page).count()) === 1 && /Size & type|Owner/.test(next1), next1);
  if (/Size & type/.test(next1)) {
    await glow(J.page).click();
    await win(J.page).getByRole('group', { name: 'Size & type' }).getByLabel('Employees', { exact: true }).fill('1,200');
    await win(J.page).getByRole('group', { name: 'Size & type' }).getByRole('button', { name: 'Save' }).click(); await J.page.waitForTimeout(2000);
    ok('Size & type: typed 1,200 saved as manual', (await db('sales_targets', q => q.eq('id', target.id)))[0].employees_source === 'manual');
  }
  // The target was made with me as owner (the default), so Owner is ✓ Jack - clickable to hand it to Cyrus.
  ok('Owner step reads ✓ (me, the default) and stays clickable', /✓ \d Owner/.test(await win(J.page).locator('[data-steps] button[data-step="owner"]').innerText()));
  await win(J.page).locator('[data-steps] button[data-step="owner"]').click(); await J.page.waitForTimeout(400);
  await win(J.page).getByRole('group', { name: 'Owner' }).getByRole('button', { name: 'Cyrus' }).click(); await J.page.waitForTimeout(2000);
  ok('Owner: Cyrus picked -> the target\'s owner person (fields route)', (await db('sales_targets', q => q.eq('id', target.id)))[0].owner_user_id === cyrus.id);
  const next3 = (await glow(J.page).innerText().catch(() => '')).trim();
  ok('Add to pipeline glows (Promote for a target)', /Add to pipeline/.test(next3), next3);
  await glow(J.page).click(); await J.page.waitForTimeout(400);
  const promote = win(J.page).getByRole('group', { name: 'Promote to' });
  ok('Promote shows the Owner picker (the target\'s owner, Cyrus)', (await promote.getByLabel('Owner').inputValue()) === cyrus.id);
  await measure(J.page, 'target-window@1440', WINDOW); await shot(J.page, 'cw3-target-1440');
  await promote.getByRole('button', { name: 'Promote to employer' }).click(); await J.page.waitForTimeout(3000);
  const emp = (await db('sales_opportunities', q => q.eq('organization', VISITOR)))[0];
  ok('bar-5: Promote -> employer owned by Cyrus (owner text in step), employees carried', emp?.owner_user_id === cyrus.id && emp.owner === 'Cyrus' && emp.employees != null, JSON.stringify(emp && { owner: emp.owner, employees: emp.employees, source: emp.employees_source }));
  await J.page.keyboard.press('Escape'); await J.page.waitForTimeout(600);
  await channel(J.page, 'All');

  // ---- PEO partner: reach via Size & type; Pipeline Reach / Clients; sort by Employees.
  await openRow(J.page, 'ZZ Payroll PEO');
  const sizeBtn = win(J.page).locator('[data-steps] button').filter({ hasText: 'Size & type' });
  await sizeBtn.click(); await J.page.waitForTimeout(300);
  const g = win(J.page).getByRole('group', { name: 'Size & type' });
  await g.getByLabel('Employees', { exact: true }).fill('300'); await g.getByLabel('Covers (employees)', { exact: true }).fill('45000'); await g.getByLabel('Clients', { exact: true }).fill('410');
  await g.getByRole('button', { name: 'Save' }).click(); await J.page.waitForTimeout(2000);
  const peoRow = (await db('sales_goals', q => q.eq('id', peo.id)))[0];
  ok('PEO Size & type: employees 300, reach 45,000 + 410 clients - separate fields, all typed', peoRow.employees === 300 && peoRow.reach_employees === 45000 && peoRow.reach_clients === 410 && peoRow.reach_employees_source === 'manual');
  const facts = await win(J.page).locator('[data-facts-row]').innerText();
  ok('facts row: Employees 300 · Typed and Reach "covers 45,000 · 410 clients"', /300/.test(facts) && /covers 45,000 · 410 clients/.test(facts), facts.replace(/\s+/g, ' '));
  await J.page.keyboard.press('Escape'); await J.page.waitForTimeout(1500);
  const cell = name => J.page.locator('[data-row]').filter({ hasText: name }).first();
  const peoText = await cell('ZZ Payroll PEO').innerText();
  ok('Pipeline: the PEO row shows Reach 45,000 and Clients 410 as separate columns', /45,000/.test(peoText) && /410/.test(peoText), peoText.replace(/\s+/g, ' ').slice(0, 200));
  await J.page.getByRole('button', { name: /^Employees/ }).first().click(); await J.page.waitForTimeout(500);
  const sorted = await J.page.locator('[data-row]').evaluateAll(rs => rs.map(r => r.textContent));
  ok('Pipeline sorts by Employees (asc: 300 before 800)', sorted.findIndex(t => t.includes('ZZ Payroll PEO')) < sorted.findIndex(t => t.includes('ZZ Elm Health')));
  ok('Owner column shows the person (Cyrus) on the promoted employer', /Cyrus/.test(await cell(VISITOR).innerText()));
  const box1 = await J.page.evaluate(BOXES);
  const mv = maxMove(box0, box1, ['data-workspace-header', 'data-sales-tabrow', 'data-sales-subviews', 'data-sales-frame', 'data-filter-row']);
  ok(`N2 1440: nothing above the table moved (max ${mv} px)`, mv <= 1);
  await measure(J.page, 'pipeline@1440'); await shot(J.page, 'cw3-pipeline-1440');
  // Create dialogs carry an Owner picker.
  await J.page.getByRole('button', { name: '+ Add employer' }).click(); await J.page.waitForTimeout(600);
  ok('+ Add employer has the Owner picker', (await J.page.getByLabel('Owner').count()) >= 1);
  await J.page.keyboard.press('Escape'); await J.page.waitForTimeout(300);

  // ---- 390 + Viewer.
  const P = await newPage(owner, { width: 390, height: 844 });
  await P.page.getByText('ZZ Payroll PEO').first().click(); await win(P.page).locator('[data-panel-body]').waitFor(); await P.page.waitForTimeout(800);
  await measure(P.page, 'partner-window@390', WINDOW); await shot(P.page, 'cw3-window-390');
  ok('390: no sideways scroll in the window', results.screens['partner-window@390'].scrollW <= results.screens['partner-window@390'].vw + 1);
  const V = await newPage(viewer);
  await openRow(V.page, 'ZZ Payroll PEO');
  ok('Viewer: the strip / Ready shows, no step buttons, no Edit row', !(await win(V.page).locator('[data-steps] button').count()) && !(await win(V.page).locator('[data-edit-row]').count()));
  await measure(V.page, 'viewer-window@1440', WINDOW);

  const fails = Object.entries(results.screens).filter(([, s]) => s.textFails || s.controlFails);
  ok(`ui-clarity measure: 0 failures on ${Object.keys(results.screens).length} screens`, !fails.length, JSON.stringify(fails.map(([k, s]) => [k, s.textFails, s.controlFails])));
  const errs = [...J.errs, ...P.errs, ...V.errs];
  ok('No page errors', !errs.length, JSON.stringify(errs.slice(0, 5)));
  const runsAfter = {}; for (const t of RUNS) runsAfter[t] = await count(t, 'business_id', B);
  const researchRuns = (await svc.from('research_runs').select('id', { count: 'exact', head: true }).eq('business_id', B).neq('model', 'fixture')).count;
  ok(`Real-call guard: ${SKIP_RESEARCH ? 0 : 1} research run(s) total, 0 sync / pull / tidy runs`, researchRuns === (SKIP_RESEARCH ? 0 : 1) && JSON.stringify(runsBefore) === JSON.stringify(runsAfter), `blocked ${blocked.length}`);
  results.calls = { claude: researchRuns, cost_usd: results.research?.cost_usd ?? 0, apollo: 0, blocked: blocked.length };
} catch (e) {
  results.errors.push(e.stack || e.message);
  log('ERROR', e.message);
} finally {
  await cleanup();
  const hlAfter = await hlCounts();
  const restored = JSON.stringify(hlBefore) === JSON.stringify(hlAfter) && !(await count('businesses', 'id', B)) && !(await count('sales_goals', 'business_id', B));
  results.restored = restored;
  const pass = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'company-workflow-v1-stage3.json'), JSON.stringify(results, null, 2));
  console.log(`\n${pass}/${results.checks.length} checks passed${results.errors.length ? ` · ${results.errors.length} errors` : ''} · Claude ${results.calls?.claude ?? '?'} ($${results.calls?.cost_usd ?? '?'})`);
  for (const e of results.errors) console.log('ERROR:', e.split('\n').slice(0, 3).join(' | '));
  console.log(`restored: ${restored ? 'yes' : `NO - HomeLover ${JSON.stringify(hlBefore)} -> ${JSON.stringify(hlAfter)}`}`);
  process.exit(0);
}
