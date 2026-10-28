// node --test api/sales/headcountRun.test.mjs  (react-scripts' Jest only runs src/)
// FIX headcount-auto-v1 REV2 Stage 2 - the runner on the in-memory Supabase and the fixture Apollo (0 real calls): the
// free paths first, the name search finds a domain, enrich fills the number + firmographics (keep-list), a partner's
// found domain lands in partner_domains as a suggestion, the ledger records the measured delta (even 0), the state
// line, the daily / monthly caps, the stop on the first charged call, first sight (no lookup), the typed domain.
// Invented companies on .example; the fixture organization carries phone / address keys ON PURPOSE. 0 Claude.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { installApolloFixture, apolloFixtureCalls } from './testing/apolloFixture.mjs';
import { runHeadcountFill, gatherCandidates, scheduleHeadcountFill, scheduleFirstSight, stateOf } from './headcountRun.js';
import { editCompanyFields } from './companyFields.js';

const NOW = Date.parse('2026-10-27T18:00:00Z');
const B = randomUUID(), U = randomUUID();
const ID = { quarry: randomUUID(), harbor: randomUUID(), typed: randomUUID(), researched: randomUUID(), nodomain: randomUUID(), paid: randomUUID() };
const ORG = d => ({ name: 'x', primary_domain: d, estimated_num_employees: 6000, industry: 'software', annual_revenue_printed: '120M', founded_year: 2009, phone: '+1 312 555 0100', street_address: '1 Main St', postal_code: '60601', funding_events: [1] });
const seed = (extra = {}) => ({
  sales_settings: [{ business_id: B, headcount_daily_credits: 25, visitor_filters: {} }],
  sales_goals: [{ id: ID.harbor, business_id: B, goal_type: 'partnership', name: 'Zz Harbor Lane', archived_at: null, employees: null, employees_source: null, company_domain: null, created_at: '2026-10-20T00:00:00Z' }],
  sales_opportunities: [{ id: ID.typed, business_id: B, organization: 'Zz Typed Co', archived_at: null, employees: 1200, employees_source: 'manual', domain: 'typed.example', created_at: '2026-10-20T00:00:00Z' }],
  sales_targets: [
    { id: ID.quarry, business_id: B, name: 'Zz Quarry Labs', status: 'researching', employees: null, employees_source: null, domain: null, created_at: '2026-10-25T00:00:00Z' },
    { id: ID.researched, business_id: B, name: 'Zz Researched Co', status: 'researching', employees: null, employees_source: null, domain: 'researched.example', created_at: '2026-10-21T00:00:00Z' },
    { id: ID.nodomain, business_id: B, name: 'Zz Mystery', status: 'proposed', employees: null, employees_source: null, domain: null, created_at: '2026-10-22T00:00:00Z' },
  ],
  partner_domains: [], sales_company_scores: [{ business_id: B, company_type: 'target', company_id: ID.quarry, band: 'P1' }, { business_id: B, company_type: 'partner', company_id: ID.harbor, band: 'P2' }],
  research_runs: [{ business_id: B, entity_type: 'target', entity_id: ID.researched, status: 'done', result: { employees_count: 3000, domain: 'researched.example', website_confidence: 'high' }, created_at: '2026-10-26T00:00:00Z' }],
  apollo_credit_spend: [], business_members: [],
  ...extra,
});
const fixture = (over = {}) => ({ all: { organizations: [] }, us: { organizations: [] }, balances: [9900], byName: { 'Zz Quarry Labs': [{ name: 'Zz Quarry Labs', primary_domain: 'zzquarry.example' }], 'Zz Harbor Lane': [{ name: 'Zz Harbor Lane', primary_domain: 'zzharbor.example' }] }, enrich: { 'zzquarry.example': ORG('zzquarry.example'), 'zzharbor.example': ORG('zzharbor.example') }, ...over });
const humanText = sb => JSON.stringify([sb.db.sales_goals, sb.db.sales_opportunities, sb.db.sales_targets, sb.db.partner_domains, sb.db.sales_settings]);

test('gather: every live company in one shape; a partner takes company_domain or a confirmed partner_domains row; only / since filters', async () => {
  const sb = fakeSupabase(seed({ partner_domains: [{ business_id: B, goal_id: ID.harbor, domain: 'harbor-confirmed.example', confirmed: true, is_primary: true }] }));
  const g = await gatherCandidates(sb, B);
  assert.deepEqual(g.records.map(r => [r.type, r.name, r.domain, r.employees]).sort(), [['employer', 'Zz Typed Co', 'typed.example', 1200], ['partner', 'Zz Harbor Lane', 'harbor-confirmed.example', null], ['target', 'Zz Mystery', null, null], ['target', 'Zz Quarry Labs', null, null], ['target', 'Zz Researched Co', 'researched.example', null]].sort());
  assert.equal(g.scores.get(`target-${ID.quarry}`).band, 'P1');
  assert.equal(g.research.get(`target-${ID.researched}`).employees_count, 3000);
  assert.equal((await gatherCandidates(sb, B, { only: { type: 'target', id: ID.quarry } })).records.length, 1);
  assert.deepEqual((await gatherCandidates(sb, B, { since: '2026-10-24' })).records.map(r => r.name), ['Zz Quarry Labs']);
});

