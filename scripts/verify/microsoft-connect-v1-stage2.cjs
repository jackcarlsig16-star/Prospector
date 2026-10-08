// microsoft-connect-v1 Stage 2 check. Temp workspace (allowlisted for the spawned server only) + 3 temp users, their microsoft_grants / sales_mailbox_owners / microsoft_* rows, all deleted. FAKE Microsoft creds + throwaway MICROSOFT_TOKEN_KEY; Graph AND the token endpoint are a local fixture server (MICROSOFT_GRAPH_URL / MICROSOFT_AUTHORITY) - 0 calls to Microsoft, 0 Apollo, 0 AI, HomeLover untouched. Proves: auth gates (401 / 409 needs_microsoft / 409 unmapped / 403 viewer), dry run = counts only, real run = hand counts per folder with drafts / internal / personal skipped and no body anywhere, inbox cap 500 with the nextLink kept and the next run resuming + no duplicates, every Graph call GET with a body-free $select, the hourly piggyback guard, a reconnect to another mailbox restarting the backfill, log hygiene, and the 1440 screen for a member and a viewer. ~1 min, cap 4 min. Serves build/ via server.js - run npm run build first. Usage: node <this> <outdir>
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const crypto = require('crypto');
const http = require('http');
const { spawn } = require('child_process');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3966, FIX = 3967, tag = 'ms2-' + Date.now(), OUT = process.argv[2] || '/tmp';
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const FAKE = { MICROSOFT_CLIENT_ID: '00000000-0000-0000-0000-00000000c1d0', MICROSOFT_TENANT_ID: '00000000-0000-0000-0000-0000000071d0', MICROSOFT_CLIENT_SECRET: 'fake-secret-' + tag, MICROSOFT_TOKEN_KEY: crypto.randomBytes(32).toString('base64'),
  MICROSOFT_GRAPH_URL: `http://localhost:${FIX}/v1.0`, MICROSOFT_AUTHORITY: `http://localhost:${FIX}` };
Object.assign(process.env, FAKE);
const FAKE_RT = 'fake-refresh-token-' + tag, FAKE_AT = 'fake-access-token-' + tag;
const MAILBOX = `jack.${tag}@homelover.ai`, MAILBOX_IO = `jack.${tag}@homelover.io`, VIEWER_BOX = `viewer.${tag}@homelover.ai`, UNMAPPED = `nobody.${tag}@homelover.ai`;
const WATCH = ['businesses', 'business_members', 'profiles', 'auth_events', 'microsoft_grants', 'sales_mailbox_owners', 'microsoft_messages', 'microsoft_events', 'microsoft_sync_state', 'microsoft_sync_runs'];
const MS_TABLES = ['microsoft_sync_runs', 'microsoft_sync_state', 'microsoft_messages', 'microsoft_events'];
const made = { users: [], biz: null };
let srv, fix, browser, serverLog = '', pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const snap = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true })).count; return o; };
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('ABORT (4 min cap)'); cleanup().then(() => process.exit(2)); }, 240000);

// ── Graph fixture: metadata-only pages with Graph's real paging shape ────────
const SECRET_SUBJECT = 'Partnership intro ' + tag, SECRET_EMAIL = `amy.${tag}@acme.com`, BODY = 'BODY-NEVER-STORED-' + tag;
const a = address => ({ emailAddress: { address, name: address.split('@')[0] } });
const m = (id, from, to, over = {}) => ({ id, internetMessageId: `<${id}@fixture>`, conversationId: 'conv-' + id, subject: `Subject ${id}`, sentDateTime: `2026-10-0${1 + (id.length % 7)}T10:00:00Z`, receivedDateTime: `2026-10-0${1 + (id.length % 7)}T10:00:05Z`,
  from: a(from), toRecipients: to.map(a), ccRecipients: [], isDraft: false, body: { contentType: 'text', content: BODY }, bodyPreview: BODY, ...over });
