import test from 'node:test';
import assert from 'node:assert/strict';
import { matchReplyTimes } from './outlookReplyTimes.js';

const msg = (id, contact_id, delivered_at, over = {}) => ({ apollo_message_id: id, contact_id, delivered_at, replied: true, replied_seen_at: '2026-10-08T20:00:00Z', replied_at: null, ...over });
const mail = (imid, from, occurred_at, over = {}) => ({ graph_id: 'g-' + imid, internet_message_id: imid, direction: 'received', external_emails: [from], subject: 'Re: hello', occurred_at, ...over });
const prospects = [{ contact_id: 'amy', email: 'amy@acme.com' }, { contact_id: 'bob', email: 'Bob@Beta.io' }, { contact_id: 'none', email: null }];

test('earliest received mail from the prospect after delivery sets the exact time; one mail serves one message; already-set rows and prospects without an address are counted, not touched', () => {
  const r = matchReplyTimes({ prospects, messages: [
    msg('m1', 'amy', '2026-10-01T10:00:00Z'),
    msg('m2', 'amy', '2026-10-05T10:00:00Z'),
    msg('m3', 'bob', '2026-10-02T10:00:00Z', { replied_at: '2026-10-02T12:00:00Z' }),
    msg('m4', 'none', '2026-10-02T10:00:00Z'),
    msg('m5', 'zed', '2026-10-02T10:00:00Z'),
    { apollo_message_id: 'm6', contact_id: 'amy', delivered_at: '2026-09-01T10:00:00Z', replied: false },
  ], received: [
    mail('<a0>', 'amy@acme.com', '2026-09-30T09:00:00Z'),
    mail('<a1>', 'AMY@acme.com', '2026-10-01T11:30:00Z'),
    mail('<a2>', 'amy@acme.com', '2026-10-03T09:00:00Z'),
    mail('<a3>', 'amy@acme.com', '2026-10-06T09:00:00Z'),
  ] });
  assert.deepEqual(r.counts, { candidates: 4, already: 1, no_email: 2, no_mail: 0, matched: 2 }, 'zed has no prospect row, none has no address');
  assert.deepEqual(r.matched.map(m => [m.apollo_message_id, m.replied_at, m.replied_message_id]), [['m1', '2026-10-01T11:30:00Z', '<a1>'], ['m2', '2026-10-06T09:00:00Z', '<a3>']]);
});

test('never from an auto-reply, a bounce, a sent mail, or a mail before delivery; no mail -> no time', () => {
  const r = matchReplyTimes({ prospects, messages: [msg('m1', 'bob', '2026-10-02T10:00:00Z')], received: [
    mail('<b0>', 'bob@beta.io', '2026-10-02T09:00:00Z'),
    mail('<b1>', 'bob@beta.io', '2026-10-02T11:00:00Z', { subject: 'Automatic reply: hello' }),
    mail('<b2>', 'postmaster@beta.io', '2026-10-02T11:05:00Z'),
    mail('<b3>', 'bob@beta.io', '2026-10-02T11:10:00Z', { direction: 'sent' }),
  ] });
  assert.deepEqual(r.counts, { candidates: 1, already: 0, no_email: 0, no_mail: 1, matched: 0 });
  const ok = matchReplyTimes({ prospects, messages: [msg('m1', 'bob', '2026-10-02T10:00:00Z')], received: [mail('<b4>', 'bob@beta.io', '2026-10-02T12:00:00Z')] });
  assert.equal(ok.matched[0].replied_at, '2026-10-02T12:00:00Z');
});
