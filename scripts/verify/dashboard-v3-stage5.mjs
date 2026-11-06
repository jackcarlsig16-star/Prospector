// dashboard-v3 Stage 5 live check - localhost against the build, as Jack (ownerSession) on the REAL HomeLover workspace.
// 0 Claude, 0 Apollo. ONE write: Save view (POST goals/explorer/views) - deleted again (DELETE) and sales_settings.saved_views
// compared byte-for-byte; every other non-GET API call and Supabase write is aborted at the network layer and counted.
// Real wiring: GET goals/dashboard (team + one owner) against the raw tables (partners by status / owner, employers by
// stage, open to-dos per owner with their steps, waiting rows, covered lives from stage Meeting on), GET goals/pulse
// (home + email, this week + month), GET goals/scorecard, GET goals/sequence-steps vs the raw daily counts and
// sales_mailbox_owners (the Brad-exclusion rule), GET /entities. Browser at 1440: every Dashboard sub-view (Home with the
// three cards = the route's digits, the Explorer's two rows one line each, Period N2 0 px, Who = Jack re-reads the cards,
// "2,721" / "8/100" counted on Home; Email tiles = the route; Scorecard cells = the route; Sources), axe 0 on each; 390:
// each sub-view with no sideways scroll, the cards stacked, axe 0; Viewer: no Save / Share / Sync / Dismiss / Set goals.
// Side-by-side PNG: the mockup (Dash.dc.html, file://) beside the build at 1440. ~4 min, cap 300 s.
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
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const { PARTNER_STATUS_GROUPS } = await import('../../src/constants/homeCards.js');
const OUT = path.join(ROOT, '.screenshots', 'dashboard-v3-stage5');
const MOCK = path.join(ROOT, 'specs', 'design', 'dashboard-v3', 'Dash.dc.html');
const PORT = 3999, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const TABLES = ['sales_metric_targets', 'sales_week_goals', 'sales_week_goal_steps', 'sales_insight_dismissals', 'sales_settings', 'sales_sequence_tags', 'sales_opportunities', 'sales_goals', 'sales_targets', 'sales_partner_events', 'business_anthropic_usage', 'sales_sync_runs', 'web_visits', 'microsoft_events', 'sales_email_daily_counts', 'sales_sequenced_accounts', 'business_members', 'sales_mailbox_owners', 'apollo_credit_spend'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data?.[0]?.id;
if (!HL) throw new Error('no HomeLover business');
const count = async t => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL); if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message}`); return r.count; };
const snapshot = async () => { const o = {}; for (const t of TABLES) o[t] = await count(t); return o; };
const savedViews = async () => JSON.stringify((await svc.from('sales_settings').select('saved_views').eq('business_id', HL).maybeSingle()).data?.saved_views ?? null);
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const monday = (() => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
const month = `${today.slice(0, 7)}-01`;
const fmt = n => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const pct = r => (r == null ? '—' : `${(r * 100).toFixed(1)}%`);
const expected = m => (m.value == null ? '—' : m.kind === 'rate' ? pct(m.value) : m.goal != null ? `${fmt(m.value)}/${fmt(m.goal)}` : fmt(m.value));
const HOME_TILES = ['sent', 'delivered_rate', 'human_open_rate', 'reply_rate', 'meetings', 'visitors', 'first_touched'];
const EMAIL_TILES = ['sent', 'delivered_rate', 'hard_bounce_rate', 'spam_blocks', 'human_open_rate', 'reply_rate', 'meetings'];
const ROWS = [['total_in_sequence', fmt], ['sequences_running', fmt], ['human_open_rate', pct], ['meetings_set', fmt], ['people_first_touched', fmt], ['tier1_touched_pct', pct], ['partner_meetings', fmt], ['partners_pilot_live', fmt]];
const VIEW_NAME = 'verify stage five temp view'; // no digit runs: the server scrubs phone-like numbers from saved text
const ALLOW_WRITES = [`/api/sales/${HL}/goals/explorer/views`];
const all = async (table, cols, narrow = q => q) => { const out = []; for (let from = 0; ; from += 1000) { const r = await narrow(svc.from(table).select(cols).eq('business_id', HL)).order('id').range(from, from + 999); if (r.error) throw new Error(`${table}: ${r.error.message}`); out.push(...r.data); if (r.data.length < 1000) break; } return out; };
let srv, browser, owner;
const blocked = [], realCalls = [], writes = [], allowed = [];
const results = { checks: [], errors: [], axe: {}, n2: {}, rows: {}, facts: {}, deviations: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 300000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
const viewsBefore = await savedViews();
log('before', JSON.stringify(before), 'saved_views', viewsBefore.length, 'chars');

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', ANTHROPIC_API_KEY: '', APOLLO_API_KEY: '', MICROSOFT_CLIENT_SECRET: '', GMAIL_CLIENT_SECRET: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const get = async p => { const r = await fetch(`${BASE}/api/sales/${HL}${p}`, { headers: { cookie } }); return { status: r.status, body: await r.json().catch(() => null) }; };

  // ---- Real wiring: the cards route against the raw tables (independent arithmetic).
  const cards = await get('/goals/dashboard');
  const c = cards.body || {};
  const members = (await svc.from('business_members').select('user_id, name').eq('business_id', HL).not('user_id', 'is', null).order('created_at')).data || [];
  const goals = await all('sales_goals', 'id, pipeline_status, owner_user_id', q => q.eq('goal_type', 'partnership').is('archived_at', null));
  const opps = await all('sales_opportunities', 'id, stage, owner, covered_lives', q => q.is('archived_at', null));
  const todoRows = await all('sales_week_goals', 'id, owner_user_id, due_date', q => q.eq('kind', 'todo').eq('status', 'open').is('prospect_contact_id', null));
  const stepRows = await all('sales_week_goal_steps', 'id, goal_id, done');
  const waitingRows = await all('sales_week_goals', 'id, due_date', q => q.eq('kind', 'waiting').eq('status', 'open'));
  const stepsOf = new Map(); for (const s of stepRows) { if (!stepsOf.has(s.goal_id)) stepsOf.set(s.goal_id, []); stepsOf.get(s.goal_id).push(s.done); }
  const openTodos = todoRows.filter(t => { const st = stepsOf.get(t.id) || []; return !(st.length && st.every(Boolean)); });
  const stageCount = Object.fromEntries((c.employers?.by_stage || []).map(s => [s.id, s.count]));
  const rawStage = {}; for (const o of opps) rawStage[o.stage] = (rawStage[o.stage] || 0) + 1;
  const stageOk = Object.keys({ ...stageCount, ...rawStage }).every(k => (stageCount[k] || 0) === (rawStage[k] || 0));
  ok(`real wiring: GET goals/dashboard ${cards.status}: employers by stage ${JSON.stringify(stageCount)} = the raw opportunities ${JSON.stringify(rawStage)} (${stageOk}); total ${c.employers?.total} = ${opps.length}`, cards.status === 200 && stageOk && c.employers?.total === opps.length);
  const rawStatus = Object.fromEntries(PARTNER_STATUS_GROUPS.map(g => [g.id, goals.filter(p => g.statuses.includes(p.pipeline_status || 'not_started')).length]));
  const routeStatus = Object.fromEntries((c.partners?.by_status || []).map(s => [s.id, s.count]));
  ok(`partners by status ${JSON.stringify(routeStatus)} = raw ${JSON.stringify(rawStatus)}; total ${c.partners?.total} = ${goals.length}`, JSON.stringify(routeStatus) === JSON.stringify(rawStatus) && c.partners?.total === goals.length);
  const rawOwner = Object.fromEntries([...members.map(m => m.user_id), null].map(id => [id || 'unassigned', goals.filter(p => (p.owner_user_id || null) === id).length]));
  const routeOwner = Object.fromEntries((c.partners?.by_owner || []).map(r => [r.owner_user_id || 'unassigned', r.count]));
  ok(`partners by owner ${JSON.stringify(routeOwner)} = raw ${JSON.stringify(rawOwner)} (members ${members.length}; no address: ${!/@/.test(JSON.stringify(c))})`, Object.keys(rawOwner).every(k => (routeOwner[k] || 0) === rawOwner[k]) && !/@/.test(JSON.stringify(c)));
  const rawTodos = Object.fromEntries([...members.map(m => m.user_id), null].map(id => { const mine = openTodos.filter(t => (t.owner_user_id || null) === id); return [id || 'unassigned', [mine.length, mine.filter(t => t.due_date && t.due_date < today).length]]; }));
  const routeTodos = Object.fromEntries((c.todos?.per_owner || []).map(r => [r.owner_user_id || 'unassigned', [r.open, r.overdue]]));
  ok(`to-dos per owner [open, overdue] ${JSON.stringify(routeTodos)} = raw rows with their steps ${JSON.stringify(rawTodos)}`, Object.keys(rawTodos).every(k => JSON.stringify(routeTodos[k] || [0, 0]) === JSON.stringify(rawTodos[k])));
  const rawWaiting = { open: waitingRows.length, overdue: waitingRows.filter(w => w.due_date && w.due_date < today).length };
  const rawLives = opps.filter(o => ['meeting', 'proposal_pilot', 'verbal', 'contract', 'launched'].includes(o.stage)).reduce((n, o) => n + (o.covered_lives || 0), 0);
  ok(`waiting ${JSON.stringify(c.waiting)} = raw ${JSON.stringify(rawWaiting)}; lives ${JSON.stringify(c.lives)} = stage Meeting on ${rawLives}`, c.waiting?.open === rawWaiting.open && c.waiting?.overdue === rawWaiting.overdue && c.lives?.value === rawLives);
  const jack = members.find(m => m.user_id === owner.userId) || members[0];
  const mine = await get(`/goals/dashboard?owner=${jack.user_id}`);
  const mj = mine.body || {};
  ok(`GET goals/dashboard?owner=<${jack.name.split(' ')[0]}> ${mine.status}: owners ${JSON.stringify((mj.partners?.by_owner || []).map(r => r.name))}, to-do rows ${JSON.stringify((mj.todos?.per_owner || []).map(r => [r.name, r.open]))}, employers ${mj.employers?.total} (team ${c.employers?.total}), waiting unchanged ${mj.waiting?.open === c.waiting?.open}`,
    mine.status === 200 && (mj.partners?.by_owner || []).every(r => r.owner_user_id === jack.user_id) && (mj.todos?.per_owner || []).every(r => r.owner_user_id === jack.user_id) && mj.employers?.total <= c.employers?.total && mj.waiting?.open === c.waiting?.open);
  // Pulse, scorecard, steps.
  const pulse = await get('/goals/pulse?period=this_week'); const pm = pulse.body?.metrics || {};
  const pulseM = await get('/goals/pulse?period=month'); const pmm = pulseM.body?.metrics || {};
  const email = await get('/goals/pulse?scope=email&period=this_week'); const em = email.body?.metrics || {};
  ok(`real wiring: GET goals/pulse this_week ${pulse.status} (${HOME_TILES.map(k => `${k} ${expected(pm[k] || {})}`).join(' · ')}); month ${pulseM.status}; email ${email.status} (${EMAIL_TILES.map(k => `${k} ${expected(em[k] || {})}`).join(' · ')})`, pulse.status === 200 && pulseM.status === 200 && email.status === 200 && HOME_TILES.every(k => pm[k]) && EMAIL_TILES.every(k => em[k]));
  const sc = await get(`/goals/scorecard?month=${month}`);
  const wk = sc.body?.weeks?.find(w => w.week_start === monday);
  ok(`real wiring: GET goals/scorecard ${sc.status} week of ${monday}: ${ROWS.map(([k, f]) => `${k} ${f(wk?.metrics?.[k]?.value)}`).join(' · ')}`, sc.status === 200 && !!wk);
  const inSeq = wk?.metrics?.total_in_sequence?.value, ft = pm.first_touched;
  results.facts = { in_sequence: inSeq, first_touched: ft?.value, goal: ft?.goal };
  const steps = await get('/goals/sequence-steps'); const seqs = steps.body?.sequences || {};
  const ents = await get('/entities');
  const owned = new Set(((await svc.from('sales_mailbox_owners').select('mailbox_email').eq('business_id', HL)).data || []).map(o => o.mailbox_email));
  const dc = await all('sales_email_daily_counts', 'sequence_id, mailbox', q => q.not('sequence_id', 'is', null)).catch(async () => { const r = await svc.from('sales_email_daily_counts').select('sequence_id, mailbox').eq('business_id', HL).range(0, 9999); return r.data || []; });
  const mailboxesOf = new Map(); for (const r of dc) { if (!mailboxesOf.has(r.sequence_id)) mailboxesOf.set(r.sequence_id, new Set()); mailboxesOf.get(r.sequence_id).add(r.mailbox); }
  const bradViolations = [], expectedOwn = [];
  for (const s of ents.body?.sequences || []) {
    const mbs = [...(mailboxesOf.get(s.id) || [])];
    const shouldOwn = mbs.length > 0 && mbs.every(m => owned.has(m));
    const isOwn = seqs[s.id]?.own === true;
    if (shouldOwn) expectedOwn.push(s.id);
    if (shouldOwn !== isOwn) bradViolations.push(`${s.name.slice(0, 30)}: should ${shouldOwn} got ${isOwn}`);
  }
  const entitiesOnly = (ents.body?.sequences || []).filter(s => !mailboxesOf.has(s.id)).length;
  ok(`Brad exclusion: ${ents.body?.sequences?.length} Apollo sequences, ${expectedOwn.length} with every stored send from a workspace mailbox = the route's own (${Object.values(seqs).filter(s => s.own).length}); ${entitiesOnly} listed with no stored send from a workspace mailbox are not own; ${Object.values(seqs).filter(s => !s.own).length} not own; violations ${bradViolations.length}; no address ${!/@/.test(JSON.stringify(steps.body))}`,
    steps.status === 200 && !bradViolations.length && expectedOwn.length === Object.values(seqs).filter(s => s.own).length && !/@/.test(JSON.stringify(steps.body)), bradViolations.join(' | '));

  browser = await chromium.launch();
  async function open(width, { viewer = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 }, hasTouch: width < 900, acceptDownloads: true });
    await ctx.addInitScript(([k, v, bz, d]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      localStorage.setItem('prospector_goals_owner', 'team');
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, d);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (u.protocol === 'file:' || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      const apiWrite = isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname);
      const allowedWrite = apiWrite && !viewer && ALLOW_WRITES.some(p => u.pathname === p || u.pathname.startsWith(`${p}/`));
      if (apiWrite) (allowedWrite ? allowed : writes).push(`${req.method()} ${u.pathname}`);
      const deny = (apiWrite && !allowedWrite) || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.pathname}`); return route.abort(); }
      if (viewer && isLocal && u.pathname === '/api/me') {
        const r = await route.fetch(); const j = await r.json();
        j.profile = { ...j.profile, is_platform_owner: false };
        j.memberships = (j.memberships || []).map(m => (m.business_id === HL ? { ...m, role: 'viewer' } : m));
        return route.fulfill({ response: r, json: j });
      }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(25000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    await page.goto(`${BASE}/`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 25000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    return { ctx, page, errors };
  }
  const tabs = page => page.locator('#workspace-header-tabs, [data-sales-tabrow]');
  const topTab = async (page, re) => { await tabs(page).getByRole('button', { name: re }).first().dispatchEvent('click'); await page.waitForTimeout(1500); };
  const subTab = async (page, name) => { await page.locator('[data-sales-subviews]').getByRole('tab', { name, exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500); };
  const shot = (page, nme, opts = {}) => page.screenshot({ path: `${OUT}/${nme}.png`, animations: 'disabled', caret: 'hide', fullPage: false, ...opts });
  const axeOn = async (page, key, sel) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async s => { const r = await window.axe.run(document.querySelector(s) || document, { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); }, sel);
    results.axe[key] = v;
    ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v).slice(0, 300));
  };
  const waitHome = async page => { await page.locator('[data-home]').waitFor({ timeout: 30000 }); await page.locator('[data-pulse-tile="sent"]').waitFor({ timeout: 30000 }); await page.locator('[data-donut="employers"], [data-home-cards]:not([data-home-cards="loading"])').first().waitFor({ timeout: 30000 }); await page.locator('[data-explorer="home"] [data-layer-chip]').first().waitFor({ timeout: 30000 }); await page.waitForTimeout(2000); };
  const tileValues = async (page, keys) => { const o = {}; for (const k of keys) o[k] = (await page.locator(`[data-pulse-tile="${k}"] [data-value]`).textContent().catch(() => null))?.trim(); return o; };
  const frameTop = page => page.locator('[data-sales-frame]').evaluate(el => el.getBoundingClientRect().top + window.scrollY);
  // One line = every child's vertical centre within half the tallest child of the first one's (a label and a chip sit on one line at different heights).
  const rowsOf = (page, sel) => page.locator(sel).evaluate(el => { const kids = [...el.children].map(k => k.getBoundingClientRect()); const tall = Math.max(...kids.map(r => r.height)); const c0 = kids[0].top + kids[0].height / 2; const lines = new Set(kids.map(r => Math.round((r.top + r.height / 2 - c0) / Math.max(tall, 1)))); return { rows: lines.size, width: Math.round(el.getBoundingClientRect().width), used: Math.round(kids.reduce((n, r) => n + r.width, 0) + (kids.length - 1) * (parseFloat(getComputedStyle(el).gap) || 0)) }; });
  const cardsOnScreen = async page => page.evaluate(() => {
    const legend = id => [...document.querySelectorAll(`[data-legend="${id}"] [data-legend-row]`)].map(e => [e.dataset.legendRow, Number(e.dataset.count)]);
    const n = sel => { const e = document.querySelector(sel); return e ? Number(e.dataset.total) : null; };
    return {
      employers: { total: n('[data-donut="employers"]'), legend: legend('employers'), zero: document.querySelector('[data-zero-stages]')?.textContent || '' },
      partners: { total: n('[data-donut="partners"]'), legend: legend('partners'), owners: [...document.querySelectorAll('[data-owner-legend] [data-owner]')].map(e => [e.dataset.owner, Number(e.dataset.count)]) },
      owe: [...document.querySelectorAll('[data-owe-row]')].map(e => [e.dataset.oweRow, Number(e.dataset.open), Number(e.dataset.overdue)]),
      waiting: Number(document.querySelector('[data-waiting]')?.dataset.waiting), waitingOverdue: Number(document.querySelector('[data-waiting-overdue]')?.dataset.waitingOverdue), lives: document.querySelector('[data-lives]')?.textContent.replace(/\s+/g, ' ').trim(),
    };
  });
  const cardsMatch = (got, route) => {
    const legendOk = (rows, by) => rows.every(([id, n]) => by.find(s => s.id === id)?.count === n) && rows.length === by.filter(s => s.count > 0).length;
    return got.employers.total === route.employers.total && legendOk(got.employers.legend, route.employers.by_stage)
      && got.partners.total === route.partners.total && legendOk(got.partners.legend, route.partners.by_status)
      && got.partners.owners.every(([id, n]) => route.partners.by_owner.find(r => (r.owner_user_id || 'unassigned') === id)?.count === n) && got.partners.owners.length === route.partners.by_owner.length
      && got.owe.every(([id, open, overdue]) => { const r = route.todos.per_owner.find(x => (x.owner_user_id || 'unassigned') === id); return r && r.open === open && r.overdue === overdue; }) && got.owe.length === route.todos.per_owner.length
      && got.waiting === route.waiting.open && got.waitingOverdue === route.waiting.overdue && got.lives.startsWith(`${fmt(route.lives.value)} lives`);
  };

  // ---- 1440: Home (Member).
  {
    const { ctx, page, errors } = await open(1440);
    await topTab(page, /^Dashboard/);
    await subTab(page, 'Home');
    await waitHome(page);
    const got = await tileValues(page, HOME_TILES);
    const mism = HOME_TILES.filter(k => got[k] !== expected(pm[k])).map(k => `${k}: screen ${got[k]} vs route ${expected(pm[k])}`);
    ok(`1440 Home seven tiles = GET goals/pulse this_week (${HOME_TILES.map(k => `${k} ${got[k]}`).join(' · ')})`, !mism.length, mism.join(' | '));
    const onScreen = await cardsOnScreen(page);
    ok(`1440 Employers donut ${onScreen.employers.total} + legend ${JSON.stringify(onScreen.employers.legend)}; footnote "${onScreen.employers.zero.slice(0, 80)}"; Partners ${onScreen.partners.total} + ${JSON.stringify(onScreen.partners.legend)}; owners ${JSON.stringify(onScreen.partners.owners)}; owe ${JSON.stringify(onScreen.owe)}; waiting ${onScreen.waiting} / ${onScreen.waitingOverdue} overdue; "${onScreen.lives}" = GET goals/dashboard`, cardsMatch(onScreen, c));
    const zeroMain = (c.employers.by_stage || []).filter(s => !s.count && !['lost', 'nurture', 'on_hold'].includes(s.id)).map(s => s.label);
    ok(`1440 the zero stages (${zeroMain.join(' · ')}) are in the footnote, not the legend; legend sorted by count`, zeroMain.every(l => onScreen.employers.zero.includes(l)) && onScreen.employers.legend.every(([, n], i, a) => i === 0 || a[i - 1][1] >= n));
    const ownerLegendText = (await page.locator('[data-owner-legend]').textContent()).replace(/\s+/g, ' ').trim();
    const oweText = (await page.locator('[data-owe-row]').allTextContents()).join(' | ').replace(/\s+/g, ' ');
    ok(`1440 owner legend "${ownerLegendText}" and We owe rows "${oweText.slice(0, 120)}" use first names, never an address`, !/@/.test(ownerLegendText + oweText) && /Jack/.test(ownerLegendText));
    const homeText = (await page.locator('[data-home]').textContent()).replace(/\s+/g, ' ');
    const countOf = s => (s ? homeText.split(s).length - 1 : null);
    const ftStr = ft?.goal != null ? `${fmt(ft.value)}/${fmt(ft.goal)}` : null;
    results.facts.counts = { '2,721': countOf('2,721'), '8/100': countOf('8/100'), in_sequence_now: [fmt(inSeq), countOf(fmt(inSeq))], first_touched_now: [ftStr, countOf(ftStr)] };
    ok(`1440 every fact once: "2,721" ${countOf('2,721')} time(s), "8/100" ${countOf('8/100')}; today's in-sequence ${fmt(inSeq)} appears ${countOf(fmt(inSeq))}, first-touched ${ftStr} appears ${countOf(ftStr)} (each at most once)`, countOf('2,721') <= 1 && countOf('8/100') <= 1 && countOf(fmt(inSeq)) <= 1 && (ftStr == null || countOf(ftStr) === 1));
    const layers = await rowsOf(page, '[data-explorer="home"] [role="group"][aria-label="Layers"]');
    const controls = await rowsOf(page, '[data-explorer="home"] [data-explorer-controls]');
    results.rows = { layers, controls };
    ok(`1440 Explorer layer chips on ${layers.rows} row (${layers.used} of ${layers.width} px); controls on ${controls.rows} row (${controls.used} of ${controls.width} px)`, layers.rows === 1 && controls.rows === 1);
    await shot(page, 'home-1440');
    await shot(page, 'home-1440-full', { fullPage: true });
    await axeOn(page, 'home@1440', '[data-sales-tab], #sales-analytics-root');
    // Period -> Month: N2 0 px, tiles = the month route, the cards keep their digits.
    const y0 = await frameTop(page);
    await page.locator('#sales-frame-tools').getByRole('group', { name: 'Period' }).getByRole('button', { name: 'Month' }).click(); await page.waitForTimeout(3000);
    await page.locator('[data-pulse-tile="sent"]').waitFor({ timeout: 30000 });
    results.n2.period = Math.abs((await frameTop(page)) - y0);
    const gotM = await tileValues(page, HOME_TILES);
    const mismM = HOME_TILES.filter(k => gotM[k] !== expected(pmm[k])).map(k => `${k}: ${gotM[k]} vs ${expected(pmm[k])}`);
    ok(`1440 Month tiles = GET goals/pulse?period=month (${HOME_TILES.map(k => `${k} ${gotM[k]}`).join(' · ')}); N2 ${results.n2.period} px; cards unchanged ${cardsMatch(await cardsOnScreen(page), c)}`, !mismM.length && results.n2.period === 0 && cardsMatch(await cardsOnScreen(page), c));
    // Who -> Jack: the cards re-read for that owner.
    await page.locator('#sales-frame-tools').getByRole('group', { name: 'Filter by person' }).getByRole('button', { name: jack.name.split(' ')[0] }).click(); await page.waitForTimeout(3000);
    await page.locator('[data-home-cards]:not([data-home-cards="loading"])').waitFor({ timeout: 30000 }); await page.waitForTimeout(500);
    const gotJ = await cardsOnScreen(page);
    ok(`1440 Who = ${jack.name.split(' ')[0]}: owners ${JSON.stringify(gotJ.partners.owners)}, owe ${JSON.stringify(gotJ.owe)}, employers ${gotJ.employers.total} = GET goals/dashboard?owner`, cardsMatch(gotJ, mj));
    await shot(page, 'home-1440-jack');
    await page.locator('#sales-frame-tools').getByRole('group', { name: 'Filter by person' }).getByRole('button', { name: 'Team' }).click(); await page.waitForTimeout(2500);
    // Save view (the one write), then delete it.
    const ex = page.locator('[data-explorer="home"]');
    await ex.getByRole('button', { name: 'Save view' }).click();
    await ex.getByRole('textbox', { name: 'View name' }).fill(VIEW_NAME);
    await ex.locator('[data-save-form] button[type="submit"]').click(); await page.waitForTimeout(2500);
    const saved = ((await get('/goals/explorer/views')).body?.views || []).find(v => v.name === VIEW_NAME);
    ok(`Save view wrote one explorer view (${saved ? `kind ${saved.kind}` : 'MISSING'})`, !!saved && saved.kind === 'explorer');
    await ex.getByRole('button', { name: 'Save view' }).click(); await page.waitForTimeout(300);
    await ex.getByRole('button', { name: `Delete view ${VIEW_NAME}` }).click(); await page.waitForTimeout(2000);
    const gone = !((await get('/goals/explorer/views')).body?.views || []).some(v => v.name === VIEW_NAME);
    ok(`the view is deleted again (${gone}); saved_views byte-identical to before: ${(await savedViews()) === viewsBefore}`, gone && (await savedViews()) === viewsBefore);
    ok(`1440 no address anywhere on Home (${!/@/.test(homeText)})`, !/@/.test(homeText));
    // Email.
    await subTab(page, 'Email');
    await page.locator('[data-email-view]').waitFor({ timeout: 30000 }); await page.locator('[data-pulse-tile="sent"]').waitFor({ timeout: 30000 }); await page.locator('[data-sequences]').waitFor({ timeout: 30000 }); await page.waitForTimeout(1500);
    const gotE = await tileValues(page, EMAIL_TILES);
    const mismE = EMAIL_TILES.filter(k => gotE[k] !== expected(em[k])).map(k => `${k}: ${gotE[k]} vs ${expected(em[k])}`);
    const seqHead = (await page.locator('[data-sequences] h2 + span').textContent()).replace(/\s+/g, ' ').trim();
    const seqRows = await page.locator('[data-sequences] tbody tr[data-row]').count();
    const ownRunning = (ents.body?.sequences || []).filter(s => s.active && seqs[s.id]?.own).length;
    ok(`1440 Email tiles = GET goals/pulse?scope=email (${EMAIL_TILES.map(k => `${k} ${gotE[k]}`).join(' · ')}); Sequences "${seqHead.slice(0, 40)}" ${seqRows} rows = own running ${ownRunning} of ${expectedOwn.length}; no widget below (${await page.locator('[id^="sa-widget-pipeline"], [id="sa-widget-kpi_tiles"], [id="sa-widget-companies_by_cohort"]').count()})`, !mismE.length && seqRows === ownRunning && new RegExp(`^${ownRunning} running of ${expectedOwn.length}`).test(seqHead) && (await page.locator('[id^="sa-widget-pipeline"], [id="sa-widget-kpi_tiles"], [id="sa-widget-companies_by_cohort"]').count()) === 0, mismE.join(' | '));
    await shot(page, 'email-1440-full', { fullPage: true });
    await axeOn(page, 'email@1440', '[data-sales-tab], #sales-analytics-root');
    // Scorecard.
    await subTab(page, 'Scorecard');
    await page.locator('[data-scorecard-table]').waitFor({ timeout: 30000 }); await page.waitForTimeout(1500);
    const cellText = k => page.locator(`[data-cell="${k}"] [data-value]`).first().textContent().catch(() => null);
    const mismS = [];
    for (const [k, f] of ROWS) { const w = f(wk?.metrics?.[k]?.value), m = f(sc.body?.month_total?.[k]?.value); const gw = await cellText(`${k}|${monday}`), gm = await cellText(`${k}|month`); if (!gw?.startsWith(w) || !gm?.startsWith(m)) mismS.push(`${k}: screen ${gw} / ${gm} vs route ${w} / ${m}`); }
    ok(`1440 Scorecard every cell = GET goals/scorecard for the week of ${monday} and the month`, !mismS.length, mismS.join(' | '));
    await shot(page, 'scorecard-1440-full', { fullPage: true });
    await axeOn(page, 'scorecard@1440', '[data-sales-tab], #sales-analytics-root');
    // Sources.
    await subTab(page, 'Sources');
    await page.locator('[data-sources-view]').waitFor({ timeout: 30000 }); await page.waitForTimeout(1500);
    ok(`1440 Sources renders (${await page.locator('[data-sources-table] tbody tr').count()} rows)`, (await page.locator('[data-sources-view]').count()) === 1);
    await shot(page, 'sources-1440-full', { fullPage: true });
    await axeOn(page, 'sources@1440', '[data-sales-tab], #sales-analytics-root');
    ok('1440 0 page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- 390: every sub-view.
  {
    const { ctx, page, errors } = await open(390);
    await topTab(page, /^Dashboard/);
    const noSideways = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    await subTab(page, 'Home'); await waitHome(page);
    const cols = await page.locator('[data-home-cards]').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    ok(`390 Home: ${await page.locator('[data-pulse-tile]').count()} tiles, cards stacked (${cols} column), no sideways scroll ${await noSideways()}, cards = route ${cardsMatch(await cardsOnScreen(page), c)}`, cols === 1 && (await noSideways()) && cardsMatch(await cardsOnScreen(page), c));
    await shot(page, 'home-390', { fullPage: true });
    await axeOn(page, 'home@390', '[data-sales-tab], #sales-analytics-root');
    await subTab(page, 'Email'); await page.locator('[data-pulse-tile="sent"]').waitFor({ timeout: 30000 }); await page.locator('[data-sequences]').waitFor({ timeout: 30000 }); await page.waitForTimeout(1200);
    ok(`390 Email: no sideways scroll ${await noSideways()}`, await noSideways());
    await shot(page, 'email-390', { fullPage: true });
    await axeOn(page, 'email@390', '[data-sales-tab], #sales-analytics-root');
    await subTab(page, 'Scorecard'); await page.locator('[data-scorecard]').first().waitFor({ timeout: 30000 }); await page.waitForTimeout(1200);
    ok(`390 Scorecard: ${await page.locator('[data-tile]').count()} metric tiles, no table (${await page.locator('[data-scorecard-table]').count()}), no sideways scroll ${await noSideways()}`, (await page.locator('[data-tile]').count()) === 8 && (await page.locator('[data-scorecard-table]').count()) === 0 && (await noSideways()));
    await shot(page, 'scorecard-390', { fullPage: true });
    await axeOn(page, 'scorecard@390', '[data-sales-tab], #sales-analytics-root');
    await subTab(page, 'Sources'); await page.locator('[data-sources-view]').waitFor({ timeout: 30000 }); await page.waitForTimeout(1200);
    ok(`390 Sources: no sideways scroll ${await noSideways()}`, await noSideways());
    await shot(page, 'sources-390', { fullPage: true });
    await axeOn(page, 'sources@390', '[data-sales-tab], #sales-analytics-root');
    ok('390 0 page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- Viewer.
  {
    const { ctx, page, errors } = await open(1440, { viewer: true });
    await topTab(page, /^Dashboard/);
    await subTab(page, 'Home'); await waitHome(page);
    const ex = page.locator('[data-explorer="home"]');
    const save = await ex.getByRole('button', { name: 'Save view' }).count(), share = await ex.getByRole('button', { name: 'Share' }).count();
    const cardButtons = await page.locator('[data-home-cards] button').allTextContents();
    const inputs = await page.locator('[data-home] input, [data-home] textarea, [data-home] select').count();
    ok(`Viewer Home: Save view ${save}, Share ${share}, card buttons ${JSON.stringify(cardButtons)} (the two links only), inputs ${inputs}, cards = route ${cardsMatch(await cardsOnScreen(page), c)}`, save === 0 && share === 0 && cardButtons.map(t => t.trim()).join('|') === 'Map →|Actions →' && inputs === 0 && cardsMatch(await cardsOnScreen(page), c));
    await shot(page, 'home-viewer-1440');
    await subTab(page, 'Email'); await page.locator('[data-pulse-tile="sent"]').waitFor({ timeout: 30000 }); await page.locator('[data-sequences]').waitFor({ timeout: 30000 }); await page.waitForTimeout(1200);
    const sync = await page.locator('#sales-frame-tools').getByRole('button', { name: 'Sync now' }).count();
    const dismiss = await page.getByRole('button', { name: 'Dismiss 7 d' }).count();
    ok(`Viewer Email: Sync now ${sync}, Dismiss ${dismiss}`, sync === 0 && dismiss === 0);
    await subTab(page, 'Scorecard'); await page.locator('[data-scorecard-table]').waitFor({ timeout: 30000 }); await page.waitForTimeout(1200);
    const setGoals = await page.locator('#sales-frame-tools').getByRole('button', { name: /Set \w+ goals/ }).count();
    const goalInputs = await page.locator('[data-scorecard-table] input').count();
    ok(`Viewer Scorecard: Set goals ${setGoals}, inputs ${goalInputs}; 0 page errors`, setGoals === 0 && goalInputs === 0 && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- Side-by-side: mockup (file://) | prod build, 1440.
  {
    const width = 1440;
    const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await ctx.newPage();
    await page.goto(`file://${MOCK}`); await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/mockup-1440.png`, fullPage: true });
    const compose = await ctx.newPage();
    const b64 = f => fs.readFileSync(path.join(OUT, f)).toString('base64');
    await compose.setViewportSize({ width: width * 2 + 48, height: 200 });
    await compose.setContent(`<body style="margin:0;background:#000;color:#fff;font:12px monospace"><div style="display:flex;gap:16px;padding:16px;align-items:flex-start"><figure style="margin:0"><figcaption style="padding:4px 0">mockup · Dash.dc.html · 1440</figcaption><img src="data:image/png;base64,${b64('mockup-1440.png')}" style="width:${width}px;display:block"></figure><figure style="margin:0"><figcaption style="padding:4px 0">prod build · HEAD · 1440 (full page)</figcaption><img src="data:image/png;base64,${b64('home-1440-full.png')}" style="width:${width}px;display:block"></figure></div></body>`);
    await compose.waitForTimeout(500);
    await compose.screenshot({ path: `${OUT}/side-by-side-1440.png`, fullPage: true });
    ok('side-by-side-1440.png written (mockup | prod)', true);
    await ctx.close();
  }
  ok(`browser reached 0 Claude / Apollo hosts; writes allowed: ${[...new Set(allowed)].join(', ') || 'none'}; every other non-GET aborted (${[...new Set(writes)].join(', ') || 'none attempted'})`, !realCalls.length && writes.every(w => blocked.includes(w)) && allowed.every(a => /goals\/explorer\/views/.test(a)));
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    const after = await snapshot();
    const moved = TABLES.filter(t => before[t] !== after[t]).map(t => `${t} ${before[t]} -> ${after[t]}`);
    if (moved.length) throw new Error(`counts moved: ${moved.join(', ')}`);
    const viewsAfter = await savedViews();
    if (viewsAfter !== viewsBefore) throw new Error('sales_settings.saved_views differs from before');
    restored = true; line = `yes (${TABLES.length} table counts identical, saved_views byte-identical; Jack sign-in row kept by rule, last_seen_at restored)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'stage5-report.json'), JSON.stringify({ ...results, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\ndashboard-v3 Stage 5 live check: ${passed}/${results.checks.length} passed · Claude 0 · Apollo ${realCalls.length} · writes ${allowed.length} (Save view + its delete) · ${Math.round((Date.now() - T0) / 1000)} s`);
  console.log(`facts: ${JSON.stringify(results.facts)}; rows: ${JSON.stringify(results.rows)}`);
  console.log(`files: ${fs.readdirSync(OUT).join(', ')}`);
  console.log(`restored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
