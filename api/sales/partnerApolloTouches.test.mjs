// node --test api/sales/partnerApolloTouches.test.mjs  (partner-360-v1 Stage 4)
import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeMoves, isBehind, sentKey, replyKey, DATE_LABELS, SENT, REPLIED, HELD_REASON } from './partnerApolloTouches.js';

const now = new Date('2026-10-07T20:00:00Z');
const partner = (id, pipeline_status, name = id) => ({ id, name, pipeline_status });
const contact = (goal_id, apollo_contact_id, name, sequence_added_at = null, sequence_status = sequence_added_at ? 'active' : null) => ({ goal_id, apollo_contact_id, name, sequence_added_at, sequence_status });
const reply = (apollo_message_id, contact_id, replied_seen_at) => ({ apollo_message_id, contact_id, replied: true, replied_seen_at });
const run = (o) => proposeMoves({ partners: [], contacts: [], messages: [], events: [], now, ...o });

test('isBehind follows pipeline order; in_sequence counts as Sent; paused and live are never behind', () => {
  assert.equal(isBehind('not_started', SENT), true);
  assert.equal(isBehind(null, SENT), true);
  assert.equal(isBehind('first_email_drafted', SENT), true);
  assert.equal(isBehind('first_email_sent', SENT), false);
  assert.equal(isBehind('in_sequence', SENT), false);
  assert.equal(isBehind('in_sequence', REPLIED), true);
  assert.equal(isBehind('meeting_set', REPLIED), false);
  assert.equal(isBehind('live', REPLIED), false);
  assert.equal(isBehind('paused', REPLIED), false);
});

test('sequence_added_at proposes Sent for a partner behind it, dated on the LA day it was added, labeled "in sequence since"', () => {
  const { proposed, skipped, held } = run({ partners: [partner('g1', 'researching', 'Acme')], contacts: [contact('g1', 'c1', 'Dana Kim', '2026-09-29T02:30:00Z')] });
  assert.equal(skipped.length + held.length, 0);
  assert.equal(proposed.length, 1);
  const m = proposed[0];
  assert.equal(m.to, SENT);
  assert.equal(m.from, 'researching');
  assert.equal(m.date, '2026-09-28');          // 02:30Z = 19:30 the day before in LA
  assert.equal(m.date_label, DATE_LABELS[SENT]);
  assert.equal(m.key, sentKey({ apollo_contact_id: 'c1', sequence_added_at: '2026-09-29T02:30:00Z' }));
  assert.equal(m.contact_name, 'Dana Kim');
  assert.match(m.reason, /Dana Kim in sequence since 2026-09-28/);
  assert.equal(JSON.stringify(m).includes('@'), false);
});

test('a stored reply proposes Replied dated replied_seen_at (not delivered_at), labeled "seen at sync"; it beats Sent', () => {
  const { proposed } = run({
    partners: [partner('g1', 'first_email_drafted', 'Acme')],
    contacts: [contact('g1', 'c1', 'Dana Kim', '2026-09-20T12:00:00Z'), contact('g1', 'c2', 'Pat Lee', '2026-09-20T12:00:00Z')],
    messages: [{ ...reply('m1', 'c2', '2026-10-03T15:00:00Z'), delivered_at: '2026-09-21T10:00:00Z' }],
  });
  assert.equal(proposed.length, 1);
  assert.equal(proposed[0].to, REPLIED);
  assert.equal(proposed[0].date, '2026-10-03');
  assert.equal(proposed[0].date_label, 'seen at sync');
  assert.equal(proposed[0].key, replyKey({ apollo_message_id: 'm1' }));
  assert.equal(proposed[0].contact_name, 'Pat Lee');
  assert.match(proposed[0].reason, /reply from Pat Lee \(seen at sync 2026-10-03\)/);
});

test('the earliest reply / earliest sequence add is the one proposed; extras are counted in the reason', () => {
  const { proposed } = run({
    partners: [partner('g1', 'in_sequence'), partner('g2', 'not_started')],
    contacts: [contact('g1', 'c1', 'A'), contact('g1', 'c2', 'B'), contact('g2', 'c3', 'C', '2026-10-02T12:00:00Z'), contact('g2', 'c4', 'D', '2026-09-30T12:00:00Z')],
    messages: [reply('m2', 'c2', '2026-10-05T12:00:00Z'), reply('m1', 'c1', '2026-10-01T12:00:00Z')],
  });
  assert.deepEqual(proposed.map(m => [m.goal_id, m.to, m.key, m.date]), [['g1', REPLIED, 'reply:m1', '2026-10-01'], ['g2', SENT, 'sent:c4:2026-09-30T12:00:00Z', '2026-09-30']]);
  assert.match(proposed[0].reason, /\+1 more$/);
  assert.match(proposed[1].reason, /\+1 more in sequence$/);
});

