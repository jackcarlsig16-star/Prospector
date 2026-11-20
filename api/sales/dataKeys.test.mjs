// node --test api/sales/dataKeys.test.mjs  (react-scripts' Jest only runs src/)
// data-keys-v1 Stage 1 - the keys, against an in-memory Supabase: 0 network, 0 Claude, 0 Apollo. Company names only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { readType, aliasCount } from './readType.js';
import { aliasLink, LINK_TYPES } from './goalsRoutes.js';
import { normName } from './normName.js';
import { funnelContext, funnelWindow } from './funnelMath.js';
import { restampVisits, renamed } from './restampVisits.js';
import { refreshCompanyDomain } from './partnerDomains.js';
import { employerOwner, ownerFirst, withOwnerText } from './companyFields.js';
import { linkRecords } from './todoLink.js';

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const B = randomUUID();

test('K1: a new payload never fires the alias; an old tab\'s "opportunity" is stored as "employer" and counted once', () => {
  const before = aliasCount();
  assert.ok(LINK_TYPES.includes('employer') && !LINK_TYPES.includes('opportunity'));
  for (const t of ['employer', 'partner', 'target', 'company', 'commitment', 'metric', 'todo', null]) assert.equal(aliasLink({ link_type: t, link_id: 'x' }).link_type, t);
  assert.equal(aliasLink({ text: 'no link' }).link_type, undefined);
  assert.equal(aliasCount(), before, 'the counter reads 0 on new payloads');
  assert.deepEqual(aliasLink({ link_type: 'opportunity', link_id: 'o1' }), { link_type: 'employer', link_id: 'o1' });
  assert.equal(readType('opportunity'), 'employer');
  assert.equal(aliasCount(), before + 2);
});

test('K6: the server normaliser gives the stored key for each of the 100 names the migration proved (the browser test runs the same file)', () => {
  const fixture = JSON.parse(read('../../src/lib/normName.fixture.json'));
  assert.equal(fixture.length, 100);
  assert.deepEqual(fixture.filter(f => normName(f.name) !== f.norm).map(f => f.name), []);
  assert.ok(fixture.some(f => /[^\x00-\x7f]/.test(f.name)), 'accented names are in the list');
});

test('K3: the funnel joins a message to its company by id first (employer, target, a promoted target -> its employer) and flags a name match', () => {
  const E = { acme: randomUUID(), cloud: randomUUID() }, T = { plaid: randomUUID(), cloud: randomUUID() };
  const d = (id, account, contact = id) => ({ apollo_message_id: id, account_id: account, contact_id: contact, delivered_day: '2026-11-10' });
  const ctx = funnelContext({
    opportunities: [{ id: E.acme, organization: 'Acme Health', apollo_account_id: 'acc-acme' }, { id: E.cloud, organization: 'Cloudflare', apollo_account_id: null }],
    targets: [{ id: T.plaid, name: 'Plaid', apollo_account_id: 'acc-plaid', employer_id: null }, { id: T.cloud, name: 'Cloudflare', apollo_account_id: 'acc-cloud', employer_id: E.cloud }],
    sequenced: [{ account_id: 'acc-name', name: 'Acme Health Inc' }, { account_id: 'acc-new', name: 'Nowhere Labs' }],
    delivered: [d('m1', 'acc-acme'), d('m2', 'acc-plaid'), d('m3', 'acc-cloud'), d('m4', 'acc-name'), d('m5', 'acc-new'), d('m6', null)],
  });
  const by = Object.fromEntries(ctx.delivered.map(r => [r.apollo_message_id, r.company && [r.company.type, r.company.name, r.company.matched_by]]));
  assert.deepEqual(by, {
    m1: ['employer', 'Acme Health', 'id'], m2: ['target', 'Plaid', 'id'], m3: ['employer', 'Cloudflare', 'id'],
    m4: ['employer', 'Acme Health', 'name'], m5: [null, 'Nowhere Labs', 'name'], m6: null,
  });
  const w = funnelWindow(ctx, '2026-11-10', '2026-11-10');
  assert.deepEqual([w.companies_emailed, w.companies_by_name, w.companies_no_record, w.companies_unresolved], [4, 1, 1, 1], 'Acme was reached by id on one message, so it is not "by name"');
});

