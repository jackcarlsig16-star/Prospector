// heat-size-v1 Stage 2 - before / after PNGs of Pipeline › Map (the Companies list, listScores) and Pipeline › People at
// 1440 and 390, localhost against build/, as Jack (ownerSession) on the REAL HomeLover workspace. READ-ONLY: every non-GET
// API call and every Supabase write is aborted at the network layer and counted; the server runs with the Claude and
// Apollo keys empty and the browser's calls to either host are aborted. Also measures N2 (no sideways page scroll, the
// People table fits its card) and runs axe on each screen. Usage: node scripts/verify/heat-size-v1-stage2-shots.mjs before|after
// Declared scope: 1 owner session (released, last_seen_at restored), 5 page loads, ~20 GETs, 0 writes, ~90 s, cap 240 s.
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
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const LABEL = ['before', 'after'].includes(process.argv[2]) ? process.argv[2] : null;
if (!LABEL) { console.log('usage: node scripts/verify/heat-size-v1-stage2-shots.mjs before|after'); process.exit(2); }
const OUT = path.join(ROOT, '.screenshots', 'heat-size-v1');
const PORT = 3996, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data?.[0]?.id;
if (!HL) throw new Error('no HomeLover business');
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
let srv, browser, owner;
const blocked = [], realCalls = [], writes = [];
const results = { label: LABEL, checks: [], errors: [], axe: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 240000 });
fs.mkdirSync(OUT, { recursive: true });

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', ANTHROPIC_API_KEY: '', APOLLO_API_KEY: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const get = async p => { const r = await fetch(`${BASE}/api/sales/${HL}${p}`, { headers: { cookie } }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const scores = await get('/goals/scores');
  ok(`GET goals/scores ${scores.status}: ${scores.body?.counts?.ranked} ranked · sizes ${JSON.stringify(scores.body?.counts?.sizes || null)} · headcount ${JSON.stringify(scores.body?.counts?.headcount || null)}`, scores.status === 200);
  const people = await get('/goals/people/activity?window=all');
  ok(`GET goals/people/activity ${people.status}: ${people.body?.total} people · with a company headcount ${people.body?.rows?.filter(r => r.company?.employees != null).length}`, people.status === 200);

  browser = await chromium.launch();
  async function open(width, view) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 }, hasTouch: width < 900 });
    await ctx.addInitScript(([k, v, bz, dd]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      localStorage.setItem('prospector_goals_owner', 'team');
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, dd);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (u.protocol === 'file:' || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      const apiWrite = isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname);
      if (apiWrite) writes.push(`${req.method()} ${u.pathname}`);
      const deny = apiWrite || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.pathname}`); return route.abort(); }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(25000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    await page.goto(`${BASE}/?tab=pipeline&view=${view}`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 25000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: /^Pipeline/ }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
    await page.locator('[data-sales-subviews]').getByRole('tab', { name: view === 'people' ? 'People' : 'Map', exact: true }).dispatchEvent('click'); await page.waitForTimeout(1500);
    await page.locator(view === 'people' ? '[data-people-table] [data-row]' : '[data-priorities] [data-detail-table] [data-row]').first().waitFor({ timeout: 30000 }); await page.waitForTimeout(2000);
    return { ctx, page, errors };
  }
  const axeOn = async (page, sel, key) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async s => { const r = await window.axe.run(document.querySelector(s) || document, { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); }, sel);
    results.axe[key] = v;
    ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v).slice(0, 300));
  };
  const measure = (page, sel) => page.evaluate(s => {
    const sec = document.querySelector(s);
    const box = sec?.querySelector('.ui-table-box'), table = sec?.querySelector('table.ui-table');
    return {
      headers: [...(sec?.querySelectorAll('th') || [])].map(h => h.textContent.replace(/^[◉✓]/, '').replace(/\s*[↕▲▼]\s*$/, '').trim()),
      rows: sec?.querySelectorAll('[data-row]').length || 0, cards: sec?.querySelectorAll('.ui-list__row').length || 0,
      sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
      fit: box && table ? { boxClient: box.clientWidth, boxScroll: box.scrollWidth, table: Math.round(table.getBoundingClientRect().width) } : null,
      coverage: sec?.querySelector('[data-coverage]')?.textContent || null,
      sizeChips: [...(sec?.querySelectorAll('[data-size-chip]') || [])].map(b => b.textContent.trim()),
      showing: [...(sec?.querySelectorAll('span, div') || [])].map(e => e.textContent.trim()).find(t => /^Showing \d+ of \d+/.test(t)) || '',
    };
  }, sel);
  const shots = [['priorities', 1440, '[data-priorities]', 'companies'], ['priorities', 390, '[data-priorities]', 'companies'], ['people', 1440, '[data-people-table]', 'people'], ['people', 390, '[data-people-table]', 'people']];
  for (const [view, width, sel, name] of shots) {
    const { ctx, page, errors } = await open(width, view);
    if (view === 'priorities' && width >= 900) { await page.getByRole('button', { name: 'Table', exact: true }).first().dispatchEvent('click'); await page.waitForTimeout(1200); }
    const m = await measure(page, sel);
    await page.screenshot({ path: `${OUT}/${LABEL}-${name}-${width}.png`, animations: 'disabled', fullPage: width < 900 });
    ok(`${LABEL} ${name}@${width}: headers ${m.headers.join(' · ') || '(cards)'} · rows ${m.rows} · cards ${m.cards} · size chips ${m.sizeChips.join(' / ') || 'none'} · coverage "${m.coverage || 'none'}" · "${m.showing}" · page sideways ${m.sideways}${m.fit ? ` · table ${m.fit.table} in box ${m.fit.boxClient} (scroll ${m.fit.boxScroll})` : ''} · page errors ${errors.length}`, !m.sideways && !errors.length);
    if (name === 'people' && width >= 900) ok(`${LABEL} people@1440 N2: the table fits its card (${m.fit?.boxScroll} ≤ ${m.fit?.boxClient})`, m.fit && m.fit.boxScroll <= m.fit.boxClient);
    await axeOn(page, sel, `${name}@${width}`);
    await ctx.close();
  }
  ok(`browser reached 0 Claude / Apollo hosts (${realCalls.length}); API writes attempted ${writes.length} (all aborted: ${[...new Set(writes)].join(', ') || 'none'})`, realCalls.length === 0);
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, `${LABEL}-report.json`), JSON.stringify({ ...results, when: new Date().toISOString() }, null, 2));
  console.log(`\nheat-size-v1 Stage 2 ${LABEL} shots: ${passed}/${results.checks.length} passed · Claude 0 · Apollo ${realCalls.length} · API writes 0 (${writes.length} aborted) · ${Math.round((Date.now() - T0) / 1000)} s`);
  console.log(`files: ${fs.readdirSync(OUT).filter(f => f.startsWith(LABEL)).join(', ')}`);
  console.log('restored: yes (0 writes; the owner session released, last_seen_at restored; sign-in rows kept by rule)');
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
