// todo-events-v1 Stage 2 - live, localhost against the build, as Jack (ownerSession) on the REAL HomeLover workspace.
// Every request is made by the page itself (the app's cookie session -> salesGate -> the route -> applyTodo).
// DECLARED before it runs:
//   Claude  0 (the key is removed from the server's environment; /api/scout/ask and the proxy are aborted in the browser).
//   Apollo  0 (the key is removed from the server's environment).
//   Reads   sales_week_goals paged (all rows of the workspace, ~500) four times, the Actions / attention / dashboard /
//           company / events / Scout search reads ~40 requests; under 5 MB.
//   Writes  (a) ONE real to-do of Jack's (overdue, linked to a company): reassign -> Undo · due -> Undo · snooze (the
//           row's More menu) -> Unsnooze (the Snoozed list) -> Undo of both when still inside the 2-minute window (else
//           a second snooze + Undo) · done -> reopened -> Undo of both · drop -> Undo. Final row = the snapshot; its
//           updated_at is put back by id at the end (the one direct write, values + timestamps rule).
//           (b) temp rows named "Verify todo-events Stage 2 (temp ...)": 1 to-do created -> snoozed -> both undone
//           (dropped) -> admin delete · 2 commitments + 3 to-dos linked to the first; the commitment is deleted (the 3 unlink as ONE batch),
//           one to-do is re-linked (the forced failure), the batch is undone (2 left unlinked - the commitment is gone -
//           1 named as failed; this last expectation follows the ruling made after the live runs), then all temp
//           rows are deleted through the routes. Net rows 0.
//           sales_todo_events: at most 45 rows added and KEPT (they are the history). Sign-in rows kept by rule.
//           Safety net: teardown puts the real to-do back from its snapshot and removes any temp row still there, by id.
//   Not written: every other non-GET call is aborted in the browser.
//   ~120 s; cap 235 s. BADGE_ONLY=1: only the temp to-do of (b) with the Tasks badge read (the real to-do is not written).
//   DRY=1: read-only (every non-GET aborted) - proves the sign-in, the pick and the selectors.
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
const { hasPii } = await import('../../api/sales/scrubText.js');
const { openTodosFor, todoCounts, laMonday } = await import('../../api/sales/openTodos.js');
const { weekIsFinal, addDays } = await import('../../api/sales/goalsShared.js');
const { isSnoozed } = await import('../../src/constants/todoSnooze.js');
const { buildPlanContext } = await import('../../api/sales/weekPlanContext.js');
const { salesIntents } = await import('../../api/sales/scoutIntents.js');
const AXE = fs.readFileSync(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const OUT = path.join(ROOT, '.screenshots', 'todo-events-v1', 'stage2');
const PORT = 3993, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0], SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const DRY = !!process.env.DRY;
const EVENT_CAP = 45;
fs.mkdirSync(OUT, { recursive: true });
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data?.[0]?.id;
if (!HL) throw new Error('no HomeLover business');
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const monday = laMonday(today);
const startIso = new Date().toISOString();
const results = { dry: DRY, checks: [], blocked: [], events: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 700)}` : ''); };
const LINKS = { partner: ['sales_goals', 'name', 'partner'], opportunity: ['sales_opportunities', 'organization', 'employer'], target: ['sales_targets', 'name', 'target'] };
const TEMP = 'Verify todo-events Stage 2 (temp';

const members = (await svc.from('business_members').select('user_id, name, role').eq('business_id', HL).not('user_id', 'is', null)).data;
const first = id => (id ? (members.find(m => m.user_id === id)?.name || 'a member').split(' ')[0] : 'Nobody');
const rowCount = async (table, f = q => q) => (await f(svc.from(table).select('*', { count: 'exact', head: true }).eq('business_id', HL))).count;
// the counts by the one definition (openTodos.js), straight from the table
const counts = async () => {
  const all = await openTodosFor(svc, HL, null, { snoozed: 'all', cap: 100000, today });
  const shown = all.rows.filter(r => !isSnoozed(r, today)), c = todoCounts(shown, today);
  return { open: c.open, overdue: c.overdue, nodate: c.nodate, linked: shown.filter(r => LINKS[r.link_type] && r.link_id).length, snoozed: all.rows.length - shown.length, rows: await rowCount('sales_week_goals'), events: await rowCount('sales_todo_events') };
};
const fmt = c => `open ${c.open} · overdue ${c.overdue} · no date ${c.nodate} · linked ${c.linked} · snoozed ${c.snoozed} · table rows ${c.rows} · event rows ${c.events}`;
const before = await counts();
log('before:', fmt(before));

let srv, browser, owner, X = null, snap = null, company = null;
const temp = []; // ids of rows this run created
const fullRow = async id => (await svc.from('sales_week_goals').select('*').eq('id', id).maybeSingle()).data;
const sameRow = (a, b, skip = []) => Object.keys(a).filter(k => !skip.includes(k) && JSON.stringify(a[k] ?? null) !== JSON.stringify(b?.[k] ?? null));
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  const fixes = [];
  if (snap && !DRY) {
    const now = await fullRow(snap.id);
    const off = now ? sameRow(snap, now) : ['row missing'];
    const values = off.filter(k => k !== 'updated_at');
    if (values.length) fixes.push(`the real to-do: ${values.join(', ')}`);
    if (off.length && now) { const patch = Object.fromEntries(off.map(k => [k, snap[k]])); const r = await svc.from('sales_week_goals').update(patch).eq('id', snap.id); if (r.error) fixes.push(`PUT BACK FAILED: ${r.error.message}`); }
    results.updated_at_put_back = off.includes('updated_at');
  }
  for (const id of temp) { if (await fullRow(id)) { await svc.from('sales_week_goals').delete().eq('id', id); fixes.push(`temp row ${id.slice(0, 8)} removed`); } }
  results.safety_net = fixes;
  log(`safety net: ${fixes.length ? `USED: ${fixes.join(' · ')}` : 'nothing to put back but updated_at (every value already equals its snapshot, no temp row left)'}`);
  if (owner) { log(await owner.release()); owner = null; }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 235000 });

try {
  owner = await ownerSession(svc);
  const other = members.find(m => m.user_id !== owner.userId && m.role !== 'viewer');
  if (!other) throw new Error('no second member to reassign to');

  // ---- the ONE real to-do: Jack's, open, overdue, linked to a company that exists, no steps, its week not final
  const open = (await openTodosFor(svc, HL, null, { today })).rows;
  const cands = open.filter(r => r.owner_user_id === owner.userId && LINKS[r.link_type] && r.link_id && r.due_date && r.due_date < today && !r.steps.length && !r.snooze_until && !hasPii(r.text || '') && !(r.text || '').includes('@') && /^[A-Za-z][A-Za-z ]{11,}/.test(r.text || ''));
  for (const c of cands) {
    const [table, col, type] = LINKS[c.link_type];
    const rec = (await svc.from(table).select(`id, ${col}`).eq('business_id', HL).eq('id', c.link_id).maybeSingle()).data;
    if (!rec || await weekIsFinal(svc, HL, c.week_start)) continue;
    X = c; company = { type, id: rec.id, name: rec[col] }; break;
  }
  if (!X) throw new Error(`no real to-do fits (Jack's, overdue, linked): ${cands.length} candidates`);
  if (await weekIsFinal(svc, HL, monday)) throw new Error('this week is finalized - the temp rows could not be written');
  snap = await fullRow(X.id);
  const needle = /^[A-Za-z][A-Za-z ]+/.exec(snap.text)[0].trim().slice(0, 40).trim();
  const eventsOf = async ids => (await svc.from('sales_todo_events').select('id, todo_id, kind, before, after, actor_user_id, origin, batch_id, at, undone_at, undo_of').eq('business_id', HL).in('todo_id', ids).gte('at', startIso).order('at').order('id')).data || [];
  log(`the real to-do: "${snap.text.slice(0, 60)}" · ${company.type} ${company.name} · owner ${first(snap.owner_user_id)} · due ${snap.due_date} · week ${snap.week_start} · origin ${snap.origin} · search words "${needle}" · of ${cands.length} that fit`);

  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', APOLLO_API_KEY: '', ANTHROPIC_API_KEY: '' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  const WRITE_OK = new RegExp(`^/api/sales/${HL}/goals/week(/[0-9a-f-]{36}|/events/[0-9a-f-]{36}/undo|/events/batch/[0-9a-f-]{36}/undo)?$`);

  async function openPage(width, height, query) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    await ctx.addInitScript(([k, v, bz, dd]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, dd);
      localStorage.setItem('prospector_auto_assay_disabled', '1'); localStorage.setItem('prospector_goals_owner', 'team'); localStorage.setItem('prospector_actions_folded', '[]');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today]);
    await ctx.route('**/*', route => {
      const req = route.request(); const u = new URL(req.url());
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      const write = req.method() !== 'GET';
      const allowed = isLocal && write && !DRY && WRITE_OK.test(u.pathname);
      const deny = (isLocal && write && /^\/(api|proxy)\//.test(u.pathname) && !allowed) || (isSupa && write && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { results.blocked.push(`${req.method()} ${u.pathname.replace(/[0-9a-f-]{36}/g, ':id')}`); return route.abort(); }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(20000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    await page.goto(`${BASE}/?business=${HL}&${query}`);
    return { ctx, page, errors };
  }
  const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), timeout: 8000 }).catch(e => log(`shot ${name} skipped: ${e.message.slice(0, 60)}`));
  const n2 = page => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
  const axe = async (page, sel) => { await page.addScriptTag({ content: AXE }); return page.evaluate(async s => (await window.axe.run(document.querySelector(s) || document.body, { resultTypes: ['violations'] })).violations.map(v => `${v.id} x${v.nodes.length}`), sel); };
  // one request, made by the page: the app's own session
  const call = (page, method, url, body) => page.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; }, [method, url, body || null]);
  const G = `/api/sales/${HL}/goals`;
  const rowSel = `[data-actions] [data-row][data-key="todo-${X.id}"]`;
  // the row's detail: the list is narrowed to the to-do with the screen's own search, then its text is clicked
  // (a cold load with ?open=todo:<id> is measured apart, in the DRY pass)
  const openDetail = async (pg, phone = false) => {
    if (phone) { await pg.getByRole('button', { name: /^Filters/ }).click(); await pg.getByLabel('Search actions').fill(needle); await pg.getByRole('button', { name: /^Show \d+/ }).click(); }
    else await pg.getByLabel('Search actions').fill(needle);
    await pg.locator(rowSel).waitFor({ timeout: 15000 }); await pg.waitForTimeout(400);
    const d = pg.locator(`[data-actions] [data-detail="todo-${X.id}"]`);
    if (DRY) await shot(pg, `dry-filtered-${phone ? 390 : 1440}`);
    // dispatched, not pressed: at 1440 the Goals section under the table overlaps it and takes the pointer on a row's text (measured below, pre-existing)
    if (!(await d.count())) await (phone ? pg.locator(rowSel).getByText(snap.text.slice(0, 20)).first() : pg.locator(`${rowSel} td.ui-table__detail-cell`)).dispatchEvent('click');
    await d.waitFor({ timeout: 10000 });
  };
  // the event Scout fires when a record is picked while Sales & Marketing is on screen
  const scoutOpen = (pg, params) => pg.evaluate(p => window.dispatchEvent(new CustomEvent('prospector:scout-open', { detail: { page: 'sales', params: p } })), params);
  const companyWindow = async pg => { await scoutOpen(pg, { tab: 'pipeline', view: 'companies', open: `${company.type}-${company.id}` }); await pg.locator('[data-panel-body]').waitFor({ timeout: 40000 }); await pg.waitForTimeout(3000); return pg.locator('[data-panel-body]').locator('xpath=ancestor::*[@role="dialog"][1]').innerText().catch(() => pg.locator('[data-panel-body]').innerText()); };
  const badgeOf = async page => { const l = await page.locator('button[aria-label^="Tasks"], button[aria-label^="Open tasks"]').first().getAttribute('aria-label').catch(() => null); return l ? Number(/(\d+) open/.exec(l)?.[1] || 0) : null; };
  const planCtx = async () => JSON.stringify(await buildPlanContext(svc, HL, owner.userId, monday));
  const todosIntent = salesIntents.find(i => i.id === 'todos');
  // where the to-do is, by the reads the screens use (the API that reads the DB) + the two in-process readers
  const where = async page => {
    const [act, snz, att, dash, comp, sc, plan, intent] = await Promise.all([
      call(page, 'GET', `${G}/actions`), call(page, 'GET', `${G}/actions?snoozed=1`), call(page, 'GET', `${G}/attention`), call(page, 'GET', `${G}/dashboard`),
      call(page, 'GET', `${G}/company?type=${company.type}&id=${company.id}`), call(page, 'GET', `/api/scout/search?scope=${HL}&q=${encodeURIComponent(needle)}`),
      planCtx(), todosIntent.run(svc, { businessId: HL, auth: { user: { id: owner.userId } }, ask: { mine: true, company: [] }, today }),
    ]);
    const mine = (dash.body.todos?.per_owner || []).find(r => r.owner_user_id === owner.userId);
    return {
      actions: (act.body.items || []).some(i => i.key === `todo-${X.id}`), actions_total: act.body.todos?.total, actions_snoozed_n: act.body.todos?.snoozed,
      snoozed_list: (snz.body.items || []).some(i => i.key === `todo-${X.id}`),
      attention_overdue: att.body.counts?.overdue_todos, dashboard_open: dash.body.todos?.open, dashboard_overdue: dash.body.todos?.overdue, dashboard_mine: mine?.open,
      company_window: (comp.body.todos || []).some(t => t.id === X.id),
      scout_search: (sc.body.groups || []).some(g => g.entity === 'todos' && g.items.some(i => i.id === X.id)),
      scout_tasks: JSON.stringify(intent).includes(X.id),
      week_plan: plan.includes(X.id) || plan.includes(snap.text.slice(0, 40)),
      statuses: [act, snz, att, dash, comp, sc].map(r => r.status).join(','),
    };
  };

  // ================= 1440 as Jack: Actions with the to-do's detail open
  const { ctx, page, errors } = await openPage(1440, 1000, 'tab=actions');
  await page.locator('[data-actions] [data-row]').first().waitFor({ timeout: 40000 });
  await page.waitForTimeout(2000);
  results.overlap_1440 = await page.evaluate(() => { const t = document.querySelector('[data-actions] [data-row]')?.closest('table, ul')?.getBoundingClientRect(), g = document.querySelector('#goals-section')?.getBoundingClientRect(), a = document.querySelector('[data-actions]')?.getBoundingClientRect(); return t && g ? { rows: document.querySelectorAll('[data-actions] [data-row]').length, table_top: Math.round(t.top), table_bottom: Math.round(t.bottom), actions_bottom: Math.round(a.bottom), goals_top: Math.round(g.top), overlap_px: Math.max(0, Math.round(Math.min(t.bottom, g.bottom) - g.top)) } : null; });
  log('Actions table vs the Goals section under it @1440:', JSON.stringify(results.overlap_1440));
  await openDetail(page);
  results.pressable_1440 = { done: await page.locator(`${rowSel} [data-slots] button`, { hasText: /^Done$/ }).first().click({ trial: true, timeout: 5000 }).then(() => true, e => e.message.split('\n').find(l => /intercepts/.test(l))?.trim() || 'no'), text: await page.locator(`${rowSel} td.ui-table__detail-cell`).click({ trial: true, timeout: 3000 }).then(() => true, e => e.message.split('\n').find(l => /intercepts/.test(l))?.trim().slice(0, 90) || 'no') };
  log('a real press lands on:', JSON.stringify(results.pressable_1440));
  await page.waitForTimeout(1500);
  const lastChange0 = await page.locator(`[data-detail="todo-${X.id}"]`).evaluate(el => [...el.querySelectorAll('dt, dd, [data-todo-last-change]')].map(n => n.textContent).join(' | ').match(/Last change[^|]*\|\s*([^|]*)/)?.[1]?.trim() || null);
  const badge0 = await badgeOf(page);
  const ui0 = await page.evaluate(sel => ({ slots: [...document.querySelectorAll(`${sel} [data-slots] button, ${sel} [data-slots] select`)].map(b => (b.getAttribute('aria-label') || b.textContent).replace(/ for .*/, '').trim()), more: [...document.querySelectorAll(`${sel} [data-slots] select option`)].map(o => o.textContent), chip: document.querySelector('[data-snoozed-chip]')?.textContent || null, counts: document.querySelector('[data-todo-counts]')?.textContent || null }), rowSel);
  const w0 = await where(page);
  await shot(page, 'actions-row-open-1440');
  ok('1440 as Jack: Actions opens on the to-do with its detail; the row has Done · the due menu · More; the reads all answer 200', ui0.slots.includes('Done') && ui0.slots.some(s => /^Due/.test(s)) && ui0.more.includes('Snooze 1 week') && /^200(,200)*$/.test(w0.statuses), JSON.stringify({ ui0, lastChange0, badge0 }));
  ok('before any change the to-do is on every list: Actions · the company window · Scout search · Scout tasks' + (w0.week_plan ? ' · the week plan' : ''), w0.actions && !w0.snoozed_list && w0.company_window && w0.scout_search && w0.scout_tasks, JSON.stringify(w0));
  const api0 = { total: w0.actions_total, snoozed: w0.actions_snoozed_n };
  ok(`counts agree: the table by the one rule (${fmt(before)}) = GET actions (total ${api0.total}, snoozed ${api0.snoozed}) = the Dashboard (open ${w0.dashboard_open}, overdue ${w0.dashboard_overdue})`, api0.total === before.open && api0.snoozed === before.snoozed && w0.dashboard_open === before.open && w0.dashboard_overdue === before.overdue, '');

  // ---- create (a temp to-do of THIS week, Jack's) -> the Tasks badge counts it -> snoozed: the badge drops it -> Undo
  //      of the snooze -> Undo of the create = dropped, never deleted -> the admin delete removes it
  const createCheck = async () => {
    const until = addDays(today, 7);
    const toActions = async () => { await page.goto(`${BASE}/?business=${HL}&tab=actions`); await page.locator('[data-actions] [data-row]').first().waitFor({ timeout: 40000 }); await page.waitForTimeout(2500); return badgeOf(page); };
    const cr = await call(page, 'POST', `${G}/week`, { week_start: monday, text: `${TEMP} create)`, owner_user_id: owner.userId, due_date: today });
    if (cr.status !== 201) throw new Error(`create: ${cr.status} ${JSON.stringify(cr.body).slice(0, 200)}`);
    temp.push(cr.body.goal.id);
    const bCreated = await toActions();
    const sn = await call(page, 'PATCH', `${G}/week/${cr.body.goal.id}`, { snooze_until: until, expect: { updated_at: cr.body.goal.updated_at } });
    const bSnoozed = await toActions();
    await shot(page, 'badge-while-temp-snoozed-1440');
    const usn = sn.body.event ? await call(page, 'POST', `${G}/week/events/${sn.body.event.id}/undo`) : { status: 0 };
    const ucr = await call(page, 'POST', `${G}/week/events/${cr.body.event.id}/undo`); const afterUndo = await fullRow(cr.body.goal.id);
    const del = await call(page, 'DELETE', `${G}/week/${cr.body.goal.id}`);
    const kinds = (await eventsOf([cr.body.goal.id])).map(e => e.kind);
    const bEnd = await toActions();
    ok(`create (POST goals/week: event create, origin manual; a to-do of this week, Jack's) -> the Tasks badge ${badge0} -> ${bCreated} -> snoozed: ${bSnoozed} -> Undo of the snooze, Undo of the create: the row is there with status dropped and its origin -> admin delete: the row is gone, its events stay -> badge ${bEnd}`, cr.body.event.kind === 'create' && cr.body.goal.origin === 'manual' && bCreated === badge0 + 1 && sn.status === 200 && sn.body.event?.kind === 'snooze' && bSnoozed === badge0 && usn.status === 200 && ucr.status === 200 && afterUndo?.status === 'dropped' && afterUndo.origin === 'manual' && del.status === 200 && !(await fullRow(cr.body.goal.id)) && bEnd === badge0 && kinds.join(',') === 'create,snooze,undo,undo', JSON.stringify({ create: cr.status, snooze: sn.status, undo_snooze: usn.status, undo_create: ucr.status, delete: del.status, events: kinds }));
  };

  if (DRY) {
    const c2 = await openPage(1440, 1000, 'tab=actions');
    await c2.page.locator('[data-actions] [data-row]').first().waitFor({ timeout: 40000 }); await c2.page.waitForTimeout(1500);
    await scoutOpen(c2.page, { tab: 'actions', open: `todo:${X.id}` }); await c2.page.waitForTimeout(2500);
    results.scout_open_todo = await c2.page.evaluate(id => ({ detail: !!document.querySelector(`[data-detail="todo-${id}"]`), row_in_view: (() => { const r = document.querySelector(`[data-key="todo-${id}"]`)?.getBoundingClientRect(); return r ? r.top >= 0 && r.bottom <= window.innerHeight : null; })() }), X.id);
    await shot(c2.page, 'dry-scout-open-todo-1440');
    log('Scout\'s open of the to-do while Actions is on screen:', JSON.stringify(results.scout_open_todo));
    const txt = await companyWindow(c2.page);
    await shot(c2.page, 'dry-company-window-1440');
    await c2.page.keyboard.press('Escape'); await c2.page.locator('[data-testid="side-panel-backdrop"]').waitFor({ state: 'detached', timeout: 5000 }).catch(() => c2.page.locator('[data-testid="side-panel-backdrop"]').click({ position: { x: 5, y: 500 } }).catch(() => {})); await c2.page.waitForTimeout(400);
    ok('DRY: the company window opens by its key and lists the to-do', txt.includes(snap.text.slice(0, 30)), `${txt.length} chars`);
    const bar = c2.page.locator('.scout-bar input').first(); await bar.click(); await bar.fill(needle); await c2.page.waitForTimeout(2500);
    await shot(c2.page, 'dry-scout-search-1440');
    ok('DRY: Scout search lists it under To-dos', (await c2.page.locator('.scout').first().innerText().catch(() => '')).includes(snap.text.slice(0, 20)), '');
    await c2.ctx.close();
  } else if (process.env.BADGE_ONLY) {
    await createCheck();
  } else {
    const ev = [];           // every event this run made on the real to-do, in order
    const live = async () => fullRow(X.id);
    const patch = async (body, label) => { const cur = await live(); const r = await call(page, 'PATCH', `${G}/week/${X.id}`, { ...body, expect: { updated_at: cur.updated_at } }); if (r.status !== 200 || !r.body.event) throw new Error(`${label}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`); ev.push(r.body.event); return r.body; };
    const undo = async (e, label) => { const r = await call(page, 'POST', `${G}/week/events/${e.id}/undo`); if (r.status === 200) ev.push(r.body.event); return r; };
    const eq = (row, f) => Object.entries(f).every(([k, v]) => (row[k] ?? null) === v);
    const back = async () => sameRow(snap, await live(), ['updated_at']);

    // ---- reassign -> Undo · due -> Undo (requests behind the open screen's back: it now shows a stale row)
    const re = await patch({ owner_user_id: other.user_id }, 'reassign'); const mid1 = await live(); const u1 = await undo(re.event);
    ok(`reassign: owner ${first(snap.owner_user_id)} -> ${first(other.user_id)} (event reassign, origin manual) -> Undo -> ${first(snap.owner_user_id)}`, re.event.kind === 'reassign' && re.event.origin === 'manual' && mid1.owner_user_id === other.user_id && u1.status === 200 && u1.body.event.kind === 'undo' && !(await back()).length, JSON.stringify({ before: re.event.before, after: re.event.after, undo: u1.status }));
    const newDue = addDays(today, 3);
    const du = await patch({ due_date: newDue }, 'due'); const mid2 = await live(); const u2 = await undo(du.event);
    ok(`due: ${snap.due_date} -> ${newDue} (event due) -> Undo -> ${snap.due_date}`, du.event.kind === 'due' && mid2.due_date === newDue && u2.status === 200 && !(await back()).length, JSON.stringify({ before: du.event.before, after: du.event.after }));

    // ---- the 409, on Actions: the screen still holds the row as it was before those four writes
    const conflict = page.waitForResponse(r => r.url().endsWith(`/goals/week/${X.id}`) && r.request().method() === 'PATCH', { timeout: 15000 });
    await page.locator(`${rowSel} [data-slots] button`, { hasText: /^Done$/ }).first().click();
    const cres = await conflict; const cbody = await cres.json().catch(() => ({}));
    await page.getByText(/changed since you opened it/).first().waitFor({ timeout: 8000 }).catch(() => {});
    const shown409 = await page.evaluate(() => [...document.querySelectorAll('[data-actions] *')].map(n => (n.children.length ? '' : n.textContent)).find(t => /changed since you opened it/.test(t)) || null);
    await shot(page, 'actions-409-1440');
    await page.locator(rowSel).waitFor({ timeout: 15000 });
    ok('409 on Actions: Done pressed on a row that changed since the screen read it -> 409 code changed, the line is on screen, the to-do is still open, no event', cres.status() === 409 && cbody.code === 'changed' && !!shown409 && (await live()).status === 'open' && (await eventsOf([X.id])).length === ev.length, `${cres.status()} ${cbody.code} · "${shown409}"`);

    // ---- snooze from the row's More menu (the screen reloaded the row on the 409)
    await page.waitForTimeout(1200);
    const snzP = page.waitForResponse(r => r.url().endsWith(`/goals/week/${X.id}`) && r.request().method() === 'PATCH', { timeout: 15000 });
    await page.locator(`${rowSel} [data-slots] select[aria-label^="More for"]`).selectOption({ label: 'Snooze 1 week' });
    const s1 = await (await snzP).json(); ev.push(s1.event);
    const tSnooze = Date.now();
    await page.getByRole('status').filter({ hasText: /Snoozed until/ }).first().waitFor({ timeout: 8000 }).catch(() => {});
    const toast = await page.getByRole('status').first().textContent().catch(() => null);
    await shot(page, 'actions-snoozed-toast-1440');
    await page.waitForTimeout(600);
    const during = await counts();
    const w1 = await where(page);
    const until = addDays(today, 7);
    ok(`snooze (More -> Snooze 1 week): snooze_until null -> ${until}, due date untouched (${snap.due_date}); event snooze; the toast offers Undo`, s1.event?.kind === 'snooze' && (await live()).snooze_until === until && (await live()).due_date === snap.due_date && /Snoozed until/.test(toast || ''), `toast "${(toast || '').slice(0, 80)}"`);
    ok(`while snoozed, counts: open ${before.open} -> ${during.open} · overdue ${before.overdue} -> ${during.overdue} · no date ${during.nodate} · linked ${before.linked} -> ${during.linked} · snoozed ${before.snoozed} -> ${during.snoozed}`, during.open === before.open - 1 && during.overdue === before.overdue - 1 && during.nodate === before.nodate && during.linked === before.linked - 1 && during.snoozed === before.snoozed + 1, '');
    ok('while snoozed, the row is ABSENT from: Actions · Needs attention (overdue to-dos) · the Dashboard (open, overdue, Jack\'s) · Scout tasks · the week plan · the company window · Scout search; and present under Snoozed', !w1.actions && w1.snoozed_list && w1.actions_total === w0.actions_total - 1 && w1.actions_snoozed_n === w0.actions_snoozed_n + 1 && w1.attention_overdue === w0.attention_overdue - 1 && w1.dashboard_open === w0.dashboard_open - 1 && w1.dashboard_overdue === w0.dashboard_overdue - 1 && w1.dashboard_mine === w0.dashboard_mine - 1 && !w1.scout_tasks && !w1.week_plan && !w1.company_window && !w1.scout_search, JSON.stringify({ before: w0, snoozed: w1 }));
    // the lines: Pipeline moves reads goals/week/events for the week; the company window reads them by link
    const week = await call(page, 'GET', `${G}/week/events?from=${monday}&to=${addDays(monday, 7)}`);
    const line = (week.body.events || []).find(e => e.id === s1.event.id);
    const { pipelineMoves } = await import('../../src/components/salesAnalytics/goals/todayModel.js').catch(() => ({}));
    const moves = pipelineMoves ? pipelineMoves({ todoEvents: week.body.events || [] }, 500) : null;
    const move = moves?.find(m => m.key === `t-${s1.event.id}`);
    ok('the lines: goals/week/events carries the snooze ("snoozed until <day>", by Jack, no address) and marks the reassign and the due change undone (Pipeline moves leaves undone events out)', !!line && /^snoozed until /.test(line.words) && line.by_user === owner.userId && !JSON.stringify(week.body).includes('@') && [re.event.id, du.event.id].every(i => (week.body.events || []).find(e => e.id === i)?.undone_at) && (!moves || (!!move && move.kind === 'To-do' && !moves.some(m => [re.event.id, du.event.id].map(i => `t-${i}`).includes(m.key)))), JSON.stringify({ words: line?.words, events_this_week: week.body.events?.length }));

    // on screen while snoozed: Actions reloaded (row gone, chip, badge), the company window, Scout search
    await page.goto(`${BASE}/?business=${HL}&tab=actions`); await page.locator('[data-actions] [data-row]').first().waitFor({ timeout: 40000 }); await page.waitForTimeout(2500);
    const ui1 = await page.evaluate(sel => ({ moves: [...document.querySelectorAll('#goals-section li')].map(li => li.innerText.replace(/\s+/g, ' ')).filter(t => /^To-do/.test(t)).slice(0, 3), row: !!document.querySelector(sel), chip: document.querySelector('[data-snoozed-chip]')?.textContent || null, counts: document.querySelector('[data-todo-counts]')?.textContent || null }), rowSel);
    const badge1 = await badgeOf(page);
    await shot(page, 'actions-while-snoozed-1440');
    ok(`on screen while snoozed: the row is gone from Actions, the chip reads "${ui1.chip}", "Pipeline moves this week" opens with its line; the Tasks badge stays ${badge0} -> ${badge1} (it counts this week's to-dos, this one is of the week of ${snap.week_start} - the badge is checked on the temp to-do)`, ui1.moves.some(t => t.includes(snap.text.slice(0, 20)) && /snoozed until/.test(t)) && !ui1.row && ui1.chip === `Snoozed (${before.snoozed + 1})` && badge0 != null && badge1 === badge0 - (snap.week_start === monday ? 1 : 0), JSON.stringify({ ui0: ui0.counts, ui1: { ...ui1, moves: ui1.moves.map(t => t.replace(snap.text, 'the to-do').slice(0, 70)) } }));
    const cw = await openPage(1440, 1000, 'tab=actions');
    await cw.page.locator('[data-actions] [data-row]').first().waitFor({ timeout: 40000 }); await cw.page.waitForTimeout(1500);
    const cwText = await companyWindow(cw.page);
    await shot(cw.page, 'company-window-while-snoozed-1440');
    await cw.page.keyboard.press('Escape'); await cw.page.locator('[data-testid="side-panel-backdrop"]').waitFor({ state: 'detached', timeout: 5000 }).catch(() => cw.page.locator('[data-testid="side-panel-backdrop"]').click({ position: { x: 5, y: 500 } }).catch(() => {})); await cw.page.waitForTimeout(400);
    const sbar = cw.page.locator('.scout-bar input').first(); await sbar.click(); await sbar.fill(needle); await cw.page.waitForTimeout(2500);
    const scoutText = await cw.page.locator('.scout').first().innerText().catch(() => '');
    await shot(cw.page, 'scout-search-while-snoozed-1440');
    const cwTodoLine = cwText.split('\n').filter(l => l.includes(snap.text.slice(0, 30)));
    ok('on screen while snoozed: the company window\'s to-do list does not hold it, its activity says "To-do snoozed until ..."; Scout search does not list it', cwTodoLine.every(l => /^To-do /.test(l.trim())) && cwTodoLine.some(l => /To-do snoozed until/.test(l)) && !scoutText.includes(snap.text.slice(0, 30)) && cw.errors.length === 0, JSON.stringify({ lines: cwTodoLine.map(l => l.trim().slice(0, 40)), scout_chars: scoutText.length, errors: cw.errors }));
    await cw.ctx.close();

    // ---- unsnooze from the Snoozed list
    await page.locator('[data-snoozed-chip]').click();
    await page.locator(rowSel).waitFor({ timeout: 20000 });
    const unzP = page.waitForResponse(r => r.url().endsWith(`/goals/week/${X.id}`) && r.request().method() === 'PATCH', { timeout: 15000 });
    await page.locator(`${rowSel} [data-slots] button`, { hasText: /^Unsnooze$/ }).first().click();
    const un = await (await unzP).json(); ev.push(un.event);
    await page.waitForTimeout(800);
    await shot(page, 'actions-unsnoozed-1440');
    const w2 = await where(page);
    ok('unsnooze (the Snoozed list -> Unsnooze): event unsnooze; the to-do is back on every list and every count is the first one', un.event?.kind === 'unsnooze' && !(await back()).length && w2.actions && !w2.snoozed_list && w2.company_window && w2.scout_search && w2.scout_tasks && w2.week_plan === w0.week_plan && w2.actions_total === w0.actions_total && w2.attention_overdue === w0.attention_overdue && w2.dashboard_open === w0.dashboard_open && w2.dashboard_mine === w0.dashboard_mine, JSON.stringify(w2));
    // Undo of the unsnooze (snoozed again), then of the snooze - inside the 2-minute window; else a fresh pair
    const uu = await undo(un.event); const again = await live();
    const us = await undo(s1.event);
    let late = null;
    if (us.status !== 200) { const p = await patch({ snooze_until: null }, 'unsnooze again'); const s2 = await patch({ snooze_until: until }, 'snooze again'); const u = await undo(s2.event); late = { first_undo: `${us.status} ${us.body.code || us.body.error}`, unsnooze: p.event.kind, snooze: s2.event.kind, undo: u.status }; }
    ok(`Undo of the unsnooze -> snoozed until ${until} again; Undo of the snooze (${Math.round((Date.now() - tSnooze) / 1000)} s after it${late ? ' - past the 2-minute window, refused; unsnoozed by a write, then a second snooze undone' : ''}) -> not snoozed`, uu.status === 200 && again.snooze_until === until && (us.status === 200 || (late && late.undo === 200 && /expired|too late/.test(late.first_undo))) && !(await back()).length, JSON.stringify(late || { undo_unsnooze: uu.status, undo_snooze: us.status }));

    // ---- done -> reopened -> Undo of both · drop -> Undo
    const dn = await patch({ status: 'done' }, 'done'); const midDone = await live();
    const ro = await patch({ status: 'open' }, 'reopen'); const midOpen = await live();
    const ur = await undo(ro.event); const midDone2 = await live(); const ud = await undo(dn.event);
    ok('done (completed_at stamped) -> reopened by a write (event undone, completed_at cleared) -> Undo of the reopen (done again, the same completed_at) -> Undo of the done -> open', dn.event.kind === 'done' && midDone.status === 'done' && !!midDone.completed_at && ro.event.kind === 'undone' && midOpen.status === 'open' && !midOpen.completed_at && ur.status === 200 && midDone2.status === 'done' && Date.parse(midDone2.completed_at) === Date.parse(midDone.completed_at) && ud.status === 200 && !(await back()).length, JSON.stringify({ undo_reopen: ur.status, undo_done: ud.status }));
    const dr = await patch({ status: 'dropped' }, 'drop'); const midDrop = await live(); const udr = await undo(dr.event);
    const twice = await call(page, 'POST', `${G}/week/events/${dr.event.id}/undo`);
    ok('drop (event drop) -> Undo -> open; a second Undo of the same event is refused (409 already undone)', dr.event.kind === 'drop' && midDrop.status === 'dropped' && udr.status === 200 && twice.status === 409 && !(await back()).length, `${twice.status} ${twice.body.error}`);

    await createCheck();

    // ---- a batch of 3: deleting a commitment unlinks its to-dos as ONE batch; one is re-linked (the forced failure)
    const mk = async (body, label) => { const r = await call(page, 'POST', `${G}/week`, { week_start: monday, owner_user_id: owner.userId, ...body }); if (r.status !== 201) throw new Error(`${label}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`); temp.push(r.body.goal.id); return r.body.goal; };
    const c1 = await mk({ kind: 'commitment', text: `${TEMP} commitment A)` }, 'commitment A');
    const c2 = await mk({ kind: 'commitment', text: `${TEMP} commitment B)` }, 'commitment B');
    const t = []; for (const n of [1, 2, 3]) t.push(await mk({ text: `${TEMP} batch ${n})`, link_type: 'commitment', link_id: c1.id }, `batch to-do ${n}`));
    const dc = await call(page, 'DELETE', `${G}/week/${c1.id}`);
    const batchId = dc.body.batch_id;
    const unlinked = await Promise.all(t.map(x => fullRow(x.id)));
    const relink = await call(page, 'PATCH', `${G}/week/${t[1].id}`, { link_type: 'commitment', link_id: c2.id, expect: { updated_at: unlinked[1].updated_at } });
    const bu = batchId ? await call(page, 'POST', `${G}/week/events/batch/${batchId}/undo`) : { status: 0, body: {} };
    const afterBatch = await Promise.all(t.map(x => fullRow(x.id)));
    const batchEvents = (await eventsOf(t.map(x => x.id))).filter(e => e.batch_id === batchId);
    const names = id => `to-do ${t.findIndex(x => x.id === id) + 1}`;
    // Stage 2 ruling (after the live runs): the commitment is gone, so Undo leaves the untouched to-dos unlinked and says so
    ok('batch of 3 (a commitment deleted -> its 3 to-dos unlinked, one batch id) -> one re-linked meanwhile -> batch Undo: the commitment is gone, so 2 stay unlinked and are listed as left unlinked, the third is NAMED as failed and left as it is', dc.status === 200 && dc.body.unlinked === 3 && !!batchId && unlinked.every(r => r.link_id === null) && relink.status === 200 && bu.status === 200 && bu.body.undone?.length === 0 && bu.body.left_unlinked?.length === 2 && bu.body.failed?.length === 1 && bu.body.failed[0].todo_id === t[1].id && afterBatch[0].link_id === null && afterBatch[2].link_id === null && afterBatch[1].link_id === c2.id && batchEvents.filter(e => e.kind === 'link').length === 3 && batchEvents.filter(e => e.kind === 'undo').length === 0, JSON.stringify({ delete: dc.status, unlinked: dc.body.unlinked, left_unlinked: (bu.body.left_unlinked || []).map(f => `${names(f.todo_id)}: ${f.note}`), failed: (bu.body.failed || []).map(f => `${names(f.todo_id)}: ${f.error}`), batch_events: batchEvents.map(e => `${names(e.todo_id)} ${e.kind}${e.undone_at ? ' (undone)' : ''}`), same_instant: new Set(batchEvents.filter(e => e.kind === 'link').map(e => e.at)).size === 1 }));
    const bu2 = await call(page, 'POST', `${G}/week/events/batch/${batchId}/undo`);
    results.batch_second_undo = `${bu2.status} undone ${bu2.body.undone?.length ?? '-'} failed ${bu2.body.failed?.length ?? '-'} ${bu2.body.error || ''}`.trim();
    const dels = []; for (const x of [...t, c2]) dels.push((await call(page, 'DELETE', `${G}/week/${x.id}`)).status);
    const left = (await Promise.all(temp.map(fullRow))).filter(Boolean).length;
    ok('the temp rows are deleted through the routes (3 to-dos by the admin delete, each dropped first; the second commitment by its creator): none left', dels.every(s => s === 200) && left === 0, `${dels.join(',')} · left ${left} · a second batch Undo: ${results.batch_second_undo}`);

    // ---- the real to-do is the snapshot again; Last change on the row
    const off = sameRow(snap, await live(), ['updated_at']);
    await page.goto(`${BASE}/?business=${HL}&tab=actions`);
    await page.locator('[data-actions] [data-row]').first().waitFor({ timeout: 40000 }); await page.waitForTimeout(1500); await openDetail(page);
    await page.locator(`[data-actions] [data-detail="todo-${X.id}"] [data-todo-last-change]`).waitFor({ timeout: 15000 });
    const lastChange = await page.locator(`[data-detail="todo-${X.id}"] [data-todo-last-change]`).textContent();
    await shot(page, 'actions-last-change-1440');
    const ax = await axe(page, '[data-actions]');
    ok(`the real to-do equals its snapshot (every column but updated_at, put back at teardown); Last change on the row: "${lastChange}" (was "${lastChange0}"); axe 0 on Actions · N2 0 px · no page error`, off.length === 0 && /^undone · .+ by /.test(lastChange) && ax.length === 0 && (await n2(page)) === 0 && errors.length === 0, JSON.stringify({ off, axe: ax, errors }));
    results.events = (await eventsOf([X.id])).map(e => ({ kind: e.kind, origin: e.origin, by: first(e.actor_user_id), before: e.before, after: e.after, undone: !!e.undone_at, undo_of: e.undo_of ? ev.findIndex(x => x?.id === e.undo_of) + 1 || 'earlier' : null }));
    ok(`every write left exactly one event on the real to-do: ${results.events.length} rows = the ${ev.length} replies`, results.events.length === ev.length && ev.every(Boolean), results.events.map((e, i) => `${i + 1} ${e.kind}${e.undo_of ? ` of ${e.undo_of}` : ''}${e.undone ? '*' : ''}`).join(' · '));
  }
  await ctx.close();

  // ================= 390
  { const { ctx: pc, page: pp, errors: pe } = await openPage(390, 844, 'tab=actions');
    await pp.locator('[data-actions] [data-row]').first().waitFor({ timeout: 40000 }); await pp.waitForTimeout(1500);
    await openDetail(pp, true); await pp.waitForTimeout(1500);
    const lc = await pp.locator(`[data-detail="todo-${X.id}"]`).innerText();
    await pp.locator(`[data-detail="todo-${X.id}"]`).scrollIntoViewIfNeeded().catch(() => {});
    await shot(pp, 'actions-row-open-390');
    const ax = await axe(pp, '[data-actions]');
    ok('390: Actions opens on the to-do, the detail shows Last change, the row keeps Done + More (the due choices fold into More); axe 0 · N2 0 px · no page error', /last change/i.test(lc) && (DRY || /undone · /.test(lc)) && (await pp.locator(`${rowSel} [data-slots] button, ${rowSel} [data-slots] select`).count()) >= 2 && ax.length === 0 && (await n2(pp)) === 0 && pe.length === 0, JSON.stringify({ axe: ax, errors: pe, n2: await n2(pp) }));
    await pc.close(); }

  const after = await counts();
  results.counts = { before, after };
  const added = after.events - before.events;
  ok(`counts after = before: ${fmt(after)} (event rows +${added}, kept; cap ${EVENT_CAP})`, ['open', 'overdue', 'nodate', 'linked', 'snoozed', 'rows'].every(k => after[k] === before[k]) && added <= EVENT_CAP && (!DRY || added === 0), JSON.stringify({ before, after }));
  results.stray = [...new Set(results.blocked)];
  log(`blocked non-GET calls: ${results.blocked.length}${results.blocked.length ? ` (${results.stray.slice(0, 8).join(', ')})` : ''}`);
} catch (e) { ok('run completed', false, e.message.slice(0, DRY ? 1600 : 500)); }
finally { await cleanup(); }
if (snap && !DRY) { const end = await fullRow(snap.id); const off = end ? sameRow(snap, end) : ['row missing']; ok('after teardown the real to-do equals its snapshot in every column, updated_at included', off.length === 0, off.join(', ')); }
fs.writeFileSync(path.join(OUT, DRY ? 'results-dry.json' : 'results.json'), JSON.stringify(results, null, 1));
const failed = results.checks.filter(c => !c.pass);
const net = results.safety_net || [];
console.log(`\n${results.checks.length - failed.length}/${results.checks.length} checks${DRY ? ' (DRY, read-only)' : ''} · Claude 0 · Apollo 0 · restored: ${!net.length && (DRY || !failed.some(f => /snapshot|temp rows|counts after/.test(f.name))) ? 'yes' : `CHECK (${JSON.stringify(net)})`}`);
process.exit(failed.length ? 1 : 0);
