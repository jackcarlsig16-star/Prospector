// node --test api/hk/inboxRoutes.test.mjs
// hkos-inbox-v1 Stage 1 - the inbox routes against the in-memory Supabase and a fake Gmail with one mailbox per token.
// Invented people and brands on .invalid / .example; the rules under test: the caller's own token only, nothing written
// on list / open, no "@" outside a message's own body, link / track write the sync shapes, ignore is per user.
// 0 network, 0 Claude, 0 Gmail, 0 DB.
import test from 'node:test';
import assert from 'node:assert/strict';
process.env.GOOGLE_TOKEN_KEY ||= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const { seed, reqOf, resOf, HK, JACK, PETE, ID, NOW } = await import('./testing.mjs');
const { GmailError } = await import('./gmailClient.js');
const { stripBodies } = await import('./inboxRules.js');
const R = await import('./inboxRoutes.js');

const OWNER = { [JACK]: 'jack.work@humankind.invalid', [PETE]: 'pete.work@humankind.invalid' };
const TOKEN = { [JACK]: 'tok-jack', [PETE]: 'tok-pete' };
const NOMAIL = 'u-nomail', VIEWER = 'u-viewer';
const b64 = s => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const msg = (id, threadId, { from, to, subject = 'Re: HumanKind', date = 'Mon, 26 Oct 2026 10:00:00 -0500', labels = ['INBOX'], snippet = 'Thanks, sounds fun', text = 'Thanks, sounds fun', html = null, extra = [] }) => ({
  id, threadId, labelIds: labels, snippet, internalDate: '1761490800000',
  payload: { mimeType: html ? 'multipart/alternative' : 'text/plain', headers: [{ name: 'From', value: from }, { name: 'To', value: to || `HumanKind <${OWNER[JACK]}>` }, { name: 'Subject', value: subject }, { name: 'Date', value: date }, { name: 'Message-ID', value: `<${id}@mail.invalid>` }, ...extra],
    ...(html ? { parts: [{ mimeType: 'text/plain', body: { data: b64(text) } }, { mimeType: 'text/html', body: { data: b64(html) } }] } : { body: { data: b64(text) } }) },
});
const thread = (id, messages) => ({ id, historyId: '1', messages, labels: [...new Set(messages.flatMap(m => m.labelIds))] });
const JACK_MAIL = () => [
  thread('th-tracked', [msg('m-t1', 'th-tracked', { from: `HumanKind <${OWNER[JACK]}>`, to: 'Ana <ana@harboryoga.example>', subject: 'HumanKind x Harbor Yoga - a mat-time challenge', labels: ['SENT'], date: 'Sat, 24 Oct 2026 10:00:00 -0500' }), msg('m-t2', 'th-tracked', { from: 'Ana <ana@harboryoga.example>', subject: 'Re: HumanKind x Harbor Yoga - a mat-time challenge', labels: ['INBOX'] })]),
  thread('th-match', [msg('m-m1', 'th-match', { from: '"Sam Lee, Co-founder" <sam@bluefinrun.example>', subject: 'Run club x HumanKind?', labels: ['INBOX', 'UNREAD'], snippet: 'Saw the app, would love to chat', text: 'Saw the app. Reach me at sam@bluefinrun.example', html: '<p>Saw the app. Reach me at sam@bluefinrun.example</p><img src="https://t.invalid/p.gif"><script>steal()</script>' })]),
  thread('th-team', [msg('m-p1', 'th-team', { from: 'Pete <pete@humankindcollective.app>', subject: 'Standup notes', labels: ['INBOX'] })]),
  thread('th-bulk', [msg('m-b1', 'th-bulk', { from: 'Shop <noreply@shop.invalid>', subject: 'Your order shipped', labels: ['INBOX'] })]),
  thread('th-ign', [msg('m-i1', 'th-ign', { from: 'Daily News <hello@news.invalid>', subject: 'Top stories', labels: ['INBOX'], extra: [{ name: 'List-Unsubscribe', value: '<https://news.invalid/u>' }] })]),
  thread('th-new', [msg('m-n1', 'th-new', { from: 'Ana Ortiz <ana@newbrand.invalid>', subject: 'Partnership idea', labels: ['INBOX', 'UNREAD'], snippet: 'We run a studio in Logan Square' })]),
  thread('th-yoga2', [msg('m-y1', 'th-yoga2', { from: 'Ana <ana@harboryoga.example>', subject: 'Re: HumanKind x Harbor Yoga', labels: ['INBOX'], snippet: 'What would it cost us?' })]),
  thread('th-draft', [msg('m-d1', 'th-draft', { from: `HumanKind <${OWNER[JACK]}>`, to: 'x <x@y.invalid>', subject: 'Draft pitch', labels: ['DRAFT'] })]),
];
const PETE_MAIL = () => [thread('th-pete', [msg('m-pp1', 'th-pete', { from: 'Ria <ria@cafe.invalid>', to: `Pete <${OWNER[PETE]}>`, subject: 'Hi Pete', labels: ['INBOX', 'UNREAD'] })])];

