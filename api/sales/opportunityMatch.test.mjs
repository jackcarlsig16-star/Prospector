import test from 'node:test';
import assert from 'node:assert/strict';
import { matchOpportunity, moveForward } from './opportunityMatch.js';
import { normName } from './normName.js';

const OPPS = [
  { id: 'o1', organization: 'Solidcore', stage: 'responded', apollo_account_id: 'ap-solid' },
  { id: 'o2', organization: 'Hilton', stage: 'target', apollo_account_id: null },
  { id: 'o3', organization: 'Nike, Inc.', stage: 'contacted', apollo_account_id: null },
  { id: 'o4', organization: 'Acme Co', stage: 'meeting', apollo_account_id: null },
];

test('the key drops brackets, punctuation, case, extra spaces and inc / llc / corp / co', () => {
  assert.equal(normName('[solidcore]'), 'solidcore');
  assert.equal(normName('  Nike,  Inc. '), 'nike');
  assert.equal(normName('Foo LLC'), normName('foo corp'));
  assert.equal(normName('Costco'), 'costco', 'a word ending in "co" is not a suffix');
});

test('match: apollo id first, then the key; never a partial name', () => {
  assert.equal(matchOpportunity(OPPS, { name: '[solidcore]' }).id, 'o1');
  assert.equal(matchOpportunity(OPPS, { name: 'Something else', apolloAccountId: 'ap-solid' }).id, 'o1');
  assert.equal(matchOpportunity(OPPS, { name: 'NIKE' }).id, 'o3');
  assert.equal(matchOpportunity(OPPS, { name: 'acme' }).id, 'o4');
  assert.equal(matchOpportunity(OPPS, { name: 'Hilton Grand Vacations' }), null);
  assert.equal(matchOpportunity(OPPS, { name: 'Hilton Grand Vacations', apolloAccountId: 'ap-none' }), null);
  assert.equal(matchOpportunity(OPPS, { name: '' }), null);
});

test('moveForward: forward moves, backwards and parking a live deal never write', async () => {
  const writes = [];
  const supabase = { from: () => ({ update: patch => ({ eq: (_, id) => ({ select: () => ({ single: async () => { writes.push([id, patch.stage]); return { data: { id, stage: patch.stage }, error: null }; } }) }) }) }) };
  assert.equal((await moveForward(supabase, OPPS[3], 'responded')).stage, 'meeting');
  assert.equal((await moveForward(supabase, OPPS[3], 'nurture')).stage, 'meeting');
  assert.equal((await moveForward(supabase, OPPS[0], 'responded')).stage, 'responded');
  assert.equal((await moveForward(supabase, OPPS[2], 'responded')).stage, 'responded');
  assert.deepEqual(writes, [['o3', 'responded']]);
});
