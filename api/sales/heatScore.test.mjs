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

// ---- heat-size-v1 Stage 1 (rulings R1-R3, H2) - the visit component and the band rule around it.
import { HEAT, visitSignal, HEAT_BANDS } from './heatScore.js';
import { readFileSync } from 'node:fs';

const NOW = Date.parse('2026-11-06T18:00:00Z'); // Fri Nov 6, 10:00 PST -> the 7-day window starts 2026-10-31
const daysAgo = d => new Date(NOW - d * 864e5).toISOString();
const visitRow = (over = {}) => ({ visits_7d: 3, unique_visitors_7d: 2, last_visit: '2026-11-05', seen_to: '2026-11-06', pulled_on: '2026-11-06', ...over });
const sentMsg = (id = 'm1', over = {}) => ({ apollo_message_id: id, contact_id: 'c1', step: 1, delivered_at: daysAgo(2), num_opens: 0, replied: false, ...over });

test('R1 visit points: base + per visitor, capped at visitVisitorsMax; the why line; no visit = the Huddle-era score to the digit', () => {
  assert.deepEqual([HEAT.visitBase, HEAT.visitPerVisitor, HEAT.visitVisitorsMax, HEAT.visitDays], [8, 3, 5, 7]);
  const two = scoreProspect([], [], visitSignal({ visit: visitRow(), now: NOW }), NOW);
  assert.deepEqual([two.score, two.why, two.badges.visit, two.last_visit_at], [14, ['Company on the site · 3 visits · 2 people (7 d) +14'], { kind: 'company', visits: 3, people: 2, decayed: false }, '2026-11-05']);
  const many = scoreProspect([], [], visitSignal({ visit: visitRow({ visits_7d: 22, unique_visitors_7d: 69 }), now: NOW }), NOW);
  assert.deepEqual([many.score, many.why[0]], [8 + 3 * 5, 'Company on the site · 22 visits · 69 people (7 d) +23'], 'capped at 5 visitors: ceiling 23, under hotScore');
  const one = scoreProspect([], [], visitSignal({ visit: visitRow({ visits_7d: 1, unique_visitors_7d: 1 }), now: NOW }), NOW);
  assert.equal(one.why[0], 'Company on the site · 1 visit · 1 person (7 d) +11');
  const none = scoreProspect([sentMsg('m1', { num_opens: 2 })], [], null, NOW);
  const legacy = scoreProspect([sentMsg('m1', { num_opens: 2 })], []);
  assert.deepEqual([none.score, none.why, none.badges.visit, none.last_visit_at], [legacy.score, legacy.why, null, null]);
});

test('R2 visitSignal: the company row counts while its pull window reaches into 7 d; identified <= 7 d ago counts as one visit by one person on created_at; the company row wins when both apply; older than 7 d = nothing (never an undecayed base)', () => {
  assert.deepEqual(visitSignal({ visit: visitRow(), now: NOW }), { kind: 'company', visits: 3, people: 2, at: '2026-11-05' });
  assert.equal(visitSignal({ visit: visitRow({ seen_to: '2026-10-30' }), now: NOW }), null, 'a pull window that ended Oct 30 is outside Oct 31 - Nov 6');
  assert.deepEqual(visitSignal({ visit: visitRow({ seen_to: '2026-10-31', last_visit: '2026-10-29' }), now: NOW }), { kind: 'company', visits: 3, people: 2, at: '2026-10-29' }, 'Oct 31 is the first day in');
  assert.equal(visitSignal({ visit: visitRow({ visits_7d: 0 }), now: NOW }), null, 'a row with 0 visits is no visit');
  assert.deepEqual(visitSignal({ visit: null, identifiedAt: daysAgo(6), now: NOW }), { kind: 'identified', visits: 1, people: 1, at: daysAgo(6) });
  assert.equal(visitSignal({ visit: null, identifiedAt: daysAgo(8), now: NOW }), null, 'identified 8 d ago at a quiet company: no base, ever');
  assert.deepEqual(visitSignal({ visit: visitRow({ seen_to: '2026-10-01', last_visit: '2026-09-30' }), identifiedAt: daysAgo(2), now: NOW }).kind, 'identified', 'an old company row + a fresh identification = the identification');
  assert.deepEqual(visitSignal({ visit: visitRow(), identifiedAt: daysAgo(2), now: NOW }).kind, 'company', 'both fresh: the company row (more people) wins');
  assert.equal(visitSignal({ now: NOW }), null);
  const id = scoreProspect([], [], visitSignal({ identifiedAt: daysAgo(2), now: NOW }), NOW);
  assert.deepEqual([id.score, id.why], [11, ['Identified on the site 2 d ago +11']]);
});

