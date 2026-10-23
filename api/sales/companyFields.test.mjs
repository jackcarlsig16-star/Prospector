import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { applyResearchNumbers, editCompanyFields, wholeNumber, ownerOrCaller, employerOwner } from './companyFields.js';
import { parseResearch, researchSystem } from './partnerResearch.js';

// company-workflow-v1 W3/W4/W5. Made-up names; no emails or phones.
const B = randomUUID(), JACK = randomUUID(), CY = randomUUID(), VIC = randomUUID();
const P = randomUUID(), O = randomUUID(), T = randomUUID();
const seed = () => fakeSupabase({
  business_members: [{ business_id: B, user_id: JACK, name: 'Jack Zz', role: 'owner' }, { business_id: B, user_id: CY, name: 'Cyrus Yy', role: 'member' }, { business_id: B, user_id: VIC, name: 'Vic Viewer', role: 'viewer' }],
  sales_goals: [{ id: P, business_id: B, goal_type: 'partnership', name: 'ZZ Payroll Co', employees: null, employees_source: null, employees_at: null, reach_employees: 12000, reach_employees_source: 'manual', reach_employees_at: '2026-10-01T00:00:00Z', reach_clients: null, reach_clients_source: null, reach_clients_at: null }],
  sales_opportunities: [{ id: O, business_id: B, organization: 'ZZ Elm Health', owner: null, owner_user_id: null, employees: 800, employees_source: 'research', employees_at: '2026-10-01T00:00:00Z' }],
  sales_targets: [{ id: T, business_id: B, name: 'ZZ Oak Labs', owner_user_id: null, employees: null, employees_source: null, employees_at: null }],
});

test('research: the prompt asks for employees_count + reach; the parser keeps whole numbers only', () => {
  const sys = researchSystem({ name: 'HomeLover' }, [], 'partner');
  assert.match(sys, /"employees_count": null, "reach_employees": null, "reach_clients": null/);
  assert.match(sys, /Never the company's own headcount/);
  const r = parseResearch(JSON.stringify({ size: '1,200 employees (est.)', employees_count: '1,200', reach_employees: 45000.4, reach_clients: 'about 300' }), []);
  assert.deepEqual([r.employees_count, r.reach_employees, r.reach_clients], [1200, 45000, null]);
  assert.deepEqual([wholeNumber(-3), wholeNumber('12'), wholeNumber(null), wholeNumber(1e9)], [null, 12, null, null]);
});

test('research fills empty / research values and never a typed one', async () => {
  const s = seed();
  const a = await applyResearchNumbers(s, { businessId: B, type: 'partner', id: P, result: { employees_count: 350, reach_employees: 99999, reach_clients: 410 } });
  assert.deepEqual(a.written.sort(), ['employees', 'reach_clients']);
  const g = s.db.sales_goals[0];
  assert.deepEqual([g.employees, g.employees_source, g.reach_employees, g.reach_employees_source, g.reach_clients], [350, 'research', 12000, 'manual', 410]);
  const e = await applyResearchNumbers(s, { businessId: B, type: 'employer', id: O, result: { employees_count: 900, reach_clients: 5 } });
  assert.deepEqual([e.written, s.db.sales_opportunities[0].employees], [['employees'], 900]);
  assert.equal(s.db.sales_opportunities[0].reach_clients, undefined, 'reach is a partner field only');
});

test('edit: typed numbers are manual (null clears); owner person on employers / targets only; Viewer / stranger refused', async () => {
  const s = seed();
  const r = await editCompanyFields(s, { businessId: B, type: 'employer', id: O, body: { employees: '1,500', owner_user_id: CY } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const o = s.db.sales_opportunities[0];
  assert.deepEqual([o.employees, o.employees_source, o.owner_user_id, o.owner], [1500, 'manual', CY, 'Cyrus']);
  await applyResearchNumbers(s, { businessId: B, type: 'employer', id: O, result: { employees_count: 10 } });
  assert.equal(o.employees, 1500, 'research never overwrites a typed value');
  assert.equal((await editCompanyFields(s, { businessId: B, type: 'employer', id: O, body: { employees: null } })).status, 200);
  assert.deepEqual([o.employees, o.employees_source], [null, null]);
  assert.equal((await editCompanyFields(s, { businessId: B, type: 'partner', id: P, body: { owner_user_id: CY } })).status, 400, "a partner's owner goes through Assign");
  assert.equal((await editCompanyFields(s, { businessId: B, type: 'target', id: T, body: { reach_clients: 3 } })).status, 400);
  assert.equal((await editCompanyFields(s, { businessId: B, type: 'target', id: T, body: { owner_user_id: VIC } })).status, 400);
  assert.equal((await editCompanyFields(s, { businessId: B, type: 'target', id: T, body: { employees: 'many' } })).status, 400);
  assert.equal((await editCompanyFields(s, { businessId: B, type: 'target', id: T, body: { owner_user_id: JACK, employees: 40 } })).status, 200);
  assert.deepEqual([s.db.sales_targets[0].owner_user_id, s.db.sales_targets[0].employees_source], [JACK, 'manual']);
  assert.equal((await editCompanyFields(s, { businessId: B, type: 'partner', id: P, body: { reach_clients: 410 } })).body.fields.reach_clients_source, 'manual');
});

test('ownerOrCaller: the pick when it is a Member, else the caller; a Viewer pick is refused', async () => {
  const s = seed();
  assert.equal((await ownerOrCaller(s, B, CY, JACK)).person.user_id, CY);
  assert.equal((await ownerOrCaller(s, B, null, JACK)).person.user_id, JACK);
  assert.ok((await ownerOrCaller(s, B, VIC, JACK)).error);
  assert.deepEqual(employerOwner({ user_id: CY, name: 'Cyrus Yy' }), { owner_user_id: CY, owner: 'Cyrus' });
});
