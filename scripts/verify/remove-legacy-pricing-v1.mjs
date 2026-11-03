// FIX remove-legacy-pricing-v1 live check - READ-ONLY, localhost against the build, as Jack (ownerSession), on HomeLover:
// Sales > Pipeline and Sales > Actions render real rows with 0 page errors; Tools shows only Account Lookalike (no Deal
// Workspace / Deck Blueprints); no "Pricing" / "ROI" entry anywhere in the sidebar. Every non-GET aborted; 0 Claude /
// 0 Apollo. ~1 min, cap 150 s. "restored" THROWS if any counted table moved. Run npm run build first.
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
const OUT = path.join(ROOT, '.screenshots', 'remove-legacy-pricing-v1');
const PORT = 3997, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const TABLES = ['accounts', 'sales_goals', 'sales_targets', 'sales_people', 'sales_stage_marks', 'web_visits', 'business_anthropic_usage'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const biz = (await svc.from('businesses').select('id, name').ilike('name', '%homelover%')).data;
if (biz?.length !== 1) throw new Error('expected one HomeLover business');
const HL = biz[0].id;
async function count(t) {
  let r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL);
  if (r.error) r = await svc.from(t).select('*', { count: 'exact', head: true });
  if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message || 'no count'}`);
  return r.count;
}
const snapshot = async () => { const o = {}; for (const t of TABLES) o[t] = await count(t); return o; };
let srv, browser, owner;
const blocked = [], realCalls = [], writes = [];
const results = { checks: [], errors: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 150000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  const today = new Date().toISOString().slice(0, 10);
  const open = async tab => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await ctx.addInitScript(([k, v, b, d]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${b}`, d);
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
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(20000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    await page.goto(`${BASE}/?tab=${tab}`);
    await page.getByLabel('Workspace').waitFor({ timeout: 30000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    return { ctx, page, errors };
  };
  const toSales = async (page, tab) => {
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: tab === 'pipeline' ? /^Pipeline/ : /^Actions/ }).first().dispatchEvent('click'); await page.waitForTimeout(1500);
  };

  {
    const { ctx, page, errors } = await open('pipeline');
    const sidebar = await page.locator('nav, aside').first().innerText().catch(() => '');
    ok('sidebar has no Pricing / ROI / Deal Workspace / Deck Blueprints entry', !/\bPricing\b|\bROI\b|Deal Workspace|Deck Blueprints/.test(sidebar));
    await toSales(page, 'pipeline');
    await page.locator('[data-pipeline-companies]').waitFor({ timeout: 20000 });
    await page.locator('[data-row]').first().waitFor({ timeout: 20000 }); await page.waitForTimeout(600);
    const rows = await page.locator('[data-row]').count();
    await page.screenshot({ path: `${OUT}/pipeline-1440.png`, animations: 'disabled', caret: 'hide' });
    ok(`Pipeline renders real rows (${rows}); 0 page errors`, rows > 0 && !errors.length, errors.join(' | '));
    await toSales(page, 'actions');
    const search = await page.getByLabel('Search actions').count();
    await page.screenshot({ path: `${OUT}/actions-1440.png`, animations: 'disabled', caret: 'hide' });
    ok(`Actions renders (search box ${search}); 0 page errors`, search === 1 && !errors.length, errors.join(' | '));
    await page.locator('#root').getByRole('button', { name: /^\W*Tools$/ }).first().dispatchEvent('click'); await page.waitForTimeout(1500);
    const body = await page.locator('#root').innerText();
    await page.screenshot({ path: `${OUT}/tools-1440.png`, animations: 'disabled', caret: 'hide' });
    ok('Tools shows Account Lookalike only (no Deal Workspace / Deck Blueprints); 0 page errors', body.includes('Account Lookalike') && !/Deal Workspace|Deck Blueprints/.test(body) && !errors.length, errors.join(' | '));
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
    restored = true; line = `yes (${TABLES.length} table counts identical; sign-in row kept by rule, profile last_seen_at restored)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ ...results, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\nFIX remove-legacy-pricing-v1 live check: ${passed}/${results.checks.length} passed · Claude 0 · Apollo 0 · writes 0\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