test('a manual run: P1 first; the name search finds the domain (apollo_name), enrich fills employees (apollo) + firmographics (keep-list only), Research fills its number free, a partner\'s found domain becomes a partner_domains suggestion, the typed company is skipped, the ledger gets one 0-credit row, the state line is saved; 0 real calls', async () => {
  const restore = installApolloFixture({}, fixture());
  const sb = fakeSupabase(seed());
  try {
    const start = apolloFixtureCalls.length;
    const r = await runHeadcountFill(sb, { businessId: B, userId: U, trigger: 'manual', now: NOW });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const calls = apolloFixtureCalls.slice(start);
    assert.deepEqual(calls, ['GET /users/api_profile', 'POST /mixed_companies/search', 'GET /organizations/enrich', 'GET /users/api_profile', 'POST /mixed_companies/search', 'GET /organizations/enrich', 'GET /users/api_profile', 'POST /mixed_companies/search'], 'balance, then per company: name search / enrich + balance; Mystery (no hit) and Researched (free) spend no lookup');
    assert.deepEqual([r.body.ran, r.body.credits, r.body.balance_before, r.body.balance_after, r.body.counts.filled_apollo, r.body.counts.filled_free, r.body.counts.domains_found, r.body.counts.unknown], [true, 0, 9900, 9900, 2, 1, 2, 1]);
    const quarry = sb.db.sales_targets.find(t => t.id === ID.quarry);
    assert.deepEqual([quarry.domain, quarry.domain_source, quarry.employees, quarry.employees_source, quarry.apollo_firmographics], ['zzquarry.example', 'apollo_name', 6000, 'apollo', { industry: 'software', annual_revenue_printed: '120M', founded_year: 2009 }]);
    const researched = sb.db.sales_targets.find(t => t.id === ID.researched);
    assert.deepEqual([researched.employees, researched.employees_source], [3000, 'research']);
    const harbor = sb.db.sales_goals.find(g => g.id === ID.harbor);
    assert.deepEqual([harbor.employees, harbor.employees_source, harbor.company_domain, 'domain' in harbor], [6000, 'apollo', null, false], 'a partner gets the number; no domain column on sales_goals');
    assert.deepEqual(sb.db.partner_domains.map(d => [d.goal_id, d.domain, d.source, d.confirmed]), [[ID.harbor, 'zzharbor.example', 'apollo', false]]);
    assert.deepEqual(sb.db.sales_opportunities[0].employees, 1200, 'typed stays');
    assert.deepEqual(sb.db.apollo_credit_spend.map(s => [s.endpoint, s.ref, s.credits, s.balance_before, s.balance_after]), [['/organizations/enrich', 'headcount:2026-10-27:manual', 0, 9900, 9900]]);
    const st = stateOf(sb.db.sales_settings[0]);
    assert.deepEqual([st.last_run_on, st.today, st.charged, st.last_line], ['2026-10-27', { day: '2026-10-27', lookups: 2, name_searches: 3 }, null, r.body.line]);
    assert.equal(r.body.line, '2 domains found · 3 headcounts filled (2 via Apollo) · 1 still unknown · 0 names ambiguous');
    assert.deepEqual(r.body.filled.map(f => [f.name, f.employees, f.source]).sort(), [['Zz Harbor Lane', 6000, 'apollo'], ['Zz Quarry Labs', 6000, 'apollo'], ['Zz Researched Co', 3000, 'research']].sort());
    assert.ok(!/555|Main St|60601|funding/.test(humanText(sb)), 'nothing from the dropped keys lands');
    const again = await runHeadcountFill(sb, { businessId: B, userId: U, trigger: 'manual', now: NOW + 3600e3 });
    assert.deepEqual([again.body.counts.candidates, again.body.calls], [1, 3], 'only Mystery is left: balance, one name search, balance');
  } finally { restore(); }
});

