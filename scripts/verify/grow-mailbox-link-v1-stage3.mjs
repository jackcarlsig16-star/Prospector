// grow-mailbox-link-v1 Stage 3 live check - as Jack (ownerSession) on the REAL HumanKind workspace, localhost against the
// build, read-only: 5 brands with linked Gmail threads (Timeline entries, last-contact + waiting chips, the deal facts,
// compared to hk_brand_threads), the Brands list Conversation column + the Conversation / Deal-stage filters (totals
// compared to the DB), Review > Email links, 1440 / 390, contrast, axe, N2 (no sideways scroll), Viewer by intercept.
// SCOPE (declared): 0 Claude, 0 Apollo, 0 Gmail (the Inbox is never opened; brand pages open by #hk/brands/<id>). Every
// non-GET to /api, /proxy and Supabase REST is aborted (the page-load job POST included) - nothing is written.
// Restore: hk_member_prefs.last_seen_at + profiles.last_seen_at; sign-in rows KEPT by rule. "restored" THROWS if any
// watched count moved. Runtime ~4 min, cap 10 min.  Usage: node scripts/verify/grow-mailbox-link-v1-stage3.mjs (npm run build first)
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
const OUT = path.join(ROOT, '.screenshots', 'grow-mailbox-link-v1');
const PORT = 3995, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const WATCH = ['hk_brands', 'hk_touches', 'hk_replies', 'hk_brand_threads', 'hk_job_runs', 'hk_events', 'hk_signals'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const must = r => { if (r.error) throw new Error(r.error.message); return r; };
const hk = (await svc.from('businesses').select('id, features').eq('name', 'HumanKind')).data?.find(b => b.features?.hk_sales);
if (!hk) { console.log('ABORT: no HumanKind workspace with hk_sales on'); process.exit(1); }
const now0 = new Date();
const minsToSix = ((6 - (now0.getHours() % 6)) % 6) * 60 - now0.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now0.getHours() % 6 === 0 && now0.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
const counts = async () => { const o = {}; for (const t of WATCH) o[t] = must(await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', hk.id)).count; return o; };
const jackId = must(await svc.from('profiles').select('id').eq('is_platform_owner', true)).data[0].id;
const prefsSeen = async () => must(await svc.from('hk_member_prefs').select('last_seen_at').eq('business_id', hk.id).eq('user_id', jackId).maybeSingle()).data?.last_seen_at ?? null;
const before = { counts: await counts(), seen: await prefsSeen() };
const threads = must(await svc.from('hk_brand_threads').select('*').eq('business_id', hk.id).eq('link_state', 'linked').order('last_at', { ascending: false })).data;
const names = Object.fromEntries(must(await svc.from('hk_brands').select('id, name').in('id', [...new Set(threads.map(t => t.brand_id))])).data.map(b => [b.id, b.name]));
const five = [...new Set(threads.map(t => t.brand_id))].slice(0, 5);
const DAY = 864e5;
const expectWaitUs = new Set(threads.filter(t => t.waiting_on === 'us').map(t => t.brand_id)).size;
log('before', JSON.stringify(before.counts), 'brands:', five.map(id => names[id]).join(', '));
let srv, browser, owner;
const blocked = [], realCalls = [], bodies = {};
const results = { checks: [], axe: {}, contrast: {}, brands: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 10 * 60000 });
fs.mkdirSync(OUT, { recursive: true });

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  async function open(width, hash, { viewer = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 760 ? 844 : 900 }, hasTouch: width < 760 });
    await ctx.addInitScript(([k, v]) => { try { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); localStorage.setItem('prospector_auto_assay_disabled', '1'); } catch { /* storage blocked */ } }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session)]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (/anthropic\.com$|apollo\.io$|googleapis\.com$/.test(u.host) && !/fonts/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      const deny = (isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname)) || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.pathname.replace(hk.id, '<hk>')}`); return route.abort(); }
      if (isLocal && /\/inbox\//.test(u.pathname)) { blocked.push(`GET ${u.pathname.replace(hk.id, '<hk>')} (Gmail)`); return route.fulfill({ status: 200, json: { threads: [], tab: 'inbox', from_cache: true, gmail_units: 0 } }); }
      if (viewer && isLocal && /^\/api\/hk\/[^/]+\/shell$/.test(u.pathname)) { const r = await route.fetch(); const j = await r.json(); return route.fulfill({ response: r, json: { ...j, me: { ...j.me, role: 'viewer' } } }); }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(30000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    page.on('response', async r => { const p = new URL(r.url()).pathname; if (/\/api\/hk\/[^/]+\/(brands|review\/email-links)$/.test(p) && r.ok()) bodies[`${p.split('/').pop()}${new URL(r.url()).search}`] = await r.json().catch(() => null); });
    await page.goto(`${BASE}/${hash}`);
    if (width < 900) { await page.getByRole('button', { name: 'Open menu' }).click().catch(() => {}); await page.waitForTimeout(400); }
    // The shell may already be on HumanKind (the hash names an hk screen); pick it only when the picker shows another.
    const avatar = page.locator('[data-hk-shell] [data-hk-avatar]').first(), picker = page.getByLabel('Workspace');
    await avatar.waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    if (!(await avatar.count())) { await picker.selectOption({ label: 'HumanKind' }); await avatar.waitFor({ state: 'attached', timeout: 60000 }); }
    await page.locator('[data-hk-shell] [data-hk-avatar]').first().waitFor({ state: 'attached', timeout: 60000 });
    if (!(await page.evaluate(h => window.location.hash === h, hash))) await page.evaluate(h => { window.location.hash = h; }, hash);
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(700);
    return { ctx, page, errors };
  }
  const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide', fullPage: true });
  const measure = async (page, key, scope) => { const m = await page.evaluate(measureScript({ scope })); if (m.error) { ok(`contrast ${key}`, false, m.error); return; } const s = summarize(m); results.contrast[key] = s; ok(`contrast ${key}: 0 text < 4.5:1 (text ${s.textFails}/${s.texts})`, s.textFails === 0, s.worst.slice(0, 4).map(w => `${w.ratio} ${w.fg} on ${w.bg} "${String(w.text || '').slice(0, 30)}"`).join(' | ')); };
  const axeOn = async (page, key, sel) => { await page.addScriptTag({ content: AXE }); const v = await page.evaluate(async s => { const r = await window.axe.run(document.querySelector(s), { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); }, sel); results.axe[key] = v; ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v).slice(0, 400)); };
  const noSideways = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  // ---- 1440: the 5 brands, each against the DB.
  {
    const { ctx, page, errors } = await open(1440, `#hk/brands/${five[0]}`);
    for (const [i, id] of five.entries()) {
      if (i) { await page.evaluate(h => { window.location.hash = h; }, `#hk/brands/${id}`); await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {}); await page.waitForTimeout(500); }
      await page.locator(`[data-hk-brand-page="${id}"] [data-hk-timeline-card]`).waitFor({ timeout: 60000 });
      const db = threads.filter(t => t.brand_id === id), newest = db[0];
      const ui = await page.locator('[data-hk-thread]').evaluateAll(es => es.map(e => e.textContent));
      const chips = await page.locator('[data-hk-brand-page] [data-hk-conversation]').first().textContent().catch(() => '');
      const daysUs = newest.waiting_on === 'us' && newest.last_theirs_at ? Math.max(0, Math.floor((Date.now() - Date.parse(newest.last_theirs_at)) / DAY)) : null;
      const row = { brand: names[id], threads: db.length, newest: newest.last_at.slice(0, 10), waiting_on: newest.waiting_on, deal: newest.deal_stage, month: newest.deal_month, amount: newest.deal_amount_usd, summary: newest.summary, header: chips.trim() };
      results.brands.push(row);
      const factsOk = !newest.deal_stage || ui[0]?.toLowerCase().includes({ interested: 'interested', discussing: 'discussing', scheduling: 'scheduling', confirmed: 'confirmed', declined: 'declined', other: 'in conversation' }[newest.deal_stage]);
      ok(`${names[id]}: ${ui.length} thread entries = ${db.length} in hk_brand_threads; header "${chips.trim()}"; newest facts shown (${newest.deal_stage || 'unread'}${newest.deal_month ? ` ${newest.deal_month}` : ''}); waiting ${newest.waiting_on}${daysUs != null ? ` ${daysUs} d` : ''}; no "@" on the page's thread entries`,
        ui.length === db.length && /Last contact/.test(chips) && (newest.waiting_on === 'us') === /Waiting on us/.test(chips) && (newest.waiting_on === 'them') === /Waiting on them/.test(chips) && factsOk && !ui.join(' ').includes('@') && (!newest.summary || ui[0].includes(newest.summary.slice(0, 40))));
      if (i === 0) { await shot(page, 'brand-1440'); await measure(page, 'brand@1440', '[data-hk-brand-page]'); await axeOn(page, 'brand@1440', '[data-hk-brand-page]'); }
    }
    ok('1440: N2 no sideways scroll; 0 page errors', await noSideways(page) && !errors.length, errors.join(' | '));
    // Brands list: the Conversation column + the Waiting-on-us filter, against the DB.
    await page.evaluate(() => { window.location.hash = '#hk/brands?conversation=waiting_us'; });
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    await page.locator('[data-hk-conversation], .hk-empty').first().waitFor({ timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(800);
    const key = Object.keys(bodies).find(k => k.startsWith('brands?') && k.includes('conversation=waiting_us'));
    const total = key ? bodies[key].total : null;
    const railHasConv = await page.getByText('Conversation', { exact: true }).count();
    ok(`Brands › Conversation = Waiting on us: list total ${total} = ${expectWaitUs} brands with a thread waiting on us in hk_brand_threads; rail shows Conversation (${railHasConv})`, total === expectWaitUs && railHasConv > 0);
    await shot(page, 'brands-waiting-us-1440');
    await measure(page, 'brands@1440', '[data-hk-brands-space], main');
    const dealResp = page.waitForResponse(r => /\/api\/hk\/[^/]+\/brands\?/.test(r.url()) && r.url().includes('deal=confirmed'), { timeout: 60000 }).catch(() => null);
    await page.evaluate(() => { window.location.hash = '#hk/brands?deal=confirmed'; });
    const dr = await dealResp; if (dr) bodies['brands?deal=confirmed'] = await dr.json().catch(() => null);
    const dk = Object.keys(bodies).find(k => k.includes('deal=confirmed'));
    const expectConfirmed = new Set(threads.filter(t => t.deal_stage === 'confirmed').map(t => t.brand_id)).size;
    ok(`Brands › Deal stage = Confirmed: list total ${dk ? bodies[dk].total : null} = ${expectConfirmed} in the DB`, dk && bodies[dk].total === expectConfirmed);
    // Review > Email links.
    await page.evaluate(() => { window.location.hash = '#hk/review'; });
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    await page.getByRole('tab', { name: /Email links/ }).click();
    await page.waitForTimeout(400);
    const dbReview = must(await svc.from('hk_brand_threads').select('id', { count: 'exact', head: true }).eq('business_id', hk.id).eq('link_state', 'review')).count;
    const uiRows = await page.locator('[data-hk-email-link]').count();
    ok(`Review › Email links: ${uiRows} rows shown = ${dbReview} review rows (+ suggested-domain links) in the DB`, uiRows >= dbReview);
    await shot(page, 'review-email-links-1440');
    await ctx.close();
  }
  // ---- 390: the first brand.
  {
    const { ctx, page, errors } = await open(390, `#hk/brands/${five[0]}`);
    await page.locator(`[data-hk-brand-page="${five[0]}"] [data-hk-timeline-card]`).waitFor({ timeout: 60000 });
    await shot(page, 'brand-390');
    await measure(page, 'brand@390', '[data-hk-brand-page]');
    await axeOn(page, 'brand@390', '[data-hk-brand-page]');
    ok('390: N2 no sideways scroll; 0 page errors', await noSideways(page) && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- Viewer by intercept: threads visible, no Link / Not this brand.
  {
    const { ctx, page, errors } = await open(1440, `#hk/brands/${five[0]}`, { viewer: true });
    await page.locator(`[data-hk-brand-page="${five[0]}"] [data-hk-timeline-card]`).waitFor({ timeout: 60000 });
    const n = await page.locator('[data-hk-thread]').count();
    await page.evaluate(() => { window.location.hash = '#hk/review'; }); await page.waitForLoadState('networkidle').catch(() => {});
    await page.getByRole('tab', { name: /Email links/ }).click(); await page.waitForTimeout(300);
    const writes = await page.getByRole('button', { name: /^(Link|Not this brand)$/ }).count();
    ok(`Viewer: ${n} thread entries readable, ${writes} Link / Not this brand buttons, 0 page errors`, n > 0 && writes === 0 && !errors.length, errors.join(' | '));
    await ctx.close();
  }
} finally {
  await cleanup();
  if (before.seen !== (await prefsSeen())) must(await svc.from('hk_member_prefs').update({ last_seen_at: before.seen }).eq('business_id', hk.id).eq('user_id', jackId));
  const after = { counts: await counts(), seen: await prefsSeen() };
  fs.writeFileSync(path.join(OUT, 'stage3-results.json'), JSON.stringify({ ...results, blocked, realCalls, before, after }, null, 2));
  log(`checks ${results.checks.filter(c => c.pass).length}/${results.checks.length} · blocked ${blocked.length} (${[...new Set(blocked)].slice(0, 6).join(', ')}) · real Claude / Apollo / Gmail calls ${realCalls.length}`);
  const moved = WATCH.filter(t => before.counts[t] !== after.counts[t]);
  if (moved.length) throw new Error(`restored: NO - ${moved.map(t => `${t} ${before.counts[t]} -> ${after.counts[t]}`).join(', ')} (check who wrote before blaming the run)`);
  if (after.seen !== before.seen) throw new Error('restored: NO - hk_member_prefs.last_seen_at');
  log(`restored: yes (${WATCH.map(t => `${t} ${after.counts[t]}`).join(' · ')}; prefs last_seen_at restored; sign-in rows kept by rule)`);
}
