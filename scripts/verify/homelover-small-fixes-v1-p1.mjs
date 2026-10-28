// homelover-small-fixes-v1 P1 live check - localhost against the build, as Jack (ownerSession) on HomeLover, read-only.
// Dashboard > Sources > Funnel > By rep > Brad's Visited count -> click a company (Hilton when listed) -> its company
// window opens (the shared PeopleCompanyPanel); close -> focus back on the name; the list stays open (N2 0 px). 1440 by
// mouse, 390 by Enter; contrast + axe on the list; a Viewer pass by intercepting /api/me. Every non-GET aborted; 0
// Claude, 0 Apollo. "restored" THROWS unless every count is identical. ~1.5 min, cap 180 s. Run npm run build first.
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
const OUT = path.join(ROOT, '.screenshots', 'homelover-small-fixes-v1');
const PORT = 3998, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const SALES = 'cadence_plan call_notes collateral company_score_days company_scores email_activity email_backfill_weeks email_daily_counts email_messages events goals huddles infra_items insight_dismissals insights channel_links lead_uploads mailbox_owners metric_targets metrics_daily month_goals opportunities opportunity_events outreach_campaigns outreach_contacts outreach_events outreach_steps outreach_tracks partner_events people prospect_events prospect_state raw_snapshots sequence_tags sequenced_accounts settings signals source_events stage_marks suggestions sync_runs targets tidy_runs visit_skip week_goal_steps week_goals week_notes week_plans week_report week_report_sections'.split(' ').map(t => `sales_${t}`);
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
const blocked = [], realCalls = [], writes = [];
const results = { checks: [], errors: [], axe: {}, contrast: {}, n2: {}, numbers: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 180000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));


