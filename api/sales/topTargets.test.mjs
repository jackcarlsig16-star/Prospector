// node --test api/sales/topTargets.test.mjs  (react-scripts' Jest only runs src/)
// top-targets-v1 Stage 1 (rulings of Nov 13): the Pin = the hand-set priority clamp (pure state, the ONE writer with
// its event + Undo on an employer / target through the flow log and on a partner through the hot signal, the expiry),
// the five grouped bars that always sum to the score, the Top targets order (P1 pins first, then score) and the Why
// line's fixed order. In-memory Supabase, invented companies; 0 network, 0 Claude, 0 Apollo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { pinState, pinLevel, pinOverride, pinPatch, isPinned, pgStamp, PIN_DAYS } from './pinState.js';
import { applyPin, validReason } from './pinWrite.js';
import { undoFlow } from './flowEvents.js';
import { applyPartnerSignal, undoPartnerSignal } from './partnerSignals.js';
import { scoreCompany, groupScore, GROUP_ORDER, DEFAULT_WEIGHTS, COMPONENTS } from './intentScore.js';
import { topTargets, whyLine, sizeWord, sourceWord, pinFirst, parseTopQuery } from './topTargets.js';
import { salesIntents, isTopTargets, TOP_TARGETS_RULE } from './scoutIntents.js';

const NOW = Date.parse('2026-11-13T20:00:00Z');
const DAY = 864e5;
const at = d => new Date(NOW + d * DAY);
const B = randomUUID(), JACK = randomUUID(), CYRUS = randomUUID();
const E = { acme: randomUUID(), asis: randomUUID() }, T = { quarry: randomUUID() }, P = { harbor: randomUUID() };
const noPin = { pinned_until: null, pin_reason: null, pinned_by: null, pinned_at: null };
const seed = () => ({
  sales_opportunities: [
    { id: E.acme, business_id: B, organization: 'Zz Acme Health', stage: 'contacted', archived_at: null, is_top: false, priority: null, priority_set_at: null, priority_set_by: null, tier: '2', ...noPin },
    // pinned "as it is" by the migration: a P3 set by hand on Nov 1 - the pin's date IS the priority's date
    { id: E.asis, business_id: B, organization: 'Zz Held College', stage: 'contacted', archived_at: null, is_top: false, priority: 3, priority_set_at: pgStamp(NOW - 12 * DAY), priority_set_by: JACK, pinned_at: pgStamp(NOW - 12 * DAY), pinned_until: pgStamp(NOW + 18 * DAY), pinned_by: JACK, pin_reason: 'priority set Nov 1' },
  ],
  sales_targets: [{ id: T.quarry, business_id: B, name: 'Zz Quarry Labs', status: 'researching', ...noPin }],
  sales_goals: [{ id: P.harbor, business_id: B, goal_type: 'partnership', name: 'Zz Harbor Lane', pipeline_status: 'replied', hot: false, priority: 2, priority_set_at: null, priority_set_by: null, next_meeting_at: null, ...noPin }],
  sales_flow_events: [], sales_partner_events: [], sales_company_scores: [], sales_company_score_days: [], sales_settings: [],
});