test('K10: restampVisits - a promote re-points the target\'s rows, unmatched rows of the name join, the visitor\'s key is never rewritten; a rename writes the Activity line', async () => {
  const tgt = randomUUID(), emp = randomUUID(), goal = randomUUID(), U = randomUUID();
  const v = (id, key, type, mid) => ({ id, business_id: B, company_key: key, company_name: key, domain: null, matched_type: type, matched_id: mid, pulled_on: '2026-11-10' });
  const s = fakeSupabase({
    web_visits: [v('v1', 'river works', 'target', tgt), v('v2', 'river works', null, null), v('v3', 'other', 'target', randomUUID()), v('v4', 'adp', 'partner', goal), v('v5', 'adp totalsource', null, null)],
    sales_flow_events: [],
  });
  const r = await restampVisits(s, { businessId: B, from: { type: 'target', id: tgt }, to: { type: 'employer', id: emp, name: 'River Works' } });
  assert.deepEqual([r.ids, r.matched], [['v1'], 1]);
  assert.deepEqual(s.db.web_visits.map(x => [x.id, x.company_key, x.matched_type, x.matched_id]), [
    ['v1', 'river works', 'employer', emp], ['v2', 'river works', 'employer', emp], ['v3', 'other', 'target', s.db.web_visits[2].matched_id],
    ['v4', 'adp', 'partner', goal], ['v5', 'adp totalsource', null, null]]);
  const ev = await renamed(s, { businessId: B, type: 'partner', id: goal, from: 'ADP', to: 'ADP TotalSource', userId: U });
  assert.deepEqual(s.db.web_visits.slice(3).map(x => [x.company_key, x.matched_type, x.matched_id]), [['adp', 'partner', goal], ['adp totalsource', 'partner', goal]], 'the old rows stay by id, the new name\'s row joins');
  const row = s.db.sales_flow_events[0];
  assert.deepEqual([row.kind, row.record_type, row.record_id, row.text, row.meta.visits_matched, row.by_user], ['restamp', 'partner', goal, 'Renamed ADP → ADP TotalSource · 1 unmatched visit row joined', 1, U]);
  assert.equal(ev.id, row.id);
});

test('K7: company_domain is the confirmed domain, primary first, and null when none is confirmed', async () => {
  const g = randomUUID(), row = (id, domain, confirmed, is_primary, updated_at) => ({ id, business_id: B, goal_id: g, domain, confirmed, is_primary, updated_at });
  const s = fakeSupabase({ sales_goals: [{ id: g, business_id: B, name: 'Gallagher', company_domain: 'typed.example' }],
    partner_domains: [row('d1', 'old.example', true, false, '2026-10-01'), row('d2', 'ajg.example', true, true, '2026-10-05'), row('d3', 'guess.example', false, false, '2026-09-01')] });
  assert.equal(await refreshCompanyDomain(s, B, g), 'ajg.example');
  assert.equal(s.db.sales_goals[0].company_domain, 'ajg.example');
  s.db.partner_domains.forEach(d => { d.confirmed = false; d.is_primary = false; });
  assert.equal(await refreshCompanyDomain(s, B, g), null);
  assert.equal(s.db.sales_goals[0].company_domain, null);
});

test('K8: no writer sets the owner text; a reader derives the first name from the owner id', () => {
  assert.deepEqual(employerOwner({ user_id: 'u1', name: 'Jack Zz' }), { owner_user_id: 'u1' });
  assert.deepEqual(employerOwner(null), { owner_user_id: null });
  const names = new Map([['u1', 'Jack Zz']]);
  assert.deepEqual([ownerFirst(names, 'u1'), ownerFirst(names, 'gone'), ownerFirst(names, null)], ['Jack', null, null]);
  assert.deepEqual(withOwnerText([{ id: 1, owner: 'Stale Text', owner_user_id: 'u1' }, { id: 2, owner: 'Typed', owner_user_id: null }], names).map(r => r.owner), ['Jack', null]);
});

test('K2: a promoted target names nothing to link (history kept, hidden from lists)', () => {
  const recs = linkRecords({ targets: [{ id: 't1', name: 'Kept', status: 'researching' }, { id: 't2', name: 'Promoted', status: 'accepted', employer_id: 'o1' }], opportunities: [{ id: 'o1', organization: 'Promoted' }] });
  assert.deepEqual(recs.map(r => `${r.type}:${r.id}`), ['employer:o1', 'target:t1']);
});

test('the files this stage adds delete nothing and carry no address', () => {
  const added = ['./restampVisits.js', './readType.js', './normName.js', '../../src/lib/normName.js', '../../src/lib/normName.fixture.json',
    '../../supabase/migrations/20261121_data_keys_v1_stage1.sql', '../../supabase/migrations/20261121_data_keys_v1_stage1b_flow_kind.sql'];
  for (const f of added) {
    const text = read(f);
    // dk_* are the migration's own temporary proof tables.
    assert.ok(!/\.delete\(|\bDELETE\s+FROM\b|\bDROP\s+TABLE\b|\bTRUNCATE\s+(?!dk_)/i.test(text), `${f} deletes nothing`);
    assert.ok(!text.includes('@'), `${f} holds no "@"`);
  }
});
