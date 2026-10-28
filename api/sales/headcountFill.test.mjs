// node --test api/sales/headcountFill.test.mjs  (react-scripts' Jest only runs src/)
// FIX headcount-auto-v1 REV2 Stage 1 - the pure fill module (keep-list, name-match acceptance, order, write rules, caps,
// stop-on-first-charge) and the two client guards (nameOnly on mixed_companies/search, domainOnly on organizations/enrich)
// against the fixture Apollo. Invented companies on .example; organization fixtures carry phone / address / email keys
// ON PURPOSE so the keep-list is proven. 0 network, 0 real Apollo calls, 0 Claude.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installApolloFixture, apolloFixtureCalls } from './testing/apolloFixture.mjs';
import { apolloRequest, nameOnly, domainOnly } from './apolloClient.js';
import { firmographics, headcountOf, enrichDomainOf, nameSearchRequest, enrichRequest, acceptNameHit, candidateOrder, headcountWrite, domainWrite, capState, runFill, fillLine, isConsumerDomain, chargedMessage, KEEP_LIST, NAME_SEARCH_DAILY_CAP } from './headcountFill.js';

const ORG = { id: 'o1', name: 'Zz Quarry Labs', primary_domain: 'zzquarry.example', estimated_num_employees: 6000, industry: 'software', annual_revenue_printed: '120M', founded_year: 2009, phone: '+1 312 555 0100', primary_phone: { number: '+1 312 555 0100' }, street_address: '1 Main St', postal_code: '60601', raw_address: '1 Main St, Chicago', funding_events: [{ amount: 1 }], total_funding: 5, org_chart_root_people_ids: ['p1'], account: { owner_email: 'owner@zz.example' } };
const rec = (over = {}) => ({ key: `target-${over.id || 't1'}`, type: 'target', id: over.id || 't1', name: 'Zz Quarry Labs', domain: null, domain_source: null, employees: null, employees_source: null, created_at: '2026-10-20T00:00:00Z', ...over });

test('keep-list: firmographics keeps industry / revenue band / founded year only; the headcount and the primary domain are read separately; phone, address, funding, people, emails never pass', () => {
  assert.deepEqual(KEEP_LIST, ['estimated_num_employees', 'primary_domain', 'industry', 'annual_revenue_printed', 'founded_year']);
  const f = firmographics(ORG);
  assert.deepEqual(f, { industry: 'software', annual_revenue_printed: '120M', founded_year: 2009 });
  assert.ok(!JSON.stringify(f).match(/555|Main St|60601|funding|owner@|p1/));
  assert.equal(headcountOf(ORG), 6000);
  assert.equal(headcountOf({ estimated_num_employees: '42' }), 42);
  assert.equal(headcountOf({ estimated_num_employees: 0 }), null);
  assert.equal(enrichDomainOf(ORG), 'zzquarry.example');
  assert.equal(firmographics({ phone: 'x' }), null);
  assert.equal(firmographics(null), null);
});

test('requests: the name search is one exact name, per_page 3; enrich is one normalized domain in the query', () => {
  assert.deepEqual(nameSearchRequest('  Zz  Quarry Labs '), { method: 'POST', path: '/mixed_companies/search', body: { q_organization_name: 'Zz Quarry Labs', per_page: 3, page: 1 } });
  assert.deepEqual(enrichRequest('https://www.ZzQuarry.example/about'), { method: 'GET', path: '/organizations/enrich', query: 'domain=zzquarry.example' });
  assert.throws(() => enrichRequest(''), /domain is required/);
});