test('pin state (pure): a pin lifts to P1 for 30 days; a priority set before the rename keeps its band (held); expiry ends it; the clamp the score reads; the columns each action sets', () => {
  const fresh = { pinned_until: pgStamp(NOW + 30 * DAY), pinned_at: pgStamp(NOW), pinned_by: JACK, pin_reason: "Seif's intro", priority: 3, priority_set_at: pgStamp(NOW - 90 * DAY) };
  assert.deepEqual(pinState(fresh, NOW), { until: fresh.pinned_until, at: fresh.pinned_at, by: JACK, reason: "Seif's intro", level: 1, days_left: 30, held: false });
  const asIs = seed().sales_opportunities[1];
  assert.deepEqual([pinLevel(asIs), pinState(asIs, NOW).held, pinState(asIs, NOW).days_left], [3, true, 18]);
  assert.deepEqual([isPinned(asIs, NOW + 19 * DAY), pinState(asIs, NOW + 19 * DAY), pinState(noPin, NOW)], [false, null, null], 'expired = not pinned');
  assert.deepEqual(pinOverride(fresh, NOW), { priority: 1, not_a_fit: false, set_at: new Date(NOW).toISOString() }, 'the clamp expires when the pin does (set_at + 30 d = pinned_until)');
  assert.deepEqual(pinOverride(asIs, NOW).priority, 3);
  assert.equal(pinOverride(asIs, NOW + 19 * DAY), null, 'an expired pin clamps nothing, even with its old priority still on the row');
  assert.deepEqual(pinOverride({ ...noPin, priority: 2, priority_set_at: '2026-11-10T00:00:00+00:00' }, NOW), { priority: 2, not_a_fit: false, set_at: '2026-11-10T00:00:00+00:00' }, 'a dated priority with no pin still clamps (partner forms)');
  assert.equal(pinOverride({ ...noPin, priority: 2, priority_set_at: null }, NOW), null);
  assert.deepEqual(pinPatch(noPin, { type: 'employer', action: 'pin', reason: 'why', userId: JACK, now: NOW }), { pinned_until: pgStamp(NOW + PIN_DAYS * DAY), pinned_at: pgStamp(NOW), pinned_by: JACK, pin_reason: 'why', is_top: true });
  assert.deepEqual(Object.keys(pinPatch(noPin, { type: 'target', action: 'pin', now: NOW })), ['pinned_until', 'pinned_at', 'pinned_by', 'pin_reason'], 'a target has no star column');
  assert.deepEqual(pinPatch(fresh, { type: 'partner', action: 'renew', now: NOW + DAY }), { pinned_until: pgStamp(NOW + 31 * DAY) }, 'renew keeps the reason, the date pinned and the level');
  assert.deepEqual(pinPatch(asIs, { type: 'employer', action: 'unpin', now: NOW }), { ...noPin, is_top: false, priority: null, priority_set_at: null, priority_set_by: null }, 'unpinning an as-it-is pin clears the priority that WAS the pin');
  assert.deepEqual(pinPatch(fresh, { type: 'partner', action: 'unpin', now: NOW }), { ...noPin, hot: false }, 'an older typed priority is left alone');
  assert.deepEqual([validReason(' a  b ').value, validReason('x'.repeat(141)).error, validReason('mail me at a@b.example').error, validReason('').value], ['a b', 'reason must be at most 140 characters', "reason can't hold an email address or phone number", null]);
});