let sb, gmail, calls, writes, clock, claudeCalls;
const mailboxes = { 'tok-jack': JACK_MAIL(), 'tok-pete': PETE_MAIL() };
const fakeGmail = () => {
  calls = [];
  const box = token => { const m = mailboxes[token]; if (!m) throw new GmailError(401, 'bad token'); return m; };
  const find = (token, id) => { const t = box(token).find(x => x.id === id); if (!t) throw new GmailError(404, 'Requested entity was not found.'); return t; };
  const meta = t => ({ id: t.id, historyId: t.historyId, messages: t.messages.map(m => ({ ...m, payload: { mimeType: m.payload.mimeType, headers: m.payload.headers } })) });
  return {
    listThreads: async (token, { labelIds = [], q = null, pageToken = null, maxResults = 50 }) => { calls.push(['listThreads', token, labelIds.join(','), q, pageToken]); const all = box(token).filter(t => labelIds.every(l => t.labels.includes(l))); const start = pageToken ? Number(pageToken) : 0; const page = all.slice(start, start + maxResults); return { threads: page.map(t => ({ id: t.id })), nextPageToken: start + maxResults < all.length ? String(start + maxResults) : undefined }; },
    getThreadMeta: async (token, id) => { calls.push(['getThreadMeta', token, id]); return meta(find(token, id)); },
    // hkos-inbox-v2 Q1 - message-level list (newest first, each message's own labels) + one message's metadata.
    // q understands from:(a OR b) by sender domain; anything else passes through unfiltered.
    listMessages: async (token, { labelIds = [], q = null, pageToken = null, maxResults = 25 }) => {
      calls.push(['listMessages', token, labelIds.join(','), q, pageToken]);
      const from = q && /from:\(([^)]*)\)/.exec(q); const domains = from ? from[1].split(' OR ') : null;
      const dom = m => (/@([^>\s]+)/.exec(m.payload.headers.find(h => h.name === 'From').value) || [])[1];
      const all = box(token).flatMap(t => [...t.messages].reverse()).filter(m => labelIds.every(l => m.labelIds.includes(l)) && (!domains || domains.includes(dom(m))));
      const start = pageToken ? Number(pageToken) : 0; const page = all.slice(start, start + maxResults);
      return { messages: page.map(m => ({ id: m.id, threadId: m.threadId })), nextPageToken: start + maxResults < all.length ? String(start + maxResults) : undefined };
    },
    getMessageMeta: async (token, id) => { calls.push(['getMessageMeta', token, id]); const m = box(token).flatMap(t => t.messages).find(x => x.id === id); if (!m) throw new GmailError(404, 'Requested entity was not found.'); return { ...m, payload: { mimeType: m.payload.mimeType, headers: m.payload.headers } }; },
    getThreadFull: async (token, id) => { calls.push(['getThreadFull', token, id]); return JSON.parse(JSON.stringify(find(token, id))); },
  };
};
const spyWrites = s => { const orig = s.from; const log = []; s.from = t => { const b = orig(t); for (const op of ['insert', 'upsert', 'update', 'delete']) { const f = b[op]; b[op] = (...a) => { log.push([op, t]); return f.apply(b, a); }; } return b; }; return log; };
const fresh = (extra = {}) => {
  sb = seed({
    hk_touches: [{ id: 't1', business_id: HK, brand_id: ID.yoga, sender_user_id: JACK, channel: 'email', kind: 'cold', subject: 'HumanKind x Harbor Yoga - a mat-time challenge', body_text: 'secret body', state: 'sent', sent_at: '2026-10-24T15:00:00Z', gmail_thread_id: 'th-tracked', gmail_message_id: 'm-t1', created_by: 'user', created_at: '2026-10-24T14:00:00Z' }],
    hk_replies: [{ id: 'r1', business_id: HK, brand_id: ID.yoga, touch_id: 't1', gmail_message_id: 'm-t2', gmail_thread_id: 'th-tracked', from_name: 'Ana', from_domain: 'harboryoga.example', from_email: 'ana@harboryoga.example', received_at: '2026-10-26T15:00:00Z', label: 'interested', handled: false, created_at: '2026-10-26T15:01:00Z' }],
    hk_ignored_senders: [{ id: 'ig1', business_id: HK, user_id: JACK, domain: 'news.invalid', created_at: '2026-10-20T00:00:00Z' }],
    hk_events: [], ...extra,
  });
  writes = spyWrites(sb);
  gmail = fakeGmail();
  clock = NOW.getTime();
  claudeCalls = 0;
  R.inboxCache.clear(); R.clearLastGood();
};
const deps = (over = {}) => ({
  supabase: sb, gmail, now: () => new Date(clock),
  mailbox: async (businessId, userId) => (OWNER[userId] ? { grant: { id: `grant-${userId}`, google_email: OWNER[userId], error: null }, tether: { purposes: ['drafts', 'inbox'] }, state: 'ok' } : null),
  tokenFor: async (req, res, businessId, purpose) => { assert.equal(purpose, 'inbox'); const uid = req.auth.user.id; if (!TOKEN[uid]) { res.status(409).json({ error: 'Link a Google mailbox to this workspace for inbox first', needs_mailbox: purpose }); return null; } return TOKEN[uid]; },
  call: async ({ system, messages }) => { claudeCalls++; assert.ok(!/@/.test(system + JSON.stringify(messages)), 'prompt carries no address'); return { content: [{ type: 'text', text: '{"label":"pricing","summary":"Asks what it costs"}' }] }; },
  ...over,
});
const call = async (route, req, over) => { const res = resOf(); await route(req, res, deps(over)); return res; };
const noAt = v => !JSON.stringify(stripBodies(v)).includes('@');
const gmailCallsFor = name => calls.filter(c => c[0] === name).length;

test('I1 list inbox (v2 Q1): one row per thread from its newest INBOX message, chip + lane, unread, nothing written, no "@", 1 messages.list + n messages.get = units', async () => {
  fresh();
  const r = await call(R.listThreadsRoute, reqOf({ query: { tab: 'inbox' } }));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const by = Object.fromEntries(r.body.threads.map(t => [t.thread_id, t]));
  assert.deepEqual(Object.keys(by).sort(), ['th-bulk', 'th-ign', 'th-match', 'th-new', 'th-team', 'th-tracked', 'th-yoga2']);
  assert.deepEqual(by['th-tracked'].chip, { kind: 'tracked', brand_id: ID.yoga, brand_name: 'Harbor Yoga', status: 'claimed', label: 'interested' });
  assert.deepEqual(by['th-match'].chip, { kind: 'matches', brand_id: ID.run, brand_name: 'Bluefin Run Club', status: 'candidate' });
  assert.deepEqual(by['th-team'].chip, { kind: 'team' });
  assert.deepEqual(by['th-bulk'].chip, { kind: 'not_tracked', reason: 'bulk' });
  assert.deepEqual(by['th-ign'].chip, { kind: 'not_tracked', reason: 'ignored' });
  assert.deepEqual(by['th-new'].chip, { kind: 'untracked' });
  assert.deepEqual(by['th-yoga2'].chip, { kind: 'matches', brand_id: ID.yoga, brand_name: 'Harbor Yoga', status: 'claimed' });
  assert.deepEqual(Object.fromEntries(Object.entries(by).map(([k, t]) => [k, t.lane])), { 'th-tracked': 'needs_you', 'th-match': 'needs_you', 'th-team': 'needs_you', 'th-bulk': 'other', 'th-ign': 'other', 'th-new': 'needs_you', 'th-yoga2': 'needs_you' });
  assert.deepEqual(r.body.lane_counts, { needs_you: 5, brands: 3, other: 2 });
  assert.equal(by['th-match'].from_name, 'Sam Lee, Co-founder'); assert.equal(by['th-match'].from_hint, 'Co-founder'); assert.equal(by['th-match'].unread, true);
  assert.equal(by['th-tracked'].subject, 'Re: HumanKind x Harbor Yoga - a mat-time challenge', 'the newest message\'s subject'); assert.equal(by['th-tracked'].from_name, 'Ana');
  assert.equal(r.body.unread, 2); assert.equal(r.body.next_page_token, null); assert.equal(r.body.from_cache, false);
  assert.ok(noAt(r.body) && !JSON.stringify(r.body).includes('@'), 'a list response carries no address at all');
  assert.deepEqual(writes, [], 'reading writes nothing');
  assert.equal(sb.db.hk_events.length, 0, 'reading logs nothing');
  assert.equal(gmailCallsFor('listMessages'), 1); assert.equal(gmailCallsFor('getMessageMeta'), 7); assert.equal(gmailCallsFor('getThreadMeta'), 0); assert.equal(r.body.gmail_calls, 8);
  assert.equal(r.body.gmail_units, 5 + 7 * 20);
  assert.ok(calls.every(c => c[1] === 'tok-jack'), 'only the caller\'s token');
});

