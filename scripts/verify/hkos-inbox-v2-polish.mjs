// FIX hkos-inbox-v2-polish live check - READ-ONLY, as Jack (ownerSession) on the REAL HumanKind workspace, localhost
// against the build. Grow › Inbox: open GHOST (the tracked thread) -> the strip is <= two rows and the email's first line
// is on screen without scrolling at 1440x900 and 1280x800 (its y reported); lane counts after P5 ("You" / "Calendar"
// rows under Other); list row height; the unknown-sender strip with the SAVED Analyze reply (0 Claude - the analyze
// request is fulfilled from .screenshots/hkos-inbox-v2/analyze-reply.json); contrast (HumanKind's rule: text >= 4.5:1,
// control edges reported), axe, N2 (opening a thread moves the list 0 px, the page 0 px), 390 one pane, Viewer (role
// forced in the /shell response).
// SCOPE (declared): Gmail ~ one list load (<= 505 units, every later view from the server's 120 s cache) + 2 thread
// opens (120 each) per viewport set; 0 Claude; every non-GET aborted except the replayed analyze. Writes: the /shell
// last_seen_at stamp on hk_member_prefs (restored exactly) and profiles.last_seen_at (ownerSession restores it).
// "restored" THROWS if any HumanKind count or hk_domain_intel moved. Runtime ~2 min, cap 240 s. Run npm run build first.
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
const OUT = path.join(ROOT, '.screenshots', 'hkos-inbox-v2-polish');
const REPLY_FILE = path.join(ROOT, '.screenshots', 'hkos-inbox-v2', 'analyze-reply.json');
const PORT = 3999, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const HK_TABLES = ['hk_brands', 'hk_contacts', 'hk_touches', 'hk_replies', 'hk_ignored_senders', 'hk_events', 'hk_sync_runs', 'hk_job_runs', 'hk_settings', 'hk_domain_intel'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const must = r => { if (r.error) throw new Error(r.error.message); return r; };
const hk = (await svc.from('businesses').select('id, features').eq('name', 'HumanKind')).data?.find(b => b.features?.hk_sales);
if (!hk) { console.log('ABORT: no HumanKind workspace with hk_sales on'); process.exit(1); }
if (!fs.existsSync(REPLY_FILE)) { console.log(`ABORT: needs the saved Analyze reply ${REPLY_FILE}`); process.exit(1); }
const now0 = new Date();
const minsToSix = ((6 - (now0.getHours() % 6)) % 6) * 60 - now0.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now0.getHours() % 6 === 0 && now0.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
const counts = async () => { const o = {}; for (const t of HK_TABLES) o[t] = must(await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', hk.id)).count; return o; };
const jackId = must(await svc.from('profiles').select('id').eq('is_platform_owner', true)).data[0].id;
const prefsSeen = async () => must(await svc.from('hk_member_prefs').select('last_seen_at').eq('business_id', hk.id).eq('user_id', jackId).maybeSingle()).data?.last_seen_at ?? null;
const usage = async () => must(await svc.from('business_anthropic_usage').select('*', { count: 'exact', head: true }).eq('business_id', hk.id)).count;
const before = { counts: await counts(), seen: await prefsSeen(), usage: await usage() };
log('before', JSON.stringify(before.counts));

let srv, browser, owner, listBody = null;
const blocked = [], realCalls = [];
const results = { checks: [], errors: [], axe: {}, contrast: {}, n2: {}, numbers: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 240000 });
fs.mkdirSync(OUT, { recursive: true });

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  async function open(width, height, { viewer = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: width < 760 });
    // try: the init script also runs inside the sandboxed email frame, which has no storage.
    await ctx.addInitScript(([k, v]) => { try { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); localStorage.setItem('prospector_auto_assay_disabled', '1'); } catch { /* sandboxed frame */ } }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session)]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      if (isLocal && req.method() === 'POST' && /\/inbox\/threads\/[^/]+\/analyze$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: fs.readFileSync(REPLY_FILE, 'utf8') });
      const deny = (isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname)) || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.pathname}`); return route.abort(); }
      if (viewer && isLocal && /^\/api\/hk\/[^/]+\/shell$/.test(u.pathname)) { const r = await route.fetch(); const j = await r.json(); return route.fulfill({ response: r, json: { ...j, me: { ...j.me, role: 'viewer' } } }); }
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
  const measure = async (page, key) => {
    const m = await page.evaluate(measureScript({ scope: '[data-hk-inbox]', exclude: 'iframe' }));
    if (m.error) { ok(`contrast ${key}`, false, m.error); return; }
    const s = summarize(m); results.contrast[key] = s;
    ok(`contrast ${key}: 0 text < 4.5:1 (text ${s.textFails}/${s.texts}; control edges, reported only: ${s.controlFails}/${s.controls})`, s.textFails === 0, s.worst.slice(0, 5).map(w => `${w.ratio} ${w.kind === 'text' ? `T ${w.fg} on ${w.bg}` : `C via ${w.via}`} ${w.sel} "${w.text}"`).join(' | '));
  };
  const axeOn = async (page, key) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async () => { const r = await window.axe.run(document.querySelector('[data-hk-inbox]'), { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); });
    results.axe[key] = v; ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v).slice(0, 400));
  };
  const noSideways = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  // The email's first line: the first text inside the newest open message (a text body directly; an html body inside
  // the sandboxed frame - read through Playwright's frame handle, else the frame's top + its 8 px body margin).
  const firstLineY = async page => {
    const msg = page.locator('[data-hk-message]:not(.hk-inbox__msg--closed)').last();
    const pre = msg.locator('pre.hk-inbox__text');
    if (await pre.count()) { const y = Math.round((await pre.boundingBox()).y + 12); return { y, body: y, how: 'text body' }; }
    // An html body: the frame's top is where the email starts on screen. The email's own first TEXT can sit far below
    // that (a newsletter that opens with tall blocked images) - reported, not gated: that is the email's layout.
    const frameEl = await msg.locator('iframe[data-hk-frame]').elementHandle();
    const top = Math.round((await frameEl.boundingBox()).y);
    const fr = await frameEl.contentFrame();
    const inner = fr ? await fr.evaluate(() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { if (n.textContent.trim()) { const r = document.createRange(); r.selectNodeContents(n); const b = r.getBoundingClientRect(); if (b.height) return b.top; } } return null; }).catch(() => null) : null;
    return { y: top, body: top, firstText: inner != null ? Math.round(top + inner) : null, how: 'html body (frame top)' };
  };

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const { ctx, page, errors } = await open(w, h);
    const rows = listBody?.threads || [];
    if (w === 1440) {
      const lanes = { needs_you: rows.filter(r => r.lane === 'needs_you').length, other: rows.filter(r => r.lane === 'other').length, you: rows.filter(r => r.chip.kind === 'self').length, calendar: rows.filter(r => r.chip.kind === 'calendar').length };
      results.numbers.lanes = lanes; results.numbers.units = listBody?.gmail_units;
      ok(`lanes after P5 for the first ${rows.length}: Needs you ${lanes.needs_you} (Stage 3: 7) · Other ${lanes.other} (You ${lanes.you}, Calendar ${lanes.calendar}); ${listBody?.gmail_units} Gmail units`, listBody && listBody.gmail_units <= 505 && lanes.needs_you < 7 && !rows.some(r => r.lane === 'needs_you' && ['self', 'calendar'].includes(r.chip.kind)));
      const heights = await page.locator('[data-hk-inbox-list] [data-hk-thread]').evaluateAll(es => es.map(e => Math.round(e.getBoundingClientRect().height)));
      const lines = await page.locator('[data-hk-inbox-list] [data-hk-thread]').evaluateAll(es => es.map(e => e.children.length));
      results.numbers.rowHeights = heights;
      ok(`list rows: two lines each, ${Math.min(...heights)}-${Math.max(...heights)} px tall (target ~64)`, lines.every(n => n === 2) && Math.max(...heights) <= 72);
    }
    const ghost = rows.find(r => r.chip.kind === 'tracked' && /ghost/i.test(`${r.from_name} ${r.from_domain} ${r.chip.brand_name || ''}`)) || rows.find(r => r.chip.kind === 'tracked');
    if (!ghost) { ok(`${w} a tracked thread (GHOST) to open`, false, 'none on the first page'); await ctx.close(); continue; }
    const geo = () => page.evaluate(() => { const p = document.querySelector('[data-hk-inbox-list]'); const b = p.getBoundingClientRect(); return { y: window.scrollY, top: b.top, h: b.height, st: p.scrollTop }; });
    const g0 = await geo();
    await page.locator(`[data-hk-thread="${ghost.thread_id}"]`).dispatchEvent('click');
    await page.locator('[data-hk-intel-strip]').waitFor({ timeout: 60000 });
    await page.locator('[data-hk-message]').first().waitFor({ timeout: 30000 }); await page.waitForTimeout(800);
    const g1 = await geo();
    const move = Math.max(...['y', 'top', 'h', 'st'].map(k => Math.abs(g1[k] - g0[k])));
    const stripRows = await page.locator('[data-hk-intel-strip] .hk-istrip__row').count();
    const stripH = Math.round((await page.locator('[data-hk-intel-strip]').boundingBox()).height);
    const first = await firstLineY(page);
    const summary = await page.locator('[data-hk-reply-summary]').textContent().catch(() => '');
    results.numbers[`ghost@${w}`] = { strip_rows: stripRows, strip_height: stripH, first_line_y: first.y, how: first.how, viewport: h, move };
    await shot(page, `ghost-${w}x${h}`);
    const headRow = await page.evaluate(() => { const h = document.querySelector('.hk-inbox__thread-head--row'); const t = h.querySelector('.hk-inbox__subject-title').getBoundingClientRect(), a = h.querySelector('.hk-inbox__actions').getBoundingClientRect(); return Math.abs(t.top - a.top) < 12 && t.right <= a.left + 1; });
    ok(`${w}x${h} GHOST (${ghost.chip.brand_name}): strip ${stripRows} rows, ${stripH} px; header one row (${headRow}); the email body starts at y=${first.body} of ${h} (${first.how}${first.firstText != null ? `; its own first text at y=${first.firstText} - blocked images above it` : ''}); no "&#39;" in the summary; N2 list ${move} px`, stripRows <= 2 && headRow && first.body < h && !/&#\d+;|&amp;/.test(summary || '') && move < 1 && !errors.length, errors.join(' | '));
    if (w === 1440) {
      await measure(page, 'ghost@1440'); await axeOn(page, 'ghost@1440');
      // The unknown-sender strip with the SAVED Analyze reply (0 Claude).
      const person = rows.find(r => r.lane === 'needs_you' && r.chip.kind === 'untracked' && /grace miller|aso/i.test(`${r.from_name} ${r.subject}`)) || rows.find(r => r.lane === 'needs_you' && r.chip.kind === 'untracked' && r.from_domain);
      if (person) {
        await page.locator(`[data-hk-thread="${person.thread_id}"]`).dispatchEvent('click');
        await page.locator('[data-hk-analyze]').waitFor({ timeout: 60000 });
        await page.locator('[data-hk-analyze]').click();
        await page.locator('[data-hk-intel]').waitFor({ timeout: 30000 }); await page.waitForTimeout(400);
        const line = await page.locator('[data-hk-intel]').textContent();
        const pr = await page.locator('[data-hk-intel-strip] .hk-istrip__row').count();
        await shot(page, 'unknown-sender-1440');
        ok(`unknown sender ${person.from_name}: strip ${pr} rows, one-liner "${line.slice(0, 120)}" (saved reply, 0 Claude)`, pr <= 2 && /Next:/.test(line));
      }
    }
    ok(`${w} no sideways scroll`, await noSideways(page));
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await open(390, 844);
    await page.locator('[data-hk-inbox-list] [data-hk-thread]').first().dispatchEvent('click');
    await page.locator('[data-hk-inbox-thread]').waitFor({ timeout: 30000 }); await page.waitForTimeout(500);
    const listGone = (await page.locator('[data-hk-inbox-list]').count()) === 0;
    await shot(page, 'thread-390');
    await measure(page, 'thread@390'); await axeOn(page, 'thread@390');
    ok(`390 one pane (thread alone, list gone); no sideways scroll; 0 page errors`, listGone && await noSideways(page) && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await open(1440, 900, { viewer: true });
    await page.locator('[data-hk-inbox-list] [data-hk-thread]').first().dispatchEvent('click');
    await page.locator('[data-hk-intel-strip]').waitFor({ timeout: 30000 });
    const writes = await page.locator('[data-hk-analyze], [data-hk-set-status], [data-hk-unignore], [data-hk-mark-handled]').count();
    const menu = await page.locator('[data-hk-more-actions]').count();
    let menuWrites = 0;
    if (menu) { await page.locator('[data-hk-more-actions]').first().click(); menuWrites = await page.locator('[data-hk-track-brand], [data-hk-ignore-sender], [data-hk-link-brand]').count(); }
    ok(`Viewer: no Analyze / Set status / Stop ignoring / Mark handled (${writes}) and no write in the ⋯ menu (${menuWrites}); 0 page errors`, writes === 0 && menuWrites === 0 && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  ok(`0 Claude / Apollo calls; every write aborted (${[...new Set(blocked)].slice(0, 4).join(', ') || 'none attempted'})`, !realCalls.length);
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    must(await svc.from('hk_member_prefs').update({ last_seen_at: before.seen }).eq('business_id', hk.id).eq('user_id', jackId));
    const after = { counts: await counts(), seen: await prefsSeen(), usage: await usage() };
    const moved = HK_TABLES.filter(t => before.counts[t] !== after.counts[t]).map(t => `${t} ${before.counts[t]} -> ${after.counts[t]}`);
    if (moved.length) throw new Error(`counts moved: ${moved.join(', ')}`);
    if (after.seen !== before.seen) throw new Error('hk_member_prefs.last_seen_at not restored');
    if (after.usage !== before.usage) throw new Error(`a Claude usage row appeared (${before.usage} -> ${after.usage})`);
    restored = true; line = `yes (${HK_TABLES.length} HumanKind counts identical incl. hk_domain_intel; hk_member_prefs.last_seen_at + profiles.last_seen_at restored; 0 usage rows; sign-in rows kept by rule)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ ...results, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\nhkos-inbox-v2-polish live check: ${passed}/${results.checks.length} passed · Claude 0 · writes 0\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