test('the pin writer on an employer: pin (event row with prev + set, the star follows), stale expect 409, pin twice 409, renew, unpin, Undo restores exactly; a bad action / type / id', async () => {
  const sb = fakeSupabase(seed());
  const acme = () => sb.db.sales_opportunities.find(o => o.id === E.acme);
  const stale = await applyPin(sb, { businessId: B, userId: JACK, type: 'employer', id: E.acme, body: { action: 'pin', expect: { pinned_until: pgStamp(NOW) } }, now: at(0) });
  assert.deepEqual([stale.status, stale.body.code, sb.db.sales_flow_events.length], [409, 'changed', 0]);
  const pin = await applyPin(sb, { businessId: B, userId: JACK, type: 'employer', id: E.acme, body: { action: 'pin', reason: "Seif's intro", expect: { pinned_until: null } }, now: at(0) });
  assert.equal(pin.status, 200, JSON.stringify(pin.body));
  assert.deepEqual([pin.body.name, pin.body.pin.level, pin.body.pin.days_left, pin.body.pin.reason, pin.body.undo.kind], ['Zz Acme Health', 1, 30, "Seif's intro", 'flow']);
  assert.deepEqual([acme().pinned_until, acme().pinned_at, acme().pinned_by, acme().pin_reason, acme().is_top], [pgStamp(NOW + 30 * DAY), pgStamp(NOW), JACK, "Seif's intro", true]);
  const ev = sb.db.sales_flow_events[0];
  assert.deepEqual([ev.kind, ev.text, ev.record_type, ev.record_id, ev.by_user, ev.prev, ev.meta.set.pin_reason], ['pin', "Pinned · Seif's intro", 'employer', E.acme, JACK, { ...noPin, is_top: false }, "Seif's intro"]);
  assert.deepEqual([(await applyPin(sb, { businessId: B, userId: JACK, type: 'employer', id: E.acme, body: { action: 'pin' }, now: at(1) })).body.code], ['pinned']);
  const renew = await applyPin(sb, { businessId: B, userId: CYRUS, type: 'employer', id: E.acme, body: { action: 'renew' }, now: at(10) });
  assert.deepEqual([renew.status, acme().pinned_until, acme().pinned_at, acme().pin_reason, acme().pinned_by, sb.db.sales_flow_events[1].kind], [200, pgStamp(NOW + 40 * DAY), pgStamp(NOW), "Seif's intro", JACK, 'pin_renew']);
  const undoRenew = await undoFlow(sb, { businessId: B, eventId: renew.body.event.id, byUser: CYRUS, now: at(10) });
  assert.deepEqual([undoRenew.status, acme().pinned_until], [200, pgStamp(NOW + 30 * DAY)], 'Undo of a renew puts the old expiry back');
  const unpin = await applyPin(sb, { businessId: B, userId: JACK, type: 'employer', id: E.acme, body: { action: 'unpin' }, now: at(11) });
  assert.deepEqual([unpin.status, unpin.body.pin, acme().pinned_until, acme().pin_reason, acme().is_top], [200, null, null, null, false]);
  const undo = await undoFlow(sb, { businessId: B, eventId: unpin.body.event.id, byUser: JACK, now: at(11) });
  assert.deepEqual([undo.status, acme().pinned_until, acme().pin_reason, acme().is_top, acme().pinned_at], [200, pgStamp(NOW + 30 * DAY), "Seif's intro", true, pgStamp(NOW)], 'Undo of an unpin brings the pin back whole');
  assert.equal((await applyPin(sb, { businessId: B, type: 'target', id: T.quarry, body: { action: 'unpin' }, now: at(0) })).body.code, 'not_pinned');
  assert.deepEqual([(await applyPin(sb, { businessId: B, type: 'employer', id: E.acme, body: { action: 'star' } })).status, (await applyPin(sb, { businessId: B, type: 'visitor', id: E.acme, body: { action: 'pin' } })).status, (await applyPin(sb, { businessId: B, type: 'employer', id: randomUUID(), body: { action: 'pin' } })).status, (await applyPin(sb, { businessId: B, type: 'employer', id: E.acme, body: { action: 'renew', reason: 'x'.repeat(141) } })).status], [400, 400, 404, 400]);
  assert.ok(!/@/.test(JSON.stringify(sb.db.sales_flow_events)));
});

test('a target is pinned without a star column; an as-it-is pin (a P3 from before the rename) unpins with its priority; a pin that ran out can be pinned again', async () => {
  const sb = fakeSupabase(seed());
  const t = await applyPin(sb, { businessId: B, userId: JACK, type: 'target', id: T.quarry, body: { action: 'pin', reason: 'big logo' }, now: at(0) });
  const quarry = sb.db.sales_targets[0];
  assert.deepEqual([t.status, quarry.pinned_until, quarry.pin_reason, 'is_top' in quarry, sb.db.sales_flow_events[0].record_type], [200, pgStamp(NOW + 30 * DAY), 'big logo', false, 'target']);
  const held = sb.db.sales_opportunities[1];
  const un = await applyPin(sb, { businessId: B, userId: JACK, type: 'employer', id: E.asis, body: { action: 'unpin' }, now: at(0) });
  assert.deepEqual([un.status, held.priority, held.priority_set_at, held.pinned_until], [200, null, null, null]);
  assert.equal(pinOverride(held, NOW), null, 'nothing clamps it any more');
  await undoFlow(sb, { businessId: B, eventId: un.body.event.id, byUser: JACK, now: at(0) });
  assert.deepEqual([held.priority, pinState(held, NOW).level], [3, 3]);
  const again = await applyPin(sb, { businessId: B, userId: JACK, type: 'employer', id: E.asis, body: { action: 'pin', reason: 'now a real pin' }, now: at(19) });
  assert.deepEqual([again.status, pinState(held, NOW + 19 * DAY).level, held.pin_reason], [200, 1, 'now a real pin'], 'after it ran out a fresh pin is a P1 pin');
});

