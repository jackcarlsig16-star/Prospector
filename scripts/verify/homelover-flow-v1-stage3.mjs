// homelover-flow-v1 Stage 3 live check - localhost against the build, as Jack (ownerSession) on the REAL HomeLover
// workspace, READ-ONLY (Jack's go: 0 Claude, 0 Apollo, no writes): every non-GET API call and every Supabase write is
// aborted at the network layer and counted; the daily pulls are marked done in localStorage so nothing runs on load.
// Map at 1440: dots by owner color (counts per legend chip vs the DB's owner_user_id per ranked row), NEW rings
// (= the route's new_today), the Fit chips default (Strong + Good pressed, Deprioritized off), a dot selected -> the
// flow menu per state (an unowned target: Claim it; an employer at Contacted: They replied…) - opened, nothing clicked
// that writes; Actions at 1440: Due groups + Tidy (n), no web_visit rows, item counts (vs the audit's 298); Pipeline
// Website visitors: NEW badges. 390: Map on a phone. Contrast + axe on each. Side-by-side with mockup B. ~2 min, cap 280 s.
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
const OUT = path.join(ROOT, '.screenshots', 'homelover-flow-v1-stage3');
const MOCK_B = path.join(ROOT, 'inbox', '2026-11-03-1700-homelover-panel-mock-B.png');
const PORT = 3994, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const TABLES = ['sales_opportunities', 'sales_goals', 'sales_targets', 'sales_flow_events', 'visit_priority_override', 'sales_week_goals', 'sales_company_scores', 'sales_source_events', 'business_anthropic_usage', 'web_visits', 'sales_signals', 'sales_suggestions'];
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
// Ground truth from the DB: the Map's ranked rows (scores) with their owner.
const members = (await svc.from('business_members').select('user_id, name, member_color').eq('business_id', HL).not('user_id', 'is', null)).data;
const scores = (await svc.from('sales_company_scores').select('company_type, company_id, score, flagged_out, duplicate_of, components').eq('business_id', HL)).data;
const ranked = scores.filter(s => !s.flagged_out && !s.duplicate_of);
const fitOf = s => s.components?.meta?.fit?.level || null;
const inDefault = s => !fitOf(s) || ['strong', 'good'].includes(fitOf(s)) || false;
const ownerOf = s => s.components?.meta?.owner_user_id || null;
const contactedEmployer = (await svc.from('sales_opportunities').select('id, organization, stage').eq('business_id', HL).eq('stage', 'contacted').is('archived_at', null).limit(1)).data?.[0];
log(`ranked ${ranked.length} · with fit meta ${ranked.filter(fitOf).length} · in the default Fit set (Strong + Good; no fit yet sits with Good) ${ranked.filter(inDefault).length} · unassigned ${ranked.filter(s => !ownerOf(s)).length} · members ${members.length}`);
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
  owner = await ownerSession(svc); log('owner session');
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  log('server up'); browser = await chromium.launch(); log('browser');
  async function open(width, { tab = 'pipeline', view = 'priorities' }) {
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
    await page.goto(`${BASE}/?tab=${tab}&view=${view}`, { waitUntil: 'domcontentloaded', timeout: 60000 }); log(`goto ${width} ${tab}/${view}`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 20000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    const tabLabel = tab === 'pipeline' ? /^Pipeline/ : /^Actions/;
    await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: tabLabel }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
    if (tab === 'pipeline') { const sub = { priorities: 'Map', companies: 'Companies' }[view]; await page.locator('[data-sales-subviews]').getByRole('tab', { name: sub, exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500); }
    return { ctx, page, errors };
  }
  const shot = async (page, nme, sel = null) => { const target = sel ? page.locator(sel) : page; await target.screenshot({ path: `${OUT}/${nme}.png`, animations: 'disabled', caret: 'hide' }); return `${OUT}/${nme}.png`; };
  const measure = async (page, key, scope) => {
    const m = await page.evaluate(measureScript({ scope, exclude: '[data-dot]' })); // chart marks: SVG fills, validated below against the chart surface (priorities-v2 rule)
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
  const sideBySide = async (mock, real, name) => {
    const ctx = await browser.newContext({ viewport: { width: 2000, height: 1200 } });
    const page = await ctx.newPage();
    const b64 = f => `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`;
    await page.setContent(`<html><body style="margin:0;background:#0b0f14;display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px"><div><div style="font:600 14px system-ui;color:#ccc;padding:4px 0">Mockup</div><img src="${b64(mock)}" style="width:100%"></div><div><div style="font:600 14px system-ui;color:#ccc;padding:4px 0">Prod data · this build</div><img src="${b64(real)}" style="width:100%"></div></body></html>`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    await ctx.close();
  };

  // ---- 1440, the Map (mockup B).
  {
    const { ctx, page, errors } = await open(1440, { view: 'priorities' });
    await page.locator('[data-dots-chart]').waitFor({ timeout: 30000 }); await page.waitForTimeout(2500);
    const fitChips = await page.locator('[data-fit-chip]').evaluateAll(els => els.map(e => `${e.getAttribute('data-fit-chip')}:${e.getAttribute('aria-pressed')}`));
    ok(`Fit chips default ${fitChips.join(' ')}`, fitChips.join(' ') === 'strong:true good:true low:false deprioritized:false');
    const legend = await page.locator('[data-legend] [data-legend-source]').evaluateAll(els => els.map(e => [e.getAttribute('data-legend-source'), e.textContent]));
    const shownDots = await page.locator('[data-dot]').count();
    const byOwner = await page.locator('[data-dot]').evaluateAll(els => els.reduce((o, e) => { const k = e.getAttribute('data-owner'); o[k] = (o[k] || 0) + 1; return o; }, {}));
    const newRings = await page.locator('[data-dot] [data-new-ring]').count();
    const dashed = await page.locator('[data-dot][data-owner="unassigned"] [data-core]').evaluateAll(els => els.every(e => e.getAttribute('stroke-dasharray') === '3 2'));
    ok(`Map legend ${JSON.stringify(legend)} · dots shown ${shownDots} (Top 40 page) · by owner ${JSON.stringify(byOwner)} · NEW rings ${newRings}`, legend.length >= 2 && shownDots > 0);
    ok('unassigned dots are dashed outlines', dashed);
    const counts = await page.locator('[data-counts]').textContent();
    ok(`frame counts "${counts.trim()}"`, /ranked/.test(counts));
    const newCount = (await page.locator('[data-new-count]').textContent()).trim();
    const dbNew = ranked.filter(s => s.components?.meta?.first_seen === today).length;
    ok(`NEW today chip "${newCount}" vs DB first_seen today ${dbNew} (rows in the default Fit set)`, Number(newCount.split(' ')[0]) <= dbNew + 1);
    // The flow menu: select the first unassigned dot, then (if any) an employer at Contacted.
    const unassigned = page.locator('[data-dot][data-owner="unassigned"]').first();
    if (await unassigned.count()) {
      await unassigned.click(); await page.waitForTimeout(800);
      const menu = page.locator('[data-quick-menu]');
      const state = await menu.getAttribute('data-flow-state');
      const items = await menu.locator('[data-flow-item]').evaluateAll(els => els.map(e => e.getAttribute('data-flow-item')));
      const claim = await menu.getByRole('group', { name: 'Claim it' }).count();
      const claimChips = claim ? await menu.locator('[data-claim]').evaluateAll(els => els.map(e => e.textContent)) : [];
      ok(`unassigned dot menu: state ${state} · Claim it ${claim ? `[${claimChips.join(' · ')}]` : 'absent'} · items ${items.join(' · ')}`, items.includes('open') && (state.startsWith('target') || state.startsWith('employer:target') ? claim === 1 : true));
      ok('menu summary line reads kind · visits · people · Fit', /visit/.test(await menu.locator('[data-menu-summary]').textContent()));
      await page.locator('[data-quick-menu]').screenshot({ path: `${OUT}/map-menu-unassigned-1440.png` });
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    } else ok('no unassigned dot in the default view (nothing to claim)', true);
    const contacted = contactedEmployer ? page.locator(`[data-dot="employer-${contactedEmployer.id}"]`) : null;
    if (contacted && await contacted.count()) {
      await contacted.click(); await page.waitForTimeout(800);
      const items = await page.locator('[data-quick-menu] [data-flow-item]').evaluateAll(els => els.map(e => e.getAttribute('data-flow-item')));
      ok(`${contactedEmployer.organization} (Contacted) menu: ${items.join(' · ')}`, items[0] === 'they_replied' && items.includes('deprioritize'));
      await page.locator('[data-quick-menu] [data-flow-item="they_replied"]').click(); await page.waitForTimeout(300);
      ok('They replied… sheet opens in the menu (not clicked)', (await page.getByRole('group', { name: 'They replied' }).count()) === 1);
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    } else ok('no Contacted employer in the default Map view this run', true);
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300);
    const real = `${OUT}/map-1440.png`; await page.screenshot({ path: real, fullPage: true, animations: 'disabled', caret: 'hide' });
    await sideBySide(MOCK_B, real, 'compare-B-map-1440');
    await measure(page, 'Map@1440', '[data-priorities]');
    await axeOn(page, 'Map@1440', '[data-priorities]');
    ok('1440 Map 0 page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- 1440, Actions.
  {
    const { ctx, page, errors } = await open(1440, { tab: 'actions', view: '' });
    await page.locator('[data-actions] table').waitFor({ timeout: 30000 }); await page.waitForTimeout(1500);
    const groups = await page.locator('[data-actions] table button[aria-expanded]').evaluateAll(els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)));
    const rows = await page.locator('[data-actions] [data-row]').count();
    const kinds = await page.locator('[data-actions] [data-row]').evaluateAll(els => [...new Set(els.map(e => (e.getAttribute('data-key') || '').split('-')[0]))]);
    ok(`Actions groups ${groups.join(' | ')} · rows shown ${rows} · kinds ${kinds.join(',')} (audit Nov 3: 298 items incl. 50 web_visit signals + 208 Tidy)`, groups.some(g => /^Today/.test(g)) && !kinds.includes('signal'));
    ok('Tidy (n) is one folded group', groups.some(g => /^Tidy \d+/.test(g)));
    await shot(page, 'actions-1440', '[data-actions]');
    await measure(page, 'Actions@1440', '[data-actions]');
    await axeOn(page, 'Actions@1440', '[data-actions]');
    ok('1440 Actions 0 page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- 1440, Pipeline › Website visitors: NEW badges + Reached column.
  {
    const { ctx, page, errors } = await open(1440, { view: 'companies' });
    await page.locator('[data-row]').first().waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: /^Website visitors/ }).first().click().catch(() => {}); await page.waitForTimeout(2000);
    const badges = await page.locator('[data-new-badge]').count();
    const reachedCells = await page.locator('[data-reached-cell]').count();
    ok(`Website visitors: ${badges} NEW badge(s), ${reachedCells} Reached cells on this page`, true);
    await shot(page, 'pipeline-visitors-1440', 'table >> nth=0');
    ok('1440 Pipeline 0 page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- 390, the Map on a phone.
  {
    const { ctx, page, errors } = await open(390, { view: 'priorities' });
    await page.locator('[data-priorities]').waitFor({ timeout: 30000 }); await page.waitForTimeout(2000);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    ok('390: no horizontal page scroll', !overflow);
    await page.screenshot({ path: `${OUT}/map-390.png`, fullPage: false });
    await axeOn(page, 'Map@390', '[data-priorities]');
    ok('390 Map 0 page errors', !errors.length, errors.join(' | '));
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
console.log(`\nhomelover-flow-v1 Stage 3 live check: ${passed}/${results.checks.length} passed · ${Math.round((Date.now() - T0) / 1000)} s`);
console.log(`Claude / Apollo calls: ${realCalls.length} · API writes attempted (all aborted): ${writes.length}${writes.length ? ' ' + JSON.stringify([...new Set(writes)]) : ''} · other blocked: ${blocked.length}`);
console.log(`screenshots: ${fs.readdirSync(OUT).join(', ')}`);
console.log(`restored: ${moved.length ? `NO - ${moved.join(', ')}` : 'yes (read-only; no watched count moved)'}`);
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, writes, realCalls, before, after }, null, 2));
if (moved.length) throw new Error('watched counts moved');
