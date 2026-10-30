// grow-ui-refresh-v1 REV2 Stage 3a live check - the new Briefing (U1-U5) as Jack (ownerSession) on the REAL HumanKind
// workspace, localhost against the build, through the real wiring.
// SCOPE (declared): Claude = "Research the 10" on the current top 10 that need research: at most 10 STANDARD calls
// (web_search <= 3 each, ~$0.035-0.06 each, est. $0.35-0.60), inside the $1/day cap, through the button (estimate,
// then one request per brand). The replies are saved to .screenshots/grow-ui-refresh-v1/research-replies.json and
// --replay serves them (0 calls). 0 Apollo. Gmail = the Inbox list the Briefing sits in (<= 2 pages per uncached open,
// ~930 units measured; cap 2100 over the run). Writes allowed through the UI: research/batch (<= 11 posts), ONE Pitch +
// Undo (only if a Ready row exists after research), ONE Snooze + Undo, ONE Not a fit + Undo; every other non-GET to
// /api, /proxy and Supabase REST is aborted. Restore: the Pitch / Snooze / Not-a-fit brand rows back to their
// snapshots exactly (incl. updated_at), hk_member_prefs.last_seen_at, profiles.last_seen_at. KEPT, by rule: the
// research rows (hk_domain_intel, the brands' suggested websites / research_attempted_at, fit signals,
// business_anthropic_usage), hk_events, sign-in rows. "restored" THROWS if anything else moved.
// Runtime ~8-12 min (research ~30-60 s a brand), cap 25 min.
// Usage: node scripts/verify/grow-ui-refresh-v1-stage3a.mjs [--replay]   (run npm run build first)
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
const { rankReach, intelFor } = await import('../../api/hk/intelScore.js');
const { usedToday } = await import('../../api/hk/inboxAnalyze.js');
const { dayIn } = await import('../../api/hk/jobs/plan.js');
const REPLAY = process.argv.includes('--replay');
const OUT = path.join(ROOT, '.screenshots', 'grow-ui-refresh-v1');
const REPLY_FILE = path.join(OUT, 'research-replies.json');
const MOCK = path.join(ROOT, 'inbox', '2026-10-30-0920-grow-ui-refresh-mock-briefing.png');
const PORT = 3995, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const HK_TABLES = ['hk_brands', 'hk_contacts', 'hk_touches', 'hk_replies', 'hk_ignored_senders', 'hk_sync_runs', 'hk_job_runs', 'hk_settings', 'hk_import_runs', 'hk_domain_intel', 'hk_signals'];
const KEPT = new Set(['hk_domain_intel', 'hk_signals']);
const BRAND_FIELDS = ['owner_user_id', 'owner_unclear', 'status', 'pass_reason', 'snoozed_until', 'targeted_at', 'targeted_by', 'updated_at'];
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
const usage = async () => must(await svc.from('business_anthropic_usage').select('*', { count: 'exact', head: true }).eq('business_id', hk.id).in('call_type', ['hk_inbox_analyze', 'hk_research_sweep'])).count;
const jackId = must(await svc.from('profiles').select('id').eq('is_platform_owner', true)).data[0].id;
const prefsSeen = async () => must(await svc.from('hk_member_prefs').select('last_seen_at').eq('business_id', hk.id).eq('user_id', jackId).maybeSingle()).data?.last_seen_at ?? null;
const spentToday = async () => { const d = must(await svc.from('business_anthropic_usage').select('cost_usd, created_at').eq('business_id', hk.id).in('call_type', ['hk_inbox_analyze', 'hk_research_sweep']).gte('created_at', new Date(Date.now() - 2 * 864e5).toISOString())).data; const today = dayIn(new Date()); return d.filter(r => dayIn(new Date(r.created_at)) === today).reduce((n, r) => n + Number(r.cost_usd || 0), 0); };
const before = { counts: await counts(), usage: await usage(), seen: await prefsSeen() };
const data0 = await loadIntel(svc, hk.id, new Date());
const top = rankReach(data0.brands, { ...data0, meId: jackId, now: new Date() }, { meFirstName: firstNameOf(data0, jackId), limit: 10 });
const need = top.filter(r => !intelFor(r.brand, data0.intelByDomain));
const clicks = await usedToday(svc, hk.id, jackId, new Date()), spent = await spentToday();
log('before', JSON.stringify({ ...before.counts, usage: before.usage, top10: top.map(r => r.brand.name), needResearch: need.length, clicksToday: clicks, spentToday: spent }));
if (!REPLAY && (need.length > 10 || clicks + need.length > 25 || spent + need.length * 0.06 > 1)) { console.log(`ABORT: ${need.length} to research, ${clicks} clicks today, $${spent.toFixed(2)} spent - would pass a cap; not spending.`); process.exit(1); }

