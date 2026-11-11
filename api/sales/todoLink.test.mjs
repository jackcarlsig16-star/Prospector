import test from 'node:test';
import assert from 'node:assert/strict';
import { linkFor, linkRecords } from './todoLink.js';

const R = [{ type: 'target', id: 't1', name: 'Shortlister' }, { type: 'opportunity', id: 'o1', name: 'test' }, { type: 'opportunity', id: 'o2', name: 'Target' }, { type: 'partner', id: 'p1', name: 'Brown & Brown' },
  { type: 'partner', id: 'p2', name: 'Access Development' }, { type: 'partner', id: 'p3', name: 'Justworks' }, { type: 'opportunity', id: 'o3', name: 'Flowserve Corporation' }, { type: 'target', id: 't3', name: 'Flowserve Corporation' }, { type: 'opportunity', id: 'o4', name: 'Walmart, Inc.' }];

test('T7: a to-do that names ONE record links to it; an ordinary word that happens to be a record\'s name does not; two records = choices; none = null', () => {
  assert.deepEqual(linkFor('Create a free Shortlister profile to increase RFP visibility', R), { link: { link_type: 'target', link_id: 't1', name: 'Shortlister' } });
  assert.deepEqual(linkFor('Send Jack the transcript and call notes from the Brown and Brown meeting', R).link.link_id, 'p1');
  assert.deepEqual(linkFor('Revisit Walmart relationship with Scott after retail busy season', R).link.link_id, 'o4');
  // the three false matches of the Nov 10 backfill
  assert.equal(linkFor('Have Seif send 5-10 test emails this week before full campaign launch', R), null);
  assert.equal(linkFor('Discuss with team how to get small companies live on the platform to test onboarding', R), null);
  assert.equal(linkFor("Refine first email: direct tone, no jargon, reference only target company's own website data", R), null);
  assert.deepEqual(linkFor('Check the Target account before Friday', R).link.link_id, 'o2');
  assert.deepEqual(linkFor('Follow up with Access Development and Justworks', R).choices.map(c => c.id).sort(), ['p2', 'p3']);
  assert.deepEqual(linkFor('Reach out to Flowserve Corporation contacts on LinkedIn', R).choices.map(c => c.type).sort(), ['opportunity', 'target']);
  assert.equal(linkFor('Call the broker on Thursday', R), null);
  assert.equal(linkFor('', R), null);
  assert.deepEqual(linkRecords({ partners: [{ id: 'p', name: 'A' }], opportunities: [{ id: 'o', organization: 'B' }], targets: [{ id: 't', name: 'C', status: 'researching' }, { id: 'x', name: 'D', status: 'rejected' }] }).map(r => `${r.type}:${r.id}`), ['partner:p', 'opportunity:o', 'target:t']);
});
