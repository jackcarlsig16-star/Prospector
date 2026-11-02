// grow-today-workflow-v1 Stage 2 live check - "Your day" as Jack (ownerSession) on the REAL HumanKind workspace,
// localhost against the build, through the real wiring.
// SCOPE (declared): 0 Claude, 0 Apollo, 0 Gmail (Today reads today/day + jobs/today, both DB only; the shell's page-load
// sync POST is aborted). Writes: ONE Not today on the first pitch + its Undo (hk_member_prefs.rail, Jack's row), and ONE
// Mark handled + Undo only if Jack's day has a tracked reply. Every other non-GET is aborted. Restore: Jack's
// hk_member_prefs row (rail, updated_at, last_seen_at) and any reply row exactly; Activity rows are kept by rule.
// "restored" THROWS if a HumanKind count moved or a snapshot field differs. Runtime ~2 min, cap 5 min.
// Usage: node scripts/verify/grow-today-workflow-v1-stage2.mjs   (run npm run build first)
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
const { dayRoute } = await import('../../api/hk/todayDay.js');
const OUT = path.join(ROOT, '.screenshots', 'grow-today-workflow-v1');
const MOCK = path.join(ROOT, 'inbox', '2026-10-30-1335-grow-today-your-day-mock.png');
const PORT = 3994, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const HK_TABLES = ['hk_brands', 'hk_contacts', 'hk_touches', 'hk_replies', 'hk_ignored_senders', 'hk_sync_runs', 'hk_job_runs', 'hk_settings', 'hk_import_runs', 'hk_domain_intel', 'hk_signals', 'hk_member_prefs', 'hk_brand_threads'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const must = r => { if (r.error) throw new Error(r.error.message); return r; };
const hk = (await svc.from('businesses').select('id, features').eq('name', 'HumanKind')).data?.find(b => b.features?.hk_sales);
if (!hk) { console.log('ABORT: no HumanKind workspace with hk_sales on'); process.exit(1); }
const counts = async () => { const o = {}; for (const t of HK_TABLES) o[t] = must(await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', hk.id)).count; return o; };
const jackId = must(await svc.from('profiles').select('id').eq('is_platform_owner', true)).data[0].id;
const prefsRow = async () => must(await svc.from('hk_member_prefs').select('*').eq('business_id', hk.id).eq('user_id', jackId).maybeSingle()).data;
const apiDay = async () => { let body = null, code = 200; await dayRoute({ params: { businessId: hk.id }, query: {}, body: {}, auth: { user: { id: jackId } } }, { status(c) { code = c; return this; }, json(b) { body = b; return this; } }, { supabase: svc }); if (code !== 200) throw new Error(`today/day ${code} ${JSON.stringify(body)}`); return body; };
const before = { counts: await counts(), prefs: await prefsRow() };
const day0 = await apiDay();
log('before', JSON.stringify({ left: day0.left, total: day0.total, steps: day0.steps.map(s => `${s.key} ${s.left}/${s.done.n}`), coming: day0.coming_up.length }));
const replyItem = day0.steps.find(s => s.key === 'replies')?.items.find(i => i.kind === 'reply') || null;
const replySnap = replyItem ? must(await svc.from('hk_replies').select('*').eq('id', replyItem.reply_id).single()).data : null;
let srv, browser, owner;
const blocked = [], realCalls = [], posts = [], gets = [];
const results = { checks: [], errors: [], axe: {}, contrast: {}, numbers: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 5 * 60000 });
fs.mkdirSync(OUT, { recursive: true });
const ALLOW = [[/\/today\/not-today$/, 'not-today', 2], [/\/replies\/[^/]+$/, 'reply', 2]];

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  async function open(width, { viewer = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 760 ? 844 : 900 }, hasTouch: width < 760, permissions: ['clipboard-read', 'clipboard-write'] });
    await ctx.addInitScript(([k, v]) => { try { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); localStorage.setItem('prospector_auto_assay_disabled', '1'); } catch { /* sandboxed frame */ } }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session)]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url()), m = req.method();
      if (/anthropic\.com$|apollo\.io$|googleapis\.com$/.test(u.host) && !/fonts/.test(u.host)) realCalls.push(`${m} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      if (isLocal && m === 'GET' && /^\/api\/hk\//.test(u.pathname)) gets.push(u.pathname.replace(/^\/api\/hk\/[^/]+/, ''));
      const allow = isLocal && !viewer && (m === 'POST' || m === 'PATCH') && ALLOW.find(([re]) => re.test(u.pathname));
      if (allow) {
        posts.push(allow[1]);
        if (posts.filter(p => p === allow[1]).length > allow[2]) { blocked.push(`${m} ${allow[1]} (over cap)`); return route.abort(); }
        return route.continue();
      }
      const deny = (isLocal && m !== 'GET' && /^\/(api|proxy)\//.test(u.pathname)) || (isSupa && m !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${m} ${u.pathname.replace(hk.id, '<hk>')}`); return route.abort(); }
      if (viewer && isLocal && /^\/api\/hk\/[^/]+\/shell$/.test(u.pathname)) { const r = await route.fetch(); const j = await r.json(); return route.fulfill({ response: r, json: { ...j, me: { ...j.me, role: 'viewer' } } }); }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(30000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    await page.goto(`${BASE}/`);
    if (width < 900) { await page.getByRole('button', { name: 'Open menu' }).click().catch(() => {}); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 20000 }); await page.getByLabel('Workspace').selectOption({ label: 'HumanKind' });
    await page.locator('[data-hk-shell] [data-hk-avatar]').waitFor({ timeout: 20000 });
    await page.evaluate(() => { window.location.hash = '#hk/today'; });
    await page.locator('[data-hk-progress]').waitFor({ timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(600);
    return { ctx, page, errors };
  }
  const shot = (page, n, full = true) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide', fullPage: full });
  const measure = async (page, key, scope) => {
    const m = await page.evaluate(measureScript({ scope }));
    if (m.error) { ok(`contrast ${key}`, false, m.error); return; }
    const s = summarize(m); results.contrast[key] = s;
    ok(`contrast ${key}: 0 text < 4.5:1 (text ${s.textFails}/${s.texts}; control edges, reported only: ${s.controlFails}/${s.controls})`, s.textFails === 0, s.worst.slice(0, 6).map(w => `${w.ratio} ${w.kind === 'text' ? `T ${w.fg} on ${w.bg}` : `C via ${w.via}`} ${w.sel} "${w.text}"`).join(' | '));
  };
  const axeOn = async (page, key, sel) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async s => { const r = await window.axe.run(document.querySelector(s), { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); }, sel);
    results.axe[key] = v;
    ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v).slice(0, 400));
  };
  const noSideways = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const sideBySide = async (shotName, width) => {
    const p = await browser.newPage({ viewport: { width: 2 * 1500, height: 1000 } });
    const b64 = f => `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`;
    await p.setContent(`<body style="margin:0;display:flex;gap:16px;background:#ddd;font:14px sans-serif"><figure style="margin:0;flex:1"><figcaption>mockup (inbox/2026-10-30-1335-grow-today-your-day-mock.png, sample data)</figcaption><img src="${b64(MOCK)}" style="width:100%"></figure><figure style="margin:0;flex:1"><figcaption>build @ ${width}, Jack's real day</figcaption><img src="${b64(`${OUT}/${shotName}.png`)}" style="width:100%"></figure></body>`);
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${OUT}/side-by-side-${width}.png`, fullPage: true });
    await p.close();
  };
  const TODAY = '[data-hk-today]';

  // ---- 1440: numbers against today/day read in-process from the DB; badge; toggle hidden; Not today + Undo; N2.
  {
    const { ctx, page, errors } = await open(1440);
    const ui = await page.evaluate(() => ({
      line: document.querySelector('[data-hk-day-line]')?.textContent,
      progress: document.querySelector('[data-hk-progress]')?.textContent,
      steps: [...document.querySelectorAll('[data-hk-step], [data-hk-step-done]')].map(e => e.getAttribute('data-hk-step') || `done:${e.getAttribute('data-hk-step-done')}`),
      items: Object.fromEntries([...document.querySelectorAll('[data-hk-step]')].map(e => [e.getAttribute('data-hk-step'), e.querySelectorAll('[data-hk-day-item]').length])),
      badge: [...document.querySelectorAll('.hk-nav__item')].find(e => /Today/.test(e.textContent))?.querySelector('.hk-nav__badge')?.textContent || null,
      toggle: !!document.querySelector('[data-hk-shell] [aria-label="Whose work"]'),
      coming: document.querySelectorAll('[data-hk-coming-up] .hk-day__cu').length,
    }));
    const d = await apiDay();
    results.numbers.ui = ui; results.numbers.db = { left: d.left, done: d.done, total: d.total, steps: d.steps.map(s => [s.key, s.left, s.done.n]), coming: d.coming_up.map(c => `${c.kind} ${c.brand_name} ${c.date}`), want: d.want_more };
    const wantSteps = d.steps.map(s => (s.collapsed ? `done:${s.key}` : s.key));
    ok(`steps in order = the DB day (${ui.steps.join(' · ')})`, JSON.stringify(ui.steps) === JSON.stringify(wantSteps), JSON.stringify(wantSteps));
    ok(`items per open step = the DB day (${JSON.stringify(ui.items)})`, d.steps.filter(s => !s.collapsed).every(s => ui.items[s.key] === s.items.length), JSON.stringify(d.steps.map(s => [s.key, s.items.length])));
    ok(`progress "${ui.progress}" = ${d.done} of ${d.total}, pitched ${d.progress.pitched}/${d.progress.pitch_goal}`, ui.progress.includes(`${d.done} of ${d.total} done`) && ui.progress.includes(`Pitched ${d.progress.pitched}/${d.progress.pitch_goal}`) && ui.progress.includes(`Replies answered ${d.progress.replies_answered}/${d.progress.replies_total}`));
    ok(`Today badge ${ui.badge ?? 'none'} = items left ${d.left}`, (d.left ? String(d.left) : null) === ui.badge);
    ok(`header line: ${ui.line}`, /your day has \d+ things?, about \d+ minutes · daily check (ran|last ran|has not)/.test(ui.line || ''));
    ok('owner toggle hidden on Today; "Showing your day" shown', !ui.toggle && /Showing your day/.test(await page.locator(TODAY).textContent()));
    ok(`Coming up shows ${ui.coming} = the DB's ${d.coming_up.length}`, ui.coming === d.coming_up.length);
    const firstPitch = d.steps.find(s => s.key === 'pitches')?.items[0];
    if (firstPitch) {
      const g = () => page.evaluate(() => [...document.querySelectorAll('[data-hk-step]')].map(e => Math.round(e.getBoundingClientRect().top + window.scrollY)));
      const g0 = await g();
      await page.locator(`[data-hk-day-item="pitch:${firstPitch.brand_id}"]`).hover(); await page.waitForTimeout(200);
      ok('N2: hovering an item moves nothing', JSON.stringify(g0) === JSON.stringify(await g()));
      await page.getByRole('button', { name: `Not today: ${firstPitch.brand_name}` }).click();
      await page.locator('[data-hk-toast]').waitFor();
      await page.locator(`[data-hk-day-item="pitch:${firstPitch.brand_id}"]`).waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
      const gone = await page.locator(`[data-hk-day-item="pitch:${firstPitch.brand_id}"]`).count();
      const mid = (await prefsRow())?.rail?.today_hidden;
      ok(`Not today: ${firstPitch.brand_name} leaves the list (${gone === 0}); DB today_hidden ${JSON.stringify(mid?.brand_ids)}`, gone === 0 && mid?.brand_ids?.includes(firstPitch.brand_id));
      await shot(page, 'today-1440-not-today', false);
      await page.locator('[data-hk-toast-undo]').click();
      await page.locator(`[data-hk-day-item="pitch:${firstPitch.brand_id}"]`).waitFor({ timeout: 15000 });
      ok(`Undo: ${firstPitch.brand_name} is back; DB list ${JSON.stringify((await prefsRow())?.rail?.today_hidden?.brand_ids)}`, !((await prefsRow())?.rail?.today_hidden?.brand_ids || []).includes(firstPitch.brand_id));
    } else ok('no pitch on Jack\'s day right now - Not today not exercised', true);
    if (replyItem) {
      await page.locator(`[data-hk-day-item="reply:${replyItem.reply_id}"] [data-hk-mark-handled]`).click();
      await page.locator('[data-hk-toast-undo]').click();
      await page.locator(`[data-hk-day-item="reply:${replyItem.reply_id}"]`).waitFor({ timeout: 15000 });
      const r = must(await svc.from('hk_replies').select('handled').eq('id', replyItem.reply_id).single()).data;
      ok(`Mark handled + Undo on ${replyItem.brand_name}: open again (${!r.handled})`, !r.handled);
    } else ok('no tracked reply on Jack\'s day - Mark handled not exercised (threads clear when Gmail sees the reply)', true);
    await page.mouse.move(5, 5); await page.waitForTimeout(8500);
    await shot(page, 'today-1440');
    await sideBySide('today-1440', 1440);
    await measure(page, 'today@1440', TODAY);
    await axeOn(page, 'today@1440', TODAY);
    ok('1440: no sideways scroll; 0 page errors', await noSideways(page) && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  for (const w of [1280, 390]) {
    const { ctx, page, errors } = await open(w);
    await shot(page, `today-${w}`);
    await sideBySide(`today-${w}`, w);
    await measure(page, `today@${w}`, TODAY);
    await axeOn(page, `today@${w}`, TODAY);
    if (w === 390) {
      const sticky = await page.locator('[data-hk-progress]').evaluate(e => getComputedStyle(e).position);
      const oneCol = await page.evaluate(() => getComputedStyle(document.querySelector('.hk-day__grid')).gridTemplateColumns.split(' ').length);
      ok(`390: progress card ${sticky}, ${oneCol} column`, sticky === 'sticky' && oneCol === 1);
    }
    ok(`${w}: no sideways scroll, 0 page errors`, await noSideways(page) && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await open(1440, { viewer: true });
    const writes = await page.locator(`${TODAY} [data-hk-mark-handled], ${TODAY} [data-hk-pitch], ${TODAY} [data-hk-not-today], ${TODAY} [data-hk-dm-sent], ${TODAY} [data-hk-pitch-all], ${TODAY} [data-hk-skip-touch], ${TODAY} [data-hk-draft-it]`).count();
    await shot(page, 'today-1440-viewer');
    ok(`Viewer (role forced in /shell): the day reads; ${writes} action controls; 0 page errors`, writes === 0 && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  const gmailGets = gets.filter(p => /\/inbox\/threads|\/gmail\/(?!status)/.test(p));
  results.numbers.gmail = { today_gets: [...new Set(gets)].filter(p => /today/.test(p)), gmail_gets: gmailGets.length };
  ok(`Gmail: one Today load = ${[...new Set(gets)].filter(p => /today/.test(p)).join(' + ')} (DB only), ${gmailGets.length} Gmail-reading calls, 0 units; browser reached 0 Claude / Apollo / Google API hosts; writes ${JSON.stringify(posts.reduce((m, p) => ({ ...m, [p]: (m[p] || 0) + 1 }), {}))}; aborted ${[...new Set(blocked)].slice(0, 6).join(', ') || 'none'}`,
    !realCalls.length && gmailGets.length === 0);
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    const p0 = before.prefs;
    if (p0) must(await svc.from('hk_member_prefs').update({ rail: p0.rail, updated_at: p0.updated_at, last_seen_at: p0.last_seen_at }).eq('business_id', hk.id).eq('user_id', jackId));
    else must(await svc.from('hk_member_prefs').delete().eq('business_id', hk.id).eq('user_id', jackId));
    if (replySnap) must(await svc.from('hk_replies').update({ handled: replySnap.handled, handled_at: replySnap.handled_at, handled_by: replySnap.handled_by }).eq('id', replySnap.id));
    const same = (a, b) => Object.keys(a).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]) && !(typeof a[k] === 'string' && Date.parse(a[k]) === Date.parse(b[k])));
    if (p0) { const diff = same(p0, await prefsRow()); if (diff.length) throw new Error(`hk_member_prefs fields differ: ${diff.join(', ')}`); }
    if (replySnap) { const diff = same(replySnap, must(await svc.from('hk_replies').select('*').eq('id', replySnap.id).single()).data); if (diff.length) throw new Error(`reply fields differ: ${diff.join(', ')}`); }
    const after = await counts();
    const moved = HK_TABLES.filter(t => before.counts[t] !== after[t]).map(t => `${t} ${before.counts[t]} -> ${after[t]}`);
    if (moved.length) throw new Error(`counts moved: ${moved.join(', ')}`);
    restored = true;
    line = `yes (Jack's hk_member_prefs row restored field by field${replySnap ? ' + the reply row' : ''}; ${HK_TABLES.length} HumanKind counts identical; Activity + sign-in rows kept by rule)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'stage2-report.json'), JSON.stringify({ ...results, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\ngrow-today-workflow-v1 Stage 2 live check: ${passed}/${results.checks.length} passed · Claude 0 · Apollo 0\nnumbers: ${JSON.stringify(results.numbers)}\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