test('never backwards: a partner at or past the target is skipped with a reason; paused is skipped; untouched partners are silent', () => {
  const { proposed, skipped, held } = run({
    partners: [partner('g1', 'replied'), partner('g2', 'in_sequence'), partner('g3', 'paused'), partner('g4', 'not_started'), partner('g5', 'live')],
    contacts: [contact('g1', 'c1', 'A'), contact('g2', 'c2', 'B', '2026-10-01T12:00:00Z'), contact('g3', 'c3', 'C'), contact('g5', 'c5', 'E', '2026-10-01T12:00:00Z')],
    messages: [reply('m1', 'c1', '2026-10-01T12:00:00Z'), reply('m3', 'c3', '2026-10-01T12:00:00Z')],
  });
  assert.equal(proposed.length + held.length, 0);
  assert.deepEqual(skipped.map(s => [s.goal_id, s.to]), [['g1', REPLIED], ['g2', SENT], ['g3', REPLIED], ['g5', SENT]]);
  assert.match(skipped[0].reason, /already at or past replied \(replied\)/);
  assert.match(skipped[1].reason, /already at or past first_email_sent \(in_sequence\)/);
  assert.match(skipped[2].reason, /partner is paused/);
  assert.match(skipped[3].reason, /already at or past first_email_sent \(live\)/);
});

test('paused rule: all sequenced contacts paused -> held "enrolled, paused — needs Jack", never proposed; one active contact -> proposed from that contact', () => {
  const { proposed, skipped, held } = run({
    partners: [partner('g1', 'not_started', 'All Paused'), partner('g2', 'researching', 'Mixed'), partner('g3', 'meeting_set', 'Past And Paused'), partner('g4', 'not_started', 'Finished')],
    contacts: [
      contact('g1', 'c1', 'A', '2026-09-30T00:28:50Z', 'paused'), contact('g1', 'c2', 'B', '2026-09-29T00:28:50Z', 'paused'),
      contact('g2', 'c3', 'C', '2026-09-20T12:00:00Z', 'paused'), contact('g2', 'c4', 'D', '2026-09-25T12:00:00Z', 'active'),
      contact('g3', 'c5', 'E', '2026-09-30T12:00:00Z', 'paused'),
      contact('g4', 'c6', 'F', '2026-09-30T12:00:00Z', 'finished'),
    ],
  });
  assert.deepEqual(held.map(h => [h.partner, h.key, h.reason]), [['All Paused', 'sent:c2:2026-09-29T00:28:50Z', `${HELD_REASON} (2 paused)`]]);
  assert.deepEqual(proposed.map(m => [m.partner, m.key, m.contact_name]), [['Finished', 'sent:c6:2026-09-30T12:00:00Z', 'F'], ['Mixed', 'sent:c4:2026-09-25T12:00:00Z', 'D']]);
  assert.match(proposed[1].reason, /\+1 more in sequence/);
  assert.deepEqual(skipped.map(s => [s.partner]), [['Past And Paused']]);
  assert.match(skipped[0].reason, /already at or past/);
});

test('a reply still proposes Replied when every sequenced contact is paused', () => {
  const { proposed, held } = run({
    partners: [partner('g1', 'not_started')],
    contacts: [contact('g1', 'c1', 'A', '2026-09-30T12:00:00Z', 'paused')],
    messages: [reply('m1', 'c1', '2026-10-02T12:00:00Z')],
  });
  assert.equal(held.length, 0);
  assert.deepEqual(proposed.map(m => [m.to, m.key]), [[REPLIED, 'reply:m1']]);
});

test('dedupe: a key already on an apollo-sourced event is skipped (or dropped from held), even if the partner is behind again (undo)', () => {
  const inputs = {
    partners: [partner('g1', 'researching'), partner('g2', 'not_started')],
    contacts: [contact('g1', 'c1', 'A'), contact('g2', 'c2', 'B', '2026-09-30T12:00:00Z', 'paused')],
    messages: [reply('m1', 'c1', '2026-10-01T12:00:00Z')],
  };
  const first = run(inputs);
  assert.equal(first.proposed.length, 1);
  assert.equal(first.held.length, 1);
  const again = run({ ...inputs, events: [{ goal_id: 'g1', meta: { apollo_key: 'reply:m1', prev: {} } }, { goal_id: 'g2', meta: { apollo_key: 'sent:c2:2026-09-30T12:00:00Z', prev: {} } }] });
  assert.equal(again.proposed.length, 0);
  assert.equal(again.held.length, 0);
  assert.match(again.skipped.find(s => s.goal_id === 'g1').reason, /already applied \(reply:m1\)/);
  assert.match(again.skipped.find(s => s.goal_id === 'g2').reason, /already applied \(sent:c2:2026-09-30T12:00:00Z\)/);
});

test('replies with no replied_seen_at are reported, not dated from delivered_at; contacts without an Apollo id are ignored', () => {
  const { proposed, skipped } = run({
    partners: [partner('g1', 'not_started'), partner('g2', 'not_started')],
    contacts: [contact('g1', 'c1', 'A'), { goal_id: 'g2', apollo_contact_id: null, name: 'Manual', sequence_added_at: '2026-10-01T12:00:00Z', sequence_status: 'active' }],
    messages: [{ ...reply('m1', 'c1', null), delivered_at: '2026-09-21T10:00:00Z' }],
  });
  assert.equal(proposed.length, 0);
  assert.deepEqual(skipped.map(s => [s.goal_id, s.reason]), [['g1', '1 stored reply with no replied_seen_at']]);
});

test('a source date after today is skipped (no future touches)', () => {
  const { proposed, skipped } = run({ partners: [partner('g1', 'not_started')], contacts: [contact('g1', 'c1', 'A', '2026-10-09T12:00:00Z')] });
  assert.equal(proposed.length, 0);
  assert.match(skipped[0].reason, /date is in the future/);
});
