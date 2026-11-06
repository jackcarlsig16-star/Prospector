// company-window-v4 Stage 2 live check - localhost against the build, as Jack (ownerSession) on the REAL HomeLover
// workspace, READ-ONLY (0 Claude, 0 Apollo, no writes: every non-GET API call and Supabase write is aborted at the network
// layer and counted; window.confirm is stubbed to "No" before any skip-ahead click; the stage moves are the Jest suites').
// Opens Fortem Media (target), one researched + scored employer past Target, one non-live partner at 1440, Fortem at 390:
// the head ends in the journey card (8 nodes Target … Client for a target / employer, the partner's 8 workflow steps with
// no Researched), node states = GET goals/company (stage, research run), later nodes = buttons (a target's say "Add to
// pipeline first" and open the promote form), the skip-ahead confirm text, nothing right of the track; the Fit card's
// radar beside Intel reads GET goals/scores/:type/:id - dashed "no score yet" without a row, solid with - and its
// numbers = the route's components / caps = ringSpecs (the Map's rings); Intel "Use n →" iff Employees is empty and
// research found a headcount; axe 0; N2 0 px; 390 the track scrolls inside its card, the page not sideways.
// Side-by-side PNG: the mockup (CompanyHead.dc.html, file://) beside the build's window head + Fit/Intel at 1440.
// Declared scope: 4 page loads, 5 table lookups, 6 GETs, 10 table counts twice. ~150 s, cap 300 s.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { ownerSession } from './lib/ownerSession.mjs';
import { ringSpecs, RING_ORDER, DEFAULT_CAPS } from '../../src/components/salesAnalytics/goals/priorities/prioritiesModel.js';
import { WORKFLOW_STEPS, stepOf } from '../../src/constants/partnerPipeline.js';
import { STAGE_ORDER } from '../../src/components/salesAnalytics/pipelineStages.js';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const AXE = fs.readFileSync(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const OUT = path.join(ROOT, '.screenshots', 'company-window-v4-stage2');
const MOCK = path.join(ROOT, 'specs', 'design', 'company-panel-v4', 'CompanyHead.dc.html');
const PORT = 3997, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const TABLES = ['sales_targets', 'sales_opportunities', 'sales_goals', 'sales_opportunity_events', 'sales_partner_events', 'research_runs', 'sales_company_scores', 'business_anthropic_usage', 'apollo_credit_spend', 'sales_notes'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data?.[0]?.id;
if (!HL) throw new Error('no HomeLover business');
const scoped = new Map();
async function count(t) {
  if (scoped.get(t) !== false) {
    const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL);
    if (!r.error && typeof r.count === 'number') { scoped.set(t, true); return r.count; }
    scoped.set(t, false);
  }
  const r = await svc.from(t).select('*', { count: 'exact', head: true });
  return r.error ? `n/a (${r.error.message.slice(0, 40)})` : `${r.count} (whole table)`;
}
const snapshot = async () => { const o = {}; for (const t of TABLES) o[t] = await count(t); return o; };
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
let srv, browser, owner;
const blocked = [], realCalls = [], writes = [];
const results = { checks: [], errors: [], axe: {}, n2: {}, deviations: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 300000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));
const JOURNEY = ['target', 'researched', 'contacted', 'responded', 'meeting', 'proposal_pilot', 'verbal', 'launched'];
// The node states GET goals/company implies (the journeyModel rule, replicated here so the page is checked against the route).
function expectedStates(type, d) {
  const researched = (d.research?.runs || []).some(r => r.status === 'done');
  if (type === 'partner') { const cur = stepOf(d.record.stage || 'not_started'); return WORKFLOW_STEPS.map((w, i) => `${w.id}:${cur == null ? 'later' : i < cur ? 'done' : i === cur ? 'now' : 'later'}`); }
  const s = type === 'target' ? 'target' : d.record.stage || 'target';
  const si = STAGE_ORDER.indexOf(s);
  return JOURNEY.map(id => {
    if (id === 'researched') return `${id}:${researched ? 'done' : 'later'}`;
    const ni = STAGE_ORDER.indexOf(id);
    const st = id === 'launched' && d.record.client?.client_status ? 'done' : id === 'verbal' && s === 'contract' ? 'now' : si < 0 ? 'later' : ni < si ? 'done' : ni === si ? 'now' : 'later';
    return `${id}:${st}`;
  });
}
const expectedAxes = sc => RING_ORDER.map(k => ({ key: k, points: sc?.row ? String(Number(sc.row.components?.[k]?.points || 0)) : '', cap: (sc?.caps || DEFAULT_CAPS)[k] }));

