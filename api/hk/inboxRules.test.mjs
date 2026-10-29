// node --test api/hk/inboxRules.test.mjs
// hkos-inbox-v1 Stage 1 - the pure matcher and shapes. Invented senders on .invalid domains; the one rule under test
// is that no address survives into a row or a message view (outside the body fields).
import test from 'node:test';
import assert from 'node:assert/strict';
import { senderOf, fromHint, splitAddresses, recipientNames, isBulk, chipFor, threadRow, partsOf, messageView, latestInbound, stripBodies, SNIPPET_MAX } from './inboxRules.js';

const OWNER = 'hello@humankind.invalid';
const b64 = s => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const msg = (id, { from, to = `HumanKind <${OWNER}>`, subject = 'Re: HumanKind x Rumpl', date = 'Mon, 26 Oct 2026 10:00:00 -0500', labels = ['INBOX'], snippet = 'Thanks Jack, sounds fun', extraHeaders = [], mimeType = 'multipart/alternative', threadId = 'th-1' } = {}) =>
  ({ id, threadId, labelIds: labels, snippet, internalDate: '1761490800000', payload: { mimeType, headers: [{ name: 'From', value: from }, { name: 'To', value: to }, { name: 'Subject', value: subject }, { name: 'Date', value: date }, ...extraHeaders] } });
const ctx = (over = {}) => ({ tracked: new Map(), brandsByDomain: {}, teamDomains: ['humankindcollective.app'], ownerEmail: OWNER, ignored: new Set(), ...over });

test('senderOf keeps a display name and a domain, never the address; a bare address falls back to the domain', () => {
  assert.deepEqual(senderOf('"Jane at Rumpl" <jane.doe@rumpl.invalid>'), { name: 'Jane at Rumpl', domain: 'rumpl.invalid', local: 'jane.doe', email: 'jane.doe@rumpl.invalid' });
  const bare = senderOf('noreply@news.invalid');
  assert.equal(bare.name, 'news.invalid'); assert.equal(bare.local, 'noreply');
  assert.equal(senderOf('').name, 'Unknown');
});

test('a bare @ in a display name, subject or snippet reads as "at" (the "@" rule is literal)', () => {
  assert.equal(senderOf('"Jane @ Acme" <jane@acme.invalid>').name, 'Jane at Acme');
  assert.deepEqual(recipientNames('"Sam @ Bluefin" <sam@bluefin.invalid>', OWNER), ['Sam at Bluefin']);
  const th = { id: 'th-at', messages: [msg('m1', { from: '"Jane @ Acme" <jane@acme.invalid>', subject: 'Follow @acmeruns this fall', snippet: 'Tag us @acmeruns or write jane@acme.invalid' })] };
  const row = threadRow(th, ctx());
  assert.equal(row.subject, 'Follow at acmeruns this fall'); assert.equal(row.snippet, 'Tag us at acmeruns or write [email removed]');
  assert.ok(!JSON.stringify(row).includes('@'));
});

test('fromHint is the role word in the display name, else the domain', () => {
  assert.equal(fromHint('Rumpl Marketing', 'rumpl.invalid'), 'Marketing');
  assert.equal(fromHint('Sam Lee, Co-founder', 'bluefin.invalid'), 'Co-founder');
  assert.equal(fromHint('Sam Lee', 'bluefin.invalid'), 'bluefin.invalid');
  assert.equal(fromHint('Teamwork Inc', 'x.invalid'), 'x.invalid');
});

test('recipients split on commas outside quotes and angle brackets; the owner reads as "you"', () => {
  const v = `"Lee, Sam" <sam@bluefin.invalid>, HumanKind <${OWNER}>, pete@humankind.invalid`;
  assert.equal(splitAddresses(v).length, 3);
  assert.deepEqual(recipientNames(v, OWNER), ['Lee, Sam', 'you', 'humankind.invalid']);
  assert.ok(!JSON.stringify(recipientNames(v, OWNER)).includes('@'));
});

test('bulk senders: List-Unsubscribe or a noreply / notifications / newsletter local part', () => {
  assert.equal(isBulk('jane', '<mailto:u@x.invalid>'), true);
  for (const l of ['noreply', 'no-reply', 'do-not-reply', 'notifications', 'notification', 'newsletter', 'newsletters', 'noreply+abc']) assert.equal(isBulk(l, null), true, l);
  for (const l of ['jane', 'hello', 'press', 'team']) assert.equal(isBulk(l, null), false, l);
});