const SENT = [
  m('s-draft', MAILBOX, [SECRET_EMAIL], { isDraft: true }),
  m('s-internal', MAILBOX, [VIEWER_BOX]),
  m('s-personal', MAILBOX, ['mom@gmail.com'], { ccRecipients: [a('dad@yahoo.co.uk')] }),
  m('s-mixed', MAILBOX, ['mom@gmail.com', 'bob@beta.io']),
  m('s-ext1', MAILBOX, [SECRET_EMAIL], { subject: SECRET_SUBJECT, ccRecipients: [a(VIEWER_BOX)] }),
  m('s-ext2', MAILBOX, ['carl@acme.com'], { subject: 'x'.repeat(600) }),
  m('s-ext3', MAILBOX, ['dee@delta.co']),
];
const INBOX = Array.from({ length: 520 }, (_, i) => m(`i-${i}`, `p${i}@acme.com`, [MAILBOX]));
const ev = (id, organizer, attendees, over = {}) => ({ id, iCalUId: 'ical-' + id, subject: `Meeting ${id}`, start: { dateTime: '2026-10-09T17:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-09T17:30:00.0000000', timeZone: 'UTC' },
  organizer: a(organizer), attendees: attendees.map(a), isCancelled: false, body: { content: BODY }, ...over });
const EVENTS = [ev('e-internal', MAILBOX, [VIEWER_BOX]), ev('e-personal', 'friend@hotmail.com', [MAILBOX]), ev('e-ext', SECRET_EMAIL, [MAILBOX, VIEWER_BOX]), ev('e-cancelled', MAILBOX, ['zed@zeta.org'], { isCancelled: true })];
const DATA = { '/v1.0/me/mailFolders/sentitems/messages/delta': SENT, '/v1.0/me/mailFolders/inbox/messages/delta': INBOX, '/v1.0/me/calendarView/delta': EVENTS };
const graphCalls = [];
function startFixture() {
  return new Promise(resolve => {
    fix = http.createServer((req, res) => {
      const u = new URL(req.url, `http://localhost:${FIX}`);
      if (req.method === 'POST' && u.pathname === '/token') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ access_token: FAKE_AT, expires_in: 3600, refresh_token: FAKE_RT + '-rotated' })); }
      graphCalls.push({ method: req.method, url: req.url, auth: req.headers.authorization, prefer: req.headers.prefer });
      const items = DATA[u.pathname];
      res.setHeader('Content-Type', 'application/json');
      if (!items || req.headers.authorization !== `Bearer ${FAKE_AT}`) { res.statusCode = items ? 401 : 404; return res.end(JSON.stringify({ error: { code: items ? 'InvalidAuthenticationToken' : 'ResourceNotFound' } })); }
      if (u.searchParams.has('$deltatoken')) return res.end(JSON.stringify({ value: [], '@odata.deltaLink': `${u.origin}${u.pathname}?$deltatoken=${Date.now()}` }));
      const skip = Number(u.searchParams.get('$skiptoken') || 0), size = 50;
      const body = { value: items.slice(skip, skip + size) };
      if (skip + size < items.length) body['@odata.nextLink'] = `${u.origin}${u.pathname}?$skiptoken=${skip + size}`;
      else body['@odata.deltaLink'] = `${u.origin}${u.pathname}?$deltatoken=${Date.now()}`;
      res.end(JSON.stringify(body));
    }).listen(FIX, resolve);
  });
}

