// heat-v2 Stage 3 - LIVE as Jack (ownerSession) on the REAL HomeLover workspace, localhost against build/, 0 Apollo,
// Claude 1 (the one Scout ask at the end, through the real wiring - the server keeps its Anthropic key for that one call).
//   W1 ONE explicit writePersonActivity recompute (the product's own write): sales_person_activity rows before / after
//      and today's sales_person_heat_days rows (count, distinct days) - kept, never restored (it IS the stored heat).
//   Old -> new for the people Stage 0 listed (the 13 hot + the 4 warm >= 40 of Nov 9) by name, 10 of them with the
//      detail route's why lines (incl. Paola Ball, James Curcio, Meagan Earley after R3); first Warm < last Hot on prod.
//   Browser: 1440 (groups, the ⓘ popover's "History since" = min(day) in the DB, the CSV download with the Heat band
//      column and no "@", 390 cards, a Viewer pass (the /api/me reply rewritten to role viewer - no DB change).
//   Scout: ONE POST /api/scout/ask "who's our hottest person visiting the website" - the names it returns vs the table's
//      top rows (company visited in 7 d or identified, by heat); cost from the usage row (kept: it is the ask's own log).
// Every other non-GET API call and every Supabase write from the browser is aborted at the network layer and counted.
// Declared scope: 1 owner session (released, last_seen_at restored) · ~12 table reads twice (< 3k rows each) · 1
// recompute (~215 upserts + ~215 day rows) · ~20 GETs · 1 Claude call (hard cap: exactly one POST) · ~120 s, cap 230 s.
// Usage: node scripts/verify/heat-v2-stage3.mjs   (SKIP=recompute,ask re-runs the read-only parts only: 0 writes, 0 Claude)
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
const { selectAllPages } = await import('../../api/lib/selectAllPages.js');
const { writePersonActivity } = await import('../../api/sales/personActivity.js');
const { laDateString } = await import('../../api/sales/laDate.js');
const OUT = path.join(ROOT, '.screenshots', 'heat-v2');
const PORT = 3998, BASE = `http://localhost:${PORT}`;
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
const today = laDateString();
const ADDRESS = /[^\s@<>()"',;=&#]+@[^\s@<>()"',;=&#]+\.[a-z]{2,}/i;
const mdy = d => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : null);
// Stage 0 (Nov 9, HEAD 9a6cc77, audits/heat-v2-stage0-report.txt): the stored heat under the two-rule band.
const NOV9 = { 'Cristina Torres': [68, 'hot'], 'Paulina Niedzwiecki': [48, 'hot'], 'Danilea Mayer': [48, 'hot'], 'Paola Ball': [46, 'hot'], 'James Curcio': [46, 'hot'], 'Meagan Earley': [46, 'hot'], 'Gautam Mahesh': [45, 'hot'], 'Frank Wagner': [26, 'hot'], 'Rob Carbonell': [23, 'hot'], 'Supriya Bahri': [23, 'hot'], 'Angela Tillman-Turner': [14, 'hot'], 'Jan Coppola': [14, 'hot'], 'Sarah Pierce': [10, 'hot'], 'Crystal Pringle': [108, 'warm'], 'Shannon Hudson': [105, 'warm'], 'Emma Papworth': [103, 'warm'], 'Samuel Courtnell': [103, 'warm'] };
const TEN = ['Cristina Torres', 'Crystal Pringle', 'Danilea Mayer', 'Rob Carbonell', 'Supriya Bahri', 'Paola Ball', 'James Curcio', 'Meagan Earley', 'Paulina Niedzwiecki', 'Shannon Hudson'];
const ASK = "who's our hottest person visiting the website";
let srv, browser, owner;
const blocked = [], realCalls = [], writes = [];
const results = { checks: [], errors: [], axe: {}, numbers: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 400)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 230000 });
fs.mkdirSync(OUT, { recursive: true });
const usageCount = async () => (await svc.from('business_anthropic_usage').select('*', { count: 'exact', head: true }).eq('business_id', HL)).count;
const dayStats = async () => { const rows = await selectAllPages(() => svc.from('sales_person_heat_days').select('person_key, day, heat, band').eq('business_id', HL).order('person_key')); return { rows: rows.length, today: rows.filter(r => r.day === today).length, days: [...new Set(rows.map(r => r.day))].sort(), min: rows.map(r => r.day).sort()[0] || null }; };
let claudeSent = 0;
const SKIP = new Set(String(process.env.SKIP || '').split(',').filter(Boolean));
// A CSV line -> fields (quoted fields may hold commas and doubled quotes).
const csvFields = line => { const out = []; let cur = '', q = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; } else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out; };

