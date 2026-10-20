// node --test api/sales/stageGuard.test.mjs  (react-scripts' Jest only runs src/)
// sales-ia-v2 L3 (FIX partner-stage-server-guard) - a status signal to an
// earlier workflow step is refused unless allow_backward is sent; the sheet,
// Outlook and Apollo paths only ever move forward, so they never send it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { plan, isBackward, applyPartnerSignal, SignalError } from './partnerSignals.js';

const now = new Date('2026-10-20T20:00:00Z');
const goal = status => ({ id: 'g1', business_id: 'b1', pipeline_status: status, hot: false, last_touch_at: null, first_email_at: null });

test('isBackward: earlier step = back; same step (in_sequence vs first_email_sent), forward, paused either way = not back', () => {
  assert.equal(isBackward('replied', 'first_email_sent'), true);
  assert.equal(isBackward('live', 'not_started'), true);
  assert.equal(isBackward('researching', 'not_started'), true);
  assert.equal(isBackward('in_sequence', 'first_email_sent'), false);
  assert.equal(isBackward('first_email_sent', 'in_sequence'), false);
  assert.equal(isBackward('not_started', 'researching'), false);
  assert.equal(isBackward('paused', 'not_started'), false);
  assert.equal(isBackward('replied', 'paused'), false);
  assert.equal(isBackward(null, 'researching'), false);
});

test('plan: backward status without the flag is a 409 that names Jump to stage; with allow_backward it plans the move and marks the event backward; forward needs no flag', () => {
  assert.throws(() => plan(goal('replied'), { type: 'status', to: 'researching' }, now), e => e instanceof SignalError && e.status === 409 && /Jump to stage/.test(e.message));
  const back = plan(goal('replied'), { type: 'status', to: 'researching', allow_backward: true }, now);
  assert.deepEqual(back.patch, { pipeline_status: 'researching' });
  assert.deepEqual(back.event, { event: 'status', from_status: 'replied', to_status: 'researching', meta: { backward: true } });
  const fwd = plan(goal('researching'), { type: 'status', to: 'first_email_drafted' }, now);
  assert.deepEqual(fwd.event, { event: 'status', from_status: 'researching', to_status: 'first_email_drafted' });
  assert.throws(() => plan(goal('replied'), { type: 'status', to: 'researching', allow_backward: 'yes' }, now), e => e.status === 409);
  const resume = plan(goal('paused'), { type: 'status', to: 'not_started' }, now);
  assert.equal(resume.patch.pipeline_status, 'not_started');
});

test('applyPartnerSignal: the refused move writes nothing (no row change, no event); the flagged one writes both, prev kept for undo', async () => {
  const B = randomUUID(), G = randomUUID();
  const sb = fakeSupabase({ sales_goals: [{ id: G, business_id: B, goal_type: 'partnership', name: 'Gallagher', pipeline_status: 'meeting_set', hot: false }], sales_partner_events: [] });
  await assert.rejects(applyPartnerSignal(sb, { businessId: B, goalId: G, signal: { type: 'status', to: 'replied', expect: 'meeting_set' }, byUser: 'u1', now }), e => e.status === 409);
  assert.equal(sb.db.sales_goals[0].pipeline_status, 'meeting_set'); assert.equal(sb.db.sales_partner_events.length, 0);
  const { goal, event } = await applyPartnerSignal(sb, { businessId: B, goalId: G, signal: { type: 'status', to: 'replied', expect: 'meeting_set', allow_backward: true }, byUser: 'u1', now });
  assert.equal(goal.pipeline_status, 'replied'); assert.equal(event.meta.backward, true); assert.deepEqual(event.meta.prev, { pipeline_status: 'meeting_set', last_touch_at: null });
});