test('I1 cache: a repeat list is served for 120 s with 0 Gmail calls; refresh=1 and the TTL refetch', async () => {
  fresh();
  await call(R.listThreadsRoute, reqOf({ query: { tab: 'inbox' } }));
  const n = calls.length;
  const again = await call(R.listThreadsRoute, reqOf({ query: { tab: 'inbox' } }));
  assert.equal(again.body.from_cache, true); assert.equal(calls.length, n);
  const other = await call(R.listThreadsRoute, reqOf({ query: { tab: 'inbox', q: 'from:bluefinrun.example' } }));
  assert.equal(other.body.from_cache, false, 'a different q is a different key'); assert.equal(calls.find(c => c[0] === 'listMessages' && c[3])[3], 'from:bluefinrun.example', 'q passes through verbatim');
  const n2 = calls.length;
  await call(R.listThreadsRoute, reqOf({ query: { tab: 'inbox', refresh: '1' } }));
  assert.ok(calls.length > n2, 'refresh refetches');
  const n3 = calls.length;
  clock += 121_000;
  const late = await call(R.listThreadsRoute, reqOf({ query: { tab: 'inbox' } }));
  assert.equal(late.body.from_cache, false); assert.ok(calls.length > n3);
  assert.deepEqual(writes, []);
});

test('I1 limit + metadata cache (v2): a small page; Brands reuses the message metadata page 1 fetched; link reads the thread once', async () => {
  fresh();
  const p1 = await call(R.listThreadsRoute, reqOf({ query: { tab: 'inbox', limit: '5' } }));
  assert.equal(p1.body.threads.length, 5); assert.equal(p1.body.next_page_token, '5'); assert.equal(p1.body.gmail_calls, 6);
  assert.equal(gmailCallsFor('getMessageMeta'), 5);
  const brands = await call(R.listThreadsRoute, reqOf({ query: { tab: 'brands', limit: '5' } }));
  assert.equal(gmailCallsFor('listMessages'), 2); assert.equal(gmailCallsFor('getMessageMeta'), 6, 'only th-yoga2\'s newest message was not fetched yet'); assert.equal(brands.body.gmail_calls, 2);
  assert.deepEqual(brands.body.threads.map(t => t.thread_id).sort(), ['th-match', 'th-tracked', 'th-yoga2']); assert.equal(brands.body.next_page_token, null); assert.equal(brands.body.more, false);
  const lk = await call(R.linkThreadRoute, reqOf({ method: 'POST', params: { id: 'th-match' }, body: { brand_id: ID.run } }));
  assert.equal(lk.code, 201); assert.equal(gmailCallsFor('getThreadMeta'), 1, 'link reads the whole thread once');
  const after = await call(R.listThreadsRoute, reqOf({ query: { tab: 'brands', limit: '5' } }));
  assert.equal(after.body.from_cache, false); assert.equal(gmailCallsFor('getMessageMeta'), 6, 'a link drops the list cache but keeps message metadata'); assert.equal(after.body.threads.find(t => t.thread_id === 'th-match').chip.kind, 'tracked');
  await call(R.listThreadsRoute, reqOf({ query: { tab: 'inbox', limit: '5', refresh: '1' } }));
  assert.equal(gmailCallsFor('getMessageMeta'), 11, 'Refresh re-reads everything');
  assert.equal((await call(R.listThreadsRoute, reqOf({ query: { tab: 'inbox', limit: '2' } }))).body.threads.length, 5, 'limit floors at 5');
  assert.deepEqual(writes.map(w => w[1]), ['hk_replies', 'hk_events']);
});

test('I1 tabs (v2): brands = the from:(brand domains) search filtered to tracked + matches; sent and drafts by label; a message gone from Gmail is skipped', async () => {
  fresh();
  const brands = await call(R.listThreadsRoute, reqOf({ query: { tab: 'brands' } }));
  assert.deepEqual(brands.body.threads.map(t => t.thread_id).sort(), ['th-match', 'th-tracked', 'th-yoga2']); assert.equal(brands.body.unread, null); assert.equal(brands.body.lane_counts, null);
  assert.equal(calls.find(c => c[0] === 'listMessages' && c[3]).at(3), 'from:(bluefinrun.example OR harboryoga.example OR northwindjuice.example)');
  const sent = await call(R.listThreadsRoute, reqOf({ query: { tab: 'sent' } }));
  assert.deepEqual(sent.body.threads.map(t => t.thread_id), ['th-tracked']); assert.equal(calls.find(c => c[0] === 'listMessages' && c[2] === 'SENT')[2], 'SENT');
  const drafts = await call(R.listThreadsRoute, reqOf({ query: { tab: 'drafts' } }));
  assert.deepEqual(drafts.body.threads.map(t => t.thread_id), ['th-draft']); assert.deepEqual(drafts.body.threads[0].chip, { kind: 'self' });
  mailboxes['tok-jack'].push(thread('th-ghost', [msg('m-ghost', 'th-ghost', { from: 'Gone <g@gone.invalid>', labels: ['INBOX'] })]));
  const g = gmail.getMessageMeta; gmail.getMessageMeta = async (t, id) => { if (id === 'm-ghost') throw new GmailError(404, 'gone'); return g(t, id); };
  const inbox = await call(R.listThreadsRoute, reqOf({ query: { tab: 'inbox', refresh: '1' } }));
  assert.equal(inbox.code, 200); assert.ok(!inbox.body.threads.some(t => t.thread_id === 'th-ghost'));
  mailboxes['tok-jack'].pop();
  assert.deepEqual(writes, []);
});

