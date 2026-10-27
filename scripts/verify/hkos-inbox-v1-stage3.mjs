// hkos-inbox-v1 Stage 3 LIVE check - as Jack on the REAL HumanKind workspace, reading Jack's OWN tethered HumanKind
// mailbox through the inbox routes run in-process (real service client, real mailboxFor / tokenForMailbox). Declared
// scope: Gmail <= 15 calls (counted at the fetch seam, the run throws past the cap), Claude <= 1 (counted at the
// `call` seam; the run throws if it is reached - a tracked new thread needs no model), Apollo 0. Writes: ONE verify
// brand ("Zz Verify Inbox Brand") + ONE reply row + ONE ignored domain and their events, all deleted by id in teardown.
// Steps: Inbox page 1 (limit 5 - a page costs 1 + one metadata get per thread) with chip counts and 0 addresses in the
// payload; open one thread (html raw for the owner only, no address outside the bodies); the browser (GET-only, its two
// inbox GETs fulfilled from the payloads above so Gmail is not read twice) renders that thread in <iframe sandbox="">
// with sanitized srcdoc and blocked images; Track as brand on an invented thread -> 404; Track as brand on a real
// untracked thread -> brand + reply row; Brands only tab shows it tracked (1 list call, metadata cached); a from:
// search on a real domain (never printed); ignore + un-ignore a domain (DB proof, 0 Gmail). Recording for --replay is
// scrubbed of addresses before it is written and lives in .screenshots (gitignored). No screenshot of real mail is
// taken. restored = every hk_* count + HomeLover counts identical after cleanup; a count() error THROWS -> "restored:
// NO", exit 1. Runtime ~1-2 min, cap 240 s.
// Usage: node scripts/verify/hkos-inbox-v1-stage3.mjs [--replay]   (npm run build first)
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
const R = await import('../../api/hk/inboxRoutes.js');
const { stripBodies } = await import('../../api/hk/inboxRules.js');
const { mailboxFor, tokenForMailbox } = await import('../../api/lib/googleGrants.js');
const REPLAY = process.argv.includes('--replay');
const OUT = path.join(ROOT, '.screenshots', 'hkos-inbox-v1');
const REC = path.join(OUT, 'stage3-gmail-recording.json');
const PORT = 3996, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const HK = '981b790c-a3b0-4265-b32e-1f701d5731ff';
const HK_TABLES = ['hk_brands', 'hk_contacts', 'hk_touches', 'hk_replies', 'hk_sponsor_periods', 'hk_settings', 'hk_events', 'hk_duplicate_decisions', 'hk_import_runs', 'hk_ignored_senders', 'hk_member_prefs', 'hk_gmail_sync_state', 'hk_sync_runs', 'business_members', 'workspace_mailboxes'];
const HL_TABLES = ['accounts', 'lists', 'projects', 'sales_goals', 'sales_opportunities', 'sales_targets', 'sales_people', 'sales_source_events', 'sales_partner_events', 'partner_contacts', 'sales_week_goals'];
const GMAIL_CAP = 15, CLAUDE_CAP = 1, LIMIT = 5;
const BRAND_NAME = 'Zz Verify Inbox Brand';
// The recording scrubs every address to redacted@example.invalid, so a replay cannot reuse a real sender domain.
const safeDomain = d => (REPLAY ? 'zz-verify-replay.com' : d);
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now(), START_ISO = new Date().toISOString();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const count = async (t, biz) => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', biz); if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message || `no count (HTTP ${r.status})`}`); return r.count; };
const snapshot = async () => { const o = { humankind: {}, homelover: {} }; for (const t of HK_TABLES) o.humankind[t] = await count(t, HK); for (const t of HL_TABLES) o.homelover[t] = await count(t, HOMELOVER); const g = await svc.from('google_grants').select('*', { count: 'exact', head: true }); if (g.error || typeof g.count !== 'number') throw new Error('count google_grants'); o.google_grants = g.count; return o; };
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
const ADDR = /[^\s@<>()"',;=&#]+(?:@|%40)[^\s@<>()"',;=&#]+\.[a-z]{2,}/gi;
const redact = s => String(s).replace(ADDR, '<address>');
const scrub = s => String(s).replace(ADDR, 'redacted@example.invalid');
const hasAt = v => JSON.stringify(v).includes('@');

// Gmail at the fetch seam: count, cap, record (scrubbed) for --replay, replay.
const gmailCalls = [], recording = REPLAY ? JSON.parse(fs.readFileSync(REC, 'utf8')) : [];
let claudeCalls = 0;
const gmailFetch = async (url, init = {}) => {
  const u = new URL(url); const key = `${init.method || 'GET'} ${u.pathname.replace(/\/[A-Za-z0-9_-]{8,}(?=\/|$)/g, '/<id>')}${u.searchParams.has('format') ? ` format=${u.searchParams.get('format')}` : ''}`;
  gmailCalls.push(key);
  if (gmailCalls.length > GMAIL_CAP) throw new Error(`Gmail cap ${GMAIL_CAP} exceeded (${key})`);
  if ((init.method || 'GET') !== 'GET') throw new Error(`the inbox never writes to Gmail: ${key}`);
  if (REPLAY) { const i = recording.findIndex(r => r && r.key === key); if (i < 0) throw new Error(`replay: no recorded answer for ${key}`); const r = recording[i]; recording[i] = null; return { status: r.status, ok: r.status >= 200 && r.status < 300, text: async () => r.text }; }
  const r = await fetch(url, init); const text = await r.text();
  recording.push({ key, status: r.status, text: scrub(text) });
  return { status: r.status, ok: r.ok, text: async () => text };
};
const gmail = gmailClient(gmailFetch);
const callClaude = async () => { claudeCalls++; throw new Error(`Claude cap ${CLAUDE_CAP}: no model call was expected (a brand with no sent email gets label new_thread)`); };

let srv, browser, owner, JACK;
const created = { brand: null, reply: null, ignoredDomain: null };
const blocked = [], outside = [], fulfilled = [];
const results = { checks: [], errors: [], gmailCalls, measured: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${redact(detail)}` : ''); };
const skip = (name, why) => { results.checks.push({ name, pass: true, skipped: true, detail: why }); log('SKIP', name, `- ${why}`); };
const reqOf = ({ method = 'GET', params = {}, query = {}, body = {} } = {}) => ({ method, params: { businessId: HK, ...params }, query, body, auth: { user: { id: JACK, name: 'Jack' }, isPlatformOwner: true, roles: new Map([[HK, 'owner']]) } });
const call = async (route, req) => { const r = { code: 200, body: null }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; await route(req, r, { supabase: svc, gmail, call: callClaude, mailbox: mailboxFor, tokenFor: tokenForMailbox }); return r; };
async function removeCreated() {
  const out = {};
  const del = async (t, q) => { const r = await q.select('id'); if (r.error) console.log(`cleanup ${t}:`, r.error.message); out[t] = (out[t] || 0) + (r.data?.length ?? -1); };
  if (created.reply) await del('hk_replies', svc.from('hk_replies').delete().eq('id', created.reply));
  if (created.brand) { await del('hk_events', svc.from('hk_events').delete().eq('business_id', HK).eq('entity_id', created.brand)); await del('hk_brands', svc.from('hk_brands').delete().eq('id', created.brand)); }
  if (created.ignoredDomain) {
    await del('hk_ignored_senders', svc.from('hk_ignored_senders').delete().eq('business_id', HK).eq('user_id', JACK).eq('domain', created.ignoredDomain));
    await del('hk_events', svc.from('hk_events').delete().eq('business_id', HK).eq('actor_user_id', JACK).eq('entity_type', 'sender').in('action', ['sender_ignored', 'sender_unignored']).gte('created_at', START_ISO));
  }
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
for (const v of ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GOOGLE_TOKEN_KEY']) if (!process.env[v]) { console.log(`ABORT before any write: ${v} is not set in .env (names only)`); process.exit(1); }
const pre = await svc.from('hk_brands').select('id').eq('business_id', HK).ilike('name', 'Zz Verify%');
if (pre.data?.length) { console.log('ABORT: leftover verify brands exist - remove them first:', pre.data.map(b => b.id).join(', ')); process.exit(1); }
const before = await snapshot();
log(REPLAY ? 'REPLAY run (0 real Gmail calls)' : 'LIVE run', 'before', JSON.stringify(before.humankind), 'HomeLover accounts', before.homelover.accounts);

try {
  const members = await svc.from('business_members').select('user_id, role').eq('business_id', HK);
  JACK = members.data.find(m => m.role === 'owner').user_id;
  const m0 = await mailboxFor(HK, JACK, 'inbox');
  if (!m0 || m0.state !== 'ok') throw new Error(`mailbox not ready for purpose inbox: ${m0 ? m0.state : 'none'}`);
  R.inboxCache.clear();
  // 1 Inbox page 1
  const p1 = await call(R.listThreadsRoute, reqOf({ query: { tab: 'inbox', limit: String(LIMIT) } }));
  if (p1.code !== 200) throw new Error(`list: ${p1.code} ${redact(JSON.stringify(p1.body))}`);
  const rows = p1.body.threads;
  const kinds = rows.reduce((o, r) => { o[r.chip.kind] = (o[r.chip.kind] || 0) + 1; return o; }, {});
  results.measured.list_page = { threads: rows.length, gmail_calls: p1.body.gmail_calls, unread: p1.body.unread, kinds };
  const callsAfterList = gmailCalls.length;
  ok(`1 Inbox page 1 (limit ${LIMIT}): ${rows.length} threads, chips ${JSON.stringify(kinds)}, unread ${p1.body.unread}, ${p1.body.gmail_calls} Gmail calls (1 list + 1 metadata get per thread), 0 addresses in the payload`, rows.length > 0 && rows.length <= LIMIT && !hasAt(p1.body) && p1.body.gmail_calls === callsAfterList && callsAfterList === 1 + rows.length && rows.every(r => r.from_name && typeof r.subject === 'string' && r.snippet.length <= 140));
  // 2 open one thread (the one to track: untracked with a domain, else bulk, else the first)
  const target = rows.find(r => r.chip.kind === 'untracked' && r.from_domain) || rows.find(r => r.chip.kind === 'not_tracked' && r.from_domain) || rows[0];
  const o = await call(R.openThreadRoute, reqOf({ params: { id: target.thread_id } }));
  if (o.code !== 200) throw new Error(`open: ${o.code} ${redact(JSON.stringify(o.body))}`);
  const openCalls = gmailCalls.length - callsAfterList;
  results.measured.open = { gmail_calls: openCalls, messages: o.body.messages.length, html_messages: o.body.messages.filter(m => m.html).length };
  ok(`2 open: ${o.body.messages.length} message(s) (${results.measured.open.html_messages} with html, raw, for the owner only), names + domains only outside the bodies, brand panel ${o.body.brand ? 'present' : 'null'}, ${openCalls} Gmail call`, openCalls === 1 && o.body.messages.length >= 1 && !hasAt(stripBodies(o.body)) && o.body.messages.every(m => Array.isArray(m.to_names) && !m.to_names.some(n => /@/.test(n))));
  // 3 browser, GET-only, inbox GETs answered from the payloads above
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  await ctx.addInitScript(([k, v, hl, d]) => {
    if (window !== window.top) return;
    if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
    for (const n of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${n}_ran_${hl}`, d);
    localStorage.setItem('prospector_auto_assay_disabled', '1');
  }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HOMELOVER, today]);
  await ctx.route('**/*', async route => {
    const req = route.request(); const u = new URL(req.url());
    if (/anthropic\.com$|apollo\.io$|gmail\.googleapis\.com$|accounts\.google\.com$/.test(u.host) || u.host === 'www.googleapis.com') outside.push(`${req.method()} ${u.host}${u.pathname}`);
    const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
    if (isLocal && req.method() === 'GET' && /^\/api\/hk\/[^/]+\/inbox\/threads/.test(u.pathname)) {
      fulfilled.push(u.pathname);
      const body = /\/inbox\/threads\/[^/]+$/.test(u.pathname) ? o.body : p1.body;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    }
    const deny = (isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname)) || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
    if (deny) { blocked.push(`${req.method()} ${u.pathname}`); return route.abort(); }
    return route.continue();
  });
  const page = await ctx.newPage(); page.setDefaultTimeout(15000);
  const pageErrors = []; page.on('pageerror', e => pageErrors.push(e.message.slice(0, 140)));
  await page.goto(`${BASE}/`);
  await page.getByLabel('Workspace').waitFor({ timeout: 20000 });
  await page.getByLabel('Workspace').selectOption({ label: 'HumanKind' });
  await page.locator('[data-hk-shell] [data-hk-avatar]').waitFor({ timeout: 20000 }); await page.waitForTimeout(600);
  await page.evaluate(() => { window.location.hash = '#hk/inbox'; }); await page.locator(`[data-hk-thread="${target.thread_id}"]`).waitFor(); await page.waitForTimeout(400);
  const shellText = await page.evaluate(() => document.querySelector('[data-hk-shell]').innerText);
  ok(`3 browser Inbox: ${await page.locator('[data-hk-thread]').count()} rows from the real page (served from the payload above, 0 extra Gmail), no address on screen, no Send, "Only you see your inbox."`, (await page.locator('[data-hk-thread]').count()) === rows.length && !/[^\s@<>()"']+@[^\s@<>()"']+\.[a-z]{2,}/i.test(shellText) && !/\bSend\b/.test(shellText) && /Only you see your inbox/.test(shellText));
  await page.locator(`[data-hk-thread="${target.thread_id}"]`).click(); await page.locator('[data-hk-inbox-thread] [data-hk-message]').first().waitFor(); await page.waitForTimeout(500);
  const frames = await page.locator('[data-hk-frame]').count();
  const htmlMsgs = o.body.messages.filter(m => m.html).length;
  if (frames) {
    const frame = page.locator('[data-hk-frame]').first();
    const sandbox = await frame.getAttribute('sandbox'); const srcdoc = await frame.getAttribute('srcdoc') || '';
    const hadImages = o.body.messages.some(m => m.html && /<(img|picture|video|source)\b/i.test(m.html));
    ok(`4 the real thread renders in <iframe sandbox=""> (${frames} frame(s)); srcdoc has no script / form / input / live remote src; images ${hadImages ? 'blocked with the strip shown' : 'none in this mail'}; no address outside the frame`, sandbox === '' && !/<script|<form|<input|<iframe|<object|<embed/i.test(srcdoc) && !/(?<![-\w])src="https?:/.test(srcdoc) && (!hadImages || ((await page.locator('[data-hk-images-hidden]').count()) === 1 && /data-blocked-src=/.test(srcdoc))) && !/[^\s@<>()"']+@[^\s@<>()"']+\.[a-z]{2,}/i.test(await page.locator('[data-hk-inbox-thread]').innerText()), `html messages ${htmlMsgs}`);
  } else ok('4 the real thread has no html part; its text renders in the pane (no frame needed), no address outside the body', htmlMsgs === 0 && (await page.locator('[data-hk-inbox-thread] .hk-inbox__text').count()) >= 1);
  const replyHref = await page.locator('[data-hk-reply-gmail]').getAttribute('href');
  ok('5 Reply in Gmail opens a new tab on the caller\'s own mailbox (authuser) at this thread; no compose box', /^https:\/\/mail\.google\.com\/mail\/\?authuser=.+#all\//.test(replyHref || '') && replyHref.endsWith(encodeURIComponent(target.thread_id)) && (await page.locator('[data-hk-inbox] textarea').count()) === 0);
  ok('6 brand panel for the opened thread matches its chip', (await page.locator(`[data-hk-brand-panel="${o.body.chip.kind === 'not_tracked' && o.body.chip.reason === 'ignored' ? 'ignored' : o.body.brand ? o.body.chip.kind : o.body.chip.kind === 'team' ? 'team' : 'untracked'}"]`).count()) === 1);
  ok('No page errors', !pageErrors.length, JSON.stringify(pageErrors.slice(0, 3)));
  await ctx.close();
  // 7 track an invented thread -> 404, nothing created
  const callsBeforeTrack = gmailCalls.length;
  const ghost = await call(R.trackRoute, reqOf({ method: 'POST', body: { name: BRAND_NAME, domain: 'zz-verify.invalid', thread_id: '19a0000000000000' } }));
  ok(`7 Track as brand on an invented (hex-shaped) thread id: ${ghost.code} not in your mailbox, no brand created, 1 Gmail call`, ghost.code === 404 && !(await svc.from('hk_brands').select('id').eq('business_id', HK).eq('name', BRAND_NAME)).data?.length && gmailCalls.length - callsBeforeTrack === 1);
  // 8 track the real thread
  if (target.chip.kind === 'untracked' || target.chip.kind === 'not_tracked') {
    const callsBefore8 = gmailCalls.length;
    const t = await call(R.trackRoute, reqOf({ method: 'POST', body: { name: BRAND_NAME, domain: safeDomain(target.from_domain), thread_id: target.thread_id, notes: 'verify row, deleted by the script' } }));
    if (t.code !== 201) throw new Error(`track: ${t.code} ${redact(JSON.stringify(t.body))}`);
    created.brand = t.body.brand.id; created.reply = t.body.reply.id;
    const reply = (await svc.from('hk_replies').select('*').eq('id', created.reply).single()).data;
    const ev = (await svc.from('hk_events').select('action, detail').eq('business_id', HK).eq('entity_id', created.brand)).data || [];
    ok(`8 Track as brand on a real ${target.chip.kind} thread: 201, brand candidate (unclaimed) + reply row { label ${reply.label}, touch null, handled false }, events ${ev.map(e => e.action).join(' + ')} with no content, 0 extra Gmail calls (metadata cached), Claude ${claudeCalls}`, t.body.brand.status === 'candidate' && !t.body.brand.owner_user_id && reply.gmail_thread_id === target.thread_id && reply.label === 'new_thread' && reply.touch_id === null && reply.handled === false && !hasAt(t.body) && ev.map(e => e.action).sort().join() === 'brand.created,inbox_linked' && !ev.some(e => hasAt(e.detail)) && gmailCalls.length === callsBefore8 && claudeCalls === 0);
    // 9 Brands only shows it tracked
    const callsBefore9 = gmailCalls.length;
    const b = await call(R.listThreadsRoute, reqOf({ query: { tab: 'brands', limit: String(LIMIT) } }));
    const hit = b.body?.threads?.find(x => x.thread_id === target.thread_id);
    results.measured.brands_tab = { threads: b.body?.threads?.length, gmail_calls: gmailCalls.length - callsBefore9 };
    ok(`9 Brands only (limit ${LIMIT}): ${b.body?.threads?.length} thread(s), the tracked one carries { tracked, ${BRAND_NAME}, candidate, new_thread }, ${gmailCalls.length - callsBefore9} Gmail call (metadata reused), 0 addresses`, b.code === 200 && !!hit && hit.chip.kind === 'tracked' && hit.chip.brand_id === created.brand && hit.chip.label === 'new_thread' && gmailCalls.length - callsBefore9 === 1 && !hasAt(b.body));
  } else skip('8-9 Track as brand on a real untracked thread + Brands only', `page 1 has no untracked or bulk thread (kinds ${JSON.stringify(kinds)}); covered by inboxRoutes.test.mjs`);
  // 10 from: search on a real domain (never printed)
  const domainRow = rows.find(r => r.from_domain && r.chip.kind !== 'team') || rows.find(r => r.from_domain);
  if (domainRow) {
    const callsBefore10 = gmailCalls.length;
    const sr = await call(R.listThreadsRoute, reqOf({ query: { tab: 'inbox', q: `from:${domainRow.from_domain}`, limit: String(LIMIT) } }));
    const found = sr.body?.threads || [];
    const d = domainRow.from_domain, root = d.split('.').slice(-2).join('.');
    const diag = { threads: found.length, same_domain: found.filter(r => r.from_domain === d).length, same_root: found.filter(r => (r.from_domain || '').endsWith(root)).length, includes_source_thread: found.some(r => r.thread_id === domainRow.thread_id), latest_is_team: found.filter(r => r.chip.kind === 'team').length, kinds: found.reduce((o, r) => { o[r.chip.kind] = (o[r.chip.kind] || 0) + 1; return o; }, {}), gmail_calls: gmailCalls.length - callsBefore10 };
    results.measured.search = diag;
    ok(`10 search from:<a real domain> (limit ${LIMIT}): ${JSON.stringify(diag)} - at least one result is from that domain or is the thread the domain came from; q passed to Gmail verbatim; domain never printed`, sr.code === 200 && found.length >= 1 && (diag.same_domain > 0 || diag.includes_source_thread) && !hasAt(sr.body));
  } else skip('10 from: search', 'no row with a domain on page 1');
  // 11 ignore + un-ignore (0 Gmail)
  const ignoreRow = rows.find(r => r.from_domain && r.chip.kind !== 'team' && r.chip.kind !== 'tracked' && r.chip.kind !== 'matches' && r.thread_id !== target.thread_id) || domainRow;
  if (ignoreRow) {
    const callsBefore11 = gmailCalls.length;
    const igDomain = safeDomain(ignoreRow.from_domain);
    const ig = await call(R.ignoreRoute, reqOf({ method: 'POST', body: { domain: igDomain } }));
    created.ignoredDomain = igDomain;
    const rowIn = (await svc.from('hk_ignored_senders').select('id').eq('business_id', HK).eq('user_id', JACK).eq('domain', igDomain)).data || [];
    const listed = await call(R.listIgnoredRoute, reqOf());
    const un = await call(R.unignoreRoute, reqOf({ method: 'DELETE', params: { domain: igDomain } }));
    const rowOut = (await svc.from('hk_ignored_senders').select('id').eq('business_id', HK).eq('user_id', JACK).eq('domain', igDomain)).data || [];
    const evs = (await svc.from('hk_events').select('action').eq('business_id', HK).eq('entity_type', 'sender').eq('actor_user_id', JACK).gte('created_at', START_ISO)).data || [];
    ok('11 ignore a real sender domain for Jack only, it lists under Ignored senders, un-ignore removes it; two sender events; 0 Gmail calls', ig.code === 200 && ig.body.ignored === true && rowIn.length === 1 && listed.body.domains.some(d => d.domain === igDomain) && un.code === 200 && rowOut.length === 0 && evs.map(e => e.action).sort().join() === 'sender_ignored,sender_unignored' && gmailCalls.length === callsBefore11);
  } else skip('11 ignore + un-ignore', 'no candidate domain on page 1');
  results.measured.total_gmail = gmailCalls.length;
  ok(`caps: Gmail ${gmailCalls.length} <= ${GMAIL_CAP} (all GET), Claude ${claudeCalls} <= ${CLAUDE_CAP}, Apollo 0; browser made 0 outside calls and ${fulfilled.length} inbox GETs were served from the payloads${REPLAY ? ' (replay: 0 real Gmail calls)' : ''}`, gmailCalls.length <= GMAIL_CAP && claudeCalls <= CLAUDE_CAP && !outside.length && gmailCalls.every(k => k.startsWith('GET')), gmailCalls.join(' | '));
  if (!REPLAY) fs.writeFileSync(REC, JSON.stringify(recording));
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', redact(e.message));
} finally {
  await cleanup();
  let restored = false, line;
  try {
    const after = await snapshot();
    restored = JSON.stringify(before) === JSON.stringify(after);
    line = restored ? `yes (HumanKind hk_* + workspace_mailboxes + google_grants + HomeLover counts identical; deleted exactly the created rows ${JSON.stringify(results.deleted)}; Jack sign-in rows kept by rule)` : `NO - before ${JSON.stringify(before)} after ${JSON.stringify(after)}`;
  } catch (e) { line = `NO (check failed: ${e.message})`; }
  const pass = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'hkos-inbox-v1-stage3.json'), JSON.stringify({ ...results, checks: results.checks.map(c => ({ ...c, detail: redact(c.detail || '') })), created, blocked, restored, replay: REPLAY }, null, 2));
  console.log(`\n${pass}/${results.checks.length} checks passed${results.errors.length ? ` · ${results.errors.length} errors` : ''} · Gmail ${REPLAY ? `0 real (${gmailCalls.length} replayed)` : gmailCalls.length} · Claude ${claudeCalls} · Apollo 0 · measured ${JSON.stringify(results.measured)}`);
  for (const e of results.errors) console.log('ERROR:', redact(e.split('\n').slice(0, 3).join(' | ')));
  console.log(`restored: ${line}`);
  process.exit(restored && pass === results.checks.length && !results.errors.length ? 0 : 1);
}
