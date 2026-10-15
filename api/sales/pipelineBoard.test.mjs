import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBoard, parseBoardFilters } from './pipelineBoard.js';
import { boardStage, compareBoardRows, BOARD_COLOR_IDS } from '../../src/constants/pipelineBoard.js';
import { PIPELINE_STATUS_IDS } from '../../src/constants/partnerPipeline.js';
import { STAGE_ENUM } from './pipelineStages.js';
import { salesGate } from '../lib/requireAuth.js';

test('every partner stage maps to the spec color', () => {
  const want = {
    not_started: 'light', researching: 'gray', first_email_drafted: 'gray', first_email_sent: 'gray', in_sequence: 'gray',
    replied: 'blue', meeting_set: 'yellow', proposal_pilot: 'yellow', live: 'green', paused: 'faded',
  };
  assert.deepEqual(Object.keys(want).sort(), [...PIPELINE_STATUS_IDS].sort());
  for (const [s, c] of Object.entries(want)) {
    const r = boardStage('partner', { pipeline_status: s, category: '5. Rental Rewards' });
    assert.equal(r.color, c, s);
    assert.ok(r.stage_label, s);
  }
  assert.equal(boardStage('partner', {}).stage, 'not_started');
});

test('a current partner is green at any stage except paused', () => {
  const cat = '1. Current Partners (active)';
  assert.equal(boardStage('partner', { pipeline_status: 'not_started', category: cat }).color, 'green');
  assert.equal(boardStage('partner', { pipeline_status: 'replied', category: cat }).color, 'green');
  assert.equal(boardStage('partner', { pipeline_status: 'paused', category: cat }).color, 'faded');
  assert.equal(boardStage('partner', { pipeline_status: 'replied', category: '11. Professional' }).color, 'blue');
});

test('every employer stage maps to the spec color', () => {
  const want = {
    target: 'light', contacted: 'gray', responded: 'blue', meeting: 'yellow', proposal_pilot: 'yellow',
    verbal: 'green', contract: 'green', launched: 'green', nurture: 'faded', on_hold: 'faded', lost: 'faded',
  };
  assert.deepEqual(Object.keys(want).sort(), [...STAGE_ENUM].sort());
  for (const [s, c] of Object.entries(want)) {
    const r = boardStage('employer', { stage: s });
    assert.equal(r.color, c, s);
    assert.ok(r.stage_label, s);
  }
});

test('targets: proposed light, researching gray, accepted/rejected off the board; Apollo-only gray', () => {
  assert.equal(boardStage('target', { status: 'proposed' }).color, 'light');
  assert.equal(boardStage('target', { status: 'researching' }).color, 'gray');
  assert.equal(boardStage('target', { status: 'accepted' }), null);
  assert.equal(boardStage('target', { status: 'rejected' }), null);
  assert.equal(boardStage('apollo', {}).color, 'gray');
});

const state = () => ({
  partners: [
    { id: 'p1', name: 'Gallagher', pipeline_status: 'meeting_set', category: '3. Brokers', tier: '1', hot: true, owner_user_id: 'u1', owner_team: 'homelover', record_id: 'HLU-0001', next_step: 'Send deck', last_touch_at: '2026-10-10T00:00:00Z' },
    { id: 'p2', name: 'OneDigital', pipeline_status: 'replied', category: '3. Brokers', tier: '2', hot: false, owner_user_id: null, owner_team: 'upside' },
    { id: 'p3', name: 'Acme Partners', pipeline_status: 'live', category: '1. Current Partners (active)', tier: 'active', hot: false },
  ],
  opportunities: [
    { id: 'o1', organization: 'Solidcore', org_type: 'employer', stage: 'meeting', owner: 'Jack', owner_team: 'both', tier: '2', next_action: 'Call', next_action_date: '2026-10-20', is_top: true, apollo_account_id: 'A1' },
    { id: 'o2', organization: 'Big Union', org_type: 'membership', stage: 'contacted', owner: 'Cyrus', owner_team: null, tier: null, is_top: false },
    { id: 'o3', organization: 'Channel Co', org_type: 'channel_partner', stage: 'responded', is_top: false, apollo_account_id: 'A3' },
    { id: 'o4', organization: 'Early Bird', org_type: 'employer', stage: 'meeting', tier: '2', next_action_date: '2026-10-17', is_top: false },
  ],
  targets: [
    { id: 't1', name: 'New Target', status: 'proposed', owner_team: 'upside' },
    { id: 't2', name: 'Done Target', status: 'accepted' },
  ],
  sequenced: [
    { account_id: 'A1', name: 'Solidcore', first_sequenced_at: '2026-09-01T00:00:00Z', mailbox_email: 'jack@example.com' },
    { account_id: 'A3', name: 'Channel Co' },
    { account_id: 'A4', name: 'Solidcore Inc' },
    { account_id: 'A5', name: 'Fresh Co', mailbox_email: 'x@example.com' },
    { account_id: 'A5', name: 'Fresh Co' },
  ],
  memberNames: new Map([['u1', 'Jack']]),
});