test('acceptNameHit: exact normalized name wins; ours contained whole-word in one hit with a meaningful word is accepted; generic-only names never match by containment; two candidates = ambiguous; no hit = null', () => {
  assert.deepEqual(acceptNameHit('Zz Quarry Labs, Inc.', [{ name: 'ZZ QUARRY LABS', primary_domain: 'zzquarry.example' }, { name: 'Zz Quarry Labs Foundation', primary_domain: 'zzqf.example' }]), { domain: 'zzquarry.example', hit: 'ZZ QUARRY LABS', how: 'exact' });
  assert.deepEqual(acceptNameHit('Zz Quarry Labs', [{ name: 'Zz Quarry Labs Foundation', primary_domain: 'zzqf.example' }]), { domain: 'zzqf.example', hit: 'Zz Quarry Labs Foundation', how: 'contained' });
  assert.deepEqual(acceptNameHit('Zz Quarry Labs', [{ name: 'Zz Quarry Labs Foundation', primary_domain: 'a.example' }, { name: 'The Zz Quarry Labs Group', primary_domain: 'b.example' }]), { ambiguous: true, reason: '2 hits contain the name' });
  assert.equal(acceptNameHit('Global Services', [{ name: 'Global Services Holdings', primary_domain: 'gsh.example' }]), null, 'generic-only names never match by containment');
  assert.deepEqual(acceptNameHit('Global Services', [{ name: 'Global Services', primary_domain: 'gs.example' }]), { domain: 'gs.example', hit: 'Global Services', how: 'exact' });
  assert.deepEqual(acceptNameHit('Acme', [{ name: 'Acme', primary_domain: 'a.example' }, { name: 'ACME Inc', primary_domain: 'b.example' }]), { ambiguous: true, reason: '2 exact-name hits with different domains' });
  assert.deepEqual(acceptNameHit('Acme', [{ name: 'Acme', primary_domain: 'a.example' }, { name: 'ACME Inc', primary_domain: 'www.a.example' }]).domain, 'a.example', 'the same domain twice is one answer');
  assert.equal(acceptNameHit('Acme', [{ name: 'Acme' }]), null, 'a hit without a domain is no hit');
  assert.equal(acceptNameHit('', [{ name: 'x', primary_domain: 'x.example' }]), null);
});

test('candidateOrder: only companies without a headcount (a manual one never), P1 -> P4 by band, newest first within a band, unscored last', () => {
  const rows = [rec({ id: 'a', created_at: '2026-10-01' }), rec({ id: 'b', created_at: '2026-10-05' }), rec({ id: 'c', created_at: '2026-10-09' }), rec({ id: 'd', employees: 500, employees_source: 'apollo' }), rec({ id: 'e', employees: null, employees_source: 'manual' }), rec({ id: 'f', created_at: '2026-10-02' })];
  const scores = new Map([['target-a', { band: 'P2' }], ['target-b', { band: 'P1' }], ['target-c', { band: 'P2' }]]);
  assert.deepEqual(candidateOrder(rows, scores).map(r => r.id), ['b', 'c', 'a', 'f']);
});

test('write rules: a headcount fills an empty slot only (manual never, an existing research or apollo number stays); a domain is fill-only, consumer domains and unknown sources refused', () => {
  const now = new Date('2026-10-27T18:00:00Z');
  assert.deepEqual(headcountWrite(rec(), 6000, 'apollo', { now }), { employees: 6000, employees_source: 'apollo', employees_at: '2026-10-27T18:00:00.000Z' });
  assert.equal(headcountWrite(rec({ employees: 1200, employees_source: 'manual' }), 6000, 'apollo'), null);
  assert.equal(headcountWrite(rec({ employees: null, employees_source: 'manual' }), 6000, 'apollo'), null);
  assert.equal(headcountWrite(rec({ employees: 5000, employees_source: 'research' }), 6000, 'apollo'), null, 'research has a number - it stays');
  assert.equal(headcountWrite(rec({ employees: 5000, employees_source: 'apollo' }), 6000, 'apollo'), null);
  assert.equal(headcountWrite(rec(), 0, 'apollo'), null);
  assert.deepEqual(domainWrite(rec(), 'https://www.ZzQuarry.example', 'apollo_name', { now }), { domain: 'zzquarry.example', domain_source: 'apollo_name', domain_at: '2026-10-27T18:00:00.000Z' });
  assert.equal(domainWrite(rec({ domain: 'kept.example', domain_source: 'manual' }), 'other.example', 'apollo_name'), null);
  assert.equal(domainWrite(rec({ domain: 'kept.example', domain_source: 'visit' }), 'other.example', 'research'), null, 'fill-only');
  assert.equal(domainWrite(rec(), 'gmail.com', 'people'), null);
  assert.equal(domainWrite(rec(), 'zz.example', 'guess'), null);
  assert.ok(isConsumerDomain('Yahoo.com') && !isConsumerDomain('zz.example'));
});

test('caps: lookups left = min(today\'s N left, the month\'s 500 left); PAUSED at the monthly cap means 0', () => {
  assert.deepEqual(capState({ dailyCap: 25, usedToday: 5, monthSpent: 100 }), { lookupsLeft: 20, paused: false });
  assert.deepEqual(capState({ dailyCap: 25, usedToday: 0, monthSpent: 490 }), { lookupsLeft: 10, paused: false });
  assert.deepEqual(capState({ dailyCap: 25, usedToday: 0, monthSpent: 500 }), { lookupsLeft: 0, paused: true });
  assert.deepEqual(capState({ dailyCap: 0, usedToday: 0, monthSpent: 0 }), { lookupsLeft: 0, paused: false });
  assert.deepEqual(capState({ dailyCap: 25, usedToday: 30, monthSpent: 0 }), { lookupsLeft: 0, paused: false });
});

