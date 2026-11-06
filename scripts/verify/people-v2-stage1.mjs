// people-v2 Stage 1 live check + the static sketch - READ-ONLY on the REAL HomeLover workspace (service client reads,
// localhost server as Jack for GET /huddle, /huddle/live and goals/people/activity; 0 Claude, 0 Apollo, no writes - the
// migration has NOT run, so the activity route must answer 503 migration_pending and the summary is computed in memory
// through the same function the sync will write with).
// Proof: for the 10 hottest prospects GET /huddle's score + heat_band and GET /huddle/live's sent / real_opens /
// human_clicks / replied equal the in-memory summary to the digit. Sketch: specs/design/people-v2/People.html - the P2
// table at 1440 (the top 25 real rows: names, titles, companies, counts; never an address) and the P6 cards at 390 - with
// PNGs of both under .screenshots/people-v2-stage1/ for Jack's "layout ok".
// Declared scope: 1 server, 3 GETs, ~11 table reads (< 2k rows), 2 file:// page loads, 10 table counts twice. ~60 s, cap 180 s.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { ownerSession } from './lib/ownerSession.mjs';
import { buildPersonActivity } from '../../api/sales/personActivity.js';
import { peopleRows, buildPeopleTable, windowOf } from '../../api/sales/peopleActivityRoutes.js';
import { HEAT_BANDS } from '../../api/sales/heatScore.js';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const OUT = path.join(ROOT, '.screenshots', 'people-v2-stage1');
const SKETCH_DIR = path.join(ROOT, 'specs', 'design', 'people-v2');
const PORT = 3995, BASE = `http://localhost:${PORT}`;
const TABLES = ['sales_prospect_state', 'sales_people', 'partner_contacts', 'sales_email_messages', 'sales_email_activity', 'web_visits', 'sales_opportunities', 'sales_targets', 'sales_goals', 'sales_settings'];
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
let srv, browser, owner;
const results = { checks: [], errors: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 180000 });
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(SKETCH_DIR, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));
const ADDRESS = /[^\s@<>()"',;=&#]+@[^\s@<>()"',;=&#]+\.[a-z]{2,}/i;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const md = iso => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' }) : '—');
const NOW = Date.now();

