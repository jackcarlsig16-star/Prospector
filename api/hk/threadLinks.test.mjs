// node --test api/hk/threadLinks.test.mjs - grow-mailbox-link-v1 Stage 2 on the in-memory Supabase with a fake Gmail
// and a stubbed Claude (0 network, 0 real Gmail, 0 real Claude): the L1 match rules, the facts, the capped resumable
// backfill, the hourly upkeep, the capped thread reads (switch, first-pass allowance, daily caps), derived-only storage,
// and what each member may see (sharing off = existence only; Open in Gmail = own mailbox only). Invented names.
import test from 'node:test';
import assert from 'node:assert/strict';
process.env.GOOGLE_TOKEN_KEY ||= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const { fakeSupabase } = await import('../sales/testing/fakeSupabase.mjs');
const { buildMatcher, threadFacts, messagesOf, linkSyncedMessages, autoOk } = await import('./threadLinks.js');
const { backfillMailbox, backfillQueries, BACKFILL_UNITS_MAX } = await import('./threadBackfill.js');
const { readThreads, parseFacts, ownWords, FIRST_PASS_USD, DAILY_USD } = await import('./threadRead.js');
const { threadView, brandThreadsRoute, emailLinksRoute, decideEmailLinkRoute, linkThreadRoute } = await import('./threadRoutes.js');
const { GmailError } = await import('./gmailClient.js');

const HK = 'biz-hk', JACK = 'u-jack', PETE = 'u-pete';
const NOW = new Date('2026-11-02T16:00:00Z');
const daysAgo = n => new Date(NOW.getTime() - n * 864e5).toISOString();
const brand = (id, name, over = {}) => ({ id, business_id: HK, name, aliases: [], domain: null, domain_suggested: null, domain_confidence: null, archived_at: null, ...over });
const BRANDS = [
  brand('b-oat', 'Zz Oat Co', { domain: 'zzoat.invalid' }),
  brand('b-fizz', 'Zz Fizz Lab', { domain_suggested: 'zzfizz.invalid', domain_confidence: 'high' }),
  brand('b-low', 'Zz Lowconf', { domain_suggested: 'zzlow.invalid', domain_confidence: 'medium' }),
  brand('b-gen', 'Zz Gmail Brand', { domain: 'gmail.com' }),
  brand('b-moss', 'Zz Moss Studio'),
  brand('b-old', 'Zz Archived', { domain: 'zzold.invalid', archived_at: daysAgo(30) }),
  brand('b-word', 'Enterprise'),
];
const CONTACTS = [{ business_id: HK, brand_id: 'b-moss', email: 'mo@gmail.com' }];
const hdrs = o => Object.entries(o).filter(([, v]) => v).map(([name, value]) => ({ name, value }));
const msg = (from, to, date, extra = {}) => ({ id: `m-${Math.random()}`, internalDate: String(Date.parse(date)), payload: { headers: hdrs({ From: from, To: to, Date: new Date(date).toUTCString(), ...extra }) } });
const seed = (over = {}) => fakeSupabase({
  hk_brands: BRANDS, hk_contacts: CONTACTS, hk_ignored_senders: [{ business_id: HK, domain: 'zzignored.invalid' }],
  hk_settings: [{ business_id: HK, timezone: 'America/Chicago', read_deal_emails: true }],
  hk_member_prefs: [{ business_id: HK, user_id: JACK, share_deal_status: true }, { business_id: HK, user_id: PETE, share_deal_status: false }],
  business_members: [{ business_id: HK, user_id: JACK, name: 'Jack Example' }, { business_id: HK, user_id: PETE, name: 'Pete Example' }],
  hk_brand_threads: [], hk_job_runs: [], hk_events: [], business_anthropic_usage: [],
  ...over,
});
const noStoredText = rows => { for (const r of rows) { assert.ok(!('subject' in r) && !('body' in r) && !('snippet' in r), 'no subject / body / snippet column'); assert.ok(!JSON.stringify(r).includes('@'), `no address stored: ${JSON.stringify(r)}`); } };
const grant = uid => ({ id: `g-${uid}`, google_email: uid === JACK ? 'jack@humankindcollective.app' : 'pete@humankindcollective.app' });
const mailbox = async (b, uid) => ({ grant: grant(uid), state: 'ok' });

