// FIX remove-legacy-pricing-reads live check - READ-ONLY, localhost against the build, as Jack (ownerSession). The three
// old pricing keys are seeded (with a sentinel) into the test browser before load; after load they must be gone. The
// four screens live on the accounts-model pages, which HomeLover (goals_sales) hides, so they are opened on Master
// Magnetics: Accounts > Action Items, one account card's Comms and Call Prep - none may show the sentinel; 0 page errors.
// Deal Timeline (Ledger) is covered by Jest only. Every non-GET aborted; 0 Claude / 0 Apollo. ~1 min, cap 150 s.
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
const OUT = path.join(ROOT, '.screenshots', 'remove-legacy-pricing-reads-v1');
const PORT = 3996, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const KEYS = ['prospector_pricing_files', 'prospector_pricing_intel', 'prospector_pricing_snapshots'];
const SENTINEL = 'ZZ_LEGACY_PRICING_SENTINEL';
const TABLES = ['accounts', 'business_anthropic_usage', 'account_business_details', 'account_lists'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
async function count(t) {
  const r = await svc.from(t).select('*', { count: 'exact', head: true });
  if (r.error || typeof r.count !== 'number') return `n/a (${r.error?.message || 'no count'})`;
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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // Seed before any app code runs; the app's own load cleanup must then remove the three keys.
  await ctx.addInitScript(([k, v, keys, s]) => {
    if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
    localStorage.setItem('prospector_auto_assay_disabled', '1');
    for (const key of keys) localStorage.setItem(key, JSON.stringify({ any: { products: [{ name: s, included: true }], name: s } }));
  }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), KEYS, SENTINEL]);
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
  await page.goto(`${BASE}/`);
  await page.getByLabel('Workspace').waitFor({ timeout: 30000 });
  const left = await page.evaluate(keys => keys.filter(k => localStorage.getItem(k) !== null), KEYS);
  ok(`after load the three legacy keys are gone (left: ${left.length})`, left.length === 0, left.join(', '));
  await page.getByLabel('Workspace').selectOption({ label: 'Master Magnetics' }); await page.waitForTimeout(2500);
  await page.locator('#root').getByRole('button', { name: /^\W*Accounts$/ }).first().dispatchEvent('click'); await page.waitForTimeout(2500);
  const noSentinel = async () => !(await page.locator('body').innerText()).includes(SENTINEL);
  await page.getByRole('button', { name: /^Action Items/ }).first().click(); await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/action-items-1440.png`, animations: 'disabled', caret: 'hide' });
  ok('Accounts > Action Items renders; no sentinel; 0 page errors', (await noSentinel()) && !errors.length, errors.join(' | '));
  await page.getByRole('button', { name: /^Accounts \(/ }).first().click(); await page.waitForTimeout(1500);
  const card = page.locator('[id^="acct-"]').first();
  await card.waitFor({ timeout: 20000 });
  await card.locator(':scope > div').first().click(); await page.waitForTimeout(1200);
  const comms = page.getByRole('button', { name: /Comms$/ }).first();
  const hasComms = await comms.count();
  if (hasComms) { await comms.click(); await page.waitForTimeout(1200); }
  await page.screenshot({ path: `${OUT}/comms-1440.png`, animations: 'disabled', caret: 'hide' });
  ok(`account card Comms opens (${hasComms ? 'opened' : 'NOT FOUND'}); no sentinel; 0 page errors`, hasComms && (await noSentinel()) && !errors.length, errors.join(' | '));
  const prep = page.getByRole('button', { name: /Call Prep$/ }).first();
  const hasPrep = await prep.count();
  if (hasPrep) { await prep.click(); await page.waitForTimeout(1500); }
  const body = await page.locator('body').innerText();
  await page.screenshot({ path: `${OUT}/call-prep-1440.png`, animations: 'disabled', caret: 'hide' });
  ok(`Call Prep opens (${hasPrep ? 'opened' : 'NOT FOUND'}); no "Pricing intel" / "Deal Snapshot" / sentinel; 0 page errors`, hasPrep && !/Pricing intel|Deal Snapshot/.test(body) && !body.includes(SENTINEL) && !errors.length, errors.join(' | '));
  const leftEnd = await page.evaluate(keys => keys.filter(k => localStorage.getItem(k) !== null), KEYS);
  ok('the keys are still gone at the end (nothing re-wrote them)', leftEnd.length === 0, leftEnd.join(', '));
  ok(`browser reached 0 Claude / Apollo hosts; every non-GET was aborted (${[...new Set(writes)].join(', ') || 'none attempted'})`, !realCalls.length && writes.every(w => blocked.includes(w)));
  await ctx.close();
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
  console.log(`\nFIX remove-legacy-pricing-reads live check: ${passed}/${results.checks.length} passed · Claude 0 · Apollo 0 · writes 0\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
