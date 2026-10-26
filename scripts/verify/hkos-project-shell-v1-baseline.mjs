// hkos-project-shell-v1 global-look guard. Stage 0 captures the baseline; Stage 2 re-captures and diffs it.
// Captures, as Jack at 1440x900 on localhost: getComputedStyle of every :root custom property + font-family /
// background-color / border-radius of the first 200 elements under <body>, on businesses home, HomeLover Sales &
// Marketing Actions, Pipeline, and Admin. Each page is captured twice (two fresh browser contexts) and the pair is
// diffed, so the noise floor is known before Stage 2 compares against it.
// SCOPE (declared): Jack's real account, read-only. Session = a one-time magic-link token minted with the service key
// (Jack approved 2026-10-25; no email is sent), signed out with scope 'local' at the end so his other sessions live.
// Writes it cannot avoid: profiles.last_seen_at (restored to the exact value); a sign_in auth_events row from /api/me
// and auth.users.last_sign_in_at stay as they are (real sign-ins stay logged, Jack 2026-10-26; reported, not
// restored). 0 Claude / 0 Apollo / 0 Gmail / 0 Graph: those
// routes, every non-GET to /api, /proxy and Supabase REST, and every other outside host are aborted in the browser
// (count reported). HomeLover counts compared before/after. No text or screenshots are captured (Admin lists
// addresses). Runtime ~1.5 min, hard cap 240 s. Serves build/ - run npm run build first.
// Usage: node scripts/verify/hkos-project-shell-v1-baseline.mjs [capture|compare] [json path]
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const { ownerSession } = await import(ROOT + '/scripts/verify/lib/ownerSession.mjs');

const MODE = process.argv[2] === 'compare' ? 'compare' : 'capture';
const FILE = process.argv[3] || path.join(ROOT, 'scripts', 'verify', 'baselines', `hkos-shell-v1-${MODE === 'capture' ? 'before' : 'after'}.json`);
const BEFORE = path.join(ROOT, 'scripts', 'verify', 'baselines', 'hkos-shell-v1-before.json');
const PORT = 3987;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const HL_TABLES = ['sales_week_goals', 'sales_goals', 'sales_signals', 'sales_suggestions', 'sales_sync_runs', 'visit_pull_runs', 'sales_tidy_runs', 'research_runs', 'apollo_credit_spend'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);

// node-cron in server.js fires SFDC at hh:00 for hh % 6 == 0 (local) and Apollo at 06:00 LA: never straddle one.
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) {
  console.log('ABORT: within 5 min of a server.js cron time; rerun later'); process.exit(1);
}

const count = async t => (await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HOMELOVER)).count;
const hlCounts = async () => { const o = {}; for (const t of HL_TABLES) o[t] = await count(t); return o; };

const hlBefore = await hlCounts();
log('HomeLover before', JSON.stringify(hlBefore));

let srv, browser, owner, session;
const blocked = [];
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  if (owner) { log(await owner.release()); owner = null; }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 240000 });

const CAPTURE = `(() => {
  const rs = getComputedStyle(document.documentElement);
  const root = {};
  for (let i = 0; i < rs.length; i++) { const p = rs[i]; if (p.startsWith('--')) root[p] = rs.getPropertyValue(p).trim(); }
  const pathOf = el => { const parts = []; for (let e = el; e && e !== document.body; e = e.parentElement) { let i = 1; for (let s = e.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === e.tagName) i++; parts.unshift(e.tagName.toLowerCase() + ':' + i); } return parts.join('>'); };
  const els = [...document.querySelectorAll('body *')].slice(0, 200).map(el => { const s = getComputedStyle(el); return { p: pathOf(el), f: s.fontFamily, b: s.backgroundColor, r: s.borderRadius }; });
  return { root, els };
})()`;

const PAGES = [
  ['businesses-home', async page => { await page.getByLabel('Workspace').waitFor({ timeout: 20000 }); }],
  ['homelover-actions', async page => {
    await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' });
    await page.locator('[data-actions]').waitFor({ timeout: 20000 });
    await page.locator('[data-actions] .ui-table__toggle, [data-actions] [data-row]').first().waitFor({ timeout: 20000 });
  }],
  ['homelover-pipeline', async page => {
    await page.locator('[data-sales-tabrow]').getByRole('button', { name: 'Pipeline', exact: true }).click();
    await page.locator('[data-pipeline-companies]').waitFor({ timeout: 20000 });
    await page.locator('[data-pipeline-companies] [data-row], [data-pipeline-companies] .ui-table__toggle').first().waitFor({ timeout: 20000 });
  }],
  ['admin', async page => { await page.locator('#root').getByRole('button', { name: 'Admin', exact: true }).click(); await page.getByRole('heading', { name: 'Admin' }).first().waitFor({ timeout: 20000 }); }],
];