test('I1 access: viewer 403 on every route; a member with no tether 409 needs_mailbox inbox; platform owner is not special', async () => {
  fresh();
  for (const [route, req] of [[R.listThreadsRoute, reqOf({ user: VIEWER, role: 'viewer' })], [R.openThreadRoute, reqOf({ user: VIEWER, role: 'viewer', params: { id: 'th-match' } })], [R.listIgnoredRoute, reqOf({ user: VIEWER, role: 'viewer' })], [R.ignoreRoute, reqOf({ method: 'POST', user: VIEWER, role: 'viewer', body: { domain: 'x.invalid' } })]]) {
    const r = await call(route, req); assert.equal(r.code, 403, route.name);
  }
  const r = await call(R.listThreadsRoute, reqOf({ user: NOMAIL }));
  assert.equal(r.code, 409); assert.equal(r.body.needs_mailbox, 'inbox');
  const po = await call(R.openThreadRoute, reqOf({ user: NOMAIL, platformOwner: true, params: { id: 'th-match' } }));
  assert.equal(po.code, 409); assert.ok(!JSON.stringify(po.body).includes('html') && !JSON.stringify(po.body).includes('steal()'));
  const rc = await call(R.listThreadsRoute, reqOf(), { tokenFor: async (req, res) => { res.status(409).json({ error: 'Reconnect this Google account', needs_reconnect: 'grant-x' }); return null; } });
  assert.equal(rc.code, 409); assert.equal(rc.body.needs_reconnect, 'grant-x');
  assert.equal(calls.length, 0); assert.deepEqual(writes, []);
});

test('I1 open: messages with raw html and text for the owner, names only elsewhere, brand panel, nothing written, cached', async () => {
  fresh();
  const r = await call(R.openThreadRoute, reqOf({ params: { id: 'th-match' } }));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const m = r.body.messages[0];
  assert.ok(m.html.includes('<script>steal()</script>') && m.html.includes('sam@bluefinrun.example'), 'html is raw; the browser sanitizes');
  assert.ok(m.text.includes('sam@bluefinrun.example'));
  assert.equal(m.from_name, 'Sam Lee, Co-founder'); assert.equal(m.from_domain, 'bluefinrun.example'); assert.deepEqual(m.to_names, ['you']); assert.equal(m.is_mine, false); assert.equal(m.unread, true);
  assert.ok(noAt(r.body), 'no address outside the body fields');
  assert.deepEqual(r.body.chip, { kind: 'matches', brand_id: ID.run, brand_name: 'Bluefin Run Club', status: 'candidate' });
  assert.equal(r.body.brand.name, 'Bluefin Run Club'); assert.equal(r.body.brand.touch_count, 0); assert.equal(r.body.brand.verdict.ok, true); assert.equal(r.body.brand.last_reply_label, null); assert.equal(r.body.unhandled_reply_id, null);
  assert.deepEqual(r.body.sender, { name: 'Sam Lee, Co-founder', domain: 'bluefinrun.example' });
  assert.deepEqual(writes, []); assert.equal(sb.db.hk_events.length, 0);
  const n = calls.length;
  assert.equal((await call(R.openThreadRoute, reqOf({ params: { id: 'th-match' } }))).body.from_cache, true); assert.equal(calls.length, n);
  const t = await call(R.openThreadRoute, reqOf({ params: { id: 'th-tracked' } }));
  assert.equal(t.body.chip.kind, 'tracked'); assert.equal(t.body.unhandled_reply_id, 'r1'); assert.equal(t.body.brand.last_reply_label, 'interested'); assert.equal(t.body.brand.touch_count, 1);
  assert.equal(t.body.messages[0].is_mine, true); assert.deepEqual(t.body.messages[0].to_names, ['Ana']); assert.equal(t.body.messages[1].from_name, 'Ana');
  const team = await call(R.openThreadRoute, reqOf({ params: { id: 'th-team' } }));
  assert.equal(team.body.brand, null); assert.deepEqual(team.body.chip, { kind: 'team' });
  assert.deepEqual(writes, []);
});

test('I4 own token only: another member never sees the owner\'s thread or html; each call carries the caller\'s token', async () => {
  fresh();
  const mine = await call(R.openThreadRoute, reqOf({ params: { id: 'th-match' } }));
  assert.ok(mine.body.messages[0].html);
  const pete = await call(R.openThreadRoute, reqOf({ user: PETE, params: { id: 'th-match' } }));
  assert.equal(pete.code, 404); assert.ok(!JSON.stringify(pete.body).includes('html') && !JSON.stringify(pete.body).includes('steal()'));
  const peteList = await call(R.listThreadsRoute, reqOf({ user: PETE }));
  assert.deepEqual(peteList.body.threads.map(t => t.thread_id), ['th-pete']); assert.deepEqual(peteList.body.threads[0].chip, { kind: 'untracked' });
  const nomail = await call(R.openThreadRoute, reqOf({ user: NOMAIL, params: { id: 'th-match' } }));
  assert.equal(nomail.code, 409); assert.ok(!JSON.stringify(nomail.body).includes('steal()'));
  assert.ok(calls.filter(c => c[1] === 'tok-pete').length >= 2 && !calls.some(c => c[1] === 'tok-jack' && c[2] === 'th-pete'));
  assert.ok(!calls.some(c => c[1] !== TOKEN[JACK] && c[1] !== TOKEN[PETE]));
  const peteOwn = await call(R.openThreadRoute, reqOf({ user: PETE, params: { id: 'th-pete' } }));
  assert.equal(peteOwn.code, 200); assert.deepEqual(peteOwn.body.messages[0].to_names, ['you']);
  assert.deepEqual(writes, []);
});

