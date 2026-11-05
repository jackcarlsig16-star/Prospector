// FIX company-window-subtract-v1 live check - localhost against a build, as Jack (ownerSession) on the REAL HomeLover
// workspace, READ-ONLY (0 Claude, 0 Apollo, no writes: every non-GET API call and Supabase write aborted and counted).
// argv[2] = before | after (the screenshot set); --root <dir> = the checkout whose server.js + build/ to serve (the
// "before" set runs a worktree of the pre-fix commit). Opens Fortem Media (target: no score, no people), Hilton
// (employer with interest) and HUB International (live partner) at 1440, Fortem + Hilton at 390, Hilton as a Viewer
// (intercepted /api/me). "after" asserts: head = title · facts · strip · SETUP (only while incomplete) · Interest (only
// while live) · Actions; each label once in the head; no card in the head; the title row has no chips; the strip has
// 28 px pills, no label column, no primary on a target; the band has two buttons; DECIDE has no Owner / Next; N2 0 px
// when the Owner fact opens; axe 0 + contrast on every window; no sideways scroll at 390; the live partner unchanged;
// the Viewer sees no controls. "before" only records the counts and the shots. Declared scope: 6 page loads, 3 row
// lookups + 1 GET goals/company per record + 2 x 52 head counts. ~2.5 min, cap 280 s. Shots: .screenshots/fix-company-window-subtract-v1/.
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
const MODE = process.argv[2] === 'before' ? 'before' : 'after';
const rootArg = process.argv.indexOf('--root');
const SERVE = rootArg > 0 ? path.resolve(process.argv[rootArg + 1]) : ROOT;
const OUT = path.join(ROOT, '.screenshots', 'fix-company-window-subtract-v1');
const PORT = 3997, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const SALES = 'cadence_plan call_notes collateral company_score_days company_scores email_activity email_backfill_weeks email_daily_counts email_messages events goals huddles infra_items insight_dismissals lead_uploads mailbox_owners metric_targets metrics_daily month_goals opportunities opportunity_events outreach_campaigns outreach_contacts outreach_events outreach_steps outreach_tracks partner_events people prospect_events prospect_state raw_snapshots sequence_tags sequenced_accounts settings signals source_events stage_marks suggestions sync_runs targets tidy_runs visit_skip week_goal_steps week_goals week_notes week_plans week_report week_report_sections flow_events'.split(' ').map(t => `sales_${t}`);
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
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
let srv, browser, owner;
const blocked = [], realCalls = [], writes = [];
const results = { mode: MODE, serve: SERVE, checks: [], errors: [], axe: {}, contrast: {}, counts: {}, blocks: {}, n2: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
const note = (name, detail) => { results.checks.push({ name, pass: true, detail, note: true }); log('NOTE', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 280000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));

// The window head read from the DOM: block order, each label's own-text count, chips, cards, pill height.
const HEAD_PROBE = () => {
  const dlg = document.querySelector('[data-center-window]');
  const head = dlg?.querySelector('[data-window-head]');
  if (!head) return { error: 'no head' };
  const kind = el => (el.matches('[data-company-panel]') ? 'title' : el.querySelector('[data-facts-row]') ? 'facts' : el.matches('[data-company-progress]') ? 'strip' : el.matches('[data-steps]') ? 'setup' : el.matches('[data-steps-ready]') ? 'setup-ready' : el.matches('[data-interest-band]') ? 'interest' : el.matches('[data-actions-row]') ? 'actions' : el.matches('[data-flow-top]') ? 'cards' : el.tagName.toLowerCase());
  const own = el => Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
  const LABELS = { Stage: /^Stage$/, 'Next step': /^Next step$/, Owner: /^Owner$/, Intent: /^Intent$/, 'Mark contacted': /^Mark contacted$/, 'Book meeting': /^Book meeting$/, 'Check Apollo': /^Check Apollo$/, Research: /^Research$/, 'Draft email': /^Draft email$/, Promote: /Promote/, Deprioritize: /Deprioritize/, Note: /^Note$/, 'To-do': /^To-do$/, Contact: /^Contact$/, Employees: /^Employees$/, Fit: /^Fit/, Reached: /^Reached$/, Overview: /^Overview$/, 'Fit at a glance': /^Fit at a glance$/, Progress: /^Progress$/, 'Owner:': /^Owner:/, 'Next:': /^Next:/ };
  const scope = dlg; // the whole window, so the old layout's cards in the body count too
  const els = Array.from(scope.querySelectorAll('*'));
  // A fact's source tag ("Employees · Research") is a provenance word, not the Research action.
  const counts = Object.fromEntries(Object.entries(LABELS).map(([k, re]) => [k, els.filter(el => !el.matches('[data-fact-sub]') && re.test(own(el))).length]));
  const title = head.querySelector('[data-company-panel]');
  const strip = head.querySelector('[data-company-progress]');
  const pill = strip?.querySelector('[data-progress-bar] li > *');
  const band = head.querySelector('[data-interest-band]');
  const actions = head.querySelector('[data-actions-row]') || dlg.querySelector('[data-actions-row]'); // a live partner's row sits in the body
  const decide = actions?.querySelector('[data-action-group="decide"]');
  const row = actions?.firstElementChild;
  const yes = re => els.some(el => re.test(own(el)));
  return {
    blocks: Array.from(head.children).map(kind),
    layout: title?.getAttribute('data-layout'),
    chips: title ? title.querySelectorAll('[data-chip]').length : null,
    cardsInHead: head.querySelectorAll('[data-section]').length,
    cardsInWindow: Array.from(dlg.querySelectorAll('[data-section]')).map(s => s.getAttribute('data-section')),
    counts,
    pillHeight: pill ? Math.round(pill.getBoundingClientRect().height) : null,
    stripButtons: strip ? Array.from(strip.querySelectorAll('button')).filter(b => !b.closest('[data-progress-bar]')).map(b => b.textContent.trim()) : null,
    stripTitle: strip?.getAttribute('title') || null,
    bandButtons: band ? Array.from(band.querySelectorAll('button')).map(b => b.textContent.trim()) : null,
    groups: actions ? Array.from(actions.querySelectorAll('[data-action-group]')).map(g => g.getAttribute('aria-label')) : null,
    decide: decide ? Array.from(decide.querySelectorAll('button')).map(b => b.textContent.trim()) : null,
    lastInRow: row ? row.lastElementChild.textContent.trim() : null,
    tagOnOwnLine: row ? (() => { const tag = row.lastElementChild; const prev = tag.previousElementSibling; if (!prev) return null; const a = tag.getBoundingClientRect(), b = prev.getBoundingClientRect(); return a.top >= b.bottom - 1; })() : null,
    emptyWords: yes(/no score yet|nobody known at this company/i) || Array.from(head.querySelectorAll('*')).some(el => /nothing yet/i.test(own(el))),
    setupDone: Array.from(head.querySelectorAll('[data-steps] [data-status="done"]')).map(el => el.textContent.trim()),
    headBottom: Math.round(head.getBoundingClientRect().bottom),
    sideways: (() => { const h = dlg.querySelector('[data-window-head]'); return h.scrollWidth - h.clientWidth; })(),
  };
};

const one = async (t, cols, f) => { const r = await f(svc.from(t).select(cols).eq('business_id', HL)).limit(1); if (r.error) throw new Error(`${t}: ${r.error.message}`); return r.data?.[0] || null; };
try {
  const hilton = await one('sales_opportunities', 'id, organization, stage', q => q.ilike('organization', 'Hilton').is('archived_at', null));
  const fortem = await one('sales_targets', 'id, name, status', q => q.ilike('name', 'Fortem Media'));
  const hub = await one('sales_goals', 'id, name, pipeline_status', q => q.eq('name', 'HUB International'));
  if (!hilton || !fortem || !hub) throw new Error('expected Hilton (employer), Fortem Media (target) and HUB International (live partner) on HomeLover');
  log(`Hilton ${hilton.stage} · Fortem Media ${fortem.status} · HUB ${hub.pipeline_status} · serving ${SERVE}`);
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: SERVE, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', ANTHROPIC_API_KEY: '', APOLLO_API_KEY: '', MICROSOFT_CLIENT_SECRET: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const detailOf = async (type, id) => { const r = await fetch(`${BASE}/api/sales/${HL}/goals/company?type=${type}&id=${id}`, { headers: { cookie } }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const dH = await detailOf('employer', hilton.id), dF = await detailOf('target', fortem.id);
  const steps = d => { const s = (d.body?.steps?.steps || []).filter(x => x.status !== 'skip'); return { ready: !!d.body?.steps?.ready, text: `${s.filter(x => x.status === 'done').length}/${s.length}` }; };
  ok(`real wiring: GET goals/company Hilton ${dH.status} (steps ${steps(dH).text}${steps(dH).ready ? ' ready' : ''}, interest ${!!dH.body?.interest?.show}, people ${dH.body?.people?.length}), Fortem ${dF.status} (steps ${steps(dF).text}${steps(dF).ready ? ' ready' : ''}, interest ${!!dF.body?.interest?.show}, people ${dF.body?.people?.length}); no "@" in either`, dH.status === 200 && dF.status === 200 && !JSON.stringify(dH.body).includes('@') && !JSON.stringify(dF.body).includes('@'));

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
    await page.locator('[data-center-window] [data-actions-row], [data-center-window] [data-panel-body]').first().waitFor({ timeout: 30000 }); await page.waitForTimeout(2000);
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
  const probe = async (page, key) => { const p = await page.evaluate(HEAD_PROBE); results.counts[key] = p.counts; results.blocks[key] = p; return p; };
  const dupes = p => Object.entries(p.counts).filter(([, n]) => n > 1).map(([k, n]) => `${k} ×${n}`).join(' · ') || 'none';
  const ONCE = ['Stage', 'Owner', 'Intent', 'Check Apollo', 'Research', 'Draft email', 'Deprioritize', 'Note', 'To-do', 'Contact', 'Employees'];
  const once = (p, extra = []) => [...ONCE, ...extra].filter(k => p.counts[k] !== 1).map(k => `${k}=${p.counts[k]}`);
  const never = p => ['Fit', 'Reached', 'Overview', 'Fit at a glance', 'Progress', 'Owner:', 'Next:'].filter(k => p.counts[k] > 0).map(k => `${k}=${p.counts[k]}`);
  const AFTER = MODE === 'after';
  const assert = (name, pass, detail) => (AFTER ? ok(name, pass, detail) : note(name, detail));

  // ---- 1440 Fortem Media (target, no score, no people).
  {
    const { ctx, page, errors } = await open(1440, { openKey: `target-${fortem.id}` });
    const w = page.locator('[data-center-window]');
    const p = await probe(page, 'fortem@1440');
    await shot(page, `${MODE}-fortem-1440`);
    const wantF = ['title', 'facts', 'strip', ...(steps(dF).ready ? [] : ['setup']), ...(dF.body?.interest?.show ? ['interest'] : []), 'actions'];
    assert(`1440 Fortem: head blocks ${p.blocks.join(' · ')} = ${wantF.join(' · ')} (steps ${steps(dF).text}${steps(dF).ready ? ' ready' : ''}, interest ${!!dF.body?.interest?.show}; layout ${p.layout}); cards in head ${p.cardsInHead}; title chips ${p.chips}`, p.blocks.join('|') === wantF.join('|') && p.cardsInHead === 0 && p.chips === 0 && p.layout === 'classic');
    assert(`1440 Fortem: each label once (${once(p, ['Mark contacted', 'Book meeting', 'Promote']).join(', ') || 'all once'}); never ${never(p).join(', ') || 'none'}; duplicates: ${dupes(p)}`, once(p, ['Mark contacted', 'Book meeting', 'Promote']).length === 0 && never(p).length === 0);
    assert(`1440 Fortem: no "no score yet" / "nobody known" / "nothing yet" anywhere in the window (${p.emptyWords}); window cards ${p.cardsInWindow.join(', ')}`, !p.emptyWords && !p.cardsInWindow.includes('fit') && !p.cardsInWindow.includes('reached') && !p.cardsInWindow.includes('overview'));
    assert(`1440 Fortem: strip pills ${p.pillHeight} px, strip buttons ${JSON.stringify(p.stripButtons)}, tooltip "${p.stripTitle}"`, p.pillHeight === 28 && p.stripButtons?.length === 0 && /Click a stage to jump/.test(p.stripTitle || ''));
    assert(`1440 Fortem: SETUP done steps carry no value ${JSON.stringify(p.setupDone)}`, p.setupDone.every(t => !/·/.test(t)));
    assert(`1440 Fortem: Actions ${p.groups?.join(' · ')}; DECIDE ${JSON.stringify(p.decide)}; row ends with "${p.lastInRow}"`, p.groups?.join('|') === 'Reach|Decide|Capture|Learn' && p.decide?.join('|') === '↑ Promote ▾|Not a fit|↓ Deprioritize…' && p.lastInRow === '✦ generated' && p.tagOnOwnLine === false);
    if (AFTER) {
      const actionsY0 = await w.locator('[data-actions-row]').evaluate(el => el.getBoundingClientRect().top);
      await w.locator('[data-fact="Owner"]').click(); await page.waitForTimeout(300);
      const pop = await w.getByRole('dialog', { name: 'Owner' }).count();
      const actionsY1 = await w.locator('[data-actions-row]').evaluate(el => el.getBoundingClientRect().top);
      results.n2['fortem@1440'] = Math.abs(actionsY1 - actionsY0);
      ok(`1440 Fortem: the Owner fact opens its popover (${pop}) and moves nothing below it (N2 ${results.n2['fortem@1440']} px)`, pop === 1 && results.n2['fortem@1440'] === 0);
      await page.keyboard.press('Escape'); await page.waitForTimeout(200);
      // The strip's Assigned pill opens the same Owner fact (no second owner control).
      const assigned = w.locator('[data-progress-bar] [data-step="assigned"] button');
      // Close the popover with a click on the title (Esc from the strip would close the whole window).
      if (await assigned.count()) { await assigned.click(); await page.waitForTimeout(300); ok(`1440 Fortem: the Assigned pill opens the Owner fact popover (${await w.getByRole('dialog', { name: 'Owner' }).count()})`, (await w.getByRole('dialog', { name: 'Owner' }).count()) === 1); await w.locator('h2').first().click(); await page.waitForTimeout(200); ok(`1440 Fortem: the window is still open after the popover closes (popovers ${await w.getByRole('dialog', { name: 'Owner' }).count()})`, (await w.count()) === 1 && (await w.getByRole('dialog', { name: 'Owner' }).count()) === 0); }
      await measure(page, 'fortem@1440');
      await axeOn(page, 'fortem@1440');
    }
    ok(`1440 Fortem: 0 page errors`, !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- 1440 Hilton (employer with interest).
  {
    const { ctx, page, errors } = await open(1440, { openKey: `employer-${hilton.id}` });
    const p = await probe(page, 'hilton@1440');
    await shot(page, `${MODE}-hilton-1440`);
    const want = ['title', 'facts', 'strip', ...(steps(dH).ready ? [] : ['setup']), ...(dH.body?.interest?.show ? ['interest'] : []), 'actions'];
    assert(`1440 Hilton: head blocks ${p.blocks.join(' · ')} = ${want.join(' · ')} (steps ${steps(dH).text}${steps(dH).ready ? ' ready' : ''}, interest ${!!dH.body?.interest?.show}); cards in head ${p.cardsInHead}; title chips ${p.chips}`, p.blocks.join('|') === want.join('|') && p.cardsInHead === 0 && p.chips === 0);
    assert(`1440 Hilton: each label once (${once(p, ['Next step', 'Book meeting']).join(', ') || 'all once'}); Mark contacted ${p.counts['Mark contacted']} (${hilton.stage}); never ${never(p).join(', ') || 'none'}; duplicates: ${dupes(p)}`, once(p, ['Next step', 'Book meeting']).length === 0 && never(p).length === 0 && p.counts['Mark contacted'] === (hilton.stage === 'target' ? 1 : 0));
    assert(`1440 Hilton: Interest band buttons ${JSON.stringify(p.bandButtons)}`, !dH.body?.interest?.show || p.bandButtons?.join('|') === 'Follow up: draft reply|Not now');
    assert(`1440 Hilton: strip pills ${p.pillHeight} px, strip buttons ${JSON.stringify(p.stripButtons)}; DECIDE ${JSON.stringify(p.decide)}; row ends with "${p.lastInRow}"`, p.pillHeight === 28 && !p.stripButtons?.includes('Mark contacted') && p.decide?.join('|') === '↓ Deprioritize…' && p.lastInRow === '✦ generated' && p.tagOnOwnLine === false);
    if (AFTER) { await measure(page, 'hilton@1440'); await axeOn(page, 'hilton@1440'); }
    ok(`1440 Hilton: 0 page errors`, !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- 1440 HUB International (live partner) - unchanged.
  {
    const { ctx, page, errors } = await open(1440, { openKey: `partner-${hub.id}` });
    const p = await probe(page, 'hub@1440');
    await shot(page, `${MODE}-hub-1440`);
    assert(`1440 HUB: live-partner layout (${p.layout}); head blocks ${p.blocks.join(' · ')}; owner chip in the title (${p.chips}); cards ${p.cardsInWindow.join(', ')}`, p.layout === 'live-partner' && p.blocks.join('|') === 'title' && p.chips >= 1);
    assert(`1440 HUB: Next step card + Came from + Network view; no stage strip, no SETUP, no Mark contacted; DECIDE ${JSON.stringify(p.decide)}`, p.cardsInWindow.includes('next-step') && p.cardsInWindow.includes('came-from') && (await page.locator('[data-center-window] [data-section="network-tree"]').count()) === 1 && (await page.locator('[data-center-window] [data-company-progress], [data-center-window] [data-steps]').count()) === 0 && p.counts['Mark contacted'] === 0 && /^Owner: /.test(p.decide?.[0] || '') && p.decide?.[1] === 'Pause…');
    if (AFTER) await axeOn(page, 'hub@1440');
    ok(`1440 HUB: 0 page errors`, !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- 390 Fortem + Hilton.
  for (const [key, rec, openKey] of [['fortem', fortem, `target-${fortem.id}`], ['hilton', hilton, `employer-${hilton.id}`]]) {
    const { ctx, page, errors } = await open(390, { openKey });
    const w = page.locator('[data-center-window]');
    const p = await probe(page, `${key}@390`);
    await shot(page, `${MODE}-${key}-390`);
    const pageWide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    assert(`390 ${key}: sheet (${await w.getAttribute('data-center-window')}); head sideways ${p.sideways} px; page sideways ${!pageWide}; blocks ${p.blocks.join(' · ')}; duplicates: ${dupes(p)}; generated tag on its own line: ${p.tagOnOwnLine}`, (await w.getAttribute('data-center-window')) === 'sheet' && p.sideways <= 1 && pageWide && p.cardsInHead === 0 && p.chips === 0 && p.tagOnOwnLine === false);
    if (AFTER) { await measure(page, `${key}@390`); await axeOn(page, `${key}@390`); }
    ok(`390 ${key}: 0 page errors`, !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- Viewer (intercepted /api/me) on Hilton.
  if (AFTER) {
    const { ctx, page, errors } = await open(1440, { viewer: true, openKey: `employer-${hilton.id}` });
    const w = page.locator('[data-center-window]');
    const counts = { factButtons: await w.locator('[data-fact-button]').count(), chips: await w.locator('[data-company-panel] [data-chip]').count(), more: await w.locator('[data-more-menu]').count(), actions: await w.locator('[data-actions-row]').count(), stripButtons: await w.locator('[data-company-progress] button').count(), stepButtons: await w.locator('[data-steps] button').count(), bandButtons: await w.locator('[data-interest-band] button').count() };
    await shot(page, 'after-hilton-viewer-1440');
    ok(`Viewer Hilton: plain facts, no chips, no ⋯, no Actions row, strip / SETUP / Interest without buttons ${JSON.stringify(counts)}; 0 page errors`, Object.values(counts).every(n => n === 0) && !errors.length, errors.join(' | '));
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
  fs.writeFileSync(path.join(OUT, `results-${MODE}.json`), JSON.stringify({ ...results, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\nFIX company-window-subtract-v1 live check (${MODE}): ${passed}/${results.checks.length} passed · Claude 0 · Apollo ${realCalls.length} · writes 0 · ${Math.round((Date.now() - T0) / 1000)} s`);
  console.log(`label counts: ${JSON.stringify(results.counts)}`);
  console.log(`screenshots: ${fs.readdirSync(OUT).filter(f => f.startsWith(MODE)).join(', ')}`);
  console.log(`restored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
