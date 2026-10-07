// node --test api/sales/callNotesRoutes.test.mjs  (react-scripts' Jest only runs src/)
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchOwner, toProposals, similarTask, callCategory, noteHash } from './callNotesRoutes.js';

const JACK = '68e2a844-0000-4000-8000-000000000001', CYRUS = 'b8f32373-0000-4000-8000-000000000002';
const members = [{ id: JACK, name: 'Jack Carlson' }, { id: CYRUS, name: 'Cyrus Radjoo' }];
const ctx = { members, partners: [{ id: 'p1', name: 'BenefitHub' }], commitments: [], companies: [] };
const task = (owner, extra) => ({ text: 'Follow up with Norton', owner, due_date: null, link: null, company_name: null, steps: [], evidence: 'x', ...extra });

test('a non-member name never maps to a member', () => {
  for (const name of ['Seif', 'Seif Hassan', 'Steve', 'Christina', 'Ardish']) assert.equal(matchOwner(name, members), null, name);
  const out = toProposals({ tasks: [task('Seif'), task('Seif'), task('Seif')] }, ctx);
  assert.deepEqual(out.tasks.map(t => t.owner_user_id), [null, null, null]);
});

test('a member id from the model is not trusted - only a name resolves', () => {
  assert.equal(toProposals({ tasks: [task(CYRUS)] }, ctx).tasks[0].owner_user_id, null);
});

test('member names resolve: first name, full name, any case', () => {
  assert.equal(matchOwner('Jack', members), JACK);
  assert.equal(matchOwner('jack carlson', members), JACK);
  assert.equal(matchOwner('Cyrus', members), CYRUS);
  assert.equal(matchOwner('Jack Smith', members), null);
  assert.equal(matchOwner('Carlson', members), null);
  for (const v of [null, '', 'I', 'we', 42]) assert.equal(matchOwner(v, members), null);
});

test('two members sharing a first name - ambiguous stays unassigned', () => {
  const two = [...members, { id: 'x', name: 'Jack Lee' }];
  assert.equal(matchOwner('Jack', two), null);
  assert.equal(matchOwner('Jack Lee', two), 'x');
});

test('a task already made from an earlier call is flagged, a different one is not', () => {
  const recent = [{ id: 'r1', text: 'Follow up with Christina at Norton and Equifax' }, { id: 'r2', text: 'Send BenefitHub the merchant deck' }];
  assert.deepEqual(similarTask('Follow up with Christina at Norton & Equifax', recent), recent[0]);
  assert.equal(similarTask('Follow up with Brad at Upside', recent), null);
  assert.equal(similarTask('Send deck', recent), null);
  const out = toProposals({ tasks: [task(null, { text: 'Send BenefitHub the merchant deck' })] }, { ...ctx, recent });
  assert.deepEqual(out.tasks[0].similar_to, recent[1]);
});

test('re-pasting the same notes hashes the same; the category names the call', () => {
  assert.equal(noteHash('Jack will  send the deck\n'), noteHash('jack will send the deck'));
  assert.notEqual(noteHash('Jack will send the deck'), noteHash('Cyrus will send the deck'));
  assert.equal(callCategory('2026-10-07', 'Weekly sync'), 'From calls · Oct 7 · Weekly sync');
  assert.equal(callCategory('2026-10-07', null), 'From calls · Oct 7');
});