test('I1 link: the sync\'s hk_replies shape, new_thread with no sent email (0 Claude), one content-free event, cache dropped, 409 on a repeat', async () => {
  fresh();
  await call(R.listThreadsRoute, reqOf());
  const r = await call(R.linkThreadRoute, reqOf({ method: 'POST', params: { id: 'th-new' }, body: { brand_id: ID.run } }));
  assert.equal(r.code, 201, JSON.stringify(r.body));
  const row = sb.db.hk_replies.find(x => x.gmail_thread_id === 'th-new');
  assert.deepEqual(Object.keys(row).filter(k => !['id', 'created_at', 'recorded_at'].includes(k)).sort(), ['brand_id', 'business_id', 'from_domain', 'from_email', 'from_name', 'gmail_message_id', 'gmail_thread_id', 'handled', 'label', 'received_at', 'summary', 'touch_id', 'urgent']);
  assert.equal(row.brand_id, ID.run); assert.equal(row.touch_id, null); assert.equal(row.gmail_message_id, 'm-n1'); assert.equal(row.label, 'new_thread'); assert.equal(row.urgent, false); assert.equal(row.handled, false); assert.equal(row.from_name, 'Ana Ortiz'); assert.equal(row.from_domain, 'newbrand.invalid'); assert.equal(row.received_at, '2026-10-26T15:00:00.000Z');
  assert.equal(claudeCalls, 0);
  assert.ok(!('from_email' in r.body.reply) && !JSON.stringify(r.body).includes('@'));
  const ev = sb.db.hk_events;
  assert.equal(ev.length, 1); assert.equal(ev[0].action, 'inbox_linked'); assert.equal(ev[0].entity_id, ID.run); assert.deepEqual(Object.keys(ev[0].detail).sort(), ['label', 'labeled', 'reply_id', 'thread_id', 'touch_id']); assert.ok(!JSON.stringify(ev[0]).includes('@') && !JSON.stringify(ev[0]).includes('Logan Square'));
  assert.equal(sb.db.hk_brands.find(b => b.id === ID.run).owner_user_id, null, 'linking never changes the owner');
  const list = await call(R.listThreadsRoute, reqOf());
  assert.equal(list.body.from_cache, false); assert.deepEqual(list.body.threads.find(t => t.thread_id === 'th-new').chip, { kind: 'tracked', brand_id: ID.run, brand_name: 'Bluefin Run Club', status: 'candidate', label: 'new_thread' });
  const again = await call(R.linkThreadRoute, reqOf({ method: 'POST', params: { id: 'th-new' }, body: { brand_id: ID.yoga } }));
  assert.equal(again.code, 409); assert.equal(again.body.already_tracked, ID.run);
  assert.equal((await call(R.linkThreadRoute, reqOf({ method: 'POST', params: { id: 'th-tracked' }, body: { brand_id: ID.run } }))).body.already_tracked, ID.yoga);
  assert.equal((await call(R.linkThreadRoute, reqOf({ method: 'POST', params: { id: 'th-nope' }, body: { brand_id: ID.run } }))).code, 404);
  assert.equal((await call(R.linkThreadRoute, reqOf({ method: 'POST', params: { id: 'th-new' }, body: { brand_id: 'nope' } }))).code, 404);
  assert.equal((await call(R.linkThreadRoute, reqOf({ method: 'POST', params: { id: 'th-bulk' }, body: { brand_id: ID.old } }))).code, 409);
  const noInbound = await call(R.linkThreadRoute, reqOf({ method: 'POST', params: { id: 'th-draft' }, body: { brand_id: ID.run } }));
  assert.equal(noInbound.code, 409); assert.equal(noInbound.body.no_inbound, true);
  assert.equal(sb.db.hk_replies.length, 2); assert.equal(sb.db.hk_events.length, 1);
  assert.equal((await call(R.linkThreadRoute, reqOf({ method: 'POST', user: VIEWER, role: 'viewer', params: { id: 'th-new' }, body: { brand_id: ID.run } }))).code, 403);
});

test('I1 link to a brand with a sent email: the FAST label (1 call, no address in the prompt), touch_id set, urgent; the 60/day cap holds the call back', async () => {
  fresh();
  const r = await call(R.linkThreadRoute, reqOf({ method: 'POST', params: { id: 'th-yoga2' }, body: { brand_id: ID.yoga } }));
  assert.equal(r.code, 201, JSON.stringify(r.body));
  assert.equal(claudeCalls, 1);
  const row = sb.db.hk_replies.find(x => x.gmail_thread_id === 'th-yoga2');
  assert.equal(row.label, 'pricing'); assert.equal(row.urgent, true); assert.equal(row.touch_id, 't1'); assert.equal(row.summary, 'Asks what it costs');
  assert.equal(sb.db.hk_events[0].detail.labeled, true);
  fresh({ hk_events: Array.from({ length: 60 }, (_, i) => ({ id: `e${i}`, business_id: HK, action: 'reply_logged', entity_type: 'brand', entity_id: ID.yoga, detail: { labeled: true }, created_at: '2026-10-26T18:00:00Z' })) });
  const capped = await call(R.linkThreadRoute, reqOf({ method: 'POST', params: { id: 'th-yoga2' }, body: { brand_id: ID.yoga } }));
  assert.equal(capped.code, 201); assert.equal(claudeCalls, 0);
  const row2 = sb.db.hk_replies.find(x => x.gmail_thread_id === 'th-yoga2');
  assert.equal(row2.label, 'other'); assert.equal(row2.urgent, false); assert.equal(sb.db.hk_events.at(-1).detail.labeled, false);
});

test('I1 track: the Add brand rules (sponsor / dnc refuse, duplicate needs force), then link; brand + reply; no brand when the thread is not yours', async () => {
  fresh();
  const sponsor = await call(R.trackRoute, reqOf({ method: 'POST', body: { name: 'Northwind Juice', domain: 'northwindjuice.example', thread_id: 'th-new' } }));
  assert.equal(sponsor.code, 409); assert.equal(sponsor.body.verdict.verdict, 'sponsor');
  const dnc = await call(R.trackRoute, reqOf({ method: 'POST', body: { name: 'Copperleaf Cafe', thread_id: 'th-new' } }));
  assert.equal(dnc.code, 409); assert.equal(dnc.body.verdict.verdict, 'do_not_contact');
  const dup = await call(R.trackRoute, reqOf({ method: 'POST', body: { name: 'Bluefin Runners', thread_id: 'th-new' } }));
  assert.equal(dup.code, 409); assert.equal(dup.body.verdict.verdict, 'possible_duplicate');
  const gone = await call(R.trackRoute, reqOf({ method: 'POST', body: { name: 'Ghost Brand', domain: 'ghost.invalid', thread_id: 'th-nope' } }));
  assert.equal(gone.code, 404); assert.ok(!sb.db.hk_brands.some(b => b.name === 'Ghost Brand'), 'no brand when the thread is not in the mailbox');
  const before = sb.db.hk_brands.length;
  const r = await call(R.trackRoute, reqOf({ method: 'POST', body: { name: 'New Brand Studio', domain: 'newbrand.invalid', thread_id: 'th-new' } }));
  assert.equal(r.code, 201, JSON.stringify(r.body));
  assert.equal(sb.db.hk_brands.length, before + 1);
  const brand = sb.db.hk_brands.find(b => b.name === 'New Brand Studio');
  assert.equal(brand.domain, 'newbrand.invalid'); assert.equal(brand.status, 'candidate'); assert.equal(brand.owner_user_id, null); assert.equal(brand.source, 'user_supplied'); assert.equal(brand.created_by, JACK);
  assert.equal(r.body.brand.id, brand.id); assert.equal(r.body.reply.gmail_thread_id, 'th-new'); assert.equal(r.body.reply.label, 'new_thread'); assert.ok(!JSON.stringify(r.body).includes('@'));
  assert.deepEqual(sb.db.hk_events.map(e => e.action), ['brand.created', 'inbox_linked']);
  const list = await call(R.listThreadsRoute, reqOf());
  assert.equal(list.body.threads.find(t => t.thread_id === 'th-new').chip.kind, 'tracked');
  const forced = await call(R.trackRoute, reqOf({ method: 'POST', body: { name: 'Bluefin Runners', thread_id: 'th-bulk', force_duplicate: true, claim: true } }));
  assert.equal(forced.code, 201); assert.equal(sb.db.hk_brands.find(b => b.name === 'Bluefin Runners').owner_user_id, JACK);
  assert.equal((await call(R.trackRoute, reqOf({ method: 'POST', body: { name: 'X', thread_id: 'th-new' } }))).code, 409, 'already tracked');
  assert.equal((await call(R.trackRoute, reqOf({ method: 'POST', body: { name: 'X' } }))).code, 400, 'thread_id required');
  assert.equal((await call(R.trackRoute, reqOf({ method: 'POST', body: { name: 'Digits Brand', thread_id: '1999999999999999' } }))).code, 404, 'a digit-heavy real-looking id is looked up, not refused as a phone number');
  assert.equal(claudeCalls, 0);
});