test('a partner is pinned through the hot signal (hot = pinned): its own event row, renew, hot off unpins, the partner Undo restores the pin columns', async () => {
  const sb = fakeSupabase(seed());
  const harbor = () => sb.db.sales_goals[0];
  const pin = await applyPin(sb, { businessId: B, userId: JACK, type: 'partner', id: P.harbor, body: { action: 'pin', reason: 'wants a pilot' }, now: at(0) });
  assert.equal(pin.status, 200, JSON.stringify(pin.body));
  assert.deepEqual([harbor().hot, harbor().pinned_until, harbor().pin_reason, harbor().pinned_by, harbor().priority, pin.body.undo.kind, pin.body.pin.level], [true, pgStamp(NOW + 30 * DAY), 'wants a pilot', JACK, 2, 'partner', 1]);
  const ev = sb.db.sales_partner_events[0];
  assert.deepEqual([ev.event, ev.meta.hot, ev.meta.pin, ev.meta.prev.hot, ev.meta.prev.pinned_until, ev.by_user, sb.db.sales_flow_events.length], ['hot', true, 'pin', false, null, JACK, 0]);
  await assert.rejects(() => applyPartnerSignal(sb, { businessId: B, goalId: P.harbor, signal: { type: 'hot', hot: true }, byUser: JACK, now: at(1) }), /already hot/);
  const renew = await applyPin(sb, { businessId: B, userId: CYRUS, type: 'partner', id: P.harbor, body: { action: 'renew' }, now: at(5) });
  assert.deepEqual([renew.status, harbor().pinned_until, harbor().pin_reason, sb.db.sales_partner_events[1].meta.pin], [200, pgStamp(NOW + 35 * DAY), 'wants a pilot', 'renew']);
  // the old 🔥 button still works: hot off = unpin
  const off = await applyPartnerSignal(sb, { businessId: B, goalId: P.harbor, signal: { type: 'hot', hot: false }, byUser: JACK, now: at(6) });
  assert.deepEqual([harbor().hot, harbor().pinned_until, harbor().pin_reason, harbor().priority], [false, null, null, 2], 'the typed partner priority is left alone');
  await undoPartnerSignal(sb, { businessId: B, goalId: P.harbor, eventId: off.event.id, byUser: JACK, now: new Date() }); // the event's recorded_at is the wall clock
  assert.deepEqual([harbor().hot, harbor().pinned_until, harbor().pin_reason, harbor().pinned_at], [true, pgStamp(NOW + 35 * DAY), 'wants a pilot', pgStamp(NOW)], 'Undo brings the pin back whole');
  // a hot partner whose pin ran out can be made hot (pinned) again
  const later = await applyPartnerSignal(sb, { businessId: B, goalId: P.harbor, signal: { type: 'hot', hot: true, reason: 'second look' }, byUser: JACK, now: at(60) });
  assert.deepEqual([later.goal.pinned_until, later.goal.pin_reason], [pgStamp(NOW + 90 * DAY), 'second look']);
  await assert.rejects(() => applyPartnerSignal(sb, { businessId: B, goalId: P.harbor, signal: { type: 'hot', hot: true, renew: true, reason: 'x'.repeat(141) }, byUser: JACK, now: at(61) }), /at most 140/);
});

test('the five grouped bars always sum to the score: an open company, a pinned one (the lift), one held under its score, a closed one, an empty one', () => {
  const visit = { visits_7d: 6, unique_visitors_7d: 3, top_paths: [{ path: '/pricing' }], us_500: true, last_visit: '2026-11-12' };
  const base = { type: 'employer', name: 'Zz Acme', stage: 'contacted', employees: 6000, source: { kind: 'inbound' }, visit, people: [{ title: 'VP People', is_buyer: true }], heat: { replied: true, clicks: 1, opens: 2 }, last_touch_at: new Date(NOW - DAY).toISOString() };
  const cases = [
    scoreCompany(base, DEFAULT_WEIGHTS, { now: NOW }),
    scoreCompany({ type: 'target', name: 'Zz Quiet', stage: 'researching', override: { priority: 1, not_a_fit: false, set_at: new Date(NOW).toISOString() } }, DEFAULT_WEIGHTS, { now: NOW }),
    scoreCompany({ ...base, override: { priority: 3, not_a_fit: false, set_at: new Date(NOW).toISOString() } }, DEFAULT_WEIGHTS, { now: NOW }),
    scoreCompany({ ...base, stage: 'lost' }, DEFAULT_WEIGHTS, { now: NOW }),
    scoreCompany({}, DEFAULT_WEIGHTS, { now: NOW }),
  ];
  for (const s of cases) {
    const g = groupScore(s.components, s.score);
    assert.deepEqual(Object.keys(g), GROUP_ORDER);
    assert.equal(g.heat + g.fit + g.impact + g.recency + g.pin, s.score, JSON.stringify({ g, score: s.score }));
    assert.equal(g.heat + g.fit + g.impact + g.recency, COMPONENTS.reduce((n, k) => n + s.components[k].points, 0), 'every component is in exactly one bar');
  }
  const [open, pinned, held] = cases.map(s => groupScore(s.components, s.score));
  assert.equal(open.pin, 0, 'nothing clamps an open company');
  assert.ok(pinned.pin > 0 && cases[1].score === 60, `a pinned company reads "its own points + the pin": ${JSON.stringify(pinned)}`);
  assert.ok(held.pin < 0 && cases[2].score === 39, `held at P3 under its own score: ${JSON.stringify(held)}`);
  assert.deepEqual([open.impact, cases[0].components.source.points + cases[0].components.stage.points], [14, 14], 'impact = source + stage');
});