test('L1 match rules: contact > domain > high-confidence suggested; generic domains never by domain (a contact on one still counts); team / own / ignored / archived never; a name in the subject alone is review only; generic words never match', () => {
  const m = buildMatcher({ brands: BRANDS, contacts: CONTACTS, ignored: ['zzignored.invalid'], ownDomains: ['humankindcollective.app'] });
  const p = e => ({ email: e, domain: e.split('@')[1] });
  assert.deepEqual(m.match([p('ana@zzoat.invalid')]), { brand_id: 'b-oat', matched_by: 'domain', link_state: 'linked' });
  assert.deepEqual(m.match([p('mo@gmail.com')]), { brand_id: 'b-moss', matched_by: 'contact', link_state: 'linked' });
  assert.equal(m.match([p('someone@gmail.com')]), null, 'gmail.com never matches by domain');
  assert.deepEqual(m.match([p('x@zzfizz.invalid')]), { brand_id: 'b-fizz', matched_by: 'suggested_domain', link_state: 'linked' });
  assert.equal(m.match([p('x@zzlow.invalid')]), null, 'medium-confidence suggestion never matches');
  assert.equal(m.match([p('x@zzold.invalid')]), null, 'archived brand');
  assert.equal(m.match([p('x@zzignored.invalid'), p('jack@humankindcollective.app')]), null, 'ignored + own');
  assert.deepEqual(m.match([p('x@else.invalid')], 'Re: Zz Moss Studio x HumanKind'), { brand_id: 'b-moss', matched_by: 'name', link_state: 'review' });
  assert.equal(m.match([p('x@else.invalid')], 'Enterprise plan renewal'), null, 'a generic word is not a brand name');
  assert.ok(!autoOk({ matched_by: 'suggested_domain', link_state: 'linked' }) && !autoOk({ matched_by: 'name', link_state: 'review' }) && autoOk({ matched_by: 'domain', link_state: 'linked' }));
  assert.deepEqual(m.queries.domains.sort(), ['zzoat.invalid']); assert.deepEqual(m.queries.suggested, ['zzfizz.invalid']);
  for (const q of backfillQueries(Array.from({ length: 200 }, (_, i) => `zzbrand${i}.invalid`))) assert.ok(q.length <= 1200 && q.startsWith('newer_than:180d {from:('));
});

test('facts: counts, first / last, ours / theirs, waiting_on from the newest message', () => {
  const ms = messagesOf({ messages: [msg('Jack <jack@humankindcollective.app>', 'ana@zzoat.invalid', daysAgo(5)), msg('Ana <ana@zzoat.invalid>', 'jack@humankindcollective.app', daysAgo(3))] });
  const f = threadFacts(ms, { ownEmails: ['jack@humankindcollective.app'] });
  assert.equal(f.message_count, 2); assert.equal(f.waiting_on, 'us'); assert.equal(f.first_at, daysAgo(5).replace(/\.\d+Z$/, '.000Z'));
  assert.equal(threadFacts(ms.slice(0, 1), { ownEmails: ['jack@humankindcollective.app'] }).waiting_on, 'them');
});

