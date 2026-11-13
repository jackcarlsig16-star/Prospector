// person-owner-v1 Stage 2 live check - localhost against the build, as Jack (ownerSession) on the REAL HomeLover
// workspace. 0 Claude, 0 Apollo (the server runs with both keys empty; the browser's calls to either host are aborted).
// DECLARED before it runs:
//   --before   READ-ONLY: 2 page loads (1440, 390), every non-GET aborted, two PNGs (people-1440-before / -390-before).
//              ~60 s, cap 150 s.
//   --window-only  READ-ONLY: 1 page load, the company window's People card only (every non-GET aborted). ~40 s.
//   default    6 page loads, ~10 GETs, ~8 table reads (< 2k rows each). WRITES, each one undone inside the run:
//              ONE real person (unassigned, chosen from the route's rows; named in the report) assigned to Cyrus and
//              taken back three times - from the row's Owner cell, from the pinned card, and through Scout
//              ("assign <that person> to Cyrus" -> card -> act -> Undo). That is 3 x (POST goals/people/:key/assign +
//              POST goals/people/events/:id/undo) = 6 owner updates on one row and 6 sales_person_events rows, which
//              STAY (the event log is the audit trail; kept like sign-in rows). The person's owner_user_id and
//              updated_at are snapshotted first and put back exactly. Every other non-GET is aborted and counted.
//              A Scout plan / act that would cost a Claude call is refused by the empty key - reported, not retried.
//              ~200 s, cap 240 s.
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
const BEFORE = process.argv.includes('--before');
const OUT = path.join(ROOT, '.screenshots', 'person-owner-v1');
const PORT = 3996, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const TABLES = ['sales_prospect_state', 'sales_people', 'partner_contacts', 'sales_opportunities', 'sales_targets', 'sales_goals', 'sales_week_goals'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data?.[0]?.id;
if (!HL) throw new Error('no HomeLover business');
async function count(t) { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL); return r.error ? `n/a (${r.error.message.slice(0, 40)})` : r.count; }
const snapshot = async () => { const o = {}; for (const t of TABLES) o[t] = await count(t); return o; };
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
let srv, browser, owner;
const blocked = [], realCalls = [], writes = [];
const results = { checks: [], errors: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 400)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: BEFORE ? 150000 : 240000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));
const ASSIGN = new RegExp(`^/api/sales/${HL}/goals/people/[^/]+/assign$`), UNDO = new RegExp(`^/api/sales/${HL}/goals/people/events/[^/]+/undo$`), SCOUT = /^\/api\/scout\/(plan|act|undo)$/;
const keyOf = k => k.replace(/[^A-Za-z0-9_-]/g, '_');
const TABLE_OF = { prospect: ['sales_prospect_state', 'contact_id'], person: ['sales_people', 'id'], contact: ['partner_contacts', 'id'] };
let target = null, targetBefore = null;
const readTarget = async () => { const [kind, id] = [target.key.slice(0, target.key.indexOf(':')), target.key.slice(target.key.indexOf(':') + 1)]; const [t, col] = TABLE_OF[kind]; return (await svc.from(t).select('owner_user_id, updated_at').eq('business_id', HL).eq(col, id).maybeSingle()).data; };

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', ANTHROPIC_API_KEY: '', APOLLO_API_KEY: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const get = async p => { const r = await fetch(`${BASE}/api/sales/${HL}${p}`, { headers: { cookie } }); return { status: r.status, body: await r.json().catch(() => null) }; };
  browser = await chromium.launch();
  async function openPeople(width, { viewer = false, allowWrites = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 }, hasTouch: width < 900 });
    await ctx.addInitScript(([k, v, bz, dd]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      localStorage.setItem('prospector_goals_owner', 'team');
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, dd);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (u.protocol === 'file:' || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      const apiWrite = isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname);
      const declared = apiWrite && allowWrites && !viewer && req.method() === 'POST' && (ASSIGN.test(u.pathname) || UNDO.test(u.pathname) || SCOUT.test(u.pathname));
      if (apiWrite) writes.push(`${req.method()} ${u.pathname.replace(HL, ':b').replace(/people\/[^/]+\/assign/, 'people/:key/assign').replace(/events\/[^/]+\/undo/, 'events/:id/undo')}${declared ? '' : ' (aborted)'}`);
      if (declared) return route.continue();
      const deny = apiWrite || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
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
    await page.goto(`${BASE}/?tab=pipeline&view=people`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 25000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: /^Pipeline/ }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
    await page.locator('[data-sales-subviews]').getByRole('tab', { name: 'People', exact: true }).dispatchEvent('click'); await page.waitForTimeout(1500);
    await page.locator('[data-people-table] [data-row]').first().waitFor({ timeout: 30000 }); await page.waitForTimeout(2000);
    return { ctx, page, errors };
  }

  if (BEFORE) {
    for (const w of [1440, 390]) {
      const { ctx, page } = await openPeople(w);
      await page.screenshot({ path: `${OUT}/people-${w}-before.png`, animations: 'disabled' });
      ok(`before PNG ${w}: .screenshots/person-owner-v1/people-${w}-before.png`, true);
      await ctx.close();
    }
  } else {
    await runChecks({ get, openPeople });
  }
  ok(`browser reached 0 Claude / Apollo hosts (${realCalls.length})`, !realCalls.length);
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.stack || e.message);
} finally {
  await cleanup();
  let line;
  try {
    if (target && targetBefore) {
      const cur = await readTarget();
      if (cur.owner_user_id !== targetBefore.owner_user_id || cur.updated_at !== targetBefore.updated_at) {
        const [kind, id] = [target.key.slice(0, target.key.indexOf(':')), target.key.slice(target.key.indexOf(':') + 1)]; const [t, col] = TABLE_OF[kind];
        const r = await svc.from(t).update({ owner_user_id: targetBefore.owner_user_id, updated_at: targetBefore.updated_at }).eq('business_id', HL).eq(col, id);
        if (r.error) throw new Error(`restore ${target.name}: ${r.error.message}`);
      }
      const fin = await readTarget();
      if (fin.owner_user_id !== targetBefore.owner_user_id || fin.updated_at !== targetBefore.updated_at) throw new Error(`${target.name} differs from the snapshot`);
    }
    const after = await snapshot();
    const moved = TABLES.filter(t => String(before[t]) !== String(after[t])).map(t => `${t} ${before[t]} -> ${after[t]}`);
    if (moved.length) throw new Error(`counts moved (check who wrote before blaming the run): ${moved.join(', ')}`);
    line = `yes (${TABLES.length} table counts identical${target ? `; ${target.name}'s owner_user_id + updated_at = the snapshot; the run's sales_person_events rows kept as the audit trail` : ''}; Jack's sign-in row kept by rule, last_seen_at restored)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  console.log(`\n${passed}/${results.checks.length} checks passed${results.errors.length ? ` · ERRORS: ${results.errors.map(e => e.split('\n')[0]).join(' | ')}` : ''}`);
  console.log(`API writes seen: ${[...new Set(writes)].join(', ') || 'none'}`);
  console.log(`restored: ${line}`);
  process.exit(results.errors.length || passed !== results.checks.length ? 1 : 0);
}

// The company window's People card (read-only): the person's name opens the window; wait for it to load, open the
// People drawer if the window shows drawers, then count the owner marks and the Assign controls.
async function windowCheck(page, rows) {
  const withRecord = rows.find(r => r.company?.id && ['partner', 'employer'].includes(r.company.type) && r.heat_band && r.heat_band !== 'cold');
  if (!withRecord) return ok('company window: a hot / warm person on a partner or employer to open', false);
  await page.locator(`[data-people-table] [data-row][data-key="${keyOf(withRecord.key)}"] [data-person-name]`).first().click();
  const card = () => page.evaluate(() => { const marks = [...document.querySelectorAll('[data-owner]')].filter(el => !el.closest('[data-people-table]') && !el.closest('table')); const assign = [...document.querySelectorAll('[data-assign]')].filter(el => !el.closest('[data-people-table]') && !el.closest('table')); return { owners: marks.length, assign: assign.length, loading: /Loading…/.test(document.body.textContent) }; });
  let pc = await card();
  for (let i = 0; i < 30 && (pc.loading || !pc.owners); i++) {
    if (!pc.loading && i === 6) { const tab = page.getByRole('button', { name: /^People/ }).last(); if (await tab.count()) await tab.click().catch(() => {}); }
    await page.waitForTimeout(500); pc = await card();
  }
  ok(`company window (${withRecord.company.name}) People card: ${pc.owners} owner marks, ${pc.assign} Assign controls`, pc.owners > 0 && pc.assign > 0);
  await page.screenshot({ path: `${OUT}/company-people-1440.png`, animations: 'disabled' });
}

async function runChecks({ get, openPeople }) {
  if (process.argv.includes('--window-only')) {
    const rows = (await get('/goals/people/activity?window=all')).body?.rows || [];
    const { ctx, page } = await openPeople(1440);
    await page.screenshot({ path: `${OUT}/people-1440-after.png`, animations: 'disabled' });
    const cut = await page.evaluate(() => [...document.querySelectorAll('[data-people-table] tr[data-row] [data-owner] span:last-child')].filter(el => el.scrollWidth > el.clientWidth).length);
    ok(`1440: owner names cut short in the 64 px column: ${cut}`, cut === 0);
    await windowCheck(page, rows);
    return ctx.close();
  }
  const started = new Date().toISOString();
  const act = await get('/goals/people/activity?window=all');
  const rows = act.body?.rows || [];
  ok(`GET goals/people/activity 200: ${rows.length} people, route counts ${JSON.stringify(act.body?.counts)}`, act.status === 200 && rows.length > 0);
  const members = (await get('/goals/members')).body?.members || [];
  const first = id => String(members.find(m => m.user_id === id)?.name || '').trim().split(/\s+/)[0] || null;
  const cyrus = members.find(m => /^cyrus\b/i.test(m.name || ''));
  if (!cyrus) throw new Error('no member named Cyrus');
  const jackId = owner.userId;

  // ---- counts vs raw: every row's owner = the raw row behind its primary key; mine / unassigned / by member from both.
  const all = async (t, cols) => { const out = []; for (let from = 0; ; from += 1000) { const r = await svc.from(t).select(cols).eq('business_id', HL).order(cols.split(',')[0].trim()).range(from, from + 999); if (r.error) throw new Error(`${t}: ${r.error.message}`); out.push(...r.data); if (r.data.length < 1000) break; } return out; };
  const raw = new Map();
  for (const r of await all('sales_prospect_state', 'contact_id, owner_user_id')) raw.set(`prospect:${r.contact_id}`, r.owner_user_id || null);
  for (const r of await all('sales_people', 'id, owner_user_id, archived_at')) if (!r.archived_at) raw.set(`person:${r.id}`, r.owner_user_id || null);
  for (const r of await all('partner_contacts', 'id, owner_user_id')) raw.set(`contact:${r.id}`, r.owner_user_id || null);
  const tally = f => { const o = {}; for (const r of rows) { const k = f(r) ? first(f(r)) || 'former member' : 'unassigned'; o[k] = (o[k] || 0) + 1; } return o; };
  const fromRoute = tally(r => r.owner_user_id), fromRaw = tally(r => raw.get(r.key));
  const wrong = rows.filter(r => !raw.has(r.key) || (r.owner_user_id || null) !== raw.get(r.key));
  ok(`owners: all ${rows.length} route rows = the raw row behind their key (${wrong.length} differ) · by member, route ${JSON.stringify(fromRoute)} = raw ${JSON.stringify(fromRaw)} · the route's unassigned count ${act.body.counts.unassigned}`, !wrong.length && JSON.stringify(fromRoute) === JSON.stringify(fromRaw) && act.body.counts.unassigned === (fromRaw.unassigned || 0), wrong.slice(0, 3).map(r => r.key).join(', '));
  const mineRaw = rows.filter(r => raw.get(r.key) === jackId).length, unassignedRaw = rows.filter(r => !raw.get(r.key)).length;

  const n2 = page => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
  const axeOn = async (page, key) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async () => { const r = await window.axe.run(document.querySelector('[data-people-table]') || document, { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); });
    ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v));
  };
  const chipText = (page, name) => page.locator('[data-people-chips]').getByRole('button', { name: new RegExp(`^${name}`) }).first().textContent();
  const ownerInRow = (page, key) => page.locator(`[data-people-table] [data-row][data-key="${keyOf(key)}"] [data-owner]`).first().textContent();
  const dbOwner = async () => (await readTarget()).owner_user_id || null;

  // ---- 1440 as Jack
  {
    const { ctx, page, errors } = await openPeople(1440, { allowWrites: true });
    const h = await page.evaluate(() => {
      const sec = document.querySelector('[data-people-table]'), box = sec.querySelector('.ui-table-box'), table = sec.querySelector('table.ui-table');
      return { headers: [...table.querySelectorAll('thead th')].map(th => th.textContent.replace(/ [↕▲▼]$/, '').trim()), cols: [...table.querySelectorAll('colgroup col')].map(c => parseInt(c.style.width, 10)), tableW: Math.round(table.getBoundingClientRect().width), boxW: box.clientWidth, boxScroll: box.scrollWidth - box.clientWidth };
    });
    const sum = h.cols.reduce((a, b) => a + b, 0);
    ok(`1440: 11 headers (${h.headers.join(' · ')}); column widths ${h.cols.join(' + ')} = ${sum} <= 1,100; the table ${h.tableW} px in a ${h.boxW} px box, sideways scroll in the box ${h.boxScroll} px; N2 ${await n2(page)} px`, h.headers.length === 11 && h.headers[4] === 'Owner' && sum === 1098 && h.boxScroll <= 0 && (await n2(page)) === 0);
    const mine = await chipText(page, 'Mine'), un = await chipText(page, 'Unassigned');
    ok(`chips: "${mine}" = raw ${mineRaw} people owned by Jack · "${un}" = raw ${unassignedRaw} with no owner`, mine === `Mine(${mineRaw})` && un === `Unassigned(${unassignedRaw})`);
    const shown = await page.evaluate(() => [...document.querySelectorAll('[data-people-table] tr[data-row]')].slice(0, 12).map(tr => [tr.getAttribute('data-key'), tr.querySelector('[data-owner]')?.textContent]));
    const byKey = new Map(rows.map(r => [keyOf(r.key), r]));
    const cellOk = shown.every(([k, text]) => { const r = byKey.get(k); return r && text === (r.owner_user_id ? first(r.owner_user_id) : '—'); });
    ok(`1440: the Owner cell of the first ${shown.length} rows = the route (${shown.slice(0, 6).map(([, t]) => t).join(', ')}…)`, shown.length > 0 && cellOk);
    await page.screenshot({ path: `${OUT}/people-1440-after.png`, animations: 'disabled' });
    await axeOn(page, 'people@1440');
    // by member through the Owner select
    for (const m of members.filter(x => x.role !== 'viewer')) {
      await page.getByLabel('Owner', { exact: true }).selectOption(m.user_id); await page.waitForTimeout(500);
      const line = await page.locator('[data-active-filters]').first().textContent();
      const want = rows.filter(r => raw.get(r.key) === m.user_id).length;
      ok(`Owner = ${first(m.user_id)}: "${line.slice(0, 40)}" = raw ${want}`, new RegExp(`Showing ${want} of ${rows.length}`).test(line));
    }
    await page.getByLabel('Owner', { exact: true }).selectOption(''); await page.waitForTimeout(400);

    // ---- the ONE person: unassigned, chosen from the route (a visible band first)
    target = rows.find(r => !r.owner_user_id && r.heat_band && r.heat_band !== 'cold' && r.name && rows.filter(x => x.name === r.name).length === 1) || rows.find(r => !r.owner_user_id && rows.filter(x => x.name === r.name).length === 1);
    if (!target) throw new Error('no unassigned person with a unique name to assign');
    targetBefore = await readTarget();
    log(`the one person: ${target.name} (${target.key.split(':')[0]}, ${target.heat_band || 'cold'}) · owner before ${targetBefore.owner_user_id || 'unassigned'} · -> ${first(cyrus.user_id)} and back, three times`);
    if (!target.heat_band || target.heat_band === 'cold') { await page.locator('[data-people-table]').getByRole('button', { name: /^Cold/ }).click(); await page.waitForTimeout(600); }
    const rowSel = `[data-people-table] [data-row][data-key="${keyOf(target.key)}"]`;
    await page.locator(rowSel).scrollIntoViewIfNeeded();
    const pick = async (opener, shot) => {
      await opener.click(); await page.waitForTimeout(300);
      const menu = page.getByRole('menu', { name: `Assign ${target.name}` });
      const items = await menu.getByRole('menuitemradio').allTextContents();
      const dots = await menu.locator('[data-owner-dot]').count();
      const resp = page.waitForResponse(r => ASSIGN.test(new URL(r.url()).pathname), { timeout: 20000 });
      if (shot) await page.screenshot({ path: `${OUT}/${shot}`, animations: 'disabled' });
      await menu.getByRole('menuitemradio', { name: new RegExp(`^${first(cyrus.user_id)}`) }).click();
      const status = (await resp).status(); await page.waitForTimeout(1500);
      return { items: items.map(t => t.replace('✓', '')), dots, status };
    };
    const undo = async () => {
      const resp = page.waitForResponse(r => UNDO.test(new URL(r.url()).pathname), { timeout: 20000 });
      await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
      const status = (await resp).status(); await page.waitForTimeout(1500);
      return status;
    };
    // (1) from the row's Owner cell
    const a1 = await pick(page.locator(`${rowSel} [data-assign]`).first(), 'assign-menu-1440.png');
    const mid1 = await dbOwner(), cell1 = await ownerInRow(page, target.key);
    await page.screenshot({ path: `${OUT}/assigned-row-1440.png`, animations: 'disabled' });
    const u1 = await undo();
    ok(`row: the menu lists ${a1.items.join(' · ')} with ${a1.dots} colour dots; assign ${a1.status} -> the row reads "${cell1}", the database ${mid1 === cyrus.user_id ? 'Cyrus' : mid1}; Undo ${u1} -> the row reads "${await ownerInRow(page, target.key)}", the database ${(await dbOwner()) || 'unassigned'}`, a1.status === 200 && mid1 === cyrus.user_id && cell1 === first(cyrus.user_id) && u1 === 200 && (await dbOwner()) === (targetBefore.owner_user_id || null) && (await ownerInRow(page, target.key)) === '—' && a1.items[a1.items.length - 1] === 'Unassigned' && a1.dots === a1.items.length - 1);
    // (2) from the pinned card
    await page.locator(`${rowSel} td`).nth(2).click(); await page.waitForTimeout(1500);
    const a2 = await pick(page.locator(`[data-person-detail="${target.key}"] [role=group][aria-label="Quick menu"] [data-assign]`), null);
    const mid2 = await dbOwner();
    await page.screenshot({ path: `${OUT}/assigned-card-1440.png`, animations: 'disabled' });
    const u2 = await undo();
    ok(`pinned card: Assign ▸ ${a2.status} -> the database ${mid2 === cyrus.user_id ? 'Cyrus' : mid2}; Undo ${u2} -> ${(await dbOwner()) || 'unassigned'}`, a2.status === 200 && mid2 === cyrus.user_id && u2 === 200 && (await dbOwner()) === (targetBefore.owner_user_id || null));
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    // (3) through Scout
    const bar = page.locator('.scout-bar input').first();
    await bar.click(); await bar.fill(`assign ${target.name} to ${first(cyrus.user_id)}`); await page.waitForTimeout(300);
    const planP = page.waitForResponse(r => r.url().endsWith('/api/scout/plan'), { timeout: 20000 });
    await page.keyboard.press('Enter');
    const card = await (await planP).json().catch(() => ({}));
    if (!card.plan_id) ok(`Scout: "assign ${target.name} to Cyrus" gave a card to act on`, false, JSON.stringify(card).slice(0, 300));
    else {
      await page.locator('[data-scout-card]').waitFor();
      const cardText = (await page.locator('[data-scout-card]').textContent()).replace(/\s+/g, ' ').trim();
      await page.screenshot({ path: `${OUT}/scout-card-1440.png`, animations: 'disabled' });
      const actP = page.waitForResponse(r => r.url().endsWith('/api/scout/act'), { timeout: 30000 });
      await page.click('[data-scout-confirm]');
      const actStatus = (await actP).status();
      await page.locator('[data-scout-done-line]').waitFor(); await page.waitForTimeout(800);
      const mid3 = await dbOwner();
      const undoP = page.waitForResponse(r => r.url().endsWith('/api/scout/undo'), { timeout: 20000 });
      await page.click('[data-scout-undo]');
      const undoStatus = (await undoP).status(); await page.waitForTimeout(1200);
      ok(`Scout: the card reads "${cardText.slice(0, 140)}" (names the person, says person); act ${actStatus} -> the database ${mid3 === cyrus.user_id ? 'Cyrus' : mid3}; Undo ${undoStatus} -> ${(await dbOwner()) || 'unassigned'}`, cardText.includes(target.name) && /person/i.test(cardText) && actStatus === 200 && mid3 === cyrus.user_id && undoStatus === 200 && (await dbOwner()) === (targetBefore.owner_user_id || null));
    }
    const events = (await svc.from('sales_person_events').select('kind, origin, before, after, undone_at, at').eq('business_id', HL).eq('person_key', target.key).gte('at', started).order('at')).data || [];
    const word = id => (id ? first(id) : 'unassigned');
    log(`events for ${target.name} (kept): ${events.map(e => `${e.kind}/${e.origin} ${word(e.before?.owner_user_id)} -> ${word(e.after?.owner_user_id)}${e.kind === 'assign' ? (e.undone_at ? ' (undone)' : ' (NOT undone)') : ''}`).join(' · ')}`);
    ok(`events: ${events.filter(e => e.kind === 'assign').length} assign (all undone: ${events.filter(e => e.kind === 'assign').every(e => e.undone_at)}) + ${events.filter(e => e.kind === 'undo').length} undo rows for ${target.name}; the owner now = the snapshot`, events.filter(e => e.kind === 'assign').length === events.filter(e => e.kind === 'undo').length && events.filter(e => e.kind === 'assign').every(e => e.undone_at) && (await dbOwner()) === (targetBefore.owner_user_id || null));
    await windowCheck(page, rows);
    ok(`1440: 0 page errors (${errors.length})`, !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- 1440 as a Viewer
  {
    const { ctx, page } = await openPeople(1440, { viewer: true });
    const v = await page.evaluate(() => ({ owners: document.querySelectorAll('[data-people-table] tr[data-row] [data-owner]').length, assign: document.querySelectorAll('[data-people-table] [data-assign]').length, rows: document.querySelectorAll('[data-people-table] tr[data-row]').length }));
    await page.locator('[data-people-table] [data-row]').first().locator('td').nth(2).click(); await page.waitForTimeout(1800);
    const menu = await page.locator('[data-person-detail] [role=group][aria-label="Quick menu"] button').allTextContents();
    ok(`Viewer: ${v.rows} rows each with an owner mark (${v.owners}), ${v.assign} Assign controls, the card's quick menu = ${menu.join(' · ')}`, v.rows > 0 && v.owners === v.rows && v.assign === 0 && menu.join('|') === 'Open company');
    await page.screenshot({ path: `${OUT}/people-viewer-1440.png`, animations: 'disabled' });
    await ctx.close();
  }
  // ---- 390
  {
    const { ctx, page, errors } = await openPeople(390);
    const c = await page.evaluate(() => ({ cards: document.querySelectorAll('[data-people-table] [data-row]').length, owners: document.querySelectorAll('[data-people-table] [data-row] [data-owner]').length, assign: document.querySelectorAll('[data-people-table] [data-row] [data-assign]').length }));
    await page.screenshot({ path: `${OUT}/people-390-after.png`, animations: 'disabled' });
    await axeOn(page, 'people@390');
    await page.locator('[data-people-table] [data-row] [data-assign]').first().click(); await page.waitForTimeout(500);
    const sheet = await page.evaluate(() => { const m = document.querySelector('[data-assign-menu="sheet"]'); return m ? { items: [...m.querySelectorAll('[role=menuitemradio]')].map(b => b.textContent.replace('✓', '')), dots: m.querySelectorAll('[data-owner-dot]').length, bottom: Math.round(window.innerHeight - m.getBoundingClientRect().bottom) } : null; });
    await page.screenshot({ path: `${OUT}/assign-sheet-390.png`, animations: 'disabled' });
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    ok(`390: ${c.cards} cards, each with its owner (${c.owners}) and the Assign chip (${c.assign}); the chip opens a bottom sheet (${sheet?.items.join(' · ')}, ${sheet?.dots} dots, ${sheet?.bottom} px from the bottom) - closed without a pick; N2 ${await n2(page)} px; 0 page errors (${errors.length})`, c.cards > 0 && c.owners === c.cards && c.assign === c.cards && sheet && sheet.items[sheet.items.length - 1] === 'Unassigned' && sheet.bottom === 0 && (await n2(page)) === 0 && !errors.length);
    await ctx.close();
  }
}
