// node --test api/hk/gmailRoutes.test.mjs
// hkos-gmail-connect-v1 Stage 2 - drafts, discard, sync, replies and status against the in-memory Supabase and a fake
// Gmail (recorded calls, canned responses). Invented brands and people; addresses only on example.invalid; the one
// contact address and the one reply address must never serialize. 0 network, 0 Claude, 0 Gmail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
process.env.GOOGLE_TOKEN_KEY ||= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const { fakeSupabase } = await import('../sales/testing/fakeSupabase.mjs');
const G = await import('../lib/googleGrants.js');
const R = await import('./gmailRoutes.js');
const { checkBrandsRoute } = await import('./brandsRoutes.js');
const { GmailError } = await import('./gmailClient.js');

const HK = 'biz-hk', JACK = 'u-jack', PETE = 'u-pete';
const B = { yoga: randomUUID(), juice: randomUUID(), cafe: randomUUID() };
const CONTACT_ADDRESS = 'ana@harboryoga.invalid', REPLY_ADDRESS = 'ana@harboryoga.invalid';
const MAILBOX = 'verify.work@humankind.invalid';
const NOW = new Date('2026-10-26T20:00:00Z');
const GOOD_BODY = `Hi Ana - hope the week is going well.\n\nI'm Jack, co-founder of HumanKind, a free community wellness platform launched in Chicago in April. We're at 1,500+ members and 6,000+ verified challenge completions.\n\nYou can check out the community here: https://humankindcollective.app\n\nHarbor Yoga is a natural fit: a "mat time" challenge with a class pass as the reward.\n\nEvery completion is verified, so you're driving real behavior, not clicks.\n\nWorth a 15-minute call to see if it makes sense?\n\nThanks,\nJack`;
const SUBJECT = 'HumanKind x Harbor Yoga - a mat-time challenge';
const decode = raw => Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

