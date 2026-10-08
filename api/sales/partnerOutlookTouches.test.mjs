// node --test api/sales/partnerOutlookTouches.test.mjs  (microsoft-connect-v1 Stage 3)
import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeOutlookMoves, matchPartner, buildIndex, isAutoMessage, messageKey, eventKey, SENT, REPLIED, MEETING, NEEDS_OK } from './partnerOutlookTouches.js';

const now = new Date('2026-10-08T20:00:00Z');
const partner = (id, pipeline_status, name = id) => ({ id, name, pipeline_status });
const domain = (goal_id, d, confirmed = true) => ({ goal_id, domain: d, confirmed });
const contact = (goal_id, email, name) => ({ goal_id, email, name });
let n = 0;
const msg = (direction, emails, over = {}) => ({ graph_id: `g${++n}`, internet_message_id: `<m${n}@x>`, conversation_id: over.conversation_id ?? `conv${n}`, direction, mailbox_email: 'jack@homelover.ai',
  external_emails: emails, external_names: emails.map(() => ''), external_domains: [...new Set(emails.map(e => e.split('@')[1]))], subject: 'Hello', occurred_at: '2026-10-06T17:00:00Z', ...over });
const event = (emails, over = {}) => ({ graph_id: `e${++n}`, ical_uid: `ical${n}`, mailbox_email: 'jack@homelover.ai', organizer_email: emails[0], external_emails: emails, external_names: emails.map(() => ''),
  external_domains: [...new Set(emails.map(e => e.split('@')[1]))], subject: 'Intro call', start_at: '2026-10-07T17:00:00Z', is_cancelled: false, ...over });
const run = o => proposeOutlookMoves({ partners: [], domains: [], contacts: [], messages: [], events: [], partnerEvents: [], mailboxOwners: [{ mailbox_email: 'jack@homelover.ai', user_id: 'u-jack' }], now, ...o });

test('match: confirmed domain wins over a contact email; unconfirmed domains ignored; two partners = ambiguous', () => {
  const index = buildIndex({ domains: [domain('g1', 'acme.com'), domain('g3', 'zeta.org', false)], contacts: [contact('g2', 'pat@beta.io', 'Pat'), contact('g2', 'amy@acme.com', 'Amy')] });
  assert.deepEqual(matchPartner({ external_domains: ['acme.com'], external_emails: ['amy@acme.com'] }, index), { goal_id: 'g1', via: 'domain', matched: 'acme.com' });
  assert.deepEqual(matchPartner({ external_domains: ['beta.io'], external_emails: ['pat@beta.io'] }, index), { goal_id: 'g2', via: 'email', matched: 'pat@beta.io' });
  assert.equal(matchPartner({ external_domains: ['zeta.org'], external_emails: ['z@zeta.org'] }, index), null);
  assert.deepEqual(matchPartner({ external_domains: ['acme.com', 'beta.io'], external_emails: ['x@acme.com', 'pat@beta.io'] }, index), { goal_id: 'g1', via: 'domain', matched: 'acme.com' });
  assert.ok(matchPartner({ external_domains: ['acme.com', 'gamma.co'], external_emails: [] }, buildIndex({ domains: [domain('g1', 'acme.com'), domain('g9', 'gamma.co')], contacts: [] })).ambiguous);
});

test('auto replies and bounces are skipped by subject prefix or sender, counted', () => {
  assert.ok(isAutoMessage({ subject: 'Automatic reply: Hello', external_emails: ['a@acme.com'] }));
  assert.ok(isAutoMessage({ subject: '  out of office until Monday', external_emails: ['a@acme.com'] }));
  assert.ok(isAutoMessage({ subject: 'Undeliverable: Hello', external_emails: [] }));
  assert.ok(isAutoMessage({ subject: 'Delivery Status Notification (Failure)', external_emails: [] }));
  assert.ok(isAutoMessage({ subject: 'Hello', external_emails: ['postmaster@acme.com'] }));
  assert.ok(isAutoMessage({ subject: 'Hello', external_emails: ['no-reply@acme.com'] }) && isAutoMessage({ subject: 'x', external_emails: ['noreply@acme.com'] }) && isAutoMessage({ subject: 'x', external_emails: ['mailer-daemon@acme.com'] }));
  assert.ok(!isAutoMessage({ subject: 'Re: Automatic reply', external_emails: ['a@acme.com'] }));
  const r = run({ partners: [partner('g1', 'first_email_sent', 'Acme')], domains: [domain('g1', 'acme.com')], messages: [msg('received', ['postmaster@acme.com'], { subject: 'Undeliverable: hi' })] });
  assert.equal(r.counts.skipped_auto, 1); assert.equal(r.proposed.length + r.held.length, 0);
});

test('sent mail to a matched domain -> Sent (auto), dated on the LA day, by the mailbox owner; the new person is listed', () => {
  const m = msg('sent', ['amy@acme.com'], { external_names: ['Amy Adams'], occurred_at: '2026-10-07T03:30:00Z' });
  const r = run({ partners: [partner('g1', 'researching', 'Acme')], domains: [domain('g1', 'acme.com')], messages: [m] });
  assert.equal(r.proposed.length, 1);
  const p = r.proposed[0];
  assert.equal(p.to, SENT); assert.equal(p.auto, true); assert.equal(p.date, '2026-10-06'); assert.equal(p.by_user, 'u-jack'); assert.equal(p.key, messageKey(m));
  assert.equal(p.person, 'Amy Adams <amy@acme.com>');
  assert.deepEqual(r.people.map(x => [x.partner, x.email, x.name, x.first_seen]), [['Acme', 'amy@acme.com', 'Amy Adams', '2026-10-06']]);
  const known = run({ partners: [partner('g1', 'researching', 'Acme')], domains: [domain('g1', 'acme.com')], contacts: [contact('g1', 'amy@acme.com', 'Amy')], messages: [m] });
  assert.equal(known.people.length, 0);
});