async function run(pass) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  await ctx.addInitScript(([k, v, b, d]) => {
    if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
    for (const n of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${n}_ran_${b}`, d);
    localStorage.setItem('prospector_auto_assay_disabled', '1');
  }, [`sb-${REF}-auth-token`, JSON.stringify(session), HOMELOVER, today]);
  const local = `localhost:${PORT}`;
  const supa = new URL(process.env.SUPABASE_URL).host;
  const BLOCK = /\/proxy\/(anthropic|gmail|gcal)|\/api\/(gmail|google|microsoft)\b|\/api\/sales\/[^/]+\/(sync|apollo)|\/visits\/pull|\/tidy\/run|\/research/;
  await ctx.route('**/*', route => {
    const req = route.request(); const u = new URL(req.url());
    const isLocal = u.host === local, isSupa = u.host === supa, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
    const deny = (isLocal && (BLOCK.test(u.pathname) || (req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname))))
      || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/'))
      || (!isLocal && !isSupa && !isFont);
    if (deny) { blocked.push(`${req.method()} ${u.host}${u.pathname}`); return route.abort(); }
    return route.continue();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message.slice(0, 120)));
  await page.goto(`http://${local}/`);
  const out = {};
  for (const [name, go] of PAGES) {
    await go(page);
    await page.waitForTimeout(1500);
    out[name] = await page.evaluate(CAPTURE);
    log(`pass ${pass} ${name}: ${Object.keys(out[name].root).length} root vars, ${out[name].els.length} elements`);
  }
  if (errors.length) log(`pass ${pass} page errors:`, errors.length, errors.slice(0, 3));
  await ctx.close();
  return out;
}

function diff(a, b) {
  const lines = [];
  for (const name of Object.keys(a)) {
    if (!b[name]) { lines.push(`${name}: missing`); continue; }
    const ra = a[name].root, rb = b[name].root;
    for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) if (ra[k] !== rb[k]) lines.push(`${name} :root ${k}: ${ra[k]} -> ${rb[k]}`);
    const n = Math.max(a[name].els.length, b[name].els.length);
    for (let i = 0; i < n; i++) {
      const x = a[name].els[i], y = b[name].els[i];
      if (!x || !y) { lines.push(`${name} el#${i}: ${x ? 'removed' : 'added'}`); continue; }
      for (const k of ['p', 'f', 'b', 'r']) if (x[k] !== y[k]) lines.push(`${name} el#${i} ${k}: ${x[k]} -> ${y[k]}`);
    }
  }
  return lines;
}

let code = 0;
try {
  owner = await ownerSession(svc);
  session = owner.session;
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  const a = await run(1);
  const b = await run(2);
  const noise = diff(a, b);
  log(`self-diff (pass 1 vs pass 2): ${noise.length} differences`);
  noise.slice(0, 15).forEach(l => console.log('  ', l));
  const data = { spec: 'hkos-project-shell-v1', captured_at: new Date().toISOString(), viewport: '1440x900', pages: a, noise_floor: noise };
  if (JSON.stringify(data).includes('@')) throw new Error('capture contains "@" - not written');
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 1));
  log('written:', FILE);
  if (MODE === 'compare') {
    const base = JSON.parse(fs.readFileSync(BEFORE, 'utf8'));
    const d = diff(base.pages, a).filter(l => !base.noise_floor.includes(l));
    log(`global-look diff vs baseline (minus noise floor): ${d.length}`);
    d.slice(0, 30).forEach(l => console.log('  ', l));
    if (d.length) code = 1;
  }
} catch (e) {
  console.log('ERROR', e.message); code = 1;
} finally {
  await cleanup();
  const hlAfter = await hlCounts();
  const moved = HL_TABLES.filter(t => hlAfter[t] !== hlBefore[t]);
  log('HomeLover after', JSON.stringify(hlAfter), moved.length ? `MOVED: ${moved.join(', ')}` : '(unchanged)');
  const byKind = {}; blocked.forEach(b => { const k = b.replace(/\/[0-9a-f-]{36}/g, '/:id'); byKind[k] = (byKind[k] || 0) + 1; });
  log(`blocked requests: ${blocked.length}`, JSON.stringify(byKind));
}
process.exit(code);