test('chipFor: tracked > matches > team > ignored > bulk > untracked', () => {
  const tracked = new Map([['th-1', { brand_id: 'b1', brand_name: 'Rumpl', status: 'sent', label: 'interested' }]]);
  const brandsByDomain = { 'rumpl.invalid': { id: 'b1', name: 'Rumpl', status: 'sent' }, 'bluefin.invalid': { id: 'b2', name: 'Bluefin', status: 'candidate' } };
  const c = ctx({ tracked, brandsByDomain, ignored: new Set(['news.invalid']) });
  assert.deepEqual(chipFor({ threadId: 'th-1', sender: senderOf('x <noreply@news.invalid>'), ...c }), { kind: 'tracked', brand_id: 'b1', brand_name: 'Rumpl', status: 'sent', label: 'interested' });
  assert.deepEqual(chipFor({ threadId: 'th-2', sender: senderOf('Sam <sam@bluefin.invalid>'), ...c }), { kind: 'matches', brand_id: 'b2', brand_name: 'Bluefin', status: 'candidate' });
  assert.deepEqual(chipFor({ threadId: 'th-3', sender: senderOf('Pete <pete@humankindcollective.app>'), ...c }), { kind: 'team' });
  assert.deepEqual(chipFor({ threadId: 'th-3b', sender: senderOf(`Me <${OWNER}>`), ...c }), { kind: 'team' });
  assert.deepEqual(chipFor({ threadId: 'th-4', sender: senderOf('News <hello@news.invalid>'), ...c }), { kind: 'not_tracked', reason: 'ignored' });
  assert.deepEqual(chipFor({ threadId: 'th-5', sender: senderOf('Shop <noreply@shop.invalid>'), ...c }), { kind: 'not_tracked', reason: 'bulk' });
  assert.deepEqual(chipFor({ threadId: 'th-6', sender: senderOf('Ana <ana@yoga.invalid>'), listUnsubscribe: '<https://yoga.invalid/u>', ...c }), { kind: 'not_tracked', reason: 'bulk' });
  assert.deepEqual(chipFor({ threadId: 'th-7', sender: senderOf('Ana <ana@yoga.invalid>'), ...c }), { kind: 'untracked' });
});

test('threadRow: newest message gives sender / date / snippet, first gives the subject; unread, attachments; no "@"', () => {
  const th = { id: 'th-9', messages: [
    msg('m1', { from: `HumanKind <${OWNER}>`, to: 'Sam <sam@bluefin.invalid>', subject: 'HumanKind x Bluefin - a run challenge', labels: ['SENT'], date: 'Sun, 25 Oct 2026 09:00:00 -0500' }),
    msg('m2', { from: '"Sam Lee, Co-founder" <sam@bluefin.invalid>', subject: 'Re: HumanKind x Bluefin - a run challenge', labels: ['INBOX', 'UNREAD'], snippet: 'Love it. Reach me at sam@bluefin.invalid or 312-555-0100 and we can talk. '.repeat(3), mimeType: 'multipart/mixed' }),
  ] };
  const row = threadRow(th, ctx({ brandsByDomain: { 'bluefin.invalid': { id: 'b2', name: 'Bluefin', status: 'candidate' } } }));
  assert.equal(row.thread_id, 'th-9'); assert.equal(row.unread, true); assert.equal(row.from_name, 'Sam Lee, Co-founder'); assert.equal(row.from_domain, 'bluefin.invalid'); assert.equal(row.from_hint, 'Co-founder');
  assert.equal(row.subject, 'HumanKind x Bluefin - a run challenge'); assert.equal(row.date, '2026-10-26T15:00:00.000Z'); assert.equal(row.message_count, 2); assert.equal(row.has_attachments, true);
  assert.ok(row.snippet.length <= SNIPPET_MAX && !row.snippet.includes('@') && !row.snippet.includes('312-555'));
  assert.equal(row.chip.kind, 'matches');
  assert.ok(!JSON.stringify(row).includes('@'), JSON.stringify(row));
});