test('board rows: partners + employer/membership opportunities + open targets, sorted by color, tier, due', () => {
  const rows = buildBoard(state());
  assert.deepEqual(rows.map(r => r.id), ['p3', 'p1', 'o4', 'o1', 'p2', 'o2', 't1']);
  const g = rows.find(r => r.id === 'p1');
  assert.deepEqual(g, {
    type: 'partner', id: 'p1', name: 'Gallagher', stage: 'meeting_set', stage_label: 'Meeting set', color: 'yellow',
    owner_team: 'homelover', owner: 'Jack', tier: '1', next_step: 'Send deck', next_step_due: null,
    last_touch_at: '2026-10-10T00:00:00Z', top: true, record_id: 'HLU-0001',
  });
  assert.equal(rows.find(r => r.id === 'o1').top, true);
  assert.equal(rows.find(r => r.id === 'o1').next_step_due, '2026-10-20');
});

test('Apollo-only rows only on request, excluding any company linked by Apollo id or org name', () => {
  assert.equal(buildBoard(state()).filter(r => r.type === 'apollo').length, 0);
  const apollo = buildBoard(state(), { includeApollo: true }).filter(r => r.type === 'apollo');
  assert.deepEqual(apollo.map(r => r.name), ['Fresh Co']);
});

test('filters: type, owner team (incl. unset), owner, tier, color, search', () => {
  const ids = f => buildBoard(state(), f).map(r => r.id);
  assert.deepEqual(ids({ type: 'partner' }), ['p3', 'p1', 'p2']);
  assert.deepEqual(ids({ type: 'target' }), ['t1']);
  assert.deepEqual(ids({ ownerTeam: 'upside' }), ['p2', 't1']);
  assert.deepEqual(ids({ ownerTeam: 'unset' }), ['p3', 'o4', 'o2']);
  assert.deepEqual(ids({ owner: 'jack' }), ['p1', 'o1']);
  assert.deepEqual(ids({ tier: '2' }), ['o4', 'o1', 'p2']);
  assert.deepEqual(ids({ color: 'yellow' }), ['p1', 'o4', 'o1']);
  assert.deepEqual(ids({ q: 'core' }), ['o1']);
});

test('no email, phone or Apollo id anywhere in the payload', () => {
  const s = state();
  s.partners[0].known_contacts = 'ann@gallagher.com 312-555-0100';
  const json = JSON.stringify(buildBoard(s, { includeApollo: true }));
  assert.ok(!json.includes('@'), 'no email');
  assert.ok(!/\d{3}[-. ]\d{3}[-. ]\d{4}/.test(json), 'no phone');
  assert.ok(!JSON.stringify(buildBoard(s)).includes('"A1"'), 'an opportunity\'s apollo_account_id never leaks');
  for (const r of buildBoard(s, { includeApollo: true })) {
    assert.deepEqual(Object.keys(r).sort(), ['color', 'id', 'last_touch_at', 'name', 'next_step', 'next_step_due', 'owner', 'owner_team', 'record_id', 'stage', 'stage_label', 'tier', 'top', 'type']);
  }
});

// The Apollo-only row's id is its account_id, for the click-through to the
// Companies view; Stage 3's export drops it.
test('Apollo-only rows: id = account_id, no record id, no mailbox', () => {
  const r = buildBoard(state(), { includeApollo: true }).find(x => x.type === 'apollo');
  assert.equal(r.id, 'A5');
  assert.equal(r.record_id, null);
});

test('filter parsing refuses bad enums; type=apollo implies the Apollo rows', () => {
  assert.match(parseBoardFilters({ type: 'nope' }).error, /type must be/);
  assert.match(parseBoardFilters({ owner_team: 'x' }).error, /owner_team/);
  assert.match(parseBoardFilters({ color: 'pink' }).error, /color/);
  assert.equal(parseBoardFilters({ type: 'all' }).filters.type, null);
  assert.equal(parseBoardFilters({ type: 'apollo' }).filters.includeApollo, true);
  assert.equal(parseBoardFilters({ include_apollo: 'true' }).filters.includeApollo, true);
  assert.equal(parseBoardFilters({}).filters.includeApollo, false);
});

test('sort: color order first, blanks last for tier and due', () => {
  const r = (color, tier, due, name) => ({ color, tier, next_step_due: due, name });
  const sorted = [r('gray', null, null, 'b'), r('green', '3', null, 'z'), r('gray', '1', null, 'c'), r('gray', '1', '2026-10-01', 'd')].sort(compareBoardRows);
  assert.deepEqual(sorted.map(x => x.name), ['z', 'd', 'c', 'b']);
  assert.deepEqual(BOARD_COLOR_IDS, ['green', 'yellow', 'blue', 'gray', 'light', 'faded']);
});

test('salesGate: a Viewer can GET the board, but not write', () => {
  process.env.SALES_ANALYTICS_BUSINESS_IDS = 'biz-1';
  const run = method => {
    let status = 200, nextCalled = false;
    const res = { status(s) { status = s; return this; }, json() { return this; } };
    salesGate({ method, params: { businessId: 'biz-1' }, auth: { isPlatformOwner: false, roles: new Map([['biz-1', 'viewer']]) } }, res, () => { nextCalled = true; });
    return { status, nextCalled };
  };
  assert.deepEqual(run('GET'), { status: 200, nextCalled: true });
  assert.equal(run('POST').nextCalled, false);
});
