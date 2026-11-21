// fathom-notes-v1 follow-up (ruling S-1) - the one Connections page with the Fathom card, on localhost as Jack
// (ownerSession), the REAL HomeLover workspace. DECLARED: 0 Claude, 0 Apollo, 0 Fathom (the card calls Fathom only on a
// button; no button is pressed), 0 writes (every non-GET is aborted in the browser; ownerSession's sign-in row is kept
// by rule, last_seen_at restored). 4 page loads; est. 40 s; cap 150 s. PNGs: .screenshots/fathom-notes-v1/s1/.
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
const OUT = path.join(ROOT, '.screenshots', 'fathom-notes-v1', 's1');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 3997, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0], SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data[0].id;
const T0 = Date.now();
const checks = [];
const ok = (name, pass, detail = '') => { checks.push(!!pass); console.log(`[${Math.round((Date.now() - T0) / 1000)}s] ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${String(detail).slice(0, 400)}` : ''}`); };
let srv, owner, browser;
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(async () => { if (browser) await browser.close().catch(() => {}); if (srv) srv.kill(); if (owner) console.log(await owner.release()); }, { capMs: 150000 });
try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', APOLLO_API_KEY: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const blocked = [];
  for (const width of [1440, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 }, hasTouch: width < 900 });
    await ctx.addInitScript(([k, v, bz, dd]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, dd);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today]);
    await ctx.route('**/*', route => {
      const req = route.request(); const u = new URL(req.url());
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return route.continue();
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      const write = (isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname)) || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (write) { blocked.push(`${req.method()} ${u.pathname}`); return route.abort(); }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(25000);
    await page.goto(`${BASE}/`);
    if (width < 900) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByRole('button', { name: /Jack Carlson/ }).first().click();
    await page.getByRole('menuitem', { name: /Connections/ }).or(page.getByRole('button', { name: /^Connections/ })).first().click();
    await page.waitForSelector('[data-provider="fathom"] [data-fathom-card]');
    await page.waitForTimeout(800);
    const order = await page.evaluate(() => [...document.querySelectorAll('[data-provider]')].map(n => n.dataset.provider));
    ok(`Connections @ ${width}: the cards in order ${order.join(' · ')}`, order.join() === 'google,microsoft,apollo,fathom');
    const text = (await page.locator('[data-fathom-card]').innerText()).replace(/\s+/g, ' ');
    ok(`Connections @ ${width}: the Fathom card is the same card (heading, the calls-read line, no address)`, /^Fathom Every recorded call lands here/.test(text) && !/@/.test(text), text.slice(0, 160));
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async () => (await window.axe.run({ include: [['[data-provider="fathom"]']] }, { resultTypes: ['violations'] })).violations.map(x => ({ id: x.id, nodes: x.nodes.length, target: x.nodes[0]?.target?.join(' ') })));
    const n2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(`Connections @ ${width}: axe 0 on the card · N2 0 px`, v.length === 0 && n2 <= 0, v.length || n2 > 0 ? JSON.stringify({ axe: v, n2 }) : '');
    await page.screenshot({ path: path.join(OUT, `connections-${width}.png`), fullPage: true });
    await page.goto(`${BASE}/?tab=settings&view=connections&business=${HL}`);
    await page.locator('#sales-analytics-root').getByText('Team emails').first().waitFor({ timeout: 25000 });
    await page.waitForTimeout(800);
    ok(`Sales › Settings @ ${width}: no Connections sub-view; an old link lands on Team emails`, (await page.locator('[data-fathom-card]').count()) === 0 && new URL(page.url()).searchParams.get('view') !== 'connections' && (await page.locator('#sales-analytics-root').getByRole('button', { name: /^Connections/ }).count()) === 0);
    await page.screenshot({ path: path.join(OUT, `settings-${width}.png`), fullPage: false });
    await ctx.close();
  }
  ok(`the browser wrote nothing (${blocked.length} non-GET aborted)`, true);
} catch (e) { ok(`run error: ${e.message}`, false); }
finally { await cleanup(); console.log(`\n${checks.filter(Boolean).length}/${checks.length} checks passed · restored: yes (no write; sign-in row kept by rule)`); process.exit(checks.every(Boolean) ? 0 : 1); }