const brand = (id, name, over = {}) => ({ id, business_id: HK, name, normalized_name: name.toLowerCase(), aliases: [], segment: 'sponsor_brand', status: 'candidate', relationship: 'prospect', owner_user_id: null, owner_unclear: false, source: 'user_supplied', created_at: '2026-10-01T00:00:00Z', ...over });
let sb, gmail, calls, grant, mailboxState;
const fakeGmail = (canned = {}) => {
  calls = [];
  const rec = (name, ret) => async (...a) => { calls.push([name, ...a.slice(1)]); const v = typeof ret === 'function' ? ret(...a) : ret; if (v instanceof Error) throw v; return v; };
  return {
    createDraft: rec('createDraft', (t, { raw, threadId }) => ({ id: 'draft-1', message: { id: 'dmsg-1', threadId: threadId || 'th-new' } })),
    deleteDraft: rec('deleteDraft', canned.deleteDraft ?? null),
    listDrafts: rec('listDrafts', canned.listDrafts ?? []),
    getMessage: rec('getMessage', canned.getMessage ?? ((t, id) => ({ id, threadId: 'th-1', labelIds: ['SENT'], payload: { headers: [{ name: 'Message-ID', value: `<${id}@mail.invalid>` }, { name: 'Date', value: 'Mon, 26 Oct 2026 10:00:00 -0500' }] } }))),
    getThread: rec('getThread', canned.getThread ?? { messages: [] }),
    listHistory: rec('listHistory', canned.listHistory ?? { history: [], historyId: '900' }),
    getProfile: rec('getProfile', canned.getProfile ?? { historyId: '1000', emailAddress: MAILBOX }),
    searchMessages: rec('searchMessages', canned.searchMessages ?? { messages: [] }),
  };
};
const fresh = (seed = {}, canned = {}) => {
  sb = fakeSupabase({
    hk_brands: [brand(B.yoga, 'Harbor Yoga', { domain: 'harboryoga.invalid', niche: 'yoga' }), brand(B.juice, 'Northwind Juice', { relationship: 'sponsor', status: 'sponsor' }), brand(B.cafe, 'Copperleaf Cafe', { owner_user_id: PETE, status: 'claimed' })],
    hk_contacts: [{ id: 'c-ana', business_id: HK, brand_id: B.yoga, name: 'Ana Example', title: 'Owner', email: CONTACT_ADDRESS, is_primary: true, created_at: '2026-10-02T00:00:00Z' }],
    hk_touches: [], hk_replies: [], hk_events: [], hk_sync_runs: [], hk_gmail_sync_state: [],
    hk_settings: [{ business_id: HK, members_stat: 1500, completions_stat: 6000, subject_format: 'HumanKind x [Brand] - [descriptor]', banned_phrases: ['synergies'], bump_after_days: 5, final_after_days: 14, max_email_touches: 3 }],
    hk_member_prefs: [{ business_id: HK, user_id: JACK, avatar_slot: 1, owner_filter: 'me', signature_text: 'Jack\nCo-founder, HumanKind' }],
    accounts: [], projects: [], prospects: [], ...seed,
  }, { now: () => NOW.getTime(), unique: { hk_replies: r => `${r.business_id}:${r.gmail_message_id}` } });
  gmail = fakeGmail(canned);
  grant = { id: 'grant-1', google_email: MAILBOX, features: ['gmail'], error: null };
  mailboxState = 'ok';
};
const deps = (over = {}) => ({ supabase: sb, gmail, now: () => NOW, mailbox: async () => (mailboxState === 'none' ? null : { grant: { ...grant, error: mailboxState === 'needs_reconnect' ? 'needs_reconnect' : null }, tether: { purposes: ['drafts', 'inbox'] }, state: mailboxState }), tokenFor: async (req, res) => { if (mailboxState === 'none') { res.status(409).json({ error: 'link', needs_mailbox: 'drafts' }); return null; } return 'tok'; }, tokenForGrant: async () => 'tok', flag: async id => { grant.error = 'needs_reconnect'; flagged.push(id); }, call: async () => ({ content: [{ type: 'text', text: '{"label":"interested","summary":"Wants a call next week"}' }] }), ...over });
let flagged = [];
const reqOf = ({ method = 'POST', params = {}, query = {}, body = {}, user = JACK, role = 'member' } = {}) => ({ method, params: { businessId: HK, ...params }, query, body, auth: { user: { id: user, name: 'T' }, isPlatformOwner: false, roles: new Map([[HK, role]]) } });
const call = async (route, req, d) => { const r = { code: 200, body: null }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; await route(req, r, deps(d)); return r; };
const noAddr = v => { const s = JSON.stringify(v); return !s.includes(CONTACT_ADDRESS) && !s.includes(REPLY_ADDRESS) && !/[^\s@<>()"']+@(?!humankind\.invalid)[^\s@<>()"']+\.[a-z]{2,}/i.test(s); };

test('G3 cold draft: verdict + lint pass, To from hk_contacts server-side, signature appended, draft created, touch + brand drafted + event; the only address in the response is the caller\'s own mailbox in the URL', async () => {
  fresh(); flagged = [];
  const r = await call(R.createDraftRoute, reqOf({ body: { brand_id: B.yoga, channel: 'email', kind: 'cold', subject: SUBJECT, body_markdown: GOOD_BODY, challenge_concept: 'mat time' } }));
  assert.equal(r.code, 201, JSON.stringify(r.body));
  const create = calls.find(c => c[0] === 'createDraft');
  const mime = decode(create[1].raw);
  assert.match(mime, /^To: ana@harboryoga\.invalid\r\nSubject: HumanKind x Harbor Yoga - a mat-time challenge/);
  assert.match(mime, /Co-founder, HumanKind/);
  assert.equal(create[1].threadId, null);
  const t = sb.db.hk_touches[0];
  assert.deepEqual([t.state, t.kind, t.channel, t.gmail_draft_id, t.gmail_thread_id, t.gmail_message_id, t.lint_passed, t.created_by, t.contact_id], ['drafted', 'cold', 'email', 'draft-1', 'th-new', 'dmsg-1', true, 'user', 'c-ana']);
  const b = sb.db.hk_brands.find(x => x.id === B.yoga);
  assert.deepEqual([b.status, b.owner_user_id], ['drafted', JACK]);
  assert.equal(sb.db.hk_events.at(-1).action, 'draft_created');
  assert.ok(noAddr(sb.db.hk_events), 'no address in events');
  assert.equal(r.body.gmail_draft_url, `https://mail.google.com/mail/?authuser=${encodeURIComponent(MAILBOX)}#drafts/dmsg-1`);
  assert.ok(noAddr({ ...r.body, gmail_draft_url: null }), 'no address in the response beyond the caller\'s own URL');
  assert.ok(!JSON.stringify(r.body).includes('To:'));
  assert.ok(!calls.some(c => /send/i.test(c[0])), 'no send call');
});

test('grow-sheet-owner-respect: a draft on a brand the sheet lists as Pete\'s asks first (409, no Gmail call, nothing saved); with confirm_sheet_owner it drafts, claims and notes it; Pete\'s own hint drafts without asking', async () => {
  const members = [{ business_id: HK, user_id: JACK, name: 'Jack Example' }, { business_id: HK, user_id: PETE, name: 'Pete Example' }];
  fresh({ business_members: members }); flagged = [];
  sb.db.hk_brands.find(x => x.id === B.yoga).owner_hint = 'pete';
  const body = { brand_id: B.yoga, channel: 'email', kind: 'cold', subject: SUBJECT, body_markdown: GOOD_BODY };
  let r = await call(R.createDraftRoute, reqOf({ body }));
  assert.equal(r.code, 409);
  assert.equal(r.body.error, "The sheet lists this as Pete's. Take it anyway?");
  assert.deepEqual([r.body.sheet_owner, r.body.confirm_sheet_owner], ['Pete', true]);
  assert.deepEqual([calls.length, sb.db.hk_touches.length, sb.db.hk_events.length], [0, 0, 0]);
  assert.equal(sb.db.hk_brands.find(x => x.id === B.yoga).owner_user_id, null);
  r = await call(R.createDraftRoute, reqOf({ body: { ...body, confirm_sheet_owner: true } }));
  assert.equal(r.code, 201, JSON.stringify(r.body));
  assert.deepEqual([sb.db.hk_brands.find(x => x.id === B.yoga).owner_user_id, sb.db.hk_events.at(-1).detail.note], [JACK, "taken from Pete's sheet list"]);
  fresh({ business_members: members });
  sb.db.hk_brands.find(x => x.id === B.yoga).owner_hint = 'Pete';
  r = await call(R.createDraftRoute, reqOf({ body, user: PETE }));
  assert.equal(r.code, 201, JSON.stringify(r.body));
  assert.equal(sb.db.hk_events.at(-1).detail.note, undefined);
});

test('G3 refusals: sponsor -> 409 verdict; owned by the other founder -> 409; em dash / missing ask -> 422 problems and nothing saved; no contact email -> 409 needs_contact; omit_recipient drafts without To', async () => {
  fresh();
  let r = await call(R.createDraftRoute, reqOf({ body: { brand_id: B.juice, kind: 'cold', subject: SUBJECT, body_markdown: GOOD_BODY } }));
  assert.deepEqual([r.code, r.body.verdict.reason], [409, 'sponsor']);
  r = await call(R.createDraftRoute, reqOf({ body: { brand_id: B.cafe, kind: 'cold', subject: SUBJECT, body_markdown: GOOD_BODY } }));
  assert.deepEqual([r.code, r.body.verdict.reason], [409, 'owned_by']);
  r = await call(R.createDraftRoute, reqOf({ body: { brand_id: B.yoga, kind: 'cold', subject: SUBJECT, body_markdown: GOOD_BODY.replace('a natural fit:', 'a natural fit —').replace('Worth a 15-minute call to see if it makes sense?', 'Thoughts?') } }));
  assert.equal(r.code, 422); assert.deepEqual(r.body.problems.map(p => p.rule).sort(), ['call_ask', 'dash']);
  assert.equal(sb.db.hk_touches.length, 0); assert.ok(!calls.some(c => c[0] === 'createDraft'));
  sb.db.hk_contacts[0].email = null;
  r = await call(R.createDraftRoute, reqOf({ body: { brand_id: B.yoga, kind: 'cold', subject: SUBJECT, body_markdown: GOOD_BODY } }));
  assert.deepEqual([r.code, r.body.needs_contact], [409, true]);
  r = await call(R.createDraftRoute, reqOf({ body: { brand_id: B.yoga, kind: 'cold', subject: SUBJECT, body_markdown: GOOD_BODY, omit_recipient: true } }));
  assert.equal(r.code, 201);
  assert.ok(!/^To:/m.test(decode(calls.find(c => c[0] === 'createDraft')[1].raw)), 'no recipient');
  assert.equal(sb.db.hk_events.at(-1).detail.no_recipient, true);
});

test('G3 bump: needs a prior sent touch; threads on it with In-Reply-To from the original Message-ID and a Re: subject; ig_dm makes no Gmail call', async () => {
  fresh();
  let r = await call(R.createDraftRoute, reqOf({ body: { brand_id: B.yoga, kind: 'bump', subject: SUBJECT, body_markdown: 'Bumping this - worth 15 min this week?\n\nThanks,\nJack' } }));
  assert.deepEqual([r.code, r.body.needs_prior_touch], [409, true]);
  sb.db.hk_touches.push({ id: 't-sent', business_id: HK, brand_id: B.yoga, sender_user_id: JACK, channel: 'email', kind: 'cold', state: 'sent', gmail_thread_id: 'th-1', gmail_message_id: 'sent-1', sent_at: '2026-10-20T00:00:00Z', created_by: 'user', created_at: '2026-10-19T00:00:00Z' });
  sb.db.hk_brands.find(b => b.id === B.yoga).owner_user_id = JACK;
  r = await call(R.createDraftRoute, reqOf({ body: { brand_id: B.yoga, kind: 'bump', subject: SUBJECT, body_markdown: 'Bumping this - worth 15 min this week?\n\nThanks,\nJack' } }));
  assert.equal(r.code, 201, JSON.stringify(r.body));
  const create = calls.find(c => c[0] === 'createDraft');
  assert.equal(create[1].threadId, 'th-1');
  const mime = decode(create[1].raw);
  assert.match(mime, /Subject: Re: HumanKind x Harbor Yoga - a mat-time challenge/); assert.match(mime, /In-Reply-To: <sent-1@mail\.invalid>/);
  calls.length = 0; sb.db.hk_touches = sb.db.hk_touches.filter(t => t.state !== 'sent');
  r = await call(R.createDraftRoute, reqOf({ body: { brand_id: B.yoga, channel: 'ig_dm', kind: 'cold', body_markdown: 'Loved the latest post - HumanKind is a free Chicago wellness app and we work with creators. Interested, and what are your rates?' } }));
  assert.equal(r.code, 201, JSON.stringify(r.body));
  assert.deepEqual([calls.filter(c => c[0] === 'createDraft').length, sb.db.hk_touches.at(-1).channel, sb.db.hk_touches.at(-1).gmail_draft_id], [0, 'ig_dm', null]);
});

test('G6 warm: a sent thread by the other founder blocks a cold draft (founder + date only) and shows in brands/check; the caller\'s own live search counts too; a bump is allowed', async () => {
  fresh();
  sb.db.hk_touches.push({ id: 't-p', business_id: HK, brand_id: B.yoga, sender_user_id: PETE, channel: 'email', kind: 'cold', state: 'sent', gmail_thread_id: 'th-p', gmail_message_id: 'p-1', sent_at: '2026-10-12T00:00:00Z', created_by: 'user', created_at: '2026-10-12T00:00:00Z' });
  let r = await call(R.createDraftRoute, reqOf({ body: { brand_id: B.yoga, kind: 'cold', subject: SUBJECT, body_markdown: GOOD_BODY } }));
  assert.deepEqual([r.code, r.body.verdict.reason, r.body.verdict.founder_user_id, r.body.verdict.last_at], [409, 'warm', PETE, '2026-10-12T00:00:00Z']);
  assert.ok(!('subject' in r.body.verdict) && !JSON.stringify(r.body).includes('th-p'), 'no subject, no thread id');
  const chk = await call(checkBrandsRoute, reqOf({ body: [{ name: 'Harbor Yoga' }] }), { supabase: sb, gmail, mailbox: async () => null });
  assert.deepEqual([chk.body.results[0].verdict, chk.body.results[0].founder_user_id], ['warm', PETE]);
  sb.db.hk_touches = [];
  gmail = fakeGmail({ searchMessages: { messages: [{ id: 'live-1' }] } });
  r = await call(R.createDraftRoute, reqOf({ body: { brand_id: B.yoga, kind: 'cold', subject: SUBJECT, body_markdown: GOOD_BODY } }));
  assert.deepEqual([r.code, r.body.verdict.reason, r.body.verdict.founder_user_id], [409, 'warm', JACK], 'the caller\'s own mailbox already has a thread');
  assert.deepEqual(calls.filter(c => c[0] === 'searchMessages').map(c => c[1]), ['from:harboryoga.invalid OR to:harboryoga.invalid']);
});

test('G4 discard: Gmail DELETE /drafts/<id>, touch discarded, brand back to claimed; sender or owner-role only; preview never carries To; re-lint updates lint_passed', async () => {
  fresh();
  await call(R.createDraftRoute, reqOf({ body: { brand_id: B.yoga, kind: 'cold', subject: SUBJECT, body_markdown: GOOD_BODY } }));
  const id = sb.db.hk_touches[0].id;
  const pv = await call(R.previewDraftRoute, reqOf({ method: 'GET', params: { touchId: id } }));
  assert.ok(pv.body.touch.body_text.includes('Harbor Yoga') && !JSON.stringify(pv.body).includes(CONTACT_ADDRESS) && !('body_html' in pv.body.touch));
  sb.db.hk_touches[0].body_text = 'now with pricing: $99 per month';
  const rl = await call(R.relintDraftRoute, reqOf({ params: { touchId: id } }));
  assert.deepEqual([rl.body.lint_passed, rl.body.problems.some(p => p.rule === 'pricing'), sb.db.hk_touches[0].lint_passed], [false, true, false]);
  assert.equal((await call(R.discardDraftRoute, reqOf({ method: 'DELETE', params: { touchId: id }, user: PETE }))).code, 403);
  const r = await call(R.discardDraftRoute, reqOf({ method: 'DELETE', params: { touchId: id } }));
  assert.equal(r.code, 200);
  assert.deepEqual([calls.find(c => c[0] === 'deleteDraft')[1], sb.db.hk_touches[0].state, sb.db.hk_brands.find(b => b.id === B.yoga).status, sb.db.hk_events.at(-1).action], ['draft-1', 'discarded', 'claimed', 'draft_discarded']);
  assert.equal((await call(R.discardDraftRoute, reqOf({ method: 'DELETE', params: { touchId: id } }))).code, 409, 'already discarded');
});

test('G5 sync (incremental): a sent draft becomes sent with next due, a reply is logged + labeled (from_email stored, never returned), run + state rows, brand replied; pageload guard skips within 60 min', async () => {
  fresh({ hk_gmail_sync_state: [{ business_id: HK, user_id: JACK, grant_id: 'grant-1', history_id: '500', status: 'ok', updated_at: '2026-10-26T18:00:00Z' }] }, {
    listHistory: { history: [{ messagesAdded: [{ message: { id: 'sent-1', labelIds: ['SENT'] } }] }, { messagesAdded: [{ message: { id: 'reply-1', labelIds: ['INBOX'] } }] }, { messagesAdded: [{ message: { id: 'other-1', labelIds: ['INBOX'] } }] }], historyId: '950' },
    getMessage: (t, id) => ({ 'sent-1': { id: 'sent-1', threadId: 'th-1', labelIds: ['SENT'], snippet: 'Hi Ana', payload: { headers: [{ name: 'From', value: `Jack <${MAILBOX}>` }, { name: 'Message-ID', value: '<sent-1@mail.invalid>' }, { name: 'Date', value: 'Mon, 26 Oct 2026 09:00:00 -0500' }, { name: 'Subject', value: SUBJECT }] } },
      'reply-1': { id: 'reply-1', threadId: 'th-1', labelIds: ['INBOX'], snippet: 'Sounds great, how about Tuesday? ' + REPLY_ADDRESS, payload: { headers: [{ name: 'From', value: `Ana Example <${REPLY_ADDRESS}>` }, { name: 'Message-ID', value: '<r1@harboryoga.invalid>' }, { name: 'Date', value: 'Mon, 26 Oct 2026 11:00:00 -0500' }, { name: 'Subject', value: 'Re: ' + SUBJECT }] } },
      'other-1': { id: 'other-1', threadId: 'th-other', labelIds: ['INBOX'], snippet: 'newsletter', payload: { headers: [{ name: 'From', value: 'News <news@random.invalid>' }, { name: 'Date', value: 'Mon, 26 Oct 2026 12:00:00 -0500' }] } } }[id]),
  });
  sb.db.hk_touches.push({ id: 't1', business_id: HK, brand_id: B.yoga, sender_user_id: JACK, channel: 'email', kind: 'cold', state: 'drafted', gmail_draft_id: 'draft-1', gmail_thread_id: 'th-1', gmail_message_id: 'dmsg-1', drafted_at: '2026-10-25T00:00:00Z', created_by: 'user', created_at: '2026-10-25T00:00:00Z' });
  sb.db.hk_brands.find(b => b.id === B.yoga).status = 'drafted';
  const r = await call(R.syncRoute, reqOf({ query: { trigger: 'manual' } }));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.run.counts, { history_events: 3, sent_detected: 1, replies: 1, new_threads: 0, skipped: 1, labels_called: 1, messages_scanned: 3, full_scan: false });
  const t = sb.db.hk_touches[0]; assert.deepEqual([t.state, t.gmail_message_id, t.sent_at], ['sent', 'sent-1', '2026-10-26T14:00:00.000Z']);
  const b = sb.db.hk_brands.find(x => x.id === B.yoga); assert.deepEqual([b.status, b.next_due_at, b.last_touch_at], ['replied', null, '2026-10-26T14:00:00.000Z']);
  const rep = sb.db.hk_replies[0];
  assert.deepEqual([rep.from_name, rep.from_domain, rep.from_email, rep.label, rep.summary, rep.urgent, rep.gmail_message_id], ['Ana Example', 'harboryoga.invalid', REPLY_ADDRESS, 'interested', 'Wants a call next week', true, 'reply-1']);
  assert.deepEqual(sb.db.hk_events.map(e => e.action), ['touch_sent', 'reply_logged']);
  assert.ok(noAddr(sb.db.hk_events) && noAddr(r.body), 'no address in events or the sync response');
  assert.deepEqual([sb.db.hk_sync_runs.length, sb.db.hk_sync_runs[0].status, sb.db.hk_gmail_sync_state[0].status, sb.db.hk_gmail_sync_state[0].history_id], [1, 'ok', 'ok', '1000']);
  assert.equal(sb.db.hk_replies.length, 1, 'the newsletter was never stored');
  const again = await call(R.syncRoute, reqOf({ query: { trigger: 'pageload' } }));
  assert.match(again.body.skipped, /synced under 60 min ago/);
  assert.equal((await call(R.syncRoute, reqOf({ query: { trigger: 'manual' } }))).code, 200, 'manual always runs');
  const list = await call(R.listRepliesRoute, reqOf({ method: 'GET', query: {} }));
  assert.ok(!JSON.stringify(list.body).includes(REPLY_ADDRESS) && !JSON.stringify(list.body).includes('from_email'), 'from_email never serializes');
  assert.deepEqual([list.body.replies[0].mine, list.body.replies[0].open_url], [true, `https://mail.google.com/mail/?authuser=${encodeURIComponent(MAILBOX)}#all/reply-1`]);
  const other = await call(R.listRepliesRoute, reqOf({ method: 'GET', user: PETE }));
  assert.deepEqual([other.body.replies[0].mine, other.body.replies[0].open_url], [false, null], "another founder's reply has no Gmail link");
});

test('G5 sync: expired history (404) falls back to a tracked-thread scan; a 401 flags the grant and answers needs_reconnect; no tether -> needs_mailbox; drafted-but-still-present is not sent', async () => {
  fresh({ hk_gmail_sync_state: [{ business_id: HK, user_id: JACK, grant_id: 'grant-1', history_id: '1', status: 'ok', updated_at: '2026-10-26T18:00:00Z' }] }, {
    listHistory: new GmailError(404, 'Start history ID is too old'),
    getThread: { messages: [{ id: 'dmsg-1', threadId: 'th-1', labelIds: ['DRAFT'], payload: { headers: [] } }] },
    listDrafts: [{ id: 'draft-1' }],
  });
  sb.db.hk_touches.push({ id: 't1', business_id: HK, brand_id: B.yoga, sender_user_id: JACK, channel: 'email', kind: 'cold', state: 'drafted', gmail_draft_id: 'draft-1', gmail_thread_id: 'th-1', gmail_message_id: 'dmsg-1', created_by: 'user', created_at: '2026-10-25T00:00:00Z' });
  let r = await call(R.syncRoute, reqOf({ query: { trigger: 'manual' } }));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.run.counts.full_scan, r.body.run.counts.sent_detected, sb.db.hk_touches[0].state, !!sb.db.hk_gmail_sync_state[0].last_full_scan_at], [true, 0, 'drafted', true]);
  flagged = []; gmail = fakeGmail({ listHistory: new GmailError(401, 'Invalid Credentials') });
  r = await call(R.syncRoute, reqOf({ query: { trigger: 'manual' } }));
  assert.deepEqual([r.code, r.body.needs_reconnect, flagged, sb.db.hk_gmail_sync_state[0].status, sb.db.hk_sync_runs.at(-1).status], [409, 'grant-1', ['grant-1'], 'needs_reconnect', 'error']);
  mailboxState = 'none';
  assert.deepEqual((await call(R.syncRoute, reqOf({ query: { trigger: 'manual' } }))).body.needs_mailbox, 'drafts');
  mailboxState = 'needs_reconnect';
  assert.equal((await call(R.syncRoute, reqOf({ query: { trigger: 'manual' } }))).body.needs_reconnect, 'grant-1');
});