async function cleanup() {
  if (browser) await browser.close().catch(() => {});
  if (srv) srv.kill();
  if (fix) fix.close();
  for (const u of made.users) { for (const t of [...MS_TABLES, 'microsoft_grants', 'sales_mailbox_owners']) await svc.from(t).delete().eq('user_id', u); }
  const b = made.biz;
  if (b) { for (const t of ['business_members', 'auth_events', 'sales_mailbox_owners']) await svc.from(t).delete().eq('business_id', b); }
  for (const u of made.users) { await svc.from('business_members').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('actor_id', u); }
  if (b) await svc.from('businesses').delete().eq('id', b);
  for (const u of made.users) await svc.auth.admin.deleteUser(u);
}
async function user(biz, name, role) {
  const email = `${tag}-${name.toLowerCase()}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
  const { data: u } = await svc.auth.admin.createUser({ email, password, email_confirm: true }); made.users.push(u.user.id);
  await svc.from('profiles').update({ display_name: `${name} Test`, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
  ins(await svc.from('business_members').insert({ business_id: biz, email, name: `${name} Test`, user_id: u.user.id, role }).select());
  const c = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: s } = await c.auth.signInWithPassword({ email, password });
  return { id: u.user.id, email, session: s.session, cookie: `prospector_at=${encodeURIComponent(s.session.access_token)}` };
}
async function newPage(u, width, height) {
  const errs = [];
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage(); page.setDefaultTimeout(12000);
  page.on('console', x => { if (x.type() === 'error') errs.push(x.text().slice(0, 160)); }); page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
  await page.addInitScript(([k, v]) => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(u.session)]);
  await page.goto(`http://localhost:${PORT}/?microsoft_connected=1`); await page.waitForTimeout(3500);
  return { page, errs };
}

