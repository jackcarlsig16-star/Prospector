// hkos-gmail-connect-v1 Stage 4 LIVE check - as Jack on the REAL HumanKind workspace with his real tethered mailbox.
// Declared caps: Gmail <= 12 HTTP calls (counted at the fetch seam), Claude <= 2 (counted at the callAnthropic seam),
// Apollo 0. Writes = test rows only, deleted by id at the end: one invented brand ("Zz Verify Studio", no domain so the
// warm search never runs on it), one contact WITHOUT an email, ONE Gmail draft with To omitted (omit_recipient) created
// through createDraftRoute and deleted through discardDraftRoute (confirmed gone with users.drafts.get -> 404), one
// hk_sync_runs row + the hk_gmail_sync_state row from a manual sync, the hk_events those routes log. Never a draft to
// a real address. Routes run in-process with the real Supabase service client and real tokenForMailbox /
// accessTokenForGrant; the browser part (composer blocks without a contact email; Drafts screen lists the draft with
// Open in Gmail) is GET-only against the local build (every non-GET aborted). The warm check runs on a domain this
// mailbox has actually emailed, found with ONE sent-mail search + ONE message read; the domain is never printed.
// --replay: Gmail answers come from the recording of the last live run (0 Gmail calls); DB rows are still created and
// deleted. restored = every hk_* + workspace_mailboxes + google_grants + HomeLover count identical; a count() error or
// non-number THROWS -> "restored: NO", exit 1. Runtime ~1-2 min, hard cap 240 s.
// Usage: node scripts/verify/hkos-gmail-connect-v1-stage4.mjs [--replay]   (npm run build first)
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
const { gmailClient } = await import('../../api/hk/gmailClient.js');
const R = await import('../../api/hk/gmailRoutes.js');
const { createBrandRoute, createContactRoute } = await import('../../api/hk/brandsRoutes.js');
const { warmThreads } = await import('../../api/hk/warm.js');
const { lintDraft, lintRejects } = await import('../../api/hk/lint.js');
const { mailboxFor, tokenForMailbox, accessTokenForGrant } = await import('../../api/lib/googleGrants.js');
const REPLAY = process.argv.includes('--replay');
const OUT = path.join(ROOT, '.screenshots', 'hkos-gmail-connect-v1');
const REC = path.join(OUT, 'stage4-gmail-recording.json');
const PORT = 3994, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const HK = '981b790c-a3b0-4265-b32e-1f701d5731ff';
const HK_TABLES = ['hk_brands', 'hk_contacts', 'hk_touches', 'hk_replies', 'hk_sponsor_periods', 'hk_settings', 'hk_events', 'hk_duplicate_decisions', 'hk_import_runs', 'hk_ignored_senders', 'hk_member_prefs', 'hk_gmail_sync_state', 'hk_sync_runs', 'business_members', 'workspace_mailboxes'];
const HL_TABLES = ['accounts', 'lists', 'projects', 'sales_goals', 'sales_opportunities', 'sales_targets', 'sales_people', 'sales_source_events', 'sales_partner_events', 'partner_contacts', 'sales_week_goals'];
const GMAIL_CAP = 12, CLAUDE_CAP = 2;
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const count = async (t, biz) => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', biz); if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message || `no count (HTTP ${r.status})`}`); return r.count; };
const snapshot = async () => { const o = { humankind: {}, homelover: {} }; for (const t of HK_TABLES) o.humankind[t] = await count(t, HK); for (const t of HL_TABLES) o.homelover[t] = await count(t, HOMELOVER); const g = await svc.from('google_grants').select('*', { count: 'exact', head: true }); if (g.error || typeof g.count !== 'number') throw new Error('count google_grants'); o.google_grants = g.count; return o; };
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
const ADDR = /[^\s@<>()"',;=&#]+(?:@|%40)[^\s@<>()"',;=&#]+\.[a-z]{2,}/gi;
const redact = s => String(s).replace(ADDR, '<address>');

// Gmail at the fetch seam: count every HTTP call, record for --replay, replay from the recording.
const gmailCalls = [], recording = REPLAY ? JSON.parse(fs.readFileSync(REC, 'utf8')) : [];
let claudeCalls = 0;
const gmailFetch = async (url, init = {}) => {
  const u = new URL(url); const key = `${init.method || 'GET'} ${u.pathname.replace(/\/[A-Za-z0-9_-]{8,}(?=\/|$)/g, '/<id>')}`;
  gmailCalls.push(key);
  if (gmailCalls.length > GMAIL_CAP) throw new Error(`Gmail cap ${GMAIL_CAP} exceeded (${key})`);
  if (REPLAY) { const i = recording.findIndex(r => r && r.key === key); if (i < 0) throw new Error(`replay: no recorded answer for ${key}`); const r = recording[i]; recording[i] = null; return { status: r.status, ok: r.status >= 200 && r.status < 300, text: async () => r.text }; }
  const r = await fetch(url, init); const text = await r.text();
  recording.push({ key, status: r.status, text });
  return { status: r.status, ok: r.ok, text: async () => text };
};
const gmail = gmailClient(gmailFetch);
const callClaude = async () => { claudeCalls++; throw new Error(`Claude cap ${CLAUDE_CAP}: no model call was expected in this run (0 replies tracked)`); };

let srv, browser, owner, JACK;
const created = { brand: null, contact: null, touch: null, run: null, syncState: false };
const blocked = [], outside = [];
const results = { checks: [], errors: [], gmailCalls, run: null };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${redact(detail)}` : ''); };
const reqOf = ({ method = 'POST', params = {}, query = {}, body = {} } = {}) => ({ method, params: { businessId: HK, ...params }, query, body, auth: { user: { id: JACK, name: 'Jack' }, isPlatformOwner: true, roles: new Map([[HK, 'owner']]) } });
const call = async (route, req, d = {}) => { const r = { code: 200, body: null }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; await route(req, r, { supabase: svc, gmail, call: callClaude, ...d }); return r; };
async function removeCreated() {
  const out = {};
  const del = async (t, q) => { const r = await q.select('id'); if (r.error) console.log(`cleanup ${t}:`, r.error.message); out[t] = (out[t] || 0) + (r.data?.length ?? -1); };
  if (created.touch) await del('hk_touches', svc.from('hk_touches').delete().eq('id', created.touch));
  if (created.contact) await del('hk_contacts', svc.from('hk_contacts').delete().eq('id', created.contact));
  if (created.brand) { await del('hk_events', svc.from('hk_events').delete().eq('business_id', HK).eq('entity_id', created.brand)); await del('hk_brands', svc.from('hk_brands').delete().eq('id', created.brand)); }
  if (created.run) await del('hk_sync_runs', svc.from('hk_sync_runs').delete().eq('id', created.run));
  if (created.syncState) { const r = await svc.from('hk_gmail_sync_state').delete().eq('business_id', HK).eq('user_id', JACK).select('business_id'); out.hk_gmail_sync_state = r.data?.length ?? -1; }
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
for (const v of ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GOOGLE_TOKEN_KEY']) if (!process.env[v]) { console.log(`ABORT before any write: ${v} is not set in .env (the token refresh needs the same OAuth client as Render; names only, never paste values into chat)`); process.exit(1); }
const pre = await svc.from('hk_brands').select('id').eq('business_id', HK).ilike('name', 'Zz Verify%');
if (pre.data?.length) { console.log('ABORT: leftover verify brands exist - remove them first:', pre.data.map(b => b.id).join(', ')); process.exit(1); }
const before = await snapshot();
log(REPLAY ? 'REPLAY run (0 Gmail calls)' : 'LIVE run', 'before', JSON.stringify(before.humankind), 'HomeLover accounts', before.homelover.accounts);

try {
  const members = await svc.from('business_members').select('user_id, role').eq('business_id', HK);
  JACK = members.data.find(m => m.role === 'owner').user_id;
  const m0 = await mailboxFor(HK, JACK, 'drafts');
  if (!m0 || m0.state !== 'ok') throw new Error(`mailbox not ready: ${m0 ? m0.state : 'none'} - link / reconnect the HumanKind Gmail on Connections first`);
  const settings = (await svc.from('hk_settings').select('*').eq('business_id', HK).maybeSingle()).data;
  const SUBJECT = 'HumanKind x Zz Verify Studio - a mat-time challenge';
  const BODY = `Hi there - hope the week is going well.\n\nI'm Jack, co-founder of HumanKind, a free community wellness platform launched in Chicago in April. We're at ${settings.members_stat.toLocaleString('en-US')}+ members and ${settings.completions_stat.toLocaleString('en-US')}+ verified challenge completions.\n\nYou can check out the community here: https://humankindcollective.app\n\nZz Verify Studio is a natural fit: a "mat time" challenge with a class pass as the reward.\n\nEvery completion is verified, so you're driving real behavior, not clicks.\n\nWorth a 15-minute call to see if it makes sense?\n\nThanks,\nJack`;
  const rejects = lintRejects(lintDraft(SUBJECT, BODY, 'cold', settings));
  if (rejects.length) throw new Error(`the test body fails the real lint before any Gmail call: ${JSON.stringify(rejects)}`);
  // 1 invented brand (no domain) + contact without an email
  const b = await call(createBrandRoute, reqOf({ body: { name: 'Zz Verify Studio', niche: 'yoga', notes: 'verify row, deleted by the script' } }));
  if (b.code !== 201) throw new Error(`create brand: ${b.code} ${JSON.stringify(b.body)}`);
  created.brand = b.body.brand.id;
  const c = await call(createContactRoute, reqOf({ params: { id: created.brand }, body: { name: 'Verify Contact', title: 'Owner', is_primary: true } }));
  if (c.code !== 201) throw new Error(`create contact: ${c.code} ${JSON.stringify(c.body)}`);
  created.contact = c.body.contact.id;
  ok('1 invented brand (no domain) + primary contact without an email created through the routes', !!created.brand && !!created.contact && c.body.contact.email == null);
  const noEmail = await call(R.createDraftRoute, reqOf({ body: { brand_id: created.brand, channel: 'email', kind: 'cold', subject: SUBJECT, body_markdown: BODY } }));
  ok('2 route refuses a draft with no contact email (409 needs_contact) before any Gmail write', noEmail.code === 409 && noEmail.body.needs_contact === true && !gmailCalls.some(k => k.startsWith('POST')), `${noEmail.code} ${noEmail.body?.error}`);
  // browser, GET-only
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  await ctx.addInitScript(([k, v, hl, d]) => {
    if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
    for (const n of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${n}_ran_${hl}`, d);
    localStorage.setItem('prospector_auto_assay_disabled', '1');
  }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HOMELOVER, today]);
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
  await page.locator('[data-hk-shell] [data-hk-avatar]').waitFor({ timeout: 20000 }); await page.waitForTimeout(900);
  const nav = async id => { await page.locator(`[data-hk-nav="${id}"]`).click(); await page.waitForTimeout(800); };
  await page.evaluate(id => { window.location.hash = `#hk/brands/${id}`; }, created.brand);
  await page.locator(`[data-hk-brand-page="${created.brand}"]`).waitFor(); await page.waitForTimeout(600);
  await page.locator('[data-hk-more]').click(); await page.waitForTimeout(200); await page.locator('[data-hk-draft-email]').click();
  const comp = page.locator('[data-hk-composer]'); await comp.waitFor(); await page.waitForTimeout(600);
  const blockText = (await comp.locator('[data-hk-composer-block]').count()) ? await comp.locator('[data-hk-composer-block]').innerText() : '';
  const save = comp.locator('[data-hk-save-draft]');
  ok('3 composer blocks: "no contact with an email" line, To empty, Save disabled with that reason', /no contact with an email yet/.test(blockText) && (await comp.locator('[data-hk-composer-to]').inputValue()) === '' && (await save.isDisabled()) && /No contact with an email/.test((await save.getAttribute('title')) || ''), blockText.slice(0, 70));
  await page.screenshot({ path: `${OUT}/stage4-composer-blocked.png` });
  await comp.getByRole('button', { name: 'Cancel' }).click();
  // 4 ONE draft, To omitted
  const d = await call(R.createDraftRoute, reqOf({ body: { brand_id: created.brand, contact_id: created.contact, channel: 'email', kind: 'cold', subject: SUBJECT, body_markdown: BODY, omit_recipient: true } }));
  if (d.code !== 201) throw new Error(`create draft: ${d.code} ${redact(JSON.stringify(d.body))}`);
  created.touch = d.body.touch_id;
  const touch = (await svc.from('hk_touches').select('*').eq('id', created.touch).single()).data;
  ok('4 ONE draft created with To omitted: 201, touch drafted with gmail_draft_id + gmail_message_id, brand drafted + owned by Jack, draft_created event', touch.state === 'drafted' && !!touch.gmail_draft_id && !!touch.gmail_message_id && touch.contact_id === created.contact && (await svc.from('hk_brands').select('status, owner_user_id').eq('id', created.brand).single()).data.status === 'drafted' && (await svc.from('hk_events').select('id').eq('entity_id', created.brand).eq('action', 'draft_created')).data.length === 1, `gmail calls so far ${gmailCalls.length}`);
  const token = await accessTokenForGrant(m0.grant, 'gmail');
  const got = await gmail.getDraft(token, touch.gmail_draft_id);
  const hdrs = (got?.message?.payload?.headers || []).map(h => h.name.toLowerCase());
  ok('5 users.drafts.get confirms the draft in the HumanKind mailbox: ids match, Subject present, NO To header', got?.id === touch.gmail_draft_id && got?.message?.id === touch.gmail_message_id && hdrs.includes('subject') && !hdrs.includes('to'), `headers ${hdrs.join(',')}`);
  // Drafts screen
  await nav('drafts'); await page.locator('[data-hk-drafts]').waitFor(); await page.waitForTimeout(900);
  const row = page.locator('[data-hk-drafts] [data-row]').filter({ hasText: 'Zz Verify Studio' });
  const href = (await row.count()) ? await row.locator('[data-hk-open-gmail]').getAttribute('href') : null;
  ok('6 Drafts screen lists it with Open in Gmail pointing at #drafts/<message id> in the caller\'s mailbox', (await row.count()) === 1 && !!href && href.includes(`#drafts/${encodeURIComponent(touch.gmail_message_id)}`) && /authuser=/.test(href), redact(href || 'no row'));
  await page.screenshot({ path: `${OUT}/stage4-drafts.png` });
  ok('browser made 0 writes and 0 outside requests', !outside.length, `${blocked.length} non-GET aborted: ${blocked.slice(0, 4).join(', ')}`);
  ok('No page errors', !errors.length, JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
  // 7 Discard
  const del = await call(R.discardDraftRoute, reqOf({ method: 'DELETE', params: { touchId: created.touch } }));
  const after = (await svc.from('hk_touches').select('state').eq('id', created.touch).single()).data;
  let gone = false; try { await gmail.getDraft(token, touch.gmail_draft_id); } catch (e) { gone = e.status === 404; }
  ok('7 Discard: DELETE /drafts/<id> on Gmail, users.drafts.get now 404, touch discarded, brand back to claimed, draft_discarded event', del.code === 200 && gone && after.state === 'discarded' && (await svc.from('hk_brands').select('status').eq('id', created.brand).single()).data.status === 'claimed' && (await svc.from('hk_events').select('id').eq('entity_id', created.brand).eq('action', 'draft_discarded')).data.length === 1, `discard ${del.code}`);
  // 8 manual sync
  const s = await call(R.syncRoute, reqOf({ query: { trigger: 'manual' } }));
  created.syncState = true; created.run = s.body?.run?.id || null;
  const state = (await svc.from('hk_gmail_sync_state').select('status, history_id, last_synced_at, grant_id').eq('business_id', HK).eq('user_id', JACK).maybeSingle()).data;
  const runRow = created.run ? (await svc.from('hk_sync_runs').select('trigger, status, counts, error, started_at, finished_at').eq('id', created.run).single()).data : null;
  results.run = runRow; results.state = state;
  ok('8 manual sync: 200, run row ok with counts, 0 replies, state ok with history_id set and grant_id = the tethered grant, 0 Claude calls', s.code === 200 && runRow?.status === 'ok' && runRow.counts && (runRow.counts.replies || 0) === 0 && state?.status === 'ok' && /^\d+$/.test(String(state.history_id)) && state.grant_id === m0.grant.id && claudeCalls === 0, `run ${JSON.stringify(runRow)} history_id ${state?.history_id}`);
  // 9 warm check on a domain this mailbox has emailed: one sent-mail search + one read to find it (domain never printed)
  const sent = await gmail.searchMessages(token, 'in:sent', 1);
  const sentMsg = sent?.messages?.[0] ? await gmail.getMessage(token, sent.messages[0].id) : null;
  const toHeader = (sentMsg?.payload?.headers || []).find(h => h.name.toLowerCase() === 'to')?.value || '';
  const domain = (toHeader.match(/@([a-z0-9.-]+\.[a-z]{2,})/i) || [])[1]?.toLowerCase() || null;
  if (!domain) ok('9 warm check needs a sent message with a To domain in this mailbox', false, 'none found');
  else {
    const warm = await warmThreads({ supabase: svc, businessId: HK, brandId: null, domain, callerUserId: JACK, gmail, token });
    const w = warm[0];
    ok('9 warm check on a real emailed domain returns exactly { founder Jack, last_at ISO date } and nothing else (no subject, no address, no link)', warm.length === 1 && w.founder_user_id === JACK && Object.keys(w).sort().join(',') === 'founder_user_id,last_at' && !Number.isNaN(Date.parse(w.last_at)), `last_at ${w?.last_at?.slice(0, 10)}`);
  }
  ok(`caps: Gmail ${gmailCalls.length} <= ${GMAIL_CAP}, Claude ${claudeCalls} <= ${CLAUDE_CAP}, Apollo 0${REPLAY ? ' (replay: 0 real Gmail calls)' : ''}`, gmailCalls.length <= GMAIL_CAP && claudeCalls <= CLAUDE_CAP, gmailCalls.join(' | '));
  if (!REPLAY) fs.writeFileSync(REC, JSON.stringify(recording));
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', redact(e.message));
} finally {
  await cleanup();
  let restored = false, line;
  try {
    const after = await snapshot();
    restored = JSON.stringify(before) === JSON.stringify(after);
    line = restored ? `yes (HumanKind hk_* + workspace_mailboxes + google_grants + HomeLover counts identical; deleted exactly the created rows ${JSON.stringify(results.deleted)}; the one Gmail draft deleted by id; Jack sign-in rows kept by rule)` : `NO - before ${JSON.stringify(before)} after ${JSON.stringify(after)}`;
  } catch (e) { line = `NO (check failed: ${e.message})`; }
  const pass = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'hkos-gmail-connect-v1-stage4.json'), JSON.stringify({ ...results, checks: results.checks.map(c => ({ ...c, detail: redact(c.detail || '') })), created, restored, replay: REPLAY }, null, 2));
  console.log(`\n${pass}/${results.checks.length} checks passed${results.errors.length ? ` · ${results.errors.length} errors` : ''} · Gmail ${REPLAY ? `0 real (${gmailCalls.length} replayed)` : gmailCalls.length} · Claude ${claudeCalls} · Apollo 0`);
  for (const e of results.errors) console.log('ERROR:', redact(e.split('\n').slice(0, 3).join(' | ')));
  console.log(`restored: ${line}`);
  process.exit(restored && pass === results.checks.length && !results.errors.length ? 0 : 1);
}
