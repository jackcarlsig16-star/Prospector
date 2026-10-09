// microsoft-connect-v1 Stage 4a check. A = temp workspace (allowlisted for the spawned server only) + 1 temp user with a mailbox-owner row, a FAKE Microsoft grant (throwaway key) and a local Graph fixture that returns empty delta pages (MICROSOFT_GRAPH_URL / MICROSOFT_AUTHORITY) so POST /api/microsoft/sync runs end to end - 0 calls to Microsoft, 0 Apollo, 0 AI. Fixture prospects (with / without an address), Apollo reply rows and synced inbox rows, all deleted. B = HomeLover READ-ONLY: in-process dry run vs a hand count from its raw rows, nothing written. Proves: feature off -> the sync skips the step and writes nothing; dry run counts; on -> the earliest inbox mail from the prospect after each delivery sets replied_at + replied_message_id once (auto-replies, mail before delivery, sent mail, prospects without an address never match; a preset row is untouched; replied_seen_at never moves); a second run writes nothing; the six readers (live rows, feed, week strip, week engagement, heat band via live, Apollo moves) use the exact time and drop the "seen at sync" label only where it is exact; the log carries no address or subject. ~40s, cap 4 min.
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const crypto = require('crypto');
const http = require('http');
const { spawn } = require('child_process');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3976, FIX = 3977, tag = 'ms4a-' + Date.now();
const HL = 'bc69beab-effd-452d-9e81-fd652333bb95';
const FAKE = { MICROSOFT_CLIENT_ID: '00000000-0000-0000-0000-00000000c1d0', MICROSOFT_TENANT_ID: '00000000-0000-0000-0000-0000000071d0', MICROSOFT_CLIENT_SECRET: 'fake-secret-' + tag, MICROSOFT_TOKEN_KEY: crypto.randomBytes(32).toString('base64'),
  MICROSOFT_GRAPH_URL: `http://localhost:${FIX}/v1.0`, MICROSOFT_AUTHORITY: `http://localhost:${FIX}` };
Object.assign(process.env, FAKE);
const FAKE_RT = 'fake-refresh-token-' + tag, FAKE_AT = 'fake-access-token-' + tag;
const MAILBOX = `jack.${tag}@homelover.ai`;
const AMY = `amy.${tag}@acme.test`, BOB = `bob.${tag}@beta.test`, SUBJECT = 'Re: secret subject ' + tag;
const WATCH = ['businesses', 'business_members', 'profiles', 'auth_events', 'microsoft_grants', 'sales_mailbox_owners', 'microsoft_messages', 'microsoft_sync_state', 'microsoft_sync_runs', 'sales_prospect_state', 'sales_email_messages', 'sales_goals', 'partner_contacts', 'sales_partner_events'];
const made = { users: [], biz: null };
let srv, fix, serverLog = '', pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const snap = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true })).count; return o; };
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('ABORT (4 min cap)'); cleanup().then(() => process.exit(2)); }, 240000);
// n days ago at h:mi UTC (so every fixture sits inside the readers' 7 / 30-day windows).
const at = (n, h, mi = 0) => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - n, h, mi)).toISOString(); };
const laDay = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const addDays = (v, n) => new Date(Date.parse(`${v}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const same = (a, b) => !!a && !!b && Date.parse(a) === Date.parse(b);
const mondayOf = day => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));

function startFixture() {
  return new Promise(resolve => {
    fix = http.createServer((req, res) => {
      const u = new URL(req.url, `http://localhost:${FIX}`);
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && u.pathname === '/token') return res.end(JSON.stringify({ access_token: FAKE_AT, expires_in: 3600, refresh_token: FAKE_RT }));
      if (req.headers.authorization !== `Bearer ${FAKE_AT}`) { res.statusCode = 401; return res.end(JSON.stringify({ error: { code: 'InvalidAuthenticationToken' } })); }
      res.end(JSON.stringify({ value: [], '@odata.deltaLink': `${u.origin}${u.pathname}?$deltatoken=${Date.now()}` }));
    }).listen(FIX, resolve);
  });
}
async function cleanup() {
  if (srv) srv.kill();
  if (fix) fix.close();
  const b = made.biz;
  for (const u of made.users) { for (const t of ['microsoft_sync_runs', 'microsoft_sync_state', 'microsoft_messages', 'microsoft_grants', 'sales_mailbox_owners']) await svc.from(t).delete().eq('user_id', u); }
  if (b) { for (const t of ['sales_partner_events', 'partner_contacts', 'sales_goals', 'sales_email_messages', 'sales_prospect_state', 'microsoft_messages', 'microsoft_sync_runs', 'sales_mailbox_owners', 'business_members', 'auth_events']) await svc.from(t).delete().eq('business_id', b); }
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
  return { id: u.user.id, email, cookie: `prospector_at=${encodeURIComponent(s.session.access_token)}` };
}

