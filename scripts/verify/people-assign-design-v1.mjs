// FIX people-assign-design-v1 live check - localhost against the build, as Jack (ownerSession) on the REAL HomeLover
// workspace. 0 Claude, 0 Apollo (the server runs with both keys empty; the browser's calls to either host are aborted).
// DECLARED before it runs:
//   6 page loads (People 1440 as Jack, Top targets 1440, People 1440 as a Viewer, People 390, the two mockup files),
//   ~4 route GETs, 2 table reads of one row. PNGs under .screenshots/people-assign-design-v1/.
//   WRITES, undone inside the run: ONE real person (unassigned, a unique name, chosen from the route's rows; named in
//   the report) assigned to Cyrus from the row's Owner cell and taken back with the done line's Undo =
//   1 POST goals/people/:key/assign + 1 POST goals/people/events/:id/undo: 2 owner updates on one row and 2
//   sales_person_events rows, which STAY (the event log is the audit trail). The person's owner_user_id and updated_at
//   are snapshotted first and put back exactly. Every other non-GET is aborted and counted (the pin form, the list in
//   the window and the sheet are opened and closed without a pick).
//   Viewer: no user is created - /api/me is rewritten to role viewer in the browser.
//   ~180 s, cap 235 s.
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
const OUT = path.join(ROOT, '.screenshots', 'people-assign-design-v1');
const MOCK = path.join(ROOT, 'specs', 'design', 'people-assign');
const PORT = 3994, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0], SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const TABLES = ['sales_prospect_state', 'sales_people', 'partner_contacts', 'sales_opportunities', 'sales_targets', 'sales_goals', 'sales_week_goals', 'sales_flow_events'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now(), started = new Date().toISOString();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data?.[0]?.id;
if (!HL) throw new Error('no HomeLover business');
async function count(t) { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL); return r.error ? `n/a (${r.error.message.slice(0, 40)})` : r.count; }
const snapshot = async () => { const o = {}; for (const t of TABLES) o[t] = await count(t); return o; };
const nowLocal = new Date();
const minsToSix = ((6 - (nowLocal.getHours() % 6)) % 6) * 60 - nowLocal.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (nowLocal.getHours() % 6 === 0 && nowLocal.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
let srv, browser, owner;
const blocked = [], realCalls = [], writes = [];
const results = { checks: [], errors: [], deviations: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 500)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 235000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));
const ASSIGN = new RegExp(`^/api/sales/${HL}/goals/people/[^/]+/assign$`), UNDO = new RegExp(`^/api/sales/${HL}/goals/people/events/[^/]+/undo$`);
const keyOf = k => k.replace(/[^A-Za-z0-9_-]/g, '_');
const TABLE_OF = { prospect: ['sales_prospect_state', 'contact_id'], person: ['sales_people', 'id'], contact: ['partner_contacts', 'id'] };
let target = null, targetBefore = null;
const split = () => [target.key.slice(0, target.key.indexOf(':')), target.key.slice(target.key.indexOf(':') + 1)];
const readTarget = async () => { const [kind, id] = split(); const [t, col] = TABLE_OF[kind]; return (await svc.from(t).select('owner_user_id, updated_at').eq('business_id', HL).eq(col, id).maybeSingle()).data; };

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', ANTHROPIC_API_KEY: '', APOLLO_API_KEY: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const get = async p => { const r = await fetch(`${BASE}/api/sales/${HL}${p}`, { headers: { cookie } }); return { status: r.status, body: await r.json().catch(() => null) }; };
  browser = await chromium.launch();
  async function openView(width, tabName, ready, { viewer = false, allowWrites = false, height = null } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: height || (width < 900 ? 844 : 1000) }, hasTouch: width < 900 });
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
      const mine = target && u.pathname.includes(encodeURIComponent(target.key));
      const declared = apiWrite && allowWrites && !viewer && req.method() === 'POST' && ((ASSIGN.test(u.pathname) && mine) || UNDO.test(u.pathname));
      if (apiWrite) writes.push(`${req.method()} ${u.pathname.replace(HL, ':b').replace(/people\/[^/]+\/assign/, 'people/:key/assign').replace(/events\/[^/]+\/undo/, 'events/:id/undo')}${declared ? '' : ' (aborted)'}`);
      if (declared) return route.continue();
      const deny = apiWrite || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.pathname.replace(HL, ':b')}`); return route.abort(); }
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
  const shot = (page, name, clip) => page.screenshot({ path: `${OUT}/${name}.png`, animations: 'disabled', ...(clip ? { clip } : {}) });
  const PEOPLE = '[data-people-table] [data-row]';

  const rows = (await get('/goals/people/activity?window=all')).body?.rows || [];
  const members = (await get('/goals/members')).body?.members || [];
  const first = id => String(members.find(m => m.user_id === id)?.name || '').trim().split(/\s+/)[0] || null;
  const cyrus = members.find(m => /^cyrus\b/i.test(m.name || ''));
  if (!cyrus || !rows.length) throw new Error('no member named Cyrus, or no people');
  const uniq = r => r.name && rows.filter(x => x.name === r.name).length === 1;
  target = rows.find(r => !r.owner_user_id && r.heat_band && r.heat_band !== 'cold' && uniq(r)) || rows.find(r => !r.owner_user_id && uniq(r));
  if (!target) throw new Error('no unassigned person with a unique name');
  targetBefore = await readTarget();
  log(`the one person: ${target.name} (${target.key.split(':')[0]}, ${target.heat_band || 'cold'}) · owner before ${targetBefore.owner_user_id || 'unassigned'}`);
  const dbOwner = async () => (await readTarget()).owner_user_id || null;

  // ================= 1440 as Jack: the cell, the list, the ONE assign + Undo, the pinned card, the window
  {
    const { ctx, page, errors } = await openView(1440, 'People', PEOPLE, { allowWrites: true });
    const h = await page.evaluate(() => { const sec = document.querySelector('[data-people-table]'), box = sec.querySelector('.ui-table-box'), table = sec.querySelector('table.ui-table'); return { cols: [...table.querySelectorAll('colgroup col')].map(c => parseInt(c.style.width, 10)), tableW: Math.round(table.getBoundingClientRect().width), boxScroll: box.scrollWidth - box.clientWidth, ownerW: Math.round([...table.querySelectorAll('thead th')][4].getBoundingClientRect().width) }; });
    ok(`1440: the People table ${h.tableW} px (columns ${h.cols.join(' + ')} = ${h.cols.reduce((a, b) => a + b, 0)} <= 1,100), sideways scroll in its box ${h.boxScroll} px, the Owner column ${h.ownerW} px; N2 ${await n2(page)} px`, h.cols.reduce((a, b) => a + b, 0) <= 1100 && h.tableW <= 1100 && h.boxScroll <= 0 && h.ownerW === 64 && (await n2(page)) === 0);
    // rest / hover / focus on an assigned row (the first with an owner on the page)
    const owned = rows.find(r => r.owner_user_id && r.heat_band && r.heat_band !== 'cold');
    const cellOf = key => page.locator(`[data-people-table] [data-row][data-key="${keyOf(key)}"] [data-assign]`).first();
    const look = loc => loc.evaluate(el => { const cs = getComputedStyle(el), c = el.querySelector('.asg-c'), r = el.getBoundingClientRect(), td = el.closest('td'), next = td.nextElementSibling.getBoundingClientRect(); return { bg: cs.backgroundColor, border: cs.borderTopColor, caret: getComputedStyle(c).display !== 'none', w: Math.round(r.width), h: Math.round(r.height), overNext: Math.round(r.right - (next.left + 10)), tdW: Math.round(td.getBoundingClientRect().width), tag: el.tagName, text: el.textContent }; });
    await page.mouse.move(5, 5);
    const rest = await look(cellOf(owned.key));
    await cellOf(owned.key).hover(); await page.waitForTimeout(250);
    const hov = await look(cellOf(owned.key));
    const rowBox = await page.locator(`[data-people-table] [data-row][data-key="${keyOf(owned.key)}"]`).boundingBox();
    const clip = { x: Math.max(0, rowBox.x), y: Math.max(0, rowBox.y - 40), width: Math.min(1100, rowBox.width), height: 260 };
    await shot(page, 'cell-hover-1440', clip);
    ok(`the Owner cell (${owned.name}): a <${rest.tag.toLowerCase()}> reading "${rest.text}"; at rest no fill (${rest.bg}), no hairline (${rest.border}), no caret (${rest.caret}), ${rest.w}×${rest.h} px; on hover the inset fill (${hov.bg}), the hairline, the caret (${hov.caret}), ${hov.w} px wide - ${hov.overNext <= 0 ? `it stops ${-hov.overNext} px before` : `it runs ${hov.overNext} px over`} the next column's text; the column stays ${hov.tdW} px`, rest.tag === 'BUTTON' && rest.bg === 'rgba(0, 0, 0, 0)' && !rest.caret && hov.caret && hov.bg !== rest.bg && hov.overNext <= 0 && hov.tdW === 64 && rest.tdW === 64);
    await page.mouse.move(5, 5);
    await cellOf(owned.key).click(); await page.waitForTimeout(300);
    const list = await page.evaluate(() => { const m = document.querySelector('[data-assign-menu="menu"]'), box = m.querySelector('[role=listbox]'); return { w: Math.round(m.getBoundingClientRect().width), focus: document.activeElement === box, active: document.getElementById(box.getAttribute('aria-activedescendant'))?.textContent, opts: [...box.querySelectorAll('[role=option]')].map(o => `${o.textContent}${o.getAttribute('aria-selected') === 'true' ? ' ✓' : ''}`), rowH: Math.round(box.querySelector('[role=option]').getBoundingClientRect().height), expanded: document.querySelector('[data-assign][aria-expanded=true]')?.className }; });
    await shot(page, 'cell-open-1440', clip);
    await axeOn(page, 'the open list', '[data-assign-menu="menu"]');
    await page.keyboard.press('ArrowUp'); const up = await page.evaluate(() => { const b = document.querySelector('[data-assign-menu] [role=listbox]'); return document.getElementById(b.getAttribute('aria-activedescendant')).textContent; });
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    const back = await page.evaluate(() => ({ open: !!document.querySelector('[data-assign-menu]'), focus: document.activeElement?.hasAttribute('data-assign') }));
    ok(`the list (${owned.name}, owner ${first(owned.owner_user_id)}): ${list.w} px wide, ${list.rowH}-px rows: ${list.opts.join(' · ')}; it opens with focus in the listbox (${list.focus}) on the current owner ("${list.active}"); ↑ goes to "${up}"; Esc closes (${!back.open}) with focus back on the cell (${back.focus})`, list.w === 200 && list.rowH === 32 && list.focus && list.active.startsWith(first(owned.owner_user_id)) && list.opts.at(-1).startsWith('Unassigned') && list.opts.some(o => o.endsWith('✓')) && !back.open && back.focus && /is-open/.test(list.expanded));

    // ---- the ONE assign + Undo, from the cell
    if (!target.heat_band || target.heat_band === 'cold') { await page.locator('[data-people-table]').getByRole('button', { name: /^Cold/ }).click(); await page.waitForTimeout(600); }
    const rowSel = `[data-people-table] [data-row][data-key="${keyOf(target.key)}"]`;
    await page.locator(rowSel).scrollIntoViewIfNeeded();
    const restUn = await look(cellOf(target.key));
    await cellOf(target.key).click(); await page.waitForTimeout(300);
    const openOn = await page.evaluate(() => { const b = document.querySelector('[data-assign-menu] [role=listbox]'); return document.getElementById(b.getAttribute('aria-activedescendant')).textContent; });
    const resp = page.waitForResponse(r => ASSIGN.test(new URL(r.url()).pathname), { timeout: 20000 });
    await page.locator('[data-assign-menu]').getByRole('option', { name: new RegExp(`^${first(cyrus.user_id)}`) }).click();
    const aStatus = (await resp).status(); await page.locator('[data-assign-done]').waitFor(); await page.waitForTimeout(500);
    const done = await page.evaluate(sel => { const d = document.querySelector('[data-assign-done]'), r = d.getBoundingClientRect(); return { tone: d.getAttribute('data-assign-done'), text: d.querySelector('[data-assign-done-line]').textContent, undo: d.querySelector('[data-assign-undo]')?.textContent, h: Math.round(r.height), fromBottom: Math.round(window.innerHeight - r.bottom), centered: Math.abs((r.left + r.right) / 2 - window.innerWidth / 2) < 2, wash: getComputedStyle(document.querySelector(`${sel} td`)).backgroundColor, cell: document.querySelector(`${sel} [data-owner]`).textContent, toasts: document.querySelectorAll('[role=status]').length }; }, rowSel);
    const mid = await dbOwner();
    await shot(page, 'done-line-1440');
    const uResp = page.waitForResponse(r => UNDO.test(new URL(r.url()).pathname), { timeout: 20000 });
    await page.locator('[data-assign-undo]').click();
    const uStatus = (await uResp).status(); await page.waitForTimeout(900);
    const undone = await page.evaluate(sel => ({ text: document.querySelector('[data-assign-done-line]')?.textContent, buttons: document.querySelectorAll('[data-assign-done] button').length, cell: document.querySelector(`${sel} [data-owner]`).textContent }), rowSel);
    await shot(page, 'undone-line-1440');
    ok(`the ONE assign (${target.name}): the cell reads "${restUn.text}" (hollow dot + —), the list opens on "${openOn}"; pick Cyrus -> ${aStatus}, the cell reads "${done.cell}" at once, the database ${mid === cyrus.user_id ? 'Cyrus' : mid}; the done line (${done.tone}, ${done.h} px, ${done.fromBottom} px from the bottom, centred ${done.centered}) says "${done.text}" + "${done.undo}"; the row's wash ${done.wash}; ${done.toasts} status line on the page; Undo -> ${uStatus}, "${undone.text}" with ${undone.buttons} buttons, the cell reads "${undone.cell}", the database ${(await dbOwner()) || 'unassigned'}`,
      restUn.text === '—' && openOn === 'Unassigned' && aStatus === 200 && done.cell === first(cyrus.user_id) && mid === cyrus.user_id && done.tone === 'ok' && done.text === `${target.name} assigned to ${first(cyrus.user_id)}.` && /^Undo \d+ s$/.test(done.undo || '') && done.h === 40 && done.fromBottom === 24 && done.centered && done.wash !== 'rgba(0, 0, 0, 0)' && done.toasts === 1 && uStatus === 200 && undone.text === `Undone. ${target.name} is unassigned again.` && undone.buttons === 0 && undone.cell === '—' && (await dbOwner()) === (targetBefore.owner_user_id || null));
    const events = (await svc.from('sales_person_events').select('kind, undone_at, at').eq('business_id', HL).eq('person_key', target.key).gte('at', started).order('at')).data || [];
    ok(`events for ${target.name} (kept): ${events.map(e => `${e.kind}${e.kind === 'assign' ? (e.undone_at ? ' (undone)' : ' (NOT undone)') : ''}`).join(' · ')}`, events.length === 2 && events[0].kind === 'assign' && !!events[0].undone_at && events[1].kind === 'undo');
    await page.waitForTimeout(4500);

    await axeOn(page, 'people@1440', '[data-people-table]');
    // ---- the pinned card: Assign swaps the quick menu in place
    await page.locator(`[data-people-table] [data-row][data-key="${keyOf(owned.key)}"]`).scrollIntoViewIfNeeded();
    await page.locator(`[data-people-table] [data-row][data-key="${keyOf(owned.key)}"] td`).nth(2).click(); await page.waitForTimeout(1500);
    const detail = `[data-person-detail="${owned.key}"]`;
    const menuBefore = await page.locator(`${detail} [role=group][aria-label="Quick menu"] button`).allTextContents();
    await page.locator(`${detail} [role=group][aria-label="Quick menu"] [data-assign]`).click(); await page.waitForTimeout(300);
    const swap = await page.evaluate(sel => { const g = document.querySelector(`${sel} [data-assign-swap]`), box = g?.querySelector('[role=listbox]'); return g ? { w: Math.round(g.getBoundingClientRect().width), back: g.querySelector('.asg-back')?.textContent, opts: [...box.querySelectorAll('[role=option]')].map(o => o.textContent), focus: document.activeElement === box, active: document.getElementById(box.getAttribute('aria-activedescendant'))?.textContent, popovers: document.querySelectorAll('[data-assign-menu]').length } : null; }, detail);
    const dBox = await page.locator(detail).boundingBox();
    await shot(page, 'card-swap-1440', { x: Math.max(0, dBox.x - 8), y: Math.max(0, dBox.y - 60), width: Math.min(1120, dBox.width + 16), height: Math.min(360, 1000 - Math.max(0, dBox.y - 60)) });
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    const menuAfter = await page.locator(`${detail} [role=group][aria-label="Quick menu"] button`).allTextContents();
    const focusBack = await page.evaluate(() => document.activeElement?.textContent);
    ok(`the pinned card (${owned.name}): the quick menu (${menuBefore.join(' · ')}) -> Assign swaps it IN PLACE for a ${swap?.w}-px list with the back row "${swap?.back}" (${swap?.opts.join(' · ')}), focus in the list on "${swap?.active}", ${swap?.popovers} popovers; Esc brings the menu back (${menuAfter.length} buttons) with focus on "${focusBack}"`, swap && swap.w === 200 && swap.back === '‹Assign' && swap.focus && swap.popovers === 0 && swap.active.startsWith(first(owned.owner_user_id)) && menuAfter.join() === menuBefore.join() && focusBack === 'Assign ▸');
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);

    // ---- the company window's People rows + its pin control (ruling 4)
    const withRecord = rows.find(r => r.company?.id && ['partner', 'employer'].includes(r.company.type) && r.heat_band && r.heat_band !== 'cold' && r.owner_user_id);
    await page.locator(`[data-people-table] [data-row][data-key="${keyOf(withRecord.key)}"] [data-person-name]`).first().click();
    const inWin = '[data-center-window] [data-assign]';
    for (let i = 0; i < 30 && !(await page.locator(inWin).count()); i++) { if (i === 8) { const tab = page.locator('[data-center-window]').getByRole('button', { name: /^People/ }).last(); if (await tab.count()) await tab.click().catch(() => {}); } await page.waitForTimeout(500); }
    const win = await page.evaluate(sel => { const els = [...document.querySelectorAll(sel)]; return { n: els.length, cls: els[0]?.className, plain: [...document.querySelectorAll('[data-center-window] [data-owner]')].length }; }, inWin);
    await page.locator(inWin).first().scrollIntoViewIfNeeded(); await page.locator(inWin).first().hover(); await page.waitForTimeout(250);
    await page.locator(inWin).first().click(); await page.waitForTimeout(300);
    const winList = await page.evaluate(() => { const m = document.querySelector('[data-assign-menu="menu"]'), box = m?.querySelector('[role=listbox]'); return m ? { focus: document.activeElement === box, opts: box.querySelectorAll('[role=option]').length, z: getComputedStyle(m).zIndex } : null; });
    await shot(page, 'window-people-1440');
    await axeOn(page, 'the company window with the list open', '[data-center-window]');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    ok(`company window (${withRecord.company.name}) People rows: ${win.n} Owner cells of the same control ("${win.cls}"); the list opens over the window with focus in it (${winList?.focus}), ${winList?.opts} rows - closed without a pick; the window stays open: ${await page.locator('[data-center-window]').count() === 1}`, win.n > 0 && /asg-ow asg-ow--row/.test(win.cls) && winList?.focus && (await page.locator('[data-center-window]').count()) === 1);
    const pinBtn = page.locator('[data-center-window] [data-window-pin] button').first();
    if (await pinBtn.count()) {
      const label = (await pinBtn.textContent()).trim(), state = await pinBtn.getAttribute('data-star');
      await pinBtn.click(); await page.waitForTimeout(300);
      const pop = await page.evaluate(() => { const p = document.querySelector('[data-pin-pop]'); return p ? { mode: p.getAttribute('data-pin-pop'), text: p.innerText.split('\n').slice(0, 4).join(' | ') } : null; });
      await shot(page, 'window-pin-1440');
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      ok(`company window pin control (ruling 4): "${label}" (${state}) opens the star's ${pop?.mode === 'form' ? 'reason form' : 'menu'} (${pop?.text}) - closed without a write`, pop && (state === 'none' ? pop.mode === 'form' && label === 'Pin' : pop.mode === 'menu' && /Renew/.test(pop.text)));
    } else ok('company window pin control (ruling 4) present', false);
    ok(`1440: 0 page errors (${errors.length})`, !errors.length, errors.join(' | '));
    await page.keyboard.press('Escape'); await page.waitForTimeout(600);
    log(`after the window (opened from a People row) closes the Pipeline sub-view is "${await page.locator('[data-sales-subviews] [role=tab][aria-selected=true]').first().textContent().catch(() => '?')}"`);
    await ctx.close();
  }
  // ================= ruling 2: a window opened from Top targets goes back to Top targets
  {
    const { ctx, page } = await openView(1440, 'Top targets', '[data-top-targets] [data-row]');
    const name = await page.locator('[data-top-targets] tr[data-row] [data-row-name]').first().textContent();
    await page.locator('[data-top-targets] tr[data-row] [data-row-name]').first().click();
    await page.locator('[data-center-window]').waitFor({ timeout: 20000 }); await page.waitForTimeout(1200);
    const tab = () => page.locator('[data-sales-subviews] [role=tab][aria-selected=true]').first().textContent();
    const during = await tab();
    await page.locator('[data-center-window]').getByRole('button', { name: 'Close panel' }).click(); await page.waitForTimeout(1500);
    const after = await tab(), rowsBack = await page.locator('[data-top-targets] [data-row]').count();
    await page.locator('[data-sales-subviews]').getByRole('tab', { name: 'Companies', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    ok(`ruling 2: ${name}'s window opened from Top targets (the view behind it: "${during}"); closing it lands on "${after}" with ${rowsBack} rows; going to Companies afterwards does not reopen the window (${await page.locator('[data-center-window]').count()} open)`, after === 'Top targets' && rowsBack > 0 && (await page.locator('[data-center-window]').count()) === 0);
    await ctx.close();
  }
  // ================= Viewer
  {
    const { ctx, page } = await openView(1440, 'People', PEOPLE, { viewer: true });
    const v = await page.evaluate(() => ({ rows: document.querySelectorAll('[data-people-table] tr[data-row]').length, owners: document.querySelectorAll('[data-people-table] tr[data-row] [data-owner]').length, assign: document.querySelectorAll('[data-assign]').length, inButton: [...document.querySelectorAll('[data-people-table] tr[data-row] [data-owner]')].filter(el => el.closest('button')).length }));
    await shot(page, 'viewer-1440');
    ok(`Viewer: ${v.rows} rows, each owner as plain text (${v.owners} marks, ${v.inButton} inside a button), ${v.assign} Assign controls`, v.rows > 0 && v.owners === v.rows && v.assign === 0 && v.inButton === 0);
    await ctx.close();
  }
  // ================= 390
  {
    const { ctx, page, errors } = await openView(390, 'People', PEOPLE, { height: 1180 });
    const c = await page.evaluate(() => { const t = [...document.querySelectorAll('[data-people-table] [data-row] [data-assign]')]; return { cards: document.querySelectorAll('[data-people-table] [data-row]').length, triggers: t.length, h: Math.round(t[0].getBoundingClientRect().height), cls: t[0].className }; });
    await axeOn(page, 'people@390', '[data-people-table]');
    await page.locator('[data-people-table] [data-row] [data-assign]').first().click(); await page.waitForTimeout(500);
    const sheet = await page.evaluate(() => { const m = document.querySelector('[data-assign-menu="sheet"]'); if (!m) return null; const o = [...m.querySelectorAll('[role=option]')]; return { title: m.querySelector('.asg-sheet-title').textContent, note: m.querySelector('.asg-sheet-note').textContent.length > 0, rows: o.map(x => x.textContent), rowH: Math.round(o[0].getBoundingClientRect().height), cancelH: Math.round(m.querySelector('.asg-cancel').getBoundingClientRect().height), bottom: Math.round(window.innerHeight - m.getBoundingClientRect().bottom), role: m.getAttribute('role') }; });
    await shot(page, 'sheet-390');
    await axeOn(page, 'the sheet@390', '[data-assign-menu="sheet"]');
    await page.locator('[data-assign-menu="sheet"] .asg-cancel').click(); await page.waitForTimeout(300);
    ok(`390: ${c.cards} cards, each with an Owner row (${c.triggers} triggers, ${c.h} px tall, "${c.cls}"); the sheet "${sheet?.title}" (${sheet?.rows.join(' · ')}; ${sheet?.rowH}-px rows, Cancel ${sheet?.cancelH} px, ${sheet?.bottom} px from the bottom) - Cancel closes it without a pick (${await page.locator('[data-assign-menu]').count()} open); N2 ${await n2(page)} px; 0 page errors (${errors.length})`, c.cards > 0 && c.triggers === c.cards && c.h === 44 && sheet && /^Assign /.test(sheet.title) && sheet.note && sheet.rowH === 52 && sheet.cancelH === 48 && sheet.bottom === 0 && sheet.rows.at(-1) === 'Unassigned' && (await page.locator('[data-assign-menu]').count()) === 0 && (await n2(page)) === 0 && !errors.length);
    await ctx.close();
  }
  // ================= side by side with the two mockups
  const b64 = f => fs.readFileSync(f).toString('base64');
  for (const [file, w, h, built] of [['PeopleAssign.dc.html', 1440, 1240, ['cell-hover-1440', 'cell-open-1440', 'done-line-1440', 'undone-line-1440', 'card-swap-1440', 'window-people-1440']], ['PeopleAssignPhone.dc.html', 390, 1180, ['sheet-390']]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await page.goto(`file://${path.join(MOCK, file)}`); await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/mock-${w}.png`, animations: 'disabled' });
    const rightW = w === 1440 ? 1120 : 390;
    await page.setViewportSize({ width: w + rightW + 60, height: h + 60 });
    await page.setContent(`<body style="margin:0;background:#000;color:#fff;font:14px system-ui"><div style="display:flex;gap:20px;padding:20px;align-items:flex-start"><figure style="margin:0"><figcaption style="height:20px">mockup</figcaption><img width="${w}" src="data:image/png;base64,${b64(`${OUT}/mock-${w}.png`)}"></figure><div style="display:flex;flex-direction:column;gap:10px;width:${rightW}px">${built.map(n => `<figure style="margin:0"><figcaption style="height:20px">built (real data) · ${n}</figcaption><img style="max-width:${rightW}px" src="data:image/png;base64,${b64(`${OUT}/${n}.png`)}"></figure>`).join('')}</div></div></body>`);
    await page.screenshot({ path: `${OUT}/side-by-side-${w}.png`, fullPage: true });
    ok(`side by side ${w}: side-by-side-${w}.png`, true);
    await ctx.close();
  }
  ok(`browser reached 0 Claude / Apollo hosts (${realCalls.length})`, !realCalls.length);
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', (e.stack || e.message).split('\n').slice(0, 4).join(' | '));
} finally {
  await cleanup();
  let line;
  try {
    if (target && targetBefore) {
      const [kind, id] = split(); const [t, col] = TABLE_OF[kind];
      const cur = await readTarget();
      if (cur.owner_user_id !== targetBefore.owner_user_id || cur.updated_at !== targetBefore.updated_at) {
        const r = await svc.from(t).update({ owner_user_id: targetBefore.owner_user_id, updated_at: targetBefore.updated_at }).eq('business_id', HL).eq(col, id);
        if (r.error) throw new Error(`restore ${target.name}: ${r.error.message}`);
      }
      const fin = await readTarget();
      if (fin.owner_user_id !== targetBefore.owner_user_id || fin.updated_at !== targetBefore.updated_at) throw new Error(`${target.name} differs from the snapshot`);
    }
    const after = await snapshot();
    const moved = TABLES.filter(t => String(before[t]) !== String(after[t])).map(t => `${t} ${before[t]} -> ${after[t]}`);
    if (moved.length) throw new Error(`counts moved (check who wrote before blaming the run): ${moved.join(', ')}`);
    line = `yes (${TABLES.length} table counts identical${target ? `; ${target.name}'s owner_user_id + updated_at = the snapshot; the run's 2 sales_person_events rows kept as the audit trail` : ''}; Jack's sign-in row kept by rule, last_seen_at restored)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  console.log(`\n${passed}/${results.checks.length} checks passed${results.errors.length ? ` · ERRORS: ${results.errors.map(e => e.split('\n')[0]).join(' | ')}` : ''}`);
  console.log(`API writes seen: ${[...new Set(writes)].join(', ') || 'none'}`);
  console.log(`restored: ${line}`);
  process.exit(results.errors.length || passed !== results.checks.length ? 1 : 0);
}
