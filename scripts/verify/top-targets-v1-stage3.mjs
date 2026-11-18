// top-targets-v1 Stage 3 live check - localhost against the build, as Jack (ownerSession) on the REAL HomeLover
// workspace. Two runs, each under the 4-minute cap. Apollo 0 in both (the key is removed from the server's
// environment; the browser's calls to either host are aborted).
// DECLARED before it runs:
//   default (run A)  1 page load (1440), ~8 route GETs + the page's reloads, 4 table reads of < 2k rows each.
//     Claude  ONE real ask through POST /api/scout/ask ("what are Cyrus's top 5"), cap 1. The reply is cached in
//             .screenshots/top-targets-v1/stage3-ledger.json with a spent counter: a re-run answers from the cache
//             (0 Claude) and the script REFUSES a call that would pass the cap. 1 usage row (kept).
//     Writes  ONE real employer (Jack's, never pinned, chosen from the route's Mine rows; named in the report), all
//             through the page's star: Pin + Undo · Pin · Edit reason + Undo · Renew + Undo · Unpin + Undo · Unpin =
//             6 POST goals/company/employer/:id/pin + 4 POST goals/flow/:id/undo. That is 10 updates of that one
//             row's pin columns (+ is_top) and 10 sales_flow_events rows, which STAY (the event log is the history).
//             Each pin write schedules the product's own score recompute (sales_company_scores + today's
//             sales_company_score_days rows for the workspace, the same run a page load does every 24 h); the run
//             waits for the last one, so the company's stored score ends unpinned. The row's four pin columns,
//             is_top, the priority columns and updated_at are snapshotted first; updated_at is put back exactly.
//     ~170 s, cap 235 s.
//   --ui (run B)  6 page loads (Top targets 1440 with a fixture reply, 1440 real, Viewer 1440, 390, the Map 1440 /
//     390), ~4 route GETs, 2 table reads. 0 Claude (the key is removed too).
//     Writes  the SAME employer through the company window's star: Top (pin, no reason) then Top again (unpin) =
//             2 POST …/pin, 2 sales_flow_events rows (kept), 2 recomputes; same snapshot + exact restore.
//     Fixture the expired-pin path, because no pin on the book has run out: (1) the real writer (applyPin / undoFlow)
//             on an in-memory copy of that employer with its pin dated in the past - nothing live is read or written
//             by it; (2) the page with that row's reply rewritten in the browser to an expired pin - every write
//             from that page is aborted.
//     Viewer  no user is created: /api/me is rewritten to role viewer in the browser; the write gate is the real
//             salesGate called in process with a Viewer's roles.
//     ~170 s, cap 235 s.
// Every other non-GET call is aborted in the browser and counted.
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
const UI = process.argv.includes('--ui');
const OUT = path.join(ROOT, '.screenshots', 'top-targets-v1');
const PORT = 3995, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0], SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const CLAUDE_CAP = 1, ASK = "what are Cyrus's top 5";
const LEDGER = path.join(OUT, 'stage3-ledger.json');
fs.mkdirSync(OUT, { recursive: true });
const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : { spent: 0, asks: {} };
const saveLedger = () => fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now(), startIso = new Date().toISOString();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data?.[0]?.id;
if (!HL) throw new Error('no HomeLover business');
const nowLocal = new Date();
const minsToSix = ((6 - (nowLocal.getHours() % 6)) % 6) * 60 - nowLocal.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (nowLocal.getHours() % 6 === 0 && nowLocal.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const TABLES = ['sales_opportunities', 'sales_targets', 'sales_goals', 'sales_partner_events', 'sales_week_goals', 'sales_company_scores', 'sales_flow_events'];
async function count(t) { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL); return r.error ? `n/a (${r.error.message.slice(0, 40)})` : r.count; }
const snapshot = async () => { const o = {}; for (const t of TABLES) o[t] = await count(t); return o; };
const usageCount = async () => (await svc.from('business_anthropic_usage').select('*', { count: 'exact', head: true }).gte('created_at', startIso)).count;
const all = async (t, cols, build = x => x, by = 'id') => { const out = []; for (let from = 0; ; from += 1000) { const r = await build(svc.from(t).select(cols).eq('business_id', HL)).order(by).range(from, from + 999); if (r.error) throw new Error(`${t}: ${r.error.message}`); out.push(...r.data); if (r.data.length < 1000) break; } return out; };
const results = { checks: [], errors: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 500)}` : ''); };
const blocked = [], realCalls = [], writes = [];
let claudeThisRun = 0;

// ---- the ONE employer and its snapshot
const SNAP_COLS = 'id, organization, pinned_until, pin_reason, pinned_by, pinned_at, is_top, priority, priority_set_at, priority_set_by, updated_at';
const PIN_KEYS = ['pinned_until', 'pin_reason', 'pinned_by', 'pinned_at', 'is_top', 'priority', 'priority_set_at', 'priority_set_by'];
let target = null, snap = null, scoreBefore = null, lastWriteAt = null;
const readTarget = async () => (await svc.from('sales_opportunities').select(SNAP_COLS).eq('business_id', HL).eq('id', target.id).single()).data;
const readScore = async () => (await svc.from('sales_company_scores').select('score, band, override, computed_at').eq('business_id', HL).eq('company_type', 'employer').eq('company_id', target.id).maybeSingle()).data;
const same = (a, b) => PIN_KEYS.every(k => String(a?.[k] ?? '') === String(b?.[k] ?? ''));
const PIN_URL = new RegExp(`^/api/sales/${HL}/goals/company/employer/([^/]+)/pin$`), UNDO_URL = new RegExp(`^/api/sales/${HL}/goals/flow/[^/]+/undo$`);

let srv, browser, owner;
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  // the last recompute must land while the server is still up, so the stored score ends unpinned
  if (target && lastWriteAt) {
    let s = null;
    const landed = () => s && Date.parse(s.computed_at) > Date.parse(lastWriteAt) && !s.override;
    for (let i = 0; i < 45; i++) { s = await readScore(); if (landed()) break; await new Promise(r => setTimeout(r, 1500)); }
    if (!landed()) {
      const { recomputeScores } = await import('../../api/sales/intentScoreRun.js');
      await recomputeScores(svc, { businessId: HL, trigger: 'manual', only: { type: 'employer', id: target.id } });
      log('safety net: the last recompute had not landed - re-scored the one company with the real runner');
    }
  }
  if (srv) srv.kill(); srv = null;
  if (target && snap) {
    const cur = await readTarget();
    if (!same(cur, snap)) { await svc.from('sales_opportunities').update(Object.fromEntries(PIN_KEYS.map(k => [k, snap[k]]))).eq('business_id', HL).eq('id', target.id); log(`safety net: PUT BACK ${target.name}'s pin columns by id (they differed from the snapshot)`); results.put_back = true; }
    if (lastWriteAt || !same(cur, snap)) await svc.from('sales_opportunities').update({ updated_at: snap.updated_at }).eq('business_id', HL).eq('id', target.id);
  }
  if (owner) { log(await owner.release()); owner = null; }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 235000 });
