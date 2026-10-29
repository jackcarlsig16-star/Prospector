// companies-v2 Stage 3 - the HumanKind global-look guard (hkos-project-shell-v1's capture, pointed at HumanKind's own
// screens). Captures, as Jack at 1440x900 on localhost against the build in <root>: every :root custom property, every
// custom property set on .hk-theme, and font-family / color / background-color / border-radius / border-top-color (and class) of
// every element under [data-hk-shell], matched by path, on the HumanKind screens Today · Replies · Drafts · Pipeline · Brands ·
// Sponsors · Review · Activity · Settings (Inbox left out: it reads Gmail). Each build is captured twice so its noise
// floor is known; compare = the two builds' diff minus both noise floors.
// SCOPE (declared): Jack's real account, read-only (ownerSession: last_seen_at restored, sign-in rows kept by rule).
// Every non-GET to /api, /proxy and Supabase REST is aborted, as are the Gmail / Google / Microsoft / sync / inbox /
// Anthropic / Apollo routes and every outside host but Google Fonts. HumanKind's 8 hk_ table counts compared
// before/after (throws if one moved). No text, no screenshots. ~1 min per build, cap 200 s.
// Usage: node scripts/verify/companies-v2-hk-look.mjs capture <root with build/> <out.json>
//        node scripts/verify/companies-v2-hk-look.mjs compare <before.json> <after.json>
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });

const [MODE, A, B] = process.argv.slice(2);
function diff(a, b) {
  const lines = [];
  for (const name of Object.keys(a)) {
    if (!b[name]) { lines.push(`${name}: missing`); continue; }
    for (const part of ['root', 'theme']) {
      const ra = a[name][part], rb = b[name][part];
      for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) if (ra[k] !== rb[k]) lines.push(`${name} ${part} ${k}: ${ra[k] ?? '(none)'} -> ${rb[k] ?? '(none)'}`);
    }
    // Elements are matched by their path under the shell, so one added node doesn't shift every later one.
    const byPath = els => new Map(els.map(e => [e.p, e]));
    const pa = byPath(a[name].els), pb = byPath(b[name].els);
    for (const [p, x] of pa) {
      const y = pb.get(p);
      if (!y) { lines.push(`${name} ${p}: removed`); continue; }
      for (const k of Object.keys(x)) if (k !== 'p' && x[k] !== y[k]) lines.push(`${name} ${p} ${k}: ${x[k]} -> ${y[k]}`);
    }
    for (const [p, y] of pb) if (!pa.has(p)) lines.push(`${name} ${p}: added .${y.cl || '(no class)'}`);
  }
  return lines;
}