test('the Why line: size · visits this week · source word · stage + next date · pin reason, in that order, and only what is known', () => {
  const row = { employees: 6200, stage: 'meeting_set', components: { visits: { inputs: { visits_7d: 3, decayed: false } }, source: { inputs: { kind: 'partner_referral', via_upside: true, named: true } } } };
  const pin = { level: 1, held: false, reason: "Seif's intro" };
  assert.equal(whyLine(row, { nextDate: '2026-11-18', pin }), "5,000+ employees · 3 visits this week · Brad referral · meeting set, next Nov 18 · pinned: Seif's intro");
  assert.equal(whyLine({ employees: null, stage: 'researching', components: {} }), 'no signal yet');
  assert.equal(whyLine({ employees: 150, stage: 'target', components: { visits: { inputs: { visits_7d: 1, decayed: false } } } }), 'under 200 employees · 1 visit this week');
  assert.equal(whyLine({ employees: 900, stage: 'contacted', components: { visits: { inputs: { visits_7d: 9, decayed: true } }, source: { inputs: { kind: 'partner_referral' } } } }, { partnerName: 'Zz Harbor Lane', pin: { level: 3, held: true, reason: null } }), '200–999 employees · Zz Harbor Lane referral · contacted · held at P3');
  assert.deepEqual([sizeWord(1000), sizeWord(4999), sizeWord(199), sizeWord(null)], ['1,000–4,999 employees', '1,000–4,999 employees', 'under 200 employees', null]);
  assert.deepEqual([sourceWord({ components: { source: { inputs: { kind: 'partner_referral', via_upside: true, named: false } } } }), sourceWord({ components: { source: { inputs: { kind: 'inbound' } } } }), sourceWord({ components: { source: { inputs: { kind: 'website' } } } })], ['Upside list', 'inbound', null]);
});