test('R3 separate clocks: an old click decays while a fresh visit does not, and a fresh visit never un-decays old clicks; an old visit decays alone; the why names the clock', () => {
  const msgs = [sentMsg('m1', { delivered_at: daysAgo(10) })];
  const oldClick = [{ id: 1, apollo_message_id: 'm1', contact_id: 'c1', event: 'click', occurred_at: daysAgo(5), user_agent: 'Chrome', tracking_service: null }];
  const emailOnly = scoreProspect(msgs, oldClick, null, NOW);
  assert.deepEqual([emailOnly.score, emailOnly.why], [20, ['Clicked on 1 day +40', 'No new signal in 3+ days: clicks/opens ×0.5']]);
  const withFreshVisit = scoreProspect(msgs, oldClick, visitSignal({ visit: visitRow(), now: NOW }), NOW);
  assert.deepEqual([withFreshVisit.score, withFreshVisit.why], [20 + 14, ['Clicked on 1 day +40', 'No new signal in 3+ days: clicks/opens ×0.5', 'Company on the site · 3 visits · 2 people (7 d) +14']], 'the click stays decayed, the visit is whole');
  const freshClick = [{ ...oldClick[0], occurred_at: daysAgo(1) }];
  const oldVisit = scoreProspect(msgs, freshClick, visitSignal({ visit: visitRow({ last_visit: '2026-11-01', seen_to: '2026-11-06' }), now: NOW }), NOW);
  assert.deepEqual([oldVisit.score, oldVisit.why, oldVisit.badges.visit.decayed], [40 + 7, ['Clicked on 1 day +40', 'Company on the site · 3 visits · 2 people (7 d) +14', 'No new visit in 3+ days: visit ×0.5'], true], 'the visit decays alone (14 × 0.5 = 7), the click is whole');
  assert.equal(scoreProspect(msgs, freshClick, visitSignal({ visit: visitRow({ last_visit: '2026-11-03T10:00:00Z' }), now: NOW }), NOW).score, 40 + 7, 'a timestamped last_visit 3 d 8 h ago is past the 3-day rule: decayed');
  assert.equal(scoreProspect(msgs, freshClick, visitSignal({ visit: visitRow({ last_visit: '2026-11-03T20:00:00Z' }), now: NOW }), NOW).score, 40 + 14, '2 d 22 h ago: whole');
});

test('H2 band: a visit + a message sent = Hot; an identified visitor = Hot; browse-only (no sent, not identified) is Warm at most; replies keep their own rule; no visit = the old band', () => {
  const band = (msgs, evs, visit) => { const s = scoreProspect(msgs, evs, visit, NOW); return [s.score, huddleSignals(msgs, evs, s, NOW).heat_band]; };
  const v = visitSignal({ visit: visitRow(), now: NOW });
  assert.deepEqual(band([sentMsg()], [], v), [14, 'hot'], 'sent 1 + company visit: Hot though the score is 14');
  assert.deepEqual(band([], [], visitSignal({ identifiedAt: daysAgo(1), now: NOW })), [11, 'hot'], 'identified this week: Hot');
  assert.deepEqual(band([], [], v), [14, 'warm'], 'browse-only: the points make Warm (>= 10), never Hot');
  assert.deepEqual(band([], [], visitSignal({ visit: visitRow({ visits_7d: 22, unique_visitors_7d: 69 }), now: NOW })), [23, 'warm'], 'browse-only at the ceiling: still Warm');
  assert.deepEqual(band([{ ...sentMsg(), delivered_at: null }], [], v), [14, 'warm'], 'a message never delivered is not "sent"');
  assert.deepEqual(band([sentMsg()], [], null), [0, 'cold'], 'sent, no visit: cold as before');
  const replied = [sentMsg('m1', { replied: true, reply_class: 'willing_to_meet', replied_at: daysAgo(10) })];
  assert.deepEqual(band(replied, [], null), [100, 'warm'], 'a 10-day-old reply: Warm (the reply rule)');
  assert.deepEqual(band(replied, [], v), [114, 'warm'], 'a visit does not change the reply rule (replies keep their own clock)');
  assert.equal(HEAT_BANDS.hotScore, 40);
});

test('regression: 10 real people (anonymised fixture, pulled 2026-11-09) score and band exactly as heatScore.js did before the visit component, when no visit exists', () => {
  const fx = JSON.parse(readFileSync(new URL('./testing/heatRegression.json', import.meta.url), 'utf8'));
  const now = Date.parse(fx.pulled_at);
  assert.equal(fx.people.length, 10);
  for (const p of fx.people) {
    const ms = fx.messages.filter(m => m.contact_id === p.contact_id), es = fx.events.filter(e => e.contact_id === p.contact_id);
    const s = scoreProspect(ms, es, null, now);
    const b = huddleSignals(ms, es, s, now, 120);
    assert.deepEqual([p.id, s.score, b.heat_band, s.why], [p.id, p.expected.score, p.expected.band, p.expected.why]);
    assert.equal(summarizePersonLike(ms, es, now), p.expected.score);
  }
  assert.ok(!/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(JSON.stringify(fx)), 'no address in the fixture');
  function summarizePersonLike(ms, es, at) { return scoreProspect(ms, es, visitSignal({ visit: null, identifiedAt: null, now: at }), at).score; }
});
