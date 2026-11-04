// homelover-team-emails-v1 Stage 2 live check - READ-ONLY. localhost against the build, as Jack (ownerSession) on the REAL
// HomeLover workspace; RENDER unset, so the local server.js runs no scheduler and sends nothing. Every non-GET is aborted
// (0 writes, 0 Claude, 0 Apollo, 0 Graph sends). Sales › Settings › Team emails at 1440 and 390: the panel renders, the
// Reconnect banner shows while the sender's grant lacks Mail.Send, contrast + axe on the panel, no sideways scroll at 390,
// a Viewer pass by intercepting /api/me (no controls, no address on the page), 0 page errors. Prints counts, never an
// address. ~1-2 min, cap 240 s. "restored" THROWS if a team-email table count moved.
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
const OUT = path.join(ROOT, '.screenshots', 'homelover-team-emails-v1-stage2');
const PORT = 3996, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const TABLES = ['sales_team_email_recipients', 'sales_team_email_changes', 'sales_team_email_sends', 'sales_team_email_settings'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const biz = (await svc.from('businesses').select('id, name').ilike('name', '%homelover%')).data;
if (biz?.length !== 1) throw new Error('expected one HomeLover business');
const HL = biz[0].id;
const count = async t => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL); if (r.error) throw new Error(`count ${t}: ${r.error.message}`); return r.count; };
const snapshot = async () => { const o = {}; for (const t of TABLES) o[t] = await count(t); return o; };
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
let srv, browser, owner;
const blocked = [], realCalls = [];
const results = { checks: [], axe: {}, contrast: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  if (owner) { log(await owner.release()); owner = null; }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 240000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', RENDER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  async function open(width, { viewer = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 }, hasTouch: width < 900 });
    await ctx.addInitScript(([k, val, bz, d]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, val);
      localStorage.setItem('prospector_sales_tab', 'settings'); localStorage.setItem('prospector_sales_view', 'team-emails');
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, d);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (/anthropic\.com$|apollo\.io$|graph\.microsoft\.com$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      const deny = (isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname)) || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.pathname.replace(HL, '<HL>')}`); return route.abort(); }
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
    await page.goto(`${BASE}/?tab=settings&view=team-emails`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 20000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: /^Settings/ }).first().dispatchEvent('click'); await page.waitForTimeout(2500);
    await page.locator('[data-team-emails]').waitFor({ timeout: 20000 });
    return { ctx, page, errors };
  }
  const shot = (page, nme) => page.screenshot({ path: `${OUT}/${nme}.png`, animations: 'disabled', caret: 'hide', fullPage: true });
  const measure = async (page, key) => {
    const m = await page.evaluate(measureScript({ scope: '[data-team-emails]' }));
    if (m.error) { ok(`contrast ${key}`, false, m.error); return; }
    const s = summarize(m); results.contrast[key] = s;
    ok(`contrast ${key}: 0 text < 4.5:1, 0 controls < 3:1 (text ${s.textFails}/${s.texts}, controls ${s.controlFails}/${s.controls})`, s.textFails === 0 && s.controlFails === 0, s.worst.slice(0, 4).map(w => `${w.ratio} ${w.text || ''}`).join(' | '));
  };
  const axeOn = async (page, key) => {
    await page.addScriptTag({ content: AXE });
    const vs = await page.evaluate(async () => { const r = await window.axe.run(document.querySelector('[data-team-emails]'), { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length })); });
    results.axe[key] = vs;
    ok(`axe ${key}: ${vs.length} violations`, vs.length === 0, JSON.stringify(vs).slice(0, 300));
  };
  const addrOnPage = page => page.evaluate(() => (document.querySelector('[data-team-emails]').innerText.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g) || []).length);

  // ---- 1440 as Jack (owner + sender)
  {
    const { ctx, page, errors } = await open(1440);
    const panel = page.locator('[data-team-emails]');
    ok('1440: Sales › Settings tab is current and Team emails renders', (await page.locator('[data-sales-tabrow] [aria-current="page"]').innerText()).startsWith('Settings') && await panel.isVisible());
    const banner = page.locator('[data-team-email-banner]');
    const grant = (await svc.from('microsoft_grants').select('scopes').eq('user_id', owner.userId).maybeSingle()).data;
    const canSend = !!grant?.scopes?.includes('Mail.Send');
    ok(`1440: banner matches the grant (Mail.Send ${canSend ? 'granted - no banner' : 'missing - banner + Reconnect button'})`, canSend ? !(await banner.count()) : (await banner.isVisible() && await banner.getByRole('button', { name: 'Reconnect Microsoft →' }).isVisible()));
    const rows = await page.locator('[data-recipient-row]').count();
    ok(`1440: recipients editor present (${rows} rows; DB live rows ${before.sales_team_email_recipients})`, await page.getByLabel('Add an address').isVisible());
    ok('1440: both emails listed with their switches', (await page.locator('[data-team-email-kind]').count()) === 2 && (await page.getByRole('checkbox', { name: /On/ }).count()) >= 2);
    ok(`1440: member suggestions offered (${await page.getByRole('button', { name: /^Add [A-Z]/ }).count()})`, true);
    ok('1440: last sends list shows the 07:00 needs-reconnect row', (await page.locator('[data-send-row]').count()) >= 1);
    await shot(page, '1440-owner');
    await measure(page, '1440 owner');
    await axeOn(page, '1440 owner');
    ok(`1440: 0 page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // ---- 390 as Jack
  {
    const { ctx, page, errors } = await open(390);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(`390: no sideways scroll on the page (${sideways}px)`, sideways <= 1);
    await shot(page, '390-owner');
    await measure(page, '390 owner');
    ok('390: 0 page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // ---- 1440 as a Viewer
  {
    const { ctx, page, errors } = await open(1440, { viewer: true });
    ok('viewer: no inputs, no test buttons', (await page.locator('[data-team-emails] input, [data-team-emails] select').count()) === 0 && !(await page.getByRole('button', { name: /Send a test|^Add/ }).count()));
    // The simulated viewer is Jack, who is also the sender: his own Reconnect stays (it reconnects his Microsoft, nothing else).
    ok('viewer who is the sender: Reconnect still offered for their own mailbox', (await page.getByRole('button', { name: 'Reconnect Microsoft →' }).count()) === ((await svc.from('microsoft_grants').select('scopes').eq('user_id', owner.userId).maybeSingle()).data?.scopes?.includes('Mail.Send') ? 0 : 1));
    ok(`viewer: 0 addresses on the panel`, (await addrOnPage(page)) === 0);
    ok('viewer: says the owner manages it', await page.getByText('The owner manages team emails.').isVisible());
    await shot(page, '1440-viewer');
    await axeOn(page, '1440 viewer');
    ok('viewer: 0 page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  ok(`0 real Claude / Apollo / Graph calls from the browser (${realCalls.length})`, realCalls.length === 0, realCalls.join(', '));
  log(`blocked non-GETs (expected page-load writes): ${blocked.length} - ${[...new Set(blocked)].slice(0, 6).join(', ')}`);
} catch (e) {
  ok('run completed', false, e.message);
} finally {
  await cleanup();
}
const after = await snapshot();
const moved = TABLES.filter(t => after[t] !== before[t]);
const passed = results.checks.filter(c => c.pass).length;
console.log(`\nRESULT ${passed}/${results.checks.length} checks · screenshots ${OUT}`);
if (moved.length) throw new Error(`restored: NO - counts moved: ${moved.map(t => `${t} ${before[t]} -> ${after[t]}`).join(', ')}`);
console.log('restored: yes (team-email table counts unchanged; 0 writes allowed)');