test('I1 ignore list is per user: ignore, list, chip, un-ignore, events; a repeat is a no-op', async () => {
  fresh();
  const r = await call(R.ignoreRoute, reqOf({ method: 'POST', body: { domain: 'https://Shop.invalid/path' } }));
  assert.deepEqual(r.body, { domain: 'shop.invalid', ignored: true });
  assert.equal((await call(R.ignoreRoute, reqOf({ method: 'POST', body: { domain: 'shop.invalid' } }))).code, 200);
  assert.equal(sb.db.hk_ignored_senders.filter(x => x.domain === 'shop.invalid').length, 1);
  assert.deepEqual((await call(R.listIgnoredRoute, reqOf())).body.domains.map(d => d.domain), ['news.invalid', 'shop.invalid']);
  assert.deepEqual((await call(R.listIgnoredRoute, reqOf({ user: PETE }))).body.domains, []);
  const list = await call(R.listThreadsRoute, reqOf());
  assert.deepEqual(list.body.threads.find(t => t.thread_id === 'th-bulk').chip, { kind: 'not_tracked', reason: 'ignored' });
  const un = await call(R.unignoreRoute, reqOf({ method: 'DELETE', params: { domain: 'shop.invalid' } }));
  assert.deepEqual(un.body, { domain: 'shop.invalid', ignored: false });
  assert.equal(sb.db.hk_ignored_senders.length, 1);
  assert.deepEqual(sb.db.hk_events.map(e => [e.action, e.detail.domain, e.entity_type]), [['sender_ignored', 'shop.invalid', 'sender'], ['sender_unignored', 'shop.invalid', 'sender']]);
  assert.equal((await call(R.ignoreRoute, reqOf({ method: 'POST', body: { domain: 'not a domain' } }))).code, 400);
  assert.equal((await call(R.unignoreRoute, reqOf({ method: 'DELETE', params: { domain: 'never.invalid' } }))).code, 200);
  assert.equal(sb.db.hk_events.length, 2);
});

// ---- hkos-inbox-v2 Q3 quota handling, L4 intel on open, L5 Analyze (Claude + web search STUBBED) ----
const quota = (status = 429, reason = 'rateLimitExceeded') => new GmailError(status, "Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user' of service gmail.googleapis.com", reason);
const RAW = /Quota exceeded|gmail\.googleapis|Units per minute/;

test('v2 Q3: a 429 is retried once after the backoff and the list comes back; a 403 rateLimitExceeded counts too', async () => {
  fresh();
  let fails = 1, slept = [];
  const lm = gmail.listMessages; gmail.listMessages = async (...a) => { if (fails-- > 0) throw quota(); return lm(...a); };
  const r = await call(R.listThreadsRoute, reqOf({ query: { tab: 'inbox' } }), { sleep: async ms => { slept.push(ms); } });
  assert.equal(r.code, 200); assert.equal(r.body.threads.length, 7); assert.deepEqual(slept, [R.BACKOFF_MS]); assert.equal(r.body.busy, undefined);
  fails = 1; R.inboxCache.clear();
  gmail.listMessages = async (...a) => { if (fails-- > 0) throw quota(403, 'userRateLimitExceeded'); return lm(...a); };
  assert.equal((await call(R.listThreadsRoute, reqOf({ query: { tab: 'inbox' } }), { sleep: async () => {} })).code, 200);
  assert.ok(R.isQuota(quota(403, 'quotaExceeded')) && !R.isQuota(new GmailError(403, 'Insufficient Permission', 'insufficientPermissions')) && !R.isQuota(new GmailError(500, 'Backend Error')));
});

test('v2 Q3: still busy after the retry -> the last good list with the plain line + retry_after_ms; no last list -> 503 plain line; Google\'s text never reaches the client', async () => {
  fresh();
  const good = await call(R.listThreadsRoute, reqOf({ query: { tab: 'inbox' } }));
  assert.equal(good.code, 200);
  clock += 121_000; // the 120 s cache has expired; only the last-good copy is left
  gmail.listMessages = async () => { throw quota(); };
  const busy = await call(R.listThreadsRoute, reqOf({ query: { tab: 'inbox' } }), { sleep: async () => {} });
  assert.equal(busy.code, 200); assert.equal(busy.body.busy, true); assert.equal(busy.body.notice, R.BUSY_LIST); assert.equal(busy.body.retry_after_ms, 60_000);
  assert.deepEqual(busy.body.threads.map(t => t.thread_id), good.body.threads.map(t => t.thread_id));
  assert.ok(!RAW.test(JSON.stringify(busy.body)));
  const none = await call(R.listThreadsRoute, reqOf({ query: { tab: 'inbox', q: 'never listed' } }), { sleep: async () => {} });
  assert.equal(none.code, 503); assert.deepEqual(none.body, { error: R.BUSY_NONE, busy: true, retry_after_ms: 60_000 });
  gmail.listMessages = async () => { throw new GmailError(500, 'Backend Error: internal gmail.googleapis.com failure'); };
  const down = await call(R.listThreadsRoute, reqOf({ query: { tab: 'inbox', q: 'other' } }), { sleep: async () => {} });
  assert.equal(down.code, 502); assert.deepEqual(down.body, { error: R.GMAIL_DOWN });
  assert.deepEqual(writes, []);
});

