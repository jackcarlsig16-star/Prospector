// node --test api/sales/heatScore.test.mjs
// heat-v2 Stage 1 (H1-H3, rulings R1-R3): one scale, one fade schedule per family by its newest signal, human clicks
// only, excluded replies force 0, the band is the number's bracket. Invented rows + the anonymised fixture, no addresses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isBotOpen, scoreProspect, bandOf, fadeAt, HEAT, HEAT_BANDS, visitSignal } from './heatScore.js';
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

test('readers: a fast Gmail open is a real open (points, last signal) and two make an Interest signal; scanner opens score 0 with the automated why', () => {
  const messages = [{ apollo_message_id: 'm1', contact_id: 'c1', step: 1, delivered_at: DELIVERED, num_opens: 2, replied: false }];
  const events = [open(14), open(29)];
  const now = Date.parse(DELIVERED) + 3600e3;
  const scored = scoreProspect(messages, events, null, now);
  assert.deepEqual([scored.score, scored.band, scored.why, scored.badges.possible_bot_open, scored.last_signal], [10, 'warm', ['Opened ×2 +10'], false, { kind: 'open', step: 1, at: at(29), count: 2 }]);
  const sig = personSignals({ messages, events, now }).get('c1');
  assert.deepEqual([sig.strongest.kind, sig.strongest.count], ['opens', 2]);
  const scanner = events.map(e => ({ ...e, user_agent: 'Chrome, Windows' }));
  const bot = scoreProspect(messages, scanner, null, now);
  assert.deepEqual([bot.score, bot.band, bot.why, bot.last_signal], [0, 'cold', ['Opens look automated (scanner timing/agent) +0'], null]);
  assert.equal(personSignals({ messages, events: scanner, now }).get('c1').strongest, null);
});

const NOW = Date.parse('2026-11-06T18:00:00Z'); // Fri Nov 6, 10:00 PST -> the 7-day visit window starts 2026-10-31
const daysAgo = (d, seconds = 0) => new Date(NOW - d * 864e5 - seconds * 1000).toISOString();
const visitRow = (over = {}) => ({ visits_7d: 3, unique_visitors_7d: 2, last_visit: '2026-11-05', seen_to: '2026-11-06', pulled_on: '2026-11-06', ...over });
const sentMsg = (id = 'm1', over = {}) => ({ apollo_message_id: id, contact_id: 'c1', step: 1, delivered_at: daysAgo(40), num_opens: 0, replied: false, ...over });
const click = (occurred_at, extra = {}) => ({ id: occurred_at, apollo_message_id: 'm1', contact_id: 'c1', event: 'click', occurred_at, user_agent: 'Chrome', tracking_service: null, ...extra });

test('H1 fade schedule (R1): whole through 7 d, ×0.5 through 30 d, then ×0.25 - the edges to the minute; the why shows the arithmetic only when faded', () => {
  assert.deepEqual([HEAT.fadeFresh, HEAT.fadeMid, HEAT.fadeOld, HEAT.fadeFloor], [7, 0.5, 30, 0.25]);
  assert.deepEqual([fadeAt(0), fadeAt(7), fadeAt(7.001), fadeAt(30), fadeAt(30.001), fadeAt(400)], [1, 1, 0.5, 0.5, 0.25, 0.25]);
  const one = occurred_at => scoreProspect([sentMsg()], [click(occurred_at)], null, NOW);
  assert.deepEqual([one(daysAgo(7)).score, one(daysAgo(7)).why], [40, ['Clicked on 1 day +40']], 'exactly 7 d: whole');
  assert.deepEqual([one(daysAgo(7, 60)).score, one(daysAgo(7, 60)).why], [20, ['Clicked on 1 day · 40 × 0.5 (7 d) +20']], 'a minute past 7 d: half');
  assert.deepEqual([one(daysAgo(30)).score, one(daysAgo(30)).why], [20, ['Clicked on 1 day · 40 × 0.5 (30 d) +20']], 'exactly 30 d: still half');
  assert.deepEqual([one(daysAgo(30, 60)).score, one(daysAgo(30, 60)).why, one(daysAgo(30, 60)).points], [10, ['Clicked on 1 day · 40 × 0.25 (30 d) +10'], { reply: 0, click: 10, open: 0, visit: 0 }], 'a minute past 30 d: the floor');
  const two = scoreProspect([sentMsg()], [click(daysAgo(20)), click(daysAgo(2))], null, NOW);
  assert.deepEqual([two.score, two.why], [80, ['Clicked on 2 days +80']], 'the family fades by its NEWEST click: two click days, the newest 2 d old, whole');
});

