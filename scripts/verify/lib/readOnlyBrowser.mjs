// A read-only browser on localhost as the platform owner, on the real sales workspace: a local server (schedulers off,
// no Apollo key), ownerSession's one-time session, and a context whose every write is aborted in the browser (every
// non-GET to /api or /proxy, every non-auth non-GET to Supabase, every third-party host but the font CDN). The
// page-load pull / tidy / sync keys are pre-set to today so no page load starts one.
// allowPost / allowPut: the exact local paths a run declared it will write through (everything else stays refused).
//   const h = await readOnlyBrowser({ port, capMs });  h.context(width, { viewer }) -> ctx;  h.blocked;  await h.close()
import { createRequire } from 'module';
import path from 'path';
import { spawn } from 'child_process';
import { ownerSession } from './ownerSession.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');

export async function readOnlyBrowser({ port = 3996, capMs = 230000, allowPost = [], allowPut = [] } = {}) {
  const BASE = `http://localhost:${port}`;
  const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0], SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
  const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const { data: sales } = await svc.from('businesses').select('id, name, features').order('created_at');
  const workspace = sales.find(b => b.features?.goals_sales);
  let srv, owner, browser;
  const blocked = [];
  const close = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(async () => { if (browser) await browser.close().catch(() => {}); if (srv) srv.kill(); if (owner) console.log(await owner.release()); }, { capMs });
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', APOLLO_API_KEY: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 80; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  async function context(width, { height = width < 900 ? 844 : 900, storage = {} } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: width < 900 });
    await ctx.addInitScript(([k, v, bz, dd, extra]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, dd);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
      for (const [a, b] of Object.entries(extra)) localStorage.setItem(a, b);
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), workspace.id, today, storage]);
    await ctx.route('**/*', route => {
      const req = route.request(); const u = new URL(req.url());
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return route.continue();
      const isLocal = u.host === `localhost:${port}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      const allowed = isLocal && (allowPost.some(p => req.method() === 'POST' && u.pathname === p) || allowPut.some(p => req.method() === 'PUT' && u.pathname === p));
      const write = !allowed && ((isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname)) || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont));
      if (write) { blocked.push(`${req.method()} ${u.host === `localhost:${port}` ? '' : u.host}${u.pathname}`); return route.abort(); }
      return route.continue();
    });
    return ctx;
  }
  return { ROOT, BASE, svc, workspace, owner, blocked, context, close, SUPA_HOST };
}