// A fake Gmail: threads by id; listThreads pages through ids; optional failure on a given call.
function fakeGmail(threads, { pages = 1, failOnList = null } = {}) {
  const calls = [];
  const ids = Object.keys(threads);
  let listN = 0;
  return {
    calls,
    listThreads: async (token, { q, pageToken }) => {
      listN++; calls.push(['list', token, q, pageToken]);
      if (failOnList === listN) throw new GmailError(429, 'rate limited', 'rateLimitExceeded');
      if (!q.includes('zzoat') && !q.includes('mo@gmail.com') && !q.includes('zzfizz')) return { threads: [] };
      const per = Math.ceil(ids.length / pages), i = pageToken ? Number(pageToken) : 0;
      return { threads: ids.slice(i * per, (i + 1) * per).map(id => ({ id })), nextPageToken: i + 1 < pages ? String(i + 1) : undefined };
    },
    getThreadPeople: async (token, id) => { calls.push(['get', token, id]); return threads[id]; },
    getThreadFull: async (token, id) => { calls.push(['full', token, id]); return threads[id]; },
  };
}
const THREADS = {
  t1: { messages: [msg('Jack <jack@humankindcollective.app>', 'Ana <ana@zzoat.invalid>', daysAgo(10), { Subject: 'Zz Oat Co x HumanKind' }), msg('Ana <ana@zzoat.invalid>', 'jack@humankindcollective.app', daysAgo(2))] },
  t2: { messages: [msg('Mo <mo@gmail.com>', 'jack@humankindcollective.app', daysAgo(20))] },
  t3: { messages: [msg('Pat <pat@else.invalid>', 'jack@humankindcollective.app', daysAgo(4), { Subject: 'Zz Moss Studio question' })] },
  t4: { messages: [msg('Fi <fi@zzfizz.invalid>', 'jack@humankindcollective.app', daysAgo(1))] },
  t5: { messages: [msg('GHOST <news@zzoat.invalid>', 'jack@humankindcollective.app', daysAgo(3), { 'List-Unsubscribe': '<https://zzoat.invalid/u>' })] },
  t6: { messages: [{ ...msg('Deals <deals@zzoat.invalid>', 'jack@humankindcollective.app', daysAgo(2)), labelIds: ['INBOX', 'CATEGORY_UPDATES'] }] },
};

test('backfill: own grant only, links domain / contact / suggested threads with derived facts, never a name-only one; resumable after a Gmail 429 from the saved page; done once; unit cap stops it', async () => {
  const sb = seed(), gmail = fakeGmail(THREADS, { pages: 2, failOnList: 2 });
  const tokensUsed = [];
  const d = { supabase: sb, gmail, mailbox, tokenForGrant: async g => { tokensUsed.push(g.id); return `tok-${g.id}`; }, now: () => NOW, sleep: async () => {} };
  const r1 = await backfillMailbox({ businessId: HK, memberId: JACK, d });
  assert.equal(r1.run.status, 'partial'); assert.equal(r1.counts.stopped, 'gmail busy'); assert.ok(r1.counts.cursor.page, 'cursor keeps the page');
  const r2 = await backfillMailbox({ businessId: HK, memberId: JACK, d: { ...d, gmail: fakeGmail(THREADS, { pages: 2 }) } });
  assert.equal(r2.counts.done, true, JSON.stringify(r2.counts));
  assert.deepEqual(new Set(tokensUsed), new Set([`g-${JACK}`]));
  const rows = sb.db.hk_brand_threads;
  assert.deepEqual(rows.map(r => [r.gmail_thread_id, r.brand_id, r.matched_by]).sort(), [['t1', 'b-oat', 'domain'], ['t2', 'b-moss', 'contact'], ['t4', 'b-fizz', 'suggested_domain']]);
  assert.deepEqual(rows.find(r => r.gmail_thread_id === 't1').waiting_on, 'us');
  assert.equal(rows.find(r => r.gmail_thread_id === 't2').waiting_on, 'none', 'only they wrote');
  assert.ok(!rows.some(r => r.gmail_thread_id === 't5' || r.gmail_thread_id === 't6'), 'bulk threads (List-Unsubscribe, Updates) never link');
  assert.equal(r2.counts.bulk + (r1.counts.bulk || 0), 2);
  noStoredText(rows);
  assert.deepEqual(await backfillMailbox({ businessId: HK, memberId: JACK, d }), { skipped: 'done' });
  const sb2 = seed({ hk_job_runs: [{ id: 'r0', business_id: HK, job: 'thread-backfill', status: 'ok', chicago_day: '2026-11-01', started_at: daysAgo(1), counts: { member: JACK, units: BACKFILL_UNITS_MAX - 15 } }] });
  const capped = await backfillMailbox({ businessId: HK, memberId: JACK, d: { ...d, supabase: sb2, gmail: fakeGmail(THREADS) } });
  assert.deepEqual([capped.counts.stopped, capped.counts.done, sb2.db.hk_brand_threads.length], ['unit cap', true, 0]);
  assert.deepEqual(await backfillMailbox({ businessId: HK, memberId: PETE, d: { ...d, mailbox: async () => null } }), { skipped: 'no_mailbox' });
  const sb3 = seed(), odd = { ...THREADS, t7: { messages: [{ payload: { headers: [{ name: 'From', value: '<lee@zzoat.invalid>' }, { name: 'Date', value: new Date(daysAgo(1)).toUTCString() }] } }, { payload: null }] } };
  const r3 = await backfillMailbox({ businessId: HK, memberId: JACK, d: { ...d, supabase: sb3, gmail: fakeGmail(odd) } });
  assert.equal(r3.counts.done, true, 'an odd thread never stops the run'); assert.ok(sb3.db.hk_brand_threads.some(x => x.gmail_thread_id === 't7'), 'a bare <address> From links');
});

