import test from 'node:test';
import assert from 'node:assert/strict';
import { isBotOpen, scoreProspect, huddleSignals } from './heatScore.js';
import { personSignals } from './interestSignals.js';

// FIX people-apollo-visibility-v1 F1 - Gmail's image proxy only fetches when the recipient opens the message.
const DELIVERED = '2026-10-21T15:00:00Z';
const at = s => new Date(Date.parse(DELIVERED) + s * 1000).toISOString();
const open = (s, extra = {}) => ({ id: s, apollo_message_id: 'm1', contact_id: 'c1', event: 'open', occurred_at: at(s), user_agent: 'Gmail', tracking_service: null, ...extra });

test('isBotOpen: Gmail at 29 s is a person; generic linux, a tracking service and any other agent at 29 s are bots', () => {
  assert.equal(isBotOpen(open(29), DELIVERED), false);
  assert.equal(isBotOpen(open(29, { user_agent: 'gmail' }), DELIVERED), false);
  assert.equal(isBotOpen(open(29, { user_agent: 'Generic Linux' }), DELIVERED), true);
  assert.equal(isBotOpen(open(29, { tracking_service: 'Proofpoint' }), DELIVERED), true);
  assert.equal(isBotOpen(open(29, { user_agent: 'Chrome, Windows' }), DELIVERED), true);
  assert.equal(isBotOpen(open(29, { user_agent: null }), DELIVERED), true);
  assert.equal(isBotOpen(open(90, { user_agent: 'Chrome, Windows' }), DELIVERED), false);
  assert.equal(isBotOpen(open(29, { user_agent: 'Gmail Something' }), DELIVERED), true, 'exact label only');
});

test('readers: a fast Gmail open is a real open for Huddle (last signal, no bot count) and two make an Interest signal', () => {
  const messages = [{ apollo_message_id: 'm1', contact_id: 'c1', step: 1, delivered_at: DELIVERED, num_opens: 2, replied: false }];
  const events = [open(14), open(29)];
  const now = Date.parse(DELIVERED) + 3600e3;
  const scored = scoreProspect(messages, events);
  assert.equal(scored.badges.possible_bot_open, false);
  const h = huddleSignals(messages, events, scored, now);
  assert.deepEqual([h.bot_opens, h.last_human_signal.kind, h.last_human_signal.at, h.heat_band], [0, 'open', at(29), 'warm']);
  const sig = personSignals({ messages, events, now }).get('c1');
  assert.deepEqual([sig.strongest.kind, sig.strongest.count], ['opens', 2]);
  const scanner = events.map(e => ({ ...e, user_agent: 'Chrome, Windows' }));
  assert.equal(huddleSignals(messages, scanner, scoreProspect(messages, scanner), now).bot_opens, 2);
  assert.equal(personSignals({ messages, events: scanner, now }).get('c1').strongest, null);
});
