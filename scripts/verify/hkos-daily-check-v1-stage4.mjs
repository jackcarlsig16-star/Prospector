// hkos-daily-check-v1 Stage 4 LIVE check - as Jack on the REAL HumanKind workspace with his real tethered mailbox.
// Declared caps: Gmail <= 10 HTTP calls (counted at the fetch seam; expected 7), Claude 0 (the seam throws), Apollo 0.
// Writes = test rows only, deleted by id at the end: one invented brand ("Zz Verify Bakery", no domain so the warm
// search never runs), one contact (no email first, then verify@example.invalid), one cold draft with To omitted that the
// script back-dates to a sent touch 6 days ago (DB only; the Gmail draft stays a draft), the ONE bump draft the daily
// check writes (To omitted through dailyCheck's omitRecipientFor, which no route exposes), the hk_job_runs row, the
// hk_events those routes log. The Gmail seam REFUSES any createDraft whose MIME carries a To header, so a real brand can
// never receive a draft from this run (0 real brands are due today; the refusal is the backstop). The browser part
// (Today lists the draft under Drafts to review) is GET-only against the local build (every non-GET aborted, the shell's
// POST jobs/pageload included). One request goes through the real wiring (GET jobs/today on the spawned server.js).
// --replay: Gmail answers come from the scrubbed recording of the last live run (0 Gmail calls).
// restored = every hk_* + HomeLover count identical; a count() error or non-number THROWS -> "restored: NO", exit 1.
// Runtime ~1-2 min, hard cap 240 s. Usage: node scripts/verify/hkos-daily-check-v1-stage4.mjs [--replay]  (build first)
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { ownerSession } from './lib/ownerSession.mjs';
import { realGet, keysOf } from './lib/realWiring.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const { gmailClient } = await import('../../api/hk/gmailClient.js');
const { createDraftFor, deps0 } = await import('../../api/hk/gmailRoutes.js');
const { dailyCheck } = await import('../../api/hk/jobs/runner.js');
const { dailyCheckRoute, retryDraftRoute, todayRoute } = await import('../../api/hk/jobsRoutes.js');
const { createBrandRoute, createContactRoute, patchContactRoute } = await import('../../api/hk/brandsRoutes.js');
const { chicagoDay } = await import('../../api/hk/jobs/plan.js');
const { mailboxFor, accessTokenForGrant } = await import('../../api/lib/googleGrants.js');
const REPLAY = process.argv.includes('--replay');
const OUT = path.join(ROOT, '.screenshots', 'hkos-daily-check-v1');
const REC = path.join(OUT, 'stage4-gmail-recording.json');
const PORT = 3995, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const HK = '981b790c-a3b0-4265-b32e-1f701d5731ff';
const HK_TABLES = ['hk_brands', 'hk_contacts', 'hk_touches', 'hk_replies', 'hk_sponsor_periods', 'hk_settings', 'hk_events', 'hk_duplicate_decisions', 'hk_import_runs', 'hk_ignored_senders', 'hk_member_prefs', 'hk_sync_runs', 'hk_gmail_sync_state', 'hk_job_runs', 'business_members', 'workspace_mailboxes'];
const HL_TABLES = ['accounts', 'lists', 'projects', 'sales_goals', 'sales_opportunities', 'sales_targets', 'sales_people', 'sales_source_events', 'sales_partner_events', 'partner_contacts', 'sales_week_goals'];
const GMAIL_CAP = 10, CLAUDE_CAP = 0;
const BRAND = 'Zz Verify Bakery';
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const count = async (t, biz) => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', biz); if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message || `no count (HTTP ${r.status})`}`); return r.count; };
const snapshot = async () => { const o = { humankind: {}, homelover: {} }; for (const t of HK_TABLES) o.humankind[t] = await count(t, HK); for (const t of HL_TABLES) o.homelover[t] = await count(t, HOMELOVER); return o; };
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
const ADDR = /[^\s@<>()"',;=&#]+(?:@|%40)[^\s@<>()"',;=&#]+\.[a-z]{2,}/gi;
const redact = s => String(s).replace(ADDR, '<address>');
const scrub = s => String(s).replace(ADDR, 'redacted@example.invalid');
const decode = raw => Buffer.from(String(raw).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

// Gmail at the fetch seam: count every HTTP call, refuse a draft with a To header, record for --replay.
const gmailCalls = [], recording = REPLAY ? JSON.parse(fs.readFileSync(REC, 'utf8')) : [];
let claudeCalls = 0;
const gmailFetch = async (url, init = {}) => {
  const u = new URL(url); const key = `${init.method || 'GET'} ${u.pathname.replace(/\/[A-Za-z0-9_-]{8,}(?=\/|$)/g, '/<id>')}`;
  if (init.method === 'POST' && u.pathname.endsWith('/drafts')) { const raw = JSON.parse(init.body)?.message?.raw || ''; if (/^To: /m.test(decode(raw))) throw new Error(`REFUSED: a draft with a To header (only the invented brand's To-less drafts may be created by this run)`); }
  gmailCalls.push(key);
  if (gmailCalls.length > GMAIL_CAP) throw new Error(`Gmail cap ${GMAIL_CAP} exceeded (${key})`);
  if (REPLAY) { const i = recording.findIndex(r => r && r.key === key); if (i < 0) throw new Error(`replay: no recorded answer for ${key}`); const r = recording[i]; recording[i] = null; return { status: r.status, ok: r.status >= 200 && r.status < 300, text: async () => r.text }; }
  const r = await fetch(url, init); const text = await r.text();
  recording.push({ key, status: r.status, text: scrub(text) });
  return { status: r.status, ok: r.ok, text: async () => text };
};
const gmail = gmailClient(gmailFetch);
const callClaude = async () => { claudeCalls++; throw new Error(`Claude cap ${CLAUDE_CAP}: no model call was expected in this run`); };

let srv, browser, owner, JACK, m0;
const created = { brand: null, contact: null, touches: [], drafts: [], run: null };
const blocked = [], outside = [];
const results = { checks: [], errors: [], gmailCalls };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${redact(detail)}` : ''); };
const reqOf = ({ method = 'POST', params = {}, query = {}, body = {} } = {}) => ({ method, params: { businessId: HK, ...params }, query, body, auth: { user: { id: JACK, name: 'Jack' }, isPlatformOwner: true, roles: new Map([[HK, 'owner']]) } });
const D = () => ({ supabase: svc, gmail, call: callClaude, slackUrl: null });
const call = async (route, req, d = {}) => { const r = { code: 200, body: null }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; await route(req, r, { ...D(), ...d }); return r; };
async function removeCreated() {
  const out = {};
  const del = async (t, q) => { const r = await q.select('id'); if (r.error) console.log(`cleanup ${t}:`, r.error.message); out[t] = (out[t] || 0) + (r.data?.length ?? -1); };
  if (m0 && created.drafts.length) { let token = null; try { token = await accessTokenForGrant(m0.grant, 'gmail'); } catch (e) { console.log('cleanup: no token for the Gmail deletes', e.message); }
    for (const id of created.drafts) { try { await gmail.deleteDraft(token, id); out.gmail_drafts_deleted = (out.gmail_drafts_deleted || 0) + 1; } catch (e) { console.log('cleanup: deleteDraft', e.status || '', redact(e.message)); } } }
  if (created.brand) {
    await del('hk_touches', svc.from('hk_touches').delete().eq('business_id', HK).eq('brand_id', created.brand));
    await del('hk_contacts', svc.from('hk_contacts').delete().eq('business_id', HK).eq('brand_id', created.brand));
    await del('hk_events', svc.from('hk_events').delete().eq('business_id', HK).eq('entity_id', created.brand));
    await del('hk_brands', svc.from('hk_brands').delete().eq('id', created.brand));
  }
  if (created.run) await del('hk_job_runs', svc.from('hk_job_runs').delete().eq('id', created.run));
  results.deleted = out; log('deleted exactly the created rows:', JSON.stringify(out));
}
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  await removeCreated();
  if (owner) { log(await owner.release()); owner = null; }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 240000 });
fs.mkdirSync(OUT, { recursive: true });
for (const v of ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GOOGLE_TOKEN_KEY']) if (!process.env[v]) { console.log(`ABORT before any write: ${v} is not set in .env`); process.exit(1); }
if (process.env.HK_SLACK_WEBHOOK_URL) { console.log('ABORT: HK_SLACK_WEBHOOK_URL is set locally; this run expects Slack unset -> skipped'); process.exit(1); }
const pre = await svc.from('hk_brands').select('id').eq('business_id', HK).ilike('name', 'Zz Verify%');
if (pre.data?.length) { console.log('ABORT: leftover verify brands exist - remove them first:', pre.data.map(b => b.id).join(', ')); process.exit(1); }
const TODAY = chicagoDay(new Date());
const ranAlready = await svc.from('hk_job_runs').select('id, status, trigger').eq('business_id', HK).eq('job', 'daily-check').eq('chicago_day', TODAY).neq('status', 'error');
if (ranAlready.data?.length) { console.log(`ABORT before any write: a daily-check row for Chicago day ${TODAY} already holds the day (${JSON.stringify(ranAlready.data)}); the guard would skip the run - try tomorrow`); process.exit(1); }
const before = await snapshot();
log(REPLAY ? 'REPLAY run (0 Gmail calls)' : 'LIVE run', 'before', JSON.stringify(before.humankind), 'HomeLover accounts', before.homelover.accounts);

try {
  const members = await svc.from('business_members').select('user_id, role').eq('business_id', HK);
  JACK = members.data.find(m => m.role === 'owner').user_id;
  m0 = await mailboxFor(HK, JACK, 'drafts');
  if (!m0 || m0.state !== 'ok') throw new Error(`mailbox not ready: ${m0 ? m0.state : 'none'}`);
  const settings = (await svc.from('hk_settings').select('*').eq('business_id', HK).maybeSingle()).data;
  // 1 invented brand (no domain) + contact without an email, through the routes
  const b = await call(createBrandRoute, reqOf({ body: { name: BRAND, niche: 'bakery', notes: 'verify row, deleted by the script' } }));
  if (b.code !== 201) throw new Error(`create brand: ${b.code} ${JSON.stringify(b.body)}`);
  created.brand = b.body.brand.id;
  const c = await call(createContactRoute, reqOf({ params: { id: created.brand }, body: { name: 'Verify Contact', title: 'Owner', is_primary: true } }));
  if (c.code !== 201) throw new Error(`create contact: ${c.code} ${JSON.stringify(c.body)}`);
  created.contact = c.body.contact.id;
  // 2 the cold touch: a real Gmail draft (To omitted) so the bump has a real thread; back-dated to sent 6 days ago in the rows only
  const SUBJECT = `HumanKind x ${BRAND} - a fresh-start challenge`;
  const COLD = `Hi there - hope the week is going well.\n\nI'm Jack, co-founder of HumanKind, a free community wellness platform launched in Chicago in April. We're at ${settings.members_stat.toLocaleString('en-US')}+ members and ${settings.completions_stat.toLocaleString('en-US')}+ verified challenge completions.\n\nYou can check out the community here: https://humankindcollective.app\n\n${BRAND} is a natural fit: a "fresh start" challenge with a pastry box as the reward.\n\nEvery completion is verified, so you're driving real behavior, not clicks.\n\nWorth a 15-minute call to see if it makes sense?\n\nThanks,\nJack`;
  const cold = await createDraftFor({ D: { ...deps0(D()), mailbox: async () => m0 }, businessId: HK, userId: JACK, body: { brand_id: created.brand, contact_id: created.contact, channel: 'email', kind: 'cold', subject: SUBJECT, body_markdown: COLD, challenge_concept: 'a fresh-start challenge', omit_recipient: true }, tokenFor: () => accessTokenForGrant(m0.grant, 'gmail'), createdBy: 'user' });
  created.touches.push(cold.touch.id); created.drafts.push(cold.touch.gmail_draft_id);
  const sentAt = new Date(Date.now() - 6 * 86400e3).toISOString(), dueAt = new Date(Date.now() - 86400e3).toISOString();
  const u1 = await svc.from('hk_touches').update({ state: 'sent', sent_at: sentAt }).eq('id', cold.touch.id).select('id');
  const u2 = await svc.from('hk_brands').update({ status: 'sent', owner_user_id: JACK, next_due_at: dueAt, last_touch_at: sentAt }).eq('id', created.brand).select('id');
  if (u1.error || u2.error) throw new Error(`back-date: ${u1.error?.message || u2.error?.message}`);
  ok('1 invented brand (no domain) + primary contact with NO email; its cold touch is a real To-less Gmail draft back-dated in the rows to sent 6 days ago, brand sent + due yesterday', !!created.brand && c.body.contact.email == null && !!cold.touch.gmail_thread_id && u1.data.length === 1 && u2.data.length === 1, `gmail calls ${gmailCalls.length}`);
  // 3 no contact -> the "no contact" item through Retry draft (no run row, 0 Gmail)
  const g0 = gmailCalls.length;
  const r1 = await call(retryDraftRoute, reqOf({ body: { brand_id: created.brand } }));
  ok('2 with no contact email the job answers a "no contact" item, not a draft (0 Gmail calls)', r1.code === 200 && r1.body.drafted === false && r1.body.reason === 'no_contact' && r1.body.kind === 'bump' && gmailCalls.length === g0, JSON.stringify(r1.body));
  // 4 example.invalid contact -> manual daily-check -> ONE bump draft with To omitted
  const p = await call(patchContactRoute, reqOf({ method: 'PATCH', params: { id: created.brand, cid: created.contact }, body: { email: 'verify@example.invalid' } }));
  if (p.code !== 200) throw new Error(`patch contact: ${p.code} ${JSON.stringify(p.body)}`);
  const out = await dailyCheck({ businessId: HK, trigger: 'manual', startedBy: JACK, d: D(), omitRecipientFor: [created.brand] });
  created.run = out.run?.id || null;
  const bump = (await svc.from('hk_touches').select('*').eq('business_id', HK).eq('brand_id', created.brand).eq('kind', 'bump').maybeSingle()).data;
  if (bump) { created.touches.push(bump.id); if (bump.gmail_draft_id) created.drafts.push(bump.gmail_draft_id); }
  const runRow = created.run ? (await svc.from('hk_job_runs').select('*').eq('id', created.run).single()).data : null;
  results.run = runRow && { ...runRow, digest: undefined };
  const newDrafts = (await svc.from('hk_touches').select('id, brand_id').eq('business_id', HK).eq('state', 'drafted').eq('created_by', 'system').gte('created_at', new Date(T0).toISOString())).data || [];
  ok(`3 manual daily-check: ONE bump draft (counts ${JSON.stringify({ due: out.counts.due, drafted: out.counts.drafted, no_draft: out.counts.no_draft, dm_texts: out.counts.dm_texts, errors: out.counts.errors })}), in the cold thread, created_by system, lint passed; no other system draft today; run row ok with trigger manual`, out.skipped == null && out.counts.drafted === 1 && out.counts.errors === 0 && bump?.state === 'drafted' && bump.created_by === 'system' && bump.gmail_thread_id === cold.touch.gmail_thread_id && !!bump.gmail_draft_id && bump.lint_passed === true && newDrafts.length === 1 && newDrafts[0].brand_id === created.brand && runRow?.status === 'ok' && runRow.trigger === 'manual' && runRow.chicago_day === TODAY, `run ${JSON.stringify(results.run)}`);
  ok('4 Slack unset -> counted skipped, never an error; digest stored on the run row lists the draft under Drafts to review; 0 Claude', out.counts.slack === 'skipped' && (runRow?.digest?.sections?.drafts || []).some(d => d.brand_name === BRAND) && claudeCalls === 0);
  const token = await accessTokenForGrant(m0.grant, 'gmail');
  const got = await gmail.getDraft(token, bump.gmail_draft_id);
  const hdrs = (got?.message?.payload?.headers || []).map(h => h.name.toLowerCase());
  const subj = (got?.message?.payload?.headers || []).find(h => h.name.toLowerCase() === 'subject')?.value || '';
  ok('5 users.drafts.get: the bump is in the HumanKind mailbox, ids match, same thread as the cold, Subject "Re: ...", NO To header', got?.id === bump.gmail_draft_id && got?.message?.id === bump.gmail_message_id && got?.message?.threadId === cold.touch.gmail_thread_id && /^Re: /.test(subj) && hdrs.includes('subject') && !hdrs.includes('to'), `headers ${hdrs.join(',')}`);
  // 5 real wiring + Today in the browser (GET-only)
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const tIn = await call(todayRoute, reqOf({ method: 'GET' }));
  const tReal = await realGet({ base: BASE, businessId: HK, session: owner.session, path: '/jobs/today' });
  ok(`real wiring: GET /jobs/today through the spawned server.js -> ${tReal.code}, same keys as in-process, ran_today true, the draft listed, no address`, tReal.code === 200 && tIn.code === 200 && keysOf(tReal.body) === keysOf(tIn.body) && tReal.body.ran_today === true && tReal.body.run?.id === created.run && (tReal.body.digest?.sections?.drafts || []).some(d => d.brand_name === BRAND) && !JSON.stringify(tReal.body).includes('@'), tReal.code === 200 ? '' : redact(JSON.stringify(tReal.body)).slice(0, 160));
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const laToday = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  await ctx.addInitScript(([k, v, hl, d]) => {
    if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
    for (const n of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${n}_ran_${hl}`, d);
    localStorage.setItem('prospector_auto_assay_disabled', '1');
  }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HOMELOVER, laToday]);
  await ctx.route('**/*', async route => {
    const req = route.request(); const u = new URL(req.url());
    const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
    if (!isLocal && !isSupa && !isFont) outside.push(`${req.method()} ${u.host}`);
    const deny = (isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname)) || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
    if (deny) { blocked.push(`${req.method()} ${u.pathname}`); return route.abort(); }
    return route.continue();
  });
  const page = await ctx.newPage(); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 140)));
  await page.goto(`${BASE}/`);
  await page.getByLabel('Workspace').waitFor({ timeout: 20000 }); await page.getByLabel('Workspace').selectOption({ label: 'HumanKind' });
  await page.locator('[data-hk-today]').waitFor({ timeout: 20000 }); await page.locator('[data-hk-run-line]').waitFor(); await page.waitForTimeout(900);
  const text = await page.evaluate(() => document.querySelector('[data-hk-shell]').innerText);
  const draftsCard = page.locator('[data-hk-section="drafts"]');
  const row = draftsCard.locator('[data-hk-draft-row]').filter({ hasText: BRAND });
  ok(`6 Today: run line "${(text.match(/Daily check ran today[^\n]*/) || [''])[0].slice(0, 60)}", Drafts to review lists ${BRAND} with Open in Gmail (own mailbox) + Preview + Discard, no "@" on screen`, /Daily check ran today/.test(text) && (await row.count()) === 1 && (await row.locator('[data-hk-open-draft]').count()) === 1 && (await row.getByRole('button', { name: 'Preview' }).count()) === 1 && (await row.getByRole('button', { name: 'Discard' }).count()) === 1 && !text.includes('@'), text.includes('@') ? 'ADDRESS LEAKED' : '');
  await page.screenshot({ path: `${OUT}/stage4-today-1440.png`, fullPage: true });
  ok('browser made 0 writes and 0 outside requests', !outside.length, `${blocked.length} non-GET aborted: ${blocked.slice(0, 4).join(', ')}`);
  ok('No page errors', !errors.length, JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
  // 6 the guard: a second manual run the same Chicago day
  const g1 = gmailCalls.length, runsBefore = await count('hk_job_runs', HK);
  const again = await call(dailyCheckRoute, reqOf({}));
  ok('7 second manual run the same day -> "already ran today" from the DB guard, the same run row returned, no new row, 0 Gmail', again.code === 200 && again.body.skipped === 'already ran today' && again.body.run?.id === created.run && (await count('hk_job_runs', HK)) === runsBefore && gmailCalls.length === g1, JSON.stringify(again.body?.skipped));
  const strayEvents = (await svc.from('hk_events').select('id, entity_id, action').eq('business_id', HK).gte('created_at', new Date(T0).toISOString()).neq('entity_id', created.brand)).data || [];
  ok('8 no real brand was touched: every hk_events row since the run started belongs to the invented brand', strayEvents.length === 0, strayEvents.map(e => e.action).join(','));
  ok(`caps: Gmail ${gmailCalls.length} <= ${GMAIL_CAP} (before cleanup), Claude ${claudeCalls} <= ${CLAUDE_CAP}, Apollo 0${REPLAY ? ' (replay)' : ''}`, gmailCalls.length <= GMAIL_CAP && claudeCalls <= CLAUDE_CAP, gmailCalls.join(' | '));
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', redact(e.message));
} finally {
  await cleanup();
  let gone = null;
  if (m0 && created.drafts.length && !REPLAY) { try { const token = await accessTokenForGrant(m0.grant, 'gmail'); try { await gmail.getDraft(token, created.drafts[created.drafts.length - 1]); gone = false; } catch (e) { gone = e.status === 404; } } catch { gone = null; } }
  let restored = false, line;
  try {
    const after = await snapshot();
    restored = JSON.stringify(before) === JSON.stringify(after);
    line = restored ? `yes (HumanKind hk_* + HomeLover counts identical; deleted exactly the created rows ${JSON.stringify(results.deleted)}; both Gmail drafts deleted by id${gone === true ? ', drafts.get on the bump now 404' : gone === false ? ', BUT the bump draft still answers drafts.get' : ''}; Jack sign-in rows kept by rule)` : `NO - before ${JSON.stringify(before)} after ${JSON.stringify(after)}`;
  } catch (e) { line = `NO (check failed: ${e.message})`; }
  if (!REPLAY) fs.writeFileSync(REC, JSON.stringify(recording));
  const pass = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'hkos-daily-check-v1-stage4.json'), JSON.stringify({ ...results, checks: results.checks.map(c => ({ ...c, detail: redact(c.detail || '') })), created, restored, replay: REPLAY }, null, 2));
  console.log(`\n${pass}/${results.checks.length} checks passed${results.errors.length ? ` · ${results.errors.length} errors` : ''} · Gmail ${REPLAY ? `0 real (${gmailCalls.length} replayed)` : gmailCalls.length} total incl. cleanup · Claude ${claudeCalls} · Apollo 0`);
  for (const e of results.errors) console.log('ERROR:', redact(e.split('\n').slice(0, 3).join(' | ')));
  console.log(`restored: ${line}`);
  process.exit(restored && pass === results.checks.length && !results.errors.length && gone !== false ? 0 : 1);
}