test('partsOf + messageView: text and html decoded, attachments named with sizes, html raw, to_names with "you"', () => {
  const payload = { mimeType: 'multipart/mixed', parts: [
    { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: b64('Hi Jack, see attached. sam@bluefin.invalid') } }, { mimeType: 'text/html', body: { data: b64('<p>Hi Jack</p><img src="https://t.invalid/p.gif"><script>x()</script>') } }] },
    { mimeType: 'application/pdf', filename: 'Bluefin deck.pdf', body: { attachmentId: 'a1', size: 48213 } },
  ] };
  const parts = partsOf(payload);
  assert.equal(parts.text, 'Hi Jack, see attached. sam@bluefin.invalid'); assert.ok(parts.html.includes('<script>')); assert.deepEqual(parts.attachments, [{ name: 'Bluefin deck.pdf', size: 48213 }]);
  const m = { ...msg('m2', { from: 'Sam <sam@bluefin.invalid>', to: `HumanKind <${OWNER}>, Pete <pete@humankind.invalid>` }), payload: { ...payload, headers: msg('x', { from: 'Sam <sam@bluefin.invalid>', to: `HumanKind <${OWNER}>, Pete <pete@humankind.invalid>` }).payload.headers } };
  const v = messageView(m, { ownerEmail: OWNER });
  assert.equal(v.from_name, 'Sam'); assert.equal(v.from_domain, 'bluefin.invalid'); assert.equal(v.is_mine, false); assert.deepEqual(v.to_names, ['you', 'Pete']);
  assert.ok(v.html.includes('<script>'), 'html passes through raw for the owner; the browser sanitizes');
  assert.ok(!JSON.stringify(stripBodies(v)).includes('@'), 'no address outside the body fields');
  assert.ok(JSON.stringify(v).includes('@'), 'the body itself is untouched');
  assert.equal(messageView(msg('m3', { from: `HumanKind <${OWNER}>` }), { ownerEmail: OWNER }).is_mine, true);
});

test('latestInbound skips the owner, SENT and DRAFT messages', () => {
  const th = { messages: [msg('m1', { from: 'Sam <sam@bluefin.invalid>' }), msg('m2', { from: `HumanKind <${OWNER}>`, labels: ['SENT'] }), msg('m3', { from: 'Draft <d@x.invalid>', labels: ['DRAFT'] })] };
  assert.equal(latestInbound(th, OWNER).id, 'm1');
  assert.equal(latestInbound({ messages: [msg('m2', { from: `HumanKind <${OWNER}>`, labels: ['SENT'] })] }, OWNER), null);
});

// ---- hkos-inbox-v2 (L1 lanes, L3 entities, ruling 2 group relays, Q1 units, Q2 Brands query, L5 prefill) ----
const V2 = await import('./inboxRules.js');
const TEAM = 'humankindcollective.app';
const row = (m, over = {}) => threadRow({ id: m.threadId, messages: [m] }, ctx(over));

test('v2 L1 lanes: a person in Needs you; Gmail Promotions / Updates / Social / Forums -> Other; Personal stays; bulk and ignored -> Other; brand mail -> Needs you', () => {
  assert.equal(row(msg('a', { from: 'Ana Ortiz <ana@newbrand.invalid>' })).lane, 'needs_you');
  for (const cat of V2.MARKETING_CATEGORIES) assert.equal(row(msg('b', { from: 'Ana <ana@newbrand.invalid>', labels: ['INBOX', cat] })).lane, 'other', cat);
  assert.equal(row(msg('c', { from: 'Ana <ana@newbrand.invalid>', labels: ['INBOX', 'CATEGORY_PERSONAL'] })).lane, 'needs_you', 'Personal is not marketing');
  assert.equal(row(msg('d', { from: 'Shop <noreply@shop.invalid>' })).lane, 'other');
  assert.equal(row(msg('e', { from: 'News <hello@news.invalid>' }), { ignored: new Set(['news.invalid']) }).lane, 'other');
  assert.equal(row(msg('f', { from: 'Sam <sam@bluefin.invalid>', labels: ['INBOX', 'CATEGORY_PROMOTIONS'] }), { brandsByDomain: { 'bluefin.invalid': { id: 'b1', name: 'Bluefin' } } }).lane, 'needs_you', 'a brand outranks Gmail\'s category');
});

