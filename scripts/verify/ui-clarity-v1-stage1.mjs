// ui-clarity-v1 Stage 1 - the /kit contrast check (before and after), with the Weekly report print check.
// SCOPE (declared): TEMP data only - 1 workspace (goals_sales on, added to SALES_ANALYTICS_BUSINESS_IDS for the local
// server only) + 1 temp owner user ("Jack Test"), ~4 rows (businesses, business_members, profiles, auth user). No
// sales fixture: /kit is static and the print check only needs the Dashboard to mount. HomeLover never written. 0 Apollo
// (sync / apollo / visit-pull routes aborted in the browser), 0 Claude. Runtime ~1 min, hard cap 170 s (tempGuard),
// teardown deletes everything. Shots: uic1-<phase>-kit-{1440,390}.png + uic1-<phase>-kit-print.png into
// .screenshots/ui-clarity-v1 (gitignored; NOT build/verify-shots - `npm run build` empties build/).
// Usage: node scripts/verify/ui-clarity-v1-stage1.mjs --phase before|after [outdir]   (run npm run build first)
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const { measureScript, summarize, formatWorst } = require(ROOT + '/scripts/verify/lib/contrastMeasure.cjs');
const args = process.argv.slice(2);
const PHASE = args[args.indexOf('--phase') + 1] || 'after';
if (!['before', 'after'].includes(PHASE)) { console.log('--phase before|after'); process.exit(1); }
const OUT = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--phase') || path.join(ROOT, '.screenshots', 'ui-clarity-v1');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3981;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const NAME = 'ZZ UI Clarity Stage1';
const HL = ['sales_week_goals', 'sales_signals', 'sales_targets', 'sales_goals', 'sales_opportunities', 'web_visits', 'sales_week_report', 'sales_prospect_state'];
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const hlCounts = async () => { const o = {}; for (const t of HL) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HOMELOVER)).count; return o; };
let srv, browser, B, users = [];
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  if (B) { for (const t of ['auth_events', 'business_members']) await svc.from(t).delete().eq('business_id', B); await svc.from('businesses').delete().eq('id', B); }
  for (const u of users) { await svc.from('auth_events').delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('actor_id', u.id); await svc.auth.admin.deleteUser(u.id); }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 170000 });
fs.mkdirSync(OUT, { recursive: true });
const hlBefore = await hlCounts();
const results = { phase: PHASE, screens: {}, print: null, errors: [] };
const P = `uic1-${PHASE}`;

