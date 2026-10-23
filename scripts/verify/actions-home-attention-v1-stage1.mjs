// actions-home-attention-v1 Stage 1 (D1) - where a workspace opens. A goals_sales workspace lands on Sales & Marketing ›
// Actions by every landing path (Workspace picker, the businesses gallery card, an invite's /?business=<id>), even when
// this browser last left Sales on Pipeline, and has no Command Center in its side panel; a workspace without goals_sales
// still opens on Command Center with Command Center first. Clicking Sales & Marketing in the side panel keeps the
// remembered tab (only landing resets it).
// SCOPE (declared): TEMP data only - 2 workspaces (one goals_sales, added to SALES_ANALYTICS_BUSINESS_IDS for the local
// server only; one plain) + 1 temp owner in both; no other rows. Made-up names; no emails or phones. HomeLover never
// written (counts compared). 0 Apollo / 0 Claude: sync / apollo / visit-pull / tidy / research / anthropic routes are
// aborted in the browser and the page-load pull + Tidy are marked done; research_runs, visit_pull_runs, sales_sync_runs,
// sales_tidy_runs counted for both. 1440. Runtime ~1 min, hard cap 150 s (tempGuard). Shots + report:
// .screenshots/actions-home-attention-v1/. Usage: node scripts/verify/actions-home-attention-v1-stage1.mjs [outdir]
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const OUT = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(ROOT, '.screenshots', 'actions-home-attention-v1');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3987;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const SALES = 'ZZ Home Sales WS', PLAIN = 'ZZ Home Plain WS';
const HL = ['sales_week_goals', 'sales_tidy_runs', 'visit_pull_runs', 'sales_sync_runs'];
const RUNS = ['research_runs', 'visit_pull_runs', 'sales_sync_runs', 'sales_tidy_runs'];
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const count = async (t, col, v) => (await svc.from(t).select('*', { count: 'exact', head: true }).eq(col, v)).count;
const hlCounts = async () => { const o = {}; for (const t of HL) o[t] = await count(t, 'business_id', HOMELOVER); return o; };
let srv, browser, ids = [], users = [];
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  for (const b of ids) { for (const t of [...RUNS, 'auth_events', 'business_members']) await svc.from(t).delete().eq('business_id', b); await svc.from('businesses').delete().eq('id', b); }
  for (const u of users) { await svc.from('auth_events').delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('actor_id', u.id); await svc.auth.admin.deleteUser(u.id); }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 150000 });
const laToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
fs.mkdirSync(OUT, { recursive: true });
const hlBefore = await hlCounts();
const results = { checks: [], errors: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${detail}` : ''); };

try {
  const tag = 'ahome-' + Date.now();
  const mk = (name, features) => svc.from('businesses').insert({ name, website_url: 'https://ahome.example.com', color: '#6F8CF0', owner_email: `${tag}-owner@example.com`, access_code: `${tag}-${name.length}${features.goals_sales ? 's' : 'p'}`, features }).select('id').single();
  const S = ins(await mk(SALES, { goals_sales: true })).id; ids.push(S);
  const P = ins(await mk(PLAIN, {})).id; ids.push(P);
  const email = `${tag}-jack-test@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
  const { data: u, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(error.message);
  users.push({ id: u.user.id });
  await svc.from('profiles').update({ display_name: 'Jack Test', welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
  ins(await svc.from('business_members').insert([S, P].map(b => ({ business_id: b, email, name: 'Jack Test', user_id: u.user.id, role: 'owner' }))).select());
  const anon = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: s, error: sErr } = await anon.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(sErr.message);
  const today = laToday();
  log('fixture in');

  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${S}` }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  const blocked = [];
  const errs = [];
  // salesTab: what this browser last left Sales & Marketing on (prospector_sales_tab).
  async function newPage(url = '/', salesTab = 'pipeline') {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
    await page.addInitScript(([k, v, bs, dd, tab]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      // actions-v2 REV2: Actions opens on the signed-in person with Housekeeping folded; these checks read the whole team, unfolded.
      localStorage.setItem('prospector_goals_owner', 'team'); localStorage.setItem('prospector_actions_folded', '[]');
      for (const b of bs) { localStorage.setItem(`prospector_visits_ran_${b}`, dd); localStorage.setItem(`prospector_tidy_ran_${b}`, dd); }
      localStorage.setItem('prospector_sales_tab', tab);
    }, [`sb-${REF}-auth-token`, JSON.stringify(s.session), [S, P], today, salesTab]);
    await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)|\/goals\/visits\/pull|\/goals\/tidy\/run|\/research\/run|\/research$|\/proxy\/anthropic/, route => { blocked.push(route.request().url()); route.abort(); });
    await page.goto(`http://localhost:${PORT}${url}`);
    await page.locator('#main-content').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(2500);
    return page;
  }
  const state = page => page.evaluate(() => ({
    side: [...document.querySelectorAll('#root button')].filter(b => !b.closest('#main-content, #workspace-header-tabs, [data-workspace-header]')).map(b => b.textContent.trim()).filter(t => ['Command Center', 'Sales & Marketing', 'Accounts', 'Projects', 'Business Intel & Strategy', 'Ideas', 'Tools'].some(x => t.endsWith(x))).map(t => ['Command Center', 'Sales & Marketing', 'Accounts', 'Projects', 'Business Intel & Strategy', 'Ideas', 'Tools'].find(x => t.endsWith(x))),
    tab: document.querySelector('#workspace-header-tabs button[aria-current="page"]')?.textContent.trim() || null,
    actions: !!document.querySelector('[data-actions]'),
    commandCenter: /Command Center/.test(document.querySelector('#main-content')?.innerText || '') && !document.querySelector('[data-actions]'),
  }));
  const isHome = st => st.tab?.startsWith('Actions') && st.actions && !st.side.includes('Command Center') && st.side[0] === 'Sales & Marketing';
  const isPlain = st => !st.tab && !st.actions && st.side[0] === 'Command Center' && !st.side.includes('Sales & Marketing');
  const pick = async (page, name) => { await page.getByLabel('Workspace').selectOption({ label: name }); await page.waitForTimeout(3000); };

  // 1. Workspace picker (selectBusiness), with Pipeline remembered.
  let page = await newPage();
  await pick(page, SALES);
  let st = await state(page);
  await page.screenshot({ path: `${OUT}/s1-home-actions-1440.png` });
  ok('picker -> goals_sales workspace: Sales & Marketing › Actions (Pipeline was remembered); no Command Center in the side panel', isHome(st), JSON.stringify(st));
  await page.locator('#root').getByRole('button', { name: 'Accounts', exact: true }).dispatchEvent('click'); await page.waitForTimeout(1500);
  await page.locator('#workspace-header-tabs, #root').getByRole('button', { name: 'Sales & Marketing', exact: true }).first().dispatchEvent('click'); await page.waitForTimeout(2000);
  await page.locator('#workspace-header-tabs').getByRole('button', { name: /^Pipeline/ }).dispatchEvent('click'); await page.waitForTimeout(1500);
  await page.locator('#root').getByRole('button', { name: 'Accounts', exact: true }).dispatchEvent('click'); await page.waitForTimeout(1500);
  await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).first().dispatchEvent('click'); await page.waitForTimeout(2000);
  st = await state(page);
  ok('the side panel\'s Sales & Marketing keeps the remembered tab (Pipeline) - only landing resets to Actions', st.tab?.startsWith('Pipeline'), JSON.stringify(st));
  await pick(page, PLAIN);
  st = await state(page);
  await page.screenshot({ path: `${OUT}/s1-plain-command-center-1440.png` });
  ok('picker -> workspace without goals_sales: Command Center, first in the side panel; no Sales & Marketing', isPlain(st), JSON.stringify(st));
  await pick(page, SALES);
  ok('picker back to the goals_sales workspace: Actions again', isHome(await state(page)));
  await page.context().close();

  // 2. Invite landing /?business=<id>.
  page = await newPage(`/?business=${S}`);
  st = await state(page);
  ok('invite /?business=<goals_sales id>: lands on Actions, no Command Center', isHome(st), JSON.stringify(st));
  await page.context().close();
  page = await newPage(`/?business=${P}`);
  st = await state(page);
  ok('invite /?business=<plain id>: lands on Command Center', isPlain(st), JSON.stringify(st));
  await page.context().close();

  // 3. The businesses gallery card.
  page = await newPage('/');
  const card = page.locator('[data-workspace-card]').filter({ hasText: SALES });
  if (!(await card.count())) { await page.locator('#root').getByRole('button', { name: /Businesses|All businesses|Workspaces/ }).first().click().catch(() => {}); await page.waitForTimeout(1500); }
  const n = await card.count();
  if (n) { await card.first().click(); await page.waitForTimeout(3000); }
  st = await state(page);
  ok('businesses gallery card -> goals_sales workspace: Actions', n > 0 && isHome(st), JSON.stringify({ cards: n, ...st }));
  await page.context().close();

  if (errs.length) results.errors.push(...errs);
  const calls = {}; for (const t of RUNS) calls[t] = (await count(t, 'business_id', S)) + (await count(t, 'business_id', P));
  ok('0 Claude / 0 Apollo: no research / visit-pull / sync / Tidy run rows in either workspace', Object.values(calls).every(v => !v), JSON.stringify({ ...calls, blocked: blocked.length }));
} catch (e) {
  results.errors.push('THROW ' + (e.stack?.split('\n').slice(0, 3).join(' | ') || e.message));
  log('THROW', e.message);
} finally {
  await cleanup();
  let left = 0; for (const b of ids) left += await count('businesses', 'id', b);
  const hlAfter = await hlCounts();
  const diff = Object.keys(hlBefore).filter(k => hlBefore[k] !== hlAfter[k]);
  const lines = [`actions-home-attention-v1 Stage 1 - landing (${new Date().toISOString().slice(0, 10)}, temp workspaces, 0 Apollo, 0 Claude)`, ''];
  for (const c of results.checks) lines.push(`${c.pass ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` - ${c.detail}` : ''}`);
  if (results.errors.length) lines.push('', 'errors:', ...results.errors.map(e => '  ' + e));
  fs.writeFileSync(`${OUT}/s1-report.txt`, lines.join('\n'));
  console.log(lines.join('\n'));
  const pass = results.checks.filter(c => c.pass).length;
  console.log(`\nchecks ${pass}/${results.checks.length} · workspaces left ${left} · HomeLover diff ${diff.length ? diff.join(', ') + ' (check who wrote it)' : 'none'} · errors ${results.errors.length} · restored: ${left === 0 && !diff.length ? 'yes' : 'NO'}`);
  process.exit(0);
}