if (MODE === 'compare') {
  const a = JSON.parse(fs.readFileSync(A, 'utf8')), b = JSON.parse(fs.readFileSync(B, 'utf8'));
  const noise = new Set([...a.noise_floor, ...b.noise_floor]);
  const all = diff(a.pages, b.pages);
  // A custom property the old build didn't have isn't a change to anything HumanKind draws; listed, not counted.
  const added = all.filter(l => /: \(none\) -> /.test(l));
  // A visually hidden header label (.ui-sr-only) is not part of the look; listed, not counted.
  const hidden = all.filter(l => /: added \.ui-sr-only$/.test(l));
  const d = all.filter(l => !noise.has(l) && !added.includes(l) && !hidden.includes(l));
  console.log(`HumanKind global-look: ${d.length} differences (noise floors ${a.noise_floor.length} + ${b.noise_floor.length}; ${added.length} custom properties only in the new build; ${hidden.length} hidden .ui-sr-only header labels added)`);
  d.slice(0, 40).forEach(l => console.log('  ', l));
  added.slice(0, 20).forEach(l => console.log('   added:', l));
  process.exit(d.length ? 1 : 0);
}
if (MODE !== 'capture' || !A || !B) { console.log('usage: capture <root> <out.json> | compare <a.json> <b.json>'); process.exit(1); }

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const { ownerSession } = await import(ROOT + '/scripts/verify/lib/ownerSession.mjs');
const SERVE = path.resolve(A);
const PORT = 3997, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA = new URL(process.env.SUPABASE_URL).host;
const HK_TABLES = ['hk_touches', 'hk_brands', 'hk_replies', 'hk_contacts', 'hk_settings', 'hk_import_runs', 'hk_events', 'hk_sync_runs'];
const SCREENS = ['today', 'replies', 'drafts', 'pipeline', 'brands', 'sponsors', 'review', 'activity', 'settings'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const hk = (await svc.from('businesses').select('id, features').eq('name', 'HumanKind')).data?.find(b => b.features?.hk_sales);
if (!hk) { console.log('ABORT: no HumanKind workspace with hk_sales on'); process.exit(1); }
const counts = async () => { const o = {}; for (const t of HK_TABLES) { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', hk.id); if (r.error) throw new Error(`count ${t}: ${r.error.message}`); o[t] = r.count; } return o; };
const before = await counts();

let srv, browser, owner;
const blocked = [];
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 200000 });
const CAPTURE = `(() => {
  const vars = s => { const o = {}; for (let i = 0; i < s.length; i++) { const p = s[i]; if (p.startsWith('--')) o[p] = s.getPropertyValue(p).trim(); } return o; };
  const root = vars(getComputedStyle(document.documentElement));
  const t = document.querySelector('.hk-theme');
  const theme = t ? Object.fromEntries(Object.entries(vars(getComputedStyle(t))).filter(([k, v]) => root[k] !== v)) : {};
  const shell = document.querySelector('[data-hk-shell]');
  const pathOf = el => { const parts = []; for (let e = el; e && e !== shell; e = e.parentElement) { let i = 1; for (let s = e.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === e.tagName) i++; parts.unshift(e.tagName.toLowerCase() + ':' + i); } return parts.join('>'); };
  const els = [...shell.querySelectorAll('*')].map(el => { const s = getComputedStyle(el); return { p: pathOf(el), cl: el.getAttribute('class') || '', f: s.fontFamily, c: s.color, b: s.backgroundColor, r: s.borderRadius, bc: s.borderTopColor }; });
  return { root, theme, els };
})()`;

async function run(pass) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(([k, v]) => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); localStorage.setItem('prospector_auto_assay_disabled', '1'); }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session)]);
  const BLOCK = /\/proxy\/|\/api\/(gmail|google|microsoft)\b|\/inbox|\/sync|\/apollo|\/visits\/pull|\/tidy\/run|\/research/;
  await ctx.route('**/*', route => {
    const req = route.request(); const u = new URL(req.url());
    const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
    const deny = (isLocal && (BLOCK.test(u.pathname) || (req.method() !== 'GET' && /^\/api\//.test(u.pathname))))
      || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
    if (deny) { blocked.push(`${req.method()} ${u.pathname}`); return route.abort(); }
    return route.continue();
  });
  const page = await ctx.newPage(); page.setDefaultTimeout(20000);
  const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 120)));
  await page.goto(`${BASE}/`);
  await page.getByLabel('Workspace').waitFor(); await page.getByLabel('Workspace').selectOption({ label: 'HumanKind' });
  await page.locator('[data-hk-shell] [data-hk-avatar]').waitFor(); await page.waitForTimeout(800);
  const out = {};
  for (const id of SCREENS) {
    await page.locator(`[data-hk-nav="${id}"]`).click(); await page.waitForTimeout(1500);
    out[id] = await page.evaluate(CAPTURE);
  }
  log(`pass ${pass}: ${SCREENS.map(s => out[s].els.length).join('/')} elements; page errors ${errors.length}`, errors.slice(0, 2).join(' | '));
  await ctx.close();
  return out;
}

let code = 0;
try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: SERVE, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  const a = await run(1), b = await run(2);
  const noise = diff(a, b);
  const data = { root: SERVE, captured_at: new Date().toISOString(), pages: a, noise_floor: noise };
  if (JSON.stringify(data).includes('@')) throw new Error('capture contains "@" - not written');
  fs.writeFileSync(B, JSON.stringify(data));
  log(`written ${B}; noise floor ${noise.length}; blocked ${blocked.length}`);
} catch (e) { console.log('ERROR', e.message); code = 1; } finally {
  await cleanup();
  const after = await counts();
  const moved = HK_TABLES.filter(t => after[t] !== before[t]).map(t => `${t} ${before[t]} -> ${after[t]}`);
  if (moved.length) throw new Error(`restored: NO - HumanKind counts moved: ${moved.join(', ')}`);
  log('restored: yes (8 HumanKind counts identical)');
}
process.exit(code);
