// hk-legacy-cleanup-v1 Stage 4 live check - localhost against the build, as Jack (ownerSession: magic-link session,
// no email sent; his sign-in rows are KEPT by rule, last_seen_at restored). READ-ONLY: every non-GET to /api, /proxy
// and Supabase REST is aborted; every outside host except Supabase + Google Fonts is blocked.
//  1 HumanKind opens into the Sales OS shell; GET /api/hk/:businessId/shell answers 200 (members 2, no "@")
//  2 Settings > Members lists 2 members
//  3 the workspace menu has no "Old ... screens" item (R2) and the shell page has no legacy nav labels
//  4 HomeLover: sidebar = Sales & Marketing, Accounts, Projects, Business Intel & Strategy, Ideas, Tools; Accounts and
//    Projects pages render without page errors
//  restored = HomeLover accounts 66 / projects 3 / lists 7 + sales_* counts identical before / after, HumanKind
//  accounts 35 / intel 0 / profiles 0 / legacy_archive 64 identical; a count() error or non-number count THROWS ->
//  "restored: NO (check failed: ...)" and exit 1. No temp workspace, no temp user, 0 Claude, 0 Apollo, 0 writes.
//  Runtime ~1-2 min, hard cap 240 s. Shots: .screenshots/hk-legacy-cleanup-v1/. Run npm run build first.
// Usage: node scripts/verify/hk-legacy-cleanup-v1-stage4.mjs
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
const OUT = path.join(ROOT, '.screenshots', 'hk-legacy-cleanup-v1');
const PORT = 3989, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const HK = '981b790c-a3b0-4265-b32e-1f701d5731ff';
const HL_TABLES = ['accounts', 'projects', 'lists', 'sales_goals', 'sales_opportunities', 'sales_targets', 'sales_people', 'sales_source_events', 'sales_partner_events', 'partner_contacts', 'sales_week_goals'];
const HK_TABLES = ['accounts', 'business_intel_entries', 'business_profiles', 'legacy_archive', 'business_members'];
const LEGACY_LABELS = ['Command Center', 'Accounts', 'Projects', 'Business Intel & Strategy', 'Ideas', 'Tools'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const count = async (t, biz) => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', biz); if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message || `no count (HTTP ${r.status})`}`); return r.count; };
const snapshot = async () => { const o = { homelover: {}, humankind: {} }; for (const t of HL_TABLES) o.homelover[t] = await count(t, HOMELOVER); for (const t of HK_TABLES) o.humankind[t] = await count(t, HK); return o; };

const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }

let srv, browser, owner;
const blocked = [], realCalls = [], results = { checks: [], errors: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${detail}` : ''); };
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  if (owner) { log(await owner.release()); owner = null; }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 240000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));
if (before.homelover.accounts !== 66 || before.homelover.projects !== 3 || before.homelover.lists !== 7) { console.log('ABORT: HomeLover baseline is not 66 / 3 / 7'); process.exit(1); }

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  await ctx.addInitScript(([k, v, b, d]) => {
    if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
    for (const n of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${n}_ran_${b}`, d);
    localStorage.setItem('prospector_auto_assay_disabled', '1');
  }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HOMELOVER, today]);
  const BLOCK = /\/proxy\/(anthropic|gmail|gcal)|\/api\/(gmail|google|microsoft)\b|\/api\/sales\/[^/]+\/(sync|apollo)|\/apollo-check|\/visits\/pull|\/tidy\/run|\/research/;
  const shellBodies = [];
  await ctx.route('**/*', async route => {
    const req = route.request(); const u = new URL(req.url());
    if (/anthropic\.com$|apollo\.io$|gmail\.googleapis\.com$/.test(u.host) || (u.host === 'www.googleapis.com' && u.pathname.startsWith('/gmail'))) realCalls.push(`${req.method()} ${u.host}${u.pathname}`);
    const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
    const deny = (isLocal && (BLOCK.test(u.pathname) || (req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname))))
      || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/'))
      || (!isLocal && !isSupa && !isFont);
    if (deny) { blocked.push(`${req.method()} ${u.host}${u.pathname}`); return route.abort(); }
    if (isLocal && /^\/api\/hk\/[^/]+\/shell$/.test(u.pathname)) { const res = await route.fetch(); const text = await res.text(); shellBodies.push({ status: res.status(), text }); return route.fulfill({ response: res, body: text }); }
    return route.continue();
  });
  const page = await ctx.newPage(); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 140)));
  const shellReady = async () => { await page.locator('[data-hk-shell] [data-hk-avatar]').waitFor({ timeout: 20000 }); await page.waitForTimeout(500); };

  // 1 HumanKind -> shell; /shell 200
  await page.goto(`${BASE}/`);
  await page.getByLabel('Workspace').waitFor({ timeout: 20000 });
  await page.getByLabel('Workspace').selectOption({ label: 'HumanKind' });
  await shellReady();
  const shell = shellBodies[0]; let shellJson = null; try { shellJson = JSON.parse(shell?.text || 'null'); } catch {}
  const shellMembers = Array.isArray(shellJson?.members) ? shellJson.members.length : null;
  ok(`1 HumanKind opens into the shell; GET /api/hk/:id/shell = ${shell?.status} with ${shellMembers} members, no "@"`, shell?.status === 200 && shellMembers === 2 && !shell.text.includes('@'));
  await page.screenshot({ path: path.join(OUT, 'hk-shell-1440.png') });

  // 2 Settings > Members = 2
  await page.locator('[data-hk-nav="settings"]').click(); await page.waitForTimeout(400);
  const memberRows = await page.locator('[data-hk-member]').count();
  const shellText = await page.evaluate(() => document.querySelector('[data-hk-shell]').innerText);
  ok(`2 Settings > Members lists ${memberRows} members, no "@" on the page`, memberRows === 2 && !shellText.includes('@'));
  await page.screenshot({ path: path.join(OUT, 'hk-settings-members-1440.png') });

  // 3 no Old-screens item; no legacy nav labels anywhere in the shell
  await page.locator('[data-hk-workspace]').click(); await page.waitForTimeout(250);
  const oldItems = await page.getByRole('menuitem', { name: /^Old .* screens$/ }).count();
  const menuItems = await page.getByRole('menuitem').allInnerTexts();
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  const legacyButtons = await page.locator('#root').getByRole('button').allInnerTexts();
  const legacyHits = legacyButtons.map(t => t.trim()).filter(t => LEGACY_LABELS.includes(t));
  ok(`3 (R2) workspace menu has no "Old ... screens" item (items: ${menuItems.map(t => t.trim()).join(' | ')}); no legacy nav label button in the shell`, oldItems === 0 && legacyHits.length === 0 && (await page.locator('[data-hk-shell]').count()) === 1, legacyHits.join(', ') || '');

  // 4 HomeLover: sidebar unchanged, Accounts + Projects render
  await page.locator('[data-hk-workspace]').click(); await page.getByRole('menuitem', { name: 'HomeLover' }).click();
  await page.locator('#main-content').waitFor({ timeout: 20000 }); await page.waitForTimeout(1500);
  const expectedHl = ['Sales & Marketing', 'Accounts', 'Projects', 'Business Intel & Strategy', 'Ideas', 'Tools'];
  // NavRow buttons read "<icon> <label>", so match on the label at the end of the button text.
  const buttonTexts = (await page.locator('#root').getByRole('button').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
  const has = l => buttonTexts.some(t => t === l || t.endsWith(' ' + l));
  const hlNavOk = expectedHl.every(has) && !has('Command Center') && !has('Sales OS');
  ok(`4 HomeLover sidebar = ${expectedHl.join(', ')} (no Command Center, no Sales OS)`, hlNavOk, buttonTexts.filter(t => [...expectedHl, 'Command Center', 'Sales OS'].some(l => t.endsWith(l))).join(' | '));
  const errsBefore = errors.length;
  await page.locator('#root').getByRole('button', { name: 'Accounts', exact: true }).first().click(); await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT, 'hl-accounts-1440.png') });
  const accountsText = await page.locator('#main-content').innerText();
  await page.locator('#root').getByRole('button', { name: 'Projects', exact: true }).first().click(); await page.waitForTimeout(1500);
  const projectsText = await page.locator('#main-content').innerText();
  ok('4 HomeLover Accounts and Projects pages render (content present, no page errors)', accountsText.length > 200 && projectsText.length > 50 && errors.length === errsBefore, `accounts text ${accountsText.length} chars, projects text ${projectsText.length} chars`);
  ok('No page errors', !errors.length, JSON.stringify(errors.slice(0, 3)));
  ok(`real-call guard: 0 requests to Anthropic / Apollo / Gmail hosts; ${blocked.length} non-GET / outside requests aborted`, !realCalls.length);
  await ctx.close();
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    const after = await snapshot();
    restored = JSON.stringify(before) === JSON.stringify(after);
    line = restored ? `yes (HomeLover accounts ${after.homelover.accounts} / projects ${after.homelover.projects} / lists ${after.homelover.lists} + sales_* identical; HumanKind ${JSON.stringify(after.humankind)} identical; Jack sign-in rows kept by rule)` : `NO - ${JSON.stringify(before)} -> ${JSON.stringify(after)}`;
  } catch (e) { line = `NO (check failed: ${e.message})`; }
  const pass = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'hk-legacy-cleanup-v1-stage4.json'), JSON.stringify({ ...results, restored }, null, 2));
  console.log(`\n${pass}/${results.checks.length} checks passed${results.errors.length ? ` · ${results.errors.length} errors` : ''} · Claude 0 · Apollo 0 · writes 0`);
  for (const e of results.errors) console.log('ERROR:', e.split('\n').slice(0, 3).join(' | '));
  console.log(`restored: ${line}`);
  process.exit(restored ? 0 : 1);
}