test('GET goals/top-targets: the P1 pins first (newest pin first), then score; a held pin ranks by its score; owner / band / pinned / limit; closed, won and duplicate rows are out; names only', async () => {
  const score = (type, id, name, s, band, extra = {}, meta = {}) => ({ business_id: B, company_type: type, company_id: id, score: s, band, components: { ...Object.fromEntries(COMPONENTS.map(k => [k, { points: 0, inputs: {} }])), meta: { name, stage: 'contacted', owner_user_id: null, ...meta } }, source_kind: 'unknown', source_label: 'other', source_partner_id: null, closed: false, flagged_out: false, duplicate_of: null, override: null, computed_at: new Date(NOW).toISOString(), ...extra });
  const X = { top: randomUUID(), closed: randomUUID(), won: randomUUID(), dupe: randomUUID() };
  const data = seed();
  data.sales_opportunities[0] = { ...data.sales_opportunities[0], pinned_until: pgStamp(NOW + 20 * DAY), pinned_at: pgStamp(NOW - 10 * DAY), pinned_by: JACK, pin_reason: 'older pin', next_action_date: '2026-11-18' };
  data.sales_targets[0] = { ...data.sales_targets[0], pinned_until: pgStamp(NOW + 29 * DAY), pinned_at: pgStamp(NOW - DAY), pinned_by: CYRUS, pin_reason: 'newer pin' };
  data.sales_opportunities.push({ id: X.top, business_id: B, organization: 'Zz Top Score', stage: 'contacted', archived_at: null, ...noPin }, { id: X.closed, business_id: B, organization: 'Zz Closed', ...noPin }, { id: X.won, business_id: B, organization: 'Zz Won', ...noPin }, { id: X.dupe, business_id: B, organization: 'Zz Dupe', ...noPin });
  data.sales_company_scores = [
    score('employer', X.top, 'Zz Top Score', 78, 'P1', {}, { owner_user_id: CYRUS, employees: 6000 }),
    score('employer', E.acme, 'Zz Acme Health', 60, 'P1', {}, { owner_user_id: JACK }),
    score('target', T.quarry, 'Zz Quarry Labs', 60, 'P1', {}, { owner_user_id: CYRUS }),
    score('employer', E.asis, 'Zz Held College', 39, 'P3', {}, { owner_user_id: JACK }),
    score('partner', P.harbor, 'Zz Harbor Lane', 45, 'P2'),
    score('employer', X.closed, 'Zz Closed', 9, 'P4', { closed: true }), score('employer', X.won, 'Zz Won', 70, 'P1', { flagged_out: true }), score('employer', X.dupe, 'Zz Dupe', 66, 'P1', { duplicate_of: `employer:${X.top}` }),
  ];
  const sb = fakeSupabase(data);
  const all = await topTargets(sb, B, {}, { now: NOW });
  assert.equal(all.status, 200);
  assert.deepEqual(all.body.rows.map(r => [r.rank, r.name, r.score, r.pin ? (r.pin.held ? `held P${r.pin.level}` : 'pinned') : null]), [[1, 'Zz Quarry Labs', 60, 'pinned'], [2, 'Zz Acme Health', 60, 'pinned'], [3, 'Zz Top Score', 78, null], [4, 'Zz Harbor Lane', 45, null], [5, 'Zz Held College', 39, 'held P3']]);
  assert.deepEqual([all.body.n, all.body.total, all.body.book, all.body.pinned], [5, 5, 5, 3]);
  assert.deepEqual(all.body.rows.map(r => r.why), ['contacted · pinned: newer pin', 'contacted, next Nov 18 · pinned: older pin', '5,000+ employees · contacted', 'contacted', 'contacted · held at P3: priority set Nov 1']);
  assert.ok(all.body.rows.every(r => r.groups.heat + r.groups.fit + r.groups.impact + r.groups.recency + r.groups.pin === r.score));
  const mine = await topTargets(sb, B, { owner: 'me' }, { now: NOW, meId: JACK });
  assert.deepEqual([mine.body.rows.map(r => r.name), mine.body.pinned, mine.body.total], [['Zz Acme Health', 'Zz Held College'], 2, 2]);
  assert.deepEqual((await topTargets(sb, B, { owner: CYRUS, limit: '1' }, { now: NOW })).body.rows.map(r => r.name), ['Zz Quarry Labs']);
  assert.deepEqual((await topTargets(sb, B, { owner: 'unassigned' }, { now: NOW })).body.rows.map(r => r.name), ['Zz Harbor Lane']);
  assert.deepEqual((await topTargets(sb, B, { band: 'P1' }, { now: NOW })).body.rows.map(r => r.name), ['Zz Quarry Labs', 'Zz Acme Health', 'Zz Top Score']);
  assert.deepEqual((await topTargets(sb, B, { pinned: 'true' }, { now: NOW })).body.rows.map(r => r.name), ['Zz Quarry Labs', 'Zz Acme Health', 'Zz Held College']);
  assert.deepEqual((await topTargets(sb, B, {}, { now: NOW + 25 * DAY })).body.rows.slice(0, 2).map(r => [r.name, !!r.pin]), [['Zz Quarry Labs', true], ['Zz Top Score', false]], 'a pin that ran out stops leading');
  assert.deepEqual([parseTopQuery({ limit: '9999', band: 'P9', owner: 'nobody' }), [{ pin: { held: false, at: 'b' }, score: 1, name: 'a' }, { pin: null, score: 99, name: 'b' }].sort(pinFirst)[0].name], [{ owner: null, limit: 200, band: null, pinned: false }, 'a']);
  assert.ok(!/@/.test(JSON.stringify(all.body)));
});

