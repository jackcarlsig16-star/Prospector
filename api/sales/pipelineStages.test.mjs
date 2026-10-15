import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGE_ENUM, STAGE_ORDER, DEFAULT_PROBABILITY, compareStages, bulkStageRefusal } from './pipelineStages.js';
import { pipelineKpis } from './goalsReportRoutes.js';
import { movementBuckets, importOpportunities } from './pipelineRoutes.js';

test('nurture / on_hold are side lanes: in the enum, off the linear path, probability 0', () => {
  for (const s of ['nurture', 'on_hold']) {
    assert.ok(STAGE_ENUM.includes(s));
    assert.ok(!STAGE_ORDER.includes(s));
    assert.equal(DEFAULT_PROBABILITY[s], 0);
    assert.equal(compareStages('meeting', s), null);
    assert.equal(compareStages(s, 'contacted'), null);
  }
  assert.equal(compareStages('target', 'meeting'), 'forward');
  assert.equal(compareStages('meeting', 'contacted'), 'back');
});

test('bulk rule: never backwards; park only from target/contacted; out of a side lane is allowed', () => {
  assert.equal(bulkStageRefusal('meeting', 'contacted'), 'stage contacted is behind the current stage meeting');
  assert.equal(bulkStageRefusal('responded', 'nurture'), "can't park responded as nurture");
  assert.equal(bulkStageRefusal('proposal_pilot', 'on_hold'), "can't park proposal_pilot as on_hold");
  assert.equal(bulkStageRefusal('target', 'nurture'), null);
  assert.equal(bulkStageRefusal('contacted', 'on_hold'), null);
  assert.equal(bulkStageRefusal('nurture', 'on_hold'), null);
  assert.equal(bulkStageRefusal('on_hold', 'meeting'), null);
  assert.equal(bulkStageRefusal('nurture', 'target'), null);
  assert.equal(bulkStageRefusal('meeting', 'meeting'), null);
  assert.equal(bulkStageRefusal('contacted', 'meeting'), null);
});

test('weekly KPIs leave side lanes out of expected launches and the active counts', () => {
  const opps = [
    { stage: 'meeting', covered_lives: 100, expected_launch: '2026-11-01' },
    { stage: 'nurture', covered_lives: 500, expected_launch: '2026-11-01' },
    { stage: 'on_hold', covered_lives: 500, expected_launch: '2026-11-02' },
    { stage: 'lost', covered_lives: 500, expected_launch: '2026-11-03' },
    { stage: 'proposal_pilot', covered_lives: 50, expected_launch: null },
  ];
  assert.deepEqual(pipelineKpis(opps, '2026-10-18'), {
    qualified_opps: 2, covered_lives_pipeline: 150, proposals_outstanding: 1, verbal_commitments: 0, launches_90d: 1,
  });
});

test('movement: a row ending in nurture / on_hold is in no bucket (not even stalled); lost and forward still work', () => {
  const opps = [
    { id: 'a', stage: 'nurture', next_action_date: '2026-10-01' }, { id: 'b', stage: 'on_hold' }, { id: 'c', stage: 'lost' }, { id: 'd', stage: 'meeting' },
  ];
  const ev = (opportunity_id, event_type, to_stage, changed_at) => ({ opportunity_id, event_type, to_stage, changed_at });
  const events = [
    ev('a', 'created', 'meeting', '2026-09-01T00:00:00Z'), ev('a', 'stage_change', 'nurture', '2026-09-20T00:00:00Z'),
    ev('b', 'created', 'contacted', '2026-09-01T00:00:00Z'), ev('b', 'stage_change', 'on_hold', '2026-10-10T00:00:00Z'),
    ev('c', 'created', 'meeting', '2026-09-01T00:00:00Z'), ev('c', 'stage_change', 'lost', '2026-10-10T00:00:00Z'),
    ev('d', 'created', 'contacted', '2026-09-01T00:00:00Z'), ev('d', 'stage_change', 'meeting', '2026-10-10T00:00:00Z'),
  ];
  const b = movementBuckets(opps, events, '2026-10-05', '2026-10-15');
  assert.deepEqual(Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.map(o => o.id)])),
    { moved_forward: ['d'], moved_back: [], added: [], lost: ['c'], stalled: [] });
});

function fakeSupabase(rows) {
  const updates = [];
  const inserts = [];
  const chain = result => { const c = { eq: () => c, is: () => c, then: (ok, ko) => Promise.resolve(result).then(ok, ko) }; return c; };
  return {
    updates, inserts,
    from: () => ({
      select: () => chain({ data: rows, error: null }),
      update: payload => ({ eq: (_, id) => { updates.push({ id, ...payload }); return Promise.resolve({ error: null }); } }),
      insert: payload => { inserts.push(payload); return { select: () => ({ single: async () => ({ data: { id: `new-${inserts.length}` }, error: null }) }) }; },
    }),
  };
}

test('CSV import refuses a backwards row and a responded -> nurture row, keeps the stage, still updates the other fields', async () => {
  const db = fakeSupabase([
    { id: 'm', organization: 'Meeting Co', stage: 'meeting' },
    { id: 'r', organization: 'Responded Co', stage: 'responded' },
    { id: 't', organization: 'Target Co', stage: 'target' },
  ]);
  const csv = 'organization,stage,next_action\nMeeting Co,contacted,call back\nResponded Co,nurture,park it\nTarget Co,nurture,later\nNew Co,on_hold,\n';
  const r = await importOpportunities(db, 'biz', csv);
  assert.equal(r.inserted, 1);
  assert.equal(r.updated, 3);
  assert.deepEqual(r.errors, [
    { row: 1, reason: 'stage contacted is behind the current stage meeting - kept meeting' },
    { row: 2, reason: "can't park responded as nurture - kept responded" },
  ]);
  const byId = Object.fromEntries(db.updates.map(u => [u.id, u]));
  assert.equal(byId.m.stage, undefined);
  assert.equal(byId.m.next_action, 'call back');
  assert.equal(byId.r.stage, undefined);
  assert.equal(byId.t.stage, 'nurture');
  assert.equal(db.inserts[0].stage, 'on_hold');
});