test('G7 cap: at 60 labels today a reply is stored as other with the snippet and no model call', async () => {
  fresh({ hk_gmail_sync_state: [{ business_id: HK, user_id: JACK, grant_id: 'grant-1', history_id: '500', status: 'ok', updated_at: '2026-10-26T18:00:00Z' }],
    hk_events: Array.from({ length: 60 }, (_, i) => ({ id: `e${i}`, business_id: HK, action: 'reply_logged', actor_kind: 'system', entity_type: 'brand', entity_id: B.yoga, detail: { labeled: true }, created_at: '2026-10-26T15:00:00Z' })) },
  { listHistory: { history: [{ messagesAdded: [{ message: { id: 'reply-2', labelIds: ['INBOX'] } }] }], historyId: '960' },
    getMessage: () => ({ id: 'reply-2', threadId: 'th-1', labelIds: ['INBOX'], snippet: 'Not right now, thanks.', payload: { headers: [{ name: 'From', value: `Ana <${REPLY_ADDRESS}>` }, { name: 'Date', value: 'Mon, 26 Oct 2026 11:00:00 -0500' }] } }) });
  sb.db.hk_touches.push({ id: 't1', business_id: HK, brand_id: B.yoga, sender_user_id: JACK, channel: 'email', kind: 'cold', state: 'sent', gmail_thread_id: 'th-1', gmail_message_id: 'sent-1', created_by: 'user', created_at: '2026-10-25T00:00:00Z' });
  let modelCalls = 0;
  const r = await call(R.syncRoute, reqOf({ query: { trigger: 'manual' } }), { call: async () => { modelCalls++; return { content: [] }; } });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual([modelCalls, sb.db.hk_replies[0].label, sb.db.hk_replies[0].summary, r.body.run.counts.labels_called], [0, 'other', 'Not right now, thanks.', 0]);
});

