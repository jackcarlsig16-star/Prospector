// heat-v2 Stage 2 - PNGs of Pipeline › People at 1440 (popover closed + open) and 390 (cards), localhost against build/,
// as Jack (ownerSession) on the REAL HomeLover workspace, beside the Nov 9 mockup (PeopleTable-v2.dc.html, file://).
// READ-ONLY: every non-GET API call and every Supabase write is aborted at the network layer and counted; the server
// runs with the Claude and Apollo keys empty and the browser's calls to either host are aborted. Measures N2 (no
// sideways page scroll, the table fits its card), the column widths, the group headers, the popover, and runs axe.
// Usage: node scripts/verify/heat-v2-stage2-shots.mjs
// Declared scope: 1 owner session (released, last_seen_at restored), 3 page loads, ~15 GETs, 0 writes, ~90 s, cap 240 s.
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
const OUT = path.join(ROOT, '.screenshots', 'heat-v2');
const MOCK = path.join(ROOT, 'specs', 'design', 'people-v2', 'PeopleTable-v2.dc.html');
const PORT = 3997, BASE = `http://localhost:${PORT}`;
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
const results = { checks: [], errors: [], axe: {} };
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
  const people = await get('/goals/people/activity?window=all');
  const rows = people.body?.rows || [];
  const bands = rows.reduce((o, r) => { const b = r.heat_band || 'none'; o[b] = (o[b] || 0) + 1; return o; }, {});
  const sorted = [...rows].filter(r => r.heat != null).sort((a, b) => b.heat - a.heat);
  const lastHot = sorted.filter(r => r.heat_band === 'hot').pop(), firstWarm = sorted.find(r => r.heat_band === 'warm');
  ok(`GET goals/people/activity ${people.status}: ${people.body?.total} people · bands ${JSON.stringify(bands)} · heat_rule ${JSON.stringify(people.body?.heat_rule)} · history_since ${people.body?.history_since} · with heat_7d_ago ${rows.filter(r => r.heat_7d_ago != null).length}`, people.status === 200 && people.body?.heat_rule?.fade?.fresh === 7);
  ok(`route sort invariant: last hot ${lastHot ? `${lastHot.name} ${lastHot.heat}` : 'none'} > first warm ${firstWarm ? `${firstWarm.name} ${firstWarm.heat}` : 'none'}`, !lastHot || !firstWarm || lastHot.heat > firstWarm.heat);
  const first = rows[0];
  const detail = first ? await get(`/goals/people/activity/${encodeURIComponent(first.key)}`) : null;
  ok(`GET detail ${detail?.status} for the top row: heat ${detail?.body?.heat?.score} ${detail?.body?.heat?.band} · history ${detail?.body?.history?.length} day rows (expected 0 before the first sync after the migration)`, detail?.status === 200 && Array.isArray(detail.body.history));

  browser = await chromium.launch();
  async function open(width) {
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
    await page.goto(`${BASE}/?tab=pipeline&view=people`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 25000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: /^Pipeline/ }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
    await page.locator('[data-sales-subviews]').getByRole('tab', { name: 'People', exact: true }).dispatchEvent('click'); await page.waitForTimeout(1500);
    await page.locator('[data-people-table] [data-row]').first().waitFor({ timeout: 30000 }); await page.waitForTimeout(2000);
    return { ctx, page, errors };
  }
  const axeOn = async (page, sel, key) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async s => { const r = await window.axe.run(document.querySelector(s) || document, { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); }, sel);
    results.axe[key] = v;
    ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v).slice(0, 300));
  };
  const measure = page => page.evaluate(() => {
    const sec = document.querySelector('[data-people-table]');
    const box = sec?.querySelector('.ui-table-box'), table = sec?.querySelector('table.ui-table');
    return {
      headers: [...(sec?.querySelectorAll('th') || [])].map(h => h.textContent.replace(/\s*[↕▲▼]\s*$/, '').trim()),
      widths: [...(sec?.querySelectorAll('colgroup col') || [])].map(c => parseInt(c.style.width, 10)),
      groups: [...(sec?.querySelectorAll('tr.ui-table__group, li.ui-list__group') || [])].map(g => g.textContent.replace(/\s+/g, ' ').trim()),
      rows: sec?.querySelectorAll('[data-row]').length || 0, cards: sec?.querySelectorAll('.ui-list__row').length || 0,
      pills: [...(sec?.querySelectorAll('[data-row] [data-heat-band]') || [])].slice(0, 6).map(el => el.textContent),
      buyerTags: sec?.querySelectorAll('[data-buyer]').length || 0, sources: [...new Set([...(sec?.querySelectorAll('[data-source]') || [])].map(el => el.textContent))],
      identified: [...(sec?.querySelectorAll('[data-identified]') || [])].slice(0, 3).map(el => el.textContent),
      footnote: !!document.querySelector('[data-heat-footnote]'), huddle: /Huddle/.test(document.body.textContent),
      sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
      fit: box && table ? { boxClient: box.clientWidth, boxScroll: box.scrollWidth, table: Math.round(table.getBoundingClientRect().width) } : null,
      filterRows: [...(sec?.querySelectorAll('[data-filter-row], [data-filter-selects]') || [])].length,
      showing: [...(sec?.querySelectorAll('span, div') || [])].map(e => e.textContent.trim()).find(t => /^Showing \d+ of \d+/.test(t)) || '',
    };
  });

  // ---- 1440: closed, then the popover open.
  {
    const { ctx, page, errors } = await open(1440);
    const m = await measure(page);
    await page.screenshot({ path: `${OUT}/people-1440.png`, animations: 'disabled' });
    ok(`people@1440: headers ${m.headers.join(' · ')} · widths ${m.widths.join('/')} = ${m.widths.reduce((a, b) => a + b, 0)} · groups ${m.groups.join(' | ')} · rows ${m.rows} · pills ${m.pills.join(', ')} · buyer tags ${m.buyerTags} · sources ${m.sources.join(', ')} · identified ${m.identified.join(', ')} · "${m.showing}" · header lines ${m.filterRows} · errors ${errors.length}`, m.widths.reduce((a, b) => a + b, 0) === 1082 && m.groups.length === 3 && /^Hot/.test(m.groups[0]) && /collapsed$/.test(m.groups[2]) && m.filterRows === 2 && errors.length === 0);
    ok(`people@1440 D3: no footnote (${!m.footnote}), no "Huddle" in the page text (${!m.huddle})`, !m.footnote && !m.huddle);
    ok(`people@1440 N2: the table fits its card (${m.fit?.boxScroll} ≤ ${m.fit?.boxClient}) and the page has no sideways scroll (${!m.sideways})`, m.fit && m.fit.boxScroll <= m.fit.boxClient && !m.sideways);
    await axeOn(page, '[data-people-table]', 'people@1440');
    const info = page.getByRole('button', { name: 'How heat works' });
    await info.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
    const pop = page.getByRole('dialog', { name: 'How heat works' });
    const popText = await pop.textContent().catch(() => '');
    const popBox = await pop.boundingBox().catch(() => null);
    ok(`popover opens on Enter: ${popBox ? `${Math.round(popBox.width)} px wide` : 'missing'} · "${popText.slice(0, 120)}…"`, popBox && Math.round(popBox.width) === 360 && /Band is the number's bracket/.test(popText));
    await page.screenshot({ path: `${OUT}/people-1440-popover.png`, animations: 'disabled' });
    await axeOn(page, '[data-heat-popover]', 'popover');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    const closed = await page.getByRole('dialog', { name: 'How heat works' }).count();
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    ok(`Esc closes the popover (${closed === 0}) and focus returns to the ⓘ (${focused})`, closed === 0 && focused === 'How heat works');
    await info.click(); await page.waitForTimeout(300); await page.evaluate(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))); await page.waitForTimeout(300);
    ok('a click outside closes it', (await page.getByRole('dialog', { name: 'How heat works' }).count()) === 0);
    // Cold expands.
    const coldBtn = page.locator('tr.ui-table__group[data-group="cold"] button');
    const coldName = await coldBtn.evaluate(b => `${b.tagName} aria-expanded=${b.getAttribute('aria-expanded')} text="${b.textContent}"`).catch(e => `missing: ${e.message.slice(0, 80)}`);
    await coldBtn.scrollIntoViewIfNeeded(); await coldBtn.dispatchEvent('click'); await page.waitForTimeout(600);
    const m2 = await measure(page);
    ok(`Cold expands (${coldName}): rows ${m.rows} -> ${m2.rows} (groups ${m2.groups[2]})`, m2.rows > m.rows && !/collapsed$/.test(m2.groups[2]));
    // The pinned card: pill + why lines + sparkline placeholder.
    await page.locator('[data-people-table] tr[data-row] td').first().click(); await page.waitForTimeout(1500);
    const card = await page.evaluate(() => { const d = document.querySelector('[data-person-detail]'); return d ? { pill: d.querySelector('[data-heat-live] [data-heat-band]')?.textContent || null, why: [...d.querySelectorAll('[data-heat-why] li')].map(l => l.textContent), spark: d.querySelector('[data-heat-sparkline]')?.getAttribute('data-heat-sparkline') || null } : null; });
    ok(`pinned card: pill "${card?.pill}" · why ${JSON.stringify(card?.why)} · sparkline ${card?.spark}`, card && card.pill && card.spark != null);
    await page.screenshot({ path: `${OUT}/people-1440-card.png`, animations: 'disabled' });
    await ctx.close();
  }
  // ---- 390 cards.
  {
    const { ctx, page, errors } = await open(390);
    const m = await measure(page);
    await page.screenshot({ path: `${OUT}/people-390.png`, animations: 'disabled', fullPage: true });
    ok(`people@390: cards ${m.cards} · groups ${m.groups.join(' | ')} · pills ${m.pills.join(', ')} · buyer tags ${m.buyerTags} · sources ${m.sources.join(', ')} · sideways ${m.sideways} · errors ${errors.length}`, m.cards > 0 && m.groups.length === 3 && !m.sideways && errors.length === 0);
    await axeOn(page, '[data-people-table]', 'people@390');
    await ctx.close();
  }
  // ---- Side-by-side: mockup (file://) | build, 1440, closed and open.
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1180 } });
    const page = await ctx.newPage();
    await page.goto(`file://${MOCK}`); await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/mockup-1440.png`, fullPage: true });
    const b64 = f => fs.readFileSync(path.join(OUT, f)).toString('base64');
    const fig = (cap, f) => `<figure style="margin:0"><figcaption style="padding:4px 0">${cap}</figcaption><img src="data:image/png;base64,${b64(f)}" style="width:1440px;display:block"></figure>`;
    for (const [name, build] of [['closed', 'people-1440.png'], ['popover', 'people-1440-popover.png']]) {
      const compose = await ctx.newPage();
      await compose.setViewportSize({ width: 1440 * 2 + 48, height: 200 });
      await compose.setContent(`<body style="margin:0;background:#000;color:#fff;font:12px monospace"><div style="display:flex;gap:16px;padding:16px;align-items:flex-start">${fig('mockup · PeopleTable-v2.dc.html · 1440 (drawn with the popover open)', 'mockup-1440.png')}${fig(`build · Pipeline › People · 1440 · ${name}`, build)}</div></body>`);
      await compose.waitForTimeout(500);
      await compose.screenshot({ path: `${OUT}/side-by-side-1440-${name}.png`, fullPage: true });
      ok(`side-by-side-1440-${name}.png written (mockup | build)`, true);
      await compose.close();
    }
    await ctx.close();
  }
  ok(`browser reached 0 Claude / Apollo hosts (${realCalls.length}); API writes attempted ${writes.length} (all aborted: ${[...new Set(writes)].join(', ') || 'none'})`, realCalls.length === 0);
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'stage2-report.json'), JSON.stringify({ ...results, when: new Date().toISOString() }, null, 2));
  console.log(`\nheat-v2 Stage 2 shots: ${passed}/${results.checks.length} passed · Claude 0 · Apollo ${realCalls.length} · API writes 0 (${writes.length} aborted) · ${Math.round((Date.now() - T0) / 1000)} s`);
  console.log(`files: ${fs.readdirSync(OUT).join(', ')}`);
  console.log('restored: yes (0 writes; the owner session released, last_seen_at restored; sign-in rows kept by rule)');
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