const before = await snapshot(), usageBefore = await usageCount();
log('before', JSON.stringify(before), `· Claude spent so far ${ledger.spent}/${CLAUDE_CAP}`);

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', APOLLO_API_KEY: '', ...(UI ? { ANTHROPIC_API_KEY: '' } : {}) }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const get = async p => { const r = await fetch(`${BASE}/api/sales/${HL}${p}`, { headers: { cookie } }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const members = (await get('/goals/members')).body?.members || [];
  const cyrus = members.find(m => /^cyrus\b/i.test(m.name || ''));
  if (!cyrus) throw new Error('no member named Cyrus');
  browser = await chromium.launch();

  // fixture(row) -> row rewrites one row of the goals/top-targets reply in the browser (the expired-pin page)
  async function openView(width, tabName, ready, { viewer = false, height = null, allowPin = false, allowAsk = false, fixture = null } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: height || (width < 900 ? 844 : 1000) }, hasTouch: width < 900 });
    await ctx.addInitScript(([k, v, bz, dd, uid]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      localStorage.setItem('prospector_goals_owner', 'team'); localStorage.setItem('prospector_scout_scope', JSON.stringify({ [uid]: bz }));
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, dd);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today, owner.userId]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (u.protocol === 'file:' || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      if (allowAsk && isLocal && req.method() === 'POST' && u.pathname === '/api/scout/ask') {
        const body = JSON.parse(req.postData() || '{}');
        if (ledger.asks[body.q]) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ledger.asks[body.q].body) });
        if (body.q !== ASK || body.scope !== HL || ledger.spent >= CLAUDE_CAP) { blocked.push(`POST /api/scout/ask (${body.q !== ASK ? 'not the declared ask' : body.scope !== HL ? `scope ${body.scope}` : 'would pass the cap'})`); return route.abort(); }
        ledger.spent += 1; claudeThisRun += 1; saveLedger();
        return route.continue();
      }
      const apiWrite = isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname);
      const pinId = PIN_URL.exec(u.pathname)?.[1];
      const declared = apiWrite && allowPin && !viewer && !fixture && req.method() === 'POST' && target && ((pinId && pinId === target.id) || UNDO_URL.test(u.pathname));
      if (apiWrite) writes.push(`${req.method()} ${u.pathname.replace(HL, ':b').replace(/employer\/[^/]+\/pin/, 'employer/:id/pin').replace(/flow\/[^/]+\/undo/, 'flow/:id/undo')}${declared ? '' : ` (aborted${pinId ? `, would send ${req.postData()}` : ''})`}`);
      if (declared) { lastWriteAt = new Date().toISOString(); return route.continue(); }
      const deny = apiWrite || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.pathname.replace(HL, ':b')}`); return route.abort(); }
      if (viewer && isLocal && u.pathname === '/api/me') {
        const r = await route.fetch(); const j = await r.json();
        j.profile = { ...j.profile, is_platform_owner: false };
        j.memberships = (j.memberships || []).map(m => (m.business_id === HL ? { ...m, role: 'viewer' } : m));
        return route.fulfill({ response: r, json: j });
      }
      if (fixture && isLocal && req.method() === 'GET' && u.pathname === `/api/sales/${HL}/goals/top-targets`) {
        const r = await route.fetch(); const j = await r.json();
        j.rows = (j.rows || []).map(fixture);
        return route.fulfill({ response: r, json: j });
      }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(25000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    await page.goto(`${BASE}/?tab=pipeline&view=companies`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 25000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: /^Pipeline/ }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
    await page.locator('[data-sales-subviews]').getByRole('tab', { name: tabName, exact: true }).dispatchEvent('click'); await page.waitForTimeout(1500);
    await page.locator(ready).first().waitFor({ timeout: 30000 }); await page.waitForTimeout(2000);
    return { ctx, page, errors };
  }
  const n2 = page => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
  const axeOn = async (page, key, sel) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async s => { if (!document.querySelector(s)) return [{ id: `no ${s} on the page`, nodes: 0, targets: [] }]; const r = await window.axe.run(document.querySelector(s), { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); }, sel);
    ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v));
  };
  const TT_READY = '[data-top-targets] [data-row]', MAP_READY = '[data-priorities] [data-dot], [data-priorities] [data-row]';

  // ---- the route (three scopes) and the raw tables behind it
  const scopes = { Mine: await get('/goals/top-targets?owner=me&limit=1000'), Cyrus: await get(`/goals/top-targets?owner=${cyrus.user_id}&limit=1000`), Team: await get('/goals/top-targets?limit=1000') };
  const mine = scopes.Mine.body, team = scopes.Team.body;
  const [scoreRows, partners, employers, targets] = [
    (await all('sales_company_scores', 'company_id, company_type, score, band, closed, flagged_out, duplicate_of', x => x.order('company_type'), 'company_id')).map(s => ({ ...s, id: s.company_id })),
    await all('sales_goals', 'id, owner_user_id, pinned_until, pinned_at, pin_reason, priority, priority_set_at', x => x.eq('goal_type', 'partnership')),
    await all('sales_opportunities', 'id, owner_user_id, pinned_until, pinned_at, pin_reason, priority, priority_set_at, is_top, organization'),
    await all('sales_targets', 'id, owner_user_id, pinned_until, pinned_at, pin_reason'),
  ];
  const rec = new Map([...partners.map(r => [`partner-${r.id}`, r]), ...employers.map(r => [`employer-${r.id}`, r]), ...targets.map(r => [`target-${r.id}`, r])]);
  const rawOpen = scoreRows.filter(s => !s.closed && !s.flagged_out && !s.duplicate_of).map(s => ({ key: `${s.company_type}-${s.id}`, score: s.score, band: s.band, row: rec.get(`${s.company_type}-${s.id}`) || null }));
  const rawBy = new Map(rawOpen.map(r => [r.key, r]));
  const t = v => (v ? Date.parse(v) : null);
  const livePin = row => !!row?.pinned_until && t(row.pinned_until) > Date.now();
  const lifts = row => livePin(row) && !(row.priority != null && row.priority_set_at && t(row.priority_set_at) === t(row.pinned_at) && Number(row.priority) > 1);
  if (!UI) {
    for (const [label, ownerId] of [['Mine', owner.userId], ['Cyrus', cyrus.user_id], ['Team', null]]) {
      const b = scopes[label].body, want = rawOpen.filter(r => !ownerId || (r.row?.owner_user_id || null) === ownerId);
      const wantKeys = new Set(want.map(r => r.key)), got = b.rows;
      const missing = got.filter(r => !wantKeys.has(r.key)).length + want.filter(r => !got.some(g => g.key === r.key)).length;
      const wrong = got.filter(r => { const w = rawBy.get(r.key); return !w || w.score !== r.score || w.band !== r.band || (w.row?.owner_user_id || null) !== (r.owner_user_id || null) || livePin(w.row) !== !!r.pin || (r.pin && (r.pin.reason || null) !== (w.row.pin_reason || null)); });
      // the order, re-derived from the raw rows: lifting pins first (newest pin first), then score
      const ordered = got.every((r, i) => { if (!i) return true; const a = rawBy.get(got[i - 1].key), c = rawBy.get(r.key); if (!a || !c) return false; const pa = lifts(a.row), pc = lifts(c.row); return pa === pc ? (pa ? t(a.row.pinned_at) >= t(c.row.pinned_at) : a.score >= c.score) : pa; });
      const rawPinned = want.filter(r => livePin(r.row)).length;
      ok(`route vs raw · ${label}: route ${b.total} rows (${b.pinned} pinned) = raw ${want.length} open companies (${rawPinned} with a live pin); ${missing} keys differ; score / band / owner / pin differ on ${wrong.length}; order = pins first then score: ${ordered}`, scopes[label].status === 200 && b.total === want.length && b.pinned === rawPinned && !missing && !wrong.length && ordered, wrong.slice(0, 3).map(r => r.name).join(', '));
    }
    ok(`chip counts on the route = raw owners: Mine ${mine.counts.owners[owner.userId] || 0} · Cyrus ${mine.counts.owners[cyrus.user_id] || 0} · Team ${mine.book}`, (mine.counts.owners[owner.userId] || 0) === scopes.Mine.body.scope && (mine.counts.owners[cyrus.user_id] || 0) === scopes.Cyrus.body.scope && mine.book === rawOpen.length);
  }
  const expiredLive = team.rows.filter(r => r.pin_expired).length;
  log(`team: ${team.rows.filter(r => r.pin).length} live pins, ${expiredLive} expired pins on the book${expiredLive ? '' : ' (so the expired path runs on a fixture)'}`);

  // ---- the ONE employer: Jack's, never pinned, a unique name, the lowest-ranked such row in Mine
  const cands = mine.rows.filter(r => r.type === 'employer' && !r.pin && !r.pin_expired && team.rows.filter(x => x.name === r.name).length === 1).filter(r => { const w = rec.get(r.key); return w && !w.pinned_until && !w.pinned_at && !w.pin_reason && !w.is_top && w.priority == null; });
  target = cands.at(-1) || null;
  if (!target) throw new Error('no never-pinned employer of Jack\'s to pin');
  snap = await readTarget(); scoreBefore = await readScore();
  const rowNow = async () => { const r = await readTarget(); return { until: r.pinned_until, reason: r.pin_reason, by: r.pinned_by, at: r.pinned_at, is_top: r.is_top }; };
  log(`the one company: ${target.name} (employer, rank ${target.rank} of ${mine.total} in Mine, score ${target.score} ${target.band}) · pin columns all empty, is_top false · stored score ${scoreBefore?.score} ${scoreBefore?.band}`);

  if (!UI) await runA(); else await runB();
  ok(`browser calls to Claude / Apollo hosts: ${realCalls.length}; Claude asks made this run: ${claudeThisRun} (spent ${ledger.spent} of cap ${CLAUDE_CAP})`, realCalls.length === 0 && ledger.spent <= CLAUDE_CAP);

  // ================= run A: the Scout ask, then the pin cycle from the star
  async function runA() {
    const { ctx, page, errors } = await openView(1440, 'Top targets', TT_READY, { height: 1260, allowPin: true, allowAsk: true });
    const reloaded = () => page.waitForResponse(r => new URL(r.url()).pathname === `/api/sales/${HL}/goals/top-targets` && r.request().method() === 'GET', { timeout: 20000 });
    const keysOnPage = () => page.evaluate(() => [...document.querySelectorAll('[data-top-targets] tr[data-row]')].map(r => r.getAttribute('data-row')));
    const namesOnPage = () => page.evaluate(() => [...document.querySelectorAll('[data-top-targets] tr[data-row] [data-row-name]')].map(r => r.textContent));

    // ---- the Cyrus chip, then the one ask
    { const p = reloaded(); await page.locator(`[data-owner-chip="${cyrus.user_id}"]`).click(); await p; await page.waitForTimeout(800); }
    const chipKeys = await keysOnPage(), chipNames = (await namesOnPage()).slice(0, 5);
    const routeTop5 = (await get(`/goals/top-targets?owner=${cyrus.user_id}&limit=5`)).body.rows;
    ok(`Cyrus chip: ${chipKeys.length} rows = the route's Cyrus (${scopes.Cyrus.body.rows.length}), same order; its first five: ${chipNames.join(' · ')}`, chipKeys.join() === scopes.Cyrus.body.rows.map(r => r.key).join() && chipNames.join('|') === routeTop5.map(r => r.name).join('|'));
    const cached = !!ledger.asks[ASK];
    const bar = page.locator('.scout-bar input').first();
    await bar.click(); await bar.fill(ASK); await page.waitForTimeout(1500);
    const tAsk = Date.now();
    const respP = page.waitForResponse(r => r.url().endsWith('/api/scout/ask') && r.request().method() === 'POST', { timeout: 60000 });
    await page.keyboard.press('Enter');
    const body = await (await respP).json().catch(() => ({}));
    await page.locator('[data-scout-answer], [data-scout-edge]').first().waitFor({ timeout: 15000 }); await page.waitForTimeout(600);
    if (!cached && body.answer_md) {
      const usage = (await svc.from('business_anthropic_usage').select('input_tokens, output_tokens, cost_usd, model').eq('call_type', 'scout_ask').eq('user_id', owner.userId).gte('created_at', startIso).order('created_at', { ascending: false }).limit(1)).data?.[0] || null;
      ledger.asks[ASK] = { body, usage, elapsed: Math.round((Date.now() - tAsk) / 100) / 10, at: new Date().toISOString(), page_top5: chipNames }; saveLedger();
    }
    const entry = ledger.asks[ASK] || { body };
    const scoutNames = (body.sections || []).flatMap(s => s.rows || []).map(r => r.title);
    const shown = await page.evaluate(() => [...document.querySelectorAll('[data-scout-answer] [data-scout-row]')].map(r => r.textContent.replace(/\s+/g, ' ').trim().slice(0, 60)));
    await page.screenshot({ path: `${OUT}/stage3-scout-cyrus-top5-1440.png`, animations: 'disabled', timeout: 8000 }).catch(() => {});
    // a cached reply is compared with the five the page showed when the ask was made
    const pageFive = cached ? entry.page_top5 || chipNames : chipNames;
    ok(`Scout "${ASK}"${cached ? ' (from the cache, 0 Claude)' : ''}: read ${body.context_stats?.intent || body.sections?.[0]?.read || '?'} · answers ${scoutNames.join(' · ') || '(no rows)'} = the page's Cyrus chip, first five, same order (${pageFive.join(' · ')}); ${shown.length} rows drawn; ${entry.usage ? `${entry.usage.input_tokens} in / ${entry.usage.output_tokens} out · $${Number(entry.usage.cost_usd).toFixed(4)} · ${entry.usage.model} · ${entry.elapsed} s` : 'no usage row found'}`, scoutNames.length === 5 && scoutNames.join('|') === pageFive.join('|'), (body.answer_md || JSON.stringify(body)).slice(0, 400));
    await page.keyboard.press('Escape'); await page.waitForTimeout(300); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    { const p = reloaded(); await page.locator('[data-owner-chip="me"]').click(); await p; await page.waitForTimeout(800); }

    // ---- the pin cycle, all from the star on Top targets (Mine)
    const rowSel = `[data-top-targets] tr[data-row="${target.key}"]`;
    const R1 = 'Stage 3 live check - unpinned again within the minute', R2 = 'Stage 3 live check - edited reason';
    const write = async (re, click) => { const w = page.waitForResponse(r => re.test(new URL(r.url()).pathname) && r.request().method() === 'POST', { timeout: 20000 }), g = reloaded(); await click(); const status = (await w).status(); await g.catch(() => {}); await page.waitForTimeout(700); return status; };
    const openStar = async () => { await page.locator(rowSel).scrollIntoViewIfNeeded(); await page.locator(`${rowSel} [data-star]`).click(); await page.waitForTimeout(300); };
    const pin = reason => write(PIN_URL, async () => { await openStar(); await page.locator('[data-pin-pop="form"] textarea').fill(reason); await page.locator('[data-pin-pop="form"] button[type=submit]').click(); });
    const menuPick = name => write(PIN_URL, async () => { await openStar(); await page.locator('[data-pin-pop="menu"]').getByRole('menuitem', { name }).click(); });
    const undo = () => write(UNDO_URL, () => page.getByRole('status').getByRole('button', { name: 'Undo' }).click());
    const line = () => page.locator(`${rowSel} [data-pin-line]`).textContent().catch(() => null);
    const first = async () => (await keysOnPage())[0];
    const original = async () => same(await readTarget(), snap);

    const p1 = await pin(R1); const a1 = await rowNow(), top1 = (await first()) === target.key, line1 = await line();
    await page.screenshot({ path: `${OUT}/stage3-pinned-top-1440.png`, animations: 'disabled' });
    const u1 = await undo();
    ok(`Pin from the star: ${p1} -> first row of Mine: ${top1}, the row reads "${line1}", the database: until ${a1.until?.slice(0, 10)}, reason kept, by Jack ${a1.by === owner.userId}, is_top ${a1.is_top}; Undo ${u1} -> the row's star is "${await page.locator(`${rowSel} [data-star]`).getAttribute('data-star')}", the database = the snapshot: ${await original()}`, p1 === 200 && top1 && /^Pinned · 30 d left · /.test(line1 || '') && line1.includes(R1) && a1.reason === R1 && a1.by === owner.userId && a1.is_top === true && Math.abs(Date.parse(a1.until) - Date.now() - 30 * 864e5) < 120e3 && u1 === 200 && await original());

    const p2 = await pin(R1); const b0 = await rowNow();
    ok(`Pin again: ${p2} -> first row of Mine: ${(await first()) === target.key} of ${(await keysOnPage()).length} rows`, p2 === 200 && (await first()) === target.key && b0.reason === R1);
    const e1 = await write(PIN_URL, async () => { await openStar(); await page.locator('[data-pin-pop="menu"]').getByRole('menuitem', { name: 'Edit reason' }).click(); await page.locator('[data-pin-pop="edit"] textarea').fill(R2); await page.locator('[data-pin-pop="edit"] button[type=submit]').click(); });
    const b1 = await rowNow(), line2 = await line(); const ue = await undo(); const b2 = await rowNow();
    ok(`Edit reason: ${e1} -> the row reads "${line2}", the dates untouched: ${b1.until === b0.until && b1.at === b0.at}; Undo ${ue} -> the reason is the first one again: ${b2.reason === R1}`, e1 === 200 && b1.reason === R2 && (line2 || '').includes(R2) && b1.until === b0.until && b1.at === b0.at && ue === 200 && b2.reason === R1 && b2.until === b0.until);
    await page.waitForTimeout(1200);
    const r1 = await menuPick(/^Renew/); const c1 = await rowNow(); const ur = await undo(); const c2 = await rowNow();
    ok(`Renew: ${r1} -> until moved ${Math.round((Date.parse(c1.until) - Date.parse(b0.until)) / 1000)} s later (a fresh 30 days), reason and pin date kept: ${c1.reason === R1 && c1.at === b0.at}; Undo ${ur} -> until back: ${c2.until === b0.until}`, r1 === 200 && Date.parse(c1.until) > Date.parse(b0.until) && c1.reason === R1 && c1.at === b0.at && ur === 200 && c2.until === b0.until);
    const x1 = await menuPick('Unpin'); const d1 = await original(), starOff = await page.locator(`${rowSel} [data-star]`).getAttribute('data-star'); const ux = await undo(); const d2 = await rowNow();
    ok(`Unpin: ${x1} -> the database = the snapshot: ${d1}, the star is "${starOff}"; Undo ${ux} -> pinned again with all four fields (until, reason, by, date): ${d2.until === b0.until && d2.reason === R1 && d2.by === b0.by && d2.at === b0.at}, first row: ${(await first()) === target.key}`, x1 === 200 && d1 && starOff === 'none' && ux === 200 && d2.until === b0.until && d2.reason === R1 && d2.by === b0.by && d2.at === b0.at && d2.is_top === true && (await first()) === target.key);
    const xf = await menuPick('Unpin');
    const keysEnd = await keysOnPage(), endRows = (await get('/goals/top-targets?owner=me&limit=1000')).body.rows, ei = endRows.findIndex(r => r.key === target.key), er = endRows[ei];
    const inPlace = ei > 0 && !er.pin && !er.pin_expired && (endRows[ei - 1].score >= er.score || (endRows[ei - 1].pin && !endRows[ei - 1].pin.held)) && (ei === endRows.length - 1 || endRows[ei + 1].score <= er.score);
    ok(`Unpin (the last write): ${xf} -> the database = the snapshot: ${await original()}; ${target.name} is row ${keysEnd.indexOf(target.key) + 1} of ${keysEnd.length} on the page = row ${ei + 1} on the route, ranked by its score again (it was row ${target.rank} before the run)`, xf === 200 && await original() && inPlace && keysEnd.indexOf(target.key) === ei);

    const events = (await svc.from('sales_flow_events').select('kind, text, undone_at, at').eq('business_id', HL).eq('record_id', target.id).gte('at', startIso).order('at')).data || [];
    log(`events for ${target.name} (kept): ${events.map(e => `${e.kind}${e.kind === 'undo' ? '' : e.undone_at ? ' (undone)' : ' (stands)'} "${e.text.slice(0, 44)}"`).join(' · ')}`);
    const kinds = events.map(e => `${e.kind}${e.kind !== 'undo' && e.undone_at ? '*' : ''}`).join(',');
    ok(`events: ${events.length} rows in order (* = undone): ${kinds}`, kinds === 'pin*,undo,pin,pin_renew*,undo,pin_renew*,undo,unpin*,undo,unpin');
    await axeOn(page, 'top-targets@1440 after the cycle', '[data-top-targets]');
    ok(`1440: N2 ${await n2(page)} px; page errors ${errors.length}`, (await n2(page)) === 0 && errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ================= run B: the expired path on a fixture, the window's star, Viewer, 390, the Map
  async function runB() {
    if (!process.argv.includes('--map-only')) await runBWrites();
    await runBMap();
  }
  async function runBWrites() {
    // (1) the real writer on an in-memory copy of the employer, its pin dated in the past
    {
      const { fakeSupabase } = await import('../../api/sales/testing/fakeSupabase.mjs');
      const { applyPin } = await import('../../api/sales/pinWrite.js');
      const { undoFlow } = await import('../../api/sales/flowEvents.js');
      const { starOf, pinState, PIN_DAYS } = await import('../../api/sales/pinState.js');
      const { pinFirst } = await import('../../api/sales/topTargets.js');
      const DAY = 864e5, REASON = 'Fixture: asked for a January start';
      const stamp = d => `${new Date(Date.now() + d * DAY).toISOString().slice(0, 19)}+00:00`;
      const past = { pinned_until: stamp(-3), pinned_at: stamp(-33), pinned_by: owner.userId, pin_reason: REASON };
      const sb = fakeSupabase({ sales_opportunities: [{ ...snap, business_id: HL, archived_at: null, stage: 'contacted', is_top: true, ...past }], sales_flow_events: [] });
      const row = () => sb.db.sales_opportunities[0];
      const fields = () => ['pinned_until', 'pinned_at', 'pinned_by', 'pin_reason'].map(k => row()[k]).join('|');
      const was = fields(), star = starOf(row());
      const call = body => applyPin(sb, { businessId: HL, userId: owner.userId, type: 'employer', id: target.id, body });
      const edit = await call({ action: 'reason', reason: 'x' });
      const renew = await call({ action: 'renew', expect: { pinned_until: past.pinned_until } });
      const afterRenew = { reason: row().pin_reason, days: renew.body.pin?.days_left, at: row().pinned_at };
      const undoRenew = await undoFlow(sb, { businessId: HL, eventId: renew.body.event.id, byUser: owner.userId });
      const backExpired = fields() === was;
      const unpin = await call({ action: 'unpin' });
      const cleared = ['pinned_until', 'pinned_at', 'pinned_by', 'pin_reason'].every(k => row()[k] == null);
      const undoUnpin = await undoFlow(sb, { businessId: HL, eventId: unpin.body.event.id, byUser: owner.userId });
      ok(`expired pin, the real writer on an in-memory copy of ${target.name}: no live pin (${pinState(row()) === null}), the star reads expired (${star.pin_expired}), the reason is kept; Edit reason ${edit.status} "${edit.body.error}"; Renew ${renew.status} -> ${afterRenew.days} d left with the SAME reason (${afterRenew.reason === REASON}), pin date kept; Undo ${undoRenew.status} -> expired again; Unpin ${unpin.status} -> the four fields empty (${cleared}); Undo ${undoUnpin.status} -> all four back (${fields() === was}); ${sb.db.sales_flow_events.length} event rows in memory`,
        pinState(row()) === null && star.pin_expired && !star.top && edit.status === 409 && renew.status === 200 && afterRenew.days === PIN_DAYS && afterRenew.reason === REASON && afterRenew.at === past.pinned_at && undoRenew.status === 200 && backExpired && unpin.status === 200 && cleared && undoUnpin.status === 200 && fields() === was);
      // the order: a real lifting pin from the Team list, expired in a copy -> it drops to its score's place
      const x = team.rows.find(r => r.pin && !r.pin.held);
      if (x) {
        const list = team.rows.map(r => (r.key === x.key ? { ...r, pin: null, pin_expired: { until: past.pinned_until, reason: x.pin.reason } } : r)).sort(pinFirst);
        const i = list.findIndex(r => r.key === x.key), pinsAbove = list.slice(0, i).filter(r => r.pin && !r.pin.held).length, livePins = list.filter(r => r.pin && !r.pin.held).length;
        const byScore = (i === 0 || list[i - 1].score >= x.score || (list[i - 1].pin && !list[i - 1].pin.held)) && (i === list.length - 1 || list[i + 1].score <= x.score);
        ok(`expired pin, the order (the Team list with ${x.name}'s pin expired in a copy): it moves from row ${x.rank} to row ${i + 1}, under all ${livePins} live pins, between scores ${list[i - 1]?.score} and ${list[i + 1]?.score} (its own ${x.score})`, pinsAbove === livePins && byScore && i + 1 > x.rank);
      }
    }
    // (2) the page with that row's reply rewritten to an expired pin (writes aborted)
    {
      const until = new Date(Date.now() - 3 * 864e5).toISOString(), REASON = 'Fixture: asked for a January start';
      const { ctx, page } = await openView(1440, 'Top targets', TT_READY, { height: 1260, fixture: r => (r.key === target.key ? { ...r, pin: null, pinned_until: until, pin_expired: { until, reason: REASON } } : r) });
      const rowSel = `[data-top-targets] tr[data-row="${target.key}"]`;
      await page.locator(rowSel).scrollIntoViewIfNeeded();
      const keys = await page.evaluate(() => [...document.querySelectorAll('[data-top-targets] tr[data-row]')].map(r => r.getAttribute('data-row')));
      const star = await page.locator(`${rowSel} [data-star]`).getAttribute('data-star'), label = await page.locator(`${rowSel} [data-star]`).getAttribute('aria-label');
      const line = await page.locator(`${rowSel} [data-pin-line="expired"]`).textContent().catch(() => null);
      await page.locator(`${rowSel} [data-star]`).click(); await page.waitForTimeout(300);
      const items = await page.locator('[data-pin-pop="menu"] [role=menuitem]').allTextContents();
      await page.screenshot({ path: `${OUT}/stage3-expired-fixture-1440.png`, animations: 'disabled' });
      const n0 = writes.length;
      await page.locator('[data-pin-pop="menu"]').getByRole('menuitem', { name: /^Renew/ }).click(); await page.waitForTimeout(900);
      const sent = writes.slice(n0).join(' ');
      await page.keyboard.press('Escape');
      ok(`expired pin on the page (fixture reply, ${target.name}): hollow star "${star}" ("${label}"), the row reads "${line}", it stays at row ${keys.indexOf(target.key) + 1} (rank by score ${target.rank}); the menu = ${items.join(' · ')}; Renew would send ${/would send (\{.*\})/.exec(sent)?.[1] || '?'} - aborted, nothing written`, star === 'expired' && /^Pin expired .+ · Renew$/.test(line || '') && keys.indexOf(target.key) + 1 === target.rank && items.join('|') === 'Renew 30 more days|Unpin' && /"action":"renew"/.test(sent) && /aborted/.test(sent));
      await ctx.close();
    }
    // (3) 1440 real: the company window's pin control on the one employer (Top = pin, Top again = unpin)
    {
      const { ctx, page, errors } = await openView(1440, 'Top targets', TT_READY, { height: 1260, allowPin: true });
      const rowSel = `[data-top-targets] tr[data-row="${target.key}"]`;
      await axeOn(page, 'top-targets@1440', '[data-top-targets]');
      await page.locator(rowSel).scrollIntoViewIfNeeded();
      await page.locator(`${rowSel} [data-row-name]`).click();
      const btn = page.locator('[data-company-panel] button[aria-pressed]').first();
      await btn.waitFor({ timeout: 20000 }); await page.waitForTimeout(1500);
      const pressed0 = await btn.getAttribute('aria-pressed'), text0 = (await btn.textContent()).trim();
      const click = async () => { const w = page.waitForResponse(r => PIN_URL.test(new URL(r.url()).pathname) && r.request().method() === 'POST', { timeout: 20000 }); await btn.click(); const s = (await w).status(); await page.waitForTimeout(1500); return s; };
      const s1 = await click(); const mid = await readTarget(), pressed1 = await btn.getAttribute('aria-pressed');
      await page.screenshot({ path: `${OUT}/stage3-window-pinned-1440.png`, animations: 'disabled' });
      await axeOn(page, 'company window@1440', '[data-center-window]');
      const s2 = await click(); const pressed2 = await btn.getAttribute('aria-pressed');
      ok(`company window (${target.name}): the "${text0}" control aria-pressed ${pressed0}; click ${s1} -> pressed ${pressed1}, the database pinned until ${mid.pinned_until?.slice(0, 10)} by Jack (${mid.pinned_by === owner.userId}), no reason (${mid.pin_reason === null}); click again ${s2} -> pressed ${pressed2}, the database = the snapshot: ${same(await readTarget(), snap)}`, pressed0 === 'false' && s1 === 200 && pressed1 === 'true' && !!mid.pinned_until && mid.pinned_by === owner.userId && s2 === 200 && pressed2 === 'false' && same(await readTarget(), snap));
      const events = (await svc.from('sales_flow_events').select('kind, undone_at').eq('business_id', HL).eq('record_id', target.id).gte('at', startIso).order('at')).data || [];
      ok(`events: ${events.map(e => e.kind).join(',')} for ${target.name} (kept)`, events.map(e => e.kind).join() === 'pin,unpin');
      await page.keyboard.press('Escape'); await page.waitForTimeout(500);
      log(`after the window closes the Pipeline sub-view is "${await page.locator('[data-sales-subviews] [role=tab][aria-selected=true]').first().textContent().catch(() => '?')}"`);
      ok(`1440: N2 ${await n2(page)} px; page errors ${errors.length}`, (await n2(page)) === 0 && errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
    // (4) Viewer
    {
      const w0 = writes.length;
      const { ctx, page } = await openView(1440, 'Top targets', TT_READY, { viewer: true });
      const v = await page.evaluate(() => ({ rows: document.querySelectorAll('[data-top-targets] tr[data-row]').length, starButtons: document.querySelectorAll('[data-top-targets] button[data-star]').length, glyphs: document.querySelectorAll('[data-top-targets] span[data-star]').length, renew: document.querySelectorAll('[data-top-targets] .tt-pinl button').length }));
      const lifted = mine.rows.find(r => r.groups.pin > 0) || mine.rows[0];
      await page.locator(`tr[data-row="${lifted.key}"] [data-score-bar]`).hover(); await page.waitForTimeout(400);
      const pop = await page.locator('[data-breakdown]').innerText().catch(() => '');
      await page.screenshot({ path: `${OUT}/stage3-viewer-1440.png`, animations: 'disabled' });
      await page.mouse.move(5, 5);
      await page.locator(`tr[data-row="${lifted.key}"] [data-row-name]`).click();
      await page.locator('[data-company-panel]').first().waitFor({ timeout: 20000 }); await page.waitForTimeout(1500);
      const win = await page.evaluate(() => ({ star: document.querySelectorAll('[data-company-panel] button[aria-pressed]').length, note: /view access/.test(document.querySelector('[data-center-window]')?.textContent || '') }));
      const { salesGate } = await import('../../api/lib/requireAuth.js');
      const gate = method => { let status = 200, body = null, passed = false; salesGate({ method, params: { businessId: HL }, auth: { user: { id: owner.userId }, isPlatformOwner: false, roles: new Map([[HL, 'viewer']]) } }, { status(s) { status = s; return this; }, json(b) { body = b; return this; } }, () => { passed = true; }); return { status, error: body?.error, passed }; };
      const post = gate('POST'), read = gate('GET');
      ok(`Viewer: ${v.rows} rows, ${v.glyphs} star glyphs, ${v.starButtons} star buttons, ${v.renew} Renew links; the breakdown hover still opens (${pop.split('\n')[0]}); the company window has ${win.star} pin controls and says read-only (${win.note}); the gate answers a Viewer's POST …/pin ${post.status} "${post.error}" and lets the GET through (${read.passed}); writes this page tried: ${writes.length - w0}`, v.starButtons === 0 && v.renew === 0 && v.glyphs === v.rows && pop.includes('Heat') && win.star === 0 && win.note && post.status === 403 && /member access/.test(post.error || '') && read.passed);
      await ctx.close();
    }
    // (5) 390
    {
      const { ctx, page, errors } = await openView(390, 'Top targets', TT_READY, { height: 1560 });
      const c = await page.evaluate(() => ({ mode: document.querySelector('[data-top-targets]').getAttribute('data-top-targets'), cards: document.querySelectorAll('[data-top-targets] article[data-row]').length }));
      await page.screenshot({ path: `${OUT}/stage3-top-targets-390.png`, animations: 'disabled' });
      await axeOn(page, 'top-targets@390', '[data-top-targets]');
      await page.locator(`article[data-row="${target.key}"] [data-star]`).click(); await page.waitForTimeout(500);
      const sheet = await page.evaluate(() => { const s = document.querySelector('[data-pin-sheet] .tt-sheet'); return s ? { bottom: Math.round(window.innerHeight - s.getBoundingClientRect().bottom), text: s.innerText.split('\n')[0] } : null; });
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      ok(`390: ${c.cards} cards = the route's Mine (${mine.rows.length}); the pin sheet "${sheet?.text}" sits ${sheet?.bottom} px from the bottom - closed without a write; N2 ${await n2(page)} px; page errors ${errors.length}`, c.mode === 'cards' && c.cards === mine.rows.length && sheet?.bottom === 0 && (await n2(page)) === 0 && errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
  }
  async function runBMap() {
    // (6) the Map's ◆ (read-only; --ui --map-only runs this part alone: 2 page loads, 0 writes)
    const scores = await get('/goals/scores');
    const pinnedKeys = new Set([...(scores.body?.rows || []), ...(scores.body?.live || [])].filter(r => r.pinned).map(r => r.key)), livePins = pinnedKeys.size;
    const rawLive = [...partners, ...employers, ...targets].filter(r => livePin(r)).length;
    for (const w of [1440, 390]) {
      const { ctx, page, errors } = await openView(w, 'Map', MAP_READY);
      const marks = await page.evaluate(() => [...document.querySelectorAll('[data-priorities] [data-dot], [data-priorities] [data-row]')].map(el => ({ key: el.getAttribute('data-dot') || el.getAttribute('data-key') || el.getAttribute('data-row'), glyph: !!el.querySelector('[data-pin-glyph]') })));
      const off = marks.filter(m => m.glyph !== pinnedKeys.has(m.key));
      const g = { marks: marks.length, glyphs: marks.filter(m => m.glyph).length, companies: new Set(marks.filter(m => m.glyph).map(m => m.key)).size };
      await page.screenshot({ path: `${OUT}/stage3-map-${w}.png`, animations: 'disabled' });
      await axeOn(page, `map@${w}`, '[data-priorities]');
      ok(`Map ${w}: ${g.marks} marks (dots + table rows), ${g.glyphs} ◆ on ${g.companies} companies; a mark carries the ◆ exactly when the scores route says pinned: ${off.length} marks differ (the route marks ${livePins} rows pinned, signed clients included; ${rawLive} live pins on the three record tables); N2 ${await n2(page)} px; page errors ${errors.length}`, g.glyphs > 0 && off.length === 0 && g.companies <= livePins && livePins <= rawLive && (await n2(page)) === 0 && errors.length === 0, off.slice(0, 4).map(m => `${m.key} glyph ${m.glyph}`).join(', ') || errors.join(' | '));
      await ctx.close();
    }
  }
} catch (e) {
  results.errors.push(e.message); log('ERROR', e.stack?.split('\n').slice(0, 4).join(' | '));
} finally {
  await cleanup();
  let line;
  try {
    const notes = [];
    if (target && snap) {
      const fin = await readTarget(), sc = await readScore();
      if (!same(fin, snap) || fin.updated_at !== snap.updated_at) throw new Error(`${target.name} differs from the snapshot`);
      const day = (await svc.from('sales_company_score_days').select('score, band').eq('business_id', HL).eq('company_type', 'employer').eq('company_id', target.id).eq('day', today).maybeSingle()).data;
      if (sc?.override) throw new Error(`${target.name}'s stored score still carries a pin`);
      notes.push(`${target.name}'s pin columns, is_top, priority columns and updated_at = the snapshot${results.put_back ? ' (PUT BACK by the safety net)' : ''}; its stored score ${scoreBefore?.score} ${scoreBefore?.band} -> ${sc?.score} ${sc?.band}, no pin on it, today's history row ${day?.score} ${day?.band}`);
    }
    const after = await snapshot(), usageAfter = await usageCount();
    const mineEvents = target ? (await svc.from('sales_flow_events').select('id', { count: 'exact', head: true }).eq('business_id', HL).eq('record_id', target.id).gte('at', startIso)).count : 0;
    const moved = TABLES.filter(t => String(before[t]) !== String(after[t]) && !(t === 'sales_flow_events' && after[t] - before[t] === mineEvents)).map(t => `${t} ${before[t]} -> ${after[t]}`);
    if (moved.length) throw new Error(`counts moved beyond this run's ${mineEvents} event rows (check who wrote before blaming the run): ${moved.join(', ')}`);
    if (usageAfter - usageBefore !== claudeThisRun) notes.push(`usage rows since the start: ${usageAfter - usageBefore} vs ${claudeThisRun} asks made here - check who else asked`);
    line = `yes (${notes.join('; ')}${notes.length ? '; ' : ''}${TABLES.length - 1} table counts identical, sales_flow_events +${mineEvents} = this run's event rows, kept as the history; ${claudeThisRun} usage row${claudeThisRun === 1 ? '' : 's'} kept; Jack's sign-in row kept by rule, last_seen_at restored)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  console.log(`\n${passed}/${results.checks.length} checks passed${results.errors.length ? ` · errors: ${results.errors.join(' | ')}` : ''}`);
  console.log(`API writes seen: ${[...new Set(writes)].join(', ') || 'none'}`);
  console.log(`other aborted calls: ${[...new Set(blocked)].slice(0, 8).join(', ') || 'none'}`);
  console.log(`Claude: ${claudeThisRun} this run, ${ledger.spent} of cap ${CLAUDE_CAP} in all · Apollo: 0`);
  console.log(`restored: ${line}`);
  process.exit(results.errors.length || passed !== results.checks.length ? 1 : 0);
}
