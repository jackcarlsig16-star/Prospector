import test from 'node:test';
import assert from 'node:assert/strict';
import { companySteps, needsReach, STEPS } from './companySteps.js';

// company-workflow-v1 W1 - the guided steps, one "next" at a time. Made-up names.
const NOW = Date.parse('2026-10-23T18:00:00Z');
const ran = (daysAgo, status = 'done') => ({ runs: [{ status, created_at: new Date(NOW - daysAgo * 864e5).toISOString() }] });
const statuses = r => Object.fromEntries(r.steps.map(s => [s.id, s.status]));

test('a website visitor: only Research glows; the visitor needs a record to research (it becomes a target)', () => {
  const r = companySteps({ record: { type: 'visitor' }, now: NOW });
  assert.deepEqual(statuses(r), { research: 'next', site: 'skip', size: 'todo', owner: 'todo', add: 'todo', touch: 'skip' });
  assert.equal(r.next, 'research');
  assert.equal(r.steps[0].needs_record, true);
  assert.deepEqual(STEPS.map(s => s[0]), ['research', 'site', 'size', 'owner', 'add', 'touch']);
});

test('bar-5 path on the target it became: research -> size -> owner -> add (promote)', () => {
  const rec = { type: 'target', employees: null, owner_user_id: null };
  assert.equal(companySteps({ record: rec, research: ran(0, 'running'), now: NOW }).steps[0].status, 'running');
  assert.equal(companySteps({ record: rec, research: ran(0, 'running'), now: NOW }).next, 'size', 'a running research lets the next step glow');
  assert.equal(companySteps({ record: rec, research: ran(1), now: NOW }).next, 'size');
  const sized = companySteps({ record: { ...rec, employees: 1200, employees_source: 'research' }, research: ran(1), now: NOW });
  assert.deepEqual([sized.next, sized.steps[2].value], ['owner', '1,200 employees · Research']);
  const owned = companySteps({ record: { ...rec, employees: 1200, owner_user_id: 'u1' }, research: ran(1), ownerName: 'Cyrus Yy', now: NOW });
  assert.deepEqual([owned.next, owned.steps[3].value, owned.steps[4].value], ['add', 'Cyrus Yy', 'Promote to partner or employer']);
});

test('an employer in the pipeline: Add is skipped; First touch until a touch, then Ready', () => {
  const rec = { type: 'employer', employees: 500, owner_user_id: 'u1' };
  const r = companySteps({ record: rec, research: ran(10), now: NOW });
  assert.deepEqual([r.next, statuses(r).add, statuses(r).site], ['touch', 'skip', 'skip']);
  const done = companySteps({ record: { ...rec, last_touch: { at: '2026-10-20T10:00:00Z' } }, research: ran(10), now: NOW });
  assert.deepEqual([done.next, done.ready, done.last_touch_at], [null, true, '2026-10-20T10:00:00Z']);
});

test('research older than 90 days glows again; a partner\'s found site waits for Confirm', () => {
  assert.equal(companySteps({ record: { type: 'employer', employees: 1, owner_user_id: 'u' }, research: ran(91), now: NOW }).next, 'research');
  const p = companySteps({ record: { type: 'partner', category: '11. CPA, Tax & Law Firms', employees: 40, owner_user_id: 'u' }, research: ran(1), site: { domain: 'zz.example', confirmed: false }, now: NOW });
  assert.deepEqual([p.next, p.steps[1].value], ['site', 'zz.example']);
});

test('PEO / HR / benefits platforms: Size & type also wants reach (employees covered or clients); others do not', () => {
  const peo = { type: 'partner', category: '3. PEOs', employees: 300, owner_user_id: 'u', last_touch_at: '2026-10-01' };
  assert.ok(needsReach(peo));
  assert.equal(companySteps({ record: peo, research: ran(1), now: NOW }).next, 'size');
  const withReach = companySteps({ record: { ...peo, reach_employees: 45000, reach_clients: 410 }, research: ran(1), now: NOW });
  assert.deepEqual([withReach.ready, withReach.steps[2].value], [true, '300 employees · covers 45,000 · 410 clients']);
  for (const c of ['2. Perk Marketplaces & Benefit Platforms', '7. HR / Payroll / HRIS Marketplaces', '8. Benefits Admin & Enrollment']) assert.ok(needsReach({ type: 'partner', category: c }), c);
  assert.ok(!needsReach({ type: 'partner', category: '4. Mid-Market Benefits Brokers' }));
  assert.ok(!needsReach({ type: 'employer', category: '3. PEOs' }));
});
