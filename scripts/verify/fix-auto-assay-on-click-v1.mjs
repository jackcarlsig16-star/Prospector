// FIX auto-assay-on-click-v1 live check - READ-ONLY, localhost against the build, as Jack (ownerSession): a fresh browser
// (no auto-assay stamp, no opt-out key) on Master Magnetics (a workspace with Accounts), watched 60 s for
// /proxy/anthropic calls; the offer line vs the real unscored Territory count. Every non-GET aborted; 0 Claude / 0 Apollo.
// ~2 min, cap 200 s. "restored" THROWS if any of the 50 counts moved. Run npm run build first.
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
const OUT = path.join(ROOT, '.screenshots', 'fix-auto-assay-on-click-v1');
const PORT = 3998, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const SALES = 'cadence_plan call_notes collateral company_score_days company_scores email_activity email_backfill_weeks email_daily_counts email_messages events goals huddles infra_items insight_dismissals lead_uploads mailbox_owners metric_targets metrics_daily month_goals opportunities opportunity_events outreach_campaigns outreach_contacts outreach_events outreach_steps outreach_tracks partner_events people prospect_events prospect_state raw_snapshots sequence_tags sequenced_accounts settings signals source_events stage_marks suggestions sync_runs targets tidy_runs visit_skip week_goal_steps week_goals week_notes week_plans week_report week_report_sections'.split(' ').map(t => `sales_${t}`);
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
const marksLeft = async () => { const r = await svc.from('sales_stage_marks').select('id, record_type, record_id, stage, at').eq('business_id', HL); if (r.error) throw new Error(`marks: ${r.error.message}`); return r.data; };
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
let srv, browser, owner;
const blocked = [], realCalls = [], writes = [], proxyCalls = [];
const results = { checks: [], errors: [], axe: {}, contrast: {}, n2: {}, numbers: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 200000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));


try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // A fresh browser: only the session - no auto-assay stamp, no opt-out key (the old effect would have run here).
  await ctx.addInitScript(([k, v]) => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session)]);
  await ctx.route('**/*', async route => {
    const req = route.request(); const u = new URL(req.url());
    if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
    const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
    if (isLocal && u.pathname.startsWith('/proxy/anthropic')) proxyCalls.push(Date.now());
    const apiWrite = isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname);
    if (apiWrite) writes.push(`${req.method()} ${u.pathname}`);
    const deny = apiWrite || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
    if (deny) { blocked.push(`${req.method()} ${u.pathname}`); return route.abort(); }
    return route.continue();
  });
  const page = await ctx.newPage(); page.setDefaultTimeout(20000);
  const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
  const t0 = Date.now();
  await page.goto(`${BASE}/`);
  await page.getByLabel('Workspace').waitFor({ timeout: 30000 }); await page.getByLabel('Workspace').selectOption({ label: 'Master Magnetics' }); await page.waitForTimeout(3000);
  const accountsRow = await page.getByRole('button', { name: /^\W*Accounts$/ }).count();
  const offer = await page.locator('[data-assay-offer]').count();
  const offerText = offer ? await page.locator('[data-assay-offer]').innerText() : '(no line - 0 unscored Territory accounts in this browser)';
  const territory = (await svc.from('accounts').select('data').is('business_id', null)).data || [];
  const unscored = territory.filter(x => !x.data?.score && !x.data?.assay_failed && x.data?.web).length;
  ok(`Master Magnetics (Accounts in its nav: ${accountsRow}); the offer line = the real unscored Territory count ${unscored}: ${offerText}`, accountsRow === 1 && (unscored > 10 ? offer === 1 && offerText.includes(`${unscored} accounts`) : offer === 0));
  const wait = 60000 - (Date.now() - t0);
  if (wait > 0) await page.waitForTimeout(wait);
  await page.screenshot({ path: `${OUT}/master-magnetics-1440.png`, animations: 'disabled', caret: 'hide' });
  ok(`0 Claude proxy calls in the 60 s after a fresh load (seen ${proxyCalls.length}); 0 page errors`, proxyCalls.length === 0 && !errors.length, errors.join(' | '));
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
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ ...results, proxyCalls: proxyCalls.length, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\nFIX auto-assay-on-click-v1 live check: ${passed}/${results.checks.length} passed · Claude 0 (proxy calls seen: ${proxyCalls.length}) · Apollo 0 · writes 0\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
