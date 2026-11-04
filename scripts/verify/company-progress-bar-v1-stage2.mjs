// company-progress-bar-v1 Stage 2 live check - localhost against the build, as Jack (ownerSession) on the REAL HomeLover
// workspace. TEMP data only: one website-visitor target "ZZ Progress Check <ts>" (channel website_visit) and one web_visits
// row matched to it, both deleted at the end (tempGuard runs the cleanup even if the run dies). Browser at 1440: the target's
// window (deep link) shows the Progress bar on Target -> its one primary "Mark contacted" -> the window becomes the new
// employer, the bar sits on Contacted, Last touch says today, the toast says "added to pipeline · Contacted" -> the
// Pipeline row shows Contacted -> Undo -> the employer is gone, the target and its visit are back. Contrast + axe on the
// window; 390 (bar wraps, no sideways scroll); a Viewer pass by intercepting /api/me (bar, no buttons). The ONLY writes
// allowed through are POST goals/company/target/<temp>/contacted and POST goals/prospect-targets/<temp>/contacted-undo;
// every other non-GET is aborted; 0 Claude / 0 Apollo. ~2 min, cap 240 s. "restored" THROWS if any watched count moved.
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
const OUT = path.join(ROOT, '.screenshots', 'company-progress-bar-v1-stage2');
const PORT = 3995, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const TABLES = ['sales_targets', 'sales_opportunities', 'sales_opportunity_events', 'sales_week_goals', 'sales_people', 'sales_source_events', 'sales_partner_events', 'research_runs', 'web_visits', 'business_anthropic_usage'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const biz = (await svc.from('businesses').select('id, name').ilike('name', '%homelover%')).data;
if (biz?.length !== 1) throw new Error('expected one HomeLover business');
const HL = biz[0].id;
async function count(t) {
  const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL);
  if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message || 'no count'}`);
  return r.count;
}
const snapshot = async () => { const o = {}; for (const t of TABLES) o[t] = await count(t); return o; };
const NAME = `ZZ Progress Check ${Date.now().toString(36)}`;
const KEY = NAME.toLowerCase();
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const nowT = new Date();
const minsToSix = ((6 - (nowT.getHours() % 6)) % 6) * 60 - nowT.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (nowT.getHours() % 6 === 0 && nowT.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
let srv, browser, owner, target = null, visit = null;
const blocked = [], realCalls = [], writes = [];
const results = { checks: [], errors: [], axe: {}, contrast: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function removeTemp() {
  const opps = (await svc.from('sales_opportunities').select('id').eq('business_id', HL).eq('organization', NAME)).data || [];
  for (const o of opps) {
    await svc.from('sales_people').update({ opportunity_id: null, company_type: 'parked' }).eq('business_id', HL).eq('opportunity_id', o.id);
    await svc.from('sales_source_events').delete().eq('business_id', HL).eq('record_type', 'employer').eq('record_id', o.id);
    await svc.from('sales_week_goals').delete().eq('business_id', HL).eq('link_type', 'opportunity').eq('link_id', o.id);
    await svc.from('sales_opportunities').delete().eq('business_id', HL).eq('id', o.id);
  }
  if (target) await svc.from('sales_week_goals').delete().eq('business_id', HL).eq('link_type', 'target').eq('link_id', target.id);
  await svc.from('sales_week_goals').delete().eq('business_id', HL).eq('text', `Contacted ${NAME}`);
  await svc.from('web_visits').delete().eq('business_id', HL).eq('company_key', KEY);
  await svc.from('sales_targets').delete().eq('business_id', HL).eq('name', NAME);
}
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  if (owner) { log(await owner.release()); owner = null; }
  await removeTemp();
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 240000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));

try {
  target = (await svc.from('sales_targets').insert({ business_id: HL, name: NAME, kind: 'employer', status: 'researching', channel: 'website_visit', evidence: 'temp verify row - company-progress-bar-v1 Stage 2' }).select('id, name, status').single()).data;
  if (!target) throw new Error('could not create the temp target');
  const v = await svc.from('web_visits').insert({ business_id: HL, company_key: KEY, company_name: NAME, priority: 'P4', pulled_on: today, last_visit: today, visits_7d: 1, top_paths: [], matched_type: 'target', matched_id: target.id }).select('id').single();
  if (v.error) throw new Error(`temp visit: ${v.error.message}`);
  visit = v.data;
  log('temp target + visit created');
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  const ALLOW = new RegExp(`^/api/sales/${HL}/goals/(company/target/${target.id}/contacted|prospect-targets/${target.id}/contacted-undo)$`);
  async function open(width, { viewer = false, openKey }) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 }, hasTouch: width < 900 });
    await ctx.addInitScript(([k, val, bz, d]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, val);
      localStorage.setItem('prospector_goals_owner', 'team');
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, d);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      const apiWrite = isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname);
      if (apiWrite) writes.push(`${req.method()} ${u.pathname.replace(HL, '<HL>').replace(target.id, '<temp>')}`);
      const deny = (apiWrite && !(req.method() === 'POST' && ALLOW.test(u.pathname))) || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.pathname}`); return route.abort(); }
      if (viewer && isLocal && u.pathname === '/api/me') {
        const r = await route.fetch(); const j = await r.json();
        j.profile = { ...j.profile, is_platform_owner: false };
        j.memberships = (j.memberships || []).map(m => (m.business_id === HL ? { ...m, role: 'viewer' } : m));
        return route.fulfill({ response: r, json: j });
      }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(20000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    await page.goto(`${BASE}/?tab=pipeline&view=companies&open=${openKey}`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 20000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: /^Pipeline/ }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
    await page.locator('[data-sales-subviews]').getByRole('tab', { name: 'Companies', exact: true }).dispatchEvent('click'); await page.waitForTimeout(1500);
    return { ctx, page, errors };
  }
  const shot = (page, nme) => page.screenshot({ path: `${OUT}/${nme}.png`, animations: 'disabled', caret: 'hide', fullPage: false });
  const win = page => page.locator('[data-center-window]');
  const measure = async (page, key) => {
    const all = await page.evaluate(measureScript({ scope: '[data-center-window]' }));
    if (!all.error) { const sa = summarize(all); results.contrast[`${key} (whole window, info)`] = sa; log(`INFO contrast ${key} whole window: text ${sa.textFails}/${sa.texts}, controls ${sa.controlFails}/${sa.controls}${sa.worst.length ? ` - worst ${sa.worst.slice(0, 2).map(w => `${w.ratio} ${w.text || ''}`).join(' | ')}` : ''}`); }
    const m = await page.evaluate(measureScript({ scope: '[data-company-progress]' }));
    if (m.error) { ok(`contrast ${key}`, false, m.error); return; }
    const s = summarize(m); results.contrast[key] = s;
    ok(`contrast ${key} (Progress section): 0 text < 4.5:1 and 0 controls < 3:1 (text ${s.textFails}/${s.texts}, controls ${s.controlFails}/${s.controls})`, s.textFails === 0 && s.controlFails === 0, s.worst.slice(0, 4).map(w => `${w.ratio} ${w.text || ''}`).join(' | '));
  };
  const axeOn = async (page, key) => {
    await page.addScriptTag({ content: AXE });
    const vs = await page.evaluate(async () => { const r = await window.axe.run(document.querySelector('[data-center-window]'), { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length })); });
    results.axe[key] = vs;
    ok(`axe ${key}: ${vs.length} violations`, vs.length === 0, JSON.stringify(vs).slice(0, 300));
  };

  // ---- 1440: Mark contacted on the visitor target -> employer at Contacted -> Pipeline row -> Undo.
  {
    const { ctx, page, errors } = await open(1440, { openKey: `target-${target.id}` });
    const w = win(page);
    await w.locator('[data-company-progress="target"]').waitFor({ timeout: 30000 }); await page.waitForTimeout(800);
    const now0 = await w.locator('[data-company-progress] [aria-current="step"]').getAttribute('data-step');
    const primary = (await w.locator('[data-progress-next]').textContent()) || '';
    await shot(page, 'target-before-1440');
    ok(`1440 the target's window shows the Progress bar on ${now0}, primary "${primary}"`, now0 === 'target' && primary === 'Mark contacted');
    await measure(page, 'target@1440');
    await axeOn(page, 'target@1440');
    await w.locator('[data-progress-next]').click();
    // The Undo window is 10 s: read the window, the DB and the Pipeline row first, then Undo.
    await page.locator('[data-company-progress="employer"]').waitFor({ timeout: 20000 }); await page.waitForTimeout(600);
    const [toast, nowStep, lastTouch, oppR, tgtR, visR] = await Promise.all([
      page.getByText(/added to pipeline · Contacted/).first().textContent().catch(() => ''),
      win(page).locator('[data-company-progress] [aria-current="step"]').getAttribute('data-step'),
      win(page).locator('[data-last-touch]').textContent().catch(() => ''),
      svc.from('sales_opportunities').select('id, stage, org_type').eq('business_id', HL).eq('organization', NAME).maybeSingle(),
      svc.from('sales_targets').select('status').eq('id', target.id).single(),
      svc.from('web_visits').select('matched_type, matched_id').eq('id', visit.id).single(),
    ]);
    await shot(page, 'employer-after-1440');
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    await page.getByLabel('Search companies').fill(NAME); await page.waitForTimeout(700);
    // A new record has no priority yet: its group starts collapsed.
    const group = page.getByRole('button', { name: /No priority/i }).first();
    if (await group.count() && (await group.getAttribute('aria-expanded')) !== 'true') { await group.click(); await page.waitForTimeout(300); }
    const rowText = await page.locator('[data-row]').filter({ hasText: NAME }).first().textContent({ timeout: 3000 }).catch(() => '');
    await shot(page, 'pipeline-row-1440');
    await page.getByRole('button', { name: 'Undo' }).first().click(); await page.waitForTimeout(2500);
    const opp = oppR.data, tgt = tgtR.data, vis = visR.data;
    ok(`1440 Mark contacted: toast "${toast}"; the window is now the employer, bar on ${nowStep}; ${lastTouch}`, /added to pipeline · Contacted/.test(toast) && nowStep === 'contacted' && /^Last touch: today · .+ · Contacted /.test(lastTouch));
    ok(`DB: employer ${opp ? `${opp.org_type} at ${opp.stage}` : 'MISSING'}; target ${tgt.status}; its visit now on ${vis.matched_type}`, opp?.stage === 'contacted' && opp?.org_type === 'employer' && tgt.status === 'accepted' && vis.matched_type === 'opportunity' && vis.matched_id === opp.id);
    ok(`Pipeline row shows Contacted ("${rowText.replace(/\s+/g, ' ').slice(0, 120)}")`, /Contacted/.test(rowText));
    const oppAfter = (await svc.from('sales_opportunities').select('id').eq('business_id', HL).eq('organization', NAME)).data || [];
    const tgtAfter = (await svc.from('sales_targets').select('status, decided_at').eq('id', target.id).single()).data;
    const visAfter = (await svc.from('web_visits').select('matched_type, matched_id').eq('id', visit.id).single()).data;
    const todos = (await svc.from('sales_week_goals').select('status, link_type').eq('business_id', HL).eq('text', `Contacted ${NAME}`)).data || [];
    await shot(page, 'after-undo-1440');
    ok(`Undo: employer gone (${oppAfter.length}); target back to ${tgtAfter.status}; visit back on ${visAfter.matched_type}; the to-do ${todos.map(t => t.status).join(',') || 'none'}`, oppAfter.length === 0 && tgtAfter.status === 'researching' && tgtAfter.decided_at === null && visAfter.matched_type === 'target' && visAfter.matched_id === target.id && todos.every(t => t.status === 'dropped'));
    ok('1440 0 page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- 390: the bar wraps; no sideways scroll.
  {
    const { ctx, page, errors } = await open(390, { openKey: `target-${target.id}` });
    const w = win(page);
    await w.locator('[data-company-progress]').waitFor({ timeout: 30000 }); await page.waitForTimeout(800);
    const sideways = await page.evaluate(() => { const b = document.querySelector('[data-progress-bar]'); const h = document.querySelector('[data-window-head]'); return { bar: b.scrollWidth - b.clientWidth, head: h ? h.scrollWidth - h.clientWidth : 0, page: document.documentElement.scrollWidth - window.innerWidth }; });
    const rows = await page.evaluate(() => new Set([...document.querySelectorAll('[data-progress-bar] > li')].map(li => Math.round(li.getBoundingClientRect().top))).size);
    await shot(page, 'target-390');
    ok(`390 the bar wraps onto ${rows} rows; sideways scroll bar ${sideways.bar} / head ${sideways.head} / page ${sideways.page} px; 0 page errors`, rows >= 2 && sideways.bar <= 0 && sideways.head <= 0 && sideways.page <= 0 && !errors.length, errors.join(' | '));
    await measure(page, 'target@390');
    await axeOn(page, 'target@390');
    await ctx.close();
  }
  // ---- Viewer (intercepted /api/me): the bar reads, no buttons.
  {
    const { ctx, page, errors } = await open(1440, { viewer: true, openKey: `target-${target.id}` });
    const w = win(page);
    await w.locator('[data-company-progress]').waitFor({ timeout: 30000 }); await page.waitForTimeout(800);
    const btns = await w.locator('[data-company-progress] button').count();
    await shot(page, 'target-viewer-1440');
    ok(`Viewer: Progress bar shown, ${btns} buttons in it; 0 page errors`, btns === 0 && (await w.locator('[data-progress-bar]').count()) === 1 && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  ok(`browser reached 0 Claude / Apollo hosts; writes = ${[...new Set(writes)].join(', ') || 'none'} (everything else aborted)`, !realCalls.length && writes.every(x => /contacted(-undo)?$/.test(x) || blocked.some(b => b.endsWith(x.split(' ')[1]))));
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    const after = await snapshot();
    const moved = TABLES.filter(t => before[t] !== after[t]).map(t => `${t} ${before[t]} -> ${after[t]}`);
    if (moved.length) throw new Error(`counts moved: ${moved.join(', ')}`);
    restored = true; line = `yes (${TABLES.length} table counts identical; temp target + visit deleted; sign-in row kept by rule, profile last_seen_at restored)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ ...results, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\ncompany-progress-bar-v1 Stage 2 live check: ${passed}/${results.checks.length} passed · Claude 0 · Apollo 0\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