test('hourly upkeep (L4): nothing until the workspace started linking; then a linked thread moves forward and a new matching thread links (name-only -> review)', async () => {
  const sb = seed({ hk_brand_threads: [{ id: 'x1', business_id: HK, brand_id: 'b-oat', member_user_id: JACK, gmail_thread_id: 't1', matched_by: 'domain', link_state: 'linked', message_count: 2, last_at: daysAgo(5), last_ours_at: daysAgo(5), waiting_on: 'them' }] });
  const msgs = [
    { threadId: 't1', date: daysAgo(1), from: { email: 'ana@zzoat.invalid', domain: 'zzoat.invalid' }, people: [{ email: 'ana@zzoat.invalid', domain: 'zzoat.invalid' }] },
    { threadId: 't9', date: daysAgo(1), from: { email: 'pat@else.invalid', domain: 'else.invalid' }, people: [{ email: 'pat@else.invalid', domain: 'else.invalid' }], subject: 'Zz Moss Studio sponsorship' },
    { threadId: 't8', date: daysAgo(1), from: { email: 'jack@humankindcollective.app', domain: 'humankindcollective.app' }, people: [{ email: 'jack@humankindcollective.app', domain: 'humankindcollective.app' }, { email: 'bo@zzoat.invalid', domain: 'zzoat.invalid' }] },
  ];
  const args = { supabase: sb, businessId: HK, uid: JACK, messages: msgs, ownEmails: ['jack@humankindcollective.app'], ownDomains: ['humankindcollective.app'], now: NOW };
  assert.deepEqual(await linkSyncedMessages(args), { updated: 0, linked: 0, review: 0 });
  sb.db.hk_job_runs.push({ id: 'bf', business_id: HK, job: 'thread-backfill', status: 'ok', chicago_day: '2026-11-01', started_at: daysAgo(1), counts: { member: JACK } });
  assert.deepEqual(await linkSyncedMessages(args), { updated: 1, linked: 1, review: 1 });
  const t1 = sb.db.hk_brand_threads.find(r => r.gmail_thread_id === 't1');
  assert.deepEqual([t1.message_count, t1.waiting_on], [3, 'us']);
  assert.deepEqual(sb.db.hk_brand_threads.find(r => r.gmail_thread_id === 't9').link_state, 'review');
  assert.deepEqual(sb.db.hk_brand_threads.find(r => r.gmail_thread_id === 't8').waiting_on, 'them');
  const bulkMsgs = [
    { threadId: 'tb1', date: daysAgo(1), from: { email: 'news@zzoat.invalid', domain: 'zzoat.invalid' }, people: [{ email: 'news@zzoat.invalid', domain: 'zzoat.invalid' }], listUnsubscribe: true },
    { threadId: 'tb2', date: daysAgo(1), from: { email: 'deals@zzoat.invalid', domain: 'zzoat.invalid' }, people: [{ email: 'deals@zzoat.invalid', domain: 'zzoat.invalid' }], labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'] },
    { threadId: 'tb3', date: daysAgo(1), from: { email: 'bo@zzoat.invalid', domain: 'zzoat.invalid' }, people: [{ email: 'bo@zzoat.invalid', domain: 'zzoat.invalid' }], labelIds: ['INBOX'] },
  ];
  assert.deepEqual(await linkSyncedMessages({ ...args, messages: bulkMsgs }), { updated: 0, linked: 1, review: 0 }, 'bulk mail (List-Unsubscribe / Promotions) never links');
  assert.equal(sb.db.hk_brand_threads.find(r => r.gmail_thread_id === 'tb3').waiting_on, 'none', 'only they wrote -> none until read');
  noStoredText(sb.db.hk_brand_threads);
});

test('thread reads (L5): off switch and "not started" skip; only auto-ok linked threads within 60 days whose count moved; own grant; derived fields only; first pass may spend $3, later days $2, 60 a day', async () => {
  const row = (id, over = {}) => ({ id, business_id: HK, brand_id: 'b-oat', member_user_id: JACK, gmail_thread_id: id, matched_by: 'domain', link_state: 'linked', message_count: 2, read_message_count: null, last_at: daysAgo(2), waiting_on: 'us', ...over });
  const base = () => seed({ hk_brand_threads: [row('t1'), row('t4', { matched_by: 'suggested_domain', brand_id: 'b-fizz' }), row('t3', { matched_by: 'name', link_state: 'review' }), row('t5', { last_at: daysAgo(90) }), row('t6', { read_message_count: 2 })],
    hk_job_runs: [{ id: 'bf', business_id: HK, job: 'thread-backfill', status: 'ok', chicago_day: '2026-11-01', started_at: daysAgo(1), counts: { member: JACK } }] });
  const claude = [];
  const call = async a => { claude.push(a); return { content: [{ type: 'text', text: '{"deal_stage":"discussing","deal_month":"2026-12","deal_amount_usd":150,"our_question_open":true,"waiting_on":"us","summary":"Wants December, asked about logo placement. Call ana@zzoat.invalid"}' }], usage: { input_tokens: 2000, output_tokens: 120 } }; };
  const threads = { t1: { messages: [{ payload: { headers: hdrs({ From: 'Ana <ana@zzoat.invalid>', Date: new Date(daysAgo(2)).toUTCString() }), mimeType: 'text/plain', body: { data: Buffer.from('December works for us at $150.\n\nOn Mon, Jack wrote:\n> old text').toString('base64url') } } }] } };
  const d = sb => ({ supabase: sb, gmail: fakeGmail(threads), mailbox, tokenForGrant: async g => `tok-${g.id}`, call, now: () => NOW });
  const off = base(); off.db.hk_settings[0].read_deal_emails = false;
  assert.deepEqual(await readThreads({ businessId: HK, d: d(off) }), { skipped: 'off' });
  const notStarted = base(); notStarted.db.hk_job_runs = [];
  assert.deepEqual(await readThreads({ businessId: HK, d: d(notStarted) }), { skipped: 'not started' });
  const sb = base();
  const r = await readThreads({ businessId: HK, trigger: 'cron', d: d(sb) });
  assert.deepEqual([r.counts.queued, r.counts.read, r.counts.first_pass], [1, 1, true], JSON.stringify(r.counts));
  assert.equal(claude.length, 1); assert.equal(claude[0].max_tokens, 400); assert.ok(!claude[0].tools, 'no web search'); assert.equal(claude[0].callType, 'hk_thread_read');
  assert.ok(!claude[0].messages[0].content.includes('@') && !claude[0].messages[0].content.includes('old text'), 'scrubbed, quoted history cut');
  const t1 = sb.db.hk_brand_threads.find(x => x.id === 't1');
  assert.deepEqual([t1.deal_stage, t1.deal_month, t1.deal_amount_usd, t1.our_question_open, t1.read_message_count], ['discussing', '2026-12', 150, true, 2]);
  noStoredText(sb.db.hk_brand_threads);
  assert.equal(sb.db.hk_job_runs.find(x => x.job === 'thread-read').cron_slot, '2026-11-02 10');
  const capRun = (day, cost, calls = 1) => ({ id: `r-${day}-${cost}`, business_id: HK, job: 'thread-read', status: 'ok', chicago_day: day, started_at: NOW.toISOString(), counts: { calls, cost_usd: cost } });
  const first = base(); first.db.hk_job_runs.push(capRun('2026-11-02', DAILY_USD + 0.5));
  assert.equal((await readThreads({ businessId: HK, d: d(first) })).counts.read, 1, 'first pass: $2.50 spent is under the one-time $3.00');
  const later = base(); later.db.hk_job_runs.push(capRun('2026-11-01', 1), capRun('2026-11-02', DAILY_USD + 0.5));
  assert.deepEqual(await readThreads({ businessId: HK, d: d(later) }), { skipped: 'dollar cap reached' });
  const full = base(); full.db.hk_job_runs.push(capRun('2026-11-02', 0.5, 60));
  assert.deepEqual(await readThreads({ businessId: HK, d: d(full) }), { skipped: 'daily count reached' });
  assert.ok(FIRST_PASS_USD === 3 && DAILY_USD === 2);
  assert.match(claude[0].system, /"interested" ONLY when Them wrote/);
  // Our outreach only (no Them turn): a model answer of "interested" is stored as other / "No reply yet." (ruling 2).
  const ours = base(); const ourThread = { t1: { messages: [{ payload: { headers: hdrs({ From: 'Jack <jack@humankindcollective.app>', Date: new Date(daysAgo(3)).toUTCString() }), mimeType: 'text/plain', body: { data: Buffer.from('Would you like to sponsor a challenge?').toString('base64url') } } }] } };
  await readThreads({ businessId: HK, d: { ...d(ours), gmail: fakeGmail(ourThread), call: async () => ({ content: [{ type: 'text', text: '{"deal_stage":"interested","waiting_on":"them","summary":"Pitched a challenge"}' }], usage: { input_tokens: 500, output_tokens: 40 } }) } });
  const o1 = ours.db.hk_brand_threads.find(x => x.id === 't1');
  assert.deepEqual([o1.deal_stage, o1.summary], ['other', 'No reply yet.']);
});

test('parse + own words: unknown values dropped, the summary address / phone is scrubbed, quoted history / signature cut', () => {
  assert.deepEqual(parseFacts('{"deal_stage":"maybe","deal_month":"2026-13","deal_amount_usd":-4,"waiting_on":"x","summary":"call 312-555-0100 or ana@zzoat.invalid"}'), { deal_stage: null, deal_month: null, deal_amount_usd: null, our_question_open: false, waiting_on: null, summary: 'call [number removed] or [email removed]' });
  assert.equal(parseFacts('not json').summary, null);
  assert.equal(ownWords('Yes please!\n--\nAna\nana@zzoat.invalid'), 'Yes please!');
  assert.equal(ownWords('Sounds good\n> earlier\nmore'), 'Sounds good\nmore');
});

test('views: the mailbox owner sees everything + Open in Gmail; teammates see it in full only while sharing is on (Pete: off -> existence + founder + date); Review links; Link / Not this brand; manual link on the caller\'s own mailbox', async () => {
  const sb = seed({ hk_brand_threads: [
    { id: 'j1', business_id: HK, brand_id: 'b-oat', member_user_id: JACK, gmail_thread_id: 'aa11', matched_by: 'domain', link_state: 'linked', message_count: 3, last_at: daysAgo(1), last_theirs_at: daysAgo(1), waiting_on: 'us', deal_stage: 'discussing', summary: 'Wants December' },
    { id: 'p1', business_id: HK, brand_id: 'b-oat', member_user_id: PETE, gmail_thread_id: 'bb22', matched_by: 'domain', link_state: 'linked', message_count: 5, last_at: daysAgo(2), waiting_on: 'them', deal_stage: 'confirmed', summary: 'Confirmed November' },
    { id: 'n1', business_id: HK, brand_id: 'b-moss', member_user_id: JACK, gmail_thread_id: 'cc33', matched_by: 'name', link_state: 'review', message_count: 1, last_at: daysAgo(3), waiting_on: 'us' },
  ] });
  const res = () => { const o = { code: 200 }; const r = { status(c) { o.code = c; return r; }, json(b) { o.body = b; return r; } }; return [r, o]; };
  const req = (uid, extra = {}) => ({ params: { businessId: HK, id: 'b-oat', ...(extra.params || {}) }, body: extra.body || {}, auth: { user: { id: uid } } });
  let [r, o] = res(); await brandThreadsRoute(req(JACK), r, { supabase: sb, now: () => NOW });
  const jackSees = Object.fromEntries(o.body.threads.map(t => [t.id, t]));
  assert.equal(jackSees.j1.gmail_thread_id, 'aa11'); assert.equal(jackSees.j1.summary, 'Wants December'); assert.equal(jackSees.j1.waiting_days, 1);
  assert.deepEqual(Object.keys(jackSees.p1).sort(), ['brand_id', 'id', 'last_at', 'link_state', 'matched_by', 'member_user_id', 'needs_confirm', 'own', 'shared', 'who'].sort(), 'Pete shares nothing: existence + founder + date');
  assert.equal(jackSees.p1.who, 'Pete');
  [r, o] = res(); await brandThreadsRoute(req(PETE), r, { supabase: sb, now: () => NOW });
  const peteSees = Object.fromEntries(o.body.threads.map(t => [t.id, t]));
  assert.equal(peteSees.j1.summary, 'Wants December', 'Jack shares'); assert.equal(peteSees.j1.gmail_thread_id, undefined, 'Open in Gmail is own-mailbox only');
  assert.equal(peteSees.p1.gmail_thread_id, 'bb22');
  [r, o] = res(); await emailLinksRoute(req(JACK), r, { supabase: sb, now: () => NOW });
  assert.deepEqual(o.body.links.map(l => [l.id, l.brand_name, l.needs_confirm]), [['n1', 'Zz Moss Studio', true]]);
  [r, o] = res(); await decideEmailLinkRoute(req(JACK, { params: { id: 'n1' }, body: { decision: 'link' } }), r, { supabase: sb, now: () => NOW });
  assert.deepEqual(['linked', 'manual'], [sb.db.hk_brand_threads.find(x => x.id === 'n1').link_state, sb.db.hk_brand_threads.find(x => x.id === 'n1').matched_by]);
  [r, o] = res(); await decideEmailLinkRoute(req(JACK, { params: { id: 'j1' }, body: { decision: 'not_this_brand' } }), r, { supabase: sb, now: () => NOW });
  assert.equal(sb.db.hk_brand_threads.find(x => x.id === 'j1').link_state, 'not_this_brand');
  [r, o] = res(); await decideEmailLinkRoute(req(JACK, { params: { id: 'j1' }, body: { decision: 'maybe' } }), r, { supabase: sb });
  assert.equal(o.code, 400);
  assert.ok(sb.db.hk_events.every(e => !JSON.stringify(e.detail).includes('@')));
  const gm = fakeGmail({ dd44ee55: THREADS.t1 }), tokens = [];
  [r, o] = res(); await linkThreadRoute(req(JACK, { body: { gmail_thread_id: 'dd44ee55', brand_id: 'b-oat' } }), r, { supabase: sb, gmail: gm, mailbox, tokenFor: async (rq, rs, b, purpose) => { tokens.push([rq.auth.user.id, purpose]); return 'tok-own'; }, now: () => NOW });
  assert.equal(o.code, 200, JSON.stringify(o.body)); assert.deepEqual(tokens, [[JACK, 'inbox']]); assert.deepEqual(gm.calls, [['get', 'tok-own', 'dd44ee55']]);
  assert.deepEqual([o.body.thread.matched_by, o.body.thread.message_count, o.body.thread.gmail_thread_id], ['manual', 2, 'dd44ee55']);
  noStoredText(sb.db.hk_brand_threads);
  [r, o] = res(); await linkThreadRoute(req(JACK, { body: { gmail_thread_id: 'ee55ff66', brand_id: 'b-oat' } }), r, { supabase: sb, gmail: fakeGmail({ ee55ff66: THREADS.t5 }), mailbox, tokenFor: async () => 'tok-own', now: () => NOW });
  assert.equal(o.code, 409, 'a manual link of bulk mail is refused');
  assert.deepEqual(threadView({ member_user_id: PETE, matched_by: 'domain', link_state: 'linked' }, { meId: JACK, sharing: new Map([[PETE, false]]) }).shared, false);
});
