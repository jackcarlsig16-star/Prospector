// FIX pipeline-type-pills-v1 bar 4. TEMP data: 1 workspace + 1 temp owner, torn down via tempGuard. HomeLover: READ-ONLY - its
// board rows are loaded once through the real route function with the service key and served into the temp page by route
// intercept (no HomeLover request leaves the page). 0 Apollo (sync/apollo aborted), 0 Claude, 0 writes (HomeLover counts
// before/after). Checks: every row wears a Type pill with a word; partners show their family label + hue; an employer pill
// differs; sorting Type groups partners by type; shots 1440 (mixed types + employer) and 390; Weekly report PDF prints;
// bundle marker. Serves build/ (run npm run build first). Usage: node scripts/verify/pipeline-type-pills-v1.mjs <outdir>  ~2 min, cap 200 s.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const OUT = process.argv[2] || path.join(ROOT, 'build', 'verify-shots');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3976;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const NAME = 'ZZ Type Pills Temp';
const WATCH = ['businesses', 'business_members', 'profiles', 'auth_events'];
const HL = ['sales_goals', 'sales_opportunities', 'sales_targets', 'sales_partner_events', 'sales_opportunity_events', 'business_members'];
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const counts = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true })).count; return o; };
const hlCounts = async () => { const o = {}; for (const t of HL) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HOMELOVER)).count; return o; };
let srv, browser, B, users = [], pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  if (B) { await svc.from('auth_events').delete().eq('business_id', B); await svc.from('business_members').delete().eq('business_id', B); await svc.from('businesses').delete().eq('id', B); B = null; }
  for (const u of users) { await svc.from('auth_events').delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('actor_id', u.id); await svc.auth.admin.deleteUser(u.id); }
  users = [];
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 200000 });
const fake = () => { const r = { body: null, status() { return this; }, json(b) { r.body = b; } }; return r; };

