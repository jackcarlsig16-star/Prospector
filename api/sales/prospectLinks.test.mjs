// node --test api/sales/prospectLinks.test.mjs  (react-scripts' Jest only runs src/)
// company-panel-v2 D1 - person -> company links: exact only, fill-only, never
// fuzzy, 'manual' and 'pipeline' untouched. Addresses below use the reserved
// .example TLD - nothing real. 0 network, 0 Claude, 0 Apollo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { buildLinkIndex, linkPatch, loadLinkIndex, unlinkProspect, emailDomain, AMBIGUOUS } from './prospectLinks.js';

const B = randomUUID();
const G = { gallagher: randomUUID(), aon: randomUUID(), locktonA: randomUUID(), locktonB: randomUUID(), archived: randomUUID() };
const O = { nike: randomUUID(), target: randomUUID(), twinA: randomUUID(), twinB: randomUUID(), gone: randomUUID() };
const idx = () => buildLinkIndex({
  partners: [{ id: G.gallagher, name: 'Gallagher' }, { id: G.aon, name: 'Aon, Inc.' }, { id: G.locktonA, name: 'Lockton' }, { id: G.locktonB, name: 'Lockton Inc' }],
  domains: [{ goal_id: G.gallagher, domain: 'gallagher.example' }, { goal_id: G.aon, domain: 'aon.example' }, { goal_id: G.locktonA, domain: 'shared.example' }, { goal_id: G.locktonB, domain: 'shared.example' }, { goal_id: G.archived, domain: 'archived.example' }],
  opportunities: [{ id: O.nike, organization: 'Nike, Inc.' }, { id: O.target, organization: 'Target' }, { id: O.twinA, organization: 'Twin Co' }, { id: O.twinB, organization: 'Twin, Inc.' }],
});
const blank = { goal_id: null, goal_link_via: null, opportunity_id: null, opportunity_link_via: null };

test('index: names and domains normalise; a name or domain shared by two records is ambiguous; a domain on an archived partner is dropped', () => {
  const i = idx();
  assert.equal(i.byPartnerName.get('gallagher'), G.gallagher);
  assert.equal(i.byPartnerName.get('aon'), G.aon);
  assert.equal(i.byPartnerName.get('lockton'), AMBIGUOUS);
  assert.equal(i.byDomain.get('shared.example'), AMBIGUOUS);
  assert.equal(i.byDomain.has('archived.example'), false);
  assert.equal(i.byOppName.get('nike'), O.nike);
  assert.equal(i.byOppName.get('twin'), AMBIGUOUS);
  assert.equal(emailDomain('Pat@WWW.Gallagher.Example'), 'gallagher.example');
  assert.equal(emailDomain('not an address'), null);
});

test('domain beats name; name links when the domain says nothing; no partial matches; ambiguous links nothing', () => {
  const i = idx();
  assert.deepEqual(linkPatch({ ...blank, email: 'pat@gallagher.example', company: 'Aon' }, i), { goal_id: G.gallagher, goal_link_via: 'domain' });
  assert.deepEqual(linkPatch({ ...blank, email: 'pat@personal.example', company: 'AON INC' }, i), { goal_id: G.aon, goal_link_via: 'name' });
  assert.deepEqual(linkPatch({ ...blank, email: null, company: 'Gallagher Benefits' }, i), {});
  assert.deepEqual(linkPatch({ ...blank, email: null, company: 'Lockton' }, i), {});
  assert.deepEqual(linkPatch({ ...blank, email: 'x@shared.example', company: 'Lockton' }, i), {});
  assert.deepEqual(linkPatch({ ...blank, email: 'x@shared.example', company: 'Gallagher' }, i), { goal_id: G.gallagher, goal_link_via: 'name' });
  assert.deepEqual(linkPatch({ ...blank, company: 'Nike' }, i), { opportunity_id: O.nike, opportunity_link_via: 'name' });
  assert.deepEqual(linkPatch({ ...blank, company: 'Twin' }, i), {});
  assert.deepEqual(linkPatch({ ...blank, company: '' }, i), {});
});

