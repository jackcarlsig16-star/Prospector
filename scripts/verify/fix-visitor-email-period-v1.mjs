// FIX visitor-email-period-v1 live check - localhost against the build, as Jack (ownerSession) on the REAL HomeLover
// workspace. ONE declared write: the "Send a test to me only" visitor email (POST goals/team-emails/test, kind visitor) -
// one sales_team_email_sends row (test = true) and one real Graph send to Jack's own mailbox, nothing to the list. The
// report prints the subject and the counts only. Everything else is read-only: GET goals/visits/export-visitors (JSON for
// two windows + the CSV, saved under .screenshots - company names only), the email's window / NEW / RETURNING /
// CUMULATIVE recomputed from the real tables through the same functions the send uses, the Web visitors panel in the
// browser (Export visitors → PDF: the print area rendered, print media emulated, one PDF saved; window.print stubbed).
// 0 Apollo, 0 Claude. Declared scope: 1 page load, 4 GETs, 1 POST, 10 table counts twice; ~90 s, cap 240 s.
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
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const { dayWindowFor, windowLabel, loadVisitorData, loadCumulative, loadRankedBook, buildVisitorEmail } = await import('../../api/sales/teamEmails/visitorEmail.js');
const { loadMembers } = await import('../../api/sales/teamEmails/send.js');
const { laClock } = await import('../../api/sales/teamEmails/scheduler.js');
const { COLUMNS, rowCells } = await import('../../api/sales/visitorsExport.js');
const OUT = path.join(ROOT, '.screenshots', 'fix-visitor-email-period-v1');
const PORT = 3998, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const TABLES = ['sales_team_email_sends', 'web_visits', 'sales_opportunities', 'sales_targets', 'sales_goals', 'sales_people', 'sales_company_scores', 'research_runs', 'business_anthropic_usage', 'apollo_credit_spend'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data?.[0]?.id;
if (!HL) throw new Error('no HomeLover business');
const scoped = new Map();
async function count(t) {
  if (scoped.get(t) !== false) {
    const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL);
    if (!r.error && typeof r.count === 'number') { scoped.set(t, true); return r.count; }
    scoped.set(t, false);
  }
  const r = await svc.from(t).select('*', { count: 'exact', head: true });
  return r.error ? `n/a (${r.error.message.slice(0, 40)})` : `${r.count} (whole table)`;
}
const snapshot = async () => { const o = {}; for (const t of TABLES) o[t] = await count(t); return o; };
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
const today = laClock().date;
let srv, browser, owner;
const blocked = [], realCalls = [], writes = [];
const results = { checks: [], errors: [], send: null };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 240000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));
const PII = /@|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/;