(async () => {
  const before = await snap();
  try {
    await startFixture();
    made.biz = ins(await svc.from('businesses').insert({ name: `ZZ MS2 ${tag.slice(-5)}`, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}-owner@example.com`, access_code: tag }).select().single()).id;
    const jack = await user(made.biz, 'Jack', 'member'), viewer = await user(made.biz, 'Viewer', 'viewer'), other = await user(made.biz, 'Other', 'member');
    ins(await svc.from('sales_mailbox_owners').insert([{ business_id: made.biz, mailbox_email: MAILBOX, user_id: jack.id }, { business_id: made.biz, mailbox_email: MAILBOX_IO, user_id: jack.id }, { business_id: made.biz, mailbox_email: VIEWER_BOX, user_id: viewer.id }]).select());
    const { saveGrant } = await import(ROOT + '/api/lib/microsoftGrants.js');
    const { runOutlookSync } = await import(ROOT + '/api/microsoft/graphSync.js');
    const grant = (u, accountEmail) => saveGrant(u.id, { accountEmail, tenantId: FAKE.MICROSOFT_TENANT_ID, scopes: ['openid', 'offline_access', 'User.Read', 'Mail.Read', 'Calendars.Read'], refreshToken: FAKE_RT });
    await grant(jack, MAILBOX); await grant(viewer, VIEWER_BOX);

    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, ...FAKE, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: [process.env.SALES_ANALYTICS_BUSINESS_IDS, made.biz].filter(Boolean).join(',') }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => { serverLog += d; }); srv.stderr.on('data', d => { serverLog += d; });
    for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await wait(500); } }
    const get = (u, path) => fetch(`http://localhost:${PORT}${path}`, { headers: u ? { Cookie: u.cookie } : {} });
    const post = (u, path) => fetch(`http://localhost:${PORT}${path}`, { method: 'POST', headers: { Cookie: u.cookie } });
    const count = async (t, u, extra = q => q) => (await extra(svc.from(t).select('*', { count: 'exact', head: true }).eq('user_id', u.id))).count;
    const byFolder = r => Object.fromEntries(r.folders.map(f => [f.folder, f]));

    // A: gates
    ok('A1 signed out -> 401', (await get(null, '/api/microsoft/sync-summary')).status === 401);
    let r = await post(other, '/api/microsoft/sync');
    ok('A2 member without a grant -> 409 needs_microsoft', r.status === 409 && (await r.json()).needs_microsoft === true);
    await grant(other, UNMAPPED);
    r = await post(other, '/api/microsoft/sync'); let b = await r.json();
    ok('A3 grant for a mailbox nobody mapped -> 409 mailbox_not_mapped, names the address', r.status === 409 && b.refused === 'mailbox_not_mapped' && b.error.includes(UNMAPPED), JSON.stringify(b));
    r = await post(viewer, '/api/microsoft/sync');
    ok('A4 viewer with a mapped grant -> 403', r.status === 403 && (await count('microsoft_sync_runs', viewer)) === 0);
    r = await get(viewer, '/api/microsoft/sync-summary'); b = await r.json();
    ok('A5 viewer summary -> 200 counts with can_sync false (GET = viewer, like every sales route)', r.status === 200 && b.can_sync === false && b.sent === 0 && b.mailbox === VIEWER_BOX, JSON.stringify(b).slice(0, 160));

    // B: dry run
    r = await post(jack, '/api/microsoft/sync?dry_run=1'); b = await r.json();
    let f = byFolder(b);
    ok('B1 dry run 200, dry_run true, 3 folders', r.status === 200 && b.dry_run === true && b.folders.length === 3 && b.mailbox === MAILBOX, JSON.stringify(b).slice(0, 200));
    ok('B2 dry sent: 7 seen, 0 stored, 1 draft / 1 internal / 1 personal skipped (4 would be kept)', f.sentitems.seen === 7 && f.sentitems.stored === 0 && f.sentitems.skipped_draft === 1 && f.sentitems.skipped_internal === 1 && f.sentitems.skipped_personal === 1, JSON.stringify(f.sentitems));
    ok('B3 dry inbox: capped at 500 of 520, 10 pages', f.inbox.seen === 500 && f.inbox.capped === true && f.inbox.pages === 10 && f.inbox.stored === 0, JSON.stringify(f.inbox));
    ok('B4 dry calendar: 4 seen, 1 internal / 1 personal skipped', f.calendar.seen === 4 && f.calendar.skipped_internal === 1 && f.calendar.skipped_personal === 1 && f.calendar.stored === 0, JSON.stringify(f.calendar));
    const dryRuns = (await svc.from('microsoft_sync_runs').select('folder, trigger, dry_run, finished_at').eq('user_id', jack.id)).data;
    ok('B5 dry run stored nothing but 3 finished run rows (trigger dry_run)', (await count('microsoft_messages', jack)) === 0 && (await count('microsoft_events', jack)) === 0 && (await count('microsoft_sync_state', jack)) === 0 && dryRuns.length === 3 && dryRuns.every(x => x.dry_run && x.trigger === 'dry_run' && x.finished_at));

    // C: real run
    graphCalls.length = 0;
    r = await post(jack, '/api/microsoft/sync'); b = await r.json(); f = byFolder(b);
    ok('C1 real run: sent 4 stored, inbox 500 stored + capped, calendar 2 stored', r.status === 200 && f.sentitems.stored === 4 && f.inbox.stored === 500 && f.inbox.capped && f.calendar.stored === 2, JSON.stringify(b.folders));
    const sent = (await svc.from('microsoft_messages').select('*').eq('user_id', jack.id).eq('direction', 'sent').order('graph_id')).data;
    const ext1 = sent.find(x => x.graph_id === 's-ext1'), ext2 = sent.find(x => x.graph_id === 's-ext2'), mixed = sent.find(x => x.graph_id === 's-mixed');
    ok('C2 sent rows: external side only (own cc dropped), domains deduped, mixed keeps gmail + beta.io', ext1 && ext1.external_emails.length === 1 && ext1.external_emails[0] === SECRET_EMAIL && ext1.external_domains[0] === 'acme.com' && mixed && mixed.external_domains.join() === 'gmail.com,beta.io', JSON.stringify(sent.map(x => [x.graph_id, x.external_emails, x.external_domains])));
    ok('C3 no row anywhere holds a body; subject capped at 500; mailbox + ids + times set', !JSON.stringify(sent).includes(BODY) && ext2.subject.length === 500 && ext1.mailbox_email === MAILBOX && ext1.internet_message_id === '<s-ext1@fixture>' && ext1.conversation_id === 'conv-s-ext1' && ext1.occurred_at.startsWith('2026-10-0'));
    const events = (await svc.from('microsoft_events').select('*').eq('user_id', jack.id).order('graph_id')).data;
    ok('C4 events: the external + the cancelled one, UTC times, organizer kept, no body', events.length === 2 && events.map(x => x.graph_id).join() === 'e-cancelled,e-ext' && events[0].is_cancelled === true && events[1].organizer_email === SECRET_EMAIL && events[1].start_at === '2026-10-09T17:00:00+00:00' && !JSON.stringify(events).includes(BODY), JSON.stringify(events.map(x => [x.graph_id, x.start_at, x.external_domains])));
    const inbox = (await svc.from('microsoft_messages').select('graph_id, direction, external_emails', { count: 'exact' }).eq('user_id', jack.id).eq('direction', 'received'));
    ok('C5 inbox: 500 received rows, each from its sender only', inbox.count === 500 && inbox.data.slice(0, 50).every(x => x.external_emails.length === 1 && /^p\d+@acme\.com$/.test(x.external_emails[0])));
    const state = (await svc.from('microsoft_sync_state').select('*').eq('user_id', jack.id)).data;
    const st = Object.fromEntries(state.map(s => [s.folder, s]));
    ok('C6 state: inbox keeps the nextLink (skiptoken=500), sent + calendar hold a deltaLink, account recorded', state.length === 3 && /skiptoken=500/.test(st.inbox.delta_link) && /deltatoken/.test(st.sentitems.delta_link) && /deltatoken/.test(st.calendar.delta_link) && state.every(s => s.account_email === MAILBOX && s.last_synced_at), JSON.stringify(state.map(s => [s.folder, s.delta_link.slice(-30)])));
    const sel = graphCalls.map(c => new URL(c.url, 'http://x').searchParams.get('$select') || '');
    ok(`C7 every Graph call GET + bearer, mail $select has no body/bodyPreview, Prefer timezone UTC (${graphCalls.length} calls)`, graphCalls.length === 1 + 10 + 1 && graphCalls.every(c => c.method === 'GET' && c.auth === `Bearer ${FAKE_AT}` && /outlook\.timezone="UTC"/.test(c.prefer || '')) && sel.every(s => !/body/i.test(s)) && sel.filter(Boolean).every(s => s.includes('internetMessageId')));
    r = await get(jack, '/api/microsoft/sync-summary'); const sum = await r.json();
    ok('C8 summary = DB: sent 4 · received 500 · events 2, since = earliest, pending inbox, last_run per folder', sum.sent === 4 && sum.received === 500 && sum.events === 2 && sum.since && sum.pending.join() === 'inbox' && sum.last_run.inbox.capped === true && sum.last_run.sentitems.stored === 4 && sum.last_synced_at, JSON.stringify(sum).slice(0, 300));

    // D: resume + dedupe
    graphCalls.length = 0;
    r = await post(jack, '/api/microsoft/sync'); b = await r.json(); f = byFolder(b);
    ok('D1 next run: inbox resumes from the kept link (20 more, not capped), sent + calendar read their delta (0 new)', f.inbox.seen === 20 && f.inbox.stored === 20 && !f.inbox.capped && f.sentitems.seen === 0 && f.calendar.seen === 0 && graphCalls.some(c => /skiptoken=500/.test(c.url)) && graphCalls.every(c => !/receivedDateTime/.test(c.url)), JSON.stringify(b.folders));
    ok('D2 520 inbox rows, no duplicates; inbox state now a deltaLink; summary pending empty', (await count('microsoft_messages', jack, q => q.eq('direction', 'received'))) === 520 && /deltatoken/.test((await svc.from('microsoft_sync_state').select('delta_link').eq('user_id', jack.id).eq('folder', 'inbox').single()).data.delta_link) && (await (await get(jack, '/api/microsoft/sync-summary')).json()).pending.length === 0);

    // E: piggyback guard (in-process, same fixture) + reconnect restart
    let pb = await runOutlookSync({ userId: jack.id, businessId: made.biz, trigger: 'piggyback' });
    ok('E1 piggyback within the hour -> refused too_soon, no run rows added', pb.refused === 'too_soon' && (await count('microsoft_sync_runs', jack)) === 9);
    await svc.from('microsoft_sync_runs').update({ started_at: new Date(Date.now() - 2 * 3600e3).toISOString() }).eq('user_id', jack.id);
    pb = await runOutlookSync({ userId: jack.id, businessId: made.biz, trigger: 'piggyback' });
    ok('E2 piggyback 2h after the last run -> runs all 3 folders as trigger piggyback', !pb.refused && pb.folders.length === 3 && (await svc.from('microsoft_sync_runs').select('trigger').eq('user_id', jack.id).eq('trigger', 'piggyback')).data.length === 3, JSON.stringify(pb).slice(0, 200));
    pb = await runOutlookSync({ userId: other.id, businessId: made.biz, trigger: 'piggyback' });
    ok('E3 piggyback for an unmapped mailbox -> silent refusal, no run row', pb.refused === 'mailbox_not_mapped' && (await count('microsoft_sync_runs', other)) === 0);
    graphCalls.length = 0;
    await grant(jack, MAILBOX_IO);
    r = await post(jack, '/api/microsoft/sync'); b = await r.json(); f = byFolder(b);
    ok('E4 reconnect as the .io mailbox -> backfill restarts (90-day filter on mail, full read), rows carry the new mailbox', graphCalls.filter(c => /receivedDateTime%20ge/.test(c.url)).length === 2 && f.sentitems.seen === 7 && f.inbox.seen === 500 && (await svc.from('microsoft_messages').select('mailbox_email').eq('user_id', jack.id).eq('graph_id', 's-ext1').single()).data.mailbox_email === MAILBOX_IO, JSON.stringify(b.folders));

    // F: log hygiene
    ok('F1 server log: counts only - no subject, no external address, no body, no token', !serverLog.includes(SECRET_SUBJECT) && !serverLog.includes(SECRET_EMAIL) && !serverLog.includes(BODY) && !serverLog.includes(FAKE_AT) && !serverLog.includes(FAKE_RT) && /\[microsoft\/sync\] user=.* folder=inbox trigger=manual pages=10 seen=500 stored=500 .* capped=yes/.test(serverLog), serverLog.split('\n').filter(l => l.includes('[microsoft/sync]')).slice(0, 2).join(' | '));

    // G: screen
    browser = await chromium.launch();
    const J = await newPage(jack, 1440, 1000);
    const block = J.page.getByTestId('outlook-sync');
    const line = await block.textContent().catch(() => '');
    // The fixture serves the same Graph ids for both mailboxes, so the .io run
    // overwrote the .ai rows (upsert on user_id + graph_id): still 4 / 520 / 2.
    ok('G1 member 1440: Outlook sync block shows Sent 4 · Received 520 · Events 2 since Oct 1 with Preview + Sync buttons, 0 console errors', /Sent 4 · Received 520 · Events 2 since Oct 1/.test(line) && await block.getByRole('button', { name: /Sync Outlook/ }).isVisible() && await block.getByRole('button', { name: /Preview sync/ }).isVisible() && J.errs.length === 0, `${line.slice(0, 160)} errs=${J.errs.join(' | ')}`);
    await J.page.screenshot({ path: `${OUT}/ms2-member-1440.png`, fullPage: true });
    const V = await newPage(viewer, 1440, 1000);
    const vline = await V.page.getByTestId('outlook-sync').textContent().catch(() => '');
    ok('G2 viewer 1440: sees Sent 0 · Received 0 · Events 0, no Sync / Preview buttons, 0 console errors', /Sent 0 · Received 0 · Events 0/.test(vline) && !/Sync Outlook|Preview sync|member access/.test(vline) && V.errs.length === 0, `${vline.slice(0, 160)} errs=${V.errs.join(' | ')}`);
    await V.page.screenshot({ path: `${OUT}/ms2-viewer-1440.png`, fullPage: true });
  } catch (e) { ok('run', false, e.stack.split('\n').slice(0, 3).join(' ')); }
  await cleanup();
  const after = await snap();
  const moved = WATCH.filter(t => before[t] !== after[t]);
  console.log(`\n${pass}/${total} passed`);
  console.log(moved.length ? `restored: CHECK - counts moved on ${moved.map(t => `${t} ${before[t]}->${after[t]}`).join(', ')}` : 'restored: yes');
  process.exit(pass === total ? 0 : 1);
})();
