// node --test api/sales/partnerTouch.test.mjs  (partner-touch-log-v1)
import test from 'node:test';
import assert from 'node:assert/strict';
import { touchStageMove } from '../../src/constants/partnerPipeline.js';
import { plan, touchTime } from './partnerSignals.js';
import { partnerWeekMetrics } from './partnerMetrics.js';
import { previewTouch } from './partnersRoutes.js';

// Wed Oct 7 2026, 1pm LA.
const NOW = new Date('2026-10-07T20:00:00Z');
const goal = extra => ({ id: 'g1', name: 'BenefitHub', pipeline_status: 'not_started', last_touch_at: null, first_email_at: null, ...extra });
const touch = extra => ({ type: 'touch', touch_type: 'email', date: '2026-09-30', ...extra });
const data = (partners, events) => {
  const undone = new Set(events.filter(e => e.event === 'undo').map(e => e.meta?.undid));
  const byGoal = new Map();
  for (const e of [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) { if (!byGoal.has(e.goal_id)) byGoal.set(e.goal_id, []); byGoal.get(e.goal_id).push(e); }
  return { partners, events, undone, byGoal };
};

test('auto stage: outbound -> Sent only before contact; meeting -> Meeting if behind; event/other never', () => {
  for (const s of ['not_started', 'researching', 'first_email_drafted', null]) for (const t of ['email', 'call', 'linkedin']) assert.equal(touchStageMove(s, t), 'first_email_sent', `${s} ${t}`);
  for (const s of ['first_email_sent', 'in_sequence', 'replied', 'meeting_set', 'live', 'paused']) assert.equal(touchStageMove(s, 'email'), null, s);
  assert.equal(touchStageMove('replied', 'meeting'), 'meeting_set');
  assert.equal(touchStageMove('not_started', 'meeting'), 'meeting_set');
  for (const s of ['meeting_set', 'proposal_pilot', 'live', 'paused']) assert.equal(touchStageMove(s, 'meeting'), null, s);
  for (const t of ['event', 'other']) assert.equal(touchStageMove('not_started', t), null);
});

test('explicit stage wins but never backwards; none = no move', () => {
  assert.equal(touchStageMove('not_started', 'event', 'replied'), 'replied');
  assert.equal(touchStageMove('paused', 'email', 'replied'), 'replied');
  assert.ok(touchStageMove('meeting_set', 'email', 'first_email_sent').error);
  assert.ok(touchStageMove('in_sequence', 'email', 'first_email_sent').error);
  assert.ok(touchStageMove('replied', 'email', 'paused').error);
  assert.equal(touchStageMove('not_started', 'email', 'none'), null);
  assert.equal(touchStageMove('replied', 'email', 'replied'), null);
});

test('a backdated touch is dated midday that LA day; today keeps the real time', () => {
  assert.equal(touchTime('2026-09-30', NOW).toISOString(), '2026-09-30T19:00:00.000Z');
  assert.equal(touchTime('2026-10-07', NOW), NOW);
  const { patch, event } = plan(goal(), touch(), NOW);
  assert.equal(event.at, '2026-09-30T19:00:00.000Z');
  assert.deepEqual(patch, { pipeline_status: 'first_email_sent', last_touch_at: '2026-09-30T19:00:00.000Z', first_email_at: '2026-09-30' });
  assert.equal(event.from_status, 'not_started');
});

test("a backdated touch never pulls last touch / first email later, but does pull first email earlier", () => {
  const g = goal({ pipeline_status: 'replied', last_touch_at: '2026-10-06T16:00:00Z', first_email_at: '2026-10-05' });
  const { patch, event } = plan(g, touch({ date: '2026-10-01' }), NOW);
  assert.deepEqual(patch, { first_email_at: '2026-10-01' });
  assert.equal(event.to_status, null);
  assert.equal(event.from_status, null);
  const call = plan(g, touch({ touch_type: 'call', date: '2026-10-01' }), NOW);
  assert.deepEqual(call.patch, {});
});

test('touch validation: future date, bad type, contacts trimmed + deduped, stale screen', () => {
  assert.throws(() => plan(goal(), touch({ date: '2026-10-08' }), NOW), /future/);
  assert.throws(() => plan(goal(), touch({ touch_type: 'fax' }), NOW), /touch_type/);
  assert.throws(() => plan(goal(), touch({ contacts: 'Lisa' }), NOW), /contacts/);
  assert.throws(() => plan(goal(), touch({ move_to: 'nowhere' }), NOW), /move_to/);
  assert.throws(() => plan(goal({ pipeline_status: 'replied' }), touch({ expect: 'not_started' }), NOW), e => e.status === 409);
  assert.throws(() => plan(goal({ pipeline_status: 'meeting_set' }), touch({ move_to: 'first_email_sent' }), NOW), e => e.status === 409);
  const { event } = plan(goal(), touch({ contacts: [' Lisa  Park ', 'lisa park', 'Ken', ''], note: '  Merchant team ' }), NOW);
  assert.deepEqual(event.contact_names, ['Lisa Park', 'Ken']);
  assert.equal(event.note, 'Merchant team');
});

test('first-touched counts in the week the touch happened, once per partner, not after undo', () => {
  const partners = [goal(), goal({ id: 'g2', pipeline_status: 'replied' }), goal({ id: 'g3' })];
  const events = [
    // g1: logged today for Sep 30 (week of Sep 28)
    { id: 'e1', goal_id: 'g1', event: 'touch', touch_type: 'email', from_status: 'not_started', to_status: 'first_email_sent', at: '2026-09-30T19:00:00Z' },
    // g2: clicked straight to Replied this week, then a touch logged for Oct 1 (still this week? no - week of Sep 28)
    { id: 'e2', goal_id: 'g2', event: 'status', from_status: 'not_started', to_status: 'replied', at: '2026-10-06T16:00:00Z' },
    { id: 'e3', goal_id: 'g2', event: 'touch', touch_type: 'email', from_status: null, to_status: null, at: '2026-10-01T19:00:00Z' },
    // g3: an Event touch doesn't count; an undone email touch doesn't either
    { id: 'e4', goal_id: 'g3', event: 'touch', touch_type: 'event', from_status: null, to_status: null, at: '2026-10-05T19:00:00Z' },
    { id: 'e5', goal_id: 'g3', event: 'touch', touch_type: 'email', from_status: 'not_started', to_status: 'first_email_sent', at: '2026-10-05T19:00:00Z' },
    { id: 'e6', goal_id: 'g3', event: 'undo', from_status: 'first_email_sent', to_status: 'not_started', meta: { undid: 'e5' }, at: '2026-10-07T20:00:00Z' },
  ];
  const d = data(partners, events);
  assert.equal(partnerWeekMetrics(d, '2026-09-28', null, NOW.getTime()).partners_first_touched.value, 2);
  assert.equal(partnerWeekMetrics(d, '2026-10-05', null, NOW.getTime()).partners_first_touched.value, 0);
});

test("this week's stage = the real stage, even when a backdated touch moved it", () => {
  const partners = [goal({ tier: '1', pipeline_status: 'proposal_pilot' })];
  const events = [
    { id: 'a', goal_id: 'g1', event: 'status', from_status: 'replied', to_status: 'proposal_pilot', at: '2026-10-06T16:00:00Z' },
    { id: 'b', goal_id: 'g1', event: 'touch', touch_type: 'meeting', from_status: 'replied', to_status: 'meeting_set', at: '2026-10-02T19:00:00Z' },
  ];
  assert.equal(partnerWeekMetrics(data(partners, events), '2026-10-05', null, NOW.getTime()).partners_pilot_live.value, 1);
});

test('preview: stage change, week, and whether it becomes the first touch', () => {
  const d = data([goal(), goal({ id: 'g2' })], [{ id: 'x', goal_id: 'g2', event: 'status', from_status: 'first_email_drafted', to_status: 'first_email_sent', at: '2026-10-06T16:00:00Z' }]);
  assert.deepEqual(previewTouch(goal(), { touch_type: 'email', date: '2026-09-30' }, d, NOW),
    { goal_id: 'g1', name: 'BenefitHub', from_status: 'not_started', to_status: 'first_email_sent', at: '2026-09-30T19:00:00.000Z', week_start: '2026-09-28', first_touch: true });
  const earlier = previewTouch(goal({ id: 'g2', pipeline_status: 'first_email_sent' }), { touch_type: 'call', date: '2026-10-01' }, d, NOW);
  assert.equal(earlier.first_touch, true);
  assert.equal(earlier.replaces_first_touch_week, '2026-10-05');
  assert.equal(previewTouch(goal({ id: 'g2', pipeline_status: 'first_email_sent' }), { touch_type: 'call', date: '2026-10-07' }, d, NOW).first_touch, false);
  const bad = previewTouch(goal({ pipeline_status: 'meeting_set' }), { touch_type: 'email', date: '2026-10-01', move_to: 'replied' }, d, NOW);
  assert.equal(bad.status, 409);
});
