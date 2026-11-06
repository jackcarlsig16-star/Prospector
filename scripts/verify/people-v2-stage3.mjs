// people-v2 Stage 3 live check - localhost against the build, as Jack (ownerSession) on the REAL HomeLover workspace.
// Read-only but for the ONE declared write pair: Share view › Save view through the real wiring (POST goals/people/views)
// and its × (DELETE …/views/:id); sales_settings (saved_views + updated_at) is snapshotted first and restored exactly
// after. Every other non-GET API call and every Supabase write is aborted at the network layer and counted; 0 Claude,
// 0 Apollo (the server runs with both keys empty, the browser's calls to either host are aborted).
// Proves, on today's real rows: the 1440 fit (the table's width = the card's, no sideways scroll in the box, the last
// column whole, the 10 headers with Identified / Buyer as glyph columns); 10 named people's cells = GET
// goals/people/activity = the raw tables (sales_person_activity, GET /huddle/live for prospects, web_visits for the
// company); every chip's count = a raw query over the source tables; Hilton's people carry Hilton's web_visits row; a
// visitor-identified person carries its filing date; the CSV download has no "@"; a Viewer (/api/me downgraded) gets no
// Share view and a quick menu of Open company only; 390 = cards, scrolling chips, the Filters sheet; axe 0 at both.
// Side-by-side PNGs: the sketch's frame beside the build at 1440 and 390 (deviations numbered in the report).
// Declared scope: 4 page loads, ~14 GETs, ~12 table reads (< 2k rows each), 11 table counts twice, 2 API writes
// (POST + DELETE of one saved view) + 1 restore update. ~150 s, cap 240 s.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { ownerSession } from './lib/ownerSession.mjs';
import { CSV_COLUMNS } from '../../src/components/salesAnalytics/people/peopleTableModel.js';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const AXE = fs.readFileSync(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const { normName } = await import('../../api/sales/intakeMatch.js');
const OUT = path.join(ROOT, '.screenshots', 'people-v2-stage3');
const SKETCH = path.join(ROOT, 'specs', 'design', 'people-v2', 'People.html');
const PORT = 3995, BASE = `http://localhost:${PORT}`;
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
const LA = 'America/Los_Angeles';
const today = new Date().toLocaleDateString('en-CA', { timeZone: LA });
const md = iso => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: LA }) : '');
const mdy = d => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
let srv, browser, owner;
const blocked = [], realCalls = [], writes = [];
const results = { checks: [], errors: [], axe: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 240000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));
const settingsBefore = (await svc.from('sales_settings').select('saved_views, updated_at').eq('business_id', HL).maybeSingle()).data;
const HEADERS = ['Person', 'Company', 'Source', 'Emails (human opens)', 'Last email', 'Heat', 'Company visits', 'Identified', 'Buyer', 'Last touch'];
const CHIP_LABEL = { opened: 'Opened', clicked: 'Clicked', replied: 'Replied', sent: 'Sent (any)', identified: 'Identified visitor', visited_7d: 'Company visited 7 d', buyer: 'Buyer title', hot: 'Hot', needs_touch: 'Needs a touch', mine: 'Mine' };
const VIEW_NAME = `stage3 verify ${Date.now().toString(36)}`;
const keyOf = k => k.replace(/[^A-Za-z0-9_-]/g, '_');
let viewWrites = 0;

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', ANTHROPIC_API_KEY: '', APOLLO_API_KEY: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const get = async p => { const r = await fetch(`${BASE}/api/sales/${HL}${p}`, { headers: { cookie } }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const act = await get('/goals/people/activity?window=all');
  ok(`GET goals/people/activity 200 (${act.status}): ${act.body?.total} people, counts ${JSON.stringify(act.body?.counts)}, heat pending ${act.body?.heat_pending}`, act.status === 200 && act.body?.rows?.length);
  const route = act.body;
  const routeBy = new Map(route.rows.map(r => [r.key, r]));

  // ---- Raw tables (the service key, read-only).
  const all = (table, cols, build = x => x) => build(svc.from(table).select(cols).eq('business_id', HL)).limit(5000).then(r => { if (r.error) throw new Error(r.error.message); return r.data; });
  const [prospects, salesPeople, partnerContacts, opportunities, targets, partners, visits, settings, summary] = await Promise.all([
    all('sales_prospect_state', 'contact_id, name, title, company, opportunity_id, goal_id, status, owner'),
    all('sales_people', 'id, company_type, opportunity_id, target_id, name, title, source_kind, visit_id, upload_id, archived_at, created_at, company_name'),
    all('partner_contacts', 'id, goal_id, name, title, apollo_contact_id, last_activity_at'),
    all('sales_opportunities', 'id, organization, stage, owner_user_id, archived_at'),
    all('sales_targets', 'id, name, status, owner_user_id'),
    all('sales_goals', 'id, name, pipeline_status, owner_user_id', x => x.eq('goal_type', 'partnership')),
    all('web_visits', 'id, company_key, company_name, matched_type, matched_id, visits_7d, last_visit, seen_to, top_paths, pulled_on'),
    svc.from('sales_settings').select('buyer_titles').eq('business_id', HL).maybeSingle().then(r => r.data),
    all('sales_person_activity', 'person_key, contact_id, sent, opened_h, clicked, replied, last_sent_at, last_open_at, last_click_at, last_reply_at, heat, heat_band'),
  ]);
  const summaryBy = new Map(summary.map(a => [a.person_key, a]));
  const latest = new Map();
  for (const v of visits) { const c = latest.get(v.company_key); if (!c || v.pulled_on > c.pulled_on) latest.set(v.company_key, v); }
  const sevenDays = addDays(today, -6);
  const visitedKeys = new Set(), visitedNames = new Set();
  for (const v of latest.values()) { if (Number(v.visits_7d) > 0 && String(v.seen_to || v.pulled_on) >= sevenDays) { if (v.matched_type && v.matched_id) visitedKeys.add(`${v.matched_type}:${v.matched_id}`); visitedNames.add(v.company_key); } }
  const oppBy = new Map(opportunities.map(o => [o.id, o])), tgtBy = new Map(targets.map(t => [t.id, t])), goalBy = new Map(partners.map(g => [g.id, g]));
  const buyerTitles = (settings?.buyer_titles || []).map(b => String(b).toLowerCase()).filter(Boolean);
  const isBuyer = t => { const x = String(t || '').toLowerCase(); return !!x && buyerTitles.some(b => x.includes(b) || b.includes(x)); };
  const hasName = n => { const t = String(n || '').trim(); return !!t && !/^[^\s@]+@[^\s@]+$/.test(t); };
  // One raw row per source record with everything a chip needs (the merge is the route's business - the Stage 0 overlap
  // is 1 visitor who is also a prospect, by name + company; the delta is reported if it shows).
  const raw = [];
  for (const p of prospects) {
    if (!hasName(p.name)) continue;
    const o = p.opportunity_id && oppBy.get(p.opportunity_id), g = p.goal_id && goalBy.get(p.goal_id);
    const coKey = o && !o.archived_at ? `opportunity:${o.id}` : g ? `partner:${g.id}` : null;
    const coName = o && !o.archived_at ? o.organization : g ? g.name : p.company;
    const a = summaryBy.get(`prospect:${p.contact_id}`);
    raw.push({ key: `prospect:${p.contact_id}`, name: p.name, title: p.title, a, coKey, coName, identified: null, touch: [a?.last_sent_at, a?.last_open_at, a?.last_click_at, a?.last_reply_at].filter(Boolean).sort().pop() || null, ownerUser: (o && !o.archived_at ? o.owner_user_id : g?.owner_user_id) || null, ownerSlug: p.owner || null });
  }
  for (const p of salesPeople) {
    if (p.archived_at || !hasName(p.name)) continue;
    const o = p.company_type === 'employer' && p.opportunity_id && oppBy.get(p.opportunity_id), t = p.target_id && tgtBy.get(p.target_id);
    const coKey = o && !o.archived_at ? `opportunity:${o.id}` : t ? `target:${t.id}` : null;
    const coName = o && !o.archived_at ? o.organization : t ? t.name : p.company_name;
    raw.push({ key: `person:${p.id}`, name: p.name, title: p.title, a: null, coKey, coName, identified: p.source_kind === 'web_visit' || p.visit_id ? p.created_at : null, touch: null, ownerUser: (o && !o.archived_at ? o.owner_user_id : t?.owner_user_id) || null, ownerSlug: null });
  }
  for (const c of partnerContacts) {
    if (!hasName(c.name)) continue;
    const g = goalBy.get(c.goal_id);
    const a = summaryBy.get(`contact:${c.id}`) || (c.apollo_contact_id && summary.find(x => x.contact_id === c.apollo_contact_id)) || null;
    raw.push({ key: `contact:${c.id}`, name: c.name, title: c.title, a, coKey: g ? `partner:${g.id}` : null, coName: g?.name, identified: null, touch: [a?.last_sent_at, a?.last_open_at, a?.last_click_at, a?.last_reply_at, c.last_activity_at].filter(Boolean).sort().pop() || null, ownerUser: g?.owner_user_id || null, ownerSlug: null });
  }
  const visited = r => (r.coKey && visitedKeys.has(r.coKey)) || (r.coName && visitedNames.has(normName(r.coName)));
  const needsSince = new Date(Date.now() - 14 * 864e5).toISOString();
  const mySlug = (owner.userId && (await svc.from('profiles').select('display_name').eq('id', owner.userId).maybeSingle()).data?.display_name || 'Jack').trim().split(/\s+/)[0].toLowerCase();
  // The spec's P2 merge over the raw rows: the same Apollo contact id, else the same normalised name at the same
  // normalised company -> one person; a chip counts the person when any of its records qualifies.
  const groups = new Map();
  for (const r of raw) {
    const apollo = r.key.startsWith('prospect:') ? r.key.slice(9) : r.key.startsWith('contact:') ? partnerContacts.find(c => `contact:${c.id}` === r.key)?.apollo_contact_id : null;
    const gk = apollo && raw.some(x => x !== r && ((x.key.startsWith('prospect:') && x.key.slice(9) === apollo) || (x.key.startsWith('contact:') && partnerContacts.find(c => `contact:${c.id}` === x.key)?.apollo_contact_id === apollo))) ? `a:${apollo}` : `n:${normName(r.name)}|${normName(r.coName || '')}`;
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk).push(r);
  }
  const people = [...groups.values()];
  const merged = people.filter(g => g.length > 1);
  const any = (g, f) => g.some(f);
  const rawCounts = {
    opened: people.filter(g => any(g, r => Number(r.a?.opened_h) > 0)).length, clicked: people.filter(g => any(g, r => Number(r.a?.clicked) > 0)).length, replied: people.filter(g => any(g, r => Number(r.a?.replied) > 0)).length, sent: people.filter(g => any(g, r => Number(r.a?.sent) > 0)).length,
    identified: people.filter(g => any(g, r => r.identified)).length, visited_7d: people.filter(g => any(g, visited)).length, buyer: people.filter(g => any(g, r => isBuyer(r.title))).length, hot: people.filter(g => any(g, r => r.a?.heat_band === 'hot')).length,
    needs_touch: people.filter(g => { const t = g.map(r => r.touch).filter(Boolean).sort().pop() || null; return !t || t < needsSince; }).length,
    mine: people.filter(g => any(g, r => r.ownerUser === owner.userId || r.ownerSlug === mySlug)).length,
  };
  const chipDiff = Object.keys(rawCounts).filter(k => k !== 'mine' && rawCounts[k] !== route.counts[k]).map(k => `${k} raw ${rawCounts[k]} vs route ${route.counts[k]}`);
  ok(`each chip's count = a raw query over the source tables (${raw.length} raw rows -> ${people.length} people by the P2 rule = the route's ${route.total}; merged: ${merged.map(g => `${g[0].name} = ${g.map(r => r.key.split(':')[0]).join(' + ')}`).join(', ') || 'none'}): ${Object.entries(rawCounts).map(([k, v]) => `${k} ${v}`).join(' · ')}${chipDiff.length ? `; differ: ${chipDiff.join(', ')}` : '; all nine equal'}`, chipDiff.length === 0 && people.length === route.total);

  // ---- 10 named people: the route row vs the raw tables (summary, /huddle/live for prospects, web_visits for the company).
  const live = await get('/huddle/live?limit=1000&show_closed=1&show_bots=1');
  const liveBy = new Map((live.body?.rows || []).map(r => [r.contact_id, r]));
  const hilton = opportunities.find(o => /^hilton$/i.test(String(o.organization).trim()) && !o.archived_at);
  const hiltonRows = route.rows.filter(r => r.company?.type === 'employer' && r.company.id === hilton?.id);
  const pick = [];
  const add = r => { if (r && !pick.some(p => p.key === r.key) && pick.length < 10) pick.push(r); };
  route.rows.filter(r => r.key.startsWith('prospect:') && r.emails.replied > 0).slice(0, 2).forEach(add);
  route.rows.filter(r => r.key.startsWith('prospect:') && r.emails.clicked > 0).slice(0, 2).forEach(add);
  hiltonRows.slice(0, 2).forEach(add);
  add(route.rows.find(r => r.key.startsWith('person:') && r.identified_at));
  add(route.rows.find(r => r.key.startsWith('contact:')));
  add(route.rows.find(r => r.buyer && r.key.startsWith('prospect:')));
  route.rows.filter(r => r.key.startsWith('prospect:')).forEach(add);
  const personChecks = pick.map(r => {
    const a = summaryBy.get(r.key) || null, l = r.key.startsWith('prospect:') ? liveBy.get(r.key.slice(9)) : null;
    const rawRow = raw.find(x => x.key === r.key);
    const v = rawRow?.coKey && [...latest.values()].find(x => `${x.matched_type}:${x.matched_id}` === rawRow.coKey) || (rawRow?.coName && latest.get(normName(rawRow.coName))) || null;
    const sumOk = a ? Number(a.sent) === r.emails.sent && Number(a.opened_h) === r.emails.opened && Number(a.clicked) === r.emails.clicked && Number(a.replied) === r.emails.replied && (a.heat ?? null) === r.heat : r.emails.sent === 0 && r.emails.opened === 0 && r.emails.clicked === 0 && r.emails.replied === 0 && r.heat == null;
    const liveOk = l ? l.sent === r.emails.sent && l.real_opens === r.emails.opened && l.human_clicks === r.emails.clicked && !!l.replied === (r.emails.replied > 0) : r.key.startsWith('prospect:') ? false : true;
    const visitsOk = v ? r.visits && Number(v.visits_7d) === r.visits.visits_7d && String(v.last_visit || v.seen_to) === String(r.visits.last_visit) : !r.visits;
    const idOk = r.key.startsWith('person:') ? String(rawRow?.identified || '').slice(0, 10) === String(r.identified_at || '') : !r.identified_at;
    return { name: r.name, key: r.key, src: r.source, emails: `${r.emails.sent}·${r.emails.opened}·${r.emails.clicked}·${r.emails.replied}`, heat: r.heat, visits: r.visits ? `${r.visits.visits_7d}/${r.visits.last_visit}` : '—', identified: r.identified_at, buyer: r.buyer, sumOk, liveOk, visitsOk, idOk, buyerOk: isBuyer(r.title) === r.buyer };
  });
  const bad = personChecks.filter(p => !(p.sumOk && p.liveOk && p.visitsOk && p.idOk && p.buyerOk));
  ok(`10 named people, the route row = the raw tables (summary counts + heat, /huddle/live sent · human opens · human clicks · replied for prospects, web_visits for the company, the filing date, the buyer rule): ${personChecks.map(p => `${p.name} [${p.src}] ${p.emails}${p.visits !== '—' ? ` v${p.visits}` : ''}${p.identified ? ` id ${p.identified}` : ''}${p.buyer ? ' buyer' : ''}`).join(' | ')}${bad.length ? `; BAD ${bad.map(p => `${p.name} sum ${p.sumOk} live ${p.liveOk} visits ${p.visitsOk} id ${p.idOk} buyer ${p.buyerOk}`).join('; ')}` : ''}`, pick.length === 10 && bad.length === 0);
  const hiltonVisit = hilton && [...latest.values()].find(v => v.matched_type === 'opportunity' && v.matched_id === hilton.id);
  ok(`Hilton's ${hiltonRows.length} people carry Hilton's web_visits row (${hiltonVisit ? `${hiltonVisit.visits_7d} visits 7 d · last ${hiltonVisit.last_visit}` : 'no row'}): ${hiltonRows.map(r => `${r.name} ${r.visits ? `${r.visits.visits_7d}/${r.visits.last_visit}` : '—'}`).join(', ')}`, hiltonRows.length > 0 && hiltonVisit && hiltonRows.every(r => r.visits && r.visits.visits_7d === Number(hiltonVisit.visits_7d) && r.visits.last_visit === hiltonVisit.last_visit));

  browser = await chromium.launch();
  async function openPeople(width, { viewer = false } = {}) {
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
      const viewWrite = apiWrite && !viewer && ((req.method() === 'POST' && u.pathname === `/api/sales/${HL}/goals/people/views`) || (req.method() === 'DELETE' && u.pathname.startsWith(`/api/sales/${HL}/goals/people/views/`)));
      if (apiWrite) writes.push(`${req.method()} ${u.pathname}`);
      if (viewWrite) { viewWrites += 1; return route.continue(); }
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
  const axeOn = async (page, key) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async () => { const r = await window.axe.run(document.querySelector('[data-people-table]') || document, { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); });
    results.axe[key] = v;
    ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v).slice(0, 300));
  };
  const info = page => page.evaluate(() => {
    const sec = document.querySelector('[data-people-table]');
    const box = sec.querySelector('.ui-table-box'), table = sec.querySelector('table.ui-table');
    const ths = [...sec.querySelectorAll('th')];
    const rows = [...sec.querySelectorAll('[data-row]')].map(el => {
      const tds = [...el.querySelectorAll('td')];
      return { key: el.dataset.key, name: el.querySelector('[data-person-name]')?.textContent, cells: tds.map(td => ({ text: td.textContent.trim(), title: td.getAttribute('title') || '' })), identified: el.querySelector('[data-identified]')?.dataset.identified || null, buyer: !!el.querySelector('[data-buyer]'), heat: el.querySelector('[data-heat-band]') ? { band: el.querySelector('[data-heat-band]').dataset.heatBand, text: el.querySelector('[data-heat-band]').textContent } : null };
    });
    const chips = [...sec.querySelectorAll('[data-people-chips] button')].map(b => b.textContent.trim());
    const lastTh = ths[ths.length - 1];
    return {
      headers: ths.map(h => h.textContent.replace(/^[◉✓]/, '').replace(/\s*[↕▲▼]\s*$/, '').trim()),
      rows, chips,
      fit: box && table ? { boxClient: box.clientWidth, boxScroll: box.scrollWidth, table: table.getBoundingClientRect().width, lastThRight: Math.round(lastTh.getBoundingClientRect().right), boxRight: Math.round(box.getBoundingClientRect().right), colWidths: [...sec.querySelectorAll('colgroup col')].map(c => c.style.width) } : null,
      showing: (sec.querySelector('[data-active-filters]') || sec.querySelector('.ui-active-filters') || sec.querySelector('[data-active-filter-line]'))?.textContent?.trim() || [...sec.querySelectorAll('span, div')].map(e => e.textContent.trim()).find(t => /^Showing \d+ of \d+/.test(t)) || '',
      footnote: sec.querySelector('[data-heat-footnote]')?.textContent || '',
      detail: sec.querySelector('[data-person-detail]') ? { key: sec.querySelector('[data-person-detail]').dataset.personDetail, timeline: sec.querySelectorAll('[data-person-detail] [data-timeline-kind]').length, menu: [...sec.querySelectorAll('[data-person-detail] [role=group][aria-label="Quick menu"] button')].map(b => b.textContent.trim()), buttons: sec.querySelectorAll('[data-person-detail] button').length, text: sec.querySelector('[data-person-detail]').textContent } : null,
      buttons: [...sec.querySelectorAll('[data-filter-row] button')].map(b => b.textContent.trim()),
      text: sec.textContent, cards: sec.querySelectorAll('.ui-list__row').length,
      chipsScroll: (() => { const c = sec.querySelector('[data-people-chips]'); return c ? c.scrollWidth > c.clientWidth + 1 : null; })(),
      selectsInline: !!sec.querySelector('[data-filter-selects]'),
      sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });

  // ---- 1440 as Jack: the fit, the cells vs the route for the 10 people, Hilton, Identified, CSV, Save view, axe.
  {
    const { ctx, page, errors } = await openPeople(1440);
    const h = await info(page);
    ok(`1440 headers ${h.headers.join(' · ')} (Identified / Buyer as glyph columns ◉ / ✓ with sr-only names)`, h.headers.join('|') === HEADERS.join('|'));
    ok(`1440 the table fits the card: table ${Math.round(h.fit.table)} px = box ${h.fit.boxClient} px, scrollWidth ${h.fit.boxScroll} (no sideways scroll in the box), Last touch's right edge ${h.fit.lastThRight} ≤ the box's ${h.fit.boxRight}; widths ${h.fit.colWidths.join(' ')}; page not sideways (${!h.sideways})`, h.fit.boxScroll <= h.fit.boxClient + 1 && Math.round(h.fit.table) <= h.fit.boxClient && h.fit.lastThRight <= h.fit.boxRight && !h.sideways);
    ok(`1440 ${h.rows.length} rows = the route's ${route.rows.length}, in its order; "${h.showing}"`, h.rows.map(r => r.key).join('|') === route.rows.map(r => keyOf(r.key)).join('|') && h.showing.startsWith(`Showing ${route.total} of ${route.total}`));
    const uiBy = new Map(h.rows.map(r => [r.key, r]));
    const cellBad = pick.filter(r => {
      const u = uiBy.get(keyOf(r.key)); if (!u) return true;
      const c = u.cells;
      const emailsOk = c[3].title === `${r.emails.sent} sent · ${r.emails.opened} opened (human) · ${r.emails.clicked} clicked · ${r.emails.replied} replied` && c[3].text.replace(/\s+/g, ' ').includes(`${r.emails.sent} sent · ${r.emails.opened} opened`) && c[3].text.replace(/\s+/g, ' ').includes(`${r.emails.clicked} clicked · ${r.emails.replied} replied`);
      const lastOk = r.last_email ? c[4].text.startsWith(md(r.last_email.at)) && c[4].text.includes(r.last_email.what) : c[4].text === '—';
      const heatOk = r.heat == null ? c[5].text === '—' : u.heat && u.heat.band === r.heat_band && u.heat.text === `${r.heat} · ${r.heat_band}`;
      const visitsOk = r.visits ? c[6].text.includes(`${r.visits.visits_7d}`) && c[6].text.includes(`last ${mdy(r.visits.last_visit)}`) && c[6].title.startsWith(`${r.visits.visits_7d} visits 7 d · last ${mdy(r.visits.last_visit)}`) : c[6].text === '—';
      const idOk = r.identified_at ? u.identified === r.identified_at && c[7].title.includes(mdy(r.identified_at)) : c[7].text === '—';
      const buyerOk = u.buyer === !!r.buyer;
      const touchOk = r.last_touch_at ? c[9].text === md(r.last_touch_at) : c[9].text === '—';
      return !(emailsOk && lastOk && heatOk && visitsOk && idOk && buyerOk && touchOk);
    });
    ok(`1440 the 10 people's cells = the route row (emails · last email · heat · visits · identified · buyer · last touch): ${pick.map(r => r.name).join(', ')}${cellBad.length ? `; BAD ${cellBad.map(r => r.name).join(', ')}` : ''}`, cellBad.length === 0);
    const hiltonUi = hiltonRows.map(r => uiBy.get(keyOf(r.key)));
    ok(`1440 Hilton's people show Hilton's visits: ${hiltonUi.map(u => `${u?.name}: ${u?.cells[6].text.replace(/\s+/g, ' ')}`).join(' | ')}`, hiltonUi.length > 0 && hiltonUi.every(u => u && hiltonVisit && u.cells[6].text.includes(String(hiltonVisit.visits_7d)) && u.cells[6].text.includes(`last ${mdy(hiltonVisit.last_visit)}`)));
    const idRow = pick.find(r => r.key.startsWith('person:') && r.identified_at), idUi = idRow && uiBy.get(keyOf(idRow.key));
    const idRaw = idRow && salesPeople.find(p => `person:${p.id}` === idRow.key);
    ok(`1440 a visitor-identified person (${idRow?.name}) shows the Identified glyph with the filing date: data-identified ${idUi?.identified} = sales_people.created_at ${String(idRaw?.created_at).slice(0, 10)}, title "${idUi?.cells[7].title}"`, idRow && idUi && idUi.identified === String(idRaw.created_at).slice(0, 10) && idUi.cells[7].title.includes(mdy(idRaw.created_at)));
    const chipBad = Object.entries(CHIP_LABEL).filter(([id, label]) => { const c = h.chips.find(t => t.startsWith(label)); const exp = id === 'mine' ? rawCounts.mine : route.counts[id]; return !c || c.replace(/\s+/g, '') !== `${label}(${exp})`.replace(/\s+/g, ''); });
    ok(`1440 chips = the route's counts, Mine (${h.chips.find(t => t.startsWith('Mine'))}) = the raw owner query ${rawCounts.mine}: ${h.chips.join(' | ')}; bad ${chipBad.map(([id]) => id).join(',') || 'none'}`, chipBad.length === 0);
    ok(`1440 no address in the section (${!/@/.test(h.text)}), 0 page errors`, !/@/.test(h.text) && !errors.length, errors.join(' | '));
    await page.screenshot({ path: `${OUT}/people-1440.png`, animations: 'disabled' });
    await axeOn(page, 'people@1440');
    // CSV: the real download, no "@", the model's columns, one line per row.
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.locator('[data-filter-row]').getByRole('button', { name: 'CSV' }).click()]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    const lines = csv.split(/\r?\n/).filter(Boolean);
    ok(`1440 CSV ${dl.suggestedFilename()}: ${lines.length - 1} rows + header (= ${route.rows.length}), header = the model's ${CSV_COLUMNS.length} columns, no "@" (${!/@/.test(csv)})`, lines.length - 1 === route.rows.length && lines[0] === CSV_COLUMNS.map(c => c.label).join(',') && !/@/.test(csv));
    // Share view: Save view through the real wiring, then its ×; the only writes.
    await page.locator('[data-filter-row]').getByRole('button', { name: /^Share view/ }).click(); await page.waitForTimeout(400);
    await page.locator('[data-people-chips] button', { hasText: /^Opened/ }).click(); await page.waitForTimeout(300);
    await page.getByLabel('View name').fill(VIEW_NAME);
    await page.getByRole('button', { name: 'Save view' }).click(); await page.waitForTimeout(2000);
    const saved = (await svc.from('sales_settings').select('saved_views').eq('business_id', HL).maybeSingle()).data?.saved_views || [];
    const mine = saved.find(v => v.kind === 'people' && v.name === VIEW_NAME);
    const savedBtn = await page.getByRole('button', { name: VIEW_NAME, exact: true }).count();
    ok(`1440 Save view "${VIEW_NAME}" (POST goals/people/views) lands in sales_settings.saved_views kind people with chips ${JSON.stringify(mine?.state?.chips)}, shown as a button (${savedBtn}); writes so far ${viewWrites}`, mine && mine.state.chips.join() === 'opened' && savedBtn === 1 && viewWrites === 1);
    await page.getByRole('button', { name: `Delete view ${VIEW_NAME}` }).click(); await page.waitForTimeout(2000);
    const after = (await svc.from('sales_settings').select('saved_views').eq('business_id', HL).maybeSingle()).data?.saved_views || [];
    ok(`1440 its × (DELETE …/views/:id) removes it: saved_views ${saved.length} -> ${after.length} = before ${(settingsBefore?.saved_views || []).length}, deep-equal to the snapshot (${JSON.stringify(after) === JSON.stringify(settingsBefore?.saved_views || [])}); view writes ${viewWrites}`, JSON.stringify(after) === JSON.stringify(settingsBefore?.saved_views || []) && viewWrites === 2);
    await page.locator('[data-people-chips] button', { hasText: /^Opened/ }).click(); await page.waitForTimeout(300);
    // Row click still pins the card; Esc closes.
    const first = route.rows[0];
    await page.locator('[data-people-table] [data-row]').first().locator('td').nth(2).click(); await page.waitForTimeout(2000);
    const hd = await info(page);
    ok(`1440 row click pins ${first.name}'s card with the quick menu ${hd.detail?.menu.join(' · ')}`, hd.detail && hd.detail.key === first.key && hd.detail.menu.join('|') === 'Open company|Draft email|Log call|Add to-do|Mark contacted|Not a fit');
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    ok('1440 Esc closes the card', (await info(page)).detail === null);
    await ctx.close();
  }
  // ---- 1440 as a Viewer: CSV yes, no Share view, the quick menu is Open company only.
  {
    const { ctx, page, errors } = await openPeople(1440, { viewer: true });
    const h = await info(page);
    await page.locator('[data-people-table] [data-row]').first().locator('td').nth(2).click(); await page.waitForTimeout(2000);
    const hd = await info(page);
    ok(`Viewer: ${h.rows.length} rows, toolbar buttons ${h.buttons.join(' · ')} (CSV yes, no Share view), the card's quick menu ${hd.detail?.menu.join(' · ')} (${hd.detail?.buttons} buttons in the card), 0 page errors`, h.rows.length === route.rows.length && h.buttons.includes('CSV') && !h.buttons.some(b => /Share view/.test(b)) && hd.detail && hd.detail.menu.join('|') === 'Open company' && !errors.length, errors.join(' | '));
    await page.screenshot({ path: `${OUT}/people-viewer-1440.png`, animations: 'disabled' });
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
      await compose.setContent(`<body style="margin:0;background:#000;color:#fff;font:12px monospace"><div style="display:flex;gap:16px;align-items:flex-start;padding:16px"><figure style="margin:0"><figcaption style="padding:4px 0">sketch · People.html #s${w}</figcaption><img style="width:${w}px;display:block" src="data:image/png;base64,${b64(sk)}"></figure><figure style="margin:0"><figcaption style="padding:4px 0">build · Pipeline › People at ${w} (HomeLover, as Jack) · Stage 3</figcaption><img style="width:${w}px;display:block" src="data:image/png;base64,${b64(bd)}"></figure></div></body>`);
      await compose.waitForTimeout(500);
      await compose.screenshot({ path: `${OUT}/side-by-side-${w}.png`, fullPage: true });
      await compose.close();
    }
    ok('side-by-side-1440.png + side-by-side-390.png written (sketch | build)', true);
    await ctx.close();
  }
  const otherWrites = writes.filter(w => !/goals\/people\/views/.test(w));
  ok(`browser reached 0 Claude / Apollo hosts (${realCalls.length}); the only API writes were the view's POST + DELETE (${viewWrites}); every other non-GET aborted (${[...new Set(otherWrites)].join(', ') || 'none attempted'})`, !realCalls.length && viewWrites === 2 && otherWrites.every(w => blocked.includes(w)));
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    // The view's save + delete moved sales_settings.updated_at; put it back exactly, with the saved_views snapshot.
    if (settingsBefore) {
      const cur = (await svc.from('sales_settings').select('saved_views, updated_at').eq('business_id', HL).maybeSingle()).data;
      const stale = cur && JSON.stringify(cur.saved_views) !== JSON.stringify(settingsBefore.saved_views);
      const r = await svc.from('sales_settings').update({ saved_views: settingsBefore.saved_views, updated_at: settingsBefore.updated_at }).eq('business_id', HL);
      if (r.error) throw new Error(`sales_settings restore: ${r.error.message}`);
      if (stale) log('sales_settings.saved_views had the test view left over - restored from the snapshot');
    }
    const after = await snapshot();
    const moved = TABLES.filter(t => String(before[t]) !== String(after[t])).map(t => `${t} ${before[t]} -> ${after[t]}`);
    if (moved.length) throw new Error(`counts moved: ${moved.join(', ')}`);
    const fin = (await svc.from('sales_settings').select('saved_views, updated_at').eq('business_id', HL).maybeSingle()).data;
    if (settingsBefore && (JSON.stringify(fin?.saved_views) !== JSON.stringify(settingsBefore.saved_views) || fin?.updated_at !== settingsBefore.updated_at)) throw new Error('sales_settings differs from the snapshot');
    restored = true; line = `yes (${TABLES.length} table counts identical; sales_settings.saved_views + updated_at = the snapshot after the view's save + delete; Jack sign-in row kept by rule, last_seen_at restored)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'stage3-report.json'), JSON.stringify({ ...results, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\npeople-v2 Stage 3 live check: ${passed}/${results.checks.length} passed · Claude 0 · Apollo ${realCalls.length} · API writes ${viewWrites} (the view's save + delete) · ${Math.round((Date.now() - T0) / 1000)} s`);
  console.log(`files: ${fs.readdirSync(OUT).join(', ')}`);
  console.log(`restored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