test('status route: mailbox state, last run, badges (drafts awaiting, replies unhandled), signature; reply patch logs an override and handled', async () => {
  fresh();
  sb.db.hk_touches.push({ id: 't1', business_id: HK, brand_id: B.yoga, sender_user_id: JACK, channel: 'email', kind: 'cold', state: 'drafted', gmail_draft_id: 'draft-1', created_by: 'user', created_at: '2026-10-25T00:00:00Z' });
  sb.db.hk_replies.push({ id: 'r1', business_id: HK, brand_id: B.yoga, touch_id: 't1', gmail_message_id: 'x', from_name: 'Ana', from_domain: 'harboryoga.invalid', from_email: REPLY_ADDRESS, received_at: '2026-10-26T00:00:00Z', label: 'other', handled: false, gmail_thread_id: 'th-x', created_at: '2026-10-26T00:00:00Z' });
  const s = await call(R.gmailStatusRoute, reqOf({ method: 'GET' }));
  assert.deepEqual([s.body.mailbox.linked, s.body.mailbox.state, s.body.mailbox.email, s.body.badges, s.body.signature_text], [true, 'ok', MAILBOX, { drafts: 1, replies: 1, tracked: 1 }, 'Jack\nCo-founder, HumanKind']);
  const p = await call(R.patchReplyRoute, reqOf({ method: 'PATCH', params: { id: 'r1' }, body: { label: 'pricing', handled: true } }));
  assert.deepEqual([p.code, p.body.reply.label, p.body.reply.handled, p.body.reply.urgent, 'from_email' in p.body.reply], [200, 'pricing', true, true, false]);
  assert.deepEqual(sb.db.hk_events.map(e => e.action), ['reply_label_override', 'reply_handled']);
  assert.deepEqual((await call(R.gmailStatusRoute, reqOf({ method: 'GET' }))).body.badges, { drafts: 1, replies: 0, tracked: 1 });
  const sig = await call(R.patchSignatureRoute, reqOf({ method: 'PATCH', body: { signature_text: 'Jack\nHumanKind' } }));
  assert.equal(sig.body.signature_text, 'Jack\nHumanKind');
  assert.equal((await call(R.patchSignatureRoute, reqOf({ method: 'PATCH', body: { signature_text: 'call 312-555-0142' } }))).code, 400);
  mailboxState = 'none';
  assert.deepEqual((await call(R.gmailStatusRoute, reqOf({ method: 'GET' }))).body.mailbox, { linked: false, state: null, email: null, purposes: [] });
});