test('runFill: name search finds the domain (counted), free paths fill first (no lookup spent), enrich fills the rest under the cap with firmographics, an ambiguous name is flagged, the name-search cap stops searches, a lookup error never stops the run', async () => {
  const calls = { names: [], enrich: [] };
  const lookups = {
    nameSearch: async name => { calls.names.push(name); return { 'Zz Quarry Labs': [{ name: 'Zz Quarry Labs', primary_domain: 'zzquarry.example' }], 'Zz Acme': [{ name: 'Zz Acme Foundation', primary_domain: 'a.example' }, { name: 'The Zz Acme Group', primary_domain: 'b.example' }], 'Zz Boom': () => { throw new Error('x'); } }[name]?.call?.() ?? ({ 'Zz Quarry Labs': [{ name: 'Zz Quarry Labs', primary_domain: 'zzquarry.example' }], 'Zz Acme': [{ name: 'Zz Acme Foundation', primary_domain: 'a.example' }, { name: 'The Zz Acme Group', primary_domain: 'b.example' }] }[name] || []); },
    freeHeadcount: async r => (r.id === 'free' ? { number: 3000, source: 'research' } : null),
    enrich: async domain => { calls.enrich.push(domain); return { org: domain === 'zzquarry.example' ? ORG : { estimated_num_employees: null }, credits: 0 }; },
  };
  const cands = [rec({ id: 't1' }), rec({ id: 'free', name: 'Zz Free Co', domain: 'free.example' }), rec({ id: 'amb', name: 'Zz Acme' }), rec({ id: 'has', name: 'Zz Has Domain', domain: 'has.example' }), rec({ id: 'late', name: 'Zz Late', domain: 'late.example' })];
  const out = await runFill(cands, { lookups, caps: { dailyCap: 2, usedToday: 0, monthSpent: 0 }, now: new Date('2026-10-27T18:00:00Z') });
  const by = Object.fromEntries(out.items.map(i => [i.key, i]));
  assert.deepEqual(by['target-t1'].writes, { domain: 'zzquarry.example', domain_source: 'apollo_name', domain_at: '2026-10-27T18:00:00.000Z', employees: 6000, employees_source: 'apollo', employees_at: '2026-10-27T18:00:00.000Z', apollo_firmographics: { industry: 'software', annual_revenue_printed: '120M', founded_year: 2009 } });
  assert.deepEqual([by['target-free'].filled, by['target-free'].writes.employees_source, calls.enrich.includes('free.example')], ['research', 'research', false], 'the free path fills first and spends no lookup');
  assert.deepEqual([by['target-amb'].filled, by['target-amb'].flags], [null, ['name_ambiguous', 'no_domain']]);
  assert.deepEqual([by['target-has'].filled, by['target-has'].flags], [null, ['enrich_empty']]);
  assert.deepEqual([by['target-late'].filled, by['target-late'].flags, calls.enrich.length], [null, [], 2], 'the daily cap (2) stops lookups; the company stays unknown without an error');
  assert.deepEqual(out.counts, { candidates: 5, domains_found: 1, filled_free: 1, filled_apollo: 1, unknown: 3, ambiguous: 1, name_searches: 2, lookups: 2, credits: 0, lookup_errors: 0, stopped: null, skipped: 0 });
  assert.equal(fillLine(out.counts), '1 domain found · 2 headcounts filled (1 via Apollo) · 3 still unknown · 1 name ambiguous');
  assert.ok(!JSON.stringify(out).match(/555|Main St|60601|owner@/), 'nothing from the dropped keys reaches the result');
  const capped = await runFill([rec({ id: 'n1', name: 'Zz Quarry Labs' })], { lookups, caps: { dailyCap: 5 }, nameSearchesLeft: 0 });
  assert.deepEqual([capped.counts.name_searches, capped.items[0].flags], [0, ['no_domain']]);
  const erring = await runFill([rec({ id: 'e1', name: 'Zz Boom' }), rec({ id: 'e2', name: 'Zz Quarry Labs' })], { lookups: { ...lookups, nameSearch: async n => { if (n === 'Zz Boom') throw new Error('x'); return lookups.nameSearch(n); } }, caps: { dailyCap: 5 } });
  assert.deepEqual([erring.counts.lookup_errors, erring.items[0].flags, erring.items[1].filled], [1, ['lookup_error', 'no_domain'], 'apollo']);
  assert.equal(NAME_SEARCH_DAILY_CAP, 200);
});