test('Scout: "my top targets" / "<member>\'s top n" / "why is X a top target" route to the top-targets intent and read the same route; the ranked intent keeps "hot targets"', async () => {
  const ask = (q, extra = {}) => ({ q, mine: /\bmy\b/.test(q), company: [], limit: null, flags: {}, entity: null, band: null, source: null, ...extra });
  assert.deepEqual(['my top targets', "what are Cyrus's top targets", "cyrus's top 5", 'top 3 targets', 'why is Zz Acme Health a top target', 'hot targets Brad referred', 'who are our top partners'].map(q => isTopTargets(ask(q))), [true, true, true, true, true, false, false]);
  const intent = salesIntents[0];
  assert.deepEqual([intent.id, intent.rule, salesIntents.findIndex(i => i.id === 'top_targets') < salesIntents.findIndex(i => i.id === 'brief')], ['top_targets', TOP_TARGETS_RULE, true], 'it sits before the brief, so a named company in "why is X a top target" is answered from the ranking');
  const score = (type, id, name, s, band, meta = {}) => ({ business_id: B, company_type: type, company_id: id, score: s, band, components: { ...Object.fromEntries(COMPONENTS.map(k => [k, { points: 0, inputs: {} }])), meta: { name, stage: 'contacted', owner_user_id: null, ...meta } }, source_kind: 'unknown', source_label: 'other', source_partner_id: null, closed: false, flagged_out: false, duplicate_of: null, override: null, computed_at: new Date(NOW).toISOString() });
  const data = seed();
  data.business_members = [{ business_id: B, user_id: JACK, name: 'Jack Example', role: 'owner', profile: { display_name: 'Jack Example' } }, { business_id: B, user_id: CYRUS, name: 'Cyrus Example', role: 'member', profile: { display_name: 'Cyrus Example' } }];
  data.sales_targets[0] = { ...data.sales_targets[0], pinned_until: pgStamp(NOW + 29 * DAY), pinned_at: pgStamp(NOW - DAY), pinned_by: JACK, pin_reason: 'big logo' };
  data.sales_company_scores = [score('employer', E.acme, 'Zz Acme Health', 70, 'P1', { owner_user_id: JACK, employees: 6000 }), score('target', T.quarry, 'Zz Quarry Labs', 60, 'P1', { owner_user_id: CYRUS }), score('employer', E.asis, 'Zz Held College', 39, 'P3', { owner_user_id: CYRUS }), score('partner', P.harbor, 'Zz Harbor Lane', 45, 'P2')];
  const sb = fakeSupabase(data);
  const ctx = { businessId: B, auth: { user: { id: JACK } }, now: NOW };
  const mine = await intent.run(sb, { ...ctx, ask: ask('my top targets') });
  assert.deepEqual(mine.items.map(i => i.title), ['Zz Acme Health']);
  assert.match(mine.read, /goals\/top-targets \{"owner":"[0-9a-f-]+","limit":10\} · 1 of 1 · 0 pinned/);
  const cyrus = await intent.run(sb, { ...ctx, ask: ask("what are Cyrus's top 1 targets", { company: ['cyrus'] }) });
  assert.deepEqual(cyrus.items.map(i => [i.title, i.row.type, i.score]), [['Zz Quarry Labs', 'target', 60]], 'the member is named: his list, the pin first, cut to the number asked');
  assert.match(cyrus.items[0].text, /^Zz Quarry Labs · target · top target #1 · score 60 P1 · why: contacted · pinned: big logo · bars: heat 0 · fit 0 · impact 0 · recency 0 · pin 60 · pinned · 29 d left · unassigned$/);
  const team = await intent.run(sb, { ...ctx, ask: ask('top 3 targets', { limit: 3 }) });
  assert.deepEqual(team.items.map(i => i.title), ['Zz Quarry Labs', 'Zz Acme Health', 'Zz Harbor Lane']);
  const why = await intent.run(sb, { ...ctx, ask: ask('why is Zz Acme Health a top target', { company: ['Zz Acme Health'] }) });
  assert.deepEqual([why.items.length, why.items[0].title], [1, 'Zz Acme Health']);
  assert.match(why.items[0].text, /top target #2 · score 70 P1 · why: 5,000\+ employees · contacted/);
  assert.ok(!/@/.test(JSON.stringify([mine, cyrus, team, why])));
});

