// grow-inbox-intel-v1 REV3 Stage 3 live check - as Jack (ownerSession) on the REAL HumanKind workspace, localhost
// against the build, through the real wiring. Grow > Inbox opens on Briefing: tiles, Send these 10 (compared to the
// same scorer run here on the DB), Important now (top 7 of the Needs-you rows the Inbox already loaded), Waiting on
// them, the Signals panel; Needs you by importance with why chips (and Newest), N2; the brand page reach line;
// Settings > Pitch research controls; 1440 / 1280 / 390, contrast, axe; a Viewer pass (role forced in /shell).
// SCOPE (declared): Gmail = the Inbox list only (<= 2 pages, the efc26b2 load: 930 units measured then); every later
// view inside 120 s is the server cache (0). Claude: exactly ONE call - "Run research now" with the day's N set to 1,
// on the #1 Send-these-10 card with no domain (STANDARD, web_search <= 3, ~$0.05); --replay serves the saved reply
// (.screenshots/grow-inbox-intel-v1/research-reply.json) and makes 0 calls. Use is NEVER clicked. 0 Apollo. Every other
// non-GET to /api, /proxy and Supabase REST is aborted (page-load jobs, sync, signals seen), as is every outside host
// but Google Fonts. Restore: hk_settings.intel back to its snapshot exactly (N), hk_member_prefs.last_seen_at and
// profiles.last_seen_at. KEPT, by rule: the research row (hk_domain_intel), the brand's suggested website, the fit
// signal, the sweep's hk_job_runs row, its business_anthropic_usage row, hk_events, sign-in rows. "restored" THROWS if
// anything else moved. Runtime ~3 min, cap 300 s.
// Usage: node scripts/verify/grow-inbox-intel-v1-stage3.mjs [--replay]   (run npm run build first)
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
const { loadIntel, firstNameOf } = await import('../../api/hk/intelData.js');
const { rankReach } = await import('../../api/hk/intelScore.js');
const { sweepQueue, sweepToday } = await import('../../api/hk/researchSweep.js');
const { dayIn } = await import('../../api/hk/jobs/plan.js');
const REPLAY = process.argv.includes('--replay');
// --dry: a synthetic sweep answer (not saved), 0 Claude, N never changed - to shake the page checks out first.
const DRY = process.argv.includes('--dry');
const FAKE = REPLAY || DRY;
const OUT = path.join(ROOT, '.screenshots', 'grow-inbox-intel-v1');
const REPLY_FILE = path.join(OUT, 'research-reply.json');
const PORT = 3996, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const HK_TABLES = ['hk_brands', 'hk_contacts', 'hk_touches', 'hk_replies', 'hk_ignored_senders', 'hk_sync_runs', 'hk_job_runs', 'hk_settings', 'hk_import_runs', 'hk_domain_intel', 'hk_signals'];
const KEPT = new Set(['hk_job_runs', 'hk_domain_intel', 'hk_signals']);
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const must = r => { if (r.error) throw new Error(r.error.message); return r; };
const hk = (await svc.from('businesses').select('id, features').eq('name', 'HumanKind')).data?.find(b => b.features?.hk_sales);
if (!hk) { console.log('ABORT: no HumanKind workspace with hk_sales on'); process.exit(1); }
if (REPLAY && !fs.existsSync(REPLY_FILE)) { console.log(`ABORT: --replay needs ${REPLY_FILE}`); process.exit(1); }
const now0 = new Date();
const minsToSix = ((6 - (now0.getHours() % 6)) % 6) * 60 - now0.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now0.getHours() % 6 === 0 && now0.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
const counts = async () => { const o = {}; for (const t of HK_TABLES) o[t] = must(await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', hk.id)).count; return o; };
const usage = async () => must(await svc.from('business_anthropic_usage').select('*', { count: 'exact', head: true }).eq('business_id', hk.id).eq('call_type', 'hk_research_sweep')).count;
const settingsIntel = async () => must(await svc.from('hk_settings').select('intel').eq('business_id', hk.id).maybeSingle()).data?.intel ?? null;
const jackId = must(await svc.from('profiles').select('id').eq('is_platform_owner', true)).data[0].id;
const prefsSeen = async () => must(await svc.from('hk_member_prefs').select('last_seen_at').eq('business_id', hk.id).eq('user_id', jackId).maybeSingle()).data?.last_seen_at ?? null;
const before = { counts: await counts(), usage: await usage(), intel: await settingsIntel(), seen: await prefsSeen() };
// What the scorer says on the DB right now (the same code the route runs).
const data0 = await loadIntel(svc, hk.id, new Date());
const top = rankReach(data0.brands, { ...data0, meId: jackId, now: new Date() }, { meFirstName: firstNameOf(data0, jackId), limit: 10 });
const day = dayIn(new Date(), data0.settingsRow.timezone || 'America/Chicago');
const swept = await sweepToday(svc, hk.id, day);
const queue = sweepQueue(data0, { meIds: [jackId], senders: [], now: new Date() });
const firstNoDomain = top.find(r => !r.brand.domain)?.brand || null;
log('before', JSON.stringify({ ...before.counts, usage: before.usage, top1: top[0]?.brand.name, firstNoDomain: firstNoDomain?.name, queue0: queue[0]?.brand.name, sweptToday: swept.calls }));
if (!FAKE && swept.calls > 0) { console.log(`ABORT: the sweep already ran ${swept.calls} research today - N=1 would refuse; not spending.`); process.exit(1); }
if (!firstNoDomain || queue[0]?.brand.id !== firstNoDomain.id) { console.log(`ABORT: the sweep would research ${queue[0]?.brand.name}, not the #1 card with no domain (${firstNoDomain?.name}) - not spending.`); process.exit(1); }

let srv, browser, owner, nSet = false;
const blocked = [], realCalls = [], sweepPosts = [], listLoads = [];
const results = { checks: [], errors: [], axe: {}, contrast: {}, n2: {}, numbers: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 300000 });
fs.mkdirSync(OUT, { recursive: true });

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  const SWEEP = new RegExp(`^/api/hk/${hk.id}/jobs/research-sweep$`);
  let briefBody = null, sweepBody = null;
  async function open(width, { viewer = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 760 ? 844 : 900 }, hasTouch: width < 760 });
    await ctx.addInitScript(([k, v]) => { try { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); localStorage.setItem('prospector_auto_assay_disabled', '1'); } catch { /* sandboxed frame */ } }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session)]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      if (isLocal && req.method() === 'POST' && SWEEP.test(u.pathname) && !viewer) {
        sweepPosts.push(u.pathname);
        if (DRY) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ run: { id: 'dry' }, counts: { calls: 1, researched: 1, cost_usd: 0, stopped: 'daily count' } }) });
        if (REPLAY) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(JSON.parse(fs.readFileSync(REPLY_FILE, 'utf8')).response) });
        if (sweepPosts.length > 1) { blocked.push('POST research-sweep (second)'); return route.abort(); }
        return route.continue();
      }
      const deny = (isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname)) || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.pathname.replace(hk.id, '<hk>')}`); return route.abort(); }
      if (viewer && isLocal && /^\/api\/hk\/[^/]+\/shell$/.test(u.pathname)) { const r = await route.fetch(); const j = await r.json(); return route.fulfill({ response: r, json: { ...j, me: { ...j.me, role: 'viewer' } } }); }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(30000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    page.on('response', async r => {
      const p = new URL(r.url()).pathname;
      if (/\/inbox\/threads$/.test(p) && r.request().method() === 'GET' && r.ok()) { const j = await r.json().catch(() => null); if (j?.tab === 'inbox') listLoads.push({ width, units: j.from_cache ? 0 : j.gmail_units, calls: j.from_cache ? 0 : j.gmail_calls, rows: j.threads.length, cached: !!j.from_cache, threads: j.threads }); }
      if (/\/briefing$/.test(p) && r.ok() && !briefBody) briefBody = await r.json().catch(() => null);
      if (SWEEP.test(p) && r.ok()) sweepBody = await r.json().catch(() => null);
    });
    await page.goto(`${BASE}/`);
    if (width < 900) { await page.getByRole('button', { name: 'Open menu' }).click().catch(() => {}); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 20000 }); await page.getByLabel('Workspace').selectOption({ label: 'HumanKind' });
    await page.locator('[data-hk-shell] [data-hk-avatar]').waitFor({ timeout: 20000 });
    const nav = page.locator('[data-hk-nav="inbox"]');
    if (await nav.count() && await nav.first().isVisible()) await nav.first().click();
    else { await page.locator('[data-hk-tab="more"]').click(); await page.locator('[data-hk-more]').getByRole('button', { name: 'Inbox', exact: true }).click(); }
    await page.locator('[data-hk-briefing] [data-hk-section="send"]').waitFor({ timeout: 60000 });
    await page.locator('[data-hk-section="important"] [data-hk-important], [data-hk-section="important"] p').first().waitFor({ timeout: 90000 });
    await page.waitForFunction(() => !/Reading your Gmail/.test(document.querySelector('[data-hk-section="important"]')?.textContent || ''), null, { timeout: 90000 });
    // The W3 auto-fill may fetch a second Inbox page; let it land before anything is compared.
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(800);
    return { ctx, page, errors };
  }
  const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide', fullPage: true });
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

  // ---- 1440: Briefing vs the DB, Important now, research once, Needs you sort + N2, brand page, settings.
  {
    const { ctx, page, errors } = await open(1440);
    const send = briefBody?.send || [];
    results.numbers.top10 = send.map(c => ({ name: c.name, score: c.score, why: c.why }));
    ok(`real wiring: Send these 10 = the scorer on the DB (${send.map(c => `${c.name} ${c.score}`).join(' · ')}); ${briefBody?.eligible} eligible; no "@"`,
      send.length === top.length && send.every((c, i) => c.id === top[i].brand.id && c.score === top[i].score) && !JSON.stringify(briefBody).includes('@'));
    const cards = await page.locator('[data-hk-send-card]').count();
    ok(`1440 Briefing is the default lane; ${cards} cards; tiles ${await page.locator('[data-hk-tile]').count()}; Waiting / Signals sections present`, (await page.getByRole('tab', { name: 'Briefing' }).getAttribute('aria-selected')) === 'true' && cards === send.length && (await page.locator('[data-hk-section="waiting"]').count()) === 1 && (await page.locator('[data-hk-section="signals"], [data-hk-briefing]').count()) >= 1);
    const fresh = listLoads.filter(l => !l.cached);
    const units = fresh.reduce((n, l) => n + l.units, 0), gcalls = fresh.reduce((n, l) => n + l.calls, 0);
    const uniq = ts => { const seen = new Set(); return ts.filter(t => (seen.has(t.thread_id) ? false : seen.add(t.thread_id))); };
    const rows = uniq(listLoads.filter(l => l.width === 1440).flatMap(l => l.threads));
    const ny = rows.filter(t => t.lane === 'needs_you' && t.importance);
    const imp = [...ny].sort((a, b) => b.importance.score - a.importance.score).slice(0, 7);
    results.numbers.gmail = { pages: fresh.length, units, calls: gcalls, efc26b2_units: 930 };
    results.numbers.top7 = imp.map(t => ({ from: t.from_name, score: t.importance.score, why: t.importance.why }));
    const shown = await page.locator('[data-hk-important]').evaluateAll(es => es.map(e => e.dataset.hkImportant));
    ok(`Important now = the top ${imp.length} Needs-you rows by importance from the Inbox's own load (${imp.map(t => `${t.from_name} ${t.importance.score}`).join(' · ')})`, JSON.stringify(shown) === JSON.stringify(imp.map(t => t.thread_id)), `ui ${shown.join(',')} | want ${imp.map(t => t.thread_id).join(',')}`);
    ok(`Gmail: one Inbox open = ${fresh.length} list page(s), ${gcalls} calls, ${units} units (efc26b2 measured 930 for its two-page load; cap 1010); Briefing added 0`, fresh.length >= 1 && fresh.length <= 2 && units <= 1010);
    await shot(page, 'briefing-1440');
    await measure(page, 'briefing@1440', '[data-hk-briefing]');
    await axeOn(page, 'briefing@1440', '[data-hk-inbox]');

    // Run research now with N = 1: the ONE declared Claude call.
    if (!FAKE) { must(await svc.from('hk_settings').update({ intel: { ...(before.intel || {}), sweep: { ...((before.intel || {}).sweep || {}), n: 1 } } }).eq('business_id', hk.id)); nSet = true; }
    const resp = page.waitForResponse(r => SWEEP.test(new URL(r.url()).pathname), { timeout: 170000 });
    await page.locator('[data-hk-run-research]').click();
    await (await resp).finished();
    await page.locator('[data-hk-briefing-note]').waitFor({ timeout: 30000 });
    if (!FAKE) { must(await svc.from('hk_settings').update({ intel: before.intel }).eq('business_id', hk.id)); nSet = false; }
    const researched = must(await svc.from('hk_brands').select('id, name, domain, domain_suggested, domain_confidence, research_attempted_at').eq('id', firstNoDomain.id).single()).data;
    const intelRow = researched.domain_suggested ? must(await svc.from('hk_domain_intel').select('domain, intel, cost_usd, model, researched_at').eq('business_id', hk.id).eq('domain', researched.domain_suggested).maybeSingle()).data : null;
    if (!FAKE && sweepBody) {
      const saved = { response: sweepBody, brand: { name: researched.name, domain_suggested: researched.domain_suggested, domain_confidence: researched.domain_confidence, research_attempted_at: researched.research_attempted_at }, intel: intelRow };
      if (JSON.stringify(saved).includes('@')) throw new Error('research reply carries "@" - not saved');
      fs.writeFileSync(REPLY_FILE, JSON.stringify(saved, null, 1));
    }
    const rec = REPLAY ? JSON.parse(fs.readFileSync(REPLY_FILE, 'utf8')) : DRY ? { brand: { name: firstNoDomain.name, domain_suggested: null, domain_confidence: null }, intel: null, response: sweepBody } : { brand: researched, intel: intelRow, response: sweepBody };
    results.numbers.research = { brand: rec.brand.name, website: rec.brand.domain_suggested || null, confidence: rec.brand.domain_confidence || null, fit: rec.intel?.intel?.fit?.sponsor_fit || null, line: rec.intel?.intel?.company?.what_they_do || null, cost_usd: rec.response?.counts?.cost_usd, calls: rec.response?.counts?.calls, stopped: rec.response?.counts?.stopped };
    ok(`Run research now (${REPLAY ? 'replayed' : DRY ? 'dry' : 'ONE call'}, N 1): ${rec.brand.name} -> ${rec.brand.domain_suggested ? `website ${rec.brand.domain_suggested} (${rec.brand.domain_confidence})` : 'no website found'} · fit ${results.numbers.research.fit} · $${results.numbers.research.cost_usd}; the brand's own domain untouched; note "${await page.locator('[data-hk-briefing-note]').textContent()}"`,
      rec.response?.counts?.calls === 1 && (FAKE || (!researched.domain && (researched.domain_suggested || researched.research_attempted_at))) && sweepPosts.length === 1);
    ok(`hk_settings.intel restored to its snapshot right after the call (N back to ${before.intel?.sweep?.n ?? 'the default 10'})`, JSON.stringify(await settingsIntel()) === JSON.stringify(before.intel));
    await page.waitForTimeout(800);
    await shot(page, 'briefing-1440-researched');

    // Needs you: Importance order + why chips, Newest = Gmail order, N2 on opening a row.
    await page.getByRole('tab', { name: /^Needs you/ }).click();
    await page.locator('[data-hk-inbox-list] [data-hk-thread]').first().waitFor({ timeout: 30000 });
    const rowsNow = uniq(listLoads.filter(l => l.width === 1440).flatMap(l => l.threads));
    const byImp = await page.locator('[data-hk-inbox-list] [data-hk-thread]').evaluateAll(es => es.map(e => e.dataset.hkThread));
    const wantImp = [...rowsNow.filter(t => t.lane === 'needs_you')].sort((a, b) => (b.importance?.score || 0) - (a.importance?.score || 0)).map(t => t.thread_id);
    const chips = await page.locator('[data-hk-inbox-list] [data-hk-row-why]').count();
    ok(`Needs you sorts by importance by default (${byImp.length} rows) with ${chips} why chips`, JSON.stringify(byImp) === JSON.stringify([...new Set(wantImp)]) && chips > 0, `ui ${byImp.join(',')} | want ${[...new Set(wantImp)].join(',')} | loads ${listLoads.map(l => `${l.width}:${l.rows}:${l.cached}`).join(' ')}`);
    await page.locator('[data-hk-sort-by="newest"]').click();
    const byNew = await page.locator('[data-hk-inbox-list] [data-hk-thread]').evaluateAll(es => es.map(e => e.dataset.hkThread));
    ok('Newest restores the Gmail order', JSON.stringify(byNew) === JSON.stringify([...new Set(rowsNow.filter(t => t.lane === 'needs_you').map(t => t.thread_id))]));
    await page.locator('[data-hk-sort-by="importance"]').click();
    const pick = byImp[Math.min(2, byImp.length - 1)];
    const geo = () => page.evaluate(() => { const p = document.querySelector('[data-hk-inbox-list]'); const b = p.getBoundingClientRect(); return { y: window.scrollY, top: b.top, left: b.left, h: b.height, st: p.scrollTop }; });
    const g0 = await geo();
    await page.locator(`[data-hk-thread="${pick}"]`).dispatchEvent('click');
    await page.locator('[data-hk-inbox-thread] [data-hk-brand-panel]').waitFor({ timeout: 60000 }); await page.waitForTimeout(400);
    const g1 = await geo(); const move = Math.max(...['y', 'top', 'left', 'h', 'st'].map(k => Math.abs(g1[k] - g0[k])));
    results.n2.open = { g0, g1, move };
    ok(`N2 1440: opening a Needs-you row moves the list ${move} px and the page ${g1.y - g0.y} px`, move < 1);

    // Brand page: the reach line + the suggested website (Use present, NOT clicked).
    await page.getByRole('tab', { name: 'Briefing' }).click();
    const card = page.locator(`[data-hk-send-card="${firstNoDomain.id}"]`);
    await card.waitFor({ timeout: 30000 });
    const cardScore = await card.locator('[data-hk-send-score]').textContent();
    await card.getByRole('button', { name: 'Open brand' }).click();
    await page.locator(`[data-hk-brand-page="${firstNoDomain.id}"] [data-hk-reach-score]`).waitFor({ timeout: 30000 });
    const reach = await page.locator('[data-hk-reach-score]').textContent();
    const site = await page.locator('[data-hk-reach-site]').count();
    ok(`brand page reach line "${reach}" matches the card (${cardScore}); website suggestion ${site ? 'shown with Use (not clicked)' : 'none'}`, reach.startsWith(`Reach-out score ${cardScore.replace('Score ', '')}`) && (!researched.domain_suggested || (site === 1 && (await page.locator('[data-hk-reach-site] [data-hk-use-site]').count()) === 1)));
    await shot(page, 'brand-1440');
    await axeOn(page, 'brand@1440', '[data-hk-brand-page]');
    // Settings > Pitch: research controls + weights.
    await page.locator('[data-hk-nav="settings"]').click();
    await page.locator('[data-hk-shell] .hk-subnav').getByRole('button', { name: 'Pitch' }).click();
    await page.locator('[data-hk-intel-settings] [data-hk-weights]').waitFor({ timeout: 30000 });
    ok(`Settings > Pitch: target categories (${await page.locator('[data-hk-target-cats] .hk-chip').count()}), auto-research controls (N ${await page.getByLabel('Brands per day').inputValue()}), last run line, weights read-only (${await page.locator('[data-hk-weights] tr').count()} rows)`,
      (await page.getByLabel('Brands per day').inputValue()) === String(before.intel?.sweep?.n ?? 10) && (await page.locator('[data-hk-weights] tr').count()) === 14 && (FAKE ? /Last run|has not run yet/ : /Last run/).test(await page.locator('[data-hk-sweep-last]').textContent()));
    await shot(page, 'settings-1440');
    await axeOn(page, 'settings@1440', '[data-hk-intel-settings]');
    ok('1440 no sideways scroll; 0 page errors', await noSideways(page) && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  for (const w of [1280, 390]) {
    const { ctx, page, errors } = await open(w);
    await shot(page, `briefing-${w}`);
    await measure(page, `briefing@${w}`, '[data-hk-briefing]');
    await axeOn(page, `briefing@${w}`, '[data-hk-inbox]');
    ok(`${w} Briefing: ${await page.locator('[data-hk-send-card]').count()} cards, Important now rendered, no sideways scroll, 0 page errors`, (await page.locator('[data-hk-send-card]').count()) >= 1 && await noSideways(page) && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await open(1440, { viewer: true });
    const writes = await page.locator('[data-hk-send-claim], [data-hk-send-research-btn], [data-hk-use-site], [data-hk-run-research], [data-hk-signal-dismiss], [data-hk-target], [data-hk-pipeline]').count();
    ok(`Viewer: the Briefing reads (${await page.locator('[data-hk-send-card]').count()} cards) with no Claim / Research / Use / Run research now / Dismiss / list buttons (${writes}); 0 page errors`, writes === 0 && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  const fresh = listLoads.filter(l => !l.cached);
  results.numbers.gmail.all = { loads: listLoads.length, uncached: fresh.length, units: fresh.reduce((n, l) => n + l.units, 0) };
  ok(`browser reached 0 Claude / Apollo hosts directly; research-sweep posts ${sweepPosts.length} (cap 1); Gmail over the whole run ${results.numbers.gmail.all.units} units in ${fresh.length} uncached page(s) (cap 2100); other writes aborted (${[...new Set(blocked)].slice(0, 6).join(', ') || 'none attempted'})`,
    !realCalls.length && sweepPosts.length === 1 && results.numbers.gmail.all.units <= 2100);
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    if (nSet) must(await svc.from('hk_settings').update({ intel: before.intel }).eq('business_id', hk.id));
    must(await svc.from('hk_member_prefs').update({ last_seen_at: before.seen }).eq('business_id', hk.id).eq('user_id', jackId));
    const after = { counts: await counts(), usage: await usage(), intel: await settingsIntel(), seen: await prefsSeen() };
    const moved = HK_TABLES.filter(t => !KEPT.has(t) && before.counts[t] !== after.counts[t]).map(t => `${t} ${before.counts[t]} -> ${after.counts[t]}`);
    if (moved.length) throw new Error(`counts moved: ${moved.join(', ')}`);
    if (JSON.stringify(after.intel) !== JSON.stringify(before.intel)) throw new Error('hk_settings.intel not back to its snapshot');
    if (after.seen !== before.seen) throw new Error('hk_member_prefs.last_seen_at not restored');
    const kept = [...KEPT].map(t => `${t} +${after.counts[t] - before.counts[t]}`).join(', ');
    if (after.counts.hk_job_runs - before.counts.hk_job_runs !== (FAKE ? 0 : 1)) throw new Error(`expected ${FAKE ? 0 : 1} sweep run row, got ${after.counts.hk_job_runs - before.counts.hk_job_runs}`);
    if (after.usage - before.usage !== (FAKE ? 0 : 1)) throw new Error(`expected ${FAKE ? 0 : 1} hk_research_sweep usage row, got ${after.usage - before.usage}`);
    restored = true;
    line = `yes (${HK_TABLES.length - KEPT.size} HumanKind counts identical; hk_settings.intel = snapshot; last_seen_at restored; KEPT by rule: ${kept}, business_anthropic_usage +${after.usage - before.usage}, the brand's suggested website, hk_events, sign-in rows)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, DRY ? 'stage3-dry-report.json' : 'stage3-report.json'), JSON.stringify({ ...results, restored, replay: REPLAY, dry: DRY, when: new Date().toISOString() }, null, 2));
  console.log(`\ngrow-inbox-intel-v1 Stage 3 live check: ${passed}/${results.checks.length} passed · Claude ${FAKE ? 0 : sweepPosts.length} · Apollo 0\nnumbers: ${JSON.stringify({ top10: results.numbers.top10, top7: results.numbers.top7, research: results.numbers.research, gmail: results.numbers.gmail })}\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
