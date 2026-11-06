// people-v2 Stage 2 live check - localhost against the build, as Jack (ownerSession) on the REAL HomeLover workspace,
// READ-ONLY (0 Claude, 0 Apollo, no writes: every non-GET API call and Supabase write is aborted at the network layer and
// counted). Pipeline › People at 1440: the 10 columns in order, the rows in the route's order, every heat cell's band =
// GET goals/people/activity's band (never recomputed), the chip counts = the route's, the footnote = the route's rule
// (the Huddle's numbers), a chip narrows the set, a row click pins the detail card (its timeline = GET …/activity/:key),
// Esc closes it, a name click opens the company window on its People drawer (0 writes), no address anywhere, axe 0.
// At 390: stacked cards, the chip row scrolls sideways, the selects in the Filters sheet, no sideways page scroll.
// Side-by-side PNGs: the sketch's frame beside the build at 1440 and at 390.
// Heat is NULL on every summary row until the next Apollo sync writes it (the backfill left it so on purpose), so the band
// is proved at the data layer: the summary computed in memory over the real rows (the writer's own function) and the
// route's table built from it carry, for every scored prospect, the score + band GET /huddle serves - to the digit.
// Declared scope: 3 page loads, ~10 GETs, ~10 table reads (< 2k rows), 11 table counts twice. ~120 s, cap 240 s.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { ownerSession } from './lib/ownerSession.mjs';
import { heatRule } from '../../src/components/salesAnalytics/people/peopleTableModel.js';
import { buildPersonActivity } from '../../api/sales/personActivity.js';
import { peopleRows, buildPeopleTable, windowOf } from '../../api/sales/peopleActivityRoutes.js';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const AXE = fs.readFileSync(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const OUT = path.join(ROOT, '.screenshots', 'people-v2-stage2');
const SKETCH = path.join(ROOT, 'specs', 'design', 'people-v2', 'People.html');
const PORT = 3994, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const TABLES = ['sales_prospect_state', 'sales_people', 'partner_contacts', 'sales_person_activity', 'sales_email_messages', 'sales_email_activity', 'web_visits', 'sales_opportunities', 'sales_targets', 'sales_goals', 'sales_settings'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data?.[0]?.id;
if (!HL) throw new Error('no HomeLover business');
async function count(t) { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL); return r.error ? `n/a (${r.error.message.slice(0, 40)})` : r.count; }
const snapshot = async () => { const o = {}; for (const t of TABLES) o[t] = await count(t); return o; };
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
const before = await snapshot();
log('before', JSON.stringify(before));
const HEADERS = ['Person', 'Company', 'Source', 'Emails (human opens)', 'Last email', 'Heat', 'Company visits', 'Identified', 'Buyer', 'Last touch'];
const CHIP_LABEL = { opened: 'Opened', clicked: 'Clicked', replied: 'Replied', sent: 'Sent (any)', identified: 'Identified visitor', visited_7d: 'Company visited 7 d', buyer: 'Buyer title', hot: 'Hot', needs_touch: 'Needs a touch', mine: 'Mine' };

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', ANTHROPIC_API_KEY: '', APOLLO_API_KEY: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const get = async p => { const r = await fetch(`${BASE}/api/sales/${HL}${p}`, { headers: { cookie } }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const act = await get('/goals/people/activity?window=all');
  ok(`GET goals/people/activity 200 (${act.status}): ${act.body?.total} people, counts ${JSON.stringify(act.body?.counts)}, heat_rule ${JSON.stringify(act.body?.heat_rule)}, heat pending ${act.body?.heat_pending}`, act.status === 200 && act.body?.rows?.length);
  const route = act.body;
  const byKey = new Map(route.rows.map(r => [r.key, r]));
  const hotRows = route.rows.filter(r => r.heat_band === 'hot');
  // The band at the data layer: the writer's function over the real rows vs GET /huddle, for every scored prospect.
  {
    const all = (table, cols, build = x => x) => build(svc.from(table).select(cols).eq('business_id', HL)).limit(5000).then(r => { if (r.error) throw new Error(r.error.message); return r.data; });
    const [prospects, salesPeople, partnerContacts, opportunities, targets, partners, visits, settings, messages, events] = await Promise.all([
      all('sales_prospect_state', 'contact_id, name, title, company, opportunity_id, goal_id, status, owner, email'),
      all('sales_people', 'id, company_type, opportunity_id, target_id, name, title, source_kind, visit_id, upload_id, archived_at, created_at, company_name'),
      all('partner_contacts', 'id, goal_id, name, title, email, apollo_contact_id, last_activity_at'),
      all('sales_opportunities', 'id, organization, stage, owner_user_id, archived_at'),
      all('sales_targets', 'id, name, status, owner_user_id'),
      all('sales_goals', 'id, name, pipeline_status, owner_user_id', x => x.eq('goal_type', 'partnership')),
      all('web_visits', 'id, company_key, company_name, matched_type, matched_id, visits_7d, last_visit, seen_to, top_paths, pulled_on'),
      svc.from('sales_settings').select('buyer_titles').eq('business_id', HL).maybeSingle().then(r => r.data),
      all('sales_email_messages', 'apollo_message_id,contact_id,sequence_id,step,delivered_at,replied,reply_class,replied_seen_at,replied_at,num_opens,num_clicks,last_opened_at,last_clicked_at,bounced'),
      all('sales_email_activity', 'id,apollo_message_id,contact_id,step,event,occurred_at,user_agent,tracking_service'),
    ]);
    const NOW = Date.now();
    const activity = buildPersonActivity({ prospects, partnerContacts, messages, events, now: NOW });
    const mem = buildPeopleTable({ rows: peopleRows({ prospects, salesPeople, partnerContacts, opportunities: opportunities.filter(o => !o.archived_at), targets, partners }), activity, visits, buyerTitles: settings?.buyer_titles || [], window: windowOf('all', today), now: NOW });
    const huddle = await get('/huddle');
    const hud = (huddle.body?.prospects || huddle.body?.rows || huddle.body?.live || []);
    const memBy = new Map(mem.rows.filter(r => r.key.startsWith('prospect:')).map(r => [r.key.slice(9), r]));
    const diff = hud.filter(p => { const m = memBy.get(p.contact_id); return !m || m.heat !== p.score || m.heat_band !== p.heat_band; });
    const bands = hud.reduce((o, p) => { o[p.heat_band] = (o[p.heat_band] || 0) + 1; return o; }, {});
    const warmAbove = hud.filter(p => p.heat_band === 'warm' && p.score >= 40).length, hotBelow = hud.filter(p => p.heat_band === 'hot' && p.score < 40).length;
    ok(`band = the Huddle's rule: GET /huddle ${huddle.status} serves ${hud.length} scored prospects (${JSON.stringify(bands)}; ${warmAbove} warm at or above 40, ${hotBelow} hot below 40); the table built from the writer's summary carries the same score · band for every one (differ ${diff.length}${diff.length ? ': ' + diff.slice(0, 3).map(p => `${p.name} ${p.score}/${p.heat_band} vs ${memBy.get(p.contact_id)?.heat}/${memBy.get(p.contact_id)?.heat_band}`).join('; ') : ''}); live rows today carry heat NULL on ${route.heat_pending} (the next Apollo sync writes it)`, huddle.status === 200 && hud.length > 0 && diff.length === 0);
  }

  browser = await chromium.launch();
  async function openPeople(width) {
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
  const axeOn = async (page, key) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async () => { const r = await window.axe.run(document.querySelector('[data-people-table]') || document, { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); });
    results.axe[key] = v;
    ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v).slice(0, 300));
  };
  const info = page => page.evaluate(() => {
    const sec = document.querySelector('[data-people-table]');
    const rows = [...sec.querySelectorAll('[data-row]')].map(el => ({ key: el.dataset.key, name: el.querySelector('[data-person-name]')?.textContent, heat: el.querySelector('[data-heat-band]') ? { band: el.querySelector('[data-heat-band]').dataset.heatBand, text: el.querySelector('[data-heat-band]').textContent } : null }));
    const chips = [...sec.querySelectorAll('[data-people-chips] button')].map(b => b.textContent.trim());
    return {
      headers: [...sec.querySelectorAll('th')].map(h => h.textContent.replace(/^[◉✓]/, '').replace(/\s*[↕▲▼]\s*$/, '').trim()),
      rows, chips,
      showing: (sec.querySelector('[data-active-filters]') || sec.querySelector('.ui-active-filters') || sec.querySelector('[data-active-filter-line]'))?.textContent?.trim() || [...sec.querySelectorAll('span, div')].map(e => e.textContent.trim()).find(t => /^Showing \d+ of \d+/.test(t)) || '',
      footnote: sec.querySelector('[data-heat-footnote]')?.textContent || '',
      detail: sec.querySelector('[data-person-detail]') ? { key: sec.querySelector('[data-person-detail]').dataset.personDetail, timeline: sec.querySelectorAll('[data-person-detail] [data-timeline-kind]').length, menu: [...sec.querySelectorAll('[data-person-detail] [role=group][aria-label="Quick menu"] button')].map(b => b.textContent.trim()), text: sec.querySelector('[data-person-detail]').textContent } : null,
      text: sec.textContent, cards: sec.querySelectorAll('.ui-list__row').length,
      chipsScroll: (() => { const c = sec.querySelector('[data-people-chips]'); return c ? c.scrollWidth > c.clientWidth + 1 : null; })(),
      selectsInline: !!sec.querySelector('[data-filter-selects]'),
      sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
      window: !!document.querySelector('[data-center-window]'),
    };
  });

  // ---- 1440: the table against the route.
  {
    const { ctx, page, errors } = await openPeople(1440);
    const h = await info(page);
    ok(`1440 headers ${h.headers.join(' · ')}`, h.headers.join('|') === HEADERS.join('|'));
    const keyOf = k => k.replace(/[^A-Za-z0-9_-]/g, '_');
    const expectKeys = route.rows.map(r => keyOf(r.key));
    const shownKeys = h.rows.map(r => r.key);
    ok(`1440 rows ${h.rows.length} = the route's ${route.rows.length}, in the route's order (heat desc, then last email)`, shownKeys.join('|') === expectKeys.join('|'));
    ok(`1440 "${h.showing}" = Showing ${route.total} of ${route.total}`, h.showing.startsWith(`Showing ${route.total} of ${route.total}`));
    const safeToRoute = new Map(route.rows.map(r => [keyOf(r.key), r]));
    const bandBad = h.rows.filter(r => { const x = safeToRoute.get(r.key); return x && x.heat != null && (!r.heat || r.heat.band !== x.heat_band || r.heat.text !== `${x.heat} · ${x.heat_band}`); });
    const bands = h.rows.reduce((o, r) => { if (r.heat) o[r.heat.band] = (o[r.heat.band] || 0) + 1; return o; }, {});
    const pending = h.rows.filter(r => !r.heat).length;
    ok(`1440 every heat cell = the route's score · band (${JSON.stringify(bands)}, ${pending} pending), 0 recomputed: bad ${bandBad.length} ${bandBad.slice(0, 3).map(r => `${r.name} ${r.heat?.text} vs ${safeToRoute.get(r.key)?.heat} · ${safeToRoute.get(r.key)?.heat_band}`).join('; ')}`, bandBad.length === 0 && pending === route.rows.filter(r => r.heat == null).length);
    const top = h.rows.slice(0, 3).map(r => `${r.name} ${r.heat?.text ?? '—'}`).join(' · ');
    const warmAboveHot = h.rows.find(r => r.heat?.band === 'warm' && Number(r.heat.text.split(' ')[0]) > 40);
    ok(`1440 top rows ${top}; a warm row scoring above hot's 40 exists (${warmAboveHot ? warmAboveHot.heat.text : 'none'}) and keeps the route's warm`, true);
    const chipBad = Object.entries(CHIP_LABEL).filter(([id, label]) => { const c = h.chips.find(t => t.startsWith(label)); return !c || (id !== 'mine' && c.replace(/\s+/g, '') !== `${label}(${route.counts[id]})`.replace(/\s+/g, '')); });
    ok(`1440 chips with the route's counts: ${h.chips.join(' | ')}; bad ${chipBad.map(([id]) => id).join(',') || 'none'}`, chipBad.length === 0);
    const rule = heatRule(route.heat_rule);
    ok(`1440 footnote = the route's rule: "${h.footnote.slice(0, 120)}…" (hot ${route.heat_rule.hot} / warm ${route.heat_rule.warm} / ${route.heat_rule.days} d)`, h.footnote.startsWith(rule) && /score ≥ 40/.test(h.footnote) && /score ≥ 10/.test(h.footnote));
    ok(`1440 no address in the section (${!/@/.test(h.text)}), 0 page errors`, !/@/.test(h.text) && !errors.length, errors.join(' | '));
    await page.screenshot({ path: `${OUT}/people-1440.png`, animations: 'disabled' });
    await axeOn(page, 'people@1440');
    // Hot chip narrows to the route's hot rows.
    await page.locator('[data-people-chips] button', { hasText: /^Hot/ }).click(); await page.waitForTimeout(500);
    const hh = await info(page);
    ok(`1440 Hot chip -> ${hh.rows.length} rows = the route's hot ${hotRows.length}; "${hh.showing.slice(0, 40)}"`, hh.rows.length === hotRows.length && hh.rows.every(r => r.heat?.band === 'hot') && hh.showing.startsWith(`Showing ${hotRows.length} of ${route.total}`));
    await page.locator('[data-people-chips] button', { hasText: /^Hot/ }).click(); await page.waitForTimeout(400);
    // Row click = select: the pinned card with the timeline = GET …/activity/:key.
    const first = route.rows[0];
    const det = await get(`/goals/people/activity/${encodeURIComponent(first.key)}`);
    await page.locator('[data-people-table] [data-row]').first().locator('td').nth(2).click(); await page.waitForTimeout(2500);
    const hd = await info(page);
    const expTimeline = Math.min(20, det.body?.timeline?.length || 0);
    ok(`1440 row click pins ${first.name}'s card (${hd.detail?.key}): timeline ${hd.detail?.timeline} = GET …/activity/:key ${expTimeline}, quick menu ${hd.detail?.menu.join(' · ')}`, hd.detail && hd.detail.key === first.key && hd.detail.timeline === expTimeline && hd.detail.menu.join('|') === 'Open company|Draft email|Log call|Add to-do|Mark contacted|Not a fit');
    ok(`1440 the card: Email timeline, Company visits, Emails, Notes present; no address (${!/@/.test(hd.detail?.text || '')})`, hd.detail && /Email timeline/.test(hd.detail.text) && /Company visits/.test(hd.detail.text) && /Notes/.test(hd.detail.text) && !/@/.test(hd.detail.text));
    await page.screenshot({ path: `${OUT}/people-detail-1440.png`, animations: 'disabled' });
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    const he = await info(page);
    ok(`1440 Esc closes the card (${he.detail === null})`, he.detail === null);
    // Name click = open: the company window on its People drawer, 0 writes.
    const withCo = h.rows.findIndex(r => safeToRoute.get(r.key)?.company?.id);
    const coRow = safeToRoute.get(h.rows[withCo].key);
    await page.locator('[data-people-table] [data-row]').nth(withCo).locator('[data-person-name]').click();
    await page.locator('[data-center-window] [data-drawer]').first().waitFor({ timeout: 30000 }).catch(() => {}); await page.waitForTimeout(1500);
    const win = await page.evaluate(() => { const w = document.querySelector('[data-center-window]'); if (!w) return null; const p = w.querySelector('[data-drawer="people"]'); return { title: w.querySelector('h2, h3, [data-window-title]')?.textContent?.slice(0, 60), people: p ? p.dataset.open : null, drawers: w.querySelectorAll('[data-drawer]').length }; });
    ok(`1440 name click opens ${coRow.company.name}'s window (${win?.title}) on its People drawer (aria-expanded ${win?.people}, ${win?.drawers} drawers); writes ${writes.length}`, win && win.people === 'true' && writes.length === 0);
    await page.screenshot({ path: `${OUT}/people-open-company-1440.png`, animations: 'disabled' });
    await ctx.close();
  }
  // ---- 390: cards, the chip row scrolls, the selects in the Filters sheet.
  {
    const { ctx, page, errors } = await openPeople(390);
    const h = await info(page);
    ok(`390 ${h.cards} cards = the route's ${route.rows.length}, no table headers (${h.headers.length}), the chip row scrolls sideways (${h.chipsScroll}), the selects not inline (${!h.selectsInline}), the page not sideways (${!h.sideways}); 0 page errors`, h.cards === route.rows.length && h.headers.length === 0 && h.chipsScroll && !h.selectsInline && !h.sideways && !errors.length, errors.join(' | '));
    await page.screenshot({ path: `${OUT}/people-390.png`, animations: 'disabled' });
    await axeOn(page, 'people@390');
    await page.locator('[data-people-table]').getByRole('button', { name: /^Filters/ }).click(); await page.waitForTimeout(500);
    const sheet = await page.evaluate(() => { const d = document.querySelector('[role=dialog][aria-label="Filters"]'); return d ? [...d.querySelectorAll('select')].map(s => s.getAttribute('aria-label') || s.previousElementSibling?.textContent || '?') : null; });
    ok(`390 Filters sheet holds the selects: ${sheet?.join(' · ')}`, sheet && sheet.length >= 4);
    await page.screenshot({ path: `${OUT}/people-filters-390.png`, animations: 'disabled' });
    await ctx.close();
  }
  // ---- Side-by-side: the sketch's frame | the build, at 1440 and at 390.
  {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`file://${SKETCH}`); await page.waitForTimeout(800);
    await page.locator('#s1440').screenshot({ path: `${OUT}/sketch-1440.png` });
    await page.locator('#s390').screenshot({ path: `${OUT}/sketch-390.png` });
    const b64 = f => fs.readFileSync(path.join(OUT, f)).toString('base64');
    for (const [w, sk, bd, outW] of [[1440, 'sketch-1440.png', 'people-1440.png', 1440 * 2 + 48], [390, 'sketch-390.png', 'people-390.png', 390 * 2 + 48]]) {
      const compose = await ctx.newPage();
      await compose.setViewportSize({ width: outW, height: 200 });
      await compose.setContent(`<body style="margin:0;background:#000;color:#fff;font:12px monospace"><div style="display:flex;gap:16px;align-items:flex-start;padding:16px"><figure style="margin:0"><figcaption style="padding:4px 0">sketch · People.html #s${w}</figcaption><img style="width:${w}px;display:block" src="data:image/png;base64,${b64(sk)}"></figure><figure style="margin:0"><figcaption style="padding:4px 0">build · Pipeline › People at ${w} (HomeLover, as Jack)</figcaption><img style="width:${w}px;display:block" src="data:image/png;base64,${b64(bd)}"></figure></div></body>`);
      await compose.waitForTimeout(500);
      await compose.screenshot({ path: `${OUT}/side-by-side-${w}.png`, fullPage: true });
      await compose.close();
    }
    ok('side-by-side-1440.png + side-by-side-390.png written (sketch | build)', true);
    await ctx.close();
  }
  ok(`browser reached 0 Claude / Apollo hosts; every non-GET aborted (${[...new Set(writes)].join(', ') || 'none attempted'})`, !realCalls.length && writes.every(w => blocked.includes(w)));
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    const after = await snapshot();
    const moved = TABLES.filter(t => String(before[t]) !== String(after[t])).map(t => `${t} ${before[t]} -> ${after[t]}`);
    if (moved.length) throw new Error(`counts moved: ${moved.join(', ')}`);
    restored = true; line = `yes (${TABLES.length} table counts identical, 0 writes; Jack sign-in row kept by rule, last_seen_at restored)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'stage2-report.json'), JSON.stringify({ ...results, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\npeople-v2 Stage 2 live check: ${passed}/${results.checks.length} passed · Claude 0 · Apollo ${realCalls.length} · writes 0 · ${Math.round((Date.now() - T0) / 1000)} s`);
  console.log(`files: ${fs.readdirSync(OUT).join(', ')}`);
  console.log(`restored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
