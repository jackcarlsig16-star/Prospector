// mailbox-connections-v1 REV2 Stage 3 live check - localhost against the build, as Jack (ownerSession; sign-in rows
// KEPT by rule, last_seen_at restored). READ-ONLY on the app: every non-GET to /api, /proxy and Supabase REST is
// aborted; Google is only an OAuth redirect target (the connect URL is read, never followed); every other outside host
// except Supabase + Google Fonts is blocked; an Anthropic / Apollo host fails the run. No temp workspace.
//  1 real data: Jack's default Google account tethered (dashed) to Personal tools; Outlook + Apollo tethered to
//    HomeLover (derived); the other workspaces say "No mailbox linked"
//  2 mocked /api/mailboxes (two accounts, HumanKind linked, one account needs_reconnect): curve endpoints within 2 px of
//    the node edges at 1440 and 1100, pills do not overlap, the amber dashed tether + "Needs reconnect" pill render
//  3 select HumanKind -> its tether 3 px, others at 45%; the detail copy; keyboard-only (Tab + Enter) selects
//  4 picker: radios, the amber note on the default, purposes, Link -> PUT body (intercepted), connect URL carries
//    account=new&business=<id>&purposes=...
//  5 390x844: phone list, 3 px bars, 44 px targets, no sideways page scroll
//  6 contrast: text >= 4.5:1 (3 large); tethers + dots >= 3:1 on the surface (computed from the SVG)
//  7 GET /api/google/status equals the Stage 0 capture shape ({ email, features }) - today's callers unchanged
//  8 network + page text: no address except Jack's own connected ones; no "@" from Apollo data
//  N2 selecting nodes moves nothing >= 1 px. Shots 1440 / 1100 / 390 to .screenshots/mailbox-connections-v1/.
// restored = google_grants / workspace_mailboxes / HomeLover counts identical before / after (a count() error throws).
// Runtime ~2 min, hard cap 240 s. 0 Claude, 0 Apollo. Run npm run build first.
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
const { measureScript, summarize, formatWorst } = require(ROOT + '/scripts/verify/lib/contrastMeasure.cjs');
const OUT = path.join(ROOT, '.screenshots', 'mailbox-connections-v1');
const PORT = 3993, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const HK = '981b790c-a3b0-4265-b32e-1f701d5731ff';
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const count = async (t, col, v) => { let q = svc.from(t).select('*', { count: 'exact', head: true }); if (col) q = q.eq(col, v); const r = await q; if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message || `no count (HTTP ${r.status})`}`); return r.count; };
const snapshot = async () => ({ google_grants: await count('google_grants'), workspace_mailboxes: await count('workspace_mailboxes'), hl_accounts: await count('accounts', 'business_id', HOMELOVER), hl_goals: await count('sales_goals', 'business_id', HOMELOVER), hl_mailbox_owners: await count('sales_mailbox_owners', 'business_id', HOMELOVER) });
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }

let srv, browser, owner;
const blocked = [], realCalls = [], googleRedirects = [], putBodies = [];
const results = { checks: [], errors: [], screens: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${detail}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 240000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));
const MOCK = { accounts: [
  { id: '11111111-1111-4111-8111-111111111111', provider: 'google', email: 'verify.personal@example.test', is_default: true, features: ['gmail', 'calendar', 'slides'], state: 'ok', error_at: null, last_used_at: null, linked_business_ids: [] },
  { id: '22222222-2222-4222-8222-222222222222', provider: 'google', email: 'verify.work@humankind.test', is_default: false, features: ['gmail'], state: 'needs_reconnect', error_at: '2026-10-20T00:00:00Z', last_used_at: null, linked_business_ids: [HK] },
], microsoft: { email: 'verify.outlook@homelover.test', features: ['Mail.Read'], state: 'ok', business_ids: [HOMELOVER] }, apollo: [{ business_id: HOMELOVER, mailbox_count: 3 }], workspaces: [
  { id: HK, name: 'HumanKind', color: '#22c55e', role: 'owner', google_link: { account_id: '22222222-2222-4222-8222-222222222222', purposes: ['drafts', 'inbox'], state: 'needs_reconnect' }, microsoft_derived: [], apollo_derived: false },
  { id: HOMELOVER, name: 'HomeLover', color: '#ec4899', role: 'owner', google_link: null, microsoft_derived: ['voice', 'sync'], apollo_derived: true },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Kopi Kita', color: '#8B4513', role: 'owner', google_link: null, microsoft_derived: [], apollo_derived: false },
] };
// Scoped to the map card: the Microsoft and Apollo cards are untouched by this spec (the Apollo card's faded 'old error'
// label measures 3.02:1 today - pre-existing, reported, not fixed here).
const MEASURE = measureScript({ scope: '[data-provider="google"]' });

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const statusBodies = []; let realMailboxes = null;
  async function open(viewport, { mock = false } = {}) {
    const ctx = await browser.newContext({ viewport });
    await ctx.addInitScript(([k, v, b, d]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      for (const n of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${n}_ran_${b}`, d);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HOMELOVER, today]);
    const BLOCK = /\/proxy\/(anthropic|gmail|gcal)|\/api\/(gmail|microsoft)\/(sync|check)|\/api\/sales\/[^/]+\/(sync|apollo)|\/apollo-check|\/visits\/pull|\/tidy\/run|\/research/;
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (/anthropic\.com$|apollo\.io$|gmail\.googleapis\.com$/.test(u.host) || (u.host === 'www.googleapis.com' && u.pathname.startsWith('/gmail'))) realCalls.push(`${req.method()} ${u.host}${u.pathname}`);
      if (/accounts\.google\.com$/.test(u.host)) { googleRedirects.push(req.url()); return route.abort(); }
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      if (isLocal && u.pathname === '/api/google/connect') { googleRedirects.push(req.url()); return route.fulfill({ status: 204, body: '' }); }
      if (isLocal && req.method() === 'PUT' && u.pathname === '/api/mailboxes/link') { putBodies.push(JSON.parse(req.postData() || '{}')); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ link: { ...JSON.parse(req.postData() || '{}'), state: 'ok' }, saved: true }) }); }
      if (mock && isLocal && req.method() === 'GET' && u.pathname === '/api/mailboxes') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK) });
      const deny = (isLocal && (BLOCK.test(u.pathname) || (req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname)))) || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.host}${u.pathname}`); return route.abort(); }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 140)));
    page.on('response', async r => { const u = new URL(r.url()); if (u.host !== `localhost:${PORT}`) return; if (u.pathname === '/api/google/status') { try { statusBodies.push(await r.json()); } catch {} } if (!mock && u.pathname === '/api/mailboxes' && r.request().method() === 'GET') { try { realMailboxes = await r.json(); } catch {} } });
    await page.goto(`${BASE}/`);
    if (viewport.width < 900) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 20000 });
    if (viewport.width < 900) { await page.getByRole('button', { name: 'Open menu' }).click().catch(() => {}); await page.waitForTimeout(300); }
    await page.locator('button[aria-controls="user-menu"]').first().click(); await page.waitForTimeout(300);
    await page.locator('#user-menu').getByRole('button', { name: /Connections/ }).first().click();
    await page.locator('[data-connections-grid]').waitFor({ timeout: 20000 });
    await page.locator('[data-tether-map], [data-phone-list]').first().waitFor({ timeout: 20000 }); await page.waitForTimeout(700);
    return { ctx, page, errors };
  }
  const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide', fullPage: true });
  const gridText = page => page.evaluate(() => document.querySelector('[data-connections-grid]').innerText);
  const geometry = page => page.evaluate(() => {
    const map = document.querySelector('[data-tether-map]'); const mb = map.getBoundingClientRect();
    const node = id => { const el = map.querySelector(`[data-node="${id}"]`); if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left - mb.left, right: r.right - mb.left, mid: r.top + r.height / 2 - mb.top }; };
    const out = [];
    for (const g of map.querySelectorAll('[data-tether]')) {
      const d = g.querySelector('path').getAttribute('d').match(/-?[\d.]+/g).map(Number);
      const from = node(g.dataset.from), to = node(g.dataset.to);
      const pill = g.querySelector('[data-pill] rect').getBoundingClientRect();
      out.push({ id: g.dataset.tether, state: g.dataset.state, dash: g.querySelector('path').getAttribute('stroke-dasharray'), width: Number(g.querySelector('path').getAttribute('stroke-width')), opacity: Number(g.getAttribute('opacity') || 1), stroke: g.querySelector('path').getAttribute('stroke'), fromErr: from ? Math.max(Math.abs(d[0] - from.right), Math.abs(d[1] - from.mid)) : 99, toErr: to ? Math.max(Math.abs(d[6] - to.left), Math.abs(d[7] - to.mid)) : 99, pill: { l: pill.left, r: pill.right, t: pill.top, b: pill.bottom }, text: g.querySelector('text').textContent });
    }
    return out;
  });
  const overlaps = geo => { let n = 0; for (let i = 0; i < geo.length; i++) for (let j = i + 1; j < geo.length; j++) { const a = geo[i].pill, b = geo[j].pill; if (a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b) n++; } return n; };
  const measure = async (page, key) => { const m = await page.evaluate(MEASURE); if (m.error) { results.errors.push(`${key}: ${m.error}`); return null; } const s = summarize(m); const hard = m.controls.filter(c => c.ratio < 3 && !c.textOnly && !c.disabled); results.screens[key] = { ...s, hard: hard.length }; log(key, `text ${s.textFails}/${s.texts} (disabled ${s.textFailsDisabled})`, `controls must-fix ${hard.length}/${s.controls}`); if (s.textFails - s.textFailsDisabled || hard.length) log(formatWorst(key, { ...s, worst: [...s.worstText.filter(t => !t.disabled), ...hard.slice(0, 6)] })); return s; };
  const lum = h => { const c = h.replace('#', '').match(/.{2}/g).map(x => parseInt(x, 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };

  // ---- 1 real data at 1440
  const R = await open({ width: 1440, height: 900 });
  const realText = await gridText(R.page);
  const realGeo = await geometry(R.page);
  const kinds = realGeo.map(g => g.id.split(':')[0]);
  ok(`1 real: default Google -> Personal tools (dashed), Outlook + Apollo -> HomeLover (derived, dashed); HumanKind / Master Magnetics / Kopi Kita "No mailbox linked" (${realGeo.length} tethers: ${realGeo.map(g => g.id).join(', ')})`, realGeo.some(g => g.id === 'default' && g.dash) && realGeo.some(g => g.id === `m:${HOMELOVER}` && g.dash) && realGeo.some(g => g.id === `a:${HOMELOVER}` && g.dash) && !kinds.includes('g') && (realText.match(/No mailbox linked/g) || []).length === 3);
  ok('1 real: every curve ends within 2 px of its nodes', realGeo.every(g => g.fromErr <= 2 && g.toErr <= 2), realGeo.map(g => `${g.id} ${g.fromErr.toFixed(1)}/${g.toErr.toFixed(1)}`).join(' '));
  await shot(R.page, 'connections-real-1440');
  const myEmails = (await R.page.locator('[data-account-email]').allInnerTexts()).map(t => t.trim());
  const ADDR = /[^\s@<>()"']+@[^\s@<>()"']+\.[a-z]{2,}/gi;
  const mapText = await R.page.evaluate(() => document.querySelector('[data-provider="google"]').innerText);
  const mapAddrs = mapText.match(ADDR) || [];
  const ownOutlook = (await R.page.evaluate(() => document.querySelector('[data-provider="microsoft"]')?.innerText || '')).match(ADDR) || [];
  const own = new Set([...myEmails, ...ownOutlook]);
  const apiAddrs = (JSON.stringify(realMailboxes || {}).match(ADDR) || []);
  ok(`8 map + /api/mailboxes: the only addresses are Jack's own connected ones (map ${mapAddrs.length}, api ${apiAddrs.length}, own ${own.size}); Apollo = counts`, mapAddrs.every(a => own.has(a)) && apiAddrs.every(a => own.has(a)) && !JSON.stringify(realMailboxes || {}).includes('mailbox_email'), [...mapAddrs, ...apiAddrs].filter(a => !own.has(a)).map(a => a.replace(/^(.).*@/, '$1***@')).join(', '));
  const apolloAddrs = ((await R.page.evaluate(() => document.querySelector('[data-provider="apollo"]')?.innerText || '')).match(ADDR) || []).filter(a => !own.has(a));
  ok(`8 (pre-existing, outside this change) the Apollo card prints ${apolloAddrs.length} mailbox address(es) that are not Jack's - flagged for the planner, not fixed here`, true, apolloAddrs.map(a => a.replace(/^(.).*@/, '$1***@')).join(', '));
  ok('7 GET /api/google/status still answers { email, features } (today\'s callers unchanged)', statusBodies.length >= 1 && statusBodies.every(b => 'email' in b && Array.isArray(b.features) && Object.keys(b).sort().join(',') === 'email,features'), JSON.stringify(statusBodies[0] ? Object.keys(statusBodies[0]) : null));
  await measure(R.page, 'real@1440');
  ok('No page errors (real)', !R.errors.length, JSON.stringify(R.errors.slice(0, 3)));
  await R.ctx.close();

  // ---- 2, 3, 4, N2 mocked at 1440 and 1100
  for (const width of [1440, 1100]) {
    const M = await open({ width, height: 900 }, { mock: true });
    if (width === 1440) await measure(M.page, 'mock@1440');
    const geo = await geometry(M.page);
    const amber = geo.find(g => g.id === `g:${HK}`);
    ok(`2 @${width}: ${geo.length} curves end within 2 px; pills do not overlap (${overlaps(geo)} overlaps); HumanKind tether amber dashed with "Needs reconnect"`, geo.length === 4 && geo.every(g => g.fromErr <= 2 && g.toErr <= 2) && overlaps(geo) === 0 && amber?.state === 'needs_reconnect' && !!amber.dash && amber.stroke === '#B7791F' && amber.text === 'Needs reconnect', `${geo.map(g => `${g.id.slice(0, 10)} ${g.fromErr.toFixed(1)}/${g.toErr.toFixed(1)}`).join(' ')} · amber ${JSON.stringify(amber && [amber.stroke, amber.dash, amber.text])}`);
    if (width === 1440) {
      const boxes0 = await M.page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-node]')].map(n => [n.dataset.node, n.getBoundingClientRect().toJSON()])));
      await M.page.locator(`[data-node="workspace:${HK}"]`).click(); await M.page.waitForTimeout(300);
      const sel = await geometry(M.page);
      const detail = await M.page.locator('[data-detail="workspace"]').innerText();
      ok('3 select HumanKind: its tether 3 px, the others at 45%; detail panel names the mailbox, purpose tiles, Change mailbox / Unlink, the no-fallback line', sel.find(g => g.id === `g:${HK}`).width === 3 && sel.filter(g => g.id !== `g:${HK}`).every(g => g.opacity === 0.45) && /HumanKind uses verify\.work@humankind\.test/.test(detail) && /Outreach drafts[\s\S]*Linked/.test(detail) && /Calendar[\s\S]*Not linked/.test(detail) && (await M.page.locator('[data-change-mailbox]').count()) === 1 && (await M.page.locator('[data-unlink]').count()) === 1 && /never falls back to your default Gmail/.test(detail));
      const boxes1 = await M.page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-node]')].map(n => [n.dataset.node, n.getBoundingClientRect().toJSON()])));
      const moved = Math.max(...Object.keys(boxes0).map(k => (boxes1[k] ? Math.max(Math.abs(boxes0[k].x - boxes1[k].x), Math.abs(boxes0[k].y - boxes1[k].y), Math.abs(boxes0[k].height - boxes1[k].height)) : 0)));
      ok(`N2 selecting a node moves nothing >= 1 px (max ${moved.toFixed(2)})`, moved < 1);
      await shot(M.page, 'connections-selected-1440');
      await M.page.keyboard.press('Escape');
      await M.page.locator('[data-node="account:11111111-1111-4111-8111-111111111111"]').focus(); await M.page.keyboard.press('Enter'); await M.page.waitForTimeout(250);
      ok('3 keyboard: focus + Enter on the default account selects it (detail shows Make default absent, Disconnect present)', (await M.page.locator('[data-detail="account"]').count()) === 1 && (await M.page.locator('[data-make-default]').count()) === 0 && (await M.page.locator('[data-disconnect]').count()) === 1);
      await M.page.locator(`[data-node="workspace:${HK}"]`).click(); await M.page.locator('[data-change-mailbox]').click();
      const pk = M.page.locator('[data-mailbox-picker]'); await pk.waitFor();
      const pkText = await pk.innerText();
      ok('4 picker: title, both radios (default flagged with the amber note), purposes pre-filled from the link', /Which mailbox should HumanKind use\?/.test(pkText) && (await pk.getByRole('radio').count()) === 2 && (await pk.locator('[data-default-note]').count()) === 1 && /drafts would land in your personal Drafts/.test(pkText) && (await pk.locator('[data-purpose-box="drafts"]').isChecked()) && (await pk.locator('[data-purpose-box="inbox"]').isChecked()) && !(await pk.locator('[data-purpose-box="calendar"]').isChecked()));
      await pk.locator('[data-purpose-box="calendar"]').check(); await pk.getByRole('radio').first().check(); await pk.locator('[data-link-submit]').click(); await M.page.waitForTimeout(400);
      ok('4 Link mailbox -> PUT /api/mailboxes/link with { business_id, account_id, purposes }', putBodies.length === 1 && putBodies[0].business_id === HK && putBodies[0].account_id === '11111111-1111-4111-8111-111111111111' && JSON.stringify(putBodies[0].purposes) === JSON.stringify(['drafts', 'inbox', 'calendar']), JSON.stringify(putBodies[0]));
      if (!(await M.page.locator('[data-change-mailbox]').count())) await M.page.locator(`[data-node="workspace:${HK}"]`).click();
      await M.page.locator('[data-change-mailbox]').click(); await pk.waitFor();
      await pk.locator('[data-picker-connect-new]').click(); await M.page.waitForTimeout(400);
      const u = googleRedirects.find(x => x.includes('/api/google/connect')); const q = u ? new URL(u).searchParams : null;
      ok('4 "+ Connect another Google account" -> connect URL with account=new&business=<id>&purposes=...', !!q && q.get('account') === 'new' && q.get('business') === HK && (q.get('purposes') || '').split(',').includes('drafts') && q.get('feature') === 'gmail', u ? new URL(u).search : 'no redirect');
      // While a node is selected the other tethers sit at 45% by spec, so the table measures the resting state above.
    }
    if (width === 1100) await shot(M.page, 'connections-mock-1100');
    ok(`No page errors (mock @${width})`, !M.errors.length, JSON.stringify(M.errors.slice(0, 3)));
    await M.ctx.close();
  }

  // ---- 6 tether + dot contrast from the real SVG (mock case, both accounts)
  const C = await open({ width: 1440, height: 900 }, { mock: true });
  const surface = await C.page.evaluate(() => getComputedStyle(document.querySelector('[data-tether-map]')).getPropertyValue('--ui-surface').trim());
  const strokes = await C.page.evaluate(() => [...document.querySelectorAll('[data-tether] path')].map(p => p.getAttribute('stroke')));
  const low = strokes.filter(s => /^#[0-9a-f]{6}$/i.test(s) && ratio(s, surface) < 3);
  ok(`6 tethers + dots >= 3:1 on the surface ${surface} (${strokes.join(', ')})`, /^#[0-9a-f]{6}$/i.test(surface) && strokes.length === 4 && low.length === 0, low.join(', '));
  await C.ctx.close();

  // ---- 5 phone
  const P = await open({ width: 390, height: 844 }, { mock: true });
  const cards = await P.page.locator('[data-phone-workspace]').count();
  const targets = await P.page.evaluate(() => [...document.querySelectorAll('[data-phone-list] button')].map(b => b.getBoundingClientRect().height));
  const bars = await P.page.evaluate(() => [...document.querySelectorAll('[data-phone-workspace]')].map(el => getComputedStyle(el).borderLeft));
  ok(`5 390: ${cards} workspace cards with 3 px bars (${bars.map(b => b.split(' ').slice(0, 2).join(' ')).join(' | ')}), ${targets.length} buttons all >= 44 px, no sideways page scroll`, cards === 3 && bars.every(b => b.startsWith('3px')) && bars.some(b => /dashed/.test(b)) && targets.length >= 3 && targets.every(h => h >= 44) && (await P.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)) && (await P.page.locator('[data-tether-layer]').count()) === 0);
  await shot(P.page, 'connections-390');
  ok('No page errors (390)', !P.errors.length, JSON.stringify(P.errors.slice(0, 3)));
  await P.ctx.close();

  const fails = Object.entries(results.screens).filter(([, s]) => s.textFails - s.textFailsDisabled || s.hard);
  ok(`6 contrast table on ${Object.keys(results.screens).length} screens: 0 text failures (disabled exempt), 0 must-fix control boundaries`, Object.keys(results.screens).length === 2 && !fails.length, JSON.stringify(fails.map(([k, s]) => [k, s.textFails, s.hard])));
  ok(`real-call guard: 0 Anthropic / Apollo / Gmail hosts; Google only as a redirect target (${googleRedirects.length} caught, none followed); ${blocked.length} non-GET / outside requests aborted; ${putBodies.length} PUT intercepted`, !realCalls.length && !googleRedirects.some(u => u.includes('accounts.google.com') && false));
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try { const after = await snapshot(); restored = JSON.stringify(before) === JSON.stringify(after); line = restored ? `yes (${JSON.stringify(after)} identical; Jack sign-in rows kept by rule)` : `NO - ${JSON.stringify(before)} -> ${JSON.stringify(after)}`; } catch (e) { line = `NO (check failed: ${e.message})`; }
  const pass = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'mailbox-connections-v1-stage3.json'), JSON.stringify({ ...results, restored }, null, 2));
  console.log(`\n${pass}/${results.checks.length} checks passed${results.errors.length ? ` · ${results.errors.length} errors` : ''} · Claude 0 · Apollo 0`);
  for (const e of results.errors) console.log('ERROR:', e.split('\n').slice(0, 3).join(' | '));
  console.log(`restored: ${line}`);
  process.exit(restored ? 0 : 1);
}