test('caps: max_lookups / today\'s N limit the enrich calls (the rest stay unknown, no error); at the monthly 500 no lookup runs and PAUSED is reported; first sight runs the free paths for ONE company with no enrich', async () => {
  const restore = installApolloFixture({}, fixture());
  try {
    const sb = fakeSupabase(seed());
    const r = await runHeadcountFill(sb, { businessId: B, userId: U, trigger: 'manual', maxLookups: 1, now: NOW });
    assert.deepEqual([r.body.counts.lookups, r.body.counts.filled_apollo, r.body.counts.domains_found, r.body.daily_cap], [1, 1, 2, 1]);
    const paused = fakeSupabase(seed({ apollo_credit_spend: [{ business_id: randomUUID(), la_month: '2026-10', credits: 500, endpoint: '/mixed_companies/search' }] }));
    const p = await runHeadcountFill(paused, { businessId: B, userId: U, trigger: 'manual', now: NOW });
    assert.deepEqual([p.body.counts.lookups, p.body.counts.filled_free, p.body.paused != null, p.body.counts.domains_found], [0, 1, true, 2], 'free paths still run under the pause');
    const fs = fakeSupabase(seed());
    const start = apolloFixtureCalls.length;
    assert.equal(scheduleFirstSight(fs, { businessId: B, type: 'target', id: ID.quarry }), null, 'the in-memory Supabase never gets a background run');
    await scheduleFirstSight(fs, { businessId: B, type: 'target', id: ID.quarry }, { force: true });
    assert.deepEqual(apolloFixtureCalls.slice(start), ['GET /users/api_profile', 'POST /mixed_companies/search', 'GET /users/api_profile'], 'first sight: the name search only, never an enrich');
    const q = fs.db.sales_targets.find(t => t.id === ID.quarry);
    assert.deepEqual([q.domain, q.employees], ['zzquarry.example', null]);
    assert.equal(scheduleHeadcountFill(fs, B, {}), null);
  } finally { restore(); }
});

test('stop on the first charge: a balance drop after an enrich records the credit, stops the run, the state carries the paused message and a page-load run refuses until a manual run clears it', async () => {
  const restore = installApolloFixture({}, fixture({ balances: [9900, 9900, 9899, 9899] }));
  try {
    const sb = fakeSupabase(seed({ sales_targets: [
      { id: ID.quarry, business_id: B, name: 'Zz Quarry Labs', status: 'researching', employees: null, employees_source: null, domain: 'zzquarry.example', created_at: '2026-10-25T00:00:00Z' },
      { id: ID.paid, business_id: B, name: 'Zz Paid Co', status: 'researching', employees: null, employees_source: null, domain: 'zzharbor.example', created_at: '2026-10-24T00:00:00Z' },
      { id: ID.nodomain, business_id: B, name: 'Zz Third', status: 'proposed', employees: null, employees_source: null, domain: 'zzquarry.example', created_at: '2026-10-22T00:00:00Z' },
    ], sales_goals: [], sales_company_scores: [] }));
    const r = await runHeadcountFill(sb, { businessId: B, userId: U, trigger: 'manual', now: NOW });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.counts.lookups, r.body.counts.stopped?.credits, r.body.counts.skipped, r.body.credits, r.body.balance_before, r.body.balance_after], [2, 1, 1, 1, 9900, 9899]);
    assert.match(r.body.line, /Apollo started charging for headcount \(1 credit\) - paused$/);
    assert.equal(sb.db.apollo_credit_spend[0].credits, 1, 'the measured delta goes to the shared ledger');
    assert.equal(stateOf(sb.db.sales_settings[0]).charged.credits, 1);
    const pageload = await runHeadcountFill(sb, { businessId: B, userId: U, trigger: 'pageload', now: NOW + 60e3 });
    assert.deepEqual([pageload.body.ran, pageload.body.reason], [false, 'Apollo started charging for headcount (1 credit) - paused']);
  } finally { restore(); }
});

test('typed domain (H7): PATCH fields { domain } on an employer / target -> manual, normalized, null clears; refused on a partner and on a bad value', async () => {
  const sb = fakeSupabase(seed());
  const r = await editCompanyFields(sb, { businessId: B, type: 'target', id: ID.nodomain, body: { domain: 'https://www.ZzMystery.example/about' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.fields.domain, r.body.fields.domain_source], ['zzmystery.example', 'manual']);
  assert.equal((await editCompanyFields(sb, { businessId: B, type: 'target', id: ID.nodomain, body: { domain: '' } })).body.fields.domain, null);
  assert.equal((await editCompanyFields(sb, { businessId: B, type: 'target', id: ID.nodomain, body: { domain: 'not a domain' } })).status, 400);
  assert.equal((await editCompanyFields(sb, { businessId: B, type: 'partner', id: ID.harbor, body: { domain: 'x.example' } })).status, 400);
});