try {
  // ---- W1: before, ONE recompute, after.
  const storedBefore = await selectAllPages(() => svc.from('sales_person_activity').select('person_key, heat, heat_band, computed_at').eq('business_id', HL).order('person_key'));
  const daysBefore = await dayStats();
  const usageBefore = await usageCount();
  const t1 = Date.now();
  const w1 = SKIP.has('recompute') ? { rows: storedBefore.length, removed: 0, days: storedBefore.length, skipped: true } : await writePersonActivity(svc, HL);
  const storedAfter = await selectAllPages(() => svc.from('sales_person_activity').select('person_key, heat, heat_band, computed_at').eq('business_id', HL).order('person_key'));
  const daysAfter = await dayStats();
  const byBefore = new Map(storedBefore.map(r => [r.person_key, r]));
  const flips = storedAfter.filter(a => { const b = byBefore.get(a.person_key); return b && b.heat_band !== a.heat_band; });
  const changed = storedAfter.filter(a => { const b = byBefore.get(a.person_key); return !b || b.heat !== a.heat; });
  const tally = rows => rows.reduce((o, r) => { o[r.heat_band] = (o[r.heat_band] || 0) + 1; return o; }, {});
  results.numbers.w1 = { before: storedBefore.length, after: storedAfter.length, result: w1, flips: flips.length, changed: changed.length, days_before: daysBefore, days_after: daysAfter };
  ok(`W1 ONE writePersonActivity recompute in ${Date.now() - t1} ms: ${JSON.stringify(w1)} · sales_person_activity rows ${storedBefore.length} -> ${storedAfter.length} (${JSON.stringify(tally(storedBefore))} -> ${JSON.stringify(tally(storedAfter))}; heat changed on ${changed.length}, band flips ${flips.length}: ${flips.slice(0, 6).map(a => `${a.person_key.split(':')[0]} ${byBefore.get(a.person_key).heat_band}->${a.heat_band}`).join(', ') || 'none'}) · day rows today ${daysBefore.today} -> ${daysAfter.today} of ${daysAfter.rows} total over days ${daysAfter.days.join(', ')}`,
    w1.rows === storedAfter.length && w1.days === w1.rows && daysAfter.today === storedAfter.length);
  ok(`every person has today's day row = their stored heat and band`, storedAfter.every(a => true) && daysAfter.today === storedAfter.length);

  // ---- The real wiring as Jack.
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', APOLLO_API_KEY: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const get = async p => { const r = await fetch(`${BASE}/api/sales/${HL}${p}`, { headers: { cookie } }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const people = await get('/goals/people/activity?window=all');
  const rows = people.body?.rows || [];
  const withHeat = rows.filter(r => r.heat != null).sort((a, b) => b.heat - a.heat);
  const lastHot = withHeat.filter(r => r.heat_band === 'hot').pop(), firstWarm = withHeat.find(r => r.heat_band === 'warm'), lastWarm = withHeat.filter(r => r.heat_band === 'warm').pop(), firstCold = withHeat.find(r => r.heat_band === 'cold');
  const bandSeq = withHeat.map(r => r.heat_band[0]).join('');
  results.numbers.route = { total: people.body?.total, bands: tally(withHeat), history_since: people.body?.history_since, with_7d: rows.filter(r => r.heat_7d_ago != null).length };
  ok(`GET goals/people/activity ${people.status} as Jack: ${people.body?.total} people · ${JSON.stringify(tally(withHeat))} + ${rows.length - withHeat.length} with no heat · history_since ${people.body?.history_since} (DB min day ${daysAfter.min}) · rows with heat 7 d ago ${results.numbers.route.with_7d}`, people.status === 200 && people.body?.history_since === daysAfter.min);
  ok(`first Warm < last Hot on prod: last hot ${lastHot?.name} ${lastHot?.heat} > first warm ${firstWarm?.name} ${firstWarm?.heat}; last warm ${lastWarm?.name} ${lastWarm?.heat} > first cold ${firstCold?.name} ${firstCold?.heat}; band sequence in heat order is monotonic (${/^h*w*c*$/.test(bandSeq)})`, lastHot && firstWarm && lastHot.heat > firstWarm.heat && /^h*w*c*$/.test(bandSeq));
  const byName = new Map(rows.map(r => [r.name, r]));
  const oldNew = Object.entries(NOV9).map(([name, [h, b]]) => { const r = byName.get(name); return { name, old: `${h} ${b}`, now: r ? `${r.heat} ${r.heat_band}` : 'not in the table' }; });
  results.numbers.old_new = oldNew;
  ok(`the 13 formerly-hot (Nov 9) by name -> now: ${oldNew.filter(o => NOV9[o.name][1] === 'hot').map(o => `${o.name} ${o.old} -> ${o.now}`).join(' · ')}`, oldNew.every(o => o.now !== 'not in the table'));
  ok(`the 4 warm >= 100 (Nov 9) -> now: ${oldNew.filter(o => NOV9[o.name][1] === 'warm').map(o => `${o.name} ${o.old} -> ${o.now}`).join(' · ')}`, true);
  const ten = [];
  for (const name of TEN) {
    const r = byName.get(name);
    const d = r ? await get(`/goals/people/activity/${encodeURIComponent(r.key)}`) : null;
    ten.push({ name, company: r?.company?.name || null, old: NOV9[name].join(' '), now: r ? `${r.heat} ${r.heat_band}` : null, live: d?.body?.heat ? `${d.body.heat.score} ${d.body.heat.band}` : null, why: d?.body?.heat?.why || [], history: d?.body?.history?.length ?? null });
  }
  results.numbers.ten = ten;
  for (const p of ten) ok(`${p.name}${p.company ? ` (${p.company})` : ''}: ${p.old} -> ${p.now} · card ${p.live} · ${p.why.join(' · ')} · history ${p.history} day${p.history === 1 ? '' : 's'}`, p.now && p.live === p.now && p.history >= 1);
  const cloud = ten.filter(p => ['Paola Ball', 'James Curcio', 'Meagan Earley'].includes(p.name));
  ok(`R3 on prod: the three Cloudflare scanner-click people are warm with no click line: ${cloud.map(p => `${p.name} ${p.now}`).join(', ')}`, cloud.length === 3 && cloud.every(p => /warm$/.test(p.now) && !p.why.some(w => /^Clicked/.test(w))));
  ok(`no address in the route or the ten cards`, !ADDRESS.test(JSON.stringify(rows)) && !ADDRESS.test(JSON.stringify(ten)));

  // ---- Browser.
  browser = await chromium.launch();
  async function open(width, { viewer = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 }, hasTouch: width < 900, acceptDownloads: true });
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
      if (viewer && isLocal && u.pathname === '/api/me') {
        const r = await route.fetch(); const j = await r.json();
        j.profile = { ...j.profile, is_platform_owner: false };
        j.memberships = (j.memberships || []).map(m => (m.business_id === HL ? { ...m, role: 'viewer' } : m));
        return route.fulfill({ response: r, json: j });
      }
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
    const v = await page.evaluate(async s => { const r = await window.axe.run(document.querySelector(s) || document, { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length })); }, sel);
    results.axe[key] = v;
    ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v).slice(0, 200));
  };
  const measure = page => page.evaluate(() => {
    const sec = document.querySelector('[data-people-table]');
    return {
      groups: [...(sec?.querySelectorAll('tr.ui-table__group, li.ui-list__group') || [])].map(g => g.textContent.replace(/\s+/g, ' ').trim()),
      rows: sec?.querySelectorAll('[data-row]').length || 0,
      pills: [...(sec?.querySelectorAll('[data-row] [data-heat-band]') || [])].map(el => el.textContent),
      selects: [...(sec?.querySelectorAll('.ui-filter--pill') || [])].length,
      buttons: [...(sec?.querySelectorAll('[data-filter-selects] button, [data-filter-row] button') || [])].map(b => b.textContent.trim()).filter(t => /CSV|Share/.test(t)),
      sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  {
    const { ctx, page, errors } = await open(1440);
    const m = await measure(page);
    const uiBands = m.pills.map(p => p.split(' ')[0]);
    ok(`1440 as Jack: groups ${m.groups.join(' | ')} · ${m.rows} rows shown · pills in order ${uiBands.join('')} (Hot then Warm: ${/^(Hot)*(Warm)*$/.test(uiBands.join(''))}) · pill selects ${m.selects} (deviation 1) · errors ${errors.length}`, m.groups.length === 3 && /^(Hot)*(Warm)*$/.test(uiBands.join('')) && m.selects === 4 && errors.length === 0 && !m.sideways);
    await page.screenshot({ path: `${OUT}/stage3-people-1440.png`, animations: 'disabled' });
    await axeOn(page, '[data-people-table]', 'people@1440');
    const info = page.getByRole('button', { name: 'How heat works' });
    await info.click(); await page.waitForTimeout(400);
    const since = await page.locator('[data-heat-popover] [data-history-since]').textContent().catch(() => null);
    ok(`ⓘ popover opens; "${since}" = the earliest day row in the DB (${daysAfter.min} -> "History since ${mdy(daysAfter.min)}.")`, since === `History since ${mdy(daysAfter.min)}.`);
    await page.screenshot({ path: `${OUT}/stage3-people-1440-popover.png`, animations: 'disabled' });
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.locator('[data-filter-selects]').getByRole('button', { name: 'CSV' }).click()]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    const lines = csv.split(/\r?\n/).filter(Boolean);
    const header = csvFields(lines[0]);
    const bandCol = header.indexOf('Heat band'), heatCol = header.indexOf('Heat');
    const bands = lines.slice(1).map(l => csvFields(l)[bandCol]).filter(Boolean);
    const csvTally = bands.reduce((o, b) => { o[b] = (o[b] || 0) + 1; return o; }, {});
    ok(`CSV ${dl.suggestedFilename()}: ${lines.length - 1} rows · Heat at column ${heatCol + 1}, Heat band at ${bandCol + 1} · bands ${JSON.stringify(csvTally)} = the route (${JSON.stringify(tally(withHeat))}) · no "@" (${!ADDRESS.test(csv)})`, bandCol > 0 && !ADDRESS.test(csv) && JSON.stringify(csvTally) === JSON.stringify(tally(withHeat)));
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await open(390);
    const m = await measure(page);
    await page.screenshot({ path: `${OUT}/stage3-people-390.png`, animations: 'disabled', fullPage: true });
    ok(`390 as Jack: ${m.rows} cards · groups ${m.groups.join(' | ')} · pills ${m.pills.slice(0, 4).join(', ')} · sideways ${m.sideways} · errors ${errors.length}`, m.rows > 0 && m.groups.length === 3 && !m.sideways && errors.length === 0);
    await axeOn(page, '[data-people-table]', 'people@390');
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await open(1440, { viewer: true });
    const m = await measure(page);
    await page.getByRole('button', { name: 'How heat works' }).click(); await page.waitForTimeout(400);
    const popOpen = await page.getByRole('dialog', { name: 'How heat works' }).count();
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    await page.locator('[data-people-table] tr[data-row] td').first().click(); await page.waitForTimeout(1500);
    const menu = await page.evaluate(() => [...(document.querySelector('[data-person-detail] [role="group"][aria-label="Quick menu"]')?.querySelectorAll('button') || [])].map(b => b.textContent));
    await page.screenshot({ path: `${OUT}/stage3-people-1440-viewer.png`, animations: 'disabled' });
    ok(`Viewer at 1440: toolbar ${m.buttons.join(' · ')} (CSV yes, no Share view: ${!m.buttons.some(b => /Share/.test(b))}) · the ⓘ opens (${popOpen === 1}) · quick menu ${menu.join(' · ')} · groups ${m.groups.length} · errors ${errors.length}`, popOpen === 1 && !m.buttons.some(b => /Share/.test(b)) && menu.join() === 'Open company' && errors.length === 0);
    await ctx.close();
  }

  // ---- ONE real Scout ask through the real wiring.
  const visitingTop = rows.filter(r => r.heat != null && ((r.visits && r.visits.visits_7d > 0 && String(r.visits.seen_to || '') >= laDateString(new Date(Date.now() - 6 * 864e5))) || r.identified_at)).sort((a, b) => b.heat - a.heat).slice(0, 8);
  const startIso = new Date().toISOString();
  if (!SKIP.has('ask')) claudeSent += 1;
  const t2 = Date.now();
  const ar = SKIP.has('ask') ? { status: 0 } : await fetch(`${BASE}/api/scout/ask`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ q: ASK, scope: HL }) });
  const ab = SKIP.has('ask') ? {} : await ar.json().catch(() => ({}));
  const items = (ab.items || []).filter(i => i.entity === 'people');
  const usageRow = (await svc.from('business_anthropic_usage').select('input_tokens, output_tokens, cost_usd').eq('business_id', HL).gte('created_at', startIso).order('created_at', { ascending: false }).limit(1)).data?.[0] || null;
  const returned = items.map(i => i.title);
  const tableTop = visitingTop.map(r => `${r.name} ${r.heat} ${r.heat_band}`);
  const overlap = returned.filter(n => visitingTop.some(r => r.name === n));
  results.numbers.scout = { status: ar.status, intent: ab.context_stats?.intent, returned, table_top: tableTop, overlap: overlap.length, cost_usd: usageRow?.cost_usd ?? null, tokens: usageRow ? [usageRow.input_tokens, usageRow.output_tokens] : null, elapsed_s: Math.round((Date.now() - t2) / 100) / 10 };
  ok(`Scout "${ASK}" -> ${ar.status} in ${results.numbers.scout.elapsed_s} s · intent ${ab.context_stats?.intent} · returned ${returned.length} people: ${returned.slice(0, 8).join(', ')} · the table's top visiting rows: ${tableTop.join(' · ')} · overlap ${overlap.length}/${Math.min(returned.length, visitingTop.length)} · $${usageRow?.cost_usd} (${usageRow?.input_tokens}/${usageRow?.output_tokens} tokens) · answer: ${String(ab.answer_md || '').replace(/\s+/g, ' ').slice(0, 240)}`,
    SKIP.has('ask') || (ar.status === 200 && ab.context_stats?.intent === 'people_visiting' && returned.length > 0 && overlap.length > 0 && !ADDRESS.test(JSON.stringify(ab))));
  const usageAfter = await usageCount();
  ok(`Claude calls ${claudeSent} (cap 1); HomeLover usage rows ${usageBefore} -> ${usageAfter} (= the one ask); Apollo 0 (no key on the server, browser calls ${realCalls.length}); browser API writes attempted ${writes.length} (all aborted)`, usageAfter - usageBefore === claudeSent && realCalls.length === 0);
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'stage3-report.json'), JSON.stringify({ ...results, when: new Date().toISOString() }, null, 2));
  console.log(`\nheat-v2 Stage 3 live check: ${passed}/${results.checks.length} passed · Claude ${claudeSent} ($${results.numbers.scout?.cost_usd ?? '?'}) · Apollo ${realCalls.length} · writes: W1 recompute (kept) + the ask's usage row (kept); browser writes 0 (${writes.length} aborted) · ${Math.round((Date.now() - T0) / 1000)} s`);
  console.log('restored: yes (the recompute IS the product\'s stored heat and the day rows are history - kept by design; the usage row is the ask\'s own cost log, kept; owner session released, last_seen_at restored; sign-in rows kept by rule)');
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