test('v2 Q3: thread open uses the same handling - retry, then the last opened copy with its own line, or 503', async () => {
  fresh();
  const first = await call(R.openThreadRoute, reqOf({ params: { id: 'th-new' } }));
  assert.equal(first.code, 200);
  clock += 121_000;
  gmail.getThreadFull = async () => { throw quota(); };
  const busy = await call(R.openThreadRoute, reqOf({ params: { id: 'th-new' } }), { sleep: async () => {} });
  assert.equal(busy.code, 200); assert.equal(busy.body.notice, R.BUSY_THREAD); assert.equal(busy.body.thread_id, 'th-new');
  const none = await call(R.openThreadRoute, reqOf({ params: { id: 'th-match' } }), { sleep: async () => {} });
  assert.equal(none.code, 503); assert.ok(!RAW.test(JSON.stringify(none.body)));
});

test('v2 Q4: a list notes the time per user (the page-load sync reads it); a cache hit does not', async () => {
  fresh();
  const { inboxListedAt, clearInboxActivity } = await import('./gmailActivity.js');
  clearInboxActivity();
  await call(R.listThreadsRoute, reqOf({ query: { tab: 'inbox' } }));
  assert.equal(inboxListedAt(HK, JACK), clock); assert.equal(inboxListedAt(HK, PETE), null);
  const at = clock; clock += 10_000;
  await call(R.listThreadsRoute, reqOf({ query: { tab: 'inbox' } }));
  assert.equal(inboxListedAt(HK, JACK), at, 'served from cache: no Gmail spent, no new mark');
});

const INTEL_JSON = JSON.stringify({ company: { name: 'Newbrand Studio', website: 'newbrand.invalid', what_they_do: 'Pilates studio in Logan Square. Call 312-555-0199 or ana@newbrand.invalid', hq_city: 'Chicago', chicago_presence: 'yes', size_hint: '1-10', category: 'gym/studio' },
  email: { kind: 'partnership', summary: 'Wants to co-host a challenge', urgency: 'high' }, fit: { sponsor_fit: 'strong', why: 'Local studio with a community', challenge_idea: 'Core week' }, next_step: 'track_as_brand', reason: 'Warm local lead', extra: 'dropped' });
const analyzeDeps = (seen) => ({ sleep: async () => {}, call: async args => { seen.push(args); return { content: [{ type: 'text', text: 'Here you go:\n' + INTEL_JSON }], stop_reason: 'end_turn', usage: { input_tokens: 4000, output_tokens: 600, server_tool_use: { web_search_requests: 2 } } }; } });

test('v2 L5 Analyze: refused without the click flag (0 calls); one STANDARD call with web search max 3; the prompt carries no address or phone; only derived intel stored; prefill returned', async () => {
  fresh({ business_anthropic_usage: [], hk_domain_intel: [], hk_settings: [{ business_id: HK, members_stat: '1,200 members', market_line_local: 'Chicago\'s wellness challenge app' }] });
  mailboxes['tok-jack'] = JACK_MAIL();
  const th = mailboxes['tok-jack'].find(t => t.id === 'th-new');
  th.messages[0].payload.body = { data: b64('Hi! I am Ana, reach me at ana@newbrand.invalid or 312-555-0199. We run a studio.') };
  const seen = [];
  const no = await call(R.analyzeRoute, reqOf({ method: 'POST', params: { id: 'th-new' }, body: {} }), analyzeDeps(seen));
  assert.equal(no.code, 400); assert.equal(seen.length, 0); assert.equal(calls.length, 0);
  const r = await call(R.analyzeRoute, reqOf({ method: 'POST', params: { id: 'th-new' }, body: { click: true } }), analyzeDeps(seen));
  assert.equal(r.code, 200, JSON.stringify(r.body)); assert.equal(seen.length, 1);
  const a = seen[0];
  assert.equal(a.model, 'claude-sonnet-4-6'); assert.equal(a.callType, 'hk_inbox_analyze'); assert.equal(a.userId, JACK); assert.ok(a.max_tokens > 0);
  assert.deepEqual(a.tools.map(t => [t.name, t.max_uses]), [['web_search', 3]]);
  const prompt = a.system + JSON.stringify(a.messages);
  assert.ok(!prompt.includes('ana@newbrand.invalid') && !prompt.includes('312-555-0199'), 'address and phone replaced before the call');
  assert.ok(prompt.includes('newbrand.invalid') && prompt.includes('Partnership idea') && prompt.includes('1,200 members'));
  assert.equal(r.body.intel.company.name, 'Newbrand Studio'); assert.equal(r.body.intel.fit.sponsor_fit, 'strong'); assert.equal(r.body.intel.next_step, 'track_as_brand'); assert.equal(r.body.intel.extra, undefined);
  assert.ok(!JSON.stringify(r.body.intel).includes('@') && !JSON.stringify(r.body.intel).includes('312-555-0199'), 'model text scrubbed before it is stored');
  assert.equal(r.body.cached, false); assert.equal(r.body.web_searches, 2); assert.ok(r.body.cost_usd > 0.02, 'tokens + 2 searches');
  assert.deepEqual(r.body.prefill.is_local, true); assert.equal(r.body.prefill.city, 'Chicago'); assert.equal(r.body.prefill.challenge_idea, 'Core week'); assert.match(r.body.prefill.notes, /^Analyzed 2026-10-26: /);
  const rows = sb.db.hk_domain_intel;
  assert.equal(rows.length, 1); assert.deepEqual(Object.keys(rows[0]).filter(k => !['id', 'created_at', 'recorded_at'].includes(k)).sort(), ['business_id', 'cost_usd', 'domain', 'intel', 'model', 'researched_at', 'researched_by']);
  assert.equal(rows[0].domain, 'newbrand.invalid');
  const stored = JSON.stringify(rows[0]);
  assert.ok(!stored.includes('Partnership idea') && !stored.includes('We run a studio') && !stored.includes('@'), 'no subject, body or address stored');
  assert.ok(!sb.db.hk_events.length, 'untracked mail is never logged');
  mailboxes['tok-jack'] = JACK_MAIL();
});

test('v2 L5 Analyze: the same domain within 30 days returns the saved card + needs_confirm (0 calls); confirm spends again; after 30 days it runs; the reader shows the intel', async () => {
  fresh({ business_anthropic_usage: [], hk_domain_intel: [] });
  const seen = [];
  await call(R.analyzeRoute, reqOf({ method: 'POST', params: { id: 'th-new' }, body: { click: true } }), analyzeDeps(seen));
  clock += 5 * 86_400_000;
  const again = await call(R.analyzeRoute, reqOf({ method: 'POST', params: { id: 'th-new' }, body: { click: true } }), analyzeDeps(seen));
  assert.equal(seen.length, 1); assert.equal(again.body.cached, true); assert.equal(again.body.needs_confirm, true); assert.equal(again.body.intel.company.name, 'Newbrand Studio');
  await call(R.analyzeRoute, reqOf({ method: 'POST', params: { id: 'th-new' }, body: { click: true, confirm: true } }), analyzeDeps(seen));
  assert.equal(seen.length, 2); assert.equal(sb.db.hk_domain_intel.length, 1, 'one row per domain');
  clock += 31 * 86_400_000;
  await call(R.analyzeRoute, reqOf({ method: 'POST', params: { id: 'th-new' }, body: { click: true } }), analyzeDeps(seen));
  assert.equal(seen.length, 3);
  const open = await call(R.openThreadRoute, reqOf({ params: { id: 'th-new' } }));
  assert.equal(open.body.intel.intel.fit.sponsor_fit, 'strong'); assert.equal(open.body.intel.prefill.name, 'Newbrand Studio');
  const list = await call(R.listThreadsRoute, reqOf({ query: { tab: 'inbox', refresh: '1' } }));
  assert.equal(list.body.threads.find(t => t.thread_id === 'th-new').intel_fit, 'strong');
});

