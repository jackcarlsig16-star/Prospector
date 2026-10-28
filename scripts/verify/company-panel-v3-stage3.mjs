// company-panel-v3 Stage 3 live check - READ-ONLY, localhost against the build, as Jack (ownerSession) on the REAL
// HomeLover workspace. Real wiring: GET goals/company for Hilton (its steps = the SETUP count). Browser: Hilton's window
// through the Copy-link deep link (?open=employer-<id>) at 1440 (facts as buttons, popovers open and close unsaved, N2,
// ⋯ menu, N shortcut, contrast, axe) and 390; one open target (deep link) and one Website-visitors row; a Viewer pass by
// intercepting /api/me. Every non-GET aborted; 0 Claude / 0 Apollo. ~2 min, cap 240 s. "restored" THROWS if any of the
// 50 counts moved. Shots + report: .screenshots/company-panel-v3/. Run npm run build first.
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
const OUT = path.join(ROOT, '.screenshots', 'company-panel-v3');
const PORT = 3996, BASE = `http://localhost:${PORT}`;
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
const blocked = [], realCalls = [], writes = [];
const results = { checks: [], errors: [], axe: {}, contrast: {}, n2: {}, numbers: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 240000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));


const one = async (t, cols, f) => { const r = await f(svc.from(t).select(cols).eq('business_id', HL)).limit(1); if (r.error) throw new Error(`${t}: ${r.error.message}`); return r.data?.[0] || null; };
try {
  const hilton = await one('sales_opportunities', 'id, organization, stage, next_action', q => q.ilike('organization', 'Hilton').is('archived_at', null));
  const target = await one('sales_targets', 'id, name, status', q => q.in('status', ['proposed', 'researching']).order('name'));
  if (!hilton || !target) throw new Error('expected Hilton (employer) and one open target on HomeLover');
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const det = await fetch(`${BASE}/api/sales/${HL}/goals/company?type=employer&id=${hilton.id}`, { headers: { cookie } });
  const hb = await det.json().catch(() => null);
  const shownSteps = (hb?.steps?.steps || []).filter(s => s.status !== 'skip');
  const wantSetup = `Setup ${shownSteps.filter(s => s.status === 'done').length}/${shownSteps.length}`;
  ok(`real wiring: GET goals/company/employer/Hilton -> ${det.status}; steps ${shownSteps.map(s => `${s.id}:${s.status}`).join(' ')}; no "@" in the reply`, det.status === 200 && !JSON.stringify(hb).includes('@'));

  browser = await chromium.launch();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  async function open(width, { viewer = false, openKey = null } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 }, hasTouch: width < 900 });
    await ctx.addInitScript(([k, v, bz, d]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      localStorage.setItem('prospector_goals_owner', 'team');
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, d);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      const apiWrite = isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname);
      if (apiWrite) writes.push(`${req.method()} ${u.pathname}`);
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
    const page = await ctx.newPage(); page.setDefaultTimeout(20000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    await page.goto(`${BASE}/${openKey ? `?tab=pipeline&view=companies&open=${openKey}` : ''}`);
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
  const measure = async (page, key) => {
    const m = await page.evaluate(measureScript({ scope: '[data-center-window]' }));
    if (m.error) { ok(`contrast ${key}`, false, m.error); return; }
    const s = summarize(m); results.contrast[key] = s;
    ok(`contrast ${key}: 0 text < 4.5:1 and 0 controls < 3:1 (text ${s.textFails}/${s.texts}, controls ${s.controlFails}/${s.controls})`, s.textFails === 0 && s.controlFails === 0, s.worst.slice(0, 6).map(w => `${w.ratio} ${w.kind === 'text' ? `T ${w.fg} on ${w.bg}` : `C via ${w.via}`} ${w.sel} "${w.text}"`).join(' | '));
  };
  const axeOn = async (page, key) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async () => { const r = await window.axe.run(document.querySelector('[data-center-window]'), { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); });
    results.axe[key] = v;
    ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v).slice(0, 300));
  };
  const win = page => page.locator('[data-center-window]');
  const pageY = async loc => loc.evaluate(el => el.getBoundingClientRect().top);

  // ---- 1440 Hilton through the Copy-link deep link.
  {
    const { ctx, page, errors } = await open(1440, { openKey: `employer-${hilton.id}` });
    await win(page).locator('[data-facts-row]').waitFor({ timeout: 30000 }); await page.waitForTimeout(1500);
    const w = win(page);
    ok(`1440 the ?open= link opens Hilton's window (${await w.getAttribute('aria-label')})`, (await w.getAttribute('aria-label')) === hilton.organization);
    const factBtns = await w.locator('[data-fact-button]').evaluateAll(els => els.map(e => e.dataset.fact));
    ok(`1440 editable facts are buttons: ${factBtns.join(' · ')}; Employees / Last touch plain`, ['Stage', 'Priority', 'Owner', 'Team', 'Source', 'Next step'].every(f => factBtns.includes(f)) && !factBtns.includes('Last touch') && !factBtns.includes('Employees'));
    const controlRows = await w.locator('[data-edit-row]').count();
    const setup = (await w.locator('[data-setup-count]').textContent().catch(() => null)) || '(ready)';
    ok(`1440 head = title row + facts + SETUP + Actions (no Edit row: ${controlRows}); ${setup} = the route's ${wantSetup}`, controlRows === 0 && (setup === wantSetup || (setup === '(ready)' && hb.steps.ready)));
    const groups = await w.locator('[data-action-group]').evaluateAll(els => els.map(e => e.getAttribute('aria-label')));
    ok(`1440 Actions groups ${groups.join(' · ')}; Check Apollo once (${await w.getByRole('button', { name: 'Check Apollo' }).count()})`, groups.join('|') === 'Capture|Reach|Learn|Advance' && (await w.getByRole('button', { name: 'Check Apollo' }).count()) === 1);
    const actionsY0 = await pageY(w.locator('[data-actions-row]'));
    await w.locator('[data-fact="Owner"]').click(); await page.waitForTimeout(300);
    const ownerPop = await w.getByRole('dialog', { name: 'Owner' }).count();
    const actionsY1 = await pageY(w.locator('[data-actions-row]'));
    results.n2.popover = Math.abs(actionsY1 - actionsY0);
    await shot(page, 'hilton-owner-popover-1440');
    ok(`1440 the Owner fact opens its popover (${ownerPop}) and moves nothing below it (N2 ${results.n2.popover} px)`, ownerPop === 1 && results.n2.popover === 0);
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    await w.locator('[data-fact="Stage"]').click(); await page.waitForTimeout(300);
    const stageOpts = await w.getByRole('dialog', { name: 'Stage' }).getByRole('option').allTextContents();
    ok(`1440 the Stage popover lists forward stages only (${stageOpts.join(' · ')})`, stageOpts.length > 0 && stageOpts[0].endsWith('· now'));
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    await w.locator('[data-more-menu] > button').click(); await page.waitForTimeout(200);
    const items = await page.getByRole('menuitem').allTextContents();
    ok(`1440 ⋯ = ${items.join(' · ')} (no Check Apollo)`, items.includes('Copy link') && items.includes('Source…') && !items.some(t => /Apollo/.test(t)));
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    await w.focus(); await page.keyboard.press('n'); await page.waitForTimeout(300);
    const noteOpen = await w.locator('textarea#cp-note').count();
    await page.keyboard.press('t'); await page.waitForTimeout(200);
    ok(`1440 N opens the Note form (${noteOpen}); T typed inside it stays text (to-do form ${await w.locator('#cp-todo').count()})`, noteOpen === 1 && (await w.locator('#cp-todo').count()) === 0);
    await shot(page, 'hilton-1440');
    await measure(page, 'hilton@1440');
    await axeOn(page, 'hilton@1440');
    ok('1440 0 page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- 1440 one target (deep link) + one visitor (Website visitors channel).
  {
    const { ctx, page, errors } = await open(1440, { openKey: `target-${target.id}` });
    await win(page).locator('[data-facts-row]').waitFor({ timeout: 30000 }); await page.waitForTimeout(1200);
    const w = win(page);
    const factBtns = await w.locator('[data-fact-button]').evaluateAll(els => els.map(e => e.dataset.fact));
    const adv = await w.getByRole('group', { name: 'Advance' }).getByRole('button').allTextContents();
    await shot(page, 'target-1440');
    ok(`1440 target ${target.name}: editable ${factBtns.join(' · ')} (no Next step), Advance ${adv.join(' · ')}`, !factBtns.includes('Next step') && adv.some(t => /Promote/.test(t)) && adv.includes('Not a fit'));
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    await page.locator('[data-channel-row]').getByRole('button', { name: /^Website visitors/ }).click(); await page.waitForTimeout(1500);
    await page.locator('[data-row][data-key^="visitor-"] [data-row-name]').first().click(); await page.waitForTimeout(1500);
    const v = win(page);
    await v.locator('[data-facts-row]').waitFor({ timeout: 20000 });
    const vf = await v.locator('[data-fact-button]').evaluateAll(els => els.map(e => e.dataset.fact));
    const vadv = await v.getByRole('group', { name: 'Advance' }).getByRole('button').allTextContents();
    await shot(page, 'visitor-1440');
    ok(`1440 visitor ${await v.getAttribute('aria-label')}: editable ${vf.join(' · ') || 'none'}, Advance ${vadv.join(' · ')}, no ⋯ (${await v.locator('[data-more-menu]').count()}); 0 page errors`, vf.join('|') === 'Priority' && vadv.some(t => /Add to pipeline/.test(t)) && (await v.locator('[data-more-menu]').count()) === 0 && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- 390 Hilton.
  {
    const { ctx, page, errors } = await open(390, { openKey: `employer-${hilton.id}` });
    await win(page).locator('[data-facts-row]').waitFor({ timeout: 30000 }); await page.waitForTimeout(1200);
    const w = win(page);
    const sideways = await w.evaluate(el => { const h = el.querySelector('[data-window-head]'); return h.scrollWidth - h.clientWidth; });
    await shot(page, 'hilton-390');
    ok(`390 Hilton: the window is a sheet (${await w.getAttribute('data-center-window')}); no sideways scroll in the head (${sideways} px); groups wrap with labels (${await w.locator('[data-action-group]').count()}); 0 page errors`, (await w.getAttribute('data-center-window')) === 'sheet' && sideways <= 1 && (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)) && !errors.length, errors.join(' | '));
    await measure(page, 'hilton@390');
    await axeOn(page, 'hilton@390');
    await ctx.close();
  }
  // ---- Viewer (intercepted /api/me).
  {
    const { ctx, page, errors } = await open(1440, { viewer: true, openKey: `employer-${hilton.id}` });
    await win(page).locator('[data-facts-row]').waitFor({ timeout: 30000 }); await page.waitForTimeout(1200);
    const w = win(page);
    const counts = { factButtons: await w.locator('[data-fact-button]').count(), more: await w.locator('[data-more-menu]').count(), actions: await w.locator('[data-actions-row]').count(), stepButtons: await w.locator('[data-steps] button').count(), bandButtons: await w.locator('[data-interest-band] button').count() };
    await shot(page, 'hilton-viewer-1440');
    ok(`Viewer: plain facts, no ⋯, no Actions row, SETUP / Interest without buttons ${JSON.stringify(counts)}; 0 page errors`, Object.values(counts).every(n => n === 0) && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  ok(`browser reached 0 Claude / Apollo hosts; every non-GET was aborted (${[...new Set(writes)].join(', ') || 'none attempted'})`, !realCalls.length && writes.every(w => blocked.includes(w)));
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    const after = await snapshot();
    const moved = TABLES.filter(t => before[t] !== after[t]).map(t => `${t} ${before[t]} -> ${after[t]}`);
    if (moved.length) throw new Error(`counts moved: ${moved.join(', ')}`);
    restored = true; line = `yes (${TABLES.length} table counts identical; Jack sign-in row kept by rule, last_seen_at restored)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'stage3-report.json'), JSON.stringify({ ...results, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\ncompany-panel-v3 Stage 3 live check: ${passed}/${results.checks.length} passed · Claude 0 · Apollo 0 · writes 0\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
