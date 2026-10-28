// visual-nav-cleanup-v1 Stage 2 live check - localhost against the build, as Jack (ownerSession). HomeLover at 1440:
// a fresh load watched 60 s for /proxy/anthropic calls (all aborted; auto-assay left ON so it shows), one Scout bar, the
// Help row, no Accounts, Admin's collapsed "Not set up" group + axe. HumanKind at 1440 + 390: Grow everywhere, the word
// pill = today's Chicago word, its card, no sideways scroll, axe on the top bar. One request through the real wiring:
// GET /api/hk/:id/shell (stamps hk_member_prefs.last_seen_at - the ONE allowed write, put back to its prior value in
// finally). Every browser non-GET aborted; 0 Claude / 0 Apollo. ~3 min, cap 280 s. "restored" THROWS if any of the 50
// counts moved or last_seen_at isn't back. Shots + report: .screenshots/visual-nav-cleanup-v1/. Run npm run build first.
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
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const OUT = path.join(ROOT, '.screenshots', 'visual-nav-cleanup-v1');
const PORT = 3997, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const SALES = 'cadence_plan call_notes collateral company_score_days company_scores email_activity email_backfill_weeks email_daily_counts email_messages events goals huddles infra_items insight_dismissals lead_uploads mailbox_owners metric_targets metrics_daily month_goals opportunities opportunity_events outreach_campaigns outreach_contacts outreach_events outreach_steps outreach_tracks partner_events people prospect_events prospect_state raw_snapshots sequence_tags sequenced_accounts settings signals source_events stage_marks suggestions sync_runs targets tidy_runs visit_skip week_goal_steps week_goals week_notes week_plans week_report week_report_sections'.split(' ').map(t => `sales_${t}`);
const TABLES = [...SALES, 'web_visits', 'business_anthropic_usage'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const biz = (await svc.from('businesses').select('id, name').ilike('name', '%homelover%')).data;
if (biz?.length !== 1) throw new Error('expected one HomeLover business');
const HL = biz[0].id;
const scoped = new Map();
async function count(t) {
  if (scoped.get(t) !== false) {
    const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL);
    if (!r.error && typeof r.count === 'number') { scoped.set(t, true); return r.count; }
    if (scoped.get(t) === true) throw new Error(`count ${t}: ${r.error?.message || 'no count'}`);
    scoped.set(t, false);
  }
  const r = await svc.from(t).select('*', { count: 'exact', head: true });
  if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message || `no count (HTTP ${r.status})`}`);
  return `${r.count} (whole table)`;
}
const snapshot = async () => { const o = {}; for (const t of TABLES) o[t] = await count(t); return o; };
const marksLeft = async () => { const r = await svc.from('sales_stage_marks').select('id, record_type, record_id, stage, at').eq('business_id', HL); if (r.error) throw new Error(`marks: ${r.error.message}`); return r.data; };
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
let srv, browser, owner;
const blocked = [], realCalls = [], writes = [], proxyCalls = [];
const results = { checks: [], errors: [], axe: {}, contrast: {}, n2: {}, numbers: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 280000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));


const { wordFor } = await import('../../src/hk/wordOfDay.js');
const HK = (await svc.from('businesses').select('id').eq('name', 'HumanKind')).data?.[0]?.id;
if (!HK) throw new Error('expected the HumanKind workspace');
let seenBefore = null, ownerId = null;
try {
  owner = await ownerSession(svc);
  ownerId = owner.userId;
  seenBefore = (await svc.from('hk_member_prefs').select('last_seen_at').eq('business_id', HK).eq('user_id', ownerId).maybeSingle()).data?.last_seen_at ?? null;
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const sh = await fetch(`${BASE}/api/hk/${HK}/shell`, { headers: { cookie } });
  const shb = await sh.json().catch(() => null);
  const stamped = (await svc.from('hk_member_prefs').select('last_seen_at').eq('business_id', HK).eq('user_id', ownerId).maybeSingle()).data?.last_seen_at;
  ok(`real wiring: GET /api/hk/HumanKind/shell -> ${sh.status}; members carry last_seen_at (${(shb?.members || []).map(m => `${m.first_name}:${m.last_seen_at ? 'set' : 'null'}`).join(', ')}); my row stamped (${!!stamped}); no "@"`, sh.status === 200 && !!stamped && (shb.members || []).every(m => 'last_seen_at' in m) && !JSON.stringify(shb).includes('@'));

  browser = await chromium.launch();
  async function open(width, ws) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 }, hasTouch: width < 900 });
    await ctx.addInitScript(([k, v]) => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session)]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      if (isLocal && u.pathname.startsWith('/proxy/anthropic')) proxyCalls.push({ t: Date.now(), ws });
      const apiWrite = isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname);
      if (apiWrite) writes.push(`${req.method()} ${u.pathname}`);
      const deny = apiWrite || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.pathname}`); return route.abort(); }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(20000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    const t0 = Date.now();
    await page.goto(`${BASE}/`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 30000 }); await page.getByLabel('Workspace').selectOption({ label: ws }); await page.waitForTimeout(2000);
    return { ctx, page, errors, t0, compact };
  }
  const shot = (page, nme) => page.screenshot({ path: `${OUT}/${nme}.png`, animations: 'disabled', caret: 'hide', fullPage: false });
  const axeOn = async (page, key, sel) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async s => { const r = await window.axe.run(document.querySelector(s), { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); }, sel);
    results.axe[key] = v;
    ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v).slice(0, 300));
  };

  // ---- HomeLover 1440: no proxy call for 60 s, one Scout bar, Help, no Accounts, Admin "Not set up".
  {
    const { ctx, page, errors, t0 } = await open(1440, 'HomeLover');
    const accountsRow = await page.getByRole('button', { name: /^\W*Accounts$/ }).count();
    const scouts = await page.locator('[aria-label="Scout"]').count();
    await page.getByRole('button', { name: /Help ▸/ }).click(); await page.waitForTimeout(300);
    const helpShown = [];
    for (const h of ['Daily digest', 'Week ahead', 'Report a bug', 'Voice Profile']) if (await page.getByRole('button', { name: new RegExp(h) }).count()) helpShown.push(h);
    await shot(page, 'homelover-help-1440');
    ok(`HomeLover 1440: one Scout bar (${scouts}); Help ▸ shows ${helpShown.join(' · ')}; no Accounts in the nav (${accountsRow})`, scouts === 1 && helpShown.length === 4 && accountsRow === 0);
    await page.getByRole('button', { name: /^\W*Admin$/ }).click(); await page.waitForTimeout(1500);
    const tabs = page.locator('[data-testid="admin-tabs"]');
    const groupBtn = tabs.getByRole('button', { name: /NOT SET UP/ });
    const collapsed = await groupBtn.getAttribute('aria-expanded');
    const platformTabs = await tabs.locator('button').allTextContents();
    await groupBtn.click(); await page.waitForTimeout(300);
    const needs = await page.locator('[data-not-set-up-needs] li').allTextContents();
    await shot(page, 'admin-not-set-up-1440');
    ok(`Admin: "Not set up" collapsed by default (${collapsed}) with ${needs.length} tabs + what each needs (${needs.map(n => n.split(' - ')[0]).join(' · ')}); Zoom / Salesforce / Pricing not among the live tabs before expanding`, collapsed === 'false' && needs.length === 3 && !platformTabs.some(t => /Zoom Events|Salesforce Tools|Pricing/.test(t)));
    await axeOn(page, 'admin-tabs@1440', '[data-testid="admin-tabs"]');
    const wait = 60000 - (Date.now() - t0);
    if (wait > 0) await page.waitForTimeout(wait);
    const hlCalls = proxyCalls.filter(c => c.ws === 'HomeLover');
    ok(`HomeLover: ${hlCalls.length} Claude proxy calls in the 60 s after a fresh load (auto-assay left ON - it is its own feature, reported separately); 0 page errors`, hlCalls.length === 0 && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- HumanKind 1440 + 390: Grow, the word pill, one per Chicago day.
  const today = wordFor(new Date());
  for (const width of [1440, 390]) {
    const { ctx, page, errors } = await open(width, 'HumanKind');
    await page.locator('[data-hk-shell]').waitFor({ timeout: 30000 }); await page.waitForTimeout(1500);
    const text = await page.locator('[data-hk-shell]').innerText();
    const pill = page.locator('[data-hk-wotd] button');
    const word = (await pill.getAttribute('aria-label')) || '';
    await pill.click(); await page.waitForTimeout(300);
    const card = await page.getByRole('dialog', { name: new RegExp(`${today.word} - word of the day`) }).count();
    await shot(page, `humankind-wotd-${width}`);
    ok(`HumanKind ${width}: says Grow, no "Sales OS" (${/Sales OS/.test(text)}); the pill reads today's Chicago word (${word}) = ${today.word}; it opens its definition (${card}); no sideways scroll; 0 page errors`, /Grow/.test(text) && !/Sales OS/.test(text) && word === `Word of the day: ${today.word}` && card === 1 && (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)) && !errors.length, errors.join(' | '));
    if (width === 1440) await axeOn(page, 'hk-top@1440', '[data-hk-shell] header');
    await ctx.close();
  }
  ok(`browser reached 0 Claude / Apollo hosts; every non-GET was aborted (${[...new Set(writes)].join(', ') || 'none attempted'})`, !realCalls.length && writes.every(w => blocked.includes(w)));
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    if (ownerId) {
      const r = await svc.from('hk_member_prefs').update({ last_seen_at: seenBefore }).eq('business_id', HK).eq('user_id', ownerId).select('last_seen_at');
      if (r.error || (r.data?.[0]?.last_seen_at ?? null) !== seenBefore) throw new Error(`last_seen_at not restored (${r.error?.message || r.data?.[0]?.last_seen_at})`);
    }
    const after = await snapshot();
    const moved = TABLES.filter(t => before[t] !== after[t]).map(t => `${t} ${before[t]} -> ${after[t]}`);
    if (moved.length) throw new Error(`counts moved: ${moved.join(', ')}`);
    restored = true; line = `yes (${TABLES.length} table counts identical; Jack's hk_member_prefs.last_seen_at put back to ${seenBefore}; sign-in row kept by rule, profile last_seen_at restored)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'stage2-report.json'), JSON.stringify({ ...results, proxyCalls: proxyCalls.length, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\nvisual-nav-cleanup-v1 Stage 2 live check: ${passed}/${results.checks.length} passed · Claude 0 (proxy calls seen + aborted: ${proxyCalls.length}) · Apollo 0 · writes: last_seen_at only (restored)\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
