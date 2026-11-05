// FIX actions-all-weeks-v1 live check - localhost against this build, as Jack (ownerSession) on the REAL HomeLover
// workspace, READ-ONLY (0 Claude, 0 Apollo, no writes: ANTHROPIC / APOLLO / MICROSOFT keys blanked for the server, every
// non-GET API call and every Supabase write aborted at the network layer and counted).
// Parity numbers (bar 4): GET goals/actions to-dos owned by Jack = the DB's open to-dos for Jack (kind todo, status open,
// no prospect contact, not every step ticked, ANY week); overdue on Actions = GET goals/attention overdue_todos = the DB's
// overdue; undated = the DB's undated; Dashboard todos_per_owner Jack = the same. Screen at 1440 and 390: the No date
// group, the counts header, axe 0, no sideways scroll. Declared scope: 2 head counts per watched table + 1 paged read of
// Jack's open to-dos (+ its steps) via the service key; ~6 GETs through the local server; 2 page loads. ~60 s, cap 240 s.
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
const AXE = fs.readFileSync(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const OUT = path.join(ROOT, '.screenshots', 'fix-actions-all-weeks-v1');
const PORT = 3995, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const TABLES = ['sales_week_goals', 'sales_week_goal_steps', 'sales_flow_events', 'sales_suggestions', 'sales_signals', 'business_anthropic_usage', 'apollo_credit_spend'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data?.[0]?.id;
if (!HL) throw new Error('no HomeLover business');
const count = async t => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL); if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message}`); return r.count; };
const snapshot = async () => { const o = {}; for (const t of TABLES) o[t] = await count(t); return o; };
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const nowT = new Date();
const minsToSix = ((6 - (nowT.getHours() % 6)) % 6) * 60 - nowT.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (nowT.getHours() % 6 === 0 && nowT.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
let srv, browser, owner;
const blocked = [], realCalls = [], writes = [];
const results = { checks: [], axe: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  if (owner) { log(await owner.release()); owner = null; }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 240000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));

try {
  owner = await ownerSession(svc); log('owner session');
  const JACK = owner.userId;
  // ---- Ground truth from the DB (service key): Jack's open to-dos, any week.
  const page = async (q, from = 0, acc = []) => { const { data, error } = await q.range(from, from + 999); if (error) throw new Error(error.message); acc.push(...data); return data.length < 1000 ? acc : page(q, from + 1000, acc); };
  const raw = await page(svc.from('sales_week_goals').select('id, due_date, week_start, created_at').eq('business_id', HL).eq('kind', 'todo').eq('status', 'open').eq('owner_user_id', JACK).is('prospect_contact_id', null).order('id'));
  const steps = [];
  for (let i = 0; i < raw.length; i += 100) steps.push(...await page(svc.from('sales_week_goal_steps').select('goal_id, done').eq('business_id', HL).in('goal_id', raw.slice(i, i + 100).map(r => r.id)).order('id')));
  const ticked = new Set(raw.filter(r => { const s = steps.filter(x => x.goal_id === r.id); return s.length > 0 && s.every(x => x.done); }).map(r => r.id));
  const db = raw.filter(r => !ticked.has(r.id));
  const dbOverdue = db.filter(r => r.due_date && r.due_date < today).length, dbNodate = db.filter(r => !r.due_date).length;
  const weeks = [...new Set(db.map(r => r.week_start))].sort();
  log(`DB (Jack, status open, any week): ${raw.length} rows, ${ticked.size} with every step ticked -> ${db.length} open · ${dbOverdue} overdue · ${dbNodate} undated · week_starts ${weeks.length} (${weeks[0]} .. ${weeks.at(-1)})`);

  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', ANTHROPIC_API_KEY: '', APOLLO_API_KEY: '', MICROSOFT_CLIENT_SECRET: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  log('server up'); browser = await chromium.launch(); log('browser');

  // ---- The routes, as Jack (the browser's session cookie flow is the real one; here the API via the page's fetch).
  async function open(width, { tab = 'actions', view = '' } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 }, hasTouch: width < 900 });
    await ctx.addInitScript(([k, val, bz, d]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, val);
      localStorage.setItem('prospector_goals_owner', 'jack'); // the frame's Who = Jack (first-name slug), so the list is his
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, d);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      const apiWrite = isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname);
      if (apiWrite) writes.push(`${req.method()} ${u.pathname.replace(HL, '<HL>').replace(/[0-9a-f-]{36}/g, '<id>')}`);
      const deny = apiWrite || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.pathname}`); return route.abort(); }
      return route.continue();
    });
    const pg = await ctx.newPage(); pg.setDefaultTimeout(20000);
    const errors = []; pg.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    await pg.goto(`${BASE}/?tab=${tab}&view=${view}`, { waitUntil: 'domcontentloaded', timeout: 60000 }); log(`goto ${width} ${tab}`);
    const compact = width < 900;
    if (compact) { await pg.getByRole('button', { name: 'Open menu' }).click(); await pg.waitForTimeout(400); }
    await pg.getByLabel('Workspace').waitFor({ timeout: 20000 }); await pg.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await pg.waitForTimeout(1500);
    if (compact) { await pg.getByRole('button', { name: 'Open menu' }).click(); await pg.waitForTimeout(400); }
    await pg.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await pg.waitForTimeout(2500);
    await pg.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: /^Actions/ }).first().dispatchEvent('click'); await pg.waitForTimeout(1500);
    return { ctx, page: pg, errors };
  }
  const axeOn = async (pg, key, sel) => {
    await pg.addScriptTag({ content: AXE });
    const vs = await pg.evaluate(async s => { const r = await window.axe.run(document.querySelector(s), { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, html: x.nodes[0]?.html?.slice(0, 120) })); }, sel);
    results.axe[key] = vs;
    ok(`axe ${key}: ${vs.length} violations`, vs.length === 0, JSON.stringify(vs).slice(0, 400));
  };

  // ---- 1440: the routes (fetched from the signed-in page, so the real session gate applies) + the screen.
  {
    const { ctx, page: pg, errors } = await open(1440);
    await pg.locator('[data-actions] table').waitFor({ timeout: 30000 }); await pg.waitForTimeout(1500);
    const get = async p => { const r = await fetch(`${BASE}/api/sales/${HL}/goals/${p}`, { headers: { cookie: `prospector_at=${owner.session.access_token}` } }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
    const [act, att, dash] = await Promise.all([get('actions'), get('attention'), get('dashboard?days=30')]);
    ok(`routes answer 200 (actions ${act.status}, attention ${att.status}, dashboard ${dash.status})`, act.status === 200 && att.status === 200 && dash.status === 200);
    const mine = (act.body.items || []).filter(i => i.kind === 'todo' && i.owner_user_id === JACK);
    const mineOverdue = mine.filter(i => i.overdue).length, mineNodate = mine.filter(i => !i.due_date).length;
    const mineWeeks = new Set(mine.map(i => i.due_group));
    ok(`Actions to-dos owned by Jack ${mine.length} = DB open ${db.length}`, mine.length === db.length);
    ok(`Actions overdue ${mineOverdue} = attention overdue_todos ${att.body.counts?.overdue_todos} = DB overdue ${dbOverdue}`, mineOverdue === att.body.counts?.overdue_todos && mineOverdue === dbOverdue);
    ok(`Actions undated ${mineNodate} = DB undated ${dbNodate}; groups ${JSON.stringify(act.body.groups)} · todos ${JSON.stringify(act.body.todos)} · due_groups seen ${[...mineWeeks].join(',')}`, mineNodate === dbNodate && act.body.groups.nodate >= mineNodate);
    ok(`cap: shown ${act.body.todos?.shown} of ${act.body.todos?.total} (cap 500)`, act.body.todos && act.body.todos.shown === Math.min(500, act.body.todos.total));
    const jackRow = (dash.body.todos_per_owner || []).find(r => r.owner_user_id === JACK);
    ok(`Dashboard todos_per_owner Jack ${JSON.stringify(jackRow)} = open ${db.length} / overdue ${dbOverdue} / nodate ${dbNodate}`, jackRow && jackRow.open === db.length && jackRow.overdue === dbOverdue && jackRow.nodate === dbNodate);
    ok('no address in the three replies', !/@[a-z0-9-]+\.[a-z]{2,}/i.test(JSON.stringify([act.body, att.body, dash.body])));
    // The screen: Who = Jack (set in localStorage above), then the header + the No date group.
    const header = (await pg.locator('[data-todo-counts]').textContent()).trim();
    ok(`counts header "${header}"`, new RegExp(`^To-dos: ${db.length} open · ${dbOverdue} overdue · ${dbNodate} no date`).test(header), 'Who = Jack expected; if the frame kept Team the numbers are team-wide');
    const groups = await pg.locator('[data-actions] table button[aria-expanded]').evaluateAll(els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)));
    ok(`groups ${groups.join(' | ')}`, groups.some(g => /^Today/.test(g)) && groups.some(g => /^No date \d+/.test(g)));
    const noDate = pg.locator('[data-actions] table button[aria-expanded]').filter({ hasText: /^No date/ }).first();
    ok('No date folded by default', (await noDate.getAttribute('aria-expanded')) === 'false');
    await noDate.click(); await pg.waitForTimeout(600);
    await pg.evaluate(() => window.scrollTo(0, 0));
    await pg.locator('[data-actions]').screenshot({ path: `${OUT}/actions-1440.png`, animations: 'disabled', caret: 'hide' });
    await axeOn(pg, 'Actions@1440', '[data-actions]');
    ok('1440 Actions 0 page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- 390: the header line + no sideways scroll.
  {
    const { ctx, page: pg, errors } = await open(390);
    await pg.locator('[data-actions]').waitFor({ timeout: 30000 }); await pg.waitForTimeout(2000);
    const header = (await pg.locator('[data-todo-counts]').textContent().catch(() => '')).trim();
    ok(`390 header "${header}"`, /^To-dos: \d+ open · \d+ overdue · \d+ no date/.test(header));
    const overflow = await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    ok('390: no horizontal page scroll', !overflow);
    await pg.screenshot({ path: `${OUT}/actions-390.png`, fullPage: false });
    await axeOn(pg, 'Actions@390', '[data-actions]');
    ok('390 Actions 0 page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
} catch (e) {
  ok(`script error: ${e.message}`, false);
} finally {
  await cleanup();
}
const after = await snapshot();
const moved = TABLES.filter(t => before[t] !== after[t]).map(t => `${t} ${before[t]} -> ${after[t]}`);
const passed = results.checks.filter(c => c.pass).length;
console.log(`\nFIX actions-all-weeks-v1 live check: ${passed}/${results.checks.length} passed · ${Math.round((Date.now() - T0) / 1000)} s`);
console.log(`Claude / Apollo calls: ${realCalls.length} · API writes attempted (all aborted): ${writes.length}${writes.length ? ' ' + JSON.stringify([...new Set(writes)]) : ''} · other blocked: ${blocked.length}`);
console.log(`screenshots: ${fs.readdirSync(OUT).join(', ')}`);
console.log(`restored: ${moved.length ? `NO - ${moved.join(', ')}` : 'yes (read-only; no watched count moved)'}`);
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, writes, realCalls, before, after }, null, 2));
if (moved.length) throw new Error('watched counts moved');
