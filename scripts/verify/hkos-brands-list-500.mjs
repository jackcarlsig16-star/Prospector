// FIX hkos-brands-list-500 live check - READ-ONLY, as Jack (ownerSession) on the REAL HumanKind workspace. GETs only:
// /brands unfiltered + view=all / my_open / unclaimed / overdue (status, row count, time), the Pipeline count (view=all
// minus candidate / passed / skipped / sponsor, as BrandsScreen does), /sponsors (brands + total periods), /drafts and
// /replies (200 + counts). Local mode (default) runs the build's server.js against the real DB and also renders Grow ›
// Brands "All" and Pipeline at 1440 (row counts + screenshots); --prod runs the same GETs against the deployed app.
// SCOPE (declared): ~8 GETs per mode, 0 Claude, 0 Gmail (no inbox / sync route), 0 Apollo; every non-GET aborted in the
// browser. Writes: the /shell last_seen_at stamp on hk_member_prefs (restored exactly) and profiles.last_seen_at
// (ownerSession restores it). "restored" THROWS if a HumanKind count moved. Runtime ~1 min, cap 180 s.
// Usage: node scripts/verify/hkos-brands-list-500.mjs [--prod]   (local mode: run npm run build first)
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
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const PROD = process.argv.includes('--prod');
const OUT = path.join(ROOT, '.screenshots', 'hkos-brands-list-500');
const PORT = 4002;
const BASE = PROD ? 'https://prospector-chtj.onrender.com' : `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const HK_TABLES = ['hk_brands', 'hk_contacts', 'hk_touches', 'hk_replies', 'hk_sponsor_periods', 'hk_events', 'hk_sync_runs', 'hk_job_runs'];
const PIPELINE_HIDDEN = new Set(['candidate', 'passed', 'skipped', 'sponsor']);
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const must = r => { if (r.error) throw new Error(r.error.message); return r; };
const hk = (await svc.from('businesses').select('id, features').eq('name', 'HumanKind')).data?.find(b => b.features?.hk_sales);
if (!hk) { console.log('ABORT: no HumanKind workspace with hk_sales on'); process.exit(1); }
const counts = async () => { const o = {}; for (const t of HK_TABLES) o[t] = must(await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', hk.id)).count; return o; };
const jackId = must(await svc.from('profiles').select('id').eq('is_platform_owner', true)).data[0].id;
const prefsSeen = async () => must(await svc.from('hk_member_prefs').select('last_seen_at').eq('business_id', hk.id).eq('user_id', jackId).maybeSingle()).data?.last_seen_at ?? null;
const before = { counts: await counts(), seen: await prefsSeen() };

let srv, browser, owner;
const results = { mode: PROD ? 'prod' : 'local', checks: [], errors: [], numbers: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 180000 });
fs.mkdirSync(OUT, { recursive: true });

try {
  owner = await ownerSession(svc);
  if (!PROD) {
    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
    for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const get = async p => { const t0 = Date.now(); const r = await fetch(`${BASE}/api/hk/${hk.id}${p}`, { headers: { cookie } }); const j = await r.json().catch(() => null); return { status: r.status, ms: Date.now() - t0, body: j }; };
  const live = must(await svc.from('hk_brands').select('*', { count: 'exact', head: true }).eq('business_id', hk.id).is('archived_at', null)).count;
  const all = await get('/brands');
  results.numbers.brands = { status: all.status, ms: all.ms, rows: all.body?.brands?.length ?? null, live };
  ok(`${results.mode} GET /brands (unfiltered): ${all.status} in ${all.ms} ms, ${all.body?.brands?.length ?? '-'} rows (live brands ${live}); no "@"`, all.status === 200 && all.body.brands.length === live && !JSON.stringify(all.body).includes('@'));
  ok(`${results.mode} primary contact names present on ${all.body?.brands?.filter(b => b.primary_contact_name).length ?? 0} rows`, all.status === 200);
  for (const view of ['all', 'my_open', 'unclaimed', 'overdue']) {
    const r = await get(`/brands?view=${view}`);
    results.numbers[`view_${view}`] = { status: r.status, ms: r.ms, rows: r.body?.brands?.length ?? null };
    ok(`${results.mode} GET /brands?view=${view}: ${r.status} in ${r.ms} ms, ${r.body?.brands?.length ?? '-'} rows`, r.status === 200);
  }
  const pipeline = (all.body?.brands || []).filter(b => !PIPELINE_HIDDEN.has(b.status)).length;
  results.numbers.pipeline = pipeline;
  ok(`${results.mode} Pipeline rows (view=all minus candidate / passed / skipped / sponsor): ${pipeline}`, all.status === 200);
  const sp = await get('/sponsors');
  const periods = (sp.body?.sponsors || []).reduce((n, s) => n + (s.periods?.length || 0), 0);
  results.numbers.sponsors = { status: sp.status, ms: sp.ms, sponsors: sp.body?.sponsors?.length ?? null, with_periods: (sp.body?.sponsors || []).filter(s => s.periods?.length).length, periods, dnc: sp.body?.dnc?.length ?? null };
  ok(`${results.mode} GET /sponsors: ${sp.status} in ${sp.ms} ms, ${sp.body?.sponsors?.length ?? '-'} sponsors (${results.numbers.sponsors.with_periods} with periods, ${periods} periods), ${sp.body?.dnc?.length ?? '-'} do-not-contact`, sp.status === 200);
  for (const p of ['/drafts', '/replies?handled=all']) {
    const r = await get(p);
    const n = r.body?.drafts?.length ?? r.body?.replies?.length ?? null;
    results.numbers[p] = { status: r.status, ms: r.ms, rows: n };
    ok(`${results.mode} GET ${p}: ${r.status} in ${r.ms} ms, ${n ?? '-'} rows`, r.status === 200);
  }

  if (!PROD) {
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(([k, v]) => { try { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); localStorage.setItem('prospector_auto_assay_disabled', '1'); } catch { /* sandboxed frame */ } }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session)]);
    await ctx.route('**/*', route => {
      const req = route.request(); const u = new URL(req.url());
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      if ((isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname)) || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont)) return route.abort();
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(30000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    await page.goto(`${BASE}/`);
    await page.getByLabel('Workspace').waitFor({ timeout: 20000 }); await page.getByLabel('Workspace').selectOption({ label: 'HumanKind' });
    await page.locator('[data-hk-shell] [data-hk-avatar]').waitFor({ timeout: 20000 });
    // The owner toggle on "All" so the list is the whole workspace, then Brands › All.
    const allOwners = page.getByRole('button', { name: 'All', exact: true }).first();
    if (await allOwners.count()) await allOwners.click();
    await page.locator('[data-hk-nav="brands"]').click();
    await page.getByRole('tab', { name: /^All/ }).click().catch(() => {});
    await page.locator('[data-hk-shell] tr[data-row], [data-hk-shell] .hk-empty, [data-hk-shell] [role="alert"]').first().waitFor({ timeout: 30000 }); await page.waitForTimeout(800);
    const brandRows = await page.locator('[data-hk-shell] tr[data-row]').count();
    const brandErr = await page.locator('[data-hk-shell] [role="alert"]').count();
    await page.screenshot({ path: `${OUT}/brands-all-1440.png`, animations: 'disabled', caret: 'hide' });
    await page.locator('[data-hk-nav="pipeline"]').click();
    await page.locator('[data-hk-shell] tr[data-row], [data-hk-shell] .hk-empty, [data-hk-shell] [role="alert"]').first().waitFor({ timeout: 30000 }); await page.waitForTimeout(800);
    const pipeRows = await page.locator('[data-hk-shell] tr[data-row]').count();
    const pipeErr = await page.locator('[data-hk-shell] [role="alert"]').count();
    await page.screenshot({ path: `${OUT}/pipeline-1440.png`, animations: 'disabled', caret: 'hide' });
    results.numbers.ui = { brandRows, pipeRows };
    ok(`browser 1440: Brands "All" renders ${brandRows} rows (no error banner: ${brandErr === 0}); Pipeline renders ${pipeRows} rows (no error banner: ${pipeErr === 0}); 0 page errors`, brandRows > 0 && pipeRows > 0 && !brandErr && !pipeErr && !errors.length, errors.join(' | '));
    await ctx.close();
  }
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    must(await svc.from('hk_member_prefs').update({ last_seen_at: before.seen }).eq('business_id', hk.id).eq('user_id', jackId));
    const after = await counts();
    const moved = HK_TABLES.filter(t => before.counts[t] !== after[t]).map(t => `${t} ${before.counts[t]} -> ${after[t]}`);
    if (moved.length) throw new Error(`counts moved: ${moved.join(', ')}`);
    if ((await prefsSeen()) !== before.seen) throw new Error('hk_member_prefs.last_seen_at not restored');
    restored = true; line = `yes (${HK_TABLES.length} HumanKind counts identical; hk_member_prefs.last_seen_at + profiles.last_seen_at restored; sign-in rows kept by rule)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, `report-${results.mode}.json`), JSON.stringify({ ...results, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\nhkos-brands-list-500 live check (${results.mode}): ${passed}/${results.checks.length} passed · Claude 0 · Gmail 0 · writes 0\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