test('composer lint preview: rules only, nothing saved, no Gmail call; em dash rejects, clean text passes', async () => {
  fresh();
  const bad = await call(R.lintPreviewRoute, reqOf({ body: { subject: SUBJECT, body_markdown: GOOD_BODY.replace(' - hope', ' — hope'), kind: 'cold', channel: 'email' } }));
  assert.equal(bad.code, 200); assert.equal(bad.body.lint_passed, false); assert.ok(bad.body.problems.some(p => p.level !== 'warn'));
  const ok = await call(R.lintPreviewRoute, reqOf({ body: { subject: SUBJECT, body_markdown: GOOD_BODY, kind: 'cold', channel: 'email' } }));
  assert.equal(ok.code, 200); assert.equal(ok.body.lint_passed, true);
  assert.equal(sb.db.hk_touches.length, 0); assert.equal(sb.db.hk_events.length, 0); assert.equal(calls.length, 0);
  const badKind = await call(R.lintPreviewRoute, reqOf({ body: { subject: 's', body_markdown: 'b', kind: 'nope' } }));
  assert.equal(badKind.code, 400);
});

test('hk-imported-drafts-noise F1: a draft is an email WITH its Gmail draft, or an Instagram DM text; an id-less email draft and an imported row are never listed or counted; badges per member', async () => {
  fresh();
  const t = (id, sender, over) => ({ id, business_id: HK, brand_id: B.yoga, sender_user_id: sender, channel: 'email', kind: 'cold', state: 'drafted', created_by: 'system', drafted_at: '2026-10-20T00:00:00Z', created_at: '2026-10-20T00:00:00Z', ...over });
  sb.db.hk_touches.push(
    t('real', JACK, { gmail_draft_id: 'draft-1', gmail_message_id: 'dmsg-1' }), t('noid', JACK, {}), t('dm', JACK, { channel: 'ig_dm', kind: 'dm_text' }),
    t('imp', JACK, { state: 'imported' }), t('impdm', JACK, { channel: 'ig_dm', kind: 'dm_text', state: 'imported' }), t('pete', PETE, { gmail_draft_id: 'draft-9' }), t('petenoid', PETE, {}));
  const list = async owner => { const r = await call(R.listDraftsRoute, reqOf({ method: 'GET', query: { owner } })); assert.equal(r.code, 200, JSON.stringify(r.body)); return r.body.drafts.map(d => d.id).sort(); };
  assert.deepEqual(await list('me'), ['dm', 'real']);
  assert.deepEqual(await list('all'), ['dm', 'pete', 'real']);
  const badges = async (owner, user = JACK) => { const r = await call(R.gmailStatusRoute, reqOf({ method: 'GET', user, query: owner ? { owner } : {} })); assert.equal(r.code, 200, JSON.stringify(r.body)); return r.body.badges.drafts; };
  assert.deepEqual([await badges('me'), await badges('all'), await badges('me', PETE)], [2, 3, 1]);
  assert.equal(sb.db.hk_touches.length, 7, 'nothing deleted');
});
