// lead-source-v1 Stage 3 - the lead-source UI end to end in a temp workspace: Dashboard > Sources backfill preview ->
// confirm two groups -> apply; the Sources report; Export for Upside (print area + PDF + CSV, structured fields only);
// the company window Source fact + Edit + Undo + Source history (incl. the Undo of a first pick clearing it); the
// partner window "Referred by Upside (n)"; Intake review referred_by as an editable field (fake extract) -> Accept writes
// the target's source; a Viewer pass; 1440 + 390 contrast (ui-clarity measure) and N2.
// SCOPE (declared): TEMP data only - 1 goals_sales workspace (added to SALES_ANALYTICS_BUSINESS_IDS for the local server
// only), 3 temp users (owner, member, viewer); 2 partners (Upside, ZZ Hub Brokers), 4 employers (2 with master-sheet
// blocks, 1 import channel, 1 Upside-owned with rep "Brad Zz"), 1 target. The run writes <= 12 source edits / backfill
// rows + events, 1 call note + 1 target (Intake Accept). Made-up names; no address anywhere. HomeLover never written
// (counts compared). 0 Claude (the browser's extract is fulfilled with a fixture; the real route is never reached) /
// 0 Apollo / 0 Graph: sync, apollo, visit pull, tidy, research, anthropic and /api/microsoft are aborted in the browser
// (count reported) and run tables counted. Runtime ~2-3 min, hard cap 300 s (tempGuard). Shots + report:
// .screenshots/lead-source-v1/. Run npm run build first.
// Usage: node scripts/verify/lead-source-v1-stage3.mjs [outdir]
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const { measureScript, summarize, formatWorst } = require(ROOT + '/scripts/verify/lib/contrastMeasure.cjs');
const OUT = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(ROOT, '.screenshots', 'lead-source-v1');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3981;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const NAME = 'ZZ Lead Source Stage3';
const HL = ['sales_goals', 'sales_opportunities', 'sales_targets', 'sales_source_events', 'sales_call_notes', 'sales_week_goals'];
const RUNS = ['research_runs', 'visit_pull_runs', 'sales_sync_runs', 'sales_tidy_runs'];
const TEMP_TABLES = ['sales_source_events', 'sales_partner_events', 'sales_week_goal_steps', 'sales_week_goals', 'sales_call_notes', 'sales_suggestions', ...RUNS, 'sales_opportunity_events', 'sales_targets', 'sales_opportunities', 'sales_goals', 'auth_events', 'business_members'];
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const count = async (t, col, v) => (await svc.from(t).select('*', { count: 'exact', head: true }).eq(col, v)).count;
const hlCounts = async () => { const o = {}; for (const t of HL) o[t] = await count(t, 'business_id', HOMELOVER); return o; };
let srv, browser, B, users = [];
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  if (B) {
    for (const t of TEMP_TABLES) { const r = await svc.from(t).delete().eq('business_id', B); if (r.error) console.log(`cleanup ${t}: ${r.error.message}`); }
    await svc.from('businesses').delete().eq('id', B);
  }
  for (const u of users) {
    await svc.from('auth_events').delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('actor_id', u.id);
    await svc.from('microsoft_sync_runs').delete().eq('user_id', u.id);
    await svc.auth.admin.deleteUser(u.id);
  }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 300000 });
const laToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
fs.mkdirSync(OUT, { recursive: true });
const hlBefore = await hlCounts();
log('HomeLover before', JSON.stringify(hlBefore));
const results = { screens: {}, checks: [], errors: [], leaks: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${detail}` : ''); };
const SCREEN = measureScript({ scope: '#sales-analytics-root' });
// The company window is measured on its own (the Pipeline rows behind it aren't this stage's).
const WINDOW = measureScript({ scope: 'aside[data-center-window]' });
const BOXES = `(() => Object.fromEntries(['data-workspace-header', 'data-sales-tabrow', 'data-sales-subviews', 'data-sales-frame'].map(a => {
  const el = document.querySelector('[' + a + ']'); if (!el) return [a, null];
  const r = el.getBoundingClientRect(); return [a, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }];
})))()`;
const maxMove = (a, b, keys) => Math.max(...keys.map(k => (a[k] && b[k] ? Math.max(Math.abs(a[k].x - b[k].x), Math.abs(a[k].y - b[k].y), Math.abs(a[k].h - b[k].h)) : 0)));
const sheet = (id, src, route) => `(10/14/2026) Imported\n\n— master sheet ${id} —\nSource: ${src}\nRoute in: ${route}\n`;

try {
  const tag = 'ls3-' + Date.now();
  B = ins(await svc.from('businesses').insert({ name: NAME, website_url: 'https://ls3.example.com', color: '#6F8CF0', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
  const mk = async (name, role) => {
    const email = `${tag}-${name.toLowerCase().replace(/\s+/g, '-')}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
    const { data: u, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(error.message);
    await svc.from('profiles').update({ display_name: name, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
    ins(await svc.from('business_members').insert({ business_id: B, email, name, user_id: u.user.id, role }).select());
    const anon = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data: s, error: sErr } = await anon.auth.signInWithPassword({ email, password });
    if (sErr) throw new Error(sErr.message);
    const u2 = { id: u.user.id, session: s.session, name }; users.push(u2); return u2;
  };
  const owner = await mk('Jack Test', 'owner'), member = await mk('Mia Member', 'member'), viewer = await mk('Vic Viewer', 'viewer');
  const today = laToday();
  const [UP, HUB] = ins(await svc.from('sales_goals').insert([
    { business_id: B, goal_type: 'partnership', name: 'Upside', pipeline_status: 'meeting_set', owner_team: 'both', channel: 'manual' },
    { business_id: B, goal_type: 'partnership', name: 'ZZ Hub Brokers', pipeline_status: 'replied', owner_team: 'homelover', channel: 'manual' },
  ]).select('id, name')).sort((a, b) => (a.name === 'Upside' ? -1 : 1)).map(p => p.id);
  ins(await svc.from('sales_opportunities').insert([
    { business_id: B, organization: 'ZZ Elm Health', org_type: 'employer', stage: 'meeting', source: 'csv', channel: 'import', owner_team: 'upside', co_owner_name: 'Brad Zz', covered_lives: 1200, notes: sheet('HLU-0001', 'Upside (Brad)', 'Brad intro at the Hub lunch') },
    { business_id: B, organization: 'ZZ Oak Foods', org_type: 'employer', stage: 'contacted', source: 'csv', channel: 'import', owner_team: 'homelover', notes: sheet('HLU-0002', 'HomeLover', 'HomeLover existing outreach') },
    { business_id: B, organization: 'ZZ Pine Logistics', org_type: 'employer', stage: 'target', source: 'manual', channel: 'import', owner_team: 'homelover' },
    { business_id: B, organization: 'ZZ Birch Labs', org_type: 'employer', stage: 'responded', source: 'csv', channel: 'import', owner_team: 'upside', co_owner_name: 'Brad Zz', notes: sheet('HLU-0003', 'Upside (Brad)', 'Brad emailed the CFO') },
  ]).select('id'));
  ins(await svc.from('sales_targets').insert({ business_id: B, name: 'ZZ Cedar Clinics', kind: 'employer', status: 'researching', channel: 'scout', created_by: owner.id }).select('id'));
  const opp = async name => ins(await svc.from('sales_opportunities').select('*').eq('business_id', B).eq('organization', name).single());
  const runsBefore = {}; for (const t of RUNS) runsBefore[t] = await count(t, 'business_id', B);
  log('fixture in');

  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  const blocked = [];
  let extractCalls = 0;
  const EXTRACT = {
    call_date: today, summary: [], tasks: [], categories: [], people: [], touches: [], ownership: [], facts: [],
    companies: [{ key: 'c0', name: 'ZZ Maple Dental', kind: 'employer', evidence: 'Brad says Maple Dental wants a pilot', match: null, action: 'target_employer', on: true, category: null,
      referred_by: { partner: 'Upside', partner_id: UP, person: 'Brad Zz', office: null } }],
  };
  async function newPage(u, { width = 1440, height = 900 } = {}) {
    const errs = [];
    const ctx = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
    const page = await ctx.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', e => errs.push(`PAGE ${u.name}@${width}: ${e.message.slice(0, 160)}`));
    page.on('requestfailed', r => { if (!blocked.includes(r.url())) results.errors.push(`request failed ${u.name}@${width}: ${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')} ${r.failure()?.errorText}`); });
    // A partner export or report must never carry free text from the notes or an address.
    page.on('response', async r => {
      if (!/\/goals\/(sources|partners\/[^/]+\/referred)/.test(r.url())) return;
      const t = await r.text().catch(() => '');
      if (t.includes('@') || /Hub lunch|emailed the CFO|existing outreach/.test(t) && /export|referred|sources\?/.test(r.url())) results.leaks.push(r.url().replace(/^.*\/goals/, ''));
    });
    await page.addInitScript(([k, v, b, dd]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      localStorage.setItem(`prospector_visits_ran_${b}`, dd); localStorage.setItem(`prospector_tidy_ran_${b}`, dd);
    }, [`sb-${REF}-auth-token`, JSON.stringify(u.session), B, today]);
    // Fake extract: the review is filled from a fixture, the real (Claude) route is never reached.
    await page.route(/\/goals\/call-notes\/extract$/, route => { extractCalls++; route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EXTRACT) }); });
    // Real-call guard: anything that could spend Claude, Apollo or Graph never leaves the browser.
    await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)|\/goals\/visits\/pull|\/goals\/tidy\/run|\/research\/run|\/research$|\/proxy\/anthropic|\/api\/microsoft\//, route => { blocked.push(route.request().url()); route.abort(); });
    await page.goto(`http://localhost:${PORT}/`);
    await page.locator('#main-content').getByText(NAME).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').selectOption({ label: NAME }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    const api = (p, opts) => page.evaluate(async ([bb, pp, o]) => { const r = await fetch(`/api/sales/${bb}/goals${pp}`, o ? { method: o.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o.body || {}) } : undefined); const t = await r.text(); let body; try { body = JSON.parse(t); } catch { body = t; } return { status: r.status, body }; }, [B, p, opts || null]);
    return { page, errs, api };
  }
  const tab = async (page, label) => { await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: new RegExp(`^${label}`) }).first().dispatchEvent('click'); await page.waitForTimeout(1200); };
  const sub = async (page, label) => { await page.locator('[data-sales-subviews]').getByRole('tab', { name: label, exact: true }).dispatchEvent('click'); await page.waitForTimeout(1500); };
  const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide', fullPage: true });
  const measure = async (page, key, scope = SCREEN) => {
    const m = await page.evaluate(scope);
    if (m.error) { results.errors.push(`${key}: ${m.error}`); return null; }
    const s = summarize(m); results.screens[key] = { ...s, scrollW: m.scrollW, vw: m.vw };
    log(key, `text ${s.textFails}/${s.texts}`, `controls ${s.controlFails}/${s.controls}`, `scroll ${m.scrollW}/${m.vw}`);
    if (s.textFails || s.controlFails) log(formatWorst(key, s));
    return s;
  };
  const openCompany = async (page, name) => {
    await tab(page, 'Pipeline'); await sub(page, 'Companies');
    await page.getByRole('button', { name, exact: true }).first().dispatchEvent('click');
    const win = page.locator('aside[data-center-window]'); await win.waitFor(); await win.locator('[data-company-panel]').waitFor(); await page.waitForTimeout(1800);
    return win;
  };
  const closeWin = async page => { await page.keyboard.press('Escape'); await page.waitForTimeout(500); };
  const sourceFact = win => win.locator('[data-fact="Source"]').innerText();

  // ---- Owner, 1440: Dashboard > Sources (N2 against Overview), backfill preview -> confirm 2 groups -> apply.
  const J = await newPage(owner);
  await tab(J.page, 'Dashboard'); await sub(J.page, 'Overview'); await J.page.waitForTimeout(800);
  const boxOverview = await J.page.evaluate(BOXES);
  await sub(J.page, 'Sources');
  await J.page.locator('[data-sources-view]').waitFor();
  const boxSources = await J.page.evaluate(BOXES);
  const mv = maxMove(boxOverview, boxSources, ['data-workspace-header', 'data-sales-tabrow', 'data-sales-subviews', 'data-sales-frame']);
  ok(`N2 1440: header, tab row, sub-view switch and frame row don't move from Overview to Sources (max ${mv} px)`, mv <= 1, JSON.stringify({ o: boxOverview['data-sales-frame'], s: boxSources['data-sales-frame'] }));
  ok('Sources before the backfill: 7 companies, all "Not set yet"', /7\s*companies/.test(await J.page.locator('[data-sources-totals]').innerText()) && /Not set yet/.test(await J.page.getByRole('region', { name: 'By source' }).innerText()));
  await J.page.getByRole('button', { name: 'Preview backfill' }).click();
  await J.page.locator('[data-backfill-group]').first().waitFor();
  const keys = await J.page.locator('[data-backfill-group]').evaluateAll(els => els.map(e => e.getAttribute('data-backfill-group')));
  ok('Backfill preview: grouped by value (Upside (Brad) x2, HomeLover, channels)', keys.includes('Source: Upside (Brad)') && keys.includes('Source: HomeLover') && keys.some(k => k.startsWith('Channel:')), JSON.stringify(keys));
  const upRow = J.page.locator('[data-backfill-group="Source: Upside (Brad)"]');
  ok('Preview proposes partner referral · Upside · the rep\'s full name (2 records)', (await upRow.getByLabel(/^Source kind for/).inputValue()) === 'partner_referral' && (await upRow.getByLabel(/^Partner for/).inputValue()) === UP && (await upRow.getByLabel(/^Person for/).inputValue()) === 'Brad Zz' && /2\s*2 employers/.test(await upRow.innerText()), await upRow.innerText());
  await measure(J.page, 'sources-backfill@1440'); await shot(J.page, 'ls3-backfill-1440');
  await J.page.getByLabel('Confirm Source: Upside (Brad)').check();
  await J.page.getByLabel('Confirm Source: HomeLover').check();
  J.page.once('dialog', d => d.accept());
  await J.page.getByRole('button', { name: 'Apply 2 confirmed groups (3 records)' }).click();
  await J.page.getByRole('status').filter({ hasText: /^Wrote 3 sources/ }).waitFor({ timeout: 20000 });
  const elm = await opp('ZZ Elm Health'), oak = await opp('ZZ Oak Foods'), pine = await opp('ZZ Pine Logistics');
  ok('Apply: Elm = partner referral · Upside · Brad Zz, route in kept; Oak = HomeLover outreach; Pine (unconfirmed) untouched; 3 backfill events',
    elm.source_kind === 'partner_referral' && elm.source_partner_id === UP && elm.source_person === 'Brad Zz' && elm.route_in === 'Brad intro at the Hub lunch' && !elm.source_set_by
    && oak.source_kind === 'homelover_outreach' && oak.route_in === 'HomeLover existing outreach' && pine.source_kind == null
    && (await svc.from('sales_source_events').select('id', { count: 'exact', head: true }).eq('business_id', B).eq('reason', 'backfill')).count === 3,
    JSON.stringify({ elm: [elm.source_kind, elm.source_person, elm.route_in], oak: oak.source_kind, pine: pine.source_kind }));
  ok('Re-preview: the applied groups are gone', !(await J.page.locator('[data-backfill-group="Source: Upside (Brad)"]').count()) && !(await J.page.locator('[data-backfill-group="Source: HomeLover"]').count()));

  // ---- The report + Export for Upside (print area, PDF, CSV).
  await sub(J.page, 'Overview'); await sub(J.page, 'Sources'); await J.page.locator('[data-sources-totals]').waitFor();
  const byPartner = J.page.getByRole('region', { name: 'By referring partner' });
  ok('Report: By referring partner = Upside 2 (one at Meeting), By rep = Brad Zz · Upside', /Upside/.test(await byPartner.innerText()) && /Brad Zz · Upside/.test(await J.page.getByRole('region', { name: 'By rep' }).innerText()), (await byPartner.innerText()).replace(/\s+/g, ' '));
  await J.page.getByLabel('Team').selectOption('homelover'); await J.page.waitForTimeout(1500);
  ok('Team filter: HomeLover-team only drops the Upside rows', !/Upside/.test(await byPartner.innerText()) && /HomeLover outreach/.test(await J.page.getByRole('region', { name: 'By source' }).innerText()));
  await J.page.getByLabel('Team').selectOption(''); await J.page.waitForTimeout(1500);
  await measure(J.page, 'sources@1440'); await shot(J.page, 'ls3-sources-1440');
  await byPartner.getByRole('button', { name: 'Export' }).click();
  const area = J.page.locator('#sales-analytics-print-area');
  await area.getByText('Companies referred by Upside').waitFor();
  const areaText = await area.innerText();
  ok('Export for Upside: Elm + Birch with stage, owner, covered lives, rep; no route in, notes or address', /ZZ Elm Health/.test(areaText) && /ZZ Birch Labs/.test(areaText) && /1,200/.test(areaText) && /Brad Zz/.test(areaText) && !/Hub lunch|emailed the CFO|@|Oak Foods/.test(areaText), areaText.replace(/\s+/g, ' ').slice(0, 220));
  ok('Exactly one print area on the page', (await J.page.locator('#sales-analytics-print-area').count()) === 1);
  await measure(J.page, 'export@1440'); await shot(J.page, 'ls3-export-1440');
  await J.page.emulateMedia({ media: 'print' });
  await J.page.pdf({ path: `${OUT}/ls3-export-upside.pdf`, landscape: true, printBackground: true });
  await J.page.screenshot({ path: `${OUT}/ls3-export-print.png`, fullPage: true });
  await J.page.emulateMedia({ media: 'screen' });
  const [dl] = await Promise.all([J.page.waitForEvent('download'), J.page.getByRole('button', { name: 'CSV', exact: true }).click()]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  fs.writeFileSync(`${OUT}/ls3-referred-by-upside.csv`, csv);
  ok('CSV: header + 2 rows, structured columns only', /^Company,Type,Stage,Owner,Covered lives,Referred by,Office/.test(csv.replace(/^﻿/, '')) && csv.trim().split('\n').length === 3 && !/Hub lunch|emailed|@/.test(csv), csv.split('\n')[0]);
  await J.page.getByRole('button', { name: 'Close', exact: true }).click(); await J.page.waitForTimeout(400);

  // ---- Company window: Source fact, Edit + Undo, history; a first pick's Undo clears it.
  let win = await openCompany(J.page, 'ZZ Elm Health');
  const factElm = await sourceFact(win);
  ok('Company window: Source = "Partner referral · Upside · Brad Zz" with "via Import" beside it', /Partner referral · Upside · Brad Zz/.test(factElm) && /via Import/.test(factElm), factElm.replace(/\s+/g, ' '));
  const hist = win.locator('[data-section="source-history"]');
  ok('Source history: the backfill row, route in shown', /backfill/i.test(await hist.innerText()) && /Not set → Partner referral · Upside · Brad Zz/.test(await hist.innerText()) && /Route in: Brad intro at the Hub lunch/.test(await hist.innerText()), (await hist.innerText()).replace(/\s+/g, ' '));
  await win.getByRole('button', { name: 'Source ▾' }).click();
  const form = win.locator('[data-source-form]');
  await form.getByLabel('Office').fill('Chicago');
  await form.getByLabel('Partner').locator('option', { hasText: 'Upside' }).waitFor({ state: 'attached' });
  await measure(J.page, 'company-source-form@1440', WINDOW); await shot(J.page, 'ls3-company-form-1440');
  await form.getByRole('button', { name: 'Save source' }).click();
  const tSave = Date.now();
  await win.locator('[data-fact="Source"]').filter({ hasText: 'Chicago' }).waitFor({ timeout: 10000 }).catch(() => {});
  log('fact refreshed after', Date.now() - tSave, 'ms');
  let e2 = await opp('ZZ Elm Health');
  ok('Edit: office Chicago saved as a person\'s pick (set by the owner), logged', e2.source_office === 'Chicago' && e2.source_set_by === owner.id && /Partner referral · Upside · Brad Zz · Chicago/.test(await sourceFact(win)) && /edited/i.test(await hist.innerText()), JSON.stringify({ office: e2.source_office, by: e2.source_set_by === owner.id, fact: await sourceFact(win) }));
  await J.page.getByRole('status').getByRole('button', { name: 'Undo' }).click(); await J.page.waitForTimeout(2500);
  e2 = await opp('ZZ Elm Health');
  ok('Undo: back to no office (route in kept), another history row', e2.source_office == null && e2.source_person === 'Brad Zz' && e2.route_in === 'Brad intro at the Hub lunch' && (await count('sales_source_events', 'record_id', e2.id)) === 3);
  await measure(J.page, 'company-employer@1440', WINDOW); await shot(J.page, 'ls3-company-1440');
  await closeWin(J.page);
  win = await openCompany(J.page, 'ZZ Pine Logistics');
  ok('Never-set record: Source "Not set" (muted) via Import', /Not set/.test(await sourceFact(win)) && /via Import/.test(await sourceFact(win)));
  await win.getByRole('button', { name: 'Source ▾' }).click();
  await win.locator('[data-source-form]').getByLabel('Kind').selectOption('event');
  await win.locator('[data-source-form]').getByRole('button', { name: 'Save source' }).click(); await J.page.waitForTimeout(2000);
  const p1 = await opp('ZZ Pine Logistics');
  await J.page.getByRole('status').getByRole('button', { name: 'Undo' }).click(); await J.page.waitForTimeout(2500);
  const p2 = await opp('ZZ Pine Logistics');
  ok('First pick (Event) then Undo: cleared back to never set, not a person\'s pick', p1.source_kind === 'event' && p2.source_kind == null && p2.source_set_by == null && p2.source_set_at == null && /Not set/.test(await sourceFact(win)), JSON.stringify([p1.source_kind, p2.source_kind]));
  await closeWin(J.page);

  // ---- Partner window: Referred by Upside (2), grouped by rep.
  win = await openCompany(J.page, 'Upside');
  const ref = win.locator('[data-section="referred-by"]');
  await ref.locator('[data-referred-group]').first().waitFor({ timeout: 20000 });
  const refText = await ref.innerText();
  ok('Partner window: "Referred by Upside (2)", one group "Brad Zz (2)" with Elm + Birch, stage + owner', /Referred by Upside/i.test(refText) && /\b2\b/.test(refText) && /Brad Zz \(2\)/i.test(refText) && /ZZ Elm Health/.test(refText) && /ZZ Birch Labs/.test(refText) && /1,200 lives/.test(refText), refText.replace(/\s+/g, ' '));
  await measure(J.page, 'company-partner@1440', WINDOW); await shot(J.page, 'ls3-partner-1440');
  await closeWin(J.page);

  // ---- Intake: referred_by is an editable field; Accept writes the new target's source.
  await tab(J.page, 'Actions');
  await J.page.getByRole('button', { name: /^Open tasks/ }).click();
  const drawer = J.page.locator('aside[aria-labelledby="task-drawer-title"]'); await drawer.waitFor(); await J.page.waitForTimeout(500);
  await drawer.getByRole('button', { name: '📝 Paste notes' }).click();
  await drawer.getByRole('textbox', { name: 'Call notes' }).fill(`Weekly with Brad ${tag}: Maple Dental wants a pilot.`);
  await drawer.getByRole('button', { name: 'Read notes' }).click();
  await drawer.getByRole('region', { name: 'Companies mentioned' }).waitFor();
  const refGroup = drawer.getByRole('group', { name: 'Referred by for ZZ Maple Dental' });
  ok('Intake review: Referred by Upside · Brad Zz as editable fields, "✓ in Pipeline"', (await refGroup.getByLabel('Partner who referred ZZ Maple Dental').inputValue()) === 'Upside' && (await refGroup.getByLabel('Person who referred ZZ Maple Dental').inputValue()) === 'Brad Zz' && /✓ in Pipeline/.test(await refGroup.innerText()));
  await refGroup.getByLabel('Office who referred ZZ Maple Dental').fill('Evanston');
  await measure(J.page, 'intake-review@1440'); await shot(J.page, 'ls3-intake-1440');
  await drawer.getByRole('button', { name: /^Accept/ }).click(); await J.page.waitForTimeout(3500);
  const maple = ins(await svc.from('sales_targets').select('id, source_kind, source_partner_id, source_person, source_office, source_set_by, channel').eq('business_id', B).eq('name', 'ZZ Maple Dental').maybeSingle());
  ok('Accept: target ZZ Maple Dental = partner referral · Upside · Brad Zz · Evanston (a person\'s pick), create event', maple?.source_kind === 'partner_referral' && maple.source_partner_id === UP && maple.source_person === 'Brad Zz' && maple.source_office === 'Evanston' && maple.source_set_by === owner.id && (await count('sales_source_events', 'record_id', maple.id)) === 1, JSON.stringify(maple));
  ok('Fake extract used once; the real extract route never reached', extractCalls === 1);
  await drawer.getByRole('button', { name: 'Close tasks' }).click().catch(() => {}); await J.page.waitForTimeout(300);

  // ---- 390: Sources, the export, the company window.
  const P = await newPage(owner, { width: 390, height: 844 });
  await tab(P.page, 'Dashboard'); await sub(P.page, 'Sources'); await P.page.locator('[data-sources-totals]').waitFor();
  await measure(P.page, 'sources@390'); await shot(P.page, 'ls3-sources-390');
  await P.page.getByRole('region', { name: 'By referring partner' }).getByRole('button', { name: 'Export' }).click();
  await P.page.locator('#sales-analytics-print-area').getByText('Companies referred by Upside').waitFor();
  await measure(P.page, 'export@390'); await shot(P.page, 'ls3-export-390');
  const pw = await openCompany(P.page, 'ZZ Elm Health');
  await pw.getByRole('button', { name: 'Source ▾' }).click();
  await pw.locator('[data-source-form]').getByLabel('Partner').locator('option', { hasText: 'Upside' }).waitFor({ state: 'attached' });
  await measure(P.page, 'company-source-form@390', WINDOW); await shot(P.page, 'ls3-company-390');
  const narrow = Object.entries(results.screens).filter(([key]) => key.endsWith('@390')).every(([, s]) => s.scrollW <= s.vw + 1);
  ok('390: no sideways page scroll on Sources, the export and the company window', narrow, JSON.stringify(Object.fromEntries(Object.entries(results.screens).filter(([key]) => key.endsWith('@390')).map(([key, s]) => [key, `${s.scrollW}/${s.vw}`]))));

  // ---- Member: no backfill (Admins only). Viewer: reads, never edits.
  const M = await newPage(member);
  await tab(M.page, 'Dashboard'); await sub(M.page, 'Sources'); await M.page.locator('[data-sources-totals]').waitFor();
  ok('Member: Sources shows, no Backfill section; the backfill routes refuse (403)', !(await M.page.locator('[data-sources-backfill]').count()) && (await M.api('/sources/backfill')).status === 403 && (await M.api('/sources/backfill/apply', { method: 'POST', body: { mappings: {} } })).status === 403);
  const V = await newPage(viewer);
  await tab(V.page, 'Dashboard'); await sub(V.page, 'Sources'); await V.page.locator('[data-sources-totals]').waitFor();
  ok('Viewer Sources: report + export readable, no Backfill', !(await V.page.locator('[data-sources-backfill]').count()) && (await V.page.getByRole('region', { name: 'By referring partner' }).getByRole('button', { name: 'Export' }).count()) === 1);
  await measure(V.page, 'viewer-sources@1440');
  const vw = await openCompany(V.page, 'ZZ Elm Health');
  ok('Viewer company window: Source fact + history shown, no Source ▾ / Edit row', /Partner referral · Upside · Brad Zz/.test(await sourceFact(vw)) && (await vw.locator('[data-section="source-history"]').count()) === 1 && !(await vw.getByRole('button', { name: 'Source ▾' }).count()) && !(await vw.locator('[data-edit-row]').count()));
  await measure(V.page, 'viewer-company@1440', WINDOW); await shot(V.page, 'ls3-viewer-company-1440');
  ok('Viewer: PATCH source refused (403)', (await V.api(`/source/employer/${elm.id}`, { method: 'PATCH', body: { source_kind: 'event' } })).status === 403);

  const fails = Object.entries(results.screens).filter(([, s]) => s.textFails || s.controlFails);
  ok(`ui-clarity measure: 0 failures on ${Object.keys(results.screens).length} screens`, !fails.length, JSON.stringify(fails.map(([key, s]) => [key, s.textFails, s.controlFails])));
  ok('No report / export / referred-by response carried an "@" or note free text', !results.leaks.length, JSON.stringify([...new Set(results.leaks)]));
  const errs = [...J.errs, ...P.errs, ...M.errs, ...V.errs];
  ok('No page errors', !errs.length, JSON.stringify(errs.slice(0, 5)));
  const runsAfter = {}; for (const t of RUNS) runsAfter[t] = await count(t, 'business_id', B);
  const graphRuns = (await Promise.all(users.map(u => count('microsoft_sync_runs', 'user_id', u.id)))).reduce((a, b) => a + b, 0);
  ok('Real-call guard: 0 research / visit pull / sync / tidy runs, 0 Graph runs', JSON.stringify(runsBefore) === JSON.stringify(runsAfter) && graphRuns === 0, `blocked ${blocked.length} browser calls · ${JSON.stringify(runsAfter)}`);
  results.calls = { claude: 0, apollo: 0, graph: graphRuns, fake_extracts: extractCalls, blocked: blocked.length, blockedUrls: [...new Set(blocked.map(x => x.replace(/^https?:\/\/[^/]+/, '').replace(/[0-9a-f-]{36}/g, ':id')))] };
  log('blocked', JSON.stringify(results.calls.blockedUrls));
} catch (e) {
  results.errors.push(e.stack || e.message);
  log('ERROR', e.message);
} finally {
  await cleanup();
  const hlAfter = await hlCounts();
  const restored = JSON.stringify(hlBefore) === JSON.stringify(hlAfter) && !(await count('businesses', 'id', B)) && !(await count('sales_source_events', 'business_id', B));
  results.restored = restored;
  const pass = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'lead-source-v1-stage3.json'), JSON.stringify(results, null, 2));
  console.log(`\n${pass}/${results.checks.length} checks passed${results.errors.length ? ` · ${results.errors.length} errors` : ''}`);
  for (const e of results.errors) console.log('ERROR:', e.split('\n').slice(0, 3).join(' | '));
  console.log(`restored: ${restored ? 'yes' : `NO - HomeLover ${JSON.stringify(hlBefore)} -> ${JSON.stringify(hlAfter)}`}`);
  process.exit(0);
}