test('fill-only: an existing link is never re-pointed; manual is never overwritten; pipeline is untouched; both links can coexist', () => {
  const i = idx();
  assert.deepEqual(linkPatch({ ...blank, goal_id: G.aon, goal_link_via: 'name', email: 'pat@gallagher.example', company: 'Nike' }, i), { opportunity_id: O.nike, opportunity_link_via: 'name' });
  assert.deepEqual(linkPatch({ ...blank, goal_link_via: 'manual', email: 'pat@gallagher.example', company: 'Gallagher' }, i), {});
  assert.deepEqual(linkPatch({ ...blank, opportunity_link_via: 'manual', company: 'Nike' }, i), {});
  assert.deepEqual(linkPatch({ ...blank, opportunity_id: O.gone, opportunity_link_via: 'pipeline', company: 'Nike' }, i), {});
  const both = buildLinkIndex({ partners: [{ id: G.gallagher, name: 'Acme' }], domains: [], opportunities: [{ id: O.nike, organization: 'Acme' }] });
  assert.deepEqual(linkPatch({ ...blank, company: 'Acme' }, both), { goal_id: G.gallagher, goal_link_via: 'name', opportunity_id: O.nike, opportunity_link_via: 'name' });
});

test('loadLinkIndex reads live partnerships, confirmed domains and non-archived opportunities only', async () => {
  const sb = fakeSupabase({
    sales_goals: [{ id: G.gallagher, business_id: B, goal_type: 'partnership', name: 'Gallagher', archived_at: null }, { id: G.archived, business_id: B, goal_type: 'partnership', name: 'Old Twin', archived_at: '2026-10-01T00:00:00Z' }, { id: randomUUID(), business_id: B, goal_type: 'month', name: 'Gallagher', archived_at: null }],
    partner_domains: [{ id: randomUUID(), business_id: B, goal_id: G.gallagher, domain: 'gallagher.example', confirmed: true }, { id: randomUUID(), business_id: B, goal_id: G.gallagher, domain: 'dismissed.example', confirmed: false }],
    sales_opportunities: [{ id: O.nike, business_id: B, organization: 'Nike', archived_at: null }, { id: O.gone, business_id: B, organization: 'Gone Co', archived_at: '2026-10-01T00:00:00Z' }],
  });
  const i = await loadLinkIndex(sb, B);
  assert.deepEqual([...i.byPartnerName.keys()], ['gallagher']);
  assert.deepEqual([...i.byDomain.keys()], ['gallagher.example']);
  assert.deepEqual([...i.byOppName.keys()], ['nike']);
});

test('unlink ("Not this company"): the link goes to null with link_via manual, and the rules never set it again', async () => {
  const sb = fakeSupabase({ sales_prospect_state: [{ business_id: B, contact_id: 'c1', name: 'Pat', company: 'Gallagher', goal_id: G.gallagher, goal_link_via: 'name', opportunity_id: O.nike, opportunity_link_via: 'name', email: null }] });
  const r = await unlinkProspect(sb, { businessId: B, contactId: 'c1', body: { which: 'goal' }, byUser: 'tester' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.prospect.goal_id, r.body.prospect.goal_link_via, r.body.prospect.opportunity_id, r.body.before.goal_id], [null, 'manual', O.nike, G.gallagher]);
  const row = sb.db.sales_prospect_state[0];
  assert.equal(row.updated_by, 'tester');
  assert.deepEqual(linkPatch(row, idx()), {});
  assert.equal(JSON.stringify(r.body).includes('@'), false);
  assert.equal((await unlinkProspect(sb, { businessId: B, contactId: 'c1', body: { which: 'nope' } })).status, 400);
  assert.equal((await unlinkProspect(sb, { businessId: B, contactId: 'c9', body: { which: 'goal' } })).status, 404);
});
