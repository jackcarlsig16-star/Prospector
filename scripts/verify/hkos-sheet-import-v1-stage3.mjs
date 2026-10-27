// hkos-sheet-import-v1 Stage 3 live check - localhost against the build, as Jack (ownerSession: magic-link session, no
// email sent; sign-in rows KEPT by rule, last_seen_at restored) on the REAL HumanKind workspace, through the real wiring
// (spawned server.js, cookie -> hkGate -> hkRoute(file, name)). The file is an INVENTED 12-row workbook built here with
// exceljs ("Zz Verify ..." names on .invalid domains); the real tracker in inbox/ is never opened.
// WRITES (declared): the browser may POST only /api/hk/<HumanKind>/imports/preview (1 hk_import_runs row), then
// /imports/<id>/commit (10 brands, their contacts / touches / periods, one brand.created event each + import.committed),
// then /imports/<id>/undo (deletes exactly those; + import.undone). At the end the script deletes the run row and its two
// import.* events by id, so every count returns. Every other non-GET to /api, /proxy and Supabase REST is aborted; every
// outside host except Supabase + Google Fonts is blocked (an Anthropic / Apollo / Gmail host fails the run).
// restored = every hk_* count for HumanKind + HomeLover counts identical before / after; a count() error THROWS ->
// "restored: NO". Contrast on 3 screens must be 0 failures; 390 px renders without sideways scroll. Runtime ~2-3 min,
// hard cap 300 s. 0 Claude, 0 Apollo, 0 Gmail. Addresses are never printed or screenshotted (the preview shows presence
// only; Brand > Contacts is never opened). Shots + report: .screenshots/hkos-sheet-import-v1/. Run npm run build first.
// Usage: node scripts/verify/hkos-sheet-import-v1-stage3.mjs
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { ownerSession } from './lib/ownerSession.mjs';
import { realGet, keysOf } from './lib/realWiring.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const ExcelJS = require('exceljs');
const { measureScript, summarize, formatWorst } = require(ROOT + '/scripts/verify/lib/contrastMeasure.cjs');
const OUT = path.join(ROOT, '.screenshots', 'hkos-sheet-import-v1');
const PORT = 3991, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const HK = '981b790c-a3b0-4265-b32e-1f701d5731ff';
const HK_TABLES = ['hk_brands', 'hk_contacts', 'hk_touches', 'hk_replies', 'hk_sponsor_periods', 'hk_settings', 'hk_events', 'hk_duplicate_decisions', 'hk_import_runs', 'hk_ignored_senders', 'hk_member_prefs', 'business_members'];
const HL_TABLES = ['accounts', 'lists', 'projects', 'sales_goals', 'sales_opportunities', 'sales_targets', 'sales_people', 'sales_source_events', 'sales_partner_events', 'partner_contacts', 'sales_week_goals'];
const PREFIX = 'Zz Verify ';
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const { listImportsRoute } = await import('../../api/hk/importRoutes.js');
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const count = async (t, biz) => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', biz); if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message || `no count (HTTP ${r.status})`}`); return r.count; };
const snapshot = async () => { const o = { humankind: {}, homelover: {} }; for (const t of HK_TABLES) o.humankind[t] = await count(t, HK); for (const t of HL_TABLES) o.homelover[t] = await count(t, HOMELOVER); return o; };