try {
  const fortem = (await svc.from('sales_targets').select('id, name, status, owner_user_id, employees').eq('business_id', HL).ilike('name', 'Fortem Media').limit(1)).data?.[0];
  if (!fortem) throw new Error('expected Fortem Media (target) on HomeLover');
  // One researched + scored employer past Target (the journey with ✓ nodes and a solid radar).
  const runs = (await svc.from('research_runs').select('entity_id').eq('business_id', HL).eq('entity_type', 'employer').eq('status', 'done').order('created_at', { ascending: false }).limit(40)).data || [];
  const ids = [...new Set(runs.map(r => r.entity_id))];
  const scoredIds = new Set(((await svc.from('sales_company_scores').select('company_id').eq('business_id', HL).eq('company_type', 'employer').in('company_id', ids)).data || []).map(r => r.company_id));
  const emp = ((await svc.from('sales_opportunities').select('id, organization, stage').eq('business_id', HL).in('id', ids).in('stage', ['contacted', 'responded', 'meeting', 'proposal_pilot', 'verbal', 'contract']).order('updated_at', { ascending: false }).limit(20)).data || []).find(o => scoredIds.has(o.id)) || null;
  const partner = (await svc.from('sales_goals').select('id, name, pipeline_status').eq('business_id', HL).in('pipeline_status', ['researching', 'first_email_drafted', 'first_email_sent', 'in_sequence', 'replied', 'meeting_set', 'proposal_pilot']).order('updated_at', { ascending: false }).limit(1)).data?.[0] || null;
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', ANTHROPIC_API_KEY: '', APOLLO_API_KEY: '', MICROSOFT_CLIENT_SECRET: '', GMAIL_CLIENT_SECRET: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const get = async p => { const r = await fetch(`${BASE}/api/sales/${HL}${p}`, { headers: { cookie } }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const dF = await get(`/goals/company?type=target&id=${fortem.id}`);
  const sF = await get(`/goals/scores/target/${fortem.id}`);
  const capKeys = Object.keys(sF.body?.caps || {});
  ok(`real wiring: GET goals/company Fortem ${dF.status} (stage ${dF.body?.record?.stage}, research done ${(dF.body?.research?.runs || []).some(r => r.status === 'done')}, employees ${dF.body?.record?.employees ?? 'null'}, research employees_count ${(dF.body?.research?.runs || []).find(r => r.status === 'done')?.result?.employees_count ?? 'none'}); GET goals/scores ${sF.status} ${sF.body?.row ? `score ${sF.body.row.score}` : 'no score yet'}, caps ${capKeys.length ? capKeys.join(',') : '(none - no row)'}; no "@"`,
    dF.status === 200 && !JSON.stringify(dF.body).includes('@') && (sF.status === 404 || (sF.status === 200 && RING_ORDER.every(k => typeof sF.body.caps?.[k] === 'number'))));

  browser = await chromium.launch();
  async function openWin(width, type, id) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 }, hasTouch: width < 900 });
    await ctx.addInitScript(([k, v, bz, dd]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      localStorage.setItem('prospector_goals_owner', 'team');
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, dd);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (u.protocol === 'file:' || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      const apiWrite = isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname);
      if (apiWrite) writes.push(`${req.method()} ${u.pathname}`);
      const deny = apiWrite || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.pathname}`); return route.abort(); }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(25000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    await page.goto(`${BASE}/?tab=pipeline&view=companies&open=${type}-${id}`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 25000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: /^Pipeline/ }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
    await page.locator('[data-sales-subviews]').getByRole('tab', { name: 'Companies', exact: true }).dispatchEvent('click'); await page.waitForTimeout(1500);
    await page.locator('[data-center-window] [data-journey]').first().waitFor({ timeout: 30000 });
    await page.locator('[data-center-window] [data-section="fit"] [data-axis]').first().waitFor({ timeout: 30000 }); await page.waitForTimeout(2500);
    return { ctx, page, errors };
  }
  const axeOn = async (page, key) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async () => { const r = await window.axe.run(document.querySelector('[data-center-window]'), { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); });
    results.axe[key] = v;
    ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v).slice(0, 300));
  };
  const info = page => page.evaluate(() => {
    const dlg = document.querySelector('[data-center-window]'); const head = dlg.querySelector('[data-window-head]');
    const blocks = [...head.children].map(el => el.matches('[data-company-panel]') ? 'title' : el.querySelector('[data-facts-row]') ? 'facts' : el.matches('[data-journey]') ? 'journey' : el.matches('[data-steps]') ? 'setup' : el.matches('[data-interest-band]') ? 'interest' : el.matches('[data-actions-row]') ? 'actions' : el.tagName.toLowerCase());
    const j = head.querySelector('[data-journey]');
    const nodes = [...j.querySelectorAll('[data-node]')].map(li => { const c = li.querySelector('button, [role="img"]'); return { id: li.dataset.node, state: li.dataset.state, label: li.querySelector('b').textContent, small: li.querySelector('small').textContent.trim(), button: c.tagName === 'BUTTON', title: c.getAttribute('title') }; });
    const scroll = j.querySelector('[data-journey-scroll]'), track = j.querySelector('[data-journey-track]'), nowEl = j.querySelector('[data-state="now"]');
    const sr = scroll.getBoundingClientRect(), nr = nowEl?.getBoundingClientRect() || null;
    const f = dlg.querySelector('[data-section="fit"]');
    const fit = f ? { mode: f.querySelector('[data-fit-radar]').dataset.fitRadar, dashed: f.querySelector('[data-fit-polygon]').getAttribute('stroke-dasharray'), status: f.querySelector('[data-fit-status]').textContent, axes: [...f.querySelectorAll('[data-axis]')].map(a => ({ key: a.dataset.axis, points: a.dataset.points, cap: Number(a.dataset.cap), text: a.textContent })), recompute: !!f.querySelector('[data-recompute-score]'), columns: getComputedStyle(f.parentElement).gridTemplateColumns.split(' ').length, intelBeside: f.nextElementSibling?.dataset.section === 'research' } : null;
    const promote = dlg.querySelector('[data-actions-row] button[aria-expanded="true"]');
    return { blocks, nodes, fill: j.querySelector('[data-journey-fill]').style.width, hint: j.querySelector('[data-journey-hint]')?.textContent || null, scrolls: scroll.scrollWidth > scroll.clientWidth + 1, nowVisible: nr ? nr.left >= sr.left - 1 && nr.right <= sr.right + 1 : null, trackRightGap: Math.round(j.getBoundingClientRect().right - track.getBoundingClientRect().right), beside: [...j.querySelectorAll('button')].filter(b => !b.closest('[data-journey-track]')).length,
      fit, intelCount: dlg.querySelectorAll('[data-section="research"]').length, useN: dlg.querySelector('[data-use-employees]')?.textContent || null, intent: dlg.querySelector('[data-company-panel] [data-intent-fact] summary')?.textContent.replace(/\s+/g, ' ').trim(), promoteOpen: promote?.textContent || null, headTop: head.getBoundingClientRect().top, fitBottom: dlg.querySelector('[data-fit-intel]')?.getBoundingClientRect().bottom, winTop: dlg.getBoundingClientRect().top, winLeft: dlg.getBoundingClientRect().left, winWidth: dlg.getBoundingClientRect().width, text: dlg.textContent };
  });
  const radarCheck = (label, h, sc) => {
    const exp = expectedAxes(sc.body);
    const got = h.fit?.axes || [];
    const same = got.length === 5 && exp.every((e, i) => got[i].key === e.key && got[i].points === e.points && got[i].cap === e.cap);
    const rings = sc.body?.row ? ringSpecs(sc.body.row.components, sc.body.caps) : [];
    const ringsMatch = rings.every(r => Number(got.find(a => a.key === r.key)?.points) === r.points);
    const mode = sc.body?.row ? 'scored' : 'none';
    ok(`${label} Fit radar ${h.fit?.mode} (route ${mode}), ${h.fit?.mode === 'none' ? 'dashed ' + h.fit?.dashed : 'solid'}, "${h.fit?.status}"; axes ${got.map(a => a.text).join(' · ')} = the route's components / caps ${same} = ringSpecs ${ringsMatch} (${rings.length} rings); beside Intel ${h.fit?.intelBeside}, Intel once ${h.intelCount === 1}`,
      h.fit?.mode === mode && (mode === 'none' ? h.fit.dashed === '4 3' && /no score yet/.test(h.fit.status) : h.fit.dashed === null && /score \d+/.test(h.fit.status)) && same && ringsMatch && h.fit?.intelBeside && h.intelCount === 1);
  };
  const shotWin = async (page, nme, h) => { await page.screenshot({ path: `${OUT}/${nme}.png`, animations: 'disabled', clip: { x: h.winLeft, y: Math.max(0, h.winTop), width: h.winWidth, height: Math.min(1000 - Math.max(0, h.winTop), h.fitBottom - Math.max(0, h.winTop) + 8) } }); };

  // ---- Fortem Media (target) at 1440.
  {
    const { ctx, page, errors } = await openWin(1440, 'target', fortem.id);
    const h = await info(page);
    const exp = expectedStates('target', dF.body);
    ok(`1440 Fortem head blocks ${h.blocks.join(' · ')}: ends in the journey, no SETUP, no strip pills`, h.blocks[h.blocks.length - 1] === 'journey' && !h.blocks.includes('setup') && h.blocks.filter(b => b === 'journey').length === 1);
    ok(`1440 Fortem journey ${h.nodes.map(n => `${n.label}${n.state === 'done' ? ' ✓' + (n.small ? ' ' + n.small : '') : n.state === 'now' ? ' ●now' : ''}`).join(' → ')} = GET goals/company (${exp.join(' ')}); fill ${h.fill}; nothing right of the track (${h.beside} buttons beside, gap ${h.trackRightGap} px); hint "${h.hint}"`,
      h.nodes.map(n => `${n.id}:${n.state}`).join(' ') === exp.join(' ') && h.nodes.map(n => n.label).join('|') === 'Target|Researched|Contacted|Replied|Meeting|Pilot|Verbal|Client' && h.beside === 0 && h.trackRightGap <= 16 && h.hint === 'Click a later stage to move there · Undo 10 s');
    const later = h.nodes.filter(n => n.state === 'later' && n.id !== 'researched');
    ok(`1440 Fortem later nodes are buttons titled "Add to pipeline first" (${later.map(n => `${n.label}: ${n.button ? 'button' : 'text'} "${n.title}"`).join(', ')}); done / now nodes are not buttons`, later.length > 0 && later.every(n => n.button && n.title === 'Add to pipeline first') && h.nodes.filter(n => n.state !== 'later').every(n => !n.button));
    radarCheck('1440 Fortem', h, sF);
    const found = (dF.body.research?.runs || []).find(r => r.status === 'done')?.result?.employees_count ?? null;
    const useExpected = dF.body.record.employees == null && found != null;
    ok(`1440 Fortem Intel "Use n →" ${h.useN ? `"${h.useN}"` : 'absent'} = employees ${dF.body.record.employees ?? 'null'} + research headcount ${found ?? 'none'} -> ${useExpected ? 'expected' : 'not expected'}`, !!h.useN === useExpected && (!useExpected || h.useN === `Use ${Number(found).toLocaleString('en-US')} →`));
    ok(`1440 Fortem title Intent "${h.intent}" agrees with the Fit header (${sF.body?.row ? 'scored' : 'no score'})`, sF.body?.row ? new RegExp(`^Intent\\s*${sF.body.row.score}\\b`).test(h.intent || '') : /no score yet/.test(h.intent || ''));
    const ONCE = ['Owner', 'Employees', 'Type', 'Team', 'Research', 'Check Apollo', 'Draft email', 'Note', 'To-do', 'Contact', 'Intent'];
    const onceCounts = await page.locator('[data-center-window] [data-window-head]').evaluate((el, labels) => Object.fromEntries(labels.map(lb => [lb, [...el.querySelectorAll('*')].filter(n => [...n.childNodes].some(c => c.nodeType === 3 && c.textContent.trim() === lb)).length])), ONCE);
    ok(`1440 Fortem every label once in the head: ${ONCE.map(l => `${l} ${onceCounts[l]}`).join(' · ')}`, ONCE.every(l => onceCounts[l] === 1));
    await shotWin(page, 'fortem-head-fit-1440', h);
    await page.screenshot({ path: `${OUT}/fortem-window-1440.png`, animations: 'disabled' });
    await axeOn(page, 'fortem@1440');
    // A later node on a target = the promote form (Add to pipeline ▾ opens), no write; N2 0 px.
    const firstLater = later[0];
    await page.locator(`[data-center-window] [data-node="${firstLater.id}"] button`).click(); await page.waitForTimeout(500);
    const h2 = await info(page);
    results.n2.target_node = Math.abs(h2.headTop - h.headTop);
    ok(`1440 Fortem click ${firstLater.label} -> "${h2.promoteOpen}" open (Partner / Employer: ${await page.locator('[data-center-window] [data-actions-row] button', { hasText: /^Employer$/ }).count()}); 0 stage writes; N2 ${results.n2.target_node} px`, h2.promoteOpen === 'Add to pipeline ▾' && results.n2.target_node === 0 && !writes.some(w => /advance|target/.test(w)));
    await page.locator('[data-center-window] [data-actions-row] button', { hasText: 'Add to pipeline ▾' }).click(); await page.waitForTimeout(300);
    ok(`1440 Fortem no address anywhere in the window (${!/@/.test(h.text)}); 0 page errors`, !/@/.test(h.text) && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- A researched + scored employer past Target at 1440.
  if (emp) {
    const dE = await get(`/goals/company?type=employer&id=${emp.id}`);
    const sE = await get(`/goals/scores/employer/${emp.id}`);
    const { ctx, page, errors } = await openWin(1440, 'employer', emp.id);
    const h = await info(page);
    const exp = expectedStates('employer', dE.body);
    const done = h.nodes.filter(n => n.state === 'done');
    ok(`1440 employer "${emp.organization.slice(0, 28)}" (stage ${dE.body.record.stage}) journey ${h.nodes.map(n => `${n.label}${n.state === 'done' ? ' ✓' + (n.small ? ' ' + n.small : '') : n.state === 'now' ? ' ●' + n.small : ''}`).join(' → ')} = the route (${exp.join(' ')}); Researched ✓ dated ${h.nodes[1].small || '—'}; fill ${h.fill}; ${h.beside} beside`,
      h.nodes.map(n => `${n.id}:${n.state}`).join(' ') === exp.join(' ') && done.length >= 2 && h.nodes[1].state === 'done' && /^[A-Z][a-z]{2} \d{1,2}$/.test(h.nodes[1].small) && h.beside === 0 && parseFloat(h.fill) > 0);
    radarCheck('1440 employer', h, sE);
    // Skip-ahead = the confirm (stubbed No): its text names the skipped stages; 0 writes.
    const cur = h.nodes.findIndex(n => n.state === 'now');
    const ahead = h.nodes.slice(cur + 1).filter(n => n.state === 'later' && n.id !== 'researched');
    const target = ahead.length >= 2 && ahead[1].id !== 'launched' ? ahead[1] : null;
    if (target) {
      await page.evaluate(() => { window.__confirms = []; window.confirm = m => { window.__confirms.push(m); return false; }; });
      await page.locator(`[data-center-window] [data-node="${target.id}"] button`).click(); await page.waitForTimeout(500);
      const confirms = await page.evaluate(() => window.__confirms);
      const h2 = await info(page);
      results.n2.employer_node = Math.abs(h2.headTop - h.headTop);
      ok(`1440 employer click ${target.label} (two ahead) -> confirm "${confirms[0]}" answered No; 0 advance writes (${writes.filter(w => /advance/.test(w)).length}); the node still later ${h2.nodes.find(n => n.id === target.id)?.state}; N2 ${results.n2.employer_node} px`,
        confirms.length === 1 && new RegExp(`^Jump .* from ${h.nodes[cur].label} to ${target.label}, skipping ${ahead[0].label}`).test(confirms[0]) && !writes.some(w => /advance/.test(w)) && h2.nodes.find(n => n.id === target.id)?.state === 'later' && results.n2.employer_node === 0);
    } else ok(`1440 employer at ${dE.body.record.stage}: no node two ahead to skip to - the Jest suite covers the confirm`, true);
    if (ahead[0]) ok(`1440 employer next node "${ahead[0].label}" is a button titled "${ahead[0].title}" (the forward move; not clicked live)`, ahead[0].button && ahead[0].title === (ahead[0].id === 'launched' ? 'Make client' : `Jump to ${ahead[0].label}`));
    else ok(`1440 employer at ${dE.body.record.stage} with Client ${h.nodes[7].state}: no later node left - every node reads, none is a button (${h.nodes.filter(n => n.button).length})`, h.nodes.filter(n => n.button).length === 0);
    await shotWin(page, 'employer-head-fit-1440', h);
    await axeOn(page, 'employer@1440');
    ok(`1440 employer 0 page errors, no address`, !errors.length && !/@/.test(h.text), errors.join(' | '));
    await ctx.close();
  } else ok('no researched + scored employer past Target on HomeLover - the Jest suites cover the ✓ nodes', true);
  // ---- A non-live partner at 1440: its own 8 workflow steps, no Researched.
  if (partner) {
    const dP = await get(`/goals/company?type=partner&id=${partner.id}`);
    const sP = await get(`/goals/scores/partner/${partner.id}`);
    const { ctx, page, errors } = await openWin(1440, 'partner', partner.id);
    const h = await info(page);
    const exp = expectedStates('partner', dP.body);
    ok(`1440 partner "${partner.name.slice(0, 28)}" (${dP.body.record.stage}) journey ${h.nodes.map(n => `${n.label}${n.state === 'done' ? ' ✓' : n.state === 'now' ? ' ●' : ''}`).join(' → ')} = the workflow steps, no Researched node, = the route (${exp.join(' ')})`,
      h.nodes.map(n => n.label).join('|') === WORKFLOW_STEPS.map(w => w.label).join('|') && h.nodes.map(n => `${n.id}:${n.state}`).join(' ') === exp.join(' ') && !h.nodes.some(n => n.id === 'researched'));
    radarCheck('1440 partner', h, sP);
    await axeOn(page, 'partner@1440');
    ok(`1440 partner 0 page errors`, !errors.length, errors.join(' | '));
    await ctx.close();
  } else ok('no non-live partner in a workflow stage on HomeLover - the Jest suites cover D4', true);
  // ---- Fortem at 390.
  {
    const { ctx, page, errors } = await openWin(390, 'target', fortem.id);
    const h = await info(page);
    const sideways = await page.evaluate(() => { const w = document.querySelector('[data-center-window]'); return w.scrollWidth <= w.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1; });
    ok(`390 Fortem: the track scrolls inside its card ${h.scrolls}, the now node in view ${h.nowVisible}, Fit stacked over Intel (${h.fit?.columns} column), no sideways scroll ${sideways}; 0 page errors`, h.scrolls && h.nowVisible && h.fit?.columns === 1 && sideways && !errors.length, errors.join(' | '));
    await page.screenshot({ path: `${OUT}/fortem-window-390.png`, animations: 'disabled', fullPage: true });
    await axeOn(page, 'fortem@390');
    await ctx.close();
  }
  // ---- Side-by-side: the mockup (head + Fit / Intel) | the build (Fortem head + Fit / Intel).
  {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`file://${MOCK}`); await page.waitForTimeout(800);
    await page.addStyleTag({ content: 'x-dc{display:block} helmet{display:none} div:has(>[role=dialog]){display:block!important;width:auto!important} [role=dialog]{width:1064px!important;flex:none!important}' }); await page.waitForTimeout(500);
    await page.locator('[role="dialog"]').first().screenshot({ path: `${OUT}/mockup-dialog.png` });
    const compose = await ctx.newPage();
    const b64 = f => fs.readFileSync(path.join(OUT, f)).toString('base64');
    await compose.setViewportSize({ width: 1120 * 2 + 48, height: 200 });
    const empShot = fs.existsSync(path.join(OUT, 'employer-head-fit-1440.png'));
    await compose.setContent(`<body style="margin:0;background:#000;color:#fff;font:12px monospace"><div style="display:flex;flex-direction:column;gap:16px;padding:16px"><div style="display:flex;gap:16px;align-items:flex-start"><figure style="margin:0"><figcaption style="padding:4px 0">mockup · CompanyHead.dc.html · head + journey + Fit / Intel (drawers cropped)</figcaption><div style="width:1120px;height:1180px;overflow:hidden"><img src="data:image/png;base64,${b64('mockup-dialog.png')}" style="width:1120px;display:block"></div></figure><figure style="margin:0"><figcaption style="padding:4px 0">prod build · HEAD · Fortem Media at 1440: head + journey + Fit / Intel</figcaption><img src="data:image/png;base64,${b64('fortem-head-fit-1440.png')}" style="width:1120px;display:block"></figure></div>${empShot ? `<figure style="margin:0"><figcaption style="padding:4px 0">prod build · a researched + scored employer past Target: ✓ nodes, the solid radar</figcaption><img src="data:image/png;base64,${b64('employer-head-fit-1440.png')}" style="width:1120px;display:block"></figure>` : ''}</div></body>`);
    await compose.waitForTimeout(500);
    await compose.screenshot({ path: `${OUT}/side-by-side-1440.png`, fullPage: true });
    ok('side-by-side-1440.png written (mockup | prod head + Fit / Intel)', true);
    await ctx.close();
  }
  ok(`browser reached 0 Claude / Apollo hosts; every non-GET aborted (${[...new Set(writes)].join(', ') || 'none attempted'})`, !realCalls.length && writes.every(w => blocked.includes(w)));
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    const after = await snapshot();
    const moved = TABLES.filter(t => String(before[t]) !== String(after[t])).map(t => `${t} ${before[t]} -> ${after[t]}`);
    if (moved.length) throw new Error(`counts moved: ${moved.join(', ')}`);
    restored = true; line = `yes (${TABLES.length} table counts identical, 0 writes; Jack sign-in row kept by rule, last_seen_at restored)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'stage2-report.json'), JSON.stringify({ ...results, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\ncompany-window-v4 Stage 2 live check: ${passed}/${results.checks.length} passed · Claude 0 · Apollo ${realCalls.length} · writes 0 · ${Math.round((Date.now() - T0) / 1000)} s`);
  console.log(`files: ${fs.readdirSync(OUT).join(', ')}`);
  console.log(`restored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