const before = await counts(); const hlBefore = await hlCounts();
console.log('counts before', JSON.stringify(before)); console.log('HomeLover before', JSON.stringify(hlBefore));
fs.mkdirSync(OUT, { recursive: true });
const errsAll = [];
try {
  const js = fs.readdirSync(path.join(ROOT, 'build/static/js')).filter(f => /^main\..*\.js$/.test(f)).map(f => fs.readFileSync(path.join(ROOT, 'build/static/js', f), 'utf8')).join('');
  ok('bundle marker: data-type-chip + "Brokers & PEOs" in build/', js.includes('data-type-chip') && js.includes('Brokers & PEOs'));

  const { pipelineBoardRoute } = await import(ROOT + '/api/sales/pipelineBoard.js');
  const r1 = fake(); await pipelineBoardRoute({ params: { businessId: HOMELOVER }, query: {} }, r1);
  const rows = r1.body.rows;
  console.log(`HomeLover board (read-only): ${rows.length} rows · partners ${rows.filter(r => r.type === 'partner').length} · employers ${rows.filter(r => r.type === 'employer').length} · targets ${rows.filter(r => r.type === 'target').length}`);

  const tag = 'tp1-' + Date.now();
  B = ins(await svc.from('businesses').insert({ name: NAME, website_url: 'https://pills.example.com', color: '#6F8CF0', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
  const email = `${tag}-owner@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
  const { data: u, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(error.message);
  await svc.from('profiles').update({ display_name: 'Owner Test', welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
  ins(await svc.from('business_members').insert({ business_id: B, email, name: 'Owner Test', user_id: u.user.id, role: 'owner' }).select());
  const anon = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: s, error: sErr } = await anon.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(sErr.message);
  const owner = { id: u.user.id, session: s.session }; users.push(owner);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();

  async function newPage({ width = 1440, height = 900 } = {}) {
    const errs = [];
    const page = await (await browser.newContext({ viewport: { width, height } })).newPage(); page.setDefaultTimeout(10000);
    page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
    await page.addInitScript(([k, v]) => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session)]);
    await page.addInitScript(() => { window.__prints = 0; window.print = () => { window.__prints++; }; });
    await page.route(/\/api\/sales\/[^/]+\/goals\/pipeline-board(\?|$)/, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows }) }));
    await page.route(/\/api\/sales\/[^/]+\/opportunities(\?|$)/, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ opportunities: [] }) }));
    await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)/, route => route.abort());
    await page.goto(`http://localhost:${PORT}/?tab=pipeline&view=board`);
    await page.locator('#main-content').getByText(NAME).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(1000);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').selectOption({ label: NAME }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Goals & Sales', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2000);
    await page.locator('#workspace-header-tabs').getByRole('button', { name: /^Pipeline/ }).first().click(); await page.waitForTimeout(2200);
    await page.locator('tr[data-row], li[data-row]').first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(600);
    return { page, errs };
  }
  const pills = page => page.evaluate(() => [...document.querySelectorAll('[data-row] [data-type-chip]')].map(c => ({ id: c.dataset.typeChip, text: c.textContent.trim(), color: getComputedStyle(c).color, border: getComputedStyle(c).borderTopColor, bg: getComputedStyle(c).backgroundColor, title: c.title })));

  // ── 1440 ──
  { const { page, errs } = await newPage();
    const rendered = await page.locator('tr[data-row]').count();
    const p = await pills(page);
    ok(`every rendered row wears a Type pill with a word (${rendered} rows)`, rendered > 0 && p.length === rendered && p.every(x => x.text.length >= 5));
    const kinds = new Set(p.map(x => x.id));
    const partnerPills = p.filter(x => !['employer', 'target', 'apollo'].includes(x.id)), emp = p.find(x => x.id === 'employer');
    console.log('pill kinds on screen:', [...kinds].join(', '), '· sample:', JSON.stringify(p.slice(0, 4)));
    ok('partners show their family label in a hue that is not the employer hue; employer pill reads "Employer" in the accent', partnerPills.length > 0 && !!emp && emp.text === 'Employer' && partnerPills.every(x => x.color !== emp.color) && new Set(partnerPills.map(x => x.color)).size >= 2, `families ${JSON.stringify([...new Set(partnerPills.map(x => x.text))])}`);
    ok('Current keeps its ★ and every partner pill carries " · partner" on hover', partnerPills.every(x => / · partner$/.test(x.title)) && partnerPills.filter(x => x.id === 'current').every(x => x.text.startsWith('★')));
    ok('target / Apollo pills are outlined (transparent background)', p.filter(x => x.id === 'target' || x.id === 'apollo').every(x => x.bg === 'rgba(0, 0, 0, 0)'));
    const typeHead = await page.evaluate(() => { const th = [...document.querySelectorAll('th')].find(t => /^Type/.test(t.textContent)); return th ? Math.round(th.getBoundingClientRect().width) : null; });
    ok(`Type column is 124 wide (${typeHead})`, typeHead === 124);
    // Frame a band that mixes partner types with an employer: the first employer row, scrolled to mid-box.
    await page.locator('tr[data-row]').filter({ has: page.locator('[data-type-chip="employer"]') }).first().evaluate(tr => { const box = tr.closest('.ui-table-box'); box.scrollTop = Math.max(0, tr.offsetTop - box.clientHeight / 2); });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/type-pills-1440.png`, animations: 'disabled' });
    // Sort by Type: inside each band the partners come first, grouped by family, then employers, targets.
    await page.locator('th button', { hasText: /^Type/ }).first().click(); await page.waitForTimeout(600);
    const bands = await page.evaluate(() => {
      const out = []; let cur = null;
      for (const tr of document.querySelectorAll('tbody tr')) { if (tr.classList.contains('ui-table__group')) { cur = []; out.push(cur); continue; } const c = tr.querySelector('[data-type-chip]'); if (cur && c) cur.push(c.dataset.typeChip); }
      return out.filter(b => b.length > 1);
    });
    const rank = id => (['employer', 'target', 'apollo'].includes(id) ? { employer: 10, target: 11, apollo: 12 }[id] : ['current', 'platforms', 'brokers', 'renters', 'influence', 'professional', 'partner'].indexOf(id));
    const grouped = bands.every(b => b.every((id, i) => i === 0 || rank(b[i - 1]) <= rank(id)));
    ok(`sorting Type groups partners by type inside every band (${bands.length} bands checked)`, bands.length > 0 && grouped, JSON.stringify(bands.map(b => b.join('>')).slice(0, 2)));
    await page.screenshot({ path: `${OUT}/type-pills-1440-sorted.png`, animations: 'disabled' });
    // Quick panel header wears the same pill.
    const partnerRow = page.locator('tr[data-row]').filter({ has: page.locator('[data-type-chip="brokers"], [data-type-chip="platforms"], [data-type-chip="current"]') }).first();
    const famId = await partnerRow.locator('[data-type-chip]').getAttribute('data-type-chip');
    await partnerRow.locator('td.ui-table__sticky button').click(); await page.waitForTimeout(1200);
    const panelPill = page.locator('aside [data-type-chip], [role="dialog"] [data-type-chip]').first();
    ok(`partner quick panel header shows the same pill (${famId})`, (await panelPill.count()) === 1 && (await panelPill.getAttribute('data-type-chip')) === famId);
    await page.screenshot({ path: `${OUT}/type-pills-quick-panel-1440.png`, animations: 'disabled' });
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    // Print path.
    await page.locator('#workspace-header-tabs').getByRole('button', { name: /^Reports/ }).first().click(); await page.waitForTimeout(1500);
    await page.locator('.ui-seg').getByRole('button', { name: 'Scorecard', exact: true }).first().click(); await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Export', exact: true }).click(); await page.waitForTimeout(300);
    await page.getByRole('menuitem', { name: 'Weekly report PDF' }).click(); await page.waitForTimeout(1200);
    ok('Export › Weekly report PDF prints once with one print area', (await page.evaluate(() => window.__prints)) === 1 && (await page.locator('#sales-analytics-print-area').count()) === 1);
    errsAll.push(...errs.map(e => '1440: ' + e)); await page.context().close(); }
  // ── 390 ──
  { const { page, errs } = await newPage({ width: 390, height: 844 });
    const p = await pills(page);
    const items = await page.locator('li[data-row]').count();
    ok(`390: the phone list rows wear the pill (${items} rows), no sideways scroll`, items > 0 && p.length === items && (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)));
    await page.locator('li[data-row]').filter({ has: page.locator('[data-type-chip="employer"]') }).first().evaluate(li => li.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/type-pills-390.png`, animations: 'disabled' });
    errsAll.push(...errs.map(e => '390: ' + e)); await page.context().close(); }
  ok('no page errors', errsAll.length === 0, errsAll.join(' | '));
} catch (e) {
  console.log('ERROR', e.message);
} finally {
  await cleanup();
  const after = await counts(); const hlAfter = await hlCounts();
  const same = JSON.stringify(before) === JSON.stringify(after), hlSame = JSON.stringify(hlBefore) === JSON.stringify(hlAfter);
  console.log('counts after ', JSON.stringify(after));
  console.log(`${pass}/${total} passed · temp rows removed: ${same ? 'yes' : 'NO'} · HomeLover unchanged: ${hlSame ? 'yes' : 'NO'}`);
  console.log(`restored: ${same && hlSame ? 'yes' : 'NO'}`);
  process.exit(pass === total && same && hlSame ? 0 : 1);
}