test('v2 ruling 2a: group-relayed mail ("X via Support Group", X-Original-Sender / Reply-To outside) is the original sender - chip, lane, Forums ignored, the group\'s List-Unsubscribe not bulk', () => {
  const relay = (extra, name = "'Grace Miller' via Support Group") => msg('g', { from: `${name} <support@${TEAM}>`, labels: ['INBOX', 'CATEGORY_FORUMS'], extraHeaders: [{ name: 'List-Unsubscribe', value: '<https://groups.invalid/u>' }, ...extra] });
  const a = V2.originOf(relay([{ name: 'X-Original-Sender', value: 'grace@studio.invalid' }]), { teamDomains: [TEAM] });
  assert.deepEqual({ ...a.sender, email: undefined }, { name: 'Grace Miller', domain: 'studio.invalid', local: 'grace', email: undefined }); assert.equal(a.relayed, true);
  const r = row(relay([{ name: 'X-Original-Sender', value: 'grace@studio.invalid' }]));
  assert.deepEqual(r.chip, { kind: 'untracked' }); assert.equal(r.lane, 'needs_you'); assert.equal(r.from_domain, 'studio.invalid'); assert.equal(r.from_name, 'Grace Miller'); assert.equal(r.relayed, true);
  assert.equal(row(relay([{ name: 'Reply-To', value: 'Grace <grace@studio.invalid>' }], 'Support Group')).from_domain, 'studio.invalid', 'Reply-To from an outside domain, no "via" in the name');
  assert.equal(row(relay([{ name: 'X-Original-Sender', value: 'grace@studio.invalid' }]), { brandsByDomain: { 'studio.invalid': { id: 'b9', name: 'Studio' } } }).chip.kind, 'matches', 'the original sender matches a brand');
  const nameOnly = row(relay([]));
  assert.equal(nameOnly.from_name, 'Grace Miller'); assert.equal(nameOnly.from_domain, null); assert.equal(nameOnly.lane, 'needs_you');
  assert.equal(row(relay([{ name: 'X-Original-Sender', value: 'noreply@tool.invalid' }])).lane, 'other', 'a relayed no-reply sender is still bulk');
  assert.equal(row(msg('h', { from: `Pete <pete@${TEAM}>`, extraHeaders: [{ name: 'Reply-To', value: `pete@${TEAM}` }] })).relayed, false, 'a Reply-To inside the team is no relay');
  assert.ok(!JSON.stringify(r).includes('@'));
});

test('v2 ruling 2b/2c: a teammate writing directly -> Needs you; automated team notices (no-reply, +tagged group address, digests with List-Unsubscribe) -> Other', () => {
  assert.equal(row(msg('p', { from: `Pete <pete@${TEAM}>` })).lane, 'needs_you');
  assert.deepEqual(row(msg('p', { from: `Pete <pete@${TEAM}>` })).chip, { kind: 'team' });
  assert.equal(row(msg('o', { from: `HumanKind <${OWNER}>` })).lane, 'needs_you', 'the owner\'s own address');
  assert.equal(row(msg('n', { from: `HumanKind <noreply@${TEAM}>` })).lane, 'other');
  assert.equal(row(msg('m', { from: `Support Group <support+msgappr@${TEAM}>`, subject: 'Message pending moderation' })).lane, 'other');
  assert.equal(row(msg('s', { from: `Support Group <support@${TEAM}>`, subject: 'Spam digest', extraHeaders: [{ name: 'List-Unsubscribe', value: '<https://x.invalid>' }] })).lane, 'other');
});