try {
  const tag = 'uic1-' + Date.now();
  B = ins(await svc.from('businesses').insert({ name: NAME, website_url: 'https://uic1.example.com', color: '#6F8CF0', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
  const email = `${tag}-jack-test@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
  const { data: u, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(error.message);
  users.push({ id: u.user.id });
  await svc.from('profiles').update({ display_name: 'Jack Test', welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
  ins(await svc.from('business_members').insert({ business_id: B, email, name: 'Jack Test', user_id: u.user.id, role: 'owner' }).select());
  const anon = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: s, error: sErr } = await anon.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(sErr.message);
  log('temp workspace in');

  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();

  async function newPage({ width = 1440, height = 900 } = {}) {
    const errs = [];
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
    page.on('dialog', d => d.accept());
    await page.addInitScript(([k, v]) => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(s.session)]);
    await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)|\/goals\/visits\/pull|\/goals\/tidy\/run/, route => route.abort());
    await page.goto(`http://localhost:${PORT}/`);
    await page.locator('#main-content').getByText(NAME).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(600);
    return { page, errs, compact: width < 900 };
  }
  const openMenu = async (page, compact) => { if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); } };
  const shot = (page, n, full) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide', fullPage: full });
  const KIT = measureScript({ scope: '[data-ui-gallery]', exclude: '[data-before]' });
  const BEFORE_COL = measureScript({ scope: '[data-theme-panel="roles"]', exclude: '[data-after]' });

  for (const width of [1440, 390]) {
    const { page, errs, compact } = await newPage({ width, height: width === 390 ? 844 : 900 });
    await openMenu(page, compact);
    await page.getByRole('button', { name: /^My profile/ }).first().click(); await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'UI kit' }).first().click();
    await page.locator('[data-ui-gallery]').waitFor({ timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await shot(page, `${P}-kit-${width}`, true);
    const m = await page.evaluate(KIT);
    if (m.error) results.errors.push(`kit@${width}: ${m.error}`);
    else {
      const sum = summarize(m);
      results.screens[`kit@${width}`] = sum;
      log(`kit@${width}`, `text ${sum.textFails}/${sum.texts} (<4.5)`, `controls ${sum.controlFails}/${sum.controls} (<3, ${sum.controlFailsTextOnly} text-only)`, 'per panel', JSON.stringify(sum.perPanel), `scroll ${m.scrollW}/${m.vw}`);
    }
    if (await page.locator('[data-before]').count()) {
      const mb = await page.evaluate(BEFORE_COL);
      if (!mb.error) { const sb = summarize(mb); results.screens[`before-column@${width}`] = sb; log(`before-column@${width} (excluded from the bar, shown for comparison)`, `text ${sb.textFails}/${sb.texts}`, `controls ${sb.controlFails}/${sb.controls}`); }
    }
    if (errs.length) results.errors.push(...errs.map(e => `${width}: ${e}`));
    await page.context().close();
  }

  // Weekly report PDF: the Dashboard under print media must resolve the light print palette.
  {
    const { page, errs } = await newPage({ width: 1440, height: 900 });
    await page.getByLabel('Workspace').selectOption({ label: NAME }); await page.waitForTimeout(1200);
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    await page.locator('#sales-analytics-root').waitFor({ timeout: 20000 });
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(500);
    results.print = await page.evaluate(() => {
      const root = document.getElementById('sales-analytics-root'); const cs = getComputedStyle(root);
      return { ground: cs.getPropertyValue('--sa-ground').trim(), text: cs.getPropertyValue('--sa-text').trim(), border: cs.getPropertyValue('--sa-border').trim(), bg: cs.backgroundColor, color: cs.color };
    });
    await shot(page, `${P}-kit-print`, false);
    await page.emulateMedia({ media: 'screen' });
    log('print', JSON.stringify(results.print));
    if (errs.length) results.errors.push(...errs.map(e => `print: ${e}`));
    await page.context().close();
  }
} catch (e) {
  results.errors.push('THROW ' + (e.stack?.split('\n').slice(0, 3).join(' | ') || e.message));
  log('THROW', e.message);
} finally {
  await cleanup();
  const left = B ? (await svc.from('businesses').select('id', { count: 'exact', head: true }).eq('id', B)).count : 0;
  const hlAfter = await hlCounts();
  const diff = Object.keys(hlBefore).filter(k => hlBefore[k] !== hlAfter[k]);
  results.restored = { workspaceLeft: left, homeloverDiff: diff.map(k => `${k} ${hlBefore[k]}->${hlAfter[k]}`), usersDeleted: users.length };
  fs.writeFileSync(`${OUT}/${P}-contrast.json`, JSON.stringify(results, null, 2));
  const lines = [`ui-clarity-v1 Stage 1 - /kit contrast (${PHASE}, ${new Date().toISOString().slice(0, 10)}, temp workspace, 0 Apollo, 0 Claude)`, ''];
  for (const [k, s] of Object.entries(results.screens)) lines.push(`${k.padEnd(22)} text ${String(s.textFails).padStart(3)}/${String(s.texts).padEnd(4)} controls ${String(s.controlFails).padStart(3)}/${String(s.controls).padEnd(4)} text-only ${s.controlFailsTextOnly} · disabled ${s.controlFailsDisabled + s.textFailsDisabled} · panels ${Object.entries(s.perPanel).map(([p, v]) => `${p} ${v.textFails}+${v.controlFails}`).join(', ')}`);
  lines.push('', `print: ${JSON.stringify(results.print)}`, '');
  for (const [k, s] of Object.entries(results.screens)) lines.push(formatWorst(k, s), '');
  if (results.errors.length) lines.push('errors:', ...results.errors.map(e => '  ' + e));
  fs.writeFileSync(`${OUT}/${P}-report.txt`, lines.join('\n'));
  console.log(lines.join('\n'));
  console.log(`\nworkspace left ${left} · HomeLover diff ${diff.length ? diff.join(', ') : 'none'} · errors ${results.errors.length} · restored: ${left === 0 && !diff.length ? 'yes' : 'NO'}`);
  process.exit(0);
}
