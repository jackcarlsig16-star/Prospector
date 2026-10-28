// node --test api/sales/stageMarks.test.mjs  (react-scripts' Jest only runs src/)
// brad-attribution-v1 Stage 2 - one record's funnel (Journey line), Mark stage PUT / DELETE (validation, replace with
// previous for Undo, Upside lock, workspace check), getSource carrying the journey, the Brief's Journey ref line.
// Invented companies on .example; 0 network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { recordFunnel, putMark, deleteMark, validateMark, isLocked } from './stageMarks.js';
import { getSource } from './sourceRoutes.js';
import { briefLines } from './companyBrief.js';

const B = randomUUID(), OTHER = randomUUID(), JACK = randomUUID(), UPSIDE = randomUUID();
const ID = { adp: randomUUID(), harbor: randomUUID(), locked: randomUUID(), foreign: randomUUID() };
const NOW = new Date('2026-10-28T19:00:00Z');
const seed = () => fakeSupabase({
  sales_goals: [
    { id: UPSIDE, business_id: B, goal_type: 'partnership', name: 'Upside', source_kind: null, created_at: '2026-10-01T00:00:00Z' },
    { id: ID.harbor, business_id: B, goal_type: 'partnership', name: 'Zz Harbor Lane', source_kind: 'person_referral', source_person: 'Ann', source_partner_id: null, source_set_by: JACK, source_set_at: '2026-10-18T18:00:00Z', owner_team: 'homelover', no_double_touch: false, created_at: '2026-10-10T00:00:00Z' },
  ],
  sales_opportunities: [
    { id: ID.adp, business_id: B, organization: 'Zz ADP', source_kind: 'partner_referral', source_partner_id: UPSIDE, source_person: 'Brad', source_set_by: null, source_set_at: '2026-10-26T20:00:00Z', owner_team: 'both', no_double_touch: false, created_at: '2026-10-15T17:00:00Z' },
    { id: ID.locked, business_id: B, organization: 'Zz Locked Co', source_kind: 'partner_referral', source_partner_id: UPSIDE, source_person: 'Brad', owner_team: 'upside', no_double_touch: true, created_at: '2026-10-15T17:00:00Z' },
    { id: ID.foreign, business_id: OTHER, organization: 'Zz Elsewhere', owner_team: null, created_at: '2026-10-15T17:00:00Z' },
  ],
  sales_targets: [],
  web_visits: [{ id: 1, business_id: B, company_name: 'ZZ ADP', matched_type: null, matched_id: null, seen_from: '2026-10-20', pulled_on: '2026-10-21' }, { id: 2, business_id: OTHER, company_name: 'Zz ADP', seen_from: '2026-10-01' }],
  sales_prospect_state: [{ business_id: B, contact_id: 'c1', opportunity_id: ID.adp, goal_id: null }],
  sales_email_messages: [{ business_id: B, contact_id: 'c1', apollo_message_id: 'm1', replied: true, replied_at: '2026-10-24T17:00:00Z', delivered_at: '2026-10-22T17:00:00Z', reply_class: 'follow_up_question' }],
  sales_partner_events: [{ id: 1, business_id: B, goal_id: ID.harbor, event: 'status', to_status: 'meeting_set', at: '2026-10-25T18:00:00Z' }],
  sales_opportunity_events: [{ id: 1, business_id: B, opportunity_id: ID.adp, event_type: 'created', to_stage: 'target', changed_at: '2026-10-15T17:00:00Z' }],
  sales_week_goals: [], sales_signals: [], sales_stage_marks: [], sales_source_events: [],
  business_members: [{ business_id: B, user_id: JACK, name: 'Jack Carlson' }],
});

test('recordFunnel: one record\'s dated rows only - visit by normName, positive reply via its contact, partner status - plus the journey with the referrer; Upside lock = upside/both AND no double touch', async () => {
  const sb = seed();
  const adp = await recordFunnel(sb, { businessId: B, type: 'employer', id: ID.adp });
  assert.deepEqual([adp.funnel.referred, adp.funnel.visited, adp.funnel.replied, adp.funnel.meeting], ['2026-10-15', '2026-10-20', '2026-10-24', null]);
  assert.equal(adp.journey, 'Referred by Brad (Upside) Oct 15 → Visited Oct 20 → Replied Oct 24 → Meeting — → Pilot —');
  assert.equal(adp.locked, false, 'owner_team both without no double touch is not locked');
  const harbor = await recordFunnel(sb, { businessId: B, type: 'partner', id: ID.harbor });
  assert.deepEqual([harbor.funnel.referred, harbor.funnel.meeting, harbor.funnel.src.meeting], ['2026-10-18', '2026-10-25', 'partner status -> meeting_set']);
  assert.equal(isLocked({ owner_team: 'upside', no_double_touch: true }), true);
  assert.equal(isLocked({ owner_team: 'homelover', no_double_touch: true }), false);
});