test('H1 separate clocks per family: an old click fades while a fresh visit is whole, an old visit fades alone, an old reply fades on replied_at / replied_seen_at, else delivered_at', () => {
  const v = visitSignal({ visit: visitRow(), now: NOW });
  const oldClick = scoreProspect([sentMsg()], [click(daysAgo(20))], v, NOW);
  assert.deepEqual([oldClick.score, oldClick.why, oldClick.badges.visit], [34, ['Clicked on 1 day · 40 × 0.5 (20 d) +20', 'Company on the site · 3 visits · 2 people (7 d) +14'], { kind: 'company', visits: 3, people: 2, fade: 1 }]);
  const oldVisit = scoreProspect([sentMsg()], [click(daysAgo(1))], visitSignal({ visit: visitRow({ last_visit: '2026-10-20', seen_to: '2026-11-06' }), now: NOW }), NOW);
  assert.deepEqual([oldVisit.score, oldVisit.why, oldVisit.badges.visit.fade], [47, ['Clicked on 1 day +40', 'Company on the site · 3 visits · 2 people (7 d) · 14 × 0.5 (17 d) +7'], 0.5]);
  const reply = over => scoreProspect([sentMsg('m1', { replied: true, reply_class: 'willing_to_meet', ...over })], [], null, NOW);
  assert.deepEqual([reply({ replied_at: daysAgo(18) }).score, reply({ replied_at: daysAgo(18) }).why], [50, ['Replied (willing to meet) · 100 × 0.5 (18 d) +50']], 'the spec example: 18 d old, half');
  assert.deepEqual([reply({ replied_seen_at: daysAgo(3) }).score, reply({ replied_seen_at: daysAgo(3) }).why], [100, ['Replied (willing to meet) +100']], 'seen 3 d ago (no exact time): whole');
  assert.deepEqual([reply({}).score, reply({}).band], [25, 'warm'], 'no reply time at all: fades from delivered_at (40 d) to the floor');
  assert.deepEqual(reply({ replied_at: daysAgo(18), replied_seen_at: daysAgo(10) }).last_signal, { kind: 'reply', step: 1, reply_class: 'willing_to_meet', at: daysAgo(18), exact: true }, 'last_signal keeps the exact time and the flag');
  assert.equal(scoreProspect([sentMsg('m1', { replied: true, reply_class: 'out_of_office', replied_at: daysAgo(1) })], [], null, NOW).score, 20, 'reply classes keep their points');
});

test('R3 human clicks only: the Cloudflare shape (2 scanner clicks 11 d ago + an open + a 69-person visit 2 d ago) reads 26 warm, not 46 hot; the same click 10 minutes after delivery counts', () => {
  const delivered = daysAgo(11, 3600);
  const msgs = [sentMsg('m1', { delivered_at: delivered, num_opens: 1 })];
  const scanner = [click(new Date(Date.parse(delivered) + 30e3).toISOString()), click(new Date(Date.parse(delivered) + 90e3).toISOString())];
  const realOpen = { id: 'o1', apollo_message_id: 'm1', contact_id: 'c1', event: 'open', occurred_at: new Date(Date.parse(delivered) + 300e3).toISOString(), user_agent: 'Chrome', tracking_service: null };
  const visit = visitSignal({ visit: visitRow({ visits_7d: 22, unique_visitors_7d: 69, last_visit: daysAgo(2) }), now: NOW });
  const s = scoreProspect(msgs, [...scanner, realOpen], visit, NOW);
  assert.deepEqual([s.score, s.band, s.why, s.points, s.badges.click_days], [26, 'warm', ['Opened ×1 · 5 × 0.5 (11 d) +3', 'Company on the site · 22 visits · 69 people (7 d) +23'], { reply: 0, click: 0, open: 3, visit: 23 }, 0]);
  const human = scoreProspect(msgs, [...scanner, realOpen, click(new Date(Date.parse(delivered) + 600e3).toISOString())], visit, NOW);
  assert.deepEqual([human.score, human.band, human.why[0], human.badges.click_days], [46, 'hot', 'Clicked on 1 day · 40 × 0.5 (11 d) +20', 1]);
  assert.deepEqual(scoreProspect([{ ...msgs[0], delivered_at: null }], [click(daysAgo(1))], null, NOW).points, { reply: 0, click: 0, open: 5, visit: 0 }, 'a click with no delivery time cannot be cleared as human');
});

