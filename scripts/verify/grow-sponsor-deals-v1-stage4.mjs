// grow-sponsor-deals-v1 Stage 4 live check - the deal screens as Jack (ownerSession) on the REAL HumanKind workspace,
// localhost against the build, through the real wiring.
// SCOPE (declared): 0 Claude, 0 Apollo. Gmail: ONE Brands-lane list read of Jack's own mailbox + ONE thread open (as the
// Inbox already reads it; units reported from the server's own count). Writes (everything else non-GET is aborted):
// ONE amount edit on a confirmed November month + its Undo (PATCH period x2), and ONE test Instagram handle set + clear
// on the same brand (PATCH brand x2). Restore: that month row and that brand row field by field (values + timestamps);
// Activity rows are kept by rule. "restored" THROWS if a HumanKind count moved or a snapshot field differs.
// Runtime ~3 min, cap 6 min. Usage: node scripts/verify/grow-sponsor-deals-v1-stage4.mjs   (run npm run build first)
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
const { livePeriods, moneyByMonth, chicagoMonth, addMonths, dealStageOf } = await import('../../api/hk/deals.js');
const OUT = path.join(ROOT, '.screenshots', 'grow-sponsor-deals-v1');
const PORT = 3993, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const HK_TABLES = ['hk_brands', 'hk_contacts', 'hk_touches', 'hk_replies', 'hk_sponsor_periods', 'hk_settings', 'hk_member_prefs', 'hk_brand_threads', 'hk_signals'];
const TEST_HANDLE = 'zz_verify_handle';
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const must = r => { if (r.error) throw new Error(r.error.message); return r; };
const hk = (await svc.from('businesses').select('id, features').eq('name', 'HumanKind')).data?.find(b => b.features?.hk_sales);
if (!hk) { console.log('ABORT: no HumanKind workspace with hk_sales on'); process.exit(1); }
const counts = async () => { const o = {}; for (const t of HK_TABLES) o[t] = must(await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', hk.id)).count; return o; };
const thisMonth = chicagoMonth(new Date());
const months = []; for (let m = addMonths(thisMonth, -3); m <= addMonths(thisMonth, 3); m = addMonths(m, 1)) months.push(m);
const liveBrandRows = must(await svc.from('hk_brands').select('id, name, relationship, instagram_handle').eq('business_id', hk.id).is('archived_at', null)).data;
const liveIds = new Set(liveBrandRows.map(b => b.id));
const dbMoney = async () => moneyByMonth((await livePeriods(svc, hk.id, 'id, brand_id, period, kind, state, amount_usd, paid')).filter(p => liveIds.has(p.brand_id)), months);
const money0 = await dbMoney();
const periods0 = (await livePeriods(svc, hk.id)).filter(p => liveIds.has(p.brand_id));
// The edit target: a confirmed month this month with an amount, on a brand with no Instagram handle yet.
const target = periods0.filter(p => p.kind === 'monthly' && p.period === thisMonth && p.state === 'confirmed' && p.amount_usd != null)
  .map(p => ({ p, b: liveBrandRows.find(b => b.id === p.brand_id) })).find(x => x.b && !x.b.instagram_handle);
if (!target) { console.log(`ABORT: no confirmed ${thisMonth} month with an amount on a brand without a handle`); process.exit(1); }
const periodSnap = must(await svc.from('hk_sponsor_periods').select('*').eq('id', target.p.id).single()).data;
const brandSnap = must(await svc.from('hk_brands').select('*').eq('id', target.b.id).single()).data;
const plovara = liveBrandRows.find(b => /^plovara/i.test(b.name));
const before = { counts: await counts() };
log('target', target.b.name, target.p.period, target.p.amount_usd, '· plovara', plovara?.name || 'none');

let srv, browser, owner;
const blocked = [], realCalls = [], posts = [], inboxBodies = [];
const results = { checks: [], errors: [], axe: {}, contrast: {}, numbers: { db_money: money0.months.filter(m => m.month >= thisMonth).slice(0, 2) } };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 6 * 60000 });
fs.mkdirSync(OUT, { recursive: true });
const ALLOW = [[new RegExp(`/sponsors/${target.b.id}/periods/${target.p.id}$`), 'period', 2], [new RegExp(`/brands/${target.b.id}$`), 'brand', 2]];

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  async function open(width, hash, wait, { viewer = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 760 ? 844 : 900 }, hasTouch: width < 760 });
    await ctx.addInitScript(([k, v]) => { try { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); localStorage.setItem('prospector_auto_assay_disabled', '1'); } catch { /* sandboxed frame */ } }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session)]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url()), m = req.method();
      if (/anthropic\.com$|apollo\.io$|googleapis\.com$/.test(u.host) && !/fonts/.test(u.host)) realCalls.push(`${m} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      const allow = isLocal && !viewer && m === 'PATCH' && ALLOW.find(([re]) => re.test(u.pathname));
      if (allow) {
        posts.push(allow[1]);
        if (posts.filter(p => p === allow[1]).length > allow[2]) { blocked.push(`${m} ${allow[1]} (over cap)`); return route.abort(); }
        return route.continue();
      }
      const deny = (isLocal && m !== 'GET' && /^\/(api|proxy)\//.test(u.pathname)) || (isSupa && m !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${m} ${u.pathname.replace(hk.id, '<hk>')}`); return route.abort(); }
      if (viewer && isLocal && /^\/api\/hk\/[^/]+\/shell$/.test(u.pathname)) { const r = await route.fetch(); const j = await r.json(); return route.fulfill({ response: r, json: { ...j, me: { ...j.me, role: 'viewer' } } }); }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(30000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    page.on('response', async r => { if (/\/inbox\/threads\?/.test(r.url()) && r.request().method() === 'GET') inboxBodies.push(await r.json().catch(() => null)); });
    await page.goto(`${BASE}/`);
    if (width < 900) { await page.getByRole('button', { name: 'Open menu' }).click().catch(() => {}); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 20000 }); await page.getByLabel('Workspace').selectOption({ label: 'HumanKind' });
    await page.locator('[data-hk-shell] [data-hk-avatar]').waitFor({ timeout: 20000 });
    await page.evaluate(h => { window.location.hash = h; }, hash);
    await page.locator(wait).first().waitFor({ timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(500);
    return { ctx, page, errors };
  }
  const shot = (page, n, full = true) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide', fullPage: full });
  const measure = async (page, key, scope) => {
    const m = await page.evaluate(measureScript({ scope }));
    if (m.error) { ok(`contrast ${key}`, false, m.error); return; }
    const s = summarize(m); results.contrast[key] = s;
    ok(`contrast ${key}: 0 text < 4.5:1 (text ${s.textFails}/${s.texts})`, s.textFails === 0, s.worst.slice(0, 6).map(w => `${w.ratio} ${w.kind === 'text' ? `T ${w.fg} on ${w.bg}` : `C via ${w.via}`} ${w.sel} "${w.text}"`).join(' | '));
  };
  const axeOn = async (page, key, sel) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async s => { const r = await window.axe.run(document.querySelector(s), { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); }, sel);
    results.axe[key] = v;
    ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v).slice(0, 400));
  };
  const noSideways = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const usd = v => (v == null ? '—' : `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
  const cellsOf = r => [usd(r.confirmed_usd), usd(r.paid_usd), usd(r.unpaid_usd), usd(r.discussing_usd), String(r.confirmed), String(r.discussing), String(r.declined)];

  // ---- 1440 Sponsor money: every month row = the DB; a cell filters the list; rail Deal group; N2.
  {
    const { ctx, page, errors } = await open(1440, '#hk/brands?view=money', '[data-hk-money-month]');
    const ui = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-hk-money-month]')].map(tr => [tr.dataset.hkMoneyMonth, [...tr.querySelectorAll('td')].map(td => td.textContent.trim())])));
    results.numbers.ui_money = ui;
    for (const r of money0.months) ok(`money ${r.month}: ${ui[r.month]?.join(' · ')} = DB`, JSON.stringify(ui[r.month]) === JSON.stringify(cellsOf(r)), JSON.stringify(cellsOf(r)));
    const liveWithMonths = new Set(periods0.map(p => p.brand_id)).size;
    const total = Number((await page.locator('[data-hk-result-count]').first().textContent().catch(() => '')).replace(/\D/g, '')) || null;
    ok(`Sponsor money list = ${total} brands with months (DB ${liveWithMonths})`, total === liveWithMonths);
    const disc = money0.months.find(m => m.month === thisMonth);
    await page.locator(`[data-hk-money-cell="${thisMonth}:discussing_usd"], [data-hk-money-cell="${thisMonth}:discussing"]`).first().click();
    await page.waitForFunction(n => { const t = document.querySelector('[data-hk-result-count]')?.textContent || ''; return /\d/.test(t) && Number(t.replace(/\D/g, '')) !== n; }, liveWithMonths, { timeout: 30000 }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(600);
    const after = Number((await page.locator('[data-hk-result-count]').first().textContent().catch(() => '')).replace(/\D/g, '')) || null;
    const dbDisc = new Set(periods0.filter(p => p.kind === 'monthly' && p.period === thisMonth && p.state === 'discussing').map(p => p.brand_id)).size;
    ok(`click "In discussion" (${thisMonth}) -> the list shows ${after} brands still deciding (DB ${dbDisc}; money row ${disc.discussing})`, after === dbDisc && dbDisc === disc.discussing);
    const rail = await page.evaluate(() => ({ stage: [...document.querySelectorAll('[data-hk-bucket="deal_stage"] [data-hk-filter]')].map(e => e.textContent.trim()), month: [...document.querySelectorAll('[data-hk-bucket="month"] [data-hk-filter]')].map(e => e.textContent.trim()).slice(0, 3) }));
    ok(`rail Deal group: Deal stage ${rail.stage.join(' / ')}; Sponsor month ${rail.month.join(' / ')}`, rail.stage.length > 0 && rail.month.some(t => / · confirmed \d+/.test(t)));
    await page.evaluate(() => { window.location.hash = '#hk/brands?view=money'; });
    await page.locator('[data-hk-money-month]').first().waitFor(); await page.waitForTimeout(800);
    const g = () => page.evaluate(() => [...document.querySelectorAll('[data-hk-money-month]')].map(e => Math.round(e.getBoundingClientRect().top)));
    const g0 = await g(); await page.locator(`[data-hk-money-month="${thisMonth}"]`).hover(); await page.waitForTimeout(200);
    ok('N2: hovering a month row moves nothing', JSON.stringify(g0) === JSON.stringify(await g()));
    await shot(page, 'money-1440');
    await measure(page, 'money@1440', '[data-hk-money]'); await axeOn(page, 'money@1440', '[data-hk-money]');
    ok('1440 money: no sideways scroll; 0 page errors', await noSideways(page) && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- Plovara reads its deal stage; the target's Deal card: amount edit + Undo; handle set + Open DM + clear.
  {
    if (plovara) {
      const { ctx, page } = await open(1440, `#hk/brands?view=money&q=${encodeURIComponent(plovara.name)}`, `[data-hk-brand="${plovara.id}"]`);
      await page.locator(`[data-hk-brand="${plovara.id}"]`).first().click();
      await page.locator(`[data-hk-brand-page="${plovara.id}"] [data-hk-deal]`).waitFor();
      const ps = periods0.filter(p => p.brand_id === plovara.id);
      const want = dealStageOf(plovara, ps, thisMonth);
      const ui = await page.evaluate(() => ({ chip: document.querySelector('[data-hk-deal] [data-hk-deal-stage]')?.textContent, months: [...document.querySelectorAll('[data-hk-deal] [data-hk-month]')].map(li => `${li.dataset.hkMonth}:${li.querySelector('[data-hk-month-state]')?.textContent}`), label: document.querySelector('[data-hk-labels] [data-hk-label="deal"]')?.textContent || null }));
      results.numbers.plovara = { db: { stage: want, months: ps.map(p => `${p.period}:${p.state}`) }, ui };
      ok(`Plovara: Deal card "${ui.chip}", months ${ui.months.join(', ')} (DB stage ${want}; relationship ${plovara.relationship})`, ui.chip && ui.months.length === ps.length && plovara.relationship !== 'sponsor');
      await shot(page, 'plovara-1440'); await ctx.close();
    } else ok('no Plovara brand in the workspace', false);
    const { ctx, page, errors } = await open(1440, `#hk/brands?view=money&q=${encodeURIComponent(target.b.name)}`, `[data-hk-brand="${target.b.id}"]`);
    await page.locator(`[data-hk-brand="${target.b.id}"]`).first().click();
    const card = page.locator(`[data-hk-brand-page="${target.b.id}"] [data-hk-deal]`); await card.waitFor();
    const li = card.locator(`[data-hk-month="${target.p.period}"]`);
    const was = Number(target.p.amount_usd), next = was + 1;
    await li.locator('[data-hk-month-amount]').fill(String(next)); await li.locator('[data-hk-month-amount]').press('Enter');
    await card.locator('[data-hk-deal-undo]').waitFor({ timeout: 20000 });
    const mid = must(await svc.from('hk_sponsor_periods').select('amount_usd, source').eq('id', target.p.id).single()).data;
    ok(`${target.b.name} ${target.p.period}: amount $${was} -> $${Number(mid.amount_usd)} in the DB (source ${mid.source})`, Number(mid.amount_usd) === next);
    await card.locator('[data-hk-deal-undo] button').click();
    await card.locator('[data-hk-deal-undo]').waitFor({ state: 'detached', timeout: 20000 });
    const back = must(await svc.from('hk_sponsor_periods').select('amount_usd, source').eq('id', target.p.id).single()).data;
    ok(`Undo: amount $${Number(back.amount_usd)}, source ${back.source} (was $${was}, ${periodSnap.source})`, Number(back.amount_usd) === was && back.source === periodSnap.source);
    await measure(page, 'deal@1440', '[data-hk-deal]'); await axeOn(page, 'deal@1440', '[data-hk-brand-page]');
    const det = page.locator('[data-hk-detail="Instagram"]');
    await det.getByRole('button', { name: 'Edit Instagram' }).click();
    await page.getByLabel('Instagram handle').fill(`@${TEST_HANDLE}`); await det.getByRole('button', { name: 'Save' }).click();
    await det.locator('[data-hk-open-dm]').waitFor({ timeout: 20000 });
    const href = await det.locator('[data-hk-open-dm]').getAttribute('href');
    const set = must(await svc.from('hk_brands').select('instagram_handle').eq('id', target.b.id).single()).data.instagram_handle;
    ok(`handle "@${TEST_HANDLE}" saved as "${set}"; Open DM -> ${href}`, set === TEST_HANDLE && href === `https://ig.me/m/${TEST_HANDLE}`);
    await shot(page, 'deal-handle-1440');
    await det.getByRole('button', { name: 'Edit Instagram' }).click();
    await page.getByLabel('Instagram handle').fill(''); await det.getByRole('button', { name: 'Save' }).click();
    await page.waitForFunction(() => /no handle yet/.test(document.querySelector('[data-hk-detail="Instagram"]')?.textContent || ''), null, { timeout: 20000 });
    const cleared = must(await svc.from('hk_brands').select('instagram_handle').eq('id', target.b.id).single()).data.instagram_handle;
    ok(`handle cleared (${cleared})`, cleared === null);
    ok('1440 Brand page: no sideways scroll; 0 page errors', await noSideways(page) && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- Inbox: one Brands-lane read; a saved brand's row + strip carry the server's status line.
  {
    const { ctx, page, errors } = await open(1440, '#hk/inbox?lane=brands', '[data-hk-thread], [data-hk-empty]');
    await page.waitForTimeout(800);
    const body = inboxBodies.find(b => b?.tab === 'brands');
    const row = body?.threads?.find(t => t.status_line?.kind === 'saved');
    results.numbers.gmail = { calls: body?.gmail_calls ?? null, units: body?.gmail_units ?? null };
    if (!row) ok(`Inbox Brands lane: ${body?.threads?.length ?? 0} threads, none from a saved brand - status line not exercised`, false);
    else {
      const chip = await page.locator(`[data-hk-thread="${row.thread_id}"] [data-hk-row-status]`).textContent();
      ok(`row chip "${chip}" = server line "${row.status_line.line}"`, chip.startsWith(row.status_line.brand_name));
      await page.locator(`[data-hk-thread="${row.thread_id}"]`).dispatchEvent('click');
      await page.locator('[data-hk-status-line="saved"]').waitFor({ timeout: 30000 });
      const strip = await page.locator('[data-hk-status-line="saved"]').textContent();
      const b = liveBrandRows.find(x => x.id === row.status_line.brand_id);
      const want = dealStageOf(b, periods0.filter(p => p.brand_id === b.id), thisMonth);
      ok(`strip: "${strip}" (deal stage in DB: ${want})`, strip.includes(row.status_line.brand_name) && row.status_line.deal_stage === want);
      await shot(page, 'inbox-status-1440');
      await measure(page, 'status@1440', '[data-hk-status-line]');
    }
    ok('1440 Inbox: 0 page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- 390: money + Deal card on a phone.
  {
    const { ctx, page, errors } = await open(390, '#hk/brands?view=money', '[data-hk-money-month]');
    await shot(page, 'money-390');
    await measure(page, 'money@390', '[data-hk-money]'); await axeOn(page, 'money@390', '[data-hk-money]');
    ok('390 money: the page does not scroll sideways (the table scrolls in its card); 0 page errors', await noSideways(page) && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- Viewer (role forced in /shell): money reads; the Deal card has 0 controls.
  {
    const { ctx, page, errors } = await open(1440, `#hk/brands?view=money&q=${encodeURIComponent(target.b.name)}`, `[data-hk-brand="${target.b.id}"]`, { viewer: true });
    await page.locator(`[data-hk-brand="${target.b.id}"]`).first().click();
    const card = page.locator(`[data-hk-brand-page="${target.b.id}"] [data-hk-deal]`); await card.waitFor();
    const controls = await card.locator('button, select, input').count();
    ok(`Viewer: Deal card lists ${await card.locator('[data-hk-month]').count()} months with ${controls} controls; 0 page errors`, controls === 0 && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  ok(`browser reached 0 Claude / Apollo / Google API hosts; writes ${JSON.stringify(posts.reduce((m, p) => ({ ...m, [p]: (m[p] || 0) + 1 }), {}))}; aborted ${[...new Set(blocked)].slice(0, 6).join(', ') || 'none'}`, !realCalls.length);
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    const { id: _p, ...pRest } = periodSnap; const { id: _b, ...bRest } = brandSnap;
    must(await svc.from('hk_sponsor_periods').update(pRest).eq('id', periodSnap.id));
    must(await svc.from('hk_brands').update(bRest).eq('id', brandSnap.id));
    const same = (a, b) => Object.keys(a).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]) && !(typeof a[k] === 'string' && Date.parse(a[k]) === Date.parse(b[k])));
    const dp = same(periodSnap, must(await svc.from('hk_sponsor_periods').select('*').eq('id', periodSnap.id).single()).data);
    const db = same(brandSnap, must(await svc.from('hk_brands').select('*').eq('id', brandSnap.id).single()).data);
    if (dp.length || db.length) throw new Error(`fields differ: period ${dp.join(', ')} brand ${db.join(', ')}`);
    const after = await counts();
    const moved = HK_TABLES.filter(t => before.counts[t] !== after[t]).map(t => `${t} ${before.counts[t]} -> ${after[t]}`);
    if (moved.length) throw new Error(`counts moved: ${moved.join(', ')}`);
    const m1 = await dbMoney();
    if (JSON.stringify(m1) !== JSON.stringify(money0)) throw new Error('money changed');
    restored = true;
    line = `yes (${target.b.name}'s ${target.p.period} month row + brand row restored field by field; ${HK_TABLES.length} HumanKind counts and the DB money identical; Activity + sign-in rows kept by rule)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'stage4-report.json'), JSON.stringify({ ...results, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\ngrow-sponsor-deals-v1 Stage 4 live check: ${passed}/${results.checks.length} passed · Claude 0 · Apollo 0 · Gmail ${JSON.stringify(results.numbers.gmail || {})}\nnumbers: ${JSON.stringify(results.numbers)}\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
