// hkos-inbox-v2 Stage 3 live check - as Jack (ownerSession) on the REAL HumanKind workspace, localhost against the build,
// through the real wiring. Grow › Inbox at 1440 (two panes: lanes + counts, units, N2 - opening a thread moves the list
// 0 px and never scrolls the page, J / K, contrast, axe), 1100 (two panes), 1024 (drawer), 390 (one pane, no sideways
// scroll, contrast, axe), and a Viewer pass (role forced to viewer in the /shell response; no write controls).
// SCOPE (declared): Jack's own HumanKind Gmail, read-only. Gmail: ONE list load (1 messages.list + <=25 metadata
// messages.get <= 505 units; every later view is served from the server's 120 s cache), plus one full thread open and
// the full thread Analyze reads (120 + 120 units) ~ 750 units in all. Claude: exactly ONE Analyze call (STANDARD, web
// search max 3) on the ASO Scout / Grace Miller thread if present, else the first Needs-you person with a domain; a
// second Analyze request is aborted. --replay serves the saved reply (.screenshots/hkos-inbox-v2/analyze-reply.json,
// derived intel only) and makes 0 Claude calls. Every other non-GET to /api, /proxy and Supabase REST is aborted (no
// page-load sync, nothing tracked, ignored or linked), as is every outside host but Google Fonts.
// Writes and restore: the new hk_domain_intel row is deleted (an existing one would be put back exactly); Jack's
// hk_member_prefs.last_seen_at (the /shell stamp) and profiles.last_seen_at are restored; the ONE
// business_anthropic_usage row of the Analyze call is KEPT as the spend record (it also counts toward the 25/day cap);
// sign-in rows are kept by rule. "restored" THROWS if anything else moved. Runtime ~3 min, cap 300 s.
// Usage: node scripts/verify/hkos-inbox-v2-stage3.mjs [--replay | --dry]   (run npm run build first)
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
const { measureScript, summarize } = require(ROOT + '/scripts/verify/lib/contrastMeasure.cjs');
const REPLAY = process.argv.includes('--replay');
// --dry: a synthetic Analyze reply (not saved), 0 Claude - to shake the page checks out before the one real call.
const DRY = process.argv.includes('--dry');
const DRY_REPLY = { intel: { company: { name: 'Dry Run Co', website: null, what_they_do: 'Synthetic', hq_city: null, chicago_presence: 'unknown', size_hint: null, category: 'other' }, email: { kind: 'other', summary: 'Synthetic', urgency: 'low' }, fit: { sponsor_fit: 'weak', why: 'Synthetic', challenge_idea: null }, next_step: 'no_action', reason: 'Synthetic' }, cost_usd: 0, researched_at: new Date().toISOString(), prefill: { name: 'Dry Run Co' }, cached: false, web_searches: 0, model: 'none' };
const OUT = path.join(ROOT, '.screenshots', 'hkos-inbox-v2');
const REPLY_FILE = path.join(OUT, 'analyze-reply.json');
const PORT = 3998, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const HK_TABLES = ['hk_brands', 'hk_contacts', 'hk_touches', 'hk_replies', 'hk_ignored_senders', 'hk_events', 'hk_sync_runs', 'hk_job_runs', 'hk_settings', 'hk_import_runs'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const hk = (await svc.from('businesses').select('id, features').eq('name', 'HumanKind')).data?.find(b => b.features?.hk_sales);
if (!hk) { console.log('ABORT: no HumanKind workspace with hk_sales on'); process.exit(1); }
if (REPLAY && !fs.existsSync(REPLY_FILE)) { console.log(`ABORT: --replay needs ${REPLY_FILE}`); process.exit(1); }
const now0 = new Date();
const minsToSix = ((6 - (now0.getHours() % 6)) % 6) * 60 - now0.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now0.getHours() % 6 === 0 && now0.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
const must = r => { if (r.error) throw new Error(r.error.message); return r; };
const counts = async () => { const o = {}; for (const t of HK_TABLES) o[t] = must(await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', hk.id)).count; return o; };
const usageCount = async () => must(await svc.from('business_anthropic_usage').select('*', { count: 'exact', head: true }).eq('business_id', hk.id).eq('call_type', 'hk_inbox_analyze')).count;
const intelRows = async () => must(await svc.from('hk_domain_intel').select('*').eq('business_id', hk.id)).data;
const jackId = must(await svc.from('profiles').select('id').eq('is_platform_owner', true)).data[0].id;
const prefsSeen = async () => must(await svc.from('hk_member_prefs').select('last_seen_at').eq('business_id', hk.id).eq('user_id', jackId).maybeSingle()).data?.last_seen_at ?? null;
const before = { counts: await counts(), usage: await usageCount(), intel: await intelRows(), seen: await prefsSeen() };
log('before', JSON.stringify({ ...before.counts, usage: before.usage, intel: before.intel.length }));

let srv, browser, owner;
const blocked = [], realCalls = [], analyzePosts = [];
const results = { checks: [], errors: [], axe: {}, contrast: {}, n2: {}, numbers: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 300000 });
fs.mkdirSync(OUT, { recursive: true });
let listBody = null;

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  const ANALYZE = /^\/api\/hk\/[^/]+\/inbox\/threads\/[^/]+\/analyze$/;
  async function open(width, { viewer = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 760 ? 844 : 900 }, hasTouch: width < 760 });
    // try: the init script also runs inside the reader's sandboxed email frame, which has no storage.
    await ctx.addInitScript(([k, v]) => { try { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); localStorage.setItem('prospector_auto_assay_disabled', '1'); } catch { /* sandboxed frame */ } }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session)]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      if (isLocal && req.method() === 'POST' && ANALYZE.test(u.pathname)) {
        analyzePosts.push(u.pathname);
        if (REPLAY) return route.fulfill({ status: 200, contentType: 'application/json', body: fs.readFileSync(REPLY_FILE, 'utf8') });
        if (DRY) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DRY_REPLY) });
        if (analyzePosts.length > 1) { blocked.push(`POST ${u.pathname} (second Analyze)`); return route.abort(); }
        return route.continue();
      }
      const deny = (isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname)) || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.pathname}`); return route.abort(); }
      if (viewer && isLocal && /^\/api\/hk\/[^/]+\/shell$/.test(u.pathname)) {
        const r = await route.fetch(); const j = await r.json();
        return route.fulfill({ response: r, json: { ...j, me: { ...j.me, role: 'viewer' } } });
      }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(30000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    page.on('response', async r => { if (/\/inbox\/threads\?/.test(r.url()) && r.request().method() === 'GET' && r.ok()) { const j = await r.json().catch(() => null); if (j?.tab === 'inbox' && !listBody) listBody = j; } });
    await page.goto(`${BASE}/`);
    if (width < 900) { await page.getByRole('button', { name: 'Open menu' }).click().catch(() => {}); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 20000 }); await page.getByLabel('Workspace').selectOption({ label: 'HumanKind' });
    await page.locator('[data-hk-shell] [data-hk-avatar]').waitFor({ timeout: 20000 });
    const nav = page.locator('[data-hk-nav="inbox"]');
    if (await nav.count() && await nav.first().isVisible()) await nav.first().click();
    else { await page.locator('[data-hk-tab="more"]').click(); await page.locator('[data-hk-more]').getByRole('button', { name: 'Inbox', exact: true }).click(); }
    await page.locator('[data-hk-inbox-list] [data-hk-thread], [data-hk-inbox-list] .hk-empty').first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(600);
    return { ctx, page, errors };
  }
  const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide' });
  const measure = async (page, key, scope) => {
    const m = await page.evaluate(measureScript({ scope, exclude: 'iframe' }));
    if (m.error) { ok(`contrast ${key}`, false, m.error); return; }
    // HumanKind's bar (hkos-project-shell-v1 check 7): every text pair >= 4.5:1 (3:1 large) and every icon >= 3:1. Control
    // edges are reported, not gated - v1's list rows and message heads are edge-less buttons by the Grow design.
    const s = summarize(m); results.contrast[key] = s;
    const icons = await page.evaluate(sc => [...document.querySelectorAll(`${sc} svg`)].filter(x => x.getBoundingClientRect().width).length, scope);
    ok(`contrast ${key}: 0 text < 4.5:1 (text ${s.textFails}/${s.texts}; ${icons} icons; control edges, reported only: ${s.controlFails}/${s.controls})`, s.textFails === 0, s.worst.slice(0, 6).map(w => `${w.ratio} ${w.kind === 'text' ? `T ${w.fg} on ${w.bg}` : `C via ${w.via}`} ${w.sel} "${w.text}"`).join(' | '));
  };
  const axeOn = async (page, key, sel) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async s => { const r = await window.axe.run(document.querySelector(s), { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); }, sel);
    results.axe[key] = v;
    ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v).slice(0, 400));
  };
  const noSideways = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const noAt = page => page.evaluate(() => { const el = document.querySelector('[data-hk-inbox]'); const clone = el.cloneNode(true); clone.querySelectorAll('iframe, [data-hk-messages]').forEach(x => x.remove()); return !clone.innerText.includes('@'); });

  // ---- 1440: lanes, units, N2, Analyze once, J / K.
  {
    const { ctx, page, errors } = await open(1440);
    await page.waitForTimeout(500);
    const rows = listBody?.threads || [];
    const lanes = { needs_you: rows.filter(r => r.lane === 'needs_you').length, other: rows.filter(r => r.lane === 'other').length, brands: rows.filter(r => ['tracked', 'matches'].includes(r.chip.kind)).length };
    results.numbers = { listed: rows.length, lanes, gmail_units: listBody?.gmail_units, gmail_calls: listBody?.gmail_calls, from_cache: listBody?.from_cache };
    ok(`real wiring: one Inbox page of ${rows.length} threads in ${listBody?.gmail_units} Gmail units (${listBody?.gmail_calls} calls, budget 505); lanes for the first ${rows.length}: Needs you ${lanes.needs_you} · Brands ${lanes.brands} · Other ${lanes.other}; no "@"`,
      listBody && rows.length <= 25 && listBody.gmail_units <= 505 && !JSON.stringify(listBody).includes('@'));
    const tabs = await page.locator('[data-hk-inbox-tools] [role="tab"]').allTextContents();
    ok(`1440 lane tabs: ${tabs.join(' · ')}; Needs you selected`, tabs.length === 5 && tabs[0] === `Needs you ${lanes.needs_you}` && tabs[2] === `Other ${lanes.other}` && (await page.locator('[role="tab"][aria-selected="true"]').textContent()).startsWith('Needs you'));
    ok('1440 two panes (split), the reader waits with the J / K line', (await page.locator('[data-hk-inbox]').getAttribute('data-hk-inbox-mode')) === 'split' && /J and K/.test(await page.locator('[data-hk-inbox-thread]').textContent()));
    await shot(page, 'inbox-1440');
    // The thread to Analyze: ASO Scout / Grace Miller when present, else the first Needs-you person with a domain.
    const people = rows.filter(r => r.lane === 'needs_you' && r.chip.kind === 'untracked' && r.from_domain);
    const pick = people.find(r => /aso ?scout|grace miller/i.test(`${r.from_name} ${r.subject}`)) || people[0];
    results.numbers.picked = pick ? { from: pick.from_name, domain: pick.from_domain, relayed: !!pick.relayed, named: /aso ?scout|grace miller/i.test(`${pick.from_name} ${pick.subject}`) } : null;
    if (!pick) ok('a Needs-you person with a domain to Analyze', false, 'none on the first page');
    else {
      // N2: put the row mid-pane, then open it by a plain click: the list pane and the page do not move.
      const pane = page.locator('[data-hk-inbox-list]');
      await page.evaluate(id => { const p = document.querySelector('[data-hk-inbox-list]'); const r = p.querySelector(`[data-hk-thread="${id}"]`); p.scrollTop = Math.max(0, r.offsetTop - p.clientHeight / 2); }, pick.thread_id);
      await page.waitForTimeout(300);
      const geo = () => page.evaluate(() => { const p = document.querySelector('[data-hk-inbox-list]'); const b = p.getBoundingClientRect(); return { y: window.scrollY, top: b.top, left: b.left, h: b.height, st: p.scrollTop }; });
      const g0 = await geo();
      await page.locator(`[data-hk-thread="${pick.thread_id}"]`).dispatchEvent('click');
      await page.locator('[data-hk-inbox-thread] [data-hk-brand-panel]').waitFor({ timeout: 60000 }); await page.waitForTimeout(500);
      const g1 = await geo();
      const move = Math.max(...['y', 'top', 'left', 'h', 'st'].map(k => Math.abs(g1[k] - g0[k])));
      results.n2.open = { g0, g1, move };
      ok(`N2 1440: opening ${pick.from_name} (${pick.from_domain}) moves the list ${move} px and the page ${g1.y - g0.y} px`, move < 1);
      const pageScrolls = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
      ok(`1440 the page itself does not need to scroll (${pageScrolls} px of page overflow); the panes scroll on their own`, pageScrolls <= 2);
      // Analyze ONCE (or the saved reply with --replay).
      const resp = page.waitForResponse(r => /\/analyze$/.test(new URL(r.url()).pathname), { timeout: 170000 });
      await page.locator('[data-hk-analyze]').click();
      const reply = await (await resp).json().catch(() => null);
      await page.locator('[data-hk-intel]').waitFor({ timeout: 30000 });
      if (!REPLAY && !DRY && reply && !reply.error) {
        const saved = { intel: reply.intel, cost_usd: reply.cost_usd, researched_at: reply.researched_at, prefill: reply.prefill, domain: reply.domain, cached: false, web_searches: reply.web_searches, model: reply.model };
        if (JSON.stringify(saved).includes('@')) throw new Error('Analyze reply carries "@" - not saved');
        fs.writeFileSync(REPLY_FILE, JSON.stringify(saved, null, 1));
      }
      const card = await page.evaluate(() => ({ company: document.querySelector('[data-hk-intel-company]')?.textContent, kind: document.querySelector('[data-hk-intel-kind]')?.textContent, fit: document.querySelector('[data-hk-intel-fit]')?.textContent, next: document.querySelector('[data-hk-intel-next]')?.textContent, button: document.querySelector('[data-hk-analyze]')?.textContent }));
      results.numbers.card = card; results.numbers.analyze = reply ? { cost_usd: reply.cost_usd, web_searches: reply.web_searches, model: reply.model, needs_confirm: !!reply.needs_confirm } : null;
      ok(`Analyze ${REPLAY ? '(replayed)' : DRY ? '(dry)' : 'ONCE'}: company "${card.company}" · ${card.kind} · ${card.fit} · next ${card.next}; button "${card.button}"; ${reply?.web_searches ?? '?'} searches, $${reply?.cost_usd}`,
        reply && !reply.error && card.company && card.fit && card.next && /Analyze again/.test(card.button || '') && analyzePosts.length === 1);
      ok('1440 the row now says Analyzed', (await page.locator(`[data-hk-thread="${pick.thread_id}"] [data-hk-row-intel]`).count()) === 1);
      ok('1440 no "@" outside message bodies', await noAt(page));
      await shot(page, 'inbox-1440-analyzed');
      await measure(page, 'inbox@1440', '[data-hk-inbox]');
      await axeOn(page, 'inbox@1440', '[data-hk-inbox]');
      // J / K from the open thread: the next row opens, the page stays put.
      const ids = await page.locator('[data-hk-inbox-list] [data-hk-thread]').evaluateAll(es => es.map(e => e.dataset.hkThread));
      const i = ids.indexOf(pick.thread_id);
      const y0 = await page.evaluate(() => window.scrollY);
      await page.locator('[data-hk-inbox-thread] .hk-inbox__subject-title').click();
      await page.keyboard.press(i < ids.length - 1 ? 'j' : 'k');
      const want = ids[i < ids.length - 1 ? i + 1 : i - 1];
      await page.locator(`[data-hk-thread="${want}"][aria-current="true"]`).waitFor({ timeout: 30000 });
      ok(`1440 ${i < ids.length - 1 ? 'J' : 'K'} opens the ${i < ids.length - 1 ? 'next' : 'previous'} row; the page moved ${(await page.evaluate(() => window.scrollY)) - y0} px`, (await page.evaluate(() => window.scrollY)) === y0);
    }
    ok('1440 no sideways scroll; 0 page errors', await noSideways(page) && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- 1100 two panes, 1024 drawer.
  for (const [w, mode] of [[1100, 'split'], [1024, 'drawer']]) {
    const { ctx, page, errors } = await open(w);
    const m = await page.locator('[data-hk-inbox]').getAttribute('data-hk-inbox-mode');
    if (mode === 'drawer') { await page.locator('[data-hk-inbox-list] [data-hk-thread]').first().dispatchEvent('click'); await page.locator('.hk-inbox__drawer').waitFor({ timeout: 30000 }); await page.waitForTimeout(400); }
    await shot(page, `inbox-${w}`);
    ok(`${w} ${mode}${mode === 'drawer' ? ' (the reader opens over the list, Close present)' : ''}; no sideways scroll; 0 page errors`, m === mode && await noSideways(page) && !errors.length && (mode !== 'drawer' || (await page.locator('[data-hk-inbox-back]').count()) === 1), errors.join(' | '));
    await ctx.close();
  }
  // ---- 390 one pane.
  {
    const { ctx, page, errors } = await open(390);
    await shot(page, 'inbox-390');
    const m = await page.locator('[data-hk-inbox]').getAttribute('data-hk-inbox-mode');
    await measure(page, 'inbox@390', '[data-hk-inbox]');
    await axeOn(page, 'inbox@390', '[data-hk-inbox]');
    await page.locator('[data-hk-inbox-list] [data-hk-thread]').first().dispatchEvent('click');
    await page.locator('[data-hk-inbox-thread]').waitFor({ timeout: 30000 }); await page.waitForTimeout(500);
    const listGone = (await page.locator('[data-hk-inbox-list]').count()) === 0;
    await shot(page, 'inbox-390-thread');
    await page.locator('[data-hk-inbox-back]').dispatchEvent('click'); await page.waitForTimeout(300);
    ok(`390 one pane (${m}): the list, then the thread alone, Back returns; no sideways scroll; 0 page errors`, m === 'phone' && listGone && (await page.locator('[data-hk-inbox-list]').count()) === 1 && await noSideways(page) && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- Viewer (role forced in the /shell response).
  {
    const { ctx, page, errors } = await open(1440, { viewer: true });
    await page.locator('[data-hk-inbox-list] [data-hk-thread]').first().dispatchEvent('click');
    await page.locator('[data-hk-inbox-thread] [data-hk-brand-panel]').waitFor({ timeout: 30000 });
    await page.getByRole('tab', { name: /^Other/ }).click(); await page.waitForTimeout(300);
    const writes = await page.locator('[data-hk-analyze], [data-hk-track-brand], [data-hk-ignore-sender], [data-hk-ignore-group], [data-hk-link-brand], [data-hk-mark-handled]').count();
    ok(`Viewer: no Analyze / Track / Ignore / Link / Mark handled (${writes}); 0 page errors`, writes === 0 && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  ok(`browser reached 0 Claude / Apollo hosts directly; Analyze requests ${analyzePosts.length} (cap 1); other writes all aborted (${[...new Set(blocked)].slice(0, 6).join(', ') || 'none attempted'})`, !realCalls.length && analyzePosts.length === 1);
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    const after = { counts: await counts(), usage: await usageCount(), intel: await intelRows() };
    const added = after.intel.filter(r => !before.intel.some(b => b.id === r.id));
    for (const r of added) must(await svc.from('hk_domain_intel').delete().eq('id', r.id));
    for (const b of before.intel) { const a = after.intel.find(r => r.id === b.id); if (a && JSON.stringify(a) !== JSON.stringify(b)) must(await svc.from('hk_domain_intel').update(b).eq('id', b.id)); }
    must(await svc.from('hk_member_prefs').update({ last_seen_at: before.seen }).eq('business_id', hk.id).eq('user_id', jackId));
    const intelNow = await intelRows(), seenNow = await prefsSeen();
    const moved = HK_TABLES.filter(t => before.counts[t] !== after.counts[t]).map(t => `${t} ${before.counts[t]} -> ${after.counts[t]}`);
    if (moved.length) throw new Error(`counts moved: ${moved.join(', ')}`);
    if (JSON.stringify(intelNow) !== JSON.stringify(before.intel)) throw new Error('hk_domain_intel not back to its snapshot');
    if (seenNow !== before.seen) throw new Error('hk_member_prefs.last_seen_at not restored');
    const usageAdded = after.usage - before.usage;
    if (usageAdded !== (REPLAY || DRY ? 0 : 1)) throw new Error(`expected ${REPLAY || DRY ? 0 : 1} hk_inbox_analyze usage row, got ${usageAdded}`);
    restored = true;
    line = `yes (${HK_TABLES.length} HumanKind counts identical; ${added.length} new hk_domain_intel row deleted; hk_member_prefs.last_seen_at + profiles.last_seen_at restored; ${usageAdded} business_anthropic_usage row KEPT as the spend record; sign-in rows kept by rule)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'stage3-report.json'), JSON.stringify({ ...results, restored, replay: REPLAY, when: new Date().toISOString() }, null, 2));
  console.log(`\nhkos-inbox-v2 Stage 3 live check: ${passed}/${results.checks.length} passed · Claude ${REPLAY || DRY ? 0 : analyzePosts.length} · writes 0 (Analyze's own rows aside)\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