// The invented workbook: 12 rows across six tab shapes, 10 distinct brands; one brand on both founders' tabs, one sponsor
// on Launch + June. Addresses are invented and never leave the server (preview shows presence only).
async function inventedTracker() {
  const wb = new ExcelJS.Workbook();
  const sheet = (name, headers, rows) => { const ws = wb.addWorksheet(name); ws.addRow(headers); for (const r of rows) ws.addRow(r); };
  const SPONSOR = ['Name', 'Status', 'Type', 'Contact', 'Challenge Sponsor?', 'Challenge Name', 'Reward/Raffle tied to Challenge?', 'Challange Schedule', 'Raffle Item', 'Reward', 'Agreement?', 'Redemption Method', 'Discount Code', 'Percentage Off'];
  sheet('Pete Outreach', ['Name', 'Type', 'Contact', 'Outreach Date', 'Jack Outreach', 'Status', 'Notes', 'Challenge/Reward Ideas'], [
    [`${PREFIX}Juice`, 'National CPG', 'ana@zz-verify-juice.invalid', '9/1/2026, 9/8/26', '', 'Email sent 9/1', 'Loves the idea', 'Juice week'],
    [`${PREFIX}Yoga`, '', 'Pete Yogi <pete@zz-verify-yoga.invalid>', '', '10/1', 'IG DM ready', '', ''],
    [`${PREFIX}Cafe`, '', '', '', '', 'In', 'Ask for the manager', ''],
    [`${PREFIX}Gym`, '', '', '', '', 'Email drafted 10/3', '', 'Step streak'],
  ]);
  sheet('Jack Outreach', ['Name', 'Website', 'Contact', 'Email', 'Outreach Date', 'Status', 'Enrichment Notes', 'Type', 'Notes', 'Challenge/Reward Ideas'], [
    [`${PREFIX}Mills`, 'https://www.zz-verify-mills.invalid/about', 'Lee Mills', 'lee@zz-verify-mills.invalid', '10/10', 'sent', 'Family-run mill', 'Partnership Inquiry on website', '', 'Flour challenge'],
    [`${PREFIX}Yoga`, 'zz-verify-yoga.invalid', '', '', '', '', '', 'Sponsored Reward/Raffle', '', ''],
  ]);
  sheet('Confirmed Launch Sponsors', ['Name', 'Type', 'Contact', 'Challenge Sponsor?', 'Challenge Name', 'Challange Schedule', 'Raffle Item', 'Reward', 'Agreement?', 'Redemption Method', 'Discount Code', 'Percentage Off'], [
    [`${PREFIX}Kayak`, 'Raffle|Challenge', '', 'Yes', 'Paddle Week', '', 'Two rentals', '', 'Yes', '', '', ''],
    [`${PREFIX}Bakery`, 'Reward|Challenge', 'hello@zz-verify-bakery.invalid', 'Yes', 'Bread Week', 'June', '', '20% off a loaf', 'Yes', 'Code at checkout', 'HK20', '20%'],
  ]);
  sheet('June Confirmed Sponsors', SPONSOR, [[`${PREFIX}Bakery`, 'Done', 'Reward|Challenge', '', 'Yes', 'Bread Week June'], [`${PREFIX}Coffee`, 'Need to set up', 'Reward', 'owner@zz-verify-coffee.invalid', '', 'Latte Ladder']]);
  sheet('Non-Profits', ['Name', 'Summary', 'Contact', 'Outreach Date', 'Status', 'Notes', 'Challenge/Reward Ideas'], [[`${PREFIX}Trust`, 'Beach cleanups', 'info@zz-verify-trust.invalid', '', '', '', '']]);
  sheet('Podcasts', ['Name', 'Contacts', 'Outreach Date', 'Status', 'Lane', 'Pitch Angle', 'Host Email Source', 'Notes'], [[`${PREFIX}Hour`, 'host@zz-verify-hour.invalid', '', 'Email sent 10/6', 'Founder', 'Origin story', 'LinkedIn', 'Weekly show']]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const EXPECT = { rows: 12, brands: 10, periods: 4 };

const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }

let srv, browser, owner;
const blocked = [], realCalls = [], writes = [];
const results = { checks: [], errors: [], screens: {}, deleted: null };
let runId = null;
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${detail}` : ''); };
const zzBrands = async () => { const r = await svc.from('hk_brands').select('id, name, source, status, relationship, owner_user_id, owner_hint, import_ref').eq('business_id', HK).like('name', `${PREFIX}%`); if (r.error) throw new Error(r.error.message); return r.data || []; };
// Leftovers only if the undo never ran: delete by the run's undo set, then the run row + its import.* events by id.
async function removeCreated() {
  const out = { brands: 0, contacts: 0, touches: 0, periods: 0, brand_events: 0, import_events: 0, runs: 0 };
  if (!runId) { results.deleted = out; return; }
  const { data: run } = await svc.from('hk_import_runs').select('id, status, undo_set').eq('id', runId).maybeSingle();
  if (run?.status === 'committed' && run.undo_set) {
    for (const [table, key] of [['hk_touches', 'touches'], ['hk_contacts', 'contacts'], ['hk_sponsor_periods', 'periods'], ['hk_events', 'brand_events'], ['hk_brands', 'brands']]) {
      const ids = run.undo_set[key === 'brand_events' ? 'events' : key] || [];
      if (ids.length) { const r = await svc.from(table).delete().eq('business_id', HK).in('id', ids).select('id'); out[key] = r.data?.length ?? -1; if (r.error) console.log('cleanup error:', r.error.message); }
    }
  }
  const e = await svc.from('hk_events').delete().eq('business_id', HK).eq('entity_type', 'import').eq('entity_id', runId).select('id'); out.import_events = e.data?.length ?? -1;
  const r = await svc.from('hk_import_runs').delete().eq('business_id', HK).eq('id', runId).select('id'); out.runs = r.data?.length ?? -1;
  results.deleted = out;
  log('removed the verify run and anything it left:', JSON.stringify(out), 'run', runId);
}
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  await removeCreated();
  if (owner) { log(await owner.release()); owner = null; }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 300000 });
fs.mkdirSync(OUT, { recursive: true });
const pre = await zzBrands();
if (pre.length) { console.log('ABORT: leftover verify brands exist - remove them first:', pre.map(b => b.id).join(', ')); process.exit(1); }
const before = await snapshot();
log('before', JSON.stringify(before.humankind), 'HomeLover accounts', before.homelover.accounts);
const MEASURE = measureScript({ scope: '[data-hk-shell]' });
const XLSX = await inventedTracker();

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const auth = { user: { id: owner.userId, name: 'Jack' }, isPlatformOwner: true, roles: new Map([[HK, 'owner']]) };
  const lRes = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await listImportsRoute({ method: 'GET', params: { businessId: HK }, query: {}, body: {}, auth }, lRes, { supabase: svc });
  const lReal = await realGet({ base: BASE, businessId: HK, session: owner.session, path: '/imports' });
  ok(`real wiring: GET /imports through the spawned server.js -> ${lReal.code}, ${lReal.body?.runs?.length} runs, same keys as the in-process call, no address`, lReal.code === 200 && lRes.code === 200 && keysOf(lReal.body) === keysOf(lRes.body) && lReal.body.runs.length === lRes.body.runs.length && !JSON.stringify(lReal.body).includes('@'), lReal.code === 200 ? '' : JSON.stringify(lReal.body).slice(0, 160));
  const runsBefore = lReal.body?.runs?.length || 0;
  browser = await chromium.launch();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  async function open(viewport) {
    const ctx = await browser.newContext({ viewport });
    await ctx.addInitScript(([k, v, b, d]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      for (const n of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${n}_ran_${b}`, d);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HOMELOVER, today]);
    const BLOCK = /\/proxy\/(anthropic|gmail|gcal)|\/api\/(gmail|google|microsoft)\b|\/api\/sales\/[^/]+\/(sync|apollo)|\/apollo-check|\/visits\/pull|\/tidy\/run|\/research/;
    const hkWrite = new RegExp(`^/api/hk/${HK}/imports/(preview|[0-9a-f-]{36}/(commit|undo))$`);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (/anthropic\.com$|apollo\.io$|gmail\.googleapis\.com$/.test(u.host) || (u.host === 'www.googleapis.com' && u.pathname.startsWith('/gmail'))) realCalls.push(`${req.method()} ${u.host}${u.pathname}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      const allowedWrite = isLocal && req.method() === 'POST' && hkWrite.test(u.pathname);
      if (allowedWrite) writes.push(`${req.method()} ${u.pathname.replace(/\/imports\/[0-9a-f-]{36}\//, '/imports/<id>/')}`);
      const deny = (isLocal && (BLOCK.test(u.pathname) || (req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname) && !allowedWrite)))
        || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/'))
        || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.host}${u.pathname}`); return route.abort(); }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 140)));
    page.on('response', async r => {
      const u = new URL(r.url()); if (u.host !== `localhost:${PORT}` || r.request().method() !== 'POST' || !/\/imports\/preview$/.test(u.pathname) || r.status() !== 201) return;
      try { const body = await r.json(); if (body.run?.id) runId = body.run.id; } catch {}
    });
    await page.goto(`${BASE}/`);
    if (viewport.width < 900) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 20000 });
    await page.getByLabel('Workspace').selectOption({ label: 'HumanKind' });
    await page.locator('[data-hk-shell] [data-hk-avatar]').waitFor({ timeout: 20000 }); await page.waitForTimeout(500);
    return { ctx, page, errors };
  }
  const SHELL_CHROME = /hk-nav__item|aria-label="Your account"|hk-pill|hk-search\b|ui-seg__btn|ui-tab\b|hk-link|hk-table__name|ui-btn--tertiary|hk-menu__item|hk-subnav__item/;
  const measure = async (page, key) => {
    const m = await page.evaluate(MEASURE); if (m.error) { results.errors.push(`${key}: ${m.error}`); return null; }
    const s = summarize(m);
    const hard = m.controls.filter(c => c.ratio < 3 && !c.textOnly && !SHELL_CHROME.test(c.sel || ''));
    results.screens[key] = { ...s, hardControlFails: hard.length, hard: hard.slice(0, 6).map(c => `${c.ratio} ${c.sel} "${String(c.text || '').slice(0, 30)}"`), scrollW: m.scrollW, vw: m.vw };
    log(key, `text ${s.textFails}/${s.texts}`, `controls ${s.controlFails}/${s.controls} (text-only or shell chrome ${s.controlFails - hard.length}, must-fix ${hard.length})`);
    if (s.textFails || hard.length) log(formatWorst(key, { ...s, worst: [...s.worstText, ...hard.slice(0, 6)] }));
    return s;
  };
  const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide' });
  const shellText = page => page.evaluate(() => document.querySelector('[data-hk-shell]').innerText);
  const FILE = { name: 'Zz Verify Tracker.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX };

  // ---- 1440: + New > Import list opens Review > Imports with the file chooser; preview; commit; Brands / Sponsors; undo
  const D = await open({ width: 1440, height: 900 });
  await D.page.locator('[data-hk-new]').click(); await D.page.locator('[data-hk-new-menu]').waitFor();
  const items = await D.page.locator('[data-hk-new-menu] [role=menuitem]').allInnerTexts();
  const logTouchDisabled = await D.page.locator('[data-hk-new-item="log_touch"]').isDisabled();
  ok('1 top bar "+ New" lists Add brand, Add contact, Import list, Log outside touch (disabled); no Paste notes', items.join('|') === 'Add brand|Add contact|Import list|Log outside touch' && logTouchDisabled, items.join('|'));
  const chooser = D.page.waitForEvent('filechooser', { timeout: 8000 });
  await D.page.locator('[data-hk-new-item="import"]').click();
  const fc = await chooser;
  ok('2 Import list -> Review opens on the Imports tab and the file chooser opens (.xlsx/.csv)', (await D.page.locator('[data-hk-imports]').count()) === 1 && (await D.page.getByRole('tab', { name: /^Imports/ }).getAttribute('aria-selected')) === 'true' && !fc.isMultiple());
  await fc.setFiles(FILE);
  await D.page.locator('[data-hk-import-preview]').waitFor({ timeout: 20000 }); await D.page.waitForTimeout(600);
  for (let i = 0; i < 20 && !runId; i++) await new Promise(r => setTimeout(r, 100));
  let text = await shellText(D.page);
  const totals = await D.page.locator('[data-hk-import-totals]').innerText();
  const tabCards = await D.page.locator('[data-hk-import-tab]').count();
  ok(`3 preview: "${totals.split('.')[0]}", ${tabCards} tab cards, ${EXPECT.brands} rows in the table, contact presence only (no "@" anywhere in the shell)`, totals.startsWith(`${EXPECT.rows} rows read as ${EXPECT.brands} brands: ${EXPECT.brands} to create`) && tabCards === 6 && (await D.page.locator('[data-hk-import-preview] tbody tr[data-row]').count()) === EXPECT.brands && /has email/.test(text) && !text.includes('@') && !!runId, text.includes('@') ? 'ADDRESS LEAKED' : `rows ${await D.page.locator('[data-hk-import-preview] tbody tr[data-row]').count()}, run ${runId ? 'captured' : 'MISSING'}`);
  const warnTab = await D.page.getByRole('tab', { name: /^Warning \(/ }).innerText();
  await D.page.getByRole('tab', { name: /^Warning \(/ }).click(); await D.page.waitForTimeout(300);
  const warnRows = await D.page.locator('[data-hk-import-preview] tbody tr[data-row]').count();
  ok(`4 filters: "${warnTab}" shows ${warnRows} rows (draft not linked, unmapped status, two founders)`, warnRows > 0 && warnRows < EXPECT.brands && warnTab === `Warning (${warnRows})` && /Draft not linked to Gmail/.test(text) && /Unmapped status/.test(text) && /Two founders/.test(text));
  await D.page.getByRole('tab', { name: /^All \(/ }).click(); await D.page.waitForTimeout(300);
  await measure(D.page, 'imports-preview@1440'); await shot(D.page, 'imports-preview-1440');
  const dbRun1 = await svc.from('hk_import_runs').select('status, plan').eq('id', runId).single();
  ok('5 the run row reads preview and holds the plan server-side; nothing else written yet', dbRun1.data?.status === 'preview' && !!dbRun1.data?.plan && (await zzBrands()).length === 0);
  await D.page.locator('[data-hk-commit-import]').click();
  await D.page.locator('[data-hk-import-toast]').waitFor({ timeout: 20000 }); await D.page.waitForTimeout(600);
  const toast = await D.page.locator('[data-hk-import-toast]').innerText();
  const made = await zzBrands();
  const dbRun2 = await svc.from('hk_import_runs').select('status, plan, undo_set, summary').eq('id', runId).single();
  const madeIds = made.map(b => b.id);
  const COLS = { hk_contacts: 'id, brand_id, is_primary', hk_touches: 'id, brand_id, sender_user_id, kind, state', hk_sponsor_periods: 'id, brand_id, period', hk_events: 'id, entity_id, action' };
  const [contacts, touches, periods, events] = await Promise.all(Object.entries(COLS).map(async ([t, cols]) => { const r = await svc.from(t).select(cols).eq('business_id', HK).in(t === 'hk_events' ? 'entity_id' : 'brand_id', madeIds); if (r.error) throw new Error(r.error.message); return r.data; }));
  const mills = made.find(b => b.name === `${PREFIX}Mills`), bakery = made.find(b => b.name === `${PREFIX}Bakery`), juice = made.find(b => b.name === `${PREFIX}Juice`);
  ok(`6 Commit -> toast "${toast.split('.')[0]}"; DB: ${made.length} brands (source import), ${contacts.length} contacts, ${touches.length} touches, ${periods.length} periods, ${events.length} brand.created events; run committed, plan wiped, undo_set recorded`, /^Imported 10 brands/.test(toast) && made.length === EXPECT.brands && made.every(b => b.source === 'import' && b.import_ref) && periods.length === EXPECT.periods && events.length === EXPECT.brands && events.every(e => e.action === 'brand.created') && dbRun2.data?.status === 'committed' && dbRun2.data.plan === null && dbRun2.data.undo_set?.brands?.length === EXPECT.brands && contacts.length >= 6 && contacts.filter(c => c.is_primary).length >= 5);
  ok(`7 rows: Mills owned by Jack with one sent cold touch (sender Jack); Juice owner_hint pete, no owner, no touch yet (deferred ${dbRun2.data?.summary?.counts?.touches_deferred}); Bakery is a founding partner with Launch + 2026-06`, mills?.owner_user_id === owner.userId && touches.filter(t => t.brand_id === mills?.id).map(t => `${t.kind}/${t.state}/${t.sender_user_id === owner.userId}`).join() === 'cold/sent/true' && juice?.owner_hint === 'pete' && juice?.owner_user_id === null && !touches.some(t => t.brand_id === juice?.id) && bakery?.relationship === 'founding_partner' && periods.filter(p => p.brand_id === bakery?.id).map(p => p.period).sort().join() === '2026-06,launch' && !JSON.stringify(dbRun2.data?.summary).includes('@'));
  await D.page.locator('[data-hk-import-toast]').getByRole('button', { name: 'Open Brands' }).click(); await D.page.locator('[data-hk-brands]').waitFor();
  // The owner toggle starts on Me (Jack owns 1 of the 10); All is the user path. Its prefs PATCH is aborted by the guard.
  await D.page.locator('.hk-nav').getByRole('button', { name: 'All', exact: true }).click(); await D.page.waitForTimeout(300);
  await D.page.getByLabel('Search brands').fill('zz verify'); await D.page.waitForTimeout(900);
  text = await shellText(D.page);
  ok(`8 Brands (owner All): search "zz verify" lists the ${EXPECT.brands} imported brands with the Import chip; no address`, (await D.page.locator('[data-hk-brand]').count()) === EXPECT.brands && (text.match(/\bImport\b/g) || []).length >= EXPECT.brands && !text.includes('@'), `${await D.page.locator('[data-hk-brand]').count()} rows, ${(text.match(/\bImport\b/g) || []).length} Import chips`);
  await measure(D.page, 'brands@1440'); await shot(D.page, 'brands-1440');
  await D.page.locator('[data-hk-nav="sponsors"]').click(); await D.page.locator('[data-hk-sponsors]').waitFor(); await D.page.waitForTimeout(600);
  const bakeryRow = D.page.locator(`[data-hk-sponsor="${bakery?.id}"]`);
  const bakeryText = (await bakeryRow.count()) ? await bakeryRow.innerText() : '';
  ok('9 Sponsors: Zz Verify Bakery shows Founding partner, Import, period chips Launch and Jun 26', /Founding partner/.test(bakeryText) && /Import/.test(bakeryText) && /Launch/.test(bakeryText) && /Jun 26/.test(bakeryText) && (await D.page.locator('[data-hk-sponsor]').count()) >= 3, bakeryText.replace(/\s+/g, ' ').slice(0, 120));
  await D.page.locator('[data-hk-nav="review"]').click(); await D.page.getByRole('tab', { name: /^Imports/ }).click(); await D.page.locator('[data-hk-imports]').waitFor(); await D.page.waitForTimeout(600);
  const runRow = D.page.locator('[data-hk-import-run="committed"]').first();
  const runText = await runRow.innerText();
  ok(`10 Review > Imports history: the run reads Committed, "${(runText.match(/\d+ rows read[^·]*·[^·]*·[^·]*·[^b]*/) || [''])[0].trim()}", by Jack, with Undo`, /Committed/.test(runText) && new RegExp(`${EXPECT.rows} rows read · ${EXPECT.brands} created · 0 matched`).test(runText) && /by Jack/.test(runText) && (await runRow.locator('[data-hk-undo-import]').count()) === 1 && (await D.page.getByRole('tab', { name: /^Imports \(/ }).count()) === 1);
  await measure(D.page, 'imports-history@1440'); await shot(D.page, 'imports-history-1440');
  await runRow.locator('[data-hk-undo-import]').click(); await D.page.locator('[data-hk-undo-confirm]').waitFor();
  await D.page.getByRole('button', { name: 'Undo import' }).click();
  await D.page.locator('[data-hk-import-toast]').waitFor({ timeout: 20000 }); await D.page.waitForTimeout(600);
  const undoToast = await D.page.locator('[data-hk-import-toast]').innerText();
  const left = await zzBrands();
  const dbRun3 = await svc.from('hk_import_runs').select('status, undone_at').eq('id', runId).single();
  const leftovers = await Promise.all(['hk_contacts', 'hk_touches', 'hk_sponsor_periods'].map(async t => (await svc.from(t).select('id', { count: 'exact', head: true }).in('brand_id', madeIds)).count));
  const leftEvents = (await svc.from('hk_events').select('id', { count: 'exact', head: true }).eq('business_id', HK).in('entity_id', madeIds)).count;
  ok(`11 Undo -> "${undoToast}"; DB: 0 Zz Verify brands, 0 contacts / touches / periods / brand events left, run reads undone`, /^Undone: 10 brands/.test(undoToast) && left.length === 0 && leftovers.every(n => n === 0) && leftEvents === 0 && dbRun3.data?.status === 'undone' && !!dbRun3.data?.undone_at && (await D.page.locator('[data-hk-import-run="undone"]').count()) === 1);
  ok('No page errors (1440)', !D.errors.length, JSON.stringify(D.errors.slice(0, 3)));
  await D.ctx.close();

  // ---- 390: + New is an icon button; Review > Imports history renders without sideways scroll
  const P = await open({ width: 390, height: 844 });
  ok('12 390: "+ New" sits in the phone top bar', (await P.page.locator('.hk-phone-top [data-hk-new]').count()) === 1);
  await P.page.locator('[data-hk-tab="more"]').click(); await P.page.locator('[data-hk-more]').waitFor();
  await P.page.locator('[data-hk-more]').getByRole('button', { name: 'Review' }).click(); await P.page.locator('[data-hk-review]').waitFor();
  await P.page.getByRole('tab', { name: /^Imports/ }).click(); await P.page.locator('[data-hk-imports]').waitFor(); await P.page.waitForTimeout(800);
  ok('13 390: Review > Imports lists the undone run as a wrapped row without sideways scroll', (await P.page.locator('[data-hk-import-run="undone"]').count()) === 1 && (await P.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)));
  await measure(P.page, 'imports-history@390'); await shot(P.page, 'imports-history-390');
  ok('No page errors (390)', !P.errors.length, JSON.stringify(P.errors.slice(0, 3)));
  await P.ctx.close();

  const fails = Object.entries(results.screens).filter(([, s]) => s.textFails || s.hardControlFails);
  ok(`contrast on ${Object.keys(results.screens).length} screens: 0 text failures, 0 must-fix control boundaries`, Object.keys(results.screens).length === 4 && !fails.length, JSON.stringify(fails.map(([k, s]) => [k, s.textFails, s.hard])));
  ok(`real-call guard: 0 requests to Anthropic / Apollo / Gmail hosts; allowed writes exactly preview, commit, undo (${writes.join(', ')}); ${blocked.length} other non-GET / outside requests aborted`, !realCalls.length && writes.join() === `POST /api/hk/${HK}/imports/preview,POST /api/hk/${HK}/imports/<id>/commit,POST /api/hk/${HK}/imports/<id>/undo`);
  void runsBefore;
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    const after = await snapshot();
    const d = results.deleted || {};
    restored = JSON.stringify(before) === JSON.stringify(after) && d.runs === 1 && d.import_events >= 1;
    line = restored ? `yes (HumanKind hk_* + HomeLover counts identical; ${d.brands === 0 ? 'the undo removed the import\'s rows itself' : `the teardown removed the import's rows by its undo set (brands ${d.brands})`}; the script then deleted its run row (1) and the import.* events (${d.import_events}) by id; Jack sign-in rows kept by rule)` : `NO - before ${JSON.stringify(before)} after ${JSON.stringify(after)} deleted ${JSON.stringify(d)} run ${runId}`;
  } catch (e) { line = `NO (check failed: ${e.message})`; }
  const pass = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'hkos-sheet-import-v1-stage3.json'), JSON.stringify({ ...results, runId, restored }, null, 2));
  console.log(`\n${pass}/${results.checks.length} checks passed${results.errors.length ? ` · ${results.errors.length} errors` : ''} · Claude 0 · Apollo 0 · Gmail 0`);
  for (const e of results.errors) console.log('ERROR:', e.split('\n').slice(0, 3).join(' | '));
  console.log(`restored: ${line}`);
  process.exit(restored ? 0 : 1);
}