try {
  // ---- The real rows, through the route's own loaders / builders (no server, no table yet: the summary in memory).
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
  const activity = buildPersonActivity({ prospects, partnerContacts, messages, events, now: NOW });
  const rows = peopleRows({ prospects, salesPeople, partnerContacts, opportunities: opportunities.filter(o => !o.archived_at), targets, partners });
  const table = buildPeopleTable({ rows, activity, visits, buyerTitles: settings?.buyer_titles || [], window: windowOf('all', new Date(NOW).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })), now: NOW });
  const w30 = buildPeopleTable({ rows, activity, visits, buyerTitles: settings?.buyer_titles || [], window: windowOf('30', new Date(NOW).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })), now: NOW });
  ok(`real rows: ${rows.length} union rows -> ${table.total} people after the merge (${prospects.length} prospects + ${salesPeople.filter(p => !p.archived_at).length} visitors/hand + ${partnerContacts.length} partner contacts); summary rows ${activity.length} (prospects with activity ${activity.filter(a => a.source_table === 'sales_prospect_state').length}, partner contacts ${activity.filter(a => a.source_table === 'partner_contacts').length}); chips all-time ${JSON.stringify(table.counts)}; 30 d ${w30.n} of ${w30.total}; no address in the table (${!ADDRESS.test(JSON.stringify(table))})`,
    table.total > 0 && table.total <= rows.length && activity.length > 0 && !ADDRESS.test(JSON.stringify(table)) && w30.n <= table.n);
  const sources = {}; for (const r of table.rows) for (const s of r.sources) sources[s] = (sources[s] || 0) + 1;
  ok(`sources on the table: ${JSON.stringify(sources)}; merged rows (2+ sources) ${table.rows.filter(r => r.sources.length > 1).length}`, Object.keys(sources).length >= 3);

  // ---- The server as Jack: the Huddle's numbers vs the in-memory summary for the 10 hottest prospects; the route 503 today.
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', ANTHROPIC_API_KEY: '', APOLLO_API_KEY: '', MICROSOFT_CLIENT_SECRET: '', GMAIL_CLIENT_SECRET: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const get = async p => { const r = await fetch(`${BASE}/api/sales/${HL}${p}`, { headers: { cookie } }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const huddle = await get('/huddle');
  const live = await get('/huddle/live?limit=1000&show_closed=1&show_bots=1');
  const act = await get('/goals/people/activity?window=30');
  const byKey = new Map(activity.map(a => [a.contact_id, a]));
  const hudRows = (huddle.body?.prospects || huddle.body?.rows || huddle.body?.live || []).slice().sort((a, b) => b.score - a.score);
  const top = hudRows.slice(0, 10);
  const diffs = top.map(p => { const a = byKey.get(p.contact_id); return { name: p.name, huddle: [p.score, p.heat_band], mine: a ? [a.heat, a.heat_band] : null, same: !!a && a.heat === p.score && a.heat_band === p.heat_band }; });
  ok(`GET /huddle ${huddle.status}: ${hudRows.length} scored prospects; the 10 hottest = the summary's heat + band to the digit: ${diffs.map(d => `${d.name.split(' ')[0]} ${d.huddle.join('/')}${d.same ? ' ✓' : ` ≠ ${d.mine?.join('/')}`}`).join(', ')}`, huddle.status === 200 && top.length === 10 && diffs.every(d => d.same));
  const liveBy = new Map((live.body?.rows || []).map(r => [r.contact_id, r]));
  const liveDiffs = top.map(p => { const a = byKey.get(p.contact_id), l = liveBy.get(p.contact_id); return { name: p.name, same: !!a && !!l && l.sent === a.sent && l.real_opens === a.opened_h && l.human_clicks === a.clicked && (l.replied === (a.replied > 0)) && l.bot_opens === a.bot_opens, live: l ? [l.sent, l.real_opens, l.human_clicks, l.replied ? 1 : 0] : null, mine: a ? [a.sent, a.opened_h, a.clicked, a.replied] : null }; });
  ok(`GET /huddle/live ${live.status}: ${live.body?.rows?.length} rows; the same 10: sent / human opens / human clicks / replied equal: ${liveDiffs.map(d => `${d.name.split(' ')[0]} ${d.live?.join('·')}${d.same ? ' ✓' : ` ≠ ${d.mine?.join('·')}`}`).join(', ')}`, live.status === 200 && liveDiffs.every(d => d.same));
  ok(`GET goals/people/activity before the migration: ${act.status} ${JSON.stringify(act.body).slice(0, 120)} (503 migration_pending until Jack runs it)`, act.status === 503 && act.body?.migration_pending === true);

  // ---- The sketch from real rows.
  const top25 = table.rows.slice(0, 25);
  const chip = (label, n, on = false) => `<span class="chipf${on ? ' on' : ''}">${esc(label)} <b class="num">${n}</b></span>`;
  const heat = r => (r.heat == null ? '<span class="pill cold">—</span>' : `<span class="pill ${r.heat_band}">${r.heat} · ${r.heat_band}</span>`);
  const srcChip = r => `<span class="src">${esc(r.source)}${r.sources.length > 1 ? ` +${r.sources.length - 1}` : ''}</span>`;
  const stage = r => (r.company?.stage ? `<span class="ty">${esc(String(r.company.stage).replace(/_/g, ' '))}</span>` : '');
  const emails = r => `<span class="num">${r.emails.sent}</span> <span class="dim">sent</span> · <span class="num">${r.emails.opened}</span> <span class="dim">opened</span> · <span class="num">${r.emails.clicked}</span> <span class="dim">clicked</span> · <span class="num">${r.emails.replied}</span> <span class="dim">replied</span>`;
  const lastEmail = r => (r.last_email ? `${md(r.last_email.at)} <span class="dim">· ${esc(r.last_email.what)}${r.last_email.reply_class ? ` · ${esc(r.last_email.reply_class.replace(/_/g, ' '))}` : ''}</span>` : '<span class="dim">—</span>');
  const visitsCell = r => (r.visits ? `<span class="num">${r.visits.visits_7d}</span> <span class="dim">visits 7 d · last ${md(r.visits.last_visit)}${r.visits.top_page ? ` · ${esc(r.visits.top_page)}` : ''}</span>` : '<span class="dim">—</span>');
  const trs = top25.map(r => `<tr><td class="co"><div>${esc(r.name)}${r.has_email ? ' <span class="dim" title="has an address on file">✉</span>' : ''}</div><div class="dim sub">${esc(r.title || 'no title')}</div></td><td><div><a href="#">${esc(r.company?.name || '—')}</a></div><div class="sub">${stage(r)}${r.company?.owner_user_id ? ' <span class="own"><i style="background:#6F8CF0"></i></span>' : ''}</div></td><td>${srcChip(r)}</td><td>${emails(r)}</td><td>${lastEmail(r)}</td><td>${heat(r)}</td><td>${visitsCell(r)}</td><td>${r.identified_at ? md(r.identified_at) : '<span class="dim">—</span>'}</td><td class="c">${r.buyer ? '✓' : ''}</td><td>${r.last_touch_at ? md(r.last_touch_at) : '<span class="dim">—</span>'}</td></tr>`).join('\n');
  const cards = table.rows.slice(0, 8).map(r => `<article class="card"><div class="row1"><b>${esc(r.name)}</b>${heat(r)}</div><div class="dim sub">${esc(r.title || 'no title')} · <a href="#">${esc(r.company?.name || '—')}</a></div><div class="row2"><span>✉ <b class="num">${r.emails.sent}</b></span><span>👁 <b class="num">${r.emails.opened}</b></span><span>🖱 <b class="num">${r.emails.clicked}</b></span><span>↩ <b class="num">${r.emails.replied}</b></span><span class="dim">${r.visits ? `${r.visits.visits_7d} visits 7 d` : 'no visits'}</span></div><div class="row3">${srcChip(r)}${r.buyer ? '<span class="src">Buyer ✓</span>' : ''}${r.identified_at ? `<span class="src">Identified ${md(r.identified_at)}</span>` : ''}</div></article>`).join('\n');
  const c = table.counts;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Pipeline › People — people-v2 Stage 1 sketch (real rows, ${new Date(NOW).toISOString().slice(0, 10)})</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&amp;family=Geist+Mono:wght@400;500&amp;display=swap">
