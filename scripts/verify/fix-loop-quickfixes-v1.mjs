// FIX loop-quickfixes-v1 REV2 - one live pass over the parts a browser or the real DB can show:
//   Q1 Accept a Scout signal matched to an employer -> its to-do links to the employer; Done it -> the employer's
//      Last touch is today (done). Q2 the employer copy bundle lists that to-do + a waiting-on row, no "@".
//   Q3 a website-visitor row's Interest band offers Add to pipeline ▾ only. Q4 on the REAL trigger: owner / priority /
//      notes edits write no event and leave Last touch alone; a stage change moves it. Q5 page-load Tidy leaves one
//      run row, ok + finished (status 'running' accepted by the live check). Q8 Tasks drawer › Targets: "more" opens
//      the whole evidence line, Esc closes it and leaves the drawer open.
// SCOPE (declared): TEMP data only - 1 workspace (goals_sales on, added to SALES_ANALYTICS_BUSINESS_IDS for the local
// server only) + 1 temp owner; ~12 rows (2 employers, 1 Scout signal, 1 web-visit signal, 2 web visits, 1 waiting,
// 1 target). Made-up names; no emails or phones. HomeLover never written (counts compared before/after). 0 Apollo and
// 0 Claude: sync / apollo / visit-pull / research / anthropic routes are aborted in the browser (Tidy is allowed - it
// makes no outside call) and research_runs, visit_pull_runs, apollo_credit_spend, sales_sync_runs are counted before
// teardown. 1440 only. Runtime ~1.5 min, hard cap 200 s (tempGuard). Shots + report: .screenshots/fix-loop-quickfixes-v1.
// Usage: node scripts/verify/fix-loop-quickfixes-v1.mjs [outdir]   (run npm run build first)
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const OUT = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(ROOT, '.screenshots', 'fix-loop-quickfixes-v1');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3986;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const NAME = 'ZZ Loop Quickfixes FIX';
const HL = ['sales_week_goals', 'sales_signals', 'sales_suggestions', 'sales_opportunities', 'sales_opportunity_events', 'sales_tidy_runs', 'sales_targets', 'web_visits'];
const TEMP_TABLES = ['sales_week_goal_steps', 'sales_week_goals', 'sales_signals', 'sales_suggestions', 'sales_tidy_runs', 'web_visits', 'visit_pull_runs', 'research_runs', 'apollo_credit_spend', 'sales_sync_runs', 'sales_partner_events', 'sales_opportunity_events', 'sales_targets', 'sales_opportunities', 'sales_goals', 'auth_events', 'business_members'];
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const count = async (t, col, v) => (await svc.from(t).select('*', { count: 'exact', head: true }).eq(col, v)).count;
const hlCounts = async () => { const o = {}; for (const t of HL) o[t] = await count(t, 'business_id', HOMELOVER); return o; };
let srv, browser, B, users = [];
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  if (B) { for (const t of TEMP_TABLES) { const r = await svc.from(t).delete().eq('business_id', B); if (r.error) console.log(`cleanup ${t}: ${r.error.message}`); } await svc.from('businesses').delete().eq('id', B); }
  for (const u of users) { await svc.from('auth_events').delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('actor_id', u.id); await svc.auth.admin.deleteUser(u.id); }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 200000 });
const laToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const monday = d => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));
fs.mkdirSync(OUT, { recursive: true });
const hlBefore = await hlCounts();
const results = { checks: [], errors: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${detail}` : ''); };
const LONG_EVIDENCE = 'renter-investing platforms are worth approaching because their users move every eighteen months on average and ask about housing perks';

try {
  const tag = 'fixlq-' + Date.now();
  B = ins(await svc.from('businesses').insert({ name: NAME, website_url: 'https://fixlq.example.com', color: '#6F8CF0', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
  const email = `${tag}-jack-test@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
  const { data: u, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(error.message);
  users.push({ id: u.user.id });
  await svc.from('profiles').update({ display_name: 'Jack Test', welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
  ins(await svc.from('business_members').insert({ business_id: B, email, name: 'Jack Test', user_id: u.user.id, role: 'owner' }).select());
  const anon = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: s, error: sErr } = await anon.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(sErr.message);
  const owner = { id: u.user.id, session: s.session };
  const today = laToday(), week = monday(today);
  const [o1, o2] = ins(await svc.from('sales_opportunities').insert([
    { business_id: B, organization: 'ZZ Old Mill Union', org_type: 'employer', stage: 'contacted', source: 'manual', channel: 'call_note', owner: 'Jack Test', priority: 2 },
    { business_id: B, organization: 'ZZ Quarry Foods', org_type: 'employer', stage: 'target', source: 'manual', channel: 'manual', owner: 'Jack Test', priority: 3 },
  ]).select('id, organization'));
  const [sig] = ins(await svc.from('sales_signals').insert([
    { business_id: B, source: 'scout', signal_week: week, company_name: 'ZZ Old Mill Union', company_key: 'zz old mill union', kind: 'employer', kind_guessed: false, signal: 'Benefits RFP', why_now: 'Renewal in Q1', score: 62, status: 'new', match: { type: 'opportunity', id: o1.id, name: o1.organization }, created_by: owner.id },
    { business_id: B, source: 'web_visit', signal_week: week, company_name: 'ZZ Acme Visitors', company_key: 'zz acme visitors', kind: 'employer', kind_guessed: true, signal: '6 visits in 7 days', why_now: 'P2 Follow up: 6 visits', status: 'new', created_by: owner.id },
  ]).select('id'));
  const visit = d => ({ business_id: B, pulled_on: d, company_key: 'zz acme visitors', company_name: 'ZZ Acme Visitors', priority: 'P2', priority_rule: 'test', visits_7d: 6, last_visit: d, us_500: true, top_paths: ['/pricing'] });
  ins(await svc.from('web_visits').insert([visit(today), visit(addDays(today, -1))]).select('id'));
  ins(await svc.from('sales_week_goals').insert({ business_id: B, week_start: week, kind: 'waiting', status: 'open', text: 'ZZ the eligibility file', waiting_on: 'Pat', due_date: addDays(today, 3), link_type: 'opportunity', link_id: o1.id, created_by: owner.id, contacts: [], sort_order: 0 }).select('id'));
  ins(await svc.from('sales_targets').insert({ business_id: B, name: 'ZZ Fundrise Homes', kind: 'partner', status: 'researching', evidence: LONG_EVIDENCE, channel: 'call_note', created_by: owner.id }).select('id'));
  log('fixture in');

  // Q4 on the real trigger: owner / priority / notes edits on o2 -> no event; Last touch read stays null.
  ins(await svc.from('sales_opportunities').update({ owner: 'Cyrus Test', priority: 1, notes: 'ZZ edited note' }).eq('id', o2.id).select('id'));
  const evAfterEdits = ins(await svc.from('sales_opportunity_events').select('event_type').eq('opportunity_id', o2.id));

  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  const blocked = [];
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
  page.on('dialog', d => d.accept());
  // Visits marked pulled today (no Apollo); Tidy left to run on page load (Q5's path).
  await page.addInitScript(([k, v, b, dd]) => {
    if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
    localStorage.setItem(`prospector_visits_ran_${b}`, dd);
  }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), B, today]);
  await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)|\/goals\/visits\/pull|\/research\/run|\/research$|\/apollo-check|\/proxy\/anthropic/, route => { blocked.push(route.request().url()); route.abort(); });
  await page.goto(`http://localhost:${PORT}/?tab=actions`);
  await page.locator('#main-content').getByText(NAME).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  await page.getByLabel('Workspace').selectOption({ label: NAME }); await page.waitForTimeout(1200);
  await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
  const api = (p, opts) => page.evaluate(async ([b, p, o]) => { const r = await fetch(`/api/sales/${b}/goals${p}`, o ? { method: o.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o.body || {}) } : undefined); return { status: r.status, body: await r.json().catch(() => ({})) }; }, [B, p, opts || null]);
  const tab = async label => { await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: new RegExp(`^${label}`) }).first().dispatchEvent('click'); await page.waitForTimeout(1200); };
  const shot = n => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide' });

  // Q5: page-load Tidy ran (no Claude / Apollo) -> one run row, ok + finished.
  await page.waitForTimeout(2500);
  const runs = ins(await svc.from('sales_tidy_runs').select('status, finished_at, trigger').eq('business_id', B));
  ok('Q5 page-load Tidy: one run row, ok and finished (written running first, closed after)', runs.length === 1 && runs[0].status === 'ok' && !!runs[0].finished_at && runs[0].trigger === 'pageload', JSON.stringify(runs));

  // Q4 reads (real trigger).
  const lt = async id => (await api(`/company?type=employer&id=${id}`)).body.record?.last_touch ?? null;
  ok('Q4 real trigger: owner + priority + notes edits write no event and leave Last touch empty', evAfterEdits.map(e => e.event_type).join() === 'created' && (await lt(o2.id)) === null, JSON.stringify({ events: evAfterEdits.map(e => e.event_type), last_touch: await lt(o2.id) }));
  ins(await svc.from('sales_opportunities').update({ stage: 'contacted' }).eq('id', o2.id).select('id'));
  const lt2 = await lt(o2.id);
  ok('Q4 real trigger: a stage change moves Last touch (stage, today)', lt2?.touch_type === 'stage' && new Date(lt2.at).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }) === today, JSON.stringify(lt2));

  // Q1: Accept the employer-matched Scout signal on Actions.
  await tab('Actions');
  await page.getByRole('button', { name: 'Team', exact: true }).click().catch(() => {});
  const sigRow = page.locator(`[data-actions] [data-row][data-key="signal-${sig.id}"]`);
  await sigRow.waitFor({ timeout: 20000 });
  await sigRow.getByRole('button', { name: 'Accept', exact: true }).click(); await page.waitForTimeout(2000);
  const todo = ins(await svc.from('sales_week_goals').select('id, link_type, link_id, status, text').eq('business_id', B).eq('kind', 'todo').eq('category', 'Signals').maybeSingle());
  ok('Q1 Accept on an employer match: the to-do links to the employer', todo?.link_type === 'opportunity' && todo.link_id === o1.id, JSON.stringify(todo && { link_type: todo.link_type, linked_to_o1: todo.link_id === o1.id }));

  // Q2: the employer bundle has the to-do and the waiting-on row.
  const bundle = (await api(`/copy-bundle?type=employer&id=${o1.id}`)).body.markdown || '';
  ok('Q2 employer copy bundle: Waiting on them + Open to-dos filled, no "@"', /## Waiting on them\n- Pat · ZZ the eligibility file · due /.test(bundle) && bundle.includes(`## Open to-dos\n- ${todo?.text}`) && !bundle.includes('@') && !bundle.includes('cannot link'), bundle.split('\n').filter(l => /^## (Waiting|Open)|^- (Pat|Reach)/.test(l)).join(' | '));

  // Q1 cont.: Done the to-do on Actions -> employer Last touch today (done).
  const todoRow = page.locator(`[data-actions] [data-row][data-key="todo-${todo?.id}"]`);
  await todoRow.waitFor({ timeout: 15000 });
  await todoRow.getByRole('button', { name: 'Done', exact: true }).click(); await page.waitForTimeout(2000);
  const lt1 = await lt(o1.id);
  ok('Q1 Done on that to-do: the employer\'s Last touch is today (done)', lt1?.touch_type === 'done' && new Date(lt1.at).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }) === today, JSON.stringify(lt1));

  // Q3: the website-visitor row's window - band shows the visits + Add to pipeline ▾ only.
  const visRow = page.locator('[data-actions] [data-row]').filter({ hasText: 'ZZ Acme Visitors' }).first();
  await visRow.getByRole('button', { name: 'ZZ Acme Visitors', exact: true }).click(); await page.waitForTimeout(3000);
  const band = await page.evaluate(() => { const b = document.querySelector('[data-interest-band]'); return b && { text: b.textContent, buttons: [...b.querySelectorAll('button')].map(x => x.textContent) }; });
  await shot('fixlq-visitor-band-1440');
  ok('Q3 visitor row: the band shows the visits and only Add to pipeline ▾', !!band && /visit/i.test(band.text) && JSON.stringify(band.buttons) === JSON.stringify(['Add to pipeline ▾']), JSON.stringify(band));
  if (band) {
    await page.locator('[data-interest-band]').getByRole('button', { name: 'Add to pipeline ▾' }).click(); await page.waitForTimeout(400);
    ok('Q3 the band button opens the Add to pipeline choices (Target / Partner / Employer)', await page.getByRole('group', { name: 'Add to pipeline as' }).isVisible());
    await page.getByRole('button', { name: 'Draft email in Claude' }).click(); await page.waitForTimeout(400);
    ok('Q3 Draft email on the visitor row asks employer or partner first (nothing created yet)', await page.getByRole('group', { name: 'Add ZZ Acme Visitors as a target first' }).isVisible() && (await count('sales_targets', 'business_id', B)) === 1);
  }
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);

  // Q8: Tasks drawer › Targets - more / Esc.
  await page.getByRole('button', { name: /^Open tasks/ }).click(); await page.locator('aside[aria-labelledby="task-drawer-title"]').waitFor();
  await page.locator('aside[aria-labelledby="task-drawer-title"]').getByRole('button', { name: /Targets/ }).click(); await page.waitForTimeout(800);
  const more = page.locator('aside[aria-labelledby="task-drawer-title"]').getByRole('button', { name: 'more' });
  const hasMore = await more.count();
  if (hasMore) await more.first().click(); await page.waitForTimeout(300);
  const expanded = await page.evaluate(() => { const b = document.querySelector('aside[aria-labelledby="task-drawer-title"] [aria-controls^="ev-"]'); const el = b && document.getElementById(b.getAttribute('aria-controls')); return el ? { open: b.getAttribute('aria-expanded'), whole: el.scrollWidth <= el.clientWidth + 1, ws: getComputedStyle(el).whiteSpace } : null; });
  await shot('fixlq-targets-more-1440');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const afterEsc = await page.evaluate(() => ({ open: document.querySelector('aside[aria-labelledby="task-drawer-title"] [aria-controls^="ev-"]')?.getAttribute('aria-expanded'), drawer: !!document.querySelector('aside[aria-labelledby="task-drawer-title"]') }));
  ok('Q8 Targets: "more" shows the whole evidence line; Esc closes it and the drawer stays open', hasMore === 1 && expanded?.open === 'true' && expanded.ws === 'normal' && afterEsc.open === 'false' && afterEsc.drawer, JSON.stringify({ hasMore, expanded, afterEsc }));

  if (errs.length) results.errors.push(...errs);
  const calls = { research_runs: await count('research_runs', 'business_id', B), visit_pull_runs: await count('visit_pull_runs', 'business_id', B), apollo_credit_spend: await count('apollo_credit_spend', 'business_id', B), sales_sync_runs: await count('sales_sync_runs', 'business_id', B), blockedRequests: blocked.length };
  ok('0 Claude / 0 Apollo: research_runs, visit_pull_runs, apollo_credit_spend, sales_sync_runs all 0', !calls.research_runs && !calls.visit_pull_runs && !calls.apollo_credit_spend && !calls.sales_sync_runs, JSON.stringify(calls));
} catch (e) {
  results.errors.push('THROW ' + (e.stack?.split('\n').slice(0, 3).join(' | ') || e.message));
  log('THROW', e.message);
} finally {
  await cleanup();
  const left = B ? await count('businesses', 'id', B) : 0;
  const hlAfter = await hlCounts();
  const diff = Object.keys(hlBefore).filter(k => hlBefore[k] !== hlAfter[k]);
  const lines = [`FIX loop-quickfixes-v1 REV2 - live pass (${new Date().toISOString().slice(0, 10)}, temp workspace, 0 Apollo, 0 Claude)`, ''];
  for (const c of results.checks) lines.push(`${c.pass ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` - ${c.detail}` : ''}`);
  if (results.errors.length) lines.push('', 'errors:', ...results.errors.map(e => '  ' + e));
  fs.writeFileSync(`${OUT}/fixlq-report.txt`, lines.join('\n'));
  console.log(lines.join('\n'));
  const pass = results.checks.filter(c => c.pass).length;
  console.log(`\nchecks ${pass}/${results.checks.length} · workspace left ${left} · HomeLover diff ${diff.length ? diff.join(', ') + ' (check who wrote it)' : 'none'} · errors ${results.errors.length} · restored: ${left === 0 && !diff.length ? 'yes' : 'NO'}`);
  process.exit(0);
}
