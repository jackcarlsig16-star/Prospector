// FIX visitor-email-v2 live check - the REAL HomeLover workspace, read-only except the ONE declared test send. Today's
// visitor email is built here from the real tables through the same loaders and builder the 07:00 job uses (service
// client reads; 0 Apollo, 0 Claude), then: the three lists in order with the real counts, the tags, the thresholds from
// sales_settings.score_weights, no address or phone, the HTML rendered at 640 and 390 (no sideways scroll at either),
// a side-by-side PNG beside each mockup (specs/design/visitor-email-v2/*.dc.html). The declared send goes through PROD's
// test route (PROD_SEND=1 … --send-only once Render is Live on this commit): one sales_team_email_sends row (test = true)
// to Jack's own mailbox, nothing to the list; the row's subject must equal the subject recomputed here - the old code
// cannot produce it, so that equality is the proof prod sent the v2 email. Declared scope: ~12 table reads (< 3k rows),
// 4 file:// / data: page loads, 10 table counts twice, 1 POST when PROD_SEND=1; ~60 s, cap 180 s.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { ownerSession } from './lib/ownerSession.mjs';
import { dayWindowFor, windowDays, loadVisitorData, loadCumulative, loadRankedBook, buildVisitorEmail, qualifies, thresholdWords, TOP_N } from '../../api/sales/teamEmails/visitorEmail.js';
import { loadMembers } from '../../api/sales/teamEmails/send.js';
import { laClock } from '../../api/sales/teamEmails/scheduler.js';
import { mergeWeights } from '../../api/sales/intentScoreRun.js';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const OUT = path.join(ROOT, '.screenshots', 'fix-visitor-email-v2');
const MOCK = path.join(ROOT, 'specs', 'design', 'visitor-email-v2');
const TABLES = ['sales_team_email_sends', 'web_visits', 'sales_opportunities', 'sales_targets', 'sales_goals', 'sales_people', 'sales_company_scores', 'sales_settings', 'business_anthropic_usage', 'apollo_credit_spend'];
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
let browser, owner;
const results = { checks: [], errors: [], send: null };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 180000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));
const PII = /@|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/;
const sendOnly = process.argv.includes('--send-only');

