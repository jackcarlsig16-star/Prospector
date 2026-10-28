// node --test api/sales/visitorPeopleFollow.test.mjs  (react-scripts' Jest only runs src/)
// visitor-people-follow-record-v1 Stage 1 - identified visitors follow the record (synthetic, invented companies; names
// and titles only, never an address). V1 promote moves people (employer: re-pointed; partner: partner_contacts + the
// old row archived, a duplicate skipped) with an undo; V2 accepted targets leave scoring; V3 partner visitors count;
// V5 parked people re-link on create - not the skip-listed ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { promoteTarget } from './targetsRoutes.js';
import { insertCompanyRecord } from './companyPanel.js';
import { moveTargetPeople, relinkParked, VISITOR_ROLE, SKIP_NOTE } from './visitorPeopleMove.js';
import { gatherInputs, COUNT_PARTNER_VISITORS } from './intentScoreRun.js';

const B = randomUUID(), U = randomUUID();
const T = { cloud: randomUUID(), calp: randomUUID(), done: randomUUID() };
const target = (id, name, kind, extra = {}) => ({ id, business_id: B, name, kind, status: 'researching', owner_team: null, co_owner_name: null, no_double_touch: false, evidence: null, research_notes: null, research_prompt: 'x', promoted_goal_id: null, channel: 'website_visit', created_at: '2026-10-27T00:00:00Z', ...extra });
const person = (name, title, extra) => ({ id: randomUUID(), business_id: B, name, title, company_type: 'target', target_id: null, opportunity_id: null, source_kind: 'web_visit', archived_at: null, ...extra });
const seed = () => fakeSupabase({
  sales_targets: [target(T.cloud, 'Zz Cloud Co', 'employer'), target(T.calp, 'Zz Power Co', 'partner'), target(T.done, 'Zz Old Co', 'employer', { status: 'accepted', decided_at: '2026-10-20T00:00:00Z' })],
  sales_people: [
    person('Frank Example', 'VP People', { target_id: T.cloud }),
    person('Gina Example', 'Recruiter', { target_id: T.cloud }),
    person('Hal Example', 'CHRO', { target_id: T.calp }),
    person('Ida Example', 'Benefits Lead', { target_id: T.calp }),
    person('Parked Pat', 'HR Director', { company_type: 'parked', company_name: 'Zz New Co', target_id: null }),
    person('Skipped Sam', 'HR Director', { company_type: 'parked', company_name: 'Zz New Co', target_id: null, note: SKIP_NOTE }),
  ],
  sales_goals: [], sales_opportunities: [], partner_contacts: [], sales_week_goals: [], sales_partner_events: [], research_runs: [], web_visits: [], sales_source_events: [], sales_opportunity_events: [],
  business_members: [{ business_id: B, user_id: U, name: 'Jack Zz', role: 'owner' }],
});
const live = (s, f) => s.db.sales_people.filter(p => !p.archived_at && f(p));

