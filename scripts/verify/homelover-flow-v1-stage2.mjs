// homelover-flow-v1 Stage 2 live check - localhost against the build, as Jack (ownerSession) on the REAL HomeLover
// workspace, READ-ONLY (Jack's go: 0 Claude, 0 Apollo, no writes): every non-GET API call and every Supabase write is
// aborted at the network layer and counted; the daily pulls are marked done in localStorage so nothing runs on load.
// Opens three real windows at 1440 (an employer with research + matched visits, Mace, HUB International) and the
// employer again at 390, compares each to the mockup (side-by-side PNGs in .screenshots/homelover-flow-v1-stage2/),
// checks the chips / cards against the DB, runs contrast + axe on each window, asserts 0 page errors. The Deprioritize
// sheet is opened on Mace and cancelled (no write). ~2 min, cap 280 s. Names only - never an address or a phone.
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
const OUT = path.join(ROOT, '.screenshots', 'homelover-flow-v1-stage2');
const MOCK = { A: path.join(ROOT, 'inbox', '2026-11-03-1700-homelover-panel-mock-A.png'), C: path.join(ROOT, 'inbox', '2026-11-03-1700-homelover-panel-mock-C.png') };
const PORT = 3995, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const TABLES = ['sales_opportunities', 'sales_goals', 'sales_targets', 'sales_flow_events', 'visit_priority_override', 'sales_week_goals', 'sales_company_scores', 'sales_company_score_days', 'sales_source_events', 'business_anthropic_usage', 'web_visits'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data?.[0]?.id;
if (!HL) throw new Error('no HomeLover business');
const count = async t => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL); if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message}`); return r.count; };
const snapshot = async () => { const o = {}; for (const t of TABLES) o[t] = await count(t); return o; };
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const nowT = new Date();
const minsToSix = ((6 - (nowT.getHours() % 6)) % 6) * 60 - nowT.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (nowT.getHours() % 6 === 0 && nowT.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
// The employer: research done + a matched visit row, at Contacted when one exists (mockup A is a Contacted employer).
const rr = new Set((await svc.from('research_runs').select('entity_id').eq('business_id', HL).eq('entity_type', 'employer').eq('status', 'done')).data.map(r => r.entity_id));
const vv = new Set((await svc.from('web_visits').select('matched_id').eq('business_id', HL).eq('matched_type', 'opportunity')).data.map(r => r.matched_id));
const opps = (await svc.from('sales_opportunities').select('id, organization, stage, employees, owner_user_id, fit_level, domain').eq('business_id', HL).is('archived_at', null)).data.filter(o => rr.has(o.id) && vv.has(o.id) && !/^mace$/i.test(o.organization));
const emp = opps.find(o => o.stage === 'contacted') || opps[0];
const mace = (await svc.from('sales_opportunities').select('id, organization, stage, fit_level').eq('business_id', HL).eq('organization', 'Mace').is('archived_at', null)).data[0];
const hub = (await svc.from('sales_goals').select('id, name, pipeline_status').eq('business_id', HL).eq('name', 'HUB International')).data[0];
if (!emp || !mace || !hub) throw new Error('need an employer with research + visits, Mace and HUB');
log(`employer: ${emp.organization} (${emp.stage}) · Mace (${mace.stage}, fit ${mace.fit_level || 'none'}) · HUB (${hub.pipeline_status})`);
const research = (await svc.from('research_runs').select('result').eq('business_id', HL).eq('entity_type', 'employer').eq('entity_id', emp.id).eq('status', 'done').order('created_at', { ascending: false }).limit(1)).data[0]?.result || {};
const linkedPeople = (await svc.from('sales_prospect_state').select('contact_id', { count: 'exact', head: true }).eq('business_id', HL).eq('opportunity_id', emp.id)).count || 0;
const scoreRow = (await svc.from('sales_company_scores').select('components, computed_at').eq('business_id', HL).eq('company_type', 'employer').eq('company_id', emp.id)).data?.[0];
const fitMeta = scoreRow?.components?.meta?.fit || null;
log(`score row computed ${scoreRow?.computed_at || 'never'} · fit meta ${fitMeta ? `${fitMeta.level} ${fitMeta.score}` : 'NOT YET (recompute pending)'} · linked people ${linkedPeople}`);
let srv, browser, owner;
const blocked = [], realCalls = [], writes = [];
const results = { checks: [], axe: {}, contrast: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  if (owner) { log(await owner.release()); owner = null; }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 280000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  async function open(width, { openKey }) {
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
      if (apiWrite) writes.push(`${req.method()} ${u.pathname.replace(HL, '<HL>').replace(/[0-9a-f-]{36}/g, '<id>')}`);
      const deny = apiWrite || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.pathname}`); return route.abort(); }
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
    await page.locator('[data-sales-subviews]').getByRole('tab', { name: 'Companies', exact: true }).dispatchEvent('click'); await page.waitForTimeout(1800);
    return { ctx, page, errors };
  }
  const win = page => page.locator('[data-center-window]');
  const shot = async (page, nme) => { await page.locator('[data-center-window]').screenshot({ path: `${OUT}/${nme}.png`, animations: 'disabled', caret: 'hide' }); return `${OUT}/${nme}.png`; };
  const measure = async (page, key, scope) => {
    const m = await page.evaluate(measureScript({ scope }));
    if (m.error) { ok(`contrast ${key}`, false, m.error); return; }
    const s = summarize(m); results.contrast[key] = s;
    ok(`contrast ${key}: text ${s.textFails}/${s.texts} < 4.5:1, controls ${s.controlFails}/${s.controls} < 3:1`, s.textFails === 0 && s.controlFails === 0, s.worst.slice(0, 4).map(w => `${w.ratio} ${w.text || w.label || ''}`).join(' | '));
  };
  const axeOn = async (page, key, sel) => {
    await page.addScriptTag({ content: AXE });
    const vs = await page.evaluate(async s => { const r = await window.axe.run(document.querySelector(s), { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, html: x.nodes[0]?.html?.slice(0, 120) })); }, sel);
    results.axe[key] = vs;
    ok(`axe ${key}: ${vs.length} violations`, vs.length === 0, JSON.stringify(vs).slice(0, 400));
  };
  // Side-by-side: the mockup beside the real window, rendered by the browser into one PNG.
  const sideBySide = async (mock, real, name) => {
    const ctx = await browser.newContext({ viewport: { width: 2000, height: 1200 } });
    const page = await ctx.newPage();
    const b64 = f => `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`;
    await page.setContent(`<html><body style="margin:0;background:#0b0f14;display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px"><div><div style="font:600 14px system-ui;color:#ccc;padding:4px 0">Mockup</div><img src="${b64(mock)}" style="width:100%"></div><div><div style="font:600 14px system-ui;color:#ccc;padding:4px 0">Prod data · this build</div><img src="${b64(real)}" style="width:100%"></div></body></html>`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    await ctx.close();
    return `${OUT}/${name}.png`;
  };
  const chipText = async (w, id) => (await w.locator(`[data-chip="${id}"]`).first().textContent().catch(() => '')).replace(/\s+/g, ' ').trim();

  // ---- 1440, the employer window (mockup A).
  {
    const { ctx, page, errors } = await open(1440, { openKey: `employer-${emp.id}` });
    const w = win(page);
    await w.locator('[data-section="fit"]').waitFor({ timeout: 30000 }); await page.waitForTimeout(2500);
    const layout = await w.locator('[data-layout]').getAttribute('data-layout');
    ok(`${emp.organization}: flow layout`, layout === 'flow', layout);
    const chips = { kind: await chipText(w, 'kind'), owner: await chipText(w, 'owner'), fit: await chipText(w, 'fit'), due: await chipText(w, 'due') };
    ok(`chips: ${JSON.stringify(chips)}`, chips.kind === `Employer · ${emp.stage[0].toUpperCase()}${emp.stage.slice(1)}` && !!chips.owner && /^(Strong|Good|Low) fit|Fit —|Deprioritized/.test(chips.fit));
    ok(`Fit chip vs DB: ${fitMeta ? `stored ${fitMeta.level} ${fitMeta.score}` : 'no fit meta stored yet (last recompute predates Stage 1) -> "Fit —"'}`, fitMeta ? chips.fit.toLowerCase().includes(fitMeta.level) : chips.fit.startsWith('Fit —'));
    const ownerColor = await w.locator('[data-chip="owner"]').first().evaluate(el => el.style.getPropertyValue('--owner-color'));
    const ownerRow = emp.owner_user_id ? (await svc.from('business_members').select('member_color').eq('business_id', HL).eq('user_id', emp.owner_user_id)).data?.[0] : null;
    ok(`owner chip color ${ownerColor} ${ownerRow ? `= stored member_color ${ownerRow.member_color}` : '(unassigned: dashed)'}`, ownerRow ? ownerColor.toLowerCase() === String(ownerRow.member_color).toLowerCase() : chips.owner === 'Unassigned');
    ok(`no facts row, no Setup strip (${emp.stage})`, (await w.locator('[data-facts-row]').count()) === 0 && (emp.stage === 'target' || (await w.locator('[data-steps]').count()) === 0));
    const next = (await w.locator('[data-next-step-text]').textContent()).trim();
    const sub = (await w.locator('[data-next-step-sub]').textContent().catch(() => '')).trim();
    const primary = await w.locator('[data-flow-primary]').getAttribute('data-flow-primary').catch(() => null);
    ok(`Next step: "${next}" · sub "${sub}" · primary ${primary}`, !!next && !!primary);
    const reached = (await w.locator('[data-reached]').first().textContent().catch(e => `ERR ${e.message.slice(0, 80)}`)).trim();
    const reachedSub = (await w.locator('[data-reached-sub]').textContent().catch(() => '')).trim();
    const m = /^(\d+)of (\d+) people$/.exec(reached);
    ok(`Reached: "${reached}" · "${reachedSub}" (DB: ${linkedPeople} linked prospects)`, m ? Number(m[2]) >= linkedPeople && Number(m[1]) <= Number(m[2]) : (await w.locator('[data-section="reached"]').textContent()).includes('Nobody known'));
    ok('Progress bar present', (await w.locator('[data-company-progress]').count()) === 1);
    const axesN = await w.locator('[data-fit-radar] [data-axis]').count();
    const missing = await w.locator('[data-fit-radar] [data-axis][data-missing]').count();
    const rows = await w.locator('[data-axis-row]').count();
    ok(`Fit at a glance: ${axesN} axes drawn, ${missing} "—", ${rows} rows${fitMeta ? '' : ' (will fill after the next recompute)'}`, (fitMeta ? axesN === 6 && rows === 6 : true));
    const ov = (await w.locator('[data-overview]').textContent()).replace(/\s+/g, ' ');
    ok(`Overview: employees ${emp.employees ?? '—'}, HQ "${research.hq_city || '—'}", industry "${research.sells_to || '—'}" all on screen`, (emp.employees == null || ov.includes(Number(emp.employees).toLocaleString('en-US'))) && (!research.hq_city || ov.includes(research.hq_city)) && (!research.sells_to || ov.includes(research.sells_to)));
    const groups = await w.locator('[data-action-group]').evaluateAll(els => els.map(e => e.getAttribute('aria-label')));
    ok(`Actions groups ${groups.join(' · ')}`, groups.join(',') === 'Reach,Decide,Capture,Learn');
    const row = w.locator('[data-actions-row]');
    ok('Actions row: Mark contacted hidden past Target; They replied… shown past Target', emp.stage === 'target' || ((await row.getByRole('button', { name: 'Mark contacted' }).count()) === 0 && (await row.getByRole('button', { name: '↩ They replied…' }).count()) === 1));
    const bar = await w.locator('[data-progress-bar] li[data-step]').evaluateAll(els => els.map(e => `${e.getAttribute('data-step')}:${e.getAttribute('data-state')}`));
    ok(`Progress steps ${bar.join(' ')}`, bar.length === 10 && bar[0].startsWith('target') && bar[1].startsWith('researched:done') && bar[9].startsWith('launched'));
    const real = await shot(page, 'employer-1440');
    await sideBySide(MOCK.A, real, 'compare-A-employer-1440');
    await measure(page, `${emp.organization} window@1440`, '[data-center-window]');
    await axeOn(page, `${emp.organization} window@1440`, '[data-center-window]');
    ok('1440 employer 0 page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- 1440, Mace: the Deprioritize sheet opens from the Fit chip (cancelled, no write).
  {
    const { ctx, page, errors } = await open(1440, { openKey: `employer-${mace.id}` });
    const w = win(page);
    await w.locator('[data-section="fit"]').waitFor({ timeout: 30000 }); await page.waitForTimeout(2000);
    const fitChip = await chipText(w, 'fit');
    ok(`Mace Fit chip "${fitChip}" (DB fit_level ${mace.fit_level || 'null'})`, mace.fit_level === 'deprioritized' ? /Deprioritized/.test(fitChip) : !/Deprioritized/.test(fitChip));
    await w.locator('[data-chip="fit"]').click(); await page.waitForTimeout(300);
    ok('Fit menu: Strong · Good · Low · Deprioritize…', (await page.getByRole('menu', { name: 'Fit' }).getByRole('menuitem', { name: 'Deprioritize…' }).count()) === 1);
    await page.getByRole('menu', { name: 'Fit' }).getByRole('menuitem', { name: 'Deprioritize…' }).click(); await page.waitForTimeout(400);
    const reasons = await page.getByRole('radiogroup', { name: 'Reason' }).getByRole('radio').allTextContents();
    ok(`Deprioritize sheet reasons: ${reasons.join(' · ')}`, reasons.join('|') === 'Mostly outside US|Too small|Wrong industry|Has housing perk|Upside owns|Other…');
    await page.getByRole('radio', { name: 'Mostly outside US' }).click(); await page.waitForTimeout(200);
    await shot(page, 'mace-deprioritize-sheet-1440');
    ok('Deprioritize button armed (not clicked - no writes in this check)', (await page.getByRole('button', { name: 'Deprioritize', exact: true }).isEnabled()));
    await page.getByRole('button', { name: 'Cancel' }).click(); await page.waitForTimeout(300);
    await axeOn(page, 'Mace window@1440', '[data-center-window]');
    ok('1440 Mace 0 page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- 1440, HUB (mockup C).
  {
    const { ctx, page, errors } = await open(1440, { openKey: `partner-${hub.id}` });
    const w = win(page);
    await w.locator('[data-network-header]').waitFor({ timeout: 30000 }); await page.waitForTimeout(2500);
    const layout = await w.locator('[data-layout]').getAttribute('data-layout');
    const live = await chipText(w, 'live'), kind = await chipText(w, 'kind'), ownerC = await chipText(w, 'owner');
    ok(`HUB chips: "${kind}" · "${live}" · owner "${ownerC}" · layout ${layout} · fit chip ${await w.locator('[data-chip="fit"]').count()} (none for a live partner)`, layout === 'live-partner' && /^Live since /.test(live) && /^Partner · /.test(kind) && (await w.locator('[data-chip="fit"]').count()) === 0);
    const next = (await w.locator('[data-next-step-text]').textContent()).trim();
    ok(`HUB Next step "${next}" with primary + Add a client they referred`, (await w.getByRole('button', { name: '+ Add a client they referred' }).count()) === 1);
    const came = (await w.locator('[data-section="came-from"]').textContent()).replace(/\s+/g, ' ');
    ok(`HUB Came from: "${came.slice(0, 120)}"`, /Partner referral|Source not set/.test(came));
    const header = (await w.locator('[data-network-header]').textContent()).trim();
    ok(`HUB Network header "${header}"`, /client · .* lives/.test(header));
    ok('HUB network tree shown', (await w.locator('[data-section="network-tree"] [data-network-node]').count()) >= 1);
    const groups = await w.locator('[data-action-group]').evaluateAll(els => els.map(e => e.getAttribute('aria-label')));
    ok(`HUB Actions groups ${groups.join(' · ')}`, groups.join(',') === 'Partner,Capture,Decide');
    ok('HUB hides Setup strip, progress bar, Mark contacted, Confirm site', (await w.locator('[data-steps]').count()) === 0 && (await w.locator('[data-company-progress]').count()) === 0 && (await w.getByRole('button', { name: 'Mark contacted' }).count()) === 0 && (await w.getByRole('button', { name: 'Confirm site' }).count()) === 0);
    const real = await shot(page, 'hub-1440');
    await sideBySide(MOCK.C, real, 'compare-C-hub-1440');
    await measure(page, 'HUB window@1440', '[data-center-window]');
    await axeOn(page, 'HUB window@1440', '[data-center-window]');
    ok('1440 HUB 0 page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- 390, the employer window as a sheet.
  {
    const { ctx, page, errors } = await open(390, { openKey: `employer-${emp.id}` });
    const w = win(page);
    await w.locator('[data-section="fit"]').waitFor({ timeout: 30000 }); await page.waitForTimeout(2000);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    ok('390: no horizontal page scroll', !overflow);
    await page.screenshot({ path: `${OUT}/employer-390.png`, fullPage: false });
    await axeOn(page, `${emp.organization} sheet@390`, '[data-center-window]');
    ok('390 employer 0 page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
} catch (e) {
  ok(`script error: ${e.message}`, false);
} finally {
  await cleanup();
}
const after = await snapshot();
const moved = TABLES.filter(t => before[t] !== after[t]).map(t => `${t} ${before[t]} -> ${after[t]}`);
const passed = results.checks.filter(c => c.pass).length;
console.log(`\nhomelover-flow-v1 Stage 2 live check: ${passed}/${results.checks.length} passed · ${Math.round((Date.now() - T0) / 1000)} s`);
console.log(`Claude / Apollo calls: ${realCalls.length} · API writes attempted (all aborted): ${writes.length}${writes.length ? ' ' + JSON.stringify([...new Set(writes)]) : ''} · other blocked: ${blocked.length}`);
console.log(`screenshots: ${fs.readdirSync(OUT).join(', ')}`);
console.log(`restored: ${moved.length ? `NO - ${moved.join(', ')}` : 'yes (read-only; no watched count moved)'}`);
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ emp: emp.organization, results, writes, realCalls, before, after }, null, 2));
if (moved.length) throw new Error('watched counts moved');
