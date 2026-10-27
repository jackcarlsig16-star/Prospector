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