test('validateMark: a known stage, a real past LA day, a note <= 200 with no address or phone', () => {
  const today = '2026-10-28';
  assert.deepEqual(validateMark({ stage: 'meeting', at: '2026-10-12', note: '  coffee at their office ' }, { today }).mark, { stage: 'meeting', at: '2026-10-12', note: 'coffee at their office' });
  for (const [body, msg] of [[{ stage: 'demo', at: '2026-10-12' }, /stage/], [{ stage: 'meeting', at: '10/12/2026' }, /YYYY-MM-DD/], [{ stage: 'meeting', at: '2026-02-30' }, /YYYY-MM-DD/], [{ stage: 'meeting', at: '2026-10-29' }, /future/], [{ stage: 'meeting', at: '2001-01-01' }, /far back/],
    [{ stage: 'meeting', at: '2026-10-12', note: 'ask ann@example.com' }, /address or phone/], [{ stage: 'meeting', at: '2026-10-12', note: 'call 312 555 0100' }, /address or phone/], [{ stage: 'meeting', at: '2026-10-12', note: 'x'.repeat(201) }, /200/]]) {
    assert.match(validateMark(body, { today }).error || '', msg, JSON.stringify(body));
  }
});

test('PUT / DELETE goals/stage-marks: one mark per record + stage (a second PUT replaces, returning the previous for Undo), the funnel reads it, the record is never edited; locked 409; another workspace\'s record 404; delete falls back to the dated rows', async () => {
  const sb = seed();
  const before = JSON.stringify(await sb.from('sales_opportunities').select('*').eq('id', ID.adp).maybeSingle());
  const first = await putMark(sb, { businessId: B, type: 'employer', id: ID.adp, userId: JACK, body: { stage: 'meeting', at: '2026-10-26', note: 'Intro call with Brad' }, now: NOW });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.previous, null);
  assert.deepEqual([first.body.funnel.meeting, first.body.funnel.src.meeting], ['2026-10-26', 'marked by hand']);
  assert.deepEqual(first.body.marks, [{ stage: 'meeting', at: '2026-10-26', note: 'Intro call with Brad', reason: 'manual', by: 'Jack' }]);
  const second = await putMark(sb, { businessId: B, type: 'employer', id: ID.adp, userId: JACK, body: { stage: 'meeting', at: '2026-10-25' }, now: NOW });
  assert.deepEqual(second.body.previous, { stage: 'meeting', at: '2026-10-26', note: 'Intro call with Brad' });
  assert.equal((await sb.from('sales_stage_marks').select('id').eq('business_id', B)).data.length, 1, 'replaced, not added');
  assert.equal(second.body.funnel.meeting, '2026-10-25');
  // A hand mark earlier than a dated row wins; a later one never moves the dated row's date.
  const late = await putMark(sb, { businessId: B, type: 'employer', id: ID.adp, userId: JACK, body: { stage: 'visited', at: '2026-10-27' }, now: NOW });
  assert.deepEqual([late.body.funnel.visited, late.body.funnel.src.visited], ['2026-10-20', 'web_visits (name)']);
  assert.equal(JSON.stringify(await sb.from('sales_opportunities').select('*').eq('id', ID.adp).maybeSingle()), before, 'the record itself is untouched');
  assert.equal((await putMark(sb, { businessId: B, type: 'employer', id: ID.locked, userId: JACK, body: { stage: 'meeting', at: '2026-10-25' }, now: NOW })).status, 409);
  assert.equal((await deleteMark(sb, { businessId: B, type: 'employer', id: ID.locked, stage: 'meeting' })).status, 409);
  assert.equal((await putMark(sb, { businessId: B, type: 'employer', id: ID.foreign, userId: JACK, body: { stage: 'meeting', at: '2026-10-25' }, now: NOW })).status, 404);
  assert.equal((await putMark(sb, { businessId: B, type: 'visitor', id: ID.adp, userId: JACK, body: { stage: 'meeting', at: '2026-10-25' }, now: NOW })).status, 400);
  assert.equal((await putMark(sb, { businessId: B, type: 'employer', id: ID.adp, userId: JACK, body: { stage: 'meeting', at: '2026-11-01' }, now: NOW })).status, 400);
  assert.equal((await deleteMark(sb, { businessId: B, type: 'employer', id: ID.adp, stage: 'nope' })).status, 400);
  const del = await deleteMark(sb, { businessId: B, type: 'employer', id: ID.adp, stage: 'meeting' });
  assert.equal(del.status, 200);
  assert.equal(del.body.funnel.meeting, null);
  assert.deepEqual(del.body.marks.map(m => m.stage), ['visited']);
});

test('getSource carries the journey; the Brief gets the chain as one ref line', async () => {
  const sb = seed();
  const r = await getSource(sb, { businessId: B, type: 'employer', id: ID.adp });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.journey.journey, 'Referred by Brad (Upside) Oct 15 → Visited Oct 20 → Replied Oct 24 → Meeting — → Pilot —');
  assert.equal(r.body.journey.locked, false);
  const lines = briefLines({ type: 'employer', name: 'Zz ADP', score: null, sourceRow: { source_kind: 'partner_referral', source_person: 'Brad' }, sourcePartner: 'Upside', journey: r.body.journey.journey });
  const j = lines.find(l => l.text.startsWith('Journey:'));
  assert.equal(j.kind, 'source');
  assert.equal(j.text, 'Journey: Referred by Brad (Upside) Oct 15 → Visited Oct 20 → Replied Oct 24 → Meeting — → Pilot —');
  assert.ok(!briefLines({ type: 'employer', name: 'Zz ADP', score: null }).some(l => l.text.startsWith('Journey:')), 'no journey, no line');
});