try {
  // ---- Today's email from the real tables, through the job's own loaders and builder (read-only).
  const w = dayWindowFor(today);
  const members = await loadMembers(svc, HL);
  const [companies, overall, cumulative] = await Promise.all([loadVisitorData(svc, HL, { window: w, members }), loadRankedBook(svc, HL, { members }), loadCumulative(svc, HL)]);
  const mail = buildVisitorEmail(companies, { date: today, window: w, overall, cumulative });
  const fresh = companies.filter(c => c.is_new), q = companies.filter(qualifies);
  const weights = mergeWeights((await svc.from('sales_settings').select('score_weights').eq('business_id', HL).maybeSingle()).data?.score_weights);
  fs.writeFileSync(path.join(OUT, 'email.html'), mail.html);
  fs.writeFileSync(path.join(OUT, 'email.txt'), mail.text);
  ok(`today ${today} covers "${windowDays(w)}" (${w.days.length} day${w.days.length === 1 ? '' : 's'}); subject "${mail.subject}"; visited ${mail.visited} = NEW ${mail.new} + RETURNING ${mail.returning} (DB: ${fresh.length} new of ${companies.length}); ${mail.qualified} worth a look (DB ${q.length}); A0 ${mail.new_rows} rows, A ${mail.rows} rows (cap ${TOP_N}); B ${mail.overall} of ${overall.total}; cumulative ${mail.cumulative} since ${cumulative.since}`,
    mail.visited === companies.length && mail.new === fresh.length && mail.qualified === q.length && mail.new_rows === Math.min(TOP_N, fresh.length) && mail.rows === Math.min(TOP_N, q.length) && mail.subject === `Website visitors · ${windowDays(w)} — ${fresh.length} new, ${q.length} worth a look${overall.rows[0] ? `, top: ${overall.rows[0].company}` : ''}`);
  const t = mail.text;
  const order = ['WEBSITE VISITORS', `NEW ${w.days.length > 1 ? 'FRI–SUN' : 'YESTERDAY'}`, `WORTH A LOOK ${w.days.length > 1 ? 'FRI–SUN' : 'YESTERDAY'}`, 'TOP 10 RIGHT NOW — WHOLE BOOK', 'HOW TO READ THIS'];
  ok(`the sections in order in the text (${order.map(l => t.indexOf(l)).join(' < ')}); the same in the html`, order.every((l, i) => t.indexOf(l) >= 0 && (i === 0 || t.indexOf(l) > t.indexOf(order[i - 1]))) && ['New ', 'Worth a look ', 'Top 10 right now — whole book', 'How to read this'].every((l, i, a) => mail.html.indexOf(l) > 0 && (i === 0 || mail.html.indexOf(l) > mail.html.indexOf(a[i - 1]))));
  const tagsNew = (mail.html.match(/">NEW<\/span>/g) || []).length, tagsRet = (mail.html.match(/">RETURNING<\/span>/g) || []).length;
  const expNew = 1 + mail.new_rows + q.slice(0).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || (b.visitors || 0) - (a.visitors || 0)).slice(0, TOP_N).filter(c => c.is_new).length;
  ok(`tags: ${tagsNew} NEW (the heading + every A0 row + the new rows inside A's top ${TOP_N} = ${expNew}), ${tagsRet} RETURNING (the heading + A's returning rows)`, tagsNew === expNew && tagsRet === 1 + mail.rows - (expNew - 1 - mail.new_rows));
  ok(`thresholds from sales_settings.score_weights (${JSON.stringify(weights.thresholds)}): the glossary reads "${thresholdWords(weights.thresholds)}"`, overall.thresholds.P1 === weights.thresholds.P1 && t.includes(thresholdWords(weights.thresholds)));
  ok(`tiles: ${mail.visited} visited · ${mail.new} new · ${mail.returning} returning · ${mail.qualified} worth a look, two rows of 50 % cells; intent pills for the four bands`, (mail.html.match(/<tr><td width="50%"/g) || []).length === 2 && ['Hot', 'Warm', 'Cool', 'Cold'].every(b => new RegExp(`">${b} \\d+</span>`).test(mail.html)));
  ok(`no address or phone in the html or text (${!PII.test(mail.html + mail.text)}); no person names by construction; no <style> / <script> / <img>`, !PII.test(mail.html + mail.text) && !/<style|<script|<img/i.test(mail.html));
  ok(`data tables carry % widths only: ${[...mail.html.matchAll(/<th width="(\d+%)"/g)].map(x => x[1]).join(' ')}`, [...mail.html.matchAll(/<t[dh] [^>]*>/g)].every(x => !/width:\s*\d+px|width="\d+"/.test(x[0])) && (mail.html.match(/table-layout:fixed/g) || []).length === [mail.new_rows, mail.rows, mail.overall].filter(Boolean).length);

  // ---- Rendered at 640 and 390: no sideways scroll; side-by-side beside each mockup.
  if (!sendOnly) {
    browser = await chromium.launch();
    const widths = {};
    for (const vw of [640, 390]) {
      const page = await browser.newPage({ viewport: { width: vw, height: 900 } });
      await page.setContent(mail.html); await page.waitForTimeout(400);
      widths[vw] = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, card: Math.round(document.querySelector('table table').getBoundingClientRect().width), widest: Math.max(...[...document.querySelectorAll('table[style*="table-layout"]')].map(t => Math.round(t.getBoundingClientRect().width))) }));
      await page.screenshot({ path: `${OUT}/email-${vw}.png`, fullPage: true });
      await page.close();
    }
    ok(`rendered 640: page ${widths[640].scroll} px wide, card ${widths[640].card}, widest data table ${widths[640].widest}; 390: page ${widths[390].scroll}, card ${widths[390].card} (374 = the mockup's phone card), widest data table ${widths[390].widest} - nothing clips`, widths[640].scroll <= 640 && widths[390].scroll <= 390 && widths[390].card === 374 && widths[390].widest <= 374 - 40);
    for (const [vw, file] of [[640, 'VisitorEmail.dc.html'], [390, 'VisitorEmailPhone.dc.html']]) {
      const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
      await page.goto(`file://${path.join(MOCK, file)}`); await page.waitForTimeout(800);
      await page.addStyleTag({ content: 'x-dc{display:block} helmet{display:none} body>x-dc>div{height:auto!important;width:auto!important;justify-content:flex-start!important;overflow:visible!important}' }); await page.waitForTimeout(300);
      await page.locator('x-dc > div > table').first().screenshot({ path: `${OUT}/mockup-${vw}.png` });
      await page.close();
      const b64 = f => fs.readFileSync(path.join(OUT, f)).toString('base64');
      const compose = await browser.newPage({ viewport: { width: (vw + 60) * 2 + 48, height: 200 } });
      await compose.setContent(`<body style="margin:0;background:#000;color:#fff;font:12px monospace"><div style="display:flex;gap:16px;align-items:flex-start;padding:16px"><figure style="margin:0"><figcaption style="padding:4px 0">mockup · ${file}</figcaption><img style="width:${vw + 60}px;display:block" src="data:image/png;base64,${b64(`mockup-${vw}.png`)}"></figure><figure style="margin:0"><figcaption style="padding:4px 0">build · today's email from the real HomeLover tables at ${vw} (${today})</figcaption><img style="width:${vw}px;display:block" src="data:image/png;base64,${b64(`email-${vw}.png`)}"></figure></div></body>`);
      await compose.waitForTimeout(500);
      await compose.screenshot({ path: `${OUT}/side-by-side-${vw}.png`, fullPage: true });
      await compose.close();
    }
    ok('side-by-side-640.png + side-by-side-390.png written (mockup | build)', true);
  }

  // ---- The ONE declared write: Send a test to me only (kind visitor) -> Jack's own mailbox, through PROD's test route
  // (the local server has no MICROSOFT_TOKEN_KEY). The row's subject = the subject recomputed here proves prod ran v2.
  if (process.env.PROD_SEND === '1') {
    owner = await ownerSession(svc);
    const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
    const PROD = 'https://prospector-chtj.onrender.com';
    const sendsBefore = (await svc.from('sales_team_email_sends').select('id').eq('business_id', HL)).data.length;
    const r = await fetch(`${PROD}/api/sales/${HL}/goals/team-emails/test`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'visitor' }) }).then(async x => ({ status: x.status, body: await x.json().catch(() => null) }));
    const sends = (await svc.from('sales_team_email_sends').select('id, kind, test, recipients, status, subject, created_at').eq('business_id', HL).order('created_at', { ascending: false }).limit(3)).data;
    const row = sends.find(s => s.test && s.kind === 'visitor' && Date.parse(s.created_at) > T0 - 60e3) || null;
    results.send = row ? { status: row.status, recipients: row.recipients, subject: row.subject, at: row.created_at, body: r.body } : r.body;
    const v2 = !!row && row.subject === mail.subject;
    ok(`test send (prod): POST ${r.status} ${JSON.stringify(r.body)}; sales_team_email_sends ${sendsBefore} -> ${sendsBefore + 1}, test = true, kind visitor, status ${row?.status}, ${row?.recipients} recipient (the sending mailbox only); subject "${row?.subject}" ${v2 ? '=' : '≠'} the v2 subject recomputed here${v2 ? ' (prod ran this commit)' : ' - PROD WAS NOT ON THIS COMMIT: the old email went to Jack; rerun once Render is Live'}`,
      r.status === 200 && r.body?.status === 'sent' && r.body?.recipients === 1 && 'new_rows' in (r.body || {}) && !!row && row.status === 'sent' && row.recipients === 1 && v2 && (await svc.from('sales_team_email_sends').select('id').eq('business_id', HL)).data.length === sendsBefore + 1);
  } else ok(`test send deferred: run PROD_SEND=1 node scripts/verify/fix-visitor-email-v2.mjs --send-only once Render is Live on this commit (would send "${mail.subject}")`, true);
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    const after = await snapshot();
    const moved = TABLES.filter(t => String(before[t]) !== String(after[t])).map(t => `${t} ${before[t]} -> ${after[t]}`);
    const allowed = results.send && moved.length === 1 && moved[0].startsWith('sales_team_email_sends') && Number(after.sales_team_email_sends) === Number(before.sales_team_email_sends) + 1;
    if (moved.length && !allowed) throw new Error(`counts moved: ${moved.join(', ')}`);
    restored = true; line = allowed ? `yes (the ONE declared test-send row kept: sales_team_email_sends ${before.sales_team_email_sends} -> ${after.sales_team_email_sends}; every other count identical)` : `yes (${TABLES.length} table counts identical, 0 writes)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, `report${sendOnly ? '-send' : ''}.json`), JSON.stringify({ ...results, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\nFIX visitor-email-v2 live check: ${passed}/${results.checks.length} passed · Claude 0 · Apollo 0 · writes ${results.send ? 1 : 0} · ${Math.round((Date.now() - T0) / 1000)} s`);
  console.log(`files: ${fs.readdirSync(OUT).join(', ')}`);
  console.log(`restored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