test('runFill stops on the first charged enrich: the credit is recorded, the message names it, later candidates are skipped', async () => {
  const lookups = { nameSearch: async () => [], freeHeadcount: async () => null, enrich: async d => ({ org: { estimated_num_employees: 10 }, credits: d === 'paid.example' ? 1 : 0 }) };
  const out = await runFill([rec({ id: 'a', domain: 'ok.example' }), rec({ id: 'b', domain: 'paid.example' }), rec({ id: 'c', domain: 'c.example' })], { lookups, caps: { dailyCap: 25 } });
  assert.deepEqual([out.items.length, out.counts.stopped.credits, out.counts.stopped.at, out.counts.credits, out.counts.skipped, out.counts.filled_apollo], [2, 1, 'target-b', 1, 1, 2]);
  assert.equal(out.counts.stopped.message, chargedMessage(1));
  assert.match(fillLine(out.counts), /Apollo started charging for headcount \(1 credit\) - paused$/);
  const paused = await runFill([rec({ id: 'a', domain: 'ok.example' })], { lookups, caps: { dailyCap: 25, monthSpent: 500 } });
  assert.deepEqual([paused.counts.lookups, paused.items[0].flags], [0, []], 'PAUSED at the monthly cap: no lookup at all');
});

test('guards: mixed_companies/search with neither the visitor filter nor one name is refused; a name with per_page 10 is refused; enrich with a name, two domains or extra params is refused; the fixture answers the allowed shapes (0 real calls)', async () => {
  const restore = installApolloFixture({}, { all: { organizations: [] }, us: { organizations: [] }, balances: [9900], byName: { 'Zz Quarry Labs': [{ name: 'Zz Quarry Labs', primary_domain: 'zzquarry.example', phone: '312 555 0100' }] }, enrich: { 'zzquarry.example': ORG } });
  try {
    const ctx = () => ({ callCounter: { count: 0, max: 5 }, endpointCounts: {} });
    assert.equal(nameOnly({ q_organization_name: 'Zz Quarry Labs', per_page: 3 }), true);
    assert.equal(nameOnly({ q_organization_name: 'Zz Quarry Labs', per_page: 10 }), false);
    assert.equal(nameOnly({ q_organization_name: 'Zz Quarry Labs', website_visitors_from_domains: ['x.example'] }), false);
    assert.equal(nameOnly({}), false);
    assert.deepEqual([domainOnly('domain=zzquarry.example'), domainOnly('domain=zzquarry.example&name=x'), domainOnly('domain=a.example,b.example'), domainOnly('name=Zz'), domainOnly('')], [true, false, false, false, false]);
    const start = apolloFixtureCalls.length;
    await assert.rejects(apolloRequest({ method: 'POST', path: '/mixed_companies/search', body: { per_page: 3 }, ctx: ctx() }), /needs website_visitors_from_domains, or one q_organization_name/);
    await assert.rejects(apolloRequest({ method: 'POST', path: '/mixed_companies/search', body: { q_organization_name: 'Zz', per_page: 10 }, ctx: ctx() }), /refusing before any request/);
    await assert.rejects(apolloRequest({ method: 'GET', path: '/organizations/enrich', query: 'name=Zz%20Quarry', ctx: ctx() }), /exactly one domain=/);
    await assert.rejects(apolloRequest({ method: 'GET', path: '/organizations/enrich', query: 'domain=a.example&domain=b.example', ctx: ctx() }), /exactly one domain=/);
    assert.equal(apolloFixtureCalls.length, start, 'every refusal happened before any request');
    const r = nameSearchRequest('Zz Quarry Labs');
    const hits = await apolloRequest({ method: r.method, path: r.path, body: r.body, ctx: ctx() });
    assert.deepEqual(acceptNameHit('Zz Quarry Labs', hits.organizations), { domain: 'zzquarry.example', hit: 'Zz Quarry Labs', how: 'exact' });
    const e = enrichRequest('zzquarry.example');
    const org = (await apolloRequest({ method: e.method, path: e.path, query: e.query, ctx: ctx() })).organization;
    assert.deepEqual([headcountOf(org), firmographics(org)], [6000, { industry: 'software', annual_revenue_printed: '120M', founded_year: 2009 }]);
    assert.deepEqual(apolloFixtureCalls.slice(start), ['POST /mixed_companies/search', 'GET /organizations/enrich']);
  } finally { restore(); }
});