test('excluded replies (not_interested / unsubscribe) force heat 0 with the one why, whatever else the person did', () => {
  const msgs = [sentMsg('m1', { replied: true, reply_class: 'willing_to_meet', replied_at: daysAgo(1) }), sentMsg('m2', { step: 2, replied: true, reply_class: 'not_interested', replied_at: daysAgo(0.5), num_opens: 3 })];
  const s = scoreProspect(msgs, [click(daysAgo(1))], visitSignal({ visit: visitRow(), now: NOW }), NOW);
  assert.deepEqual([s.score, s.band, s.why, s.points, s.excluded_reply_class, s.last_signal.kind], [0, 'cold', ['Not interested (reply)'], { reply: 0, click: 0, open: 0, visit: 0 }, 'not_interested', 'reply']);
  assert.equal(scoreProspect([sentMsg('m1', { replied: true, reply_class: 'unsubscribe' })], [], null, NOW).excluded_reply_class, 'unsubscribe');
});

test('H2 band = the bracket, nothing else: 40 / 10; a visit + a sent message or an identified visitor is no longer Hot by rule, browse-only at the ceiling stays warm (23 < 40)', () => {
  assert.deepEqual(HEAT_BANDS, { hotScore: 40, warmScore: 10 });
  assert.deepEqual([bandOf(0), bandOf(9), bandOf(10), bandOf(39), bandOf(40), bandOf(200)], ['cold', 'cold', 'warm', 'warm', 'hot', 'hot']);
  const band = (msgs, evs, visit) => { const s = scoreProspect(msgs, evs, visit, NOW); return [s.score, s.band]; };
  const v = visitSignal({ visit: visitRow(), now: NOW });
  assert.deepEqual(band([sentMsg()], [], v), [14, 'warm'], 'sent 1 + company visit: 14 is warm');
  assert.deepEqual(band([], [], visitSignal({ identifiedAt: daysAgo(1), now: NOW })), [11, 'warm'], 'identified this week: 11 is warm');
  assert.deepEqual(band([], [], visitSignal({ visit: visitRow({ visits_7d: 22, unique_visitors_7d: 69 }), now: NOW })), [23, 'warm'], 'browse-only at the ceiling: 23 < 40');
  assert.deepEqual(band([sentMsg()], [], null), [0, 'cold']);
  assert.deepEqual(band([sentMsg('m1', { replied: true, reply_class: 'willing_to_meet', replied_at: daysAgo(10) })], [], v), [64, 'hot'], '100 × 0.5 + 14');
  const no = scoreProspect([], [], null, NOW);
  assert.deepEqual([no.score, no.band, no.why, no.last_signal, no.last_signal_at], [0, 'cold', [], null, null]);
});

test('regression: the 10 anonymised real people (pulled 2026-11-09) under the one rule - band = bracket for each, sorted by heat every Warm sits below every Hot, the numbers pinned', () => {
  const fx = JSON.parse(readFileSync(new URL('./testing/heatRegression.json', import.meta.url), 'utf8'));
  const now = Date.parse(fx.pulled_at);
  const scored = fx.people.map(p => {
    const ms = fx.messages.filter(m => m.contact_id === p.contact_id), es = fx.events.filter(e => e.contact_id === p.contact_id);
    return { id: p.id, old: p.expected.score, ...scoreProspect(ms, es, null, now) };
  });
  assert.deepEqual(scored.map(s => [s.id, s.old, s.score, s.band]), [
    ['p1', 68, 68, 'hot'], ['p2', 48, 24, 'warm'], ['p3', 45, 23, 'warm'], ['p4', 23, 5, 'cold'], ['p5', 108, 65, 'hot'],
    ['p6', 105, 30, 'warm'], ['p7', 103, 26, 'warm'], ['p8', 8, 4, 'cold'], ['p9', 8, 8, 'cold'], ['p10', 8, 4, 'cold'],
  ]);
  assert.deepEqual(scored.find(s => s.id === 'p5').why, ['Replied (follow up question) · 100 × 0.5 (27 d) +50', 'Opened ×4 +15'], 'the 108 · warm person: an old reply halves, the band follows the number');
  for (const s of scored) assert.equal(s.band, bandOf(s.score));
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const lastHot = sorted.filter(s => s.band === 'hot').pop(), firstWarm = sorted.find(s => s.band === 'warm'), firstCold = sorted.find(s => s.band === 'cold');
  assert.ok(firstWarm.score < lastHot.score && firstCold.score < sorted.filter(s => s.band === 'warm').pop().score, 'first Warm < last Hot, first Cold < last Warm');
  assert.deepEqual(sorted.map(s => s.band), ['hot', 'hot', 'warm', 'warm', 'warm', 'warm', 'cold', 'cold', 'cold', 'cold']);
  assert.ok(!/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(JSON.stringify(fx) + JSON.stringify(scored)), 'no address in the fixture or the output');
});