test('people: only sent mail, only addresses at the partner domain, earliest date wins, never a received-only address', () => {
  const r = run({ partners: [partner('g1', 'researching', 'Acme')], domains: [domain('g1', 'acme.com')], messages: [
    msg('sent', ['amy@acme.com', 'cc@other.com'], { occurred_at: '2026-10-07T17:00:00Z' }),
    msg('sent', ['amy@acme.com'], { external_names: ['Amy Adams'], occurred_at: '2026-10-05T17:00:00Z' }),
    msg('received', ['bob@acme.com']),
  ] });
  assert.deepEqual(r.people.map(x => [x.email, x.name, x.first_seen]), [['amy@acme.com', 'Amy Adams', '2026-10-05']]);
});

test('received: in a thread we started -> Replied auto; cold -> held for an OK', () => {
  const sent = msg('sent', ['amy@acme.com'], { conversation_id: 'T1', occurred_at: '2026-10-05T17:00:00Z' });
  const inThread = msg('received', ['amy@acme.com'], { conversation_id: 'T1', occurred_at: '2026-10-06T17:00:00Z' });
  const r = run({ partners: [partner('g1', 'first_email_sent', 'Acme')], domains: [domain('g1', 'acme.com')], messages: [sent, inThread] });
  assert.equal(r.proposed.length, 1); assert.equal(r.proposed[0].to, REPLIED); assert.equal(r.proposed[0].auto, true);
  const cold = msg('received', ['bob@acme.com'], { conversation_id: 'T9' });
  const c = run({ partners: [partner('g1', 'first_email_sent', 'Acme')], domains: [domain('g1', 'acme.com')], messages: [cold] });
  assert.equal(c.proposed.length, 0); assert.equal(c.held.length, 1); assert.equal(c.held[0].hold_reason, NEEDS_OK.cold_reply);
});

test('calendar: a matched event -> Meeting held, never auto; future meeting dated today with the meeting day kept; cancelled counted', () => {
  const e = event(['amy@acme.com'], { start_at: '2026-10-20T17:00:00Z' });
  const r = run({ partners: [partner('g1', 'replied', 'Acme')], domains: [domain('g1', 'acme.com')], events: [e, event(['amy@acme.com'], { is_cancelled: true })] });
  assert.equal(r.counts.cancelled, 1);
  assert.equal(r.held.length, 1);
  const h = r.held[0];
  assert.equal(h.to, MEETING); assert.equal(h.auto, false); assert.equal(h.key, eventKey(e)); assert.equal(h.date, '2026-10-08'); assert.equal(h.meeting_date, '2026-10-20'); assert.equal(h.hold_reason, NEEDS_OK.meeting);
});

test('one proposal per partner: furthest target wins; not behind, paused and settled keys are skipped with the reason', () => {
  const sent = msg('sent', ['amy@acme.com'], { conversation_id: 'T1' }), reply = msg('received', ['amy@acme.com'], { conversation_id: 'T1', occurred_at: '2026-10-07T17:00:00Z' });
  const r = run({ partners: [partner('g1', 'not_started', 'Acme')], domains: [domain('g1', 'acme.com')], messages: [sent, reply] });
  assert.equal(r.proposed.length, 1); assert.equal(r.proposed[0].to, REPLIED);
  assert.equal(r.skipped.length, 1); assert.match(r.skipped[0].reason, /covers this partner this run/);
  const notBehind = run({ partners: [partner('g1', 'meeting_set', 'Acme')], domains: [domain('g1', 'acme.com')], messages: [sent] });
  assert.equal(notBehind.proposed.length, 0); assert.match(notBehind.skipped[0].reason, /already at or past first_email_sent/);
  const paused = run({ partners: [partner('g1', 'paused', 'Acme')], domains: [domain('g1', 'acme.com')], messages: [sent] });
  assert.match(paused.skipped[0].reason, /partner is paused/);
  const applied = run({ partners: [partner('g1', 'not_started', 'Acme')], domains: [domain('g1', 'acme.com')], messages: [sent], partnerEvents: [{ goal_id: 'g1', meta: { outlook_key: messageKey(sent) } }] });
  assert.equal(applied.proposed.length, 0); assert.match(applied.skipped[0].reason, /already applied/);
  const dismissed = run({ partners: [partner('g1', 'not_started', 'Acme')], domains: [domain('g1', 'acme.com')], messages: [sent], partnerEvents: [{ goal_id: 'g1', meta: { outlook_key: messageKey(sent), dismissed: true } }] });
  assert.match(dismissed.skipped[0].reason, /already dismissed/);
});

test('unmatched and ambiguous mail is only counted', () => {
  const r = run({ partners: [partner('g1', 'not_started', 'Acme'), partner('g2', 'not_started', 'Beta')], domains: [domain('g1', 'acme.com'), domain('g2', 'beta.io')],
    messages: [msg('sent', ['x@nowhere.com']), msg('sent', ['a@acme.com', 'b@beta.io'])] });
  assert.equal(r.counts.unmatched, 1); assert.equal(r.counts.ambiguous, 1); assert.equal(r.proposed.length, 0);
});