<style>
body{margin:0;background:#0B0D10;color:#E9ECF0;font-family:Geist,system-ui,sans-serif;font-size:14px}
a{color:#AFC0FF;text-decoration:none}
.lbl{font-family:'Geist Mono',ui-monospace,monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8B95A3;font-weight:500}
.num{font-variant-numeric:tabular-nums}
.dim{color:#8B95A3}.sub{font-size:12px}
.chipf{height:30px;padding:0 12px;border-radius:999px;border:1px solid #232A33;background:transparent;color:#C9D0D9;font:13px Geist,sans-serif;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.chipf.on{border-color:#8FA8FF;background:#171C22;color:#E9ECF0}
.chipf b{color:#8B95A3;font-weight:500}
.sel{height:30px;border-radius:8px;border:1px solid #46505E;background:#12161B;color:#E9ECF0;font:13px Geist,sans-serif;padding:0 8px}
.search{height:32px;width:260px;border-radius:8px;border:1px solid #46505E;background:#12161B;color:#E9ECF0;font:13px Geist,sans-serif;padding:0 10px}
table{border-collapse:separate;border-spacing:0;width:100%;table-layout:fixed;font-size:13px}
th{position:sticky;top:0;background:#12161B;text-align:left;font-weight:500;height:34px;padding:0 10px;border-bottom:1px solid #46505E;white-space:nowrap;font-family:'Geist Mono',monospace;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#8B95A3}
td{height:44px;padding:4px 10px;border-bottom:1px solid #1C222A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#C9D0D9;vertical-align:middle}
td.co{color:#E9ECF0;font-weight:500}td.c{text-align:center}
.ty{font-family:'Geist Mono',monospace;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#8B95A3}
.src{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 7px;border-radius:999px;border:1px solid #232A33;font-size:11px;color:#C9D0D9;white-space:nowrap}
.own i{width:8px;height:8px;border-radius:999px;display:inline-block}
.pill{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap}
.pill.hot{background:#3A1515;color:#FF8A8A}.pill.warm{background:#3A2A10;color:#F2B544}.pill.cold{background:#1C222A;color:#8B95A3}
.frame{width:1440px;box-sizing:border-box;padding:24px 28px;display:flex;flex-direction:column;gap:14px}
.filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.phone{width:390px;box-sizing:border-box;padding:12px;display:flex;flex-direction:column;gap:10px;border-left:1px solid #232A33}
.chips-scroll{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px}
.card{background:#12161B;border:1px solid #232A33;border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;font-size:13px}
.card .row1{display:flex;align-items:center;justify-content:space-between;gap:8px}
.card .row2{display:flex;gap:12px;flex-wrap:wrap;font-size:12px}
.card .row3{display:flex;gap:6px;flex-wrap:wrap}
.note{font-size:12px;color:#8B95A3}
</style></head>
<body>
<section id="s1440" class="frame">
  <div style="display:flex;align-items:center;gap:12px"><h2 style="margin:0;font-size:20px;font-weight:600">People</h2><span class="note">everyone we know — prospects, identified visitors, partner contacts — with their email activity and their company's visits · sketch from real rows (names and titles only)</span></div>
  <div class="filters"><input class="search" placeholder="Search name, title, company"> ${chip('Opened', c.opened)} ${chip('Clicked', c.clicked)} ${chip('Replied', c.replied)} ${chip('Sent (any)', c.sent)} ${chip('Identified visitor', c.identified)} ${chip('Company visited 7 d', c.visited_7d)} ${chip('Buyer title', c.buyer)} ${chip(`Hot (≥ ${HEAT_BANDS.hotScore})`, c.hot)} ${chip('Needs a touch (14 d)', c.needs_touch)} ${chip('Mine', '—')}</div>
  <div class="filters"><span class="lbl">Source</span><select class="sel"><option>All</option></select><span class="lbl">Company stage</span><select class="sel"><option>All</option></select><span class="lbl">Owner</span><select class="sel"><option>All</option></select><span class="lbl">Window</span><select class="sel"><option>All time</option><option>7 d</option><option>30 d</option><option>90 d</option></select><span class="note" style="margin-left:auto">Showing ${top25.length} of ${table.total} · sorted by Heat ▼, then last email</span><span class="lbl" style="padding:0 6px">CSV</span><span class="lbl" style="padding:0 6px">Share view</span></div>
  <table>
    <colgroup><col style="width:186px"><col style="width:176px"><col style="width:116px"><col style="width:262px"><col style="width:158px"><col style="width:90px"><col style="width:150px"><col style="width:80px"><col style="width:48px"><col style="width:80px"></colgroup>
    <thead><tr><th>Person</th><th>Company</th><th>Source</th><th>Emails (human opens)</th><th>Last email</th><th>Heat</th><th>Company visits</th><th>Identified</th><th>Buyer</th><th>Last touch</th></tr></thead>
    <tbody>${trs}</tbody>
  </table>
  <div class="note">Row click = select (a pinned detail card under the row: the email timeline, the company's visit line, notes, the quick menu). Name click = the company window on its People card. Heat = the Huddle's score (hot ≥ ${HEAT_BANDS.hotScore} or a human click in 7 d; warm ≥ ${HEAT_BANDS.warmScore} or a real open in 7 d). Opens count humans only (the Huddle's bot rule). ✉ = an address is on file (never shown).</div>
</section>
<section id="s390" class="phone">
  <div style="display:flex;align-items:center;justify-content:space-between"><b style="font-size:17px">People</b><span class="note">${table.total}</span></div>
  <input class="search" style="width:100%;box-sizing:border-box" placeholder="Search">
  <div class="chips-scroll">${chip('Opened', c.opened)}${chip('Clicked', c.clicked)}${chip('Replied', c.replied)}${chip('Visited 7 d', c.visited_7d)}${chip('Buyer', c.buyer)}${chip('Hot', c.hot)}</div>
  ${cards}
  <div class="note">390: stacked cards (name · heat · title · company · the four email counts as glyph + number · visits · chips), the chip row scrolls, no sideways scroll.</div>
</section>
</body></html>`;
  if (ADDRESS.test(html)) throw new Error('the sketch would carry an address - refused');
  fs.writeFileSync(path.join(SKETCH_DIR, 'People.html'), html);
  ok(`sketch written: specs/design/people-v2/People.html - ${top25.length} real rows at 1440 (10 columns), ${Math.min(8, table.rows.length)} cards at 390; no address (${!ADDRESS.test(html)}); hottest row "${top25[0]?.name}" ${top25[0]?.heat} · ${top25[0]?.heat_band}`, top25.length > 0 && !ADDRESS.test(html));
  browser = await chromium.launch();
  for (const [id, width] of [['s1440', 1440], ['s390', 390]]) {
    const page = await browser.newPage({ viewport: { width: width + (width === 1440 ? 0 : 0), height: 1000 } });
    await page.goto(`file://${path.join(SKETCH_DIR, 'People.html')}`); await page.waitForTimeout(800);
    await page.addStyleTag({ content: `section:not(#${id}){display:none!important}` });
    await page.locator(`#${id}`).screenshot({ path: `${OUT}/sketch-${width}.png` });
    const sideways = await page.evaluate(id2 => { const s = document.getElementById(id2); return s.scrollWidth <= s.clientWidth + 1; }, id);
    ok(`sketch-${width}.png written; section fits its width (${sideways})`, sideways);
    await page.close();
  }
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
  fs.writeFileSync(path.join(OUT, 'stage1-report.json'), JSON.stringify({ ...results, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\npeople-v2 Stage 1 live check: ${passed}/${results.checks.length} passed · Claude 0 · Apollo 0 · writes 0 · ${Math.round((Date.now() - T0) / 1000)} s`);
  console.log(`files: ${fs.readdirSync(OUT).join(', ')} · sketch: specs/design/people-v2/People.html`);
  console.log(`restored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