test('v2 L5 Analyze: 25 per user per Chicago day from the usage log (429, 0 calls); team mail and threads with no inbound refused', async () => {
  const day = Array.from({ length: 25 }, (_, i) => ({ id: `u${i}`, business_id: HK, user_id: JACK, call_type: 'hk_inbox_analyze', created_at: new Date(NOW.getTime() - i * 60_000).toISOString() }));
  fresh({ business_anthropic_usage: [...day, { id: 'pete1', business_id: HK, user_id: PETE, call_type: 'hk_inbox_analyze', created_at: NOW.toISOString() }], hk_domain_intel: [] });
  const seen = [];
  const capped = await call(R.analyzeRoute, reqOf({ method: 'POST', params: { id: 'th-new' }, body: { click: true } }), analyzeDeps(seen));
  assert.equal(capped.code, 429); assert.equal(seen.length, 0);
  sb.db.business_anthropic_usage.splice(0, 1);
  assert.equal((await call(R.analyzeRoute, reqOf({ method: 'POST', params: { id: 'th-new' }, body: { click: true } }), analyzeDeps(seen))).code, 200);
  assert.equal((await call(R.analyzeRoute, reqOf({ method: 'POST', params: { id: 'th-team' }, body: { click: true } }), analyzeDeps(seen))).code, 409);
  assert.equal((await call(R.analyzeRoute, reqOf({ method: 'POST', params: { id: 'th-draft' }, body: { click: true } }), analyzeDeps(seen))).code, 409);
  assert.equal(seen.length, 1);
  const viewer = await call(R.analyzeRoute, reqOf({ method: 'POST', user: VIEWER, role: 'viewer', params: { id: 'th-new' }, body: { click: true } }), analyzeDeps(seen));
  assert.equal(viewer.code, 403);
});

test('v2 Q2 Brands order (Jack ruling 3): rows sort by internalDate from the metadata already fetched, not by message id', async () => {
  fresh();
  const at = (id, threadId, from, when) => ({ ...msg(id, threadId, { from, subject: `Hi from ${threadId}`, labels: ['INBOX'] }), internalDate: String(when) });
  const extra = [thread('th-old', [at('ffff01', 'th-old', 'Sam <sam@bluefinrun.example>', 1000)]), thread('th-mid', [at('00aa02', 'th-mid', 'Ana <ana@harboryoga.example>', 5000)]), thread('th-new2', [at('0001', 'th-new2', 'Ana <ana@harboryoga.example>', 9000)])];
  mailboxes['tok-jack'] = [...extra, ...JACK_MAIL().filter(t => !['th-match', 'th-yoga2', 'th-tracked'].includes(t.id))];
  const r = await call(R.listThreadsRoute, reqOf({ query: { tab: 'brands' } }));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.threads.map(t => t.thread_id), ['th-new2', 'th-mid', 'th-old'], 'newest internalDate first although its id sorts last');
  assert.equal(r.body.gmail_units, 5 + 3 * 20);
  mailboxes['tok-jack'] = JACK_MAIL();
});

test('polish P5 route: the caller\'s connected Google accounts (google_grants) make their mail "You" in Other, with no extra Gmail call; another user\'s grant does not', async () => {
  fresh({ google_grants: [{ id: 'g-j2', user_id: JACK, google_email: 'jack.personal@gmail.invalid' }, { id: 'g-p2', user_id: PETE, google_email: 'ana@newbrand.invalid' }] });
  mailboxes['tok-jack'] = [...JACK_MAIL(), thread('th-self', [msg('m-s1', 'th-self', { from: 'Jack Carlson <jack.personal@gmail.invalid>', subject: 'tteset', labels: ['INBOX'] })]),
    thread('th-cal', [msg('m-c1', 'th-cal', { from: 'Jack Carlson <jack.personal@gmail.invalid>', subject: 'Updated invitation: placeholder - HumanKind x Timmy', labels: ['INBOX'] })])];
  const r = await call(R.listThreadsRoute, reqOf({ query: { tab: 'inbox' } }));
  const by = Object.fromEntries(r.body.threads.map(t => [t.thread_id, t]));
  assert.deepEqual([by['th-self'].chip, by['th-self'].lane], [{ kind: 'self' }, 'other']);
  assert.deepEqual([by['th-cal'].chip, by['th-cal'].lane], [{ kind: 'calendar' }, 'other']);
  assert.deepEqual([by['th-new'].chip.kind, by['th-new'].lane], ['untracked', 'needs_you'], 'Pete\'s grant is not Jack\'s self');
  assert.equal(r.body.gmail_calls, 1 + r.body.threads.length, 'one list + one metadata get per row, nothing more');
  assert.ok(!JSON.stringify(r.body).includes('@'));
  mailboxes['tok-jack'] = JACK_MAIL();
});

test('polish P3: a summary stored with entities before Stage 2 reads decoded - on the brand card and through replyRow (the Replies screen)', async () => {
  fresh();
  const r1 = sb.db.hk_replies.find(r => r.id === 'r1');
  r1.summary = 'What&#39;s your favorite fall physique destroyer? Tom &amp; Jerry';
  sb.db.hk_brands.find(b => b.id === ID.yoga).challenge_idea = 'Mat &amp; mind week';
  const open = await call(R.openThreadRoute, reqOf({ params: { id: 'th-tracked' } }));
  assert.equal(open.body.brand.last_reply_summary, 'What\'s your favorite fall physique destroyer? Tom & Jerry');
  assert.equal(open.body.brand.challenge_idea, 'Mat & mind week');
  const { replyRow } = await import('./hkShared.js');
  assert.equal(replyRow(r1).summary, 'What\'s your favorite fall physique destroyer? Tom & Jerry');
  assert.equal(r1.summary.includes('&#39;'), true, 'the stored row is untouched by reading (the backfill rewrites it)');
});