(async () => {
  const before = await snap();
  try {
    await startFixture();
    made.biz = ins(await svc.from('businesses').insert({ name: `ZZ MS4A ${tag.slice(-5)}`, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
    const B = made.biz;
    const jack = await user(B, 'Jack', 'member');
    ins(await svc.from('sales_mailbox_owners').insert({ business_id: B, mailbox_email: MAILBOX, user_id: jack.id }).select());
    const { saveGrant } = await import(ROOT + '/api/lib/microsoftGrants.js');
    await saveGrant(jack.id, { accountEmail: MAILBOX, tenantId: FAKE.MICROSOFT_TENANT_ID, scopes: ['openid', 'offline_access', 'User.Read', 'Mail.Read', 'Calendars.Read'], refreshToken: FAKE_RT });
    const cid = n => `${tag}-${n}`;
    ins(await svc.from('sales_prospect_state').insert([
      { business_id: B, contact_id: cid('amy'), name: 'Amy Acme', company: 'Acme', email: AMY },
      { business_id: B, contact_id: cid('bob'), name: 'Bob Beta', company: 'Beta', email: BOB },
      { business_id: B, contact_id: cid('carl'), name: 'Carl Gamma', company: 'Gamma', email: null },
    ]).select());
    const SEEN = at(1, 20);
    const m = (id, c, delivered_at, over = {}) => ({ business_id: B, apollo_message_id: `${tag}-${id}`, contact_id: cid(c), sender: MAILBOX, step: 1, delivered_at, replied: true, reply_class: 'willing_to_meet', replied_seen_at: SEEN, ...over });
    ins(await svc.from('sales_email_messages').insert([
      m('m1', 'amy', at(9, 10)),
      m('m2', 'amy', at(5, 10)),
      m('m3', 'bob', at(6, 10), { replied_at: at(6, 12), replied_message_id: '<pre>' }),
      m('m4', 'carl', at(6, 10)),
      m('m5', 'dan', at(6, 10)),
      m('m6', 'amy', at(20, 10), { replied: false, reply_class: null, replied_seen_at: null }),
    ]).select());
    let n = 0;
    const mail = (from, occurred_at, over = {}) => ({ business_id: B, user_id: jack.id, graph_id: `${tag}-g${++n}`, internet_message_id: `<${tag}-i${n}>`, conversation_id: 'c', direction: 'received', mailbox_email: MAILBOX, external_emails: [from], external_names: [''], external_domains: [from.split('@')[1]], subject: SUBJECT, occurred_at, ...over });
    const M = {
      a0: mail(AMY, at(10, 9)), a1: mail(AMY, at(9, 11, 30)), a2: mail(AMY, at(7, 9)), a3: mail(AMY, at(4, 9)),
      bAuto: mail(BOB, at(6, 11), { subject: 'Automatic reply: ' + SUBJECT }), bReal: mail(BOB, at(6, 13)),
      // Its own thread: otherwise Stage 3 reads every reply as in-thread and moves Acme to Replied itself.
      aSent: mail(AMY, at(8, 9), { direction: 'sent', conversation_id: 'c-sent' }),
    };
    ins(await svc.from('microsoft_messages').insert(Object.values(M)).select());
    const acme = ins(await svc.from('sales_goals').insert({ business_id: B, goal_type: 'partnership', name: 'Acme Test', pipeline_status: 'researching', category: '3. PEOs', tier: '1', owner_user_id: jack.id }).select().single());
    ins(await svc.from('partner_contacts').insert({ business_id: B, goal_id: acme.id, name: 'Amy Acme', email: AMY, source: 'apollo', apollo_contact_id: cid('amy'), sequence_added_at: at(9, 9) }).select());

    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, ...FAKE, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: [process.env.SALES_ANALYTICS_BUSINESS_IDS, B].filter(Boolean).join(',') }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => { serverLog += d; }); srv.stderr.on('data', d => { serverLog += d; });
    for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await wait(500); } }
    const call = async (path, method = 'GET') => { const r = await fetch(`http://localhost:${PORT}${path}`, { method, headers: { Cookie: jack.cookie } }); return { status: r.status, data: await r.json().catch(() => ({})) }; };
    const rows = async () => Object.fromEntries((await svc.from('sales_email_messages').select('apollo_message_id, replied_seen_at, replied_at, replied_message_id').eq('business_id', B)).data.map(r => [r.apollo_message_id.slice(tag.length + 1), r]));

    let r = await call('/api/microsoft/sync', 'POST');
    let db = await rows();
    ok('A1 feature off: the sync runs (3 folders, 0 kept) and skips the step - reply_times null, replied_at untouched (only the preset row)', r.status === 200 && r.data.reply_times === null && r.data.folders.length === 3 && db.m1.replied_at === null && db.m3.replied_message_id === '<pre>', `${r.status} ${JSON.stringify(r.data.reply_times)}`);
    const { runOutlookReplyTimes } = await import(ROOT + '/api/sales/outlookReplyTimes.js');
    const dry = await runOutlookReplyTimes(svc, B, { dryRun: true });
    db = await rows();
    ok('A2 dry run: 4 candidates (m1 m2 m4 m5), 1 already (m3), 2 without an address (carl, dan), 2 matched, 0 written', dry.candidates === 4 && dry.already === 1 && dry.no_email === 2 && dry.no_mail === 0 && dry.matched === 2 && dry.written === 0 && db.m1.replied_at === null, JSON.stringify(dry));

    ins(await svc.from('businesses').update({ features: { goals_sales: true, outlook_reply_times: true } }).eq('id', B).select());
    r = await call('/api/microsoft/sync', 'POST');
    db = await rows();
    ok('A3 feature on: the sync sets m1 from the earliest inbox mail after its delivery (not the one before, not the sent one) and m2 from the next unused mail; ids kept', r.status === 200 && r.data.reply_times?.written === 2 && same(db.m1.replied_at, M.a1.occurred_at) && db.m1.replied_message_id === M.a1.internet_message_id && same(db.m2.replied_at, M.a3.occurred_at) && db.m2.replied_message_id === M.a3.internet_message_id, `${JSON.stringify(r.data.reply_times)} m1=${db.m1.replied_at} m2=${db.m2.replied_at}`);
    ok('A4 untouched: preset m3 keeps its time and id (auto-reply + the real mail ignored), m4 / m5 stay null, every replied_seen_at unchanged', same(db.m3.replied_at, at(6, 12)) && db.m3.replied_message_id === '<pre>' && db.m4.replied_at === null && db.m5.replied_at === null && ['m1', 'm2', 'm3', 'm4', 'm5'].every(k => same(db[k].replied_seen_at, SEEN)) && db.m6.replied_seen_at === null, JSON.stringify(db.m3));
    r = await call('/api/microsoft/sync', 'POST');
    ok('A5 second sync: 3 already, 0 matched, 0 written', r.data.reply_times?.already === 3 && r.data.reply_times?.matched === 0 && r.data.reply_times?.written === 0, JSON.stringify(r.data.reply_times));

    const live = (await call(`/api/sales/${B}/huddle/live?limit=100`)).data;
    const liveRows = live.rows || live.items || [];
    const amy = liveRows.find(x => x.contact_id === cid('amy')), carl = liveRows.find(x => x.contact_id === cid('carl'));
    ok('A6 live rows: Amy carries the exact time (latest reply), "replied" insight, timeline replies without the sync label; Carl keeps "seen … at sync"', amy && amy.reply_exact === true && same(amy.reply_seen_at, M.a3.occurred_at) && / — replied /.test(amy.insight) && amy.timeline.filter(t => t.kind === 'reply').every(t => t.seen_at_sync === false) && carl && carl.reply_exact === false && / at sync/.test(carl.insight), `${amy && amy.insight} | ${carl && carl.insight}`);
    const feed = (await call(`/api/sales/${B}/huddle/feed?days=30&limit=100`)).data.items.filter(i => i.kind === 'reply');
    const byKey = Object.fromEntries(feed.map(i => [i.key.replace(`r:${tag}-`, ''), i]));
    ok('A7 feed: m1 / m2 / m3 at the exact time without the label, m4 / m5 at the sync time with it', same(byKey.m1?.at, M.a1.occurred_at) && byKey.m1.seen_at_sync === false && same(byKey.m2?.at, M.a3.occurred_at) && same(byKey.m3?.at, at(6, 12)) && byKey.m3.seen_at_sync === false && same(byKey.m4?.at, SEEN) && byKey.m4.seen_at_sync === true && byKey.m5?.seen_at_sync === true, JSON.stringify(Object.values(byKey).map(i => [i.key.slice(-2), i.at, i.seen_at_sync])));
    const strip = (await call(`/api/sales/${B}/week-strip?from=${laDay(at(12, 0))}`)).data.days;
    const dayCount = d => (strip.find(x => x.day === d) || {}).tracked_replies || 0;
    ok('A8 week strip: replies land on the exact LA day (m1 on a1\'s day, m2 on a3\'s day, m3 on its preset day) and the sync day only for m4 + m5', dayCount(laDay(M.a1.occurred_at)) >= 1 && dayCount(laDay(M.a3.occurred_at)) >= 1 && dayCount(laDay(at(6, 12))) >= 1 && dayCount(laDay(SEEN)) === 2, JSON.stringify(strip.map(d => [d.day, d.tracked_replies])));
    const { weekEngagement } = await import(ROOT + '/api/sales/huddleWeek.js');
    const { laStartOfDayMs } = await import(ROOT + '/api/sales/goalsShared.js');
    const wk = mondayOf(laDay(M.a3.occurred_at));
    const s0 = laStartOfDayMs(wk), s1 = laStartOfDayMs(addDays(wk, 7));
    const hand = Object.values(db).filter(x => x.replied_at || x.replied_seen_at).map(x => Date.parse(x.replied_at || x.replied_seen_at)).filter(t => t >= s0 && t < s1).length;
    const eng = await weekEngagement(svc, B, wk);
    ok(`A9 week engagement ${wk}: replies ${eng.replies} = hand count by exact-else-seen time ${hand}`, eng.replies === hand && hand >= 1);
    const moves = (await call(`/api/sales/${B}/goals/partners/apollo-touches`)).data;
    const acmeMove = (moves.proposed || []).find(x => x.partner === 'Acme Test');
    ok('A10 Apollo moves: Acme -> Replied dated on the exact reply day of the first reply, labeled "replied"', acmeMove && acmeMove.to === 'replied' && acmeMove.date === laDay(M.a1.occurred_at) && acmeMove.date_label === 'replied' && /\(replied /.test(acmeMove.reason), JSON.stringify(acmeMove || { counts: moves.counts, skipped: moves.skipped, held: moves.held, error: moves.error }).slice(0, 400));
    ok('A11 server log: no address, no subject, no token', !serverLog.includes(AMY) && !serverLog.includes(BOB) && !serverLog.includes(SUBJECT) && !serverLog.includes(FAKE_AT) && /\[outlook\/reply-times\] business=/.test(serverLog));

    // B: HomeLover READ-ONLY - dry run vs hand count
    const hl = await runOutlookReplyTimes(svc, HL, { dryRun: true });
    const { data: hlMsgs } = await svc.from('sales_email_messages').select('contact_id, replied_at').eq('business_id', HL).eq('replied', true);
    const ids = [...new Set(hlMsgs.map(x => x.contact_id))];
    let withEmail = 0; for (let i = 0; i < ids.length; i += 150) { const { count } = await svc.from('sales_prospect_state').select('*', { count: 'exact', head: true }).eq('business_id', HL).in('contact_id', ids.slice(i, i + 150)).not('email', 'is', null); withEmail += count; }
    const hAlready = hlMsgs.filter(x => x.replied_at).length;
    ok(`B1 HomeLover: ${hlMsgs.length} replied messages = ${hl.candidates + hl.already}; already ${hl.already} = hand ${hAlready}; prospects with an address ${withEmail} (NULL until the next Apollo sync) -> no_email ${hl.no_email} = hand ${withEmail === 0 ? hlMsgs.length - hAlready : '?'}; matched ${hl.matched}, written ${hl.written} (dry)`,
      hl.candidates + hl.already === hlMsgs.length && hl.already === hAlready && (withEmail !== 0 || hl.no_email === hlMsgs.length - hAlready) && hl.written === 0);
    const hlb = (await svc.from('businesses').select('features').eq('id', HL).maybeSingle()).data;
    ok(`B2 HomeLover: outlook_reply_times is ${hlb?.features?.outlook_reply_times === true ? 'ON - the step runs on Jack\'s next Sync Outlook once the Apollo sync has filled addresses' : 'off (Admin > Workspace features)'}`, !!hlb, JSON.stringify(hlb && hlb.features));
  } catch (e) { ok('run', false, e.stack.split('\n').slice(0, 3).join(' ')); }
  await cleanup();
  const after = await snap();
  const moved = WATCH.filter(t => before[t] !== after[t]);
  console.log(`\n${pass}/${total} passed`);
  console.log(moved.length ? `restored: CHECK - counts moved on ${moved.map(t => `${t} ${before[t]}->${after[t]}`).join(', ')}` : 'restored: yes');
  process.exit(pass === total ? 0 : 1);
})();