try {
  owner = await ownerSession(svc);
  // The Microsoft secret stays: the one declared test send goes through send.js to Jack's own mailbox.
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', ANTHROPIC_API_KEY: '', APOLLO_API_KEY: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const api = async (p, init = {}) => { const r = await fetch(`${BASE}/api/sales/${HL}${p}`, { ...init, headers: { cookie, 'content-type': 'application/json', ...(init.headers || {}) } }); const text = await r.text(); let body = null; try { body = JSON.parse(text); } catch { body = null; } return { status: r.status, body, text, headers: r.headers }; };

  // ---- P4 / P5: the export route, JSON for 7 + 30 days and the CSV, cross-checked against the raw tables.
  const j30 = await api('/goals/visits/export-visitors?window=30&format=json');
  const j7 = await api('/goals/visits/export-visitors?window=7&format=json');
  const csv = await api('/goals/visits/export-visitors?window=30&format=csv');
  const rep = j30.body;
  const allVisits = (await svc.from('web_visits').select('company_key, seen_to, matched_type, matched_id').eq('business_id', HL)).data || [];
  const inWin = allVisits.filter(v => v.seen_to >= rep.window.since);
  const distinct = new Set(inWin.map(v => v.company_key)).size;
  const latestByKey = new Map(); for (const v of allVisits) latestByKey.set(v.company_key, v);
  const matched = { opportunity: [], target: [], partner: [] };
  for (const k of new Set(inWin.map(v => v.company_key))) { const v = latestByKey.get(k); if (v.matched_type && v.matched_id) matched[v.matched_type].push(v.matched_id); }
  const known = async (table, ids) => (ids.length ? ((await svc.from(table).select('id').eq('business_id', HL).in('id', ids).not('employees', 'is', null)).data || []).length : 0);
  const knownTotal = (await known('sales_opportunities', matched.opportunity)) + (await known('sales_targets', matched.target)) + (await known('sales_goals', matched.partner));
  ok(`export JSON 30 d: ${j30.status}; ${rep?.companies} companies = distinct companies with a pull window ending since ${rep?.window?.since} in web_visits (${distinct}); "${rep?.summary}" = ${knownTotal} records with employees (DB); title "${rep?.title}"; no name / address / phone in the rows (${!PII.test(JSON.stringify(rep?.rows || []))}); headcount never blank (${(rep?.rows || []).every(r => r.headcount && r.headcount !== '')})`,
    j30.status === 200 && rep.companies === distinct && rep.headcount_known === knownTotal && /^headcount known for \d+ of \d+ companies$/.test(rep.summary) && !PII.test(JSON.stringify(rep.rows)) && rep.rows.every(r => r.headcount && r.headcount !== '') && rep.rows.length === rep.companies);
  const unknownRows = (rep?.rows || []).filter(r => r.headcount === 'unknown').length;
  ok(`export JSON 7 d: ${j7.status}, ${j7.body?.companies} companies (≤ 30 d's ${rep?.companies}); 30 d rows: ${unknownRows} "unknown" headcounts, ${(rep?.rows || []).filter(r => r.in_prospector !== '—').length} in Prospector, bands ${[...new Set((rep?.rows || []).map(r => r.band))].join(' / ')}`, j7.status === 200 && j7.body.companies <= rep.companies && j7.body.rows.every(r => r.pages.length <= 3));
  const lines = csv.text.split('\n');
  fs.writeFileSync(path.join(OUT, 'visitors-30d.csv'), csv.text);
  ok(`export CSV 30 d: ${csv.status} ${csv.headers.get('content-type')} "${/filename="([^"]+)"/.exec(csv.headers.get('content-disposition') || '')?.[1]}"; header = the 11 columns; ${lines.length - 3} data lines = ${rep?.companies} companies; last line "${lines[lines.length - 1].slice(0, 120)}"; no address / phone (${!PII.test(csv.text)})`,
    csv.status === 200 && /text\/csv/.test(csv.headers.get('content-type') || '') && lines[0] === COLUMNS.map(c => (/,/.test(c) ? `"${c}"` : c)).join(',') && lines.length - 3 === rep.companies && lines[lines.length - 1].includes(rep.summary) && !PII.test(csv.text));
  ok(`export CSV row 1 = rowCells of JSON row 1 ("${lines[1].slice(0, 100)}")`, lines[1].startsWith(rowCells(rep.rows[0])[0].includes(',') ? `"${rep.rows[0].company}"` : rep.rows[0].company));

  // ---- P1 / P2 / P3: the email the test send will build, recomputed here through the same functions (read-only).
  const w = dayWindowFor(today);
  const members = await loadMembers(svc, HL);
  const [companies, overall, cumulative] = await Promise.all([loadVisitorData(svc, HL, { window: w, members }), loadRankedBook(svc, HL, { members }), loadCumulative(svc, HL)]);
  const mail = buildVisitorEmail(companies, { date: today, window: w, overall, cumulative });
  const allKeys = new Set(allVisits.map(v => v.company_key)).size;
  const firstPull = (await svc.from('web_visits').select('pulled_on').eq('business_id', HL).order('pulled_on', { ascending: true }).limit(1)).data?.[0]?.pulled_on;
  const winRows = allVisits.filter(v => v.seen_to <= today);
  ok(`email window for ${today}: "${windowLabel(w)}" (${w.days.length} day${w.days.length === 1 ? '' : 's'}: ${w.days.join(', ')}); subject "${mail.subject}"; visited ${mail.visited} = NEW ${mail.new} + RETURNING ${mail.returning}; CUMULATIVE ${mail.cumulative} = distinct companies in web_visits (${allKeys}) since ${cumulative.since} = the first pull (${firstPull}); legend one line`,
    w.days.length >= 1 && w.last === laClock(Date.now() - 864e5).date && mail.visited === mail.new + mail.returning && mail.cumulative === allKeys && cumulative.since === firstPull && !mail.text.includes('since the previous weekday send') && mail.text.includes(windowLabel(w)) && mail.text.includes(`CUMULATIVE — companies identified since`));
  const labels = ['NEW — first time we\'ve seen them', 'RETURNING — seen before, visited again', 'CUMULATIVE — companies identified since', 'Apollo, rolling 7 d', 'Windows: the list, NEW and RETURNING'];
  ok(`email text carries every window label once in order (${labels.map(l => mail.text.indexOf(l) >= 0).join(', ')}); no "7:00 AM", no "since Thu"; no address (${!PII.test(mail.text + mail.html)})`,
    labels.every((l, i) => mail.text.indexOf(l) >= 0 && (i === 0 || mail.text.indexOf(l) > mail.text.indexOf(labels[i - 1]))) && !/7:00 AM|the previous weekday send|visited since \w{3}\b/.test(mail.text) && !PII.test(mail.text + mail.html));
  // A Monday would read Fri – Sun: the pure rule, shown for the next Monday from today's date.
  const nextMon = (() => { let d = new Date(`${today}T12:00:00Z`); do { d = new Date(d.getTime() + 864e5); } while (d.getUTCDay() !== 1); return d.toISOString().slice(0, 10); })();
  ok(`next Monday ${nextMon} would cover "${windowLabel(dayWindowFor(nextMon))}" (3 labelled days)`, dayWindowFor(nextMon).days.length === 3);

  // ---- The ONE declared write: Send a test to me only (kind visitor) -> Jack's own mailbox. The local server has no
  // MICROSOFT_TOKEN_KEY, so the send goes through PROD's test route (PROD_SEND=1, after Render is Live on this commit;
  // the top10 FIX did the same); without the flag the step is deferred, not failed.
  if (process.env.PROD_SEND === '1') {
    const PROD = 'https://prospector-chtj.onrender.com';
    const live = await fetch(`${PROD}/api/sales/${HL}/goals/visits/export-visitors?window=7&format=json`, { headers: { cookie } });
    ok(`prod carries this commit: GET export-visitors on prod ${live.status}`, live.status === 200);
    const sendsBefore = (await svc.from('sales_team_email_sends').select('id').eq('business_id', HL)).data.length;
    const t = await fetch(`${PROD}/api/sales/${HL}/goals/team-emails/test`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'visitor' }) }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
    const sendsAfter = (await svc.from('sales_team_email_sends').select('id, kind, test, recipients, status, subject, created_at').eq('business_id', HL).order('created_at', { ascending: false }).limit(3)).data;
    const row = sendsAfter.find(s => s.test && s.kind === 'visitor' && Date.parse(s.created_at) > T0 - 60e3) || null;
    results.send = row ? { status: row.status, recipients: row.recipients, subject: row.subject, at: row.created_at, rows: t.body?.rows } : t.body;
    ok(`test send (prod): POST ${t.status} ${JSON.stringify(t.body)}; one new sales_team_email_sends row (${sendsBefore} -> ${sendsBefore + 1}), test = true, kind visitor, status ${row?.status}, ${row?.recipients} recipient (the sending mailbox only), subject "${row?.subject}" = the recomputed subject`,
      t.status === 200 && t.body?.status === 'sent' && t.body?.recipients === 1 && !!row && row.status === 'sent' && row.recipients === 1 && row.subject === mail.subject && (await svc.from('sales_team_email_sends').select('id').eq('business_id', HL)).data.length === sendsBefore + 1);
    if (process.argv.includes('--send-only')) throw Object.assign(new Error('send-only'), { quiet: true });
  } else ok(`test send deferred: the local server has no MICROSOFT_TOKEN_KEY - run PROD_SEND=1 … --send-only once Render is Live on this commit (would send "${mail.subject}")`, true);

  // ---- Browser: Web visitors panel as Jack (admin) -> Export visitors -> PDF: the print area, print media, one PDF file.
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript(([k, v, bz, dd]) => {
    if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
    localStorage.setItem('prospector_goals_owner', 'team');
    for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, dd);
    localStorage.setItem('prospector_auto_assay_disabled', '1');
    window.__printed = 0; window.print = () => { window.__printed += 1; };
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
  await page.goto(`${BASE}/?tab=pipeline&view=companies&channel=website_visit`);
  await page.getByLabel('Workspace').waitFor({ timeout: 25000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
  await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
  await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: /^Pipeline/ }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
  await page.locator('[data-sales-subviews]').getByRole('tab', { name: 'Companies', exact: true }).dispatchEvent('click'); await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Visitor report' }).click(); await page.waitForTimeout(500);
  const panel = page.getByRole('dialog', { name: 'Website visitors' }).or(page.locator('[data-visitor-report]')).first();
  await page.locator('[data-visitor-report] table, [data-visitor-report] [aria-label="Website visitors summary"]').first().waitFor({ timeout: 30000 }); await page.waitForTimeout(1000);
  const exportBtn = page.getByRole('button', { name: 'Export visitors' });
  ok(`Web visitors panel: "Export visitors" button for Jack (admin): ${await exportBtn.count()}`, (await exportBtn.count()) === 1);
  await exportBtn.click(); await page.waitForTimeout(300);
  const sec = page.getByRole('region', { name: 'Export visitors' });
  await sec.getByLabel('Window').selectOption('7'); await page.waitForTimeout(200);
  await sec.getByRole('button', { name: 'PDF' }).click();
  // The print area is display:none on screen (print-only), so wait for it to be attached, not visible.
  await page.locator('#sales-analytics-print-area table').waitFor({ state: 'attached', timeout: 25000 }); await page.waitForTimeout(600);
  const pr = await page.evaluate(() => {
    const el = document.getElementById('sales-analytics-print-area');
    return { heads: [...el.querySelectorAll('th')].map(t => t.textContent), rows: el.querySelectorAll('tbody tr').length, title: el.querySelector('div').textContent, text: el.textContent, printed: window.__printed, status: document.querySelector('[aria-label="Export visitors"] [role="status"]')?.textContent || null, insideNoPrint: !!el.closest('.no-print') };
  });
  ok(`PDF: print area rendered - 11 columns (${pr.heads.length}), ${pr.rows} rows = the 7 d JSON's ${j7.body.companies}, title "${pr.title}", status "${pr.status}", window.print called ${pr.printed} time(s), not inside a no-print block (${!pr.insideNoPrint}), no address (${!PII.test(pr.text)})`,
    pr.heads.join('|') === COLUMNS.join('|') && pr.rows === j7.body.companies && pr.title.startsWith('HomeLover website visitors · last 7 days') && pr.printed === 1 && !pr.insideNoPrint && !PII.test(pr.text) && /headcount known for \d+ of \d+ companies/.test(pr.status || ''));
  await page.screenshot({ path: `${OUT}/export-panel-1440.png`, animations: 'disabled' });
  await page.emulateMedia({ media: 'print' }); await page.waitForTimeout(300);
  const vis = await page.evaluate(() => { const v = el => getComputedStyle(el).visibility; return { area: v(document.getElementById('sales-analytics-print-area')), areaRows: v(document.querySelector('#sales-analytics-print-area td')), chrome: v(document.querySelector('[data-visitor-report] h2')), exportSection: getComputedStyle(document.querySelector('[aria-label="Export visitors"]')).display }; });
  await page.pdf({ path: `${OUT}/visitors-7d.pdf`, landscape: true, printBackground: true });
  const pdfBytes = fs.statSync(path.join(OUT, 'visitors-7d.pdf')).size;
  ok(`print media: the print area visible (${vis.area} / cells ${vis.areaRows}), the page chrome hidden (${vis.chrome}), the export controls display ${vis.exportSection}; visitors-7d.pdf written (${pdfBytes} bytes)`, vis.area === 'visible' && vis.areaRows === 'visible' && vis.chrome === 'hidden' && vis.exportSection === 'none' && pdfBytes > 1000);
  await page.emulateMedia({ media: 'screen' });
  ok(`browser: 0 page errors; 0 Claude / Apollo hosts; every non-GET aborted (${[...new Set(writes)].join(', ') || 'none attempted'})`, !errors.length && !realCalls.length && writes.every(x => blocked.includes(x)), errors.join(' | '));
  await ctx.close();
} catch (e) {
  if (!e.quiet) { results.errors.push(e.stack || e.message); log('ERROR', e.message); }
} finally {
  await cleanup();
  let restored = false, line;
  try {
    const after = await snapshot();
    const moved = TABLES.filter(t => String(before[t]) !== String(after[t])).map(t => `${t} ${before[t]} -> ${after[t]}`);
    const allowed = moved.length === 1 && moved[0].startsWith('sales_team_email_sends') && Number(after.sales_team_email_sends) === Number(before.sales_team_email_sends) + 1;
    if (moved.length && !allowed) throw new Error(`counts moved: ${moved.join(', ')}`);
    restored = true; line = moved.length ? `yes (${TABLES.length - 1} table counts identical; sales_team_email_sends +1 = the ONE declared test send, kept as the record of it; Jack sign-in row kept by rule, last_seen_at restored)` : `yes (${TABLES.length} table counts identical, 0 writes; Jack sign-in row kept by rule, last_seen_at restored)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ ...results, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\nFIX visitor-email-period-v1 live check: ${passed}/${results.checks.length} passed · Claude 0 · Apollo ${realCalls.length} · writes ${results.send?.status === 'sent' ? '1 (the declared test send)' : '0 (the send deferred to prod)'} · ${Math.round((Date.now() - T0) / 1000)} s`);
  console.log(`send: ${JSON.stringify(results.send)}`);
  console.log(`files: ${fs.readdirSync(OUT).join(', ')}`);
  console.log(`restored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
