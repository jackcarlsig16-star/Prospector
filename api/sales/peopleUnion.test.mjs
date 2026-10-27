// node --test api/sales/peopleUnion.test.mjs  (react-scripts' Jest only runs src/)
// visitor-to-record-v1 REV2 Stage 1 - the V3 union over sales_people / partner_contacts / sales_prospect_state with
// their companies and ties, the search filters, and the no-address wall. Invented rows; 0 network, 0 DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { unionRows, searchPeople, MAX_ROWS, TIES } from './peopleUnion.js';

const partners = [{ id: 'g1', name: 'Zz Northwind Benefits', owner_team: 'homelover' }, { id: 'g2', name: 'Zz Referral Co', owner_team: 'homelover' }];
const opportunities = [{ id: 'o1', organization: 'Zz ADP', owner_team: 'both', co_owner_name: 'Rob Example' }, { id: 'o2', organization: 'Zz Bluefin', owner_team: 'homelover' }];
const targets = [{ id: 't1', name: 'Zz Calpine', owner_team: null }];
const visits = [{ id: 'v1', last_visit: '2026-10-18', pulled_on: '2026-10-27' }];
const rows = () => unionRows({
  salesPeople: [
    { id: 'sp1', company_type: 'employer', opportunity_id: 'o1', name: 'Jean Horton', title: 'VP Human Resources', source_kind: 'web_visit', visit_id: 'v1', updated_at: '2026-10-27T10:00:00Z' },
    { id: 'sp2', company_type: 'target', target_id: 't1', name: 'Margo R.', title: 'Benefits Manager', source_kind: 'partner_referral', source_partner_id: 'g2', created_at: '2026-10-20T10:00:00Z' },
    { id: 'sp3', company_type: 'employer', opportunity_id: 'o2', name: 'Old Person', title: 'x', archived_at: '2026-10-01T00:00:00Z' },
    { id: 'sp4', company_type: 'employer', opportunity_id: 'o2', name: 'Cam Fields', title: 'Head of People', source_kind: 'campaign', source_campaign_id: 'c1', updated_at: '2026-10-25T10:00:00Z' },
  ],
  partnerContacts: [{ id: 'pc1', goal_id: 'g1', name: 'Ana Example', title: 'Broker', email: 'ana@zznorthwind.example', source: 'apollo', last_activity_at: '2026-10-26T10:00:00Z' }, { id: 'pc2', goal_id: 'g1', name: 'Ben Noemail', title: null, email: null, source: 'manual', first_seen: '2026-10-10T10:00:00Z' }],
  prospects: [{ contact_id: 'ap1', name: 'Dev Patel', title: 'CHRO', company: 'Zz ADP', opportunity_id: 'o1', updated_at: '2026-10-24T10:00:00Z' }, { contact_id: 'ap2', name: 'Eve Solo', title: 'Director of Benefits', company: 'Zz Unknown Co', opportunity_id: null, updated_at: '2026-10-23T10:00:00Z' }],
  opportunities, targets, partners, visits, campaignNames: { c1: 'Fall' },
});

test('union: every table in one shape with its company and ties; has_email only says yes/no; archived people left out; the address never serialized', () => {
  const r = rows();
  assert.equal(r.length, 7);
  const by = Object.fromEntries(r.map(x => [x.person_id, x]));
  assert.deepEqual(by.sp1.company, { type: 'employer', id: 'o1', name: 'Zz ADP' });
  assert.deepEqual(by.sp1.ties.map(t => [t.kind, t.label]), [['company', 'Zz ADP'], ['visit', 'Visited 2026-10-18'], ['upside', 'Upside (Rob Example)']]);
  assert.deepEqual(by.sp2.ties.map(t => [t.kind, t.label]), [['company', 'Zz Calpine'], ['partner_referral', 'Referred by Zz Referral Co']]);
  assert.deepEqual(by.sp4.ties.map(t => t.label), ['Zz Bluefin', 'Campaign Fall']);
  assert.deepEqual([by.pc1.has_email, by.pc2.has_email, by.sp1.has_email, by.ap1.has_email], [true, false, false, false]);
  assert.deepEqual(by.pc1.ties.map(t => t.kind), ['company', 'sequence']);
  assert.deepEqual(by.ap1.ties.map(t => t.kind), ['company', 'sequence', 'upside']);
  assert.deepEqual(by.ap2.company, { type: 'account', id: null, name: 'Zz Unknown Co' });
  assert.equal(by.sp3, undefined, 'archived');
  assert.ok(!JSON.stringify(r).includes('@'));
});

test('search: by name or company, the company / tie / title filters, newest activity first, fixed keys, <= 50, bad tie -> 400', () => {
  const r = rows();
  assert.deepEqual(searchPeople(r, { q: 'adp' }).map(x => x.name), ['Jean Horton', 'Dev Patel']);
  assert.deepEqual(searchPeople(r, { q: 'horton' }).map(x => x.name), ['Jean Horton']);
  assert.deepEqual(searchPeople(r, { company: 'Zz Northwind Benefits, Inc.' }).map(x => x.name), ['Ana Example', 'Ben Noemail']);
  assert.deepEqual(searchPeople(r, { tie: 'visit' }).map(x => x.name), ['Jean Horton']);
  assert.deepEqual(searchPeople(r, { tie: 'upside' }).map(x => x.name), ['Jean Horton', 'Dev Patel']);
  assert.deepEqual(searchPeople(r, { title: 'benefits' }).map(x => x.name), ['Eve Solo', 'Margo R.']);
  assert.deepEqual(Object.keys(searchPeople(r, { q: 'horton' })[0]), ['person_id', 'source_table', 'name', 'title', 'company', 'ties', 'last_activity', 'has_email']);
  assert.throws(() => searchPeople(r, { tie: 'friend' }), /tie must be one of/);
  assert.deepEqual(TIES, ['company', 'partner_referral', 'campaign', 'sequence', 'visit', 'upside']);
  const many = Array.from({ length: 80 }, (_, i) => ({ person_id: `x${i}`, source_table: 'sales_people', name: `Zz Person ${i}`, title: null, company: null, ties: [], last_activity: null, has_email: false }));
  assert.equal(searchPeople(many).length, MAX_ROWS);
  assert.equal(searchPeople(many, { limit: 5 }).length, 5);
  assert.throws(() => searchPeople([{ person_id: 'bad', source_table: 'sales_people', name: 'ana@zz.example', title: null, company: null, ties: [], last_activity: null, has_email: false }]), /address reached/);
});