try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  async function open(width, { viewer = false, sub = null } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 }, hasTouch: width < 900 });
    await ctx.addInitScript(([k, v, bz, d]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      localStorage.setItem('prospector_goals_owner', 'team');
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, d);
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      const apiWrite = isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname);
      if (apiWrite) writes.push(`${req.method()} ${u.pathname.replace(/[0-9a-f-]{36}/g, ':id')}`);
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
    const page = await ctx.newPage(); page.setDefaultTimeout(30000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    await page.goto(`${BASE}/`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 30000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    if (sub) {
      await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: /^Dashboard/ }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
      await page.locator('[data-sales-subviews]').getByRole('button', { name: sub, exact: true }).dispatchEvent('click'); await page.waitForTimeout(2000);
    }
    return { ctx, page, errors };
  }
  const shot = (page, nme) => page.screenshot({ path: `${OUT}/${nme}.png`, animations: 'disabled', caret: 'hide', fullPage: false });
  const measure = async (page, key, scope) => {
    const m = await page.evaluate(measureScript({ scope }));
    if (m.error) { ok(`contrast ${key}`, false, m.error); return; }
    const s = summarize(m); results.contrast[key] = s;
    ok(`contrast ${key}: 0 text < 4.5:1 and 0 controls < 3:1 (text ${s.textFails}/${s.texts}, controls ${s.controlFails}/${s.controls})`, s.textFails === 0 && s.controlFails === 0, s.worst.slice(0, 6).map(w => `${w.ratio} ${w.kind === 'text' ? `T ${w.fg} on ${w.bg}` : `C via ${w.via}`} ${w.sel} "${w.text}"`).join(' | '));
  };
  const axeOn = async (page, key, sel) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async s => { const r = await window.axe.run(document.querySelector(s), { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); }, sel);
    results.axe[key] = v;
    ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v).slice(0, 300));
  };
  // The drawer's offset inside the Funnel card (its parent; scrollTop added back in case it ever scrolls).
  const pageY = loc => loc.evaluate(el => { const p = el.parentElement; return el.getBoundingClientRect().top - p.getBoundingClientRect().top + p.scrollTop; });


  for (const width of [1440, 390]) {
    const { ctx, page, errors } = await open(width, { sub: 'Sources' });
    const f = page.getByRole('region', { name: 'Funnel' });
    await f.waitFor({ timeout: 60000 }); await page.waitForTimeout(800);
    const row = f.locator('[data-funnel-row^="Brad"]').first();
    const label = await row.getAttribute('data-funnel-row');
    const visited = row.locator('[title^="List the "][title*=" visited for "]');
    const n = Number(await visited.innerText());
    if (width === 1440) results.numbers.brad_visited = n;
    await visited.click(); await page.waitForTimeout(400);
    const drawer = f.getByRole('region', { name: `${label} - Visited` });
    const names = await drawer.locator('[data-funnel-company]').evaluateAll(els => els.map(e => e.dataset.funnelCompany));
    const name = names.find(x => /hilton/i.test(x)) || names[0];
    const btn = drawer.getByRole('button', { name, exact: true });
    const top0 = await pageY(drawer);
    if (width === 1440) await btn.click(); else { await btn.focus(); await page.keyboard.press('Enter'); }
    const win = page.locator('[data-company-panel]');
    await win.waitFor({ timeout: 30000 }); await page.waitForTimeout(800);
    const title = await win.locator('h2').first().innerText();
    await shot(page, `funnel-window-${width}`);
    const stillOpen = await drawer.count();
    results.n2[width] = Math.abs((await pageY(drawer)) - top0);
    ok(`${width} Brad's Visited ${n} -> ${names.length} names; ${width === 1440 ? 'click' : 'Enter on'} "${name}" opens its window ("${title}"); the list stays open behind it; N2 ${results.n2[width]} px`, title === name && names.length === n && stillOpen === 1 && results.n2[width] === 0);
    await page.getByRole('button', { name: 'Close panel' }).first().click(); await page.waitForTimeout(500);
    const focused = await page.evaluate(() => document.activeElement?.textContent || '');
    ok(`${width} close -> the window is gone and focus is back on "${name}" ("${focused}"); 0 page errors`, (await win.count()) === 0 && focused === name && !errors.length, errors.join(' | '));
    if (width === 1440) await axeOn(page, 'funnel-drawer@1440', '[data-funnel-drawer]');
    await measure(page, `funnel-drawer@${width}`, '[data-funnel-drawer]');
    if (width === 390) ok('390 no sideways page scroll', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await ctx.close();
  }
  {
    const v = await open(1440, { viewer: true, sub: 'Sources' });
    const f = v.page.getByRole('region', { name: 'Funnel' });
    await f.waitFor({ timeout: 60000 }); await v.page.waitForTimeout(800);
    const row = f.locator('[data-funnel-row^="Brad"]').first();
    await row.locator('[title^="List the "][title*=" visited for "]').click(); await v.page.waitForTimeout(400);
    await f.locator('[data-funnel-drawer] [data-funnel-company] button').first().click();
    const win = v.page.locator('[data-company-panel]');
    await win.waitFor({ timeout: 30000 });
    ok(`Viewer: a funnel name opens the window read-only (star button ${await win.getByRole('button', { name: /star|top/i }).count()}); 0 page errors`, (await win.getByRole('button', { name: /star|top/i }).count()) === 0 && !v.errors.length, v.errors.join(' | '));
    await v.ctx.close();
  }
  ok(`0 Claude, 0 Apollo; every non-GET aborted (${[...new Set(writes)].join(', ') || 'none attempted'})`, !realCalls.length && writes.every(w => blocked.some(b => b.startsWith(w.split(' ')[0]))));
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    const after = await snapshot();
    const moved = TABLES.filter(t => before[t] !== after[t]).map(t => `${t} ${before[t]} -> ${after[t]}`);
    if (moved.length) throw new Error(`counts moved: ${moved.join(', ')}`);
    restored = true; line = `yes (${TABLES.length} table counts identical; sign-in row kept by rule, profile last_seen_at restored)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'p1-report.json'), JSON.stringify({ ...results, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\nhomelover-small-fixes-v1 P1 live check: ${passed}/${results.checks.length} passed · Claude 0 · Apollo 0 · writes 0\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