test('v2 L3 entities: subject, snippet and from name decoded (named + numeric) before the scrub; no "@" back', () => {
  const r = row(msg('x', { from: '"Lil Bucks &amp; Co" <emily@lilbucks.invalid>', subject: 'you&#39;re invited &quot;now&quot; &#x2014; R&amp;D', snippet: 'Tom &amp; Jerry&#39;s &lt;b&gt;' }));
  assert.equal(r.from_name, 'Lil Bucks & Co'); assert.equal(r.subject, 'you\'re invited "now" — R&D'); assert.equal(r.snippet, 'Tom & Jerry\'s <b>');
  assert.ok(!/&#39;|&amp;|&quot;/.test(JSON.stringify(r)));
});

test('v2 Q2 Brands query: one from:(a OR b) per chunk, every chunk under the cap, sorted + de-duplicated, junk dropped, search kept', () => {
  assert.deepEqual(V2.brandQueries(['b.com', 'a.com', 'A.com', '', 'not a domain', 'c.org']), ['from:(a.com OR b.com OR c.org)']);
  const many = Array.from({ length: 300 }, (_, i) => `brand${String(i).padStart(3, '0')}.example`);
  const qs = V2.brandQueries(many, { maxLen: 400 });
  assert.ok(qs.length > 1 && qs.every(q => q.length <= 400), `chunks ${qs.length}`);
  assert.deepEqual(qs.flatMap(q => /from:\(([^)]*)\)/.exec(q)[1].split(' OR ')), many, 'every domain once, in order');
  assert.deepEqual(V2.brandQueries(['a.com'], { search: 'pricing' }), ['(pricing) from:(a.com)']);
  assert.deepEqual(V2.brandQueries([]), []);
});

test('v2 Q1 units per load: v1 inbox 50 threads.get = 2,010; v2 25 messages.get = 505; v1 Brands scan 200 = 8,040; v2 Brands 3 chunks + 25 gets = 515', () => {
  const U = { 'threads.list': 10, 'threads.get': 40, 'messages.list': 5, 'messages.get': 20 };
  assert.equal(V2.unitsOf({ 'threads.list': 1, 'threads.get': 50 }, U), 2010);
  assert.equal(V2.unitsOf({ 'messages.list': 1, 'messages.get': 25 }, U), 505);
  assert.equal(V2.unitsOf({ 'threads.list': 4, 'threads.get': 200 }, U), 8040);
  assert.equal(V2.unitsOf({ 'messages.list': 3, 'messages.get': 25 }, U), 515);
});

test('v2 Track as brand prefill from an Analyze result: name, domain, category, challenge idea, HQ city, is_local (Chicago yes), size band, one dated note', () => {
  const intel = { company: { name: 'ASO Scout', website: 'asoscout.invalid', what_they_do: 'App store optimization agency', hq_city: 'Chicago', chicago_presence: 'yes', size_hint: '11-50', category: 'agency/vendor' },
    email: { kind: 'vendor_pitch', summary: 'Pitches ASO services', urgency: 'low' }, fit: { sponsor_fit: 'weak', why: 'A vendor, not a sponsor', challenge_idea: null }, next_step: 'ignore_sender', reason: 'Sales pitch' };
  const p = V2.prefillFromIntel(intel, { senderName: 'Sam', domain: 'asoscout.invalid', date: '2026-10-28' });
  assert.deepEqual({ ...p, notes: undefined }, { name: 'ASO Scout', domain: 'asoscout.invalid', category: 'agency/vendor', challenge_idea: '', city: 'Chicago', is_local: true, size_band: '11-50', notes: undefined });
  assert.ok(p.notes.startsWith('Analyzed 2026-10-28: App store optimization agency · Email: vendor pitch · Sponsor fit: weak - A vendor, not a sponsor · Next: ignore sender - Sales pitch'));
  assert.equal(V2.prefillFromIntel({ company: { chicago_presence: 'unknown' } }, { senderName: 'Ana', domain: 'x.invalid', date: '2026-10-28' }).is_local, false);
});

test('v2 Q2 merge (Jack ruling 3): chunks are taken in turns up to the cap, one thread once; the order comes from internalDate, never the message id', () => {
  const m = (id, threadId, at) => ({ id, threadId, internalDate: String(at) });
  const a = [m('f0', 'ta', 300), m('e0', 'tb', 100)], b = [m('01', 'tc', 400), m('02', 'ta', 50), m('03', 'td', 200)];
  assert.deepEqual(V2.inTurns([a, b], 10).map(x => x.id), ['f0', '01', 'e0', '03'], 'turns; ta once (its first, newest, entry)');
  assert.deepEqual(V2.inTurns([a, b], 3).map(x => x.id), ['f0', '01', 'e0']);
  const sorted = [...V2.inTurns([a, b], 10)].sort(V2.byInternalDate).map(x => x.id);
  assert.deepEqual(sorted, ['01', 'f0', '03', 'e0'], 'internalDate order: "01" is the newest though its id is the smallest');
});