let srv, browser, owner;
const blocked = [], realCalls = [], posts = [], listLoads = [], batchReplies = {};
let estimateBody = null, briefBody = null;
const results = { checks: [], errors: [], axe: {}, contrast: {}, numbers: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
const snaps = {};
const snapBrand = async id => { snaps[id] = must(await svc.from('hk_brands').select('*').eq('id', id).single()).data; };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 25 * 60000 });
fs.mkdirSync(OUT, { recursive: true });
const ALLOW = [/\/research\/batch$/, /\/brands\/[^/]+\/pitch$/, /\/brands\/[^/]+\/snooze$/, /\/brands\/[^/]+\/not-a-fit$/];
const CAPS = { 'research/batch': 11, pitch: 2, snooze: 2, 'not-a-fit': 3 };

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  async function open(width, { viewer = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 760 ? 844 : 900 }, hasTouch: width < 760, permissions: ['clipboard-read', 'clipboard-write'] });
    await ctx.addInitScript(([k, v]) => { try { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); localStorage.setItem('prospector_auto_assay_disabled', '1'); } catch { /* sandboxed frame */ } }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session)]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      if (isLocal && req.method() === 'POST' && !viewer && ALLOW.some(re => re.test(u.pathname))) {
        const kind = u.pathname.endsWith('/research/batch') ? 'research/batch' : u.pathname.split('/').pop();
        posts.push(kind);
        if (posts.filter(p => p === kind).length > CAPS[kind]) { blocked.push(`POST ${kind} (over cap)`); return route.abort(); }
        if (kind === 'research/batch' && REPLAY) {
          const body = JSON.parse(req.postData() || '{}'), saved = JSON.parse(fs.readFileSync(REPLY_FILE, 'utf8'));
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body.confirm ? saved.replies[body.brand_ids[0]] || { results: [], stopped: 'not in the replay file' } : saved.estimate) });
        }
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
      const u = new URL(r.url()), p = u.pathname;
      if (/\/inbox\/threads$/.test(p) && r.request().method() === 'GET' && r.ok()) { const j = await r.json().catch(() => null); if (j?.tab === 'inbox') listLoads.push({ width, units: j.from_cache ? 0 : j.gmail_units, cached: !!j.from_cache }); }
      if (/\/briefing$/.test(p) && r.ok()) briefBody = await r.json().catch(() => briefBody);
      if (/\/research\/batch$/.test(p) && r.request().method() === 'POST' && r.ok() && !REPLAY) {
        const body = JSON.parse(r.request().postData() || '{}'), j = await r.json().catch(() => null);
        if (body.confirm) batchReplies[body.brand_ids[0]] = j; else estimateBody = j;
      }
    });
    await page.goto(`${BASE}/`);
    if (width < 900) { await page.getByRole('button', { name: 'Open menu' }).click().catch(() => {}); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 20000 }); await page.getByLabel('Workspace').selectOption({ label: 'HumanKind' });
    await page.locator('[data-hk-shell] [data-hk-avatar]').waitFor({ timeout: 20000 });
    const nav = page.locator('[data-hk-nav="inbox"]');
    if (await nav.count() && await nav.first().isVisible()) await nav.first().click();
    else await page.locator('[data-hk-tab="inbox"]').click();
    await page.locator('[data-hk-briefing] [data-hk-section="send"]').waitFor({ timeout: 60000 });
    await page.waitForFunction(() => !/Reading your Gmail/.test(document.querySelector('[data-hk-section="important"]')?.textContent || ''), null, { timeout: 90000 });
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    // The shell can reload the lane once the Inbox list lands ("Loading the briefing…" again): wait for the rows.
    await page.locator('[data-hk-send-row]').first().waitFor({ timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(800);
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
  const toast = page => page.locator('[data-hk-toast]');
  const sideBySide = async (shotName, width) => {
    const p = await browser.newPage({ viewport: { width: 2 * 1500, height: 1000 } });
    const b64 = f => `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`;
    await p.setContent(`<body style="margin:0;display:flex;gap:16px;background:#ddd;font:14px sans-serif"><figure style="margin:0;flex:1"><figcaption>mockup (inbox/2026-10-30-0920-grow-ui-refresh-mock-briefing.png)</figcaption><img src="${b64(MOCK)}" style="width:100%"></figure><figure style="margin:0;flex:1"><figcaption>build @ ${width}</figcaption><img src="${b64(`${OUT}/${shotName}.png`)}" style="width:100%"></figure></body>`);
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${OUT}/side-by-side-${width}.png`, fullPage: true });
    await p.close();
  };

  // ---- 1440: the real top 10, Research the 10, then the one-click checks.
  {
    const { ctx, page, errors } = await open(1440);
    const send0 = briefBody?.send || [];
    ok(`real wiring: Send these 10 = the scorer on the DB (${send0.map(c => `${c.name} ${c.score}`).join(' · ')}); every row's primary is from the server; no "@"`,
      send0.length === top.length && send0.every((c, i) => c.id === top[i].brand.id && c.score === top[i].score) && send0.every(c => 'primary' in c) && !JSON.stringify(briefBody).includes('@'));
    results.numbers.before = send0.map(c => ({ name: c.name, primary: c.primary?.kind || null }));
    await shot(page, 'briefing-1440-before');
    const n = need.length;
    if (n) {
      await page.locator('[data-hk-research-batch]').click();
      const bar = page.locator('[data-hk-batch-confirm]');
      await bar.waitFor({ timeout: 30000 });
      const estimateText = await bar.textContent();
      results.numbers.estimate = { text: estimateText, body: REPLAY ? JSON.parse(fs.readFileSync(REPLY_FILE, 'utf8')).estimate : estimateBody };
      await bar.locator('[data-hk-batch-run]').click();
      await page.waitForFunction(() => /^Researched /.test(document.querySelector('[data-hk-briefing-note]')?.textContent || ''), null, { timeout: 20 * 60000 });
      const noteText = await page.locator('[data-hk-briefing-note]').textContent();
      if (!REPLAY) {
        const saved = { estimate: estimateBody, replies: batchReplies };
        if (JSON.stringify(saved).includes('@')) throw new Error('research replies carry "@" - not saved');
        fs.writeFileSync(REPLY_FILE, JSON.stringify(saved, null, 1));
      }
      const replies = REPLAY ? JSON.parse(fs.readFileSync(REPLY_FILE, 'utf8')).replies : batchReplies;
      const rows = Object.values(replies).flatMap(r => r?.results || []);
      const perBrand = [];
      for (const r of need) {
        const b = must(await svc.from('hk_brands').select('name, domain, domain_suggested, domain_confidence, research_attempted_at').eq('id', r.brand.id).single()).data;
        const dom = b.domain || b.domain_suggested;
        const intel = dom ? must(await svc.from('hk_domain_intel').select('intel, cost_usd').eq('business_id', hk.id).eq('domain', dom).maybeSingle()).data : null;
        const res = rows.find(x => x.brand_id === r.brand.id);
        perBrand.push({ name: b.name, status: res?.status || 'not run', website: dom || null, confidence: b.domain ? 'saved' : b.domain_confidence || null, fit: intel?.intel?.fit?.sponsor_fit || null, industry: intel?.intel?.company?.industry || null, cost_usd: res?.cost_usd ?? null });
      }
      const total = Math.round(rows.reduce((s, x) => s + (x.cost_usd || 0), 0) * 1e4) / 1e4;
      results.numbers.research = { perBrand, total_usd: total, calls: rows.filter(x => x.status !== 'cached').length, note: noteText };
      ok(`Research the ${n} (${REPLAY ? 'replayed' : `${rows.length} real calls`}): estimate "${estimateText.trim()}" -> "${noteText}"; total $${total}; ${posts.filter(p => p === 'research/batch').length} batch posts (cap 11)`,
        rows.length <= 10 && rows.length >= 1 && total <= 1 && posts.filter(p => p === 'research/batch').length <= 11);
      await page.locator('[data-hk-send-row]').first().waitFor();
      await page.waitForTimeout(800);
    } else ok('Research the n: nothing in the top 10 needs research', true);
    const send = briefBody?.send || [];
    results.numbers.after = send.map(c => ({ name: c.name, score: c.score, primary: c.primary?.kind || null, fit: c.research?.fit || null }));
    await shot(page, 'briefing-1440');
    await sideBySide('briefing-1440', 1440);
    // Row 1 expand: the Why-score parts sum to its score.
    const r1 = page.locator('[data-hk-send-row]').first();
    if ((await r1.locator('[data-hk-expand-btn]').getAttribute('aria-expanded')) !== 'true') await r1.locator('[data-hk-expand-btn]').click();
    await r1.locator('.hk-parts dd').first().waitFor({ timeout: 15000 });
    const parts = await r1.locator('.hk-parts dd').evaluateAll(es => es.map(e => Number(e.textContent)));
    const score = Number(await r1.locator('.hk-srow__n').textContent());
    results.numbers.row1 = { name: send[0]?.name, score, parts: await r1.locator('.hk-parts__row').evaluateAll(es => es.map(e => e.textContent)) };
    ok(`expand row 1 (${send[0]?.name}): Why score ${score} = ${parts.join(' + ')} (sum ${parts.reduce((a, b) => a + b, 0)})`, parts.reduce((a, b) => a + b, 0) === score && parts.length > 0);
    await shot(page, 'briefing-1440-row1-expanded');
    // Pitch + Undo on a Ready row, if research made one.
    // An unclaimed Ready row, so Pitch really claims (on the caller's own brand it only copies: no claim, no Undo).
    const ready = send.find(c => c.primary?.kind === 'pitch' && !c.owner_user_id) || send.find(c => c.primary?.kind === 'pitch');
    if (ready) {
      await snapBrand(ready.id);
      const row = page.locator(`[data-hk-send-row="${ready.id}"]`);
      await row.locator('[data-hk-primary="pitch"]').click();
      if (await page.getByRole('button', { name: 'Take it' }).count()) await page.getByRole('button', { name: 'Take it' }).click();
      await toast(page).waitFor({ timeout: 30000 });
      const t = await toast(page).textContent(), clip = await page.evaluate(() => navigator.clipboard.readText());
      const claimed = must(await svc.from('hk_brands').select('owner_user_id').eq('id', ready.id).single()).data.owner_user_id;
      if (!ready.owner_user_id) await toast(page).getByRole('button', { name: 'Undo' }).click();
      else ok(`Pitch on ${ready.name} (already Jack's): copied only, no claim, no Undo offered`, !(await toast(page).getByRole('button', { name: 'Undo' }).count()));
      await page.waitForTimeout(1500);
      const released = must(await svc.from('hk_brands').select('owner_user_id').eq('id', ready.id).single()).data.owner_user_id;
      results.numbers.pitch = { brand: ready.name, toast: t, clipboard: clip };
      ok(`Pitch on ${ready.name}: claimed to Jack, clipboard "${clip}" (no "@"), toast "${t}"; Undo released it`, claimed === jackId && clip === ready.command && !clip.includes('@') && released === snaps[ready.id].owner_user_id);
    } else { results.numbers.pitch = 'no Ready row after research'; ok('Pitch + Undo: no Ready row after research (none has research + an email contact) - not run', true); }
    // Snooze (S) + Undo, Not a fit (X) + Undo - on the last two rows, by key on the focused row.
    const [snz, nfit] = [send.at(-1), send.at(-2)];
    await snapBrand(snz.id); await snapBrand(nfit.id);
    await page.locator(`[data-hk-send-row="${snz.id}"]`).focus(); await page.keyboard.press('s');
    await toast(page).waitFor({ timeout: 30000 });
    const snoozed = must(await svc.from('hk_brands').select('snoozed_until').eq('id', snz.id).single()).data.snoozed_until;
    const gone = await page.locator(`[data-hk-send-row="${snz.id}"]`).waitFor({ state: 'detached', timeout: 15000 }).then(() => true, () => false);
    await toast(page).getByRole('button', { name: 'Undo' }).click(); await page.waitForTimeout(1500);
    const back = must(await svc.from('hk_brands').select('snoozed_until').eq('id', snz.id).single()).data.snoozed_until;
    ok(`S on ${snz.name}: snoozed until ${snoozed?.slice(0, 10)} and out of the 10 (${gone}); Undo cleared it`, !!snoozed && gone && back === null);
    await page.locator(`[data-hk-send-row="${nfit.id}"]`).focus(); await page.keyboard.press('x');
    await toast(page).waitFor({ timeout: 30000 });
    const passed = must(await svc.from('hk_brands').select('status, pass_reason, relationship').eq('id', nfit.id).single()).data;
    await toast(page).getByRole('button', { name: 'Undo' }).click(); await page.waitForTimeout(1500);
    const unpassed = must(await svc.from('hk_brands').select('status, pass_reason, relationship').eq('id', nfit.id).single()).data;
    ok(`X on ${nfit.name}: ${passed.status} "${passed.pass_reason}" (relationship still ${passed.relationship}); Undo back to ${unpassed.status}`, passed.status === 'passed' && passed.pass_reason === 'Not a fit' && passed.relationship === 'prospect' && unpassed.status === snaps[nfit.id].status && unpassed.pass_reason === null);
    // Keys never fire while typing.
    const p0 = posts.length;
    const search = page.locator('.hk-rail__search input');
    if (await search.count()) { await search.first().click(); await page.keyboard.type('sxpt'); await page.keyboard.press('Escape'); await search.first().fill(''); }
    await page.waitForTimeout(500);
    ok(`keys while typing in search: ${posts.length - p0} actions fired`, posts.length === p0);
    // N2: opening row 2 moves neither row 1 nor the page.
    await page.locator('[data-hk-send-row]').first().locator('[data-hk-expand-btn]').click().catch(() => {});
    if (await page.locator('[data-hk-send-row]').first().locator('[data-hk-expand]').count()) await page.locator('[data-hk-send-row]').first().locator('[data-hk-expand-btn]').click();
    const geo = () => page.evaluate(() => { const rs = [...document.querySelectorAll('[data-hk-send-row]')]; return { y: window.scrollY, t1: rs[0].getBoundingClientRect().top, t2: rs[1].getBoundingClientRect().top, h1: rs[0].getBoundingClientRect().height }; });
    const g0 = await geo(); await page.locator('[data-hk-send-row]').nth(1).locator('[data-hk-expand-btn]').click(); await page.waitForTimeout(300); const g1 = await geo();
    const mv = Math.max(Math.abs(g1.y - g0.y), Math.abs(g1.t1 - g0.t1), Math.abs(g1.t2 - g0.t2), Math.abs(g1.h1 - g0.h1));
    ok(`N2 1440: expanding row 2 moves row 1, row 2's top and the page by ${mv} px`, mv < 1, JSON.stringify({ g0, g1 }));
    await page.locator('[data-hk-send-row]').nth(1).locator('[data-hk-expand-btn]').click();
    await page.locator('[data-hk-send-row]').first().locator('[data-hk-expand-btn]').click();
    await page.waitForTimeout(400);
    await measure(page, 'briefing@1440', '[data-hk-briefing]');
    await axeOn(page, 'briefing@1440', '[data-hk-briefing]');
    ok('1440: no sideways scroll; 0 page errors', await noSideways(page) && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  for (const w of [1280, 390]) {
    const { ctx, page, errors } = await open(w);
    await shot(page, `briefing-${w}`);
    await sideBySide(`briefing-${w}`, w);
    await measure(page, `briefing@${w}`, '[data-hk-briefing]');
    await axeOn(page, `briefing@${w}`, '[data-hk-briefing]');
    if (w === 390) results.numbers.layout390 = await page.evaluate(() => {
      const q = s => document.querySelector(s), cs = (s, ...k) => { const e = q(s); if (!e) return null; const c = getComputedStyle(e); return Object.fromEntries([['w', Math.round(e.getBoundingClientRect().width)], ...k.map(x => [x, c[x]])]); };
      const wide = [...document.querySelectorAll('[data-hk-shell] *')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 8).map(e => `${e.tagName.toLowerCase()}.${String(e.className).split(' ').join('.')} ${Math.round(e.getBoundingClientRect().right)}`);
      return { sw: document.documentElement.scrollWidth, briefing: cs('.hk-briefing', 'containerType'), main: cs('.hk-brief__main', 'containerType', 'containerName'), row: cs('.hk-srow__main', 'display', 'gridTemplateColumns'), body: cs('.hk-srow__body', 'gridColumn', 'gridRow'), acts: cs('.hk-srow__acts', 'gridColumn', 'gridRow'), wide };
    });
    const railBelow = await page.evaluate(() => { const m = document.querySelector('.hk-brief__main').getBoundingClientRect(), r = document.querySelector('.hk-brief__rail').getBoundingClientRect(); return r.top >= m.bottom - 1; });
    ok(`${w}: ${await page.locator('[data-hk-send-row]').count()} rows, right rail ${railBelow ? 'below the list' : 'beside the list'}, no sideways scroll, 0 page errors`, (await page.locator('[data-hk-send-row]').count()) >= 1 && await noSideways(page) && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await open(1440, { viewer: true });
    const writes = await page.locator('[data-hk-primary], .hk-qcs, [data-hk-send-row] input[type="checkbox"], [data-hk-research-batch], [data-hk-copy-batch], [data-hk-more-claim], [data-hk-more-dnc], [data-hk-edit-idea], [data-hk-signal-dismiss]').count();
    await shot(page, 'briefing-1440-viewer');
    ok(`Viewer (role forced in /shell): ${await page.locator('[data-hk-send-row]').count()} rows read; no primary / quick commands / checkboxes / Research the n / Copy batch / Claim / DNC / Edit / Dismiss (${writes}); 0 page errors`, writes === 0 && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  const fresh = listLoads.filter(l => !l.cached);
  results.numbers.gmail = { loads: listLoads.length, uncached: fresh.length, units: fresh.reduce((n, l) => n + (l.units || 0), 0) };
  ok(`browser reached 0 Claude / Apollo hosts directly; writes ${JSON.stringify(posts.reduce((m, p) => ({ ...m, [p]: (m[p] || 0) + 1 }), {}))}; Gmail ${results.numbers.gmail.units} units in ${fresh.length} uncached list page(s) (cap 2100); other writes aborted (${[...new Set(blocked)].slice(0, 6).join(', ') || 'none attempted'})`,
    !realCalls.length && results.numbers.gmail.units <= 2100);
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    for (const [id, s] of Object.entries(snaps)) must(await svc.from('hk_brands').update(Object.fromEntries(BRAND_FIELDS.map(k => [k, s[k]]))).eq('id', id).eq('business_id', hk.id));
    must(await svc.from('hk_member_prefs').update({ last_seen_at: before.seen }).eq('business_id', hk.id).eq('user_id', jackId));
    for (const [id, s] of Object.entries(snaps)) {
      const now = must(await svc.from('hk_brands').select('*').eq('id', id).single()).data;
      const diff = Object.keys(s).filter(k => JSON.stringify(s[k]) !== JSON.stringify(now[k]) && !(typeof s[k] === 'string' && Date.parse(s[k]) === Date.parse(now[k])));
      if (diff.length) throw new Error(`${s.name} fields differ: ${diff.join(', ')}`);
    }
    const after = { counts: await counts(), usage: await usage(), seen: await prefsSeen() };
    const moved = HK_TABLES.filter(t => !KEPT.has(t) && before.counts[t] !== after.counts[t]).map(t => `${t} ${before.counts[t]} -> ${after.counts[t]}`);
    if (moved.length) throw new Error(`counts moved: ${moved.join(', ')}`);
    if (after.seen !== before.seen) throw new Error('hk_member_prefs.last_seen_at not restored');
    const calls = after.usage - before.usage;
    if (calls > 10 || (REPLAY && calls)) throw new Error(`${calls} research usage rows (cap ${REPLAY ? 0 : 10})`);
    restored = true;
    line = `yes (${Object.keys(snaps).length} brand rows identical incl. updated_at; ${HK_TABLES.length - KEPT.size} HumanKind counts identical; last_seen_at restored; KEPT by rule: ${[...KEPT].map(t => `${t} +${after.counts[t] - before.counts[t]}`).join(', ')}, business_anthropic_usage +${calls}, the researched brands' suggested websites, hk_events, sign-in rows)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'stage3a-report.json'), JSON.stringify({ ...results, restored, replay: REPLAY, when: new Date().toISOString() }, null, 2));
  console.log(`\ngrow-ui-refresh-v1 Stage 3a live check: ${passed}/${results.checks.length} passed · Claude ${REPLAY ? 0 : results.numbers.research?.calls ?? 0} · Apollo 0\nnumbers: ${JSON.stringify(results.numbers)}\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