test('V1 promote -> employer moves the target\'s people onto it (company_type employer, opportunity_id set, target_id null) and says how many', async () => {
  const s = seed();
  const r = await promoteTarget(s, { businessId: B, userId: U, targetId: T.cloud, body: { to: 'employer' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const oppId = r.body.created.id;
  assert.equal(r.body.people_moved, 2);
  assert.deepEqual(live(s, p => p.opportunity_id === oppId).map(p => [p.name, p.company_type, p.target_id]).sort(), [['Frank Example', 'employer', null], ['Gina Example', 'employer', null]]);
  assert.equal(live(s, p => p.target_id === T.cloud).length, 0, 'nobody left on the accepted target');
});

test('V1 the move hands back an undo that restores every row exactly', async () => {
  const s = seed();
  const before = JSON.stringify(s.db.sales_people);
  const undo = [];
  const n = await moveTargetPeople(s, { businessId: B, userId: U, targetId: T.cloud, to: 'employer', id: randomUUID(), undo, now: new Date('2026-10-28T12:00:00Z') });
  assert.equal(n, 2);
  for (const f of undo.reverse()) await f();
  assert.deepEqual(JSON.parse(JSON.stringify(s.db.sales_people)).map(({ updated_at, ...p }) => p), JSON.parse(before).map(({ updated_at, ...p }) => p));
});

test('V1 promote -> partner: partner_contacts rows marked as visitors, the old rows archived (never deleted), a same-name contact skipped', async () => {
  const s = seed();
  const r = await promoteTarget(s, { businessId: B, userId: U, targetId: T.calp, body: { to: 'partner' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const gid = r.body.created.id;
  assert.deepEqual(s.db.partner_contacts.filter(c => c.goal_id === gid).map(c => [c.name, c.title, c.role_in_notes, c.source]).sort(), [['Hal Example', 'CHRO', VISITOR_ROLE, 'manual'], ['Ida Example', 'Benefits Lead', VISITOR_ROLE, 'manual']]);
  assert.equal(s.db.sales_people.filter(p => p.target_id === T.calp && p.archived_at).length, 2, 'archived, still there');
  assert.equal(r.body.people_moved, 2);
  // A partner that already has Hal: his row archives, no second contact.
  const s2 = seed();
  const undo = [];
  const gid2 = randomUUID();
  s2.db.partner_contacts.push({ id: randomUUID(), business_id: B, goal_id: gid2, name: 'hal example', source: 'manual' });
  const moved = await moveTargetPeople(s2, { businessId: B, userId: U, targetId: T.calp, to: 'partner', id: gid2, undo });
  assert.equal(moved, 1);
  assert.equal(s2.db.partner_contacts.filter(c => c.goal_id === gid2).length, 2);
  assert.equal(s2.db.sales_people.filter(p => p.target_id === T.calp && p.archived_at).length, 2);
});

test('V5 a new same-name record takes its parked visitors on create - not the skip-listed one; the explicit Add takes both', async () => {
  const s = seed();
  const r = await insertCompanyRecord(s, { businessId: B, userId: U, name: 'Zz New Co', to: 'employer', channel: 'manual', evidence: 'added by hand' });
  const id = r.created.id;
  assert.equal(r.people_moved, 1);
  assert.deepEqual(live(s, p => p.opportunity_id === id).map(p => p.name), ['Parked Pat']);
  assert.deepEqual(live(s, p => p.company_type === 'parked').map(p => p.name), ['Skipped Sam'], 'the skip-listed person waits');
  const add = await relinkParked(s, { businessId: B, userId: U, type: 'employer', id, name: 'Zz New Co', includeSkipped: true });
  assert.equal(add, 1);
  assert.deepEqual(live(s, p => p.opportunity_id === id).map(p => p.name).sort(), ['Parked Pat', 'Skipped Sam']);
  const quiet = await insertCompanyRecord(seed(), { businessId: B, userId: U, name: 'Zz Other Co', to: 'target', channel: 'manual', evidence: 'x' });
  assert.equal(quiet.people_moved, 0, 'no parked match, nothing moves');
});

test('V2 an accepted target is not scored; V3 a partner\'s identified visitor counts with the buyer weighting (switch on)', async () => {
  const s = seed();
  const gid = randomUUID();
  s.db.sales_goals.push({ id: gid, business_id: B, goal_type: 'partnership', name: 'Zz Partner', pipeline_status: 'replied', archived_at: null, created_at: '2026-10-01T00:00:00Z' });
  s.db.partner_contacts.push({ id: randomUUID(), business_id: B, goal_id: gid, name: 'Vic Example', title: 'VP Human Resources', role_in_notes: VISITOR_ROLE, source: 'manual' });
  s.db.partner_contacts.push({ id: randomUUID(), business_id: B, goal_id: gid, name: 'Old Contact', title: 'VP Human Resources', role_in_notes: 'champion', source: 'manual' });
  s.db.sales_settings = [{ business_id: B, buyer_titles: ['human resources'] }];
  const { inputs } = await gatherInputs(s, B);
  const keys = inputs.map(i => `${i.type}:${i.id}`);
  assert.ok(!keys.includes(`target:${T.done}`), 'the accepted target is gone from scoring');
  assert.ok(keys.includes(`target:${T.cloud}`), 'an open target still scores');
  assert.equal(COUNT_PARTNER_VISITORS, true);
  const p = inputs.find(i => i.type === 'partner' && i.id === gid);
  assert.deepEqual(p.people.map(x => [x.title, x.is_buyer]), [['VP Human Resources', true]], 'only the marked visitor counts, as a buyer');
});

test('Stage 2 ruling: the Sources funnel counts a promoted company once - an accepted target whose employer (notes "from target <id>") or partner (promoted_goal_id) exists is skipped; one with no record stays', async () => {
  const { sourcesFunnel } = await import('./sourceRoutes.js');
  const UP = randomUUID(), tEmp = randomUUID(), tPar = randomUUID(), tLone = randomUUID(), opp = randomUUID(), gid = randomUUID();
  const ref = { source_kind: 'partner_referral', source_partner_id: UP, source_person: 'Brad', source_set_by: null, created_at: '2026-10-15T17:00:00Z' };
  const s = fakeSupabase({
    sales_goals: [{ id: UP, business_id: B, goal_type: 'partnership', name: 'Upside', archived_at: null, created_at: '2026-10-01T00:00:00Z' }, { id: gid, business_id: B, goal_type: 'partnership', name: 'Zz Promoted Partner', archived_at: null, ...ref }],
    sales_opportunities: [{ id: opp, business_id: B, organization: 'Zz Promoted Employer', stage: 'target', archived_at: null, notes: `(10/28) from target ${tEmp}: visited`, ...ref }],
    sales_targets: [
      { id: tEmp, business_id: B, name: 'Zz Promoted Employer', status: 'accepted', decided_at: '2026-10-28T16:39:00Z', ...ref },
      { id: tPar, business_id: B, name: 'Zz Promoted Partner', status: 'accepted', promoted_goal_id: gid, decided_at: '2026-10-28T16:39:00Z', ...ref },
      { id: tLone, business_id: B, name: 'Zz Accepted Alone', status: 'accepted', decided_at: '2026-10-28T16:39:00Z', ...ref },
    ],
    business_members: [{ business_id: B, user_id: U, name: 'Jack Zz' }],
  });
  const r = await sourcesFunnel(s, { businessId: B, query: {} });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.companies.map(c => `${c.type}:${c.name}`).sort(), ['employer:Zz Promoted Employer', 'partner:Upside', 'partner:Zz Promoted Partner', 'target:Zz Accepted Alone']);
  assert.equal(r.body.by_rep.find(g => g.label.startsWith('Brad')).referred, 3, 'each referred company once');
});
