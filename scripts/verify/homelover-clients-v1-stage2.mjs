// homelover-clients-v1 Stage 2 live check - localhost against the build, as Jack (ownerSession) on the REAL HomeLover
// workspace. Jack's explicit ask (spec Stage 2): these writes are KEPT, not restored -
//   1. Momentum's Source -> Partner referral · HUB International (the Source editor; 1 sales_source_events row)
//   2. Make client on Momentum: verbal_yes, 390 now, +250 "acquisition, expected April 2027", signing 2026-11-20, launch
//      2027-01-01 (1 sales_client_events row, 1 "Send agreement" to-do; Momentum has 0 campaign contacts / 0 Apollo
//      prospects linked, so nothing is stopped and no warning)
//   3. one generated ~1 KB test PDF uploaded to Momentum's Files, opened (signed url), archived (row + object kept;
//      +1 sales_client_files, +2 sales_client_events)
// Then reads: HUB's Network card "1 client · 390 lives", Pipeline › Clients row "Referred by HUB International",
// Sources › Network HUB -> Momentum; contrast + axe on each surface at 1440, the windows at 390, a Viewer pass (0 client
// buttons). Every other non-GET is aborted; 0 Claude / 0 Apollo. ~3 min, cap 300 s. "restored" THROWS if any watched count
// moved by anything other than the deltas above.
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
const OUT = path.join(ROOT, '.screenshots', 'homelover-clients-v1-stage2');
const PORT = 3996, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
// Resumable: a step already done on an earlier run is skipped, and its delta isn't expected again.
const DELTA = { sales_source_events: 0, sales_client_events: 0, sales_week_goals: 0, sales_client_files: 0 };
const TABLES = ['sales_opportunities', 'sales_opportunity_events', 'sales_goals', 'sales_targets', 'sales_people', 'sales_outreach_contacts', 'sales_outreach_events', 'business_anthropic_usage', ...Object.keys(DELTA)];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data?.[0]?.id;
if (!HL) throw new Error('no HomeLover business');
const count = async t => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL); if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message}`); return r.count; };
const snapshot = async () => { const o = {}; for (const t of TABLES) o[t] = await count(t); return o; };
const MOM = (await svc.from('sales_opportunities').select('*').eq('business_id', HL).ilike('organization', 'momentum%').is('archived_at', null)).data;
const HUB = (await svc.from('sales_goals').select('id, name').eq('business_id', HL).eq('name', 'HUB International')).data;
if (MOM?.length !== 1 || HUB?.length !== 1) throw new Error(`expected one Momentum + one HUB (got ${MOM?.length} / ${HUB?.length})`);
const mom = MOM[0], hub = HUB[0];
const TEST_TITLE = 'homelover-clients-v1 test';
const done = { source: mom.source_kind === 'partner_referral' && mom.source_partner_id === hub.id, client: !!mom.client_status,
  file: !!(await svc.from('sales_client_files').select('id').eq('business_id', HL).eq('opportunity_id', mom.id).eq('title', TEST_TITLE)).data?.length };
if (!done.source) DELTA.sales_source_events = 1;
if (!done.client) { DELTA.sales_client_events += 1; DELTA.sales_week_goals = 1; }
// First run: upload -> open -> archive (+1 file, +2 events). A re-run reuses the newest archived test PDF: un-archived
// here, then opened and archived again through the UI (+1 file_archived event, no new file).
const reuse = done.file ? (await svc.from('sales_client_files').select('id, title').eq('business_id', HL).eq('opportunity_id', mom.id).like('title', `${TEST_TITLE}%`).order('uploaded_at', { ascending: false }).limit(1)).data[0] : null;
if (reuse) DELTA.sales_client_events += 1; else { DELTA.sales_client_events += 2; DELTA.sales_client_files = 1; }
const FILE_TITLE = reuse ? reuse.title : TEST_TITLE;
console.log('already done on an earlier run:', JSON.stringify(done));
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const nowT = new Date();
const minsToSix = ((6 - (nowT.getHours() % 6)) % 6) * 60 - nowT.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (nowT.getHours() % 6 === 0 && nowT.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
let srv, browser, owner;
const blocked = [], realCalls = [], writes = [];
const results = { checks: [], axe: {}, contrast: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  if (owner) { log(await owner.release()); owner = null; }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 300000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));
// A minimal valid one-page PDF (no text content, nothing personal).
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  const ALLOW = new RegExp(`^/api/sales/${HL}/goals/(source/employer/${mom.id}|clients|clients/${mom.id}/files(/upload-url)?|client-files/[0-9a-f-]{36}/archive)$`);
  async function open(width, { viewer = false, openKey = null, view = 'companies', tab = 'pipeline' }) {
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
      const storagePut = isSupa && req.method() === 'PUT' && u.pathname.startsWith(`/storage/v1/object/upload/sign/client-files/${HL}/${mom.id}/`);
      if (apiWrite || storagePut) writes.push(`${req.method()} ${u.pathname.replace(HL, '<HL>').replace(mom.id, '<momentum>').replace(/[0-9a-f-]{36}/g, '<id>')}`);
      const deny = (apiWrite && !(['POST', 'PATCH'].includes(req.method()) && ALLOW.test(u.pathname))) || (isSupa && req.method() !== 'GET' && !storagePut && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
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
    await page.goto(`${BASE}/?tab=${tab}&view=${view}${openKey ? `&open=${openKey}` : ''}`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 20000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    const tabLabel = tab === 'pipeline' ? /^Pipeline/ : /^Dashboard/;
    await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: tabLabel }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
    const sub = { companies: 'Companies', clients: 'Clients', sources: 'Sources' }[view];
    await page.locator('[data-sales-subviews]').getByRole('tab', { name: sub, exact: true }).dispatchEvent('click'); await page.waitForTimeout(1800);
    return { ctx, page, errors };
  }
  const shot = (page, nme) => page.screenshot({ path: `${OUT}/${nme}.png`, animations: 'disabled', caret: 'hide', fullPage: false });
  const win = page => page.locator('[data-center-window]');
  const measure = async (page, key, scope) => {
    const m = await page.evaluate(measureScript({ scope }));
    if (m.error) { ok(`contrast ${key}`, false, m.error); return; }
    const s = summarize(m); results.contrast[key] = s;
    ok(`contrast ${key}: 0 text < 4.5:1, 0 controls < 3:1 (text ${s.textFails}/${s.texts}, controls ${s.controlFails}/${s.controls})`, s.textFails === 0 && s.controlFails === 0, s.worst.slice(0, 4).map(w => `${w.ratio} ${w.text || w.label || ''}`).join(' | '));
  };
  const axeOn = async (page, key, sel) => {
    await page.addScriptTag({ content: AXE });
    const vs = await page.evaluate(async s => { const r = await window.axe.run(document.querySelector(s), { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, html: x.nodes[0]?.html?.slice(0, 120) })); }, sel);
    results.axe[key] = vs;
    ok(`axe ${key}: ${vs.length} violations`, vs.length === 0, JSON.stringify(vs).slice(0, 400));
  };

  // ---- 1440, Momentum's window: Source -> HUB, Make client, Files upload / open / archive.
  if (reuse) await svc.from('sales_client_files').update({ archived_at: null, archived_by: null }).eq('id', reuse.id);
  {
    const { ctx, page, errors } = await open(1440, { openKey: `employer-${mom.id}` });
    const w = win(page);
    await w.locator('[data-section="client"]').waitFor({ timeout: 30000 }); await page.waitForTimeout(800);
    await shot(page, 'momentum-before-1440');
    if (!done.client) ok('1440 Momentum: Client card offers Make client', (await w.locator('[data-section="client"]').getByRole('button', { name: 'Make client' }).count()) === 1);
    await measure(page, 'Momentum window@1440 (Client card)', '[data-section="client"]');
    if (!done.source) {
    await w.locator('[data-fact="Source"]').click(); await page.waitForTimeout(500);
    const form = w.locator('[data-source-form]');
    await form.getByLabel('Kind').selectOption('partner_referral');
    await form.getByLabel('Partner').selectOption(hub.id);
    await form.getByRole('button', { name: 'Save source' }).click(); await page.waitForTimeout(2500);
    const src = (await svc.from('sales_opportunities').select('source_kind, source_partner_id, source_set_by').eq('id', mom.id).single()).data;
    ok(`Source editor: Momentum's source = ${src.source_kind} · ${src.source_partner_id === hub.id ? 'HUB International' : src.source_partner_id} (a person's pick)`, src.source_kind === 'partner_referral' && src.source_partner_id === hub.id && !!src.source_set_by);
    await page.waitForTimeout(11000); // the source toast's 10 s Undo runs out first, so the client toast is the only one
    }
    if (!done.client) {
    await w.locator('[data-section="client"]').getByRole('button', { name: 'Make client' }).click(); await page.waitForTimeout(800);
    const sheet = page.locator('[data-make-client]');
    const pre = { lives: await sheet.getByLabel('Eligible now').inputValue(), signing: await sheet.getByLabel('Expected signing').inputValue(), launch: await sheet.getByLabel('Launch date').inputValue(), source: await sheet.getByLabel('Source').inputValue(), partner: await sheet.getByLabel('Partner').inputValue() };
    ok(`Make client sheet prefilled: ${JSON.stringify({ ...pre, partner: pre.partner === hub.id ? 'HUB' : pre.partner })}`, pre.lives === '390' && pre.signing === '2026-11-20' && pre.launch === '2027-01-01' && pre.source === 'partner_referral' && pre.partner === hub.id);
    await measure(page, 'Make client sheet@1440', '[data-make-client]');
    await axeOn(page, 'Make client sheet@1440', 'aside');
    await shot(page, 'make-client-sheet-1440');
    await sheet.getByLabel('Eligible added').fill('250');
    await sheet.getByLabel('Added because').fill('acquisition, expected April 2027');
    await sheet.getByRole('button', { name: 'Make client' }).click();
    const toast = await page.getByText(/is a client · Verbal yes/).first().textContent({ timeout: 15000 }).catch(() => '');
    await page.waitForTimeout(1500);
    const m = (await svc.from('sales_opportunities').select('stage, client_status, client_since, eligible_now, eligible_added, eligible_added_note, expected_signing_date, expected_launch, covered_lives').eq('id', mom.id).single()).data;
    ok(`Make client: toast "${toast}"`, /Momentum.* is a client · Verbal yes · "Send agreement" added(Undo)?$/.test(toast.trim()));
    ok(`DB Momentum: ${JSON.stringify(m)}`, m.client_status === 'verbal_yes' && m.stage === 'verbal' && m.client_since === today && m.eligible_now === 390 && m.eligible_added === 250 && m.eligible_added_note === 'acquisition, expected April 2027' && m.expected_signing_date === '2026-11-20' && m.expected_launch === '2027-01-01');
    await page.waitForTimeout(11000);
    } else {
      await w.locator('[data-section="client"]').getByRole('button', { name: 'Edit' }).click(); await page.waitForTimeout(800);
      await measure(page, 'Make client sheet (Edit)@1440', '[data-make-client]');
      await axeOn(page, 'Make client sheet (Edit)@1440', 'aside');
      await shot(page, 'make-client-sheet-edit-1440');
      await page.locator('[data-make-client]').getByRole('button', { name: 'Cancel' }).click(); await page.waitForTimeout(500);
    }
    const card = await w.locator('[data-section="client"]').textContent();
    ok(`Client card: "${card.replace(/\s+/g, ' ').slice(0, 200)}"`, /Verbal yes/.test(card) && /390 \(\+250\) eligible/.test(card) && /Launch Jan 1, 2027/.test(card) && /Mark signed/.test(card));
    {
    if (!reuse) await w.locator('[data-section="files"] input[type=file]').setInputFiles({ name: `${FILE_TITLE}.pdf`, mimeType: 'application/pdf', buffer: PDF });
    await w.locator('[data-client-file]').first().waitFor({ timeout: 20000 }); await page.waitForTimeout(600);
    const f = (await svc.from('sales_client_files').select('id, kind, title, size_bytes, mime, storage_path, archived_at').eq('business_id', HL).eq('opportunity_id', mom.id).eq('title', FILE_TITLE)).data;
    ok(`${reuse ? 'Re-used' : 'Upload'}: ${f.length} file row (${f[0]?.kind}, "${f[0]?.title}", ${f[0]?.size_bytes} B, ${f[0]?.mime}), path under <HL>/<momentum>/`, f.length === 1 && f[0].size_bytes === PDF.length && f[0].mime === 'application/pdf' && f[0].storage_path.startsWith(`${HL}/${mom.id}/`));
    await shot(page, 'momentum-files-1440');
    // Headless Chromium has no PDF viewer: the new tab downloads the file, so the check is the signed url's response.
    const [resp] = await Promise.all([
      ctx.waitForEvent('response', { predicate: r => r.url().includes('/storage/v1/object/sign/client-files/'), timeout: 15000 }),
      w.locator('[data-client-file]').first().getByRole('button', { name: FILE_TITLE, exact: true }).click(),
    ]);
    const got = { status: resp.status(), type: resp.headers()['content-type'], bytes: Number(resp.headers()['content-length']) };
    ok(`Open: the click opens a tab on the 60 s signed url -> ${got.status} ${got.type}, ${got.bytes} B (the uploaded file)`, got.status === 200 && got.type === 'application/pdf' && got.bytes === PDF.length);
    for (const p of ctx.pages().slice(1)) await p.close();
    await page.waitForTimeout(11000);
    await w.locator('[data-client-file]').first().getByRole('button', { name: 'Archive' }).click(); await page.waitForTimeout(2000);
    const fa = (await svc.from('sales_client_files').select('archived_at').eq('id', f[0].id).single()).data;
    const obj = await svc.storage.from('client-files').list(`${HL}/${mom.id}`, { search: f[0].id });
    ok(`Archive: row kept, archived_at set; object kept (${obj.data?.length})`, !!fa.archived_at && obj.data?.length === 1);
    }
    await axeOn(page, 'Momentum window@1440', '[data-center-window]');
    ok('1440 Momentum 0 page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- 1440, HUB's window: the Network card.
  {
    const { ctx, page, errors } = await open(1440, { openKey: `partner-${hub.id}` });
    const w = win(page);
    await w.locator('[data-network-header]').waitFor({ timeout: 30000 }); await page.waitForTimeout(800);
    const header = (await w.locator('[data-network-header]').textContent()).trim();
    const clients = await w.locator('[data-network-group="clients"]').textContent();
    const came = await w.locator('[data-came-from]').textContent();
    await w.locator('[data-section="network"]').scrollIntoViewIfNeeded();
    await shot(page, 'hub-network-1440');
    ok(`HUB Network header "${header}"`, header.startsWith('1 client · 390 lives'));
    ok(`HUB Network Clients: "${clients.replace(/\s+/g, ' ')}"`, /Momentum/.test(clients) && /Verbal yes/.test(clients) && /390/.test(clients));
    ok(`HUB Came from: "${came.replace(/\s+/g, ' ')}"`, /partner not set/.test(came) && /Set it/.test(came));
    await measure(page, 'HUB Network card@1440', '[data-section="network"]');
    await axeOn(page, 'HUB window@1440', '[data-center-window]');
    ok('1440 HUB 0 page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- Pipeline › Clients + Dashboard › Sources › Network.
  {
    const { ctx, page, errors } = await open(1440, { view: 'clients' });
    await page.locator('[data-clients-view]').waitFor({ timeout: 30000 }); await page.waitForTimeout(600);
    const row = await page.locator(`[data-client-row="${mom.id}"]`).textContent();
    const totals = await page.locator('[data-clients-totals]').textContent();
    await shot(page, 'clients-1440');
    ok(`Clients row: "${row.replace(/\s+/g, ' ')}"; totals "${totals}"`, /Verbal yes/.test(row) && /390 \(\+250\)/.test(row) && /HUB International/.test(row) && /Jan 1, 2027/.test(row));
    await measure(page, 'Clients view@1440', '[data-clients-view]');
    await axeOn(page, 'Clients view@1440', '[data-clients-view]');
    ok('Clients 0 page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await open(1440, { tab: 'dashboard', view: 'sources' });
    await page.getByRole('button', { name: 'Network', exact: true }).click();
    await page.locator('[data-network-tree] [data-network-node]').first().waitFor({ timeout: 30000 }); await page.waitForTimeout(600);
    const hubNode = await page.locator(`[data-network-node="partner:${hub.id}"]`).first().textContent();
    const momUnderHub = await page.locator(`[data-network-node="partner:${hub.id}"] [data-network-node="employer:${mom.id}"]`).count();
    await shot(page, 'sources-network-1440');
    ok(`Sources › Network: HUB node "${hubNode.replace(/\s+/g, ' ').slice(0, 160)}"; Momentum under HUB ${momUnderHub}`, momUnderHub === 1 && /1 client · 390 lives/.test(hubNode));
    await measure(page, 'Sources Network@1440', '[data-network-tree]');
    await axeOn(page, 'Sources Network@1440', '[data-network-tree]');
    ok('Sources 0 page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- 390: Momentum's window + HUB's Network card - nothing scrolls sideways.
  for (const [key, openKey, sel] of [['Momentum', `employer-${mom.id}`, '[data-section="client"]'], ['HUB', `partner-${hub.id}`, '[data-section="network"]']]) {
    const { ctx, page, errors } = await open(390, { openKey });
    await win(page).locator(sel).waitFor({ timeout: 30000 }); await page.waitForTimeout(800);
    await win(page).locator(sel).scrollIntoViewIfNeeded();
    const side = await page.evaluate(s => { const el = document.querySelector(s); const b = document.querySelector('[data-window-body]'); return { card: el.scrollWidth - el.clientWidth, body: b.scrollWidth - b.clientWidth, page: document.documentElement.scrollWidth - window.innerWidth }; }, sel);
    await shot(page, `${key.toLowerCase()}-390`);
    ok(`390 ${key}: sideways card ${side.card} / body ${side.body} / page ${side.page} px; 0 page errors`, side.card <= 0 && side.body <= 0 && side.page <= 0 && !errors.length, errors.join(' | '));
    await measure(page, `${key}@390`, sel);
    await axeOn(page, `${key} window@390`, '[data-center-window]');
    await ctx.close();
  }
  // ---- Viewer (intercepted /api/me): Momentum's client card + files read, no buttons; HUB's Network no Set it / Add.
  {
    const { ctx, page, errors } = await open(1440, { viewer: true, openKey: `employer-${mom.id}` });
    const w = win(page);
    await w.locator('[data-section="client"]').waitFor({ timeout: 30000 }); await page.waitForTimeout(800);
    const btns = await w.locator('[data-section="client"] button, [data-section="files"] button').count();
    const fileRows = await w.locator('[data-client-file]').count();
    ok(`Viewer: Client card reads (${/Verbal yes/.test(await w.locator('[data-section="client"]').textContent())}), ${btns} buttons on Client + Files, ${fileRows} live files (the test PDF is archived)`, btns === 0 && fileRows === 0);
    ok('Viewer 0 page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
  ok(`0 Claude / 0 Apollo calls (${realCalls.length}); writes = ${[...new Set(writes)].join(', ')}`, realCalls.length === 0);
  ok(`blocked non-allowed requests: ${blocked.length}`, true, [...new Set(blocked)].slice(0, 6).join(' | '));
} catch (e) {
  ok('run', false, e.stack || e.message);
} finally {
  await cleanup();
}
const after = await snapshot();
const moved = Object.keys(before).filter(t => after[t] - before[t] !== (DELTA[t] || 0));
log('after', JSON.stringify(after));
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ ...results, before, after }, null, 2));
const pass = results.checks.filter(c => c.pass).length;
console.log(`\n${pass}/${results.checks.length} passed · ${Math.round((Date.now() - T0) / 1000)} s`);
if (moved.length) throw new Error(`restored: NO - unexpected count moves: ${moved.map(t => `${t} ${before[t]} -> ${after[t]}`).join(', ')}`);
console.log(`restored: yes (the kept writes are Jack's ask: ${Object.entries(DELTA).map(([t, n]) => `${t} +${n}`).join(', ')}; Momentum stays a client referred by HUB; the test PDF is archived, row + object kept)`);
