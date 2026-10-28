// node --test api/sales/visitorRoutes.test.mjs  (react-scripts' Jest only runs src/)
// visitor-to-record-v1 REV2 Stage 2 - V1 inside the visitor pull (a P1 / P2+US500 visit becomes an employer target,
// its signal auto-accepted), V2b the domain-scoped people search through the real allowlist against the fixture
// Apollo (0 real calls), V1 on demand from Signals, V2a the Visited People export, V3 the People search, V6 undo.
// In-memory Supabase, invented companies on .example / .invalid; fixture people carry email / phone keys ON PURPOSE
// so the tests prove they never land anywhere. 0 network, 0 Claude.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { installApolloFixture, apolloFixtureCalls } from './testing/apolloFixture.mjs';
import { apolloRequest } from './apolloClient.js';
import { runVisitPull } from './visitPull.js';
import { autoCreateSignal, uploadVisitedPeople, peopleSearch, addRecordFromPerson, addPerson } from './visitorRoutes.js';
import { runVisitorPeoplePull, schedulePeoplePull, MAX_PAGES } from './visitorPeoplePull.js';
import { VISITOR_LIST_NAME } from './peopleFind.js';
import { undoSignal, listSignals } from './signalsRoutes.js';

const NOW = Date.parse('2026-10-20T17:00:00Z'); // Tue Oct 20, 10:00 LA
const TOMORROW = NOW + 864e5;
const B = randomUUID(), U = randomUUID();
const P = { harbor: randomUUID() }, T = { quarry: randomUUID() };
const ADDRESS = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i;
const org = (id, name, { domain = `${name.toLowerCase().replace(/[^a-z]/g, '')}.example`, visits = 1, people = 1, paths = [['/', 1]] } = {}) => ({
  id, name, primary_domain: domain, website_url: `http://www.${domain}`, naics_codes: [], sic_codes: [], organization_revenue: 1000,
  intent_signal_account: { organization_id: id, total_visits: visits, unique_visitors: people, overall_intent: 'high',
    domain_aggregates: [{ domain: 'homelover.ai', total_visits: visits, unique_visitors: people, first_visit: 20261013, last_visit: 20261019, intent: 'high', intent_score: 40, weekly_aggregates: [], top_5_paths: paths.map(([p, n]) => ({ _id: `homelover.ai${p === '/' ? '' : p}`, total_visits: n })) }],
    website_visitor_metrics: { page_view_aggregates: { one_day_count: 1, seven_day_count: visits } } },
});
const ORGS = [
  org('o-harbor', 'Harbor Lane'),                                            // matched partner -> attach
  org('o-quarry', 'Quarry Labs', { visits: 6, people: 3 }),                   // matched Upside target -> stamp only
  org('o-nimbus', 'Nimbus Freight', { visits: 6, people: 2, paths: [['/pricing', 4], ['/employer-partners', 2]] }), // P1 US 500+ -> create + people
  org('o-ridge', 'Ridgeline Health', { visits: 2 }),                          // P2 US 500+ -> create
  org('o-sizeless', 'Sizeless Co', { visits: 6 }),                            // P3 -> wait
  org('o-cedar', 'Cedar Row', { visits: 2, paths: [['/contact', 2]] }),       // P1 (contact page) not US500 -> create, no domain people (fixture empty)
];
const US = ['o-nimbus', 'o-ridge'];
const visitors = () => ({ all: { organizations: ORGS, accounts: [] }, us: { organizations: ORGS.filter(o => US.includes(o.id)), accounts: [] }, balances: [9910] });
const PEOPLE = {
  'nimbusfreight.example': [
    { id: 'ap-1', first_name: 'Larry', last_name_obfuscated: 'F.', title: 'Chief People Officer', email: 'larry@nimbusfreight.example', phone_numbers: [{ raw_number: '+1 312 555 0100' }], organization: { name: 'Nimbus Freight' } },
    { id: 'ap-2', first_name: 'Mona', last_name_obfuscated: 'Q.', title: 'VP People', sanitized_phone: '+13125550101' },
    { id: 'ap-3', first_name: 'Ravi', last_name_obfuscated: 'S.', title: 'Head of Total Rewards' },
    { id: 'ap-4', first_name: 'Extra', last_name_obfuscated: 'E.', title: 'Benefits Manager' },
  ],
};
const settings = over => ({ business_id: B, buyer_titles: ['Chief People Officer', 'VP People', 'Head of Total Rewards', 'Benefits Manager'], visitor_domains: null, visitor_filters: null, auto_create_daily_cap: 25, people_search_daily_cap: 25, people_per_company: 3, ...over });
const seed = (extra = {}) => ({
  sales_goals: [{ id: P.harbor, business_id: B, goal_type: 'partnership', name: 'Harbor Lane', archived_at: null, pipeline_status: 'first_email_sent', owner_team: 'homelover' }],
  sales_opportunities: [], sales_sequenced_accounts: [],
  sales_targets: [{ id: T.quarry, business_id: B, name: 'Quarry Labs', kind: 'employer', status: 'researching', owner_team: 'upside', co_owner_name: 'Brad' }],
  partner_domains: [], sales_signals: [], sales_visit_skip: [], web_visits: [], visit_pull_runs: [], apollo_credit_spend: [], sales_people: [], partner_contacts: [], sales_prospect_state: [], sales_source_events: [], sales_outreach_campaigns: [],
  sales_settings: [settings()],
  ...extra,
});
const unique = {
  sales_signals: r => [r.business_id, r.source, r.signal_week, r.company_key, r.who_key || ''].join('|'),
  visit_pull_runs: r => `${r.business_id}|${r.la_date}|${r.kind}`,
};
const setup = (extra, v = visitors()) => { const restore = installApolloFixture({}, v, null, PEOPLE); const sb = fakeSupabase(seed(extra), { unique }); return { sb, restore }; };
const targets = sb => sb.db.sales_targets.filter(t => t.business_id === B && t.id !== T.quarry);
const noAddress = sb => assert.ok(!ADDRESS.test(JSON.stringify([sb.db.sales_people, sb.db.sales_targets, sb.db.sales_signals])), 'no address in any stored row');
// The phone marker (555) is probed on the human-text fields only: ids are random uuids and a uuid can contain "555"
// (the flake fixed in Stage 4 - it was never shared state).
const humanText = rows => JSON.stringify(rows.map(r => [r.name, r.title, r.note, r.location, r.evidence, r.research_notes]));

test('V1 in the pull: Nimbus (P1 US 500+) and Ridgeline (P2 US 500+) and Cedar (P1 contact page) become employer targets with visit_id, source web_visit, channel website_visit, evidence; their signals read accepted / auto / decided_by null; Harbor (partner) and Quarry (Upside target) only attach; Sizeless (P3) waits', async () => {
  const { sb, restore } = setup();
  try {
    const r = await runVisitPull(sb, { businessId: B, userId: U, trigger: 'pageload', now: NOW });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const made = targets(sb);
    assert.deepEqual(made.map(t => t.name).sort(), ['Cedar Row', 'Nimbus Freight', 'Ridgeline Health']);
    const nimbus = made.find(t => t.name === 'Nimbus Freight');
    const visit = sb.db.web_visits.find(v => v.company_name === 'Nimbus Freight');
    assert.deepEqual([nimbus.kind, nimbus.status, nimbus.source, nimbus.channel, nimbus.visit_id, nimbus.owner_user_id ?? null, nimbus.source_kind], ['employer', 'researching', 'web_visit', 'website_visit', visit.id, null, 'website']);
    assert.match(nimbus.evidence, /^Visited 6 times in 7 days · pages: \/pricing, \/employer-partners · intent high · last 2026-10-19$/);
    assert.match(nimbus.research_notes, /^\(10\/20\) Visited 6 times/);
    const sig = sb.db.sales_signals.find(s => s.company_name === 'Nimbus Freight');
    assert.deepEqual([sig.status, sig.auto, sig.decided_by, sig.target_id, sig.match.via, nimbus.signal_id], ['accepted', true, null, nimbus.id, 'new_target', sig.id]);
    assert.ok(sb.db.sales_signals.find(s => s.company_name === 'Harbor Lane').auto !== true && sb.db.sales_signals.find(s => s.company_name === 'Harbor Lane').status === 'new', 'a matched partner keeps a plain new signal');
    assert.equal(sb.db.sales_targets.filter(t => t.name === 'Quarry Labs').length, 1, 'the Upside target is stamped, never duplicated');
    assert.deepEqual(r.body.counts.auto, { created: 3, people: 3, searches: 3, attached: 2, waited: 1, duplicates: 0, capped: 0, no_signal: 0, search_errors: 0 });
    assert.ok(sb.db.sales_source_events.some(e => e.record_id === nimbus.id && e.reason === 'create'), 'the create is logged');
    noAddress(sb);
  } finally { restore(); }
});

test('V2b: one domain-scoped api_search per created company with a domain, through the real allowlist; <= 3 people filed as sales_people with apollo id, visit tie, the reveal flag, never an email or phone; the request carries the buyer titles', async () => {
  const { sb, restore } = setup();
  try {
    const start = apolloFixtureCalls.length;
    await runVisitPull(sb, { businessId: B, userId: U, now: NOW });
    const searches = apolloFixtureCalls.slice(start).filter(c => c === 'POST /mixed_people/api_search');
    assert.equal(searches.length, 3, 'Nimbus, Ridgeline, Cedar each get one search (fixture answers only Nimbus)');
    const nimbus = targets(sb).find(t => t.name === 'Nimbus Freight');
    const people = sb.db.sales_people.filter(p => p.target_id === nimbus.id);
    assert.deepEqual(people.map(p => [p.name, p.title, p.apollo_person_id, p.source_kind, p.company_type]), [['Larry F.', 'Chief People Officer', 'ap-1', 'web_visit', 'target'], ['Mona Q.', 'VP People', 'ap-2', 'web_visit', 'target'], ['Ravi S.', 'Head of Total Rewards', 'ap-3', 'web_visit', 'target']]);
    assert.ok(people.every(p => p.visit_id === nimbus.visit_id && /reveal to see full name/.test(p.note)), `visit ids ${JSON.stringify(people.map(p => p.visit_id))} vs target ${nimbus.visit_id}; notes ${JSON.stringify(people.map(p => p.note))}; targets ${JSON.stringify(targets(sb).map(t => [t.name, t.visit_id]))}; visits ${JSON.stringify(sb.db.web_visits.filter(v => v.company_name === 'Nimbus Freight').map(v => v.id))}`);
    assert.ok(people.every(p => !('email' in p) && !('phone' in p)) && !ADDRESS.test(JSON.stringify(people)) && !/555/.test(humanText(people)), humanText(people));
    assert.equal(sb.db.sales_people.length, 3, 'companies the fixture does not know get 0 people, no error');
    await assert.rejects(apolloRequest({ method: 'POST', path: '/mixed_people/api_search', body: { person_titles: ['CHRO'], per_page: 2 }, ctx: { callCounter: { count: 0, max: 1 }, endpointCounts: {} } }), /needs q_organization_domains/);
    noAddress(sb);
  } finally { restore(); }
});

test('idempotent + capped + respects a dismissal: a second pull tomorrow creates no second target; cap 1 creates one and counts the rest capped; a company dismissed in Signals this week is never auto-created', async () => {
  const { sb, restore } = setup();
  try {
    const first = await runVisitPull(sb, { businessId: B, userId: U, now: NOW });
    const n = targets(sb).length;
    assert.equal(n, 3, JSON.stringify(first.body.counts));
    const again = await runVisitPull(sb, { businessId: B, userId: U, trigger: 'pageload', now: TOMORROW });
    assert.equal(targets(sb).length, n, 'no second target');
    assert.equal(again.body.counts.auto.created, 0);
    assert.ok(again.body.counts.auto.duplicates >= 3 || again.body.counts.auto.no_signal >= 0);
  } finally { restore(); }
  const capped = setup({ sales_settings: [settings({ auto_create_daily_cap: 1 })] });
  try {
    const r = await runVisitPull(capped.sb, { businessId: B, userId: U, now: NOW });
    assert.deepEqual([r.body.counts.auto.created, r.body.counts.auto.capped, targets(capped.sb).length], [1, 2, 1]);
  } finally { capped.restore(); }
  const dismissed = setup({ sales_signals: [{ id: randomUUID(), business_id: B, source: 'web_visit', signal_week: '2026-10-19', company_name: 'Nimbus Freight', company_key: 'nimbus freight', kind: 'employer', status: 'dismissed', dismissed_until: '2026-10-27', created_at: '2026-10-19T00:00:00Z' }] });
  try {
    const r = await runVisitPull(dismissed.sb, { businessId: B, userId: U, now: NOW });
    assert.ok(!targets(dismissed.sb).some(t => t.name === 'Nimbus Freight'), 'dismissed this week -> not created');
    assert.equal(r.body.counts.auto.no_signal, 1);
  } finally { dismissed.restore(); }
});

test('on demand from Signals: a new web_visit signal whose latest row qualifies is created (target + people + signal auto); a P3 answers 409 with the reason; a decided signal 409', async () => {
  const { sb, restore } = setup({ sales_settings: [settings({ auto_create_daily_cap: 0 })] });
  try {
    await runVisitPull(sb, { businessId: B, userId: U, now: NOW });
    assert.equal(targets(sb).length, 0, 'cap 0: nothing created by the pull');
    sb.db.sales_settings[0].auto_create_daily_cap = 25;
    const sig = sb.db.sales_signals.find(s => s.company_name === 'Nimbus Freight');
    const r = await autoCreateSignal(sb, { businessId: B, userId: U, id: sig.id, now: new Date(NOW + 60e3) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.record.type, r.body.record.name, r.body.people, r.body.signal.status, r.body.signal.auto], ['target', 'Nimbus Freight', 3, 'accepted', true]);
    assert.equal((await autoCreateSignal(sb, { businessId: B, userId: U, id: sig.id })).status, 409, 'already decided');
    const p3 = { id: randomUUID(), business_id: B, source: 'web_visit', signal_week: '2026-10-19', company_name: 'Sizeless Co', company_key: sb.db.web_visits.find(v => v.company_name === 'Sizeless Co').company_key, kind: 'employer', status: 'new', created_at: '2026-10-20T00:00:00Z' };
    sb.db.sales_signals.push(p3);
    const no = await autoCreateSignal(sb, { businessId: B, userId: U, id: p3.id });
    assert.deepEqual([no.status, no.body.reason], [409, 'below_bar']);
    assert.equal((await autoCreateSignal(sb, { businessId: B, userId: U, id: randomUUID() })).status, 404);
    noAddress(sb);
  } finally { restore(); }
});

const CSV = [
  'First Name,Last Name,Title,Company Name,Email,Seniority,Departments,Mobile Phone,Lists,Account Owner,# Employees,Industry,Person Linkedin Url,Website,City,State,Company State,Company Country,Apollo Contact Id,Apollo Account Id',
  'Jean,Horton,VP Human Resources,Zz ADP,jean@zzadp.example,VP,Human Resources,312-555-0100,Prospector · Website visitors (export),Jack Carlson,58000,human resources,https://www.linkedin.com/in/jean-h,http://www.zzadp.example,Chicago,Illinois,New Jersey,United States,c-1,a-1',
  'Sam,Rivera,Head of People,Zz ADP,,,,,,,58000,,,zzadp.example,,,,,c-3,a-1',
  'Margo,R.,Benefits Manager,Harbor Lane,,Manager,,,Prospector · Website visitors (export),,120,,,,Houston,Texas,,,c-2,a-2',
  'Ana,Example,Director,Quarry Labs,,,,,,,900,,,,,,,,c-4,a-4',
].join('\n');

test('V2a Visited People export (real columns): preview counts without a write; then unknown company -> new employer target (source web_visit, employees from Apollo) with its people; a partner match -> partner_contacts; a target match -> sales_people (+ its empty headcount filled, source apollo); email / phone / address / LinkedIn columns never land; re-upload adds nobody twice; the reply carries names only', async () => {
  const { sb, restore } = setup();
  try {
    const pv = await uploadVisitedPeople(sb, { businessId: B, userId: U, body: { text: CSV, preview: true }, now: new Date(NOW) });
    assert.equal(pv.status, 200, JSON.stringify(pv.body));
    assert.equal(pv.body.preview, true);
    assert.deepEqual(pv.body.companies.map(c => [c.name, c.action, c.type, c.people_added, c.already_in]), [['Zz ADP', 'would_create', 'target', 2, 0], ['Harbor Lane', 'matched', 'partner', 1, 0], ['Quarry Labs', 'matched', 'target', 1, 0]]);
    assert.deepEqual(pv.body.counts, { companies: 3, matched: 2, created: 1, parked: 0, skipped_companies: 0, people_added: 4, people_parked: 0, already_in: 0, employees_filled: 0, parked_unfiled: 0 });
    assert.deepEqual(pv.body.sample.map(x => [x.name, x.company, x.action]), [['Jean Horton', 'Zz ADP', 'new'], ['Sam Rivera', 'Zz ADP', 'new'], ['Margo R.', 'Harbor Lane', 'new']]);
    assert.deepEqual([sb.db.sales_people.length, sb.db.partner_contacts.length, targets(sb).length], [0, 0, 0], 'a preview writes nothing');
    assert.equal(sb.db.sales_targets.find(t => t.id === T.quarry).employees, undefined);

    const r = await uploadVisitedPeople(sb, { businessId: B, userId: U, body: { text: CSV }, now: new Date(NOW) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.companies.map(c => [c.name, c.action, c.type, c.people_added, c.already_in]), [['Zz ADP', 'created', 'target', 2, 0], ['Harbor Lane', 'matched', 'partner', 1, 0], ['Quarry Labs', 'matched', 'target', 1, 0]]);
    assert.equal(r.body.counts.employees_filled, 2, 'Harbor Lane and Quarry Labs had no headcount');
    const adp = sb.db.sales_targets.find(t => t.name === 'Zz ADP');
    assert.deepEqual([adp.kind, adp.source, adp.channel, adp.source_kind, adp.employees, adp.employees_source], ['employer', 'web_visit', 'website_visit', 'website', 58000, 'apollo']);
    assert.match(adp.evidence, /^Identified visitors: 2 \(Apollo Visited People export\) · seen 2026-10-20$/);
    const adpPeople = sb.db.sales_people.filter(p => p.target_id === adp.id);
    assert.deepEqual(adpPeople.map(p => [p.name, p.title, p.location, p.linkedin_url, p.source_kind, p.apollo_person_id, p.source_note]), [['Jean Horton', 'VP Human Resources', null, null, 'web_visit', 'c-1', 'Apollo Visited People export · Prospector · Website visitors (export)'], ['Sam Rivera', 'Head of People', null, null, 'web_visit', 'c-3', 'Apollo Visited People export']]);
    assert.equal(adpPeople[0].note, 'Identified visitor · 2026-10-20 · VP · Human Resources');
    assert.deepEqual(sb.db.partner_contacts.map(c => [c.goal_id, c.name, c.title, c.source]), [[P.harbor, 'Margo R.', 'Benefits Manager', 'manual']]);
    assert.deepEqual(sb.db.sales_goals.find(g => g.id === P.harbor).employees, 120, 'the partner had no headcount: filled from Apollo');
    assert.equal(sb.db.sales_goals.find(g => g.id === P.harbor).employees_source, 'apollo');
    assert.deepEqual(sb.db.sales_people.filter(p => p.target_id === T.quarry).map(p => p.name), ['Ana Example']);
    assert.deepEqual([sb.db.sales_targets.find(t => t.id === T.quarry).employees, sb.db.sales_targets.find(t => t.id === T.quarry).employees_source], [900, 'apollo']);
    assert.ok(!ADDRESS.test(JSON.stringify(sb.db)) && !/555|Chicago|Houston|linkedin/.test(humanText(sb.db.sales_people)) && !ADDRESS.test(JSON.stringify(r.body)), humanText(sb.db.sales_people));

    sb.db.sales_targets.find(t => t.id === T.quarry).employees = 1200; sb.db.sales_targets.find(t => t.id === T.quarry).employees_source = 'manual';
    const again = await uploadVisitedPeople(sb, { businessId: B, userId: U, body: { text: CSV }, now: new Date(NOW) });
    assert.deepEqual(again.body.companies.map(c => [c.action, c.people_added, c.already_in]), [['matched', 0, 2], ['matched', 0, 1], ['matched', 0, 1]]);
    assert.deepEqual([sb.db.sales_targets.find(t => t.id === T.quarry).employees, sb.db.sales_targets.find(t => t.id === T.quarry).employees_source], [1200, 'manual'], 'never over a manual headcount');
    assert.equal((await uploadVisitedPeople(sb, { businessId: B, userId: U, body: { text: 'a,b\n1,2' } })).status, 400);
    assert.equal((await uploadVisitedPeople(sb, { businessId: B, userId: U, body: {} })).status, 400);
  } finally { restore(); }
});

// visitor-to-record-v1 V2a (Oct 27 ruling) - the Apollo contacts list pulled daily. Fixture contacts carry email / phone
// keys ON PURPOSE.
const LIST_ID = 'l-visitors';
const CONTACTS = [
  { id: 'c-1', first_name: 'Jean', last_name: 'Horton', title: 'VP Human Resources', organization_name: 'Zz ADP', account_id: 'a-1', seniority: 'vp', departments: ['human_resources'], email: 'jean@zzadp.example', phone_numbers: [{ raw_number: '+1 312 555 0100' }], organization: { name: 'Zz ADP', primary_domain: 'zzadp.example', estimated_num_employees: 58000, industry: 'human resources', country: 'United States', state: 'New Jersey', phone: '+1 973 555 0199' }, label_ids: [LIST_ID] },
  { id: 'c-2', first_name: 'Margo', last_name: 'R.', title: 'Benefits Manager', organization_name: 'Harbor Lane', account_id: 'a-2', email: 'margo@harbor.example', organization: { name: 'Harbor Lane', estimated_num_employees: 120 } },
  { id: 'c-4', first_name: 'Ana', last_name: 'Example', title: 'Director', organization_name: 'Quarry Labs', organization: { name: 'Quarry Labs' } },
  { id: 'c-5', first_name: 'Lone', last_name: 'Row' },
  { id: 'c-6', first_name: 'Cal', last_name: 'Skipped', title: 'Engineer', organization_name: 'Cloudflare', organization: { name: 'Cloudflare', primary_domain: 'cloudflare.example' } },
];
const lists = (over = {}) => ({ labels: [{ id: 'l-acc', name: VISITOR_LIST_NAME, modality: 'accounts' }, { id: LIST_ID, name: VISITOR_LIST_NAME, modality: 'contacts', cached_count: 3 }], contacts: { [LIST_ID]: CONTACTS }, ...over });
const setupList = (l = lists(), extra) => { const restore = installApolloFixture({}, visitors(), null, PEOPLE, l); const sb = fakeSupabase(seed({ sales_visit_skip: [{ id: randomUUID(), business_id: B, company_key: 'cloudflare', reason: 'Seed (D10)' }], ...extra }), { unique }); return { sb, restore }; };

test('V2a list pull: balance, ONE GET /labels (exact name, contacts modality) cached in sales_settings.visitor_filters.visitor_people, the list paged, balance; 0 credits recorded; people filed to their records / a new target with Apollo headcounts; once a day unless forced; the cached id skips the lookup; no address anywhere', async () => {
  const { sb, restore } = setupList();
  try {
    const start = apolloFixtureCalls.length;
    const r = await runVisitorPeoplePull(sb, { businessId: B, userId: U, now: NOW });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(apolloFixtureCalls.slice(start), ['GET /users/api_profile', 'GET /labels', 'POST /contacts/search', 'GET /users/api_profile']);
    assert.deepEqual([r.body.ran, r.body.calls, r.body.credits, r.body.list], [true, 4, 0, { name: VISITOR_LIST_NAME, count: 3, cached: false }]);
    assert.deepEqual(r.body.counts, { contacts: 5, pages: 1, capped: false, with_email: 2, skipped: 1, companies: 4, matched: 2, created: 1, parked: 0, skipped_companies: 1, people_added: 3, people_parked: 0, already_in: 0, employees_filled: 1, parked_unfiled: 0 });
    assert.deepEqual(sb.db.visit_pull_runs.filter(x => x.kind === 'people').map(x => [x.la_date, x.status, x.calls, x.credits]), [['2026-10-20', 'ok', 4, 0]], 'its own run row');
    assert.deepEqual(r.body.companies.map(c => [c.name, c.action, c.type, c.people_added]), [['Zz ADP', 'created', 'target', 1], ['Harbor Lane', 'matched', 'partner', 1], ['Quarry Labs', 'matched', 'target', 1], ['Cloudflare', 'skipped', null, 0]]);
    assert.ok(!sb.db.sales_targets.some(t => t.name === 'Cloudflare') && !sb.db.sales_people.some(p => p.name === 'Cal Skipped'), 'a skip-list company gets no record and its people wait');
    assert.deepEqual(r.body.sample.map(x => `${x.name[0]}. ${x.name.split(' ').slice(1).join(' ')} · ${x.company}`), ['J. Horton · Zz ADP', 'M. R. · Harbor Lane', 'A. Example · Quarry Labs']);
    const state = sb.db.sales_settings[0].visitor_filters.visitor_people;
    assert.deepEqual([state.list_id, state.list_name, state.list_count, state.last_pull_on, state.last_error], [LIST_ID, VISITOR_LIST_NAME, 3, '2026-10-20', null]);
    assert.equal(state.last_counts.people_added, 3);
    assert.deepEqual(sb.db.apollo_credit_spend.map(s => [s.endpoint, s.ref, s.credits, s.balance_before, s.balance_after]), [['/contacts/search', 'people_pull:2026-10-20', 0, 9910, 9910]]);
    const adp = sb.db.sales_targets.find(t => t.name === 'Zz ADP');
    assert.deepEqual([adp.source, adp.employees, adp.employees_source], ['web_visit', 58000, 'apollo']);
    assert.match(adp.evidence, /^Identified visitor: 1 \(Apollo list Prospector · Website visitors \(export\)\) · seen 2026-10-20$/);
    const jean = sb.db.sales_people.find(p => p.name === 'Jean Horton');
    assert.deepEqual([jean.target_id, jean.title, jean.source_kind, jean.apollo_person_id, jean.note, jean.source_note], [adp.id, 'VP Human Resources', 'web_visit', 'c-1', 'Identified visitor · 2026-10-20 · vp · human_resources', `Apollo list ${VISITOR_LIST_NAME}`]);
    assert.deepEqual(sb.db.partner_contacts.map(c => [c.goal_id, c.name]), [[P.harbor, 'Margo R.']]);
    assert.deepEqual([sb.db.sales_goals.find(g => g.id === P.harbor).employees, sb.db.sales_goals.find(g => g.id === P.harbor).employees_source], [120, 'apollo']);
    assert.ok(!ADDRESS.test(JSON.stringify(sb.db)) && !ADDRESS.test(JSON.stringify(r.body)) && !/555/.test(humanText(sb.db.sales_people)), 'no address');

    const same = await runVisitorPeoplePull(sb, { businessId: B, userId: U, now: NOW + 3600e3 });
    assert.deepEqual([same.body.ran, same.body.reason, apolloFixtureCalls.length - start], [false, 'Visitor people already pulled today', 4]);
    sb.db.visit_pull_runs.find(x => x.kind === 'people').status = 'running'; sb.db.visit_pull_runs.find(x => x.kind === 'people').updated_at = new Date(NOW + 3600e3).toISOString();
    assert.equal((await runVisitorPeoplePull(sb, { businessId: B, userId: U, force: true, now: NOW + 3700e3 })).status, 409, 'a fresh running row = busy');
    sb.db.visit_pull_runs.find(x => x.kind === 'people').status = 'ok';
    assert.equal(schedulePeoplePull(sb, { businessId: B, userId: U }), null, 'the in-memory Supabase never gets a background run');
    const forced = await runVisitorPeoplePull(sb, { businessId: B, userId: U, force: true, now: NOW + 7200e3 });
    assert.deepEqual(apolloFixtureCalls.slice(start + 4), ['GET /users/api_profile', 'POST /contacts/search', 'GET /users/api_profile'], 'the cached id skips GET /labels');
    assert.deepEqual([forced.body.ran, forced.body.list.cached, forced.body.counts.people_added, forced.body.counts.already_in, forced.body.counts.created], [true, true, 0, 3, 0]);
    assert.equal(sb.db.sales_people.length, 2);
    assert.equal(sb.db.apollo_credit_spend.length, 2);
    noAddress(sb);
  } finally { restore(); }
});

test('V2a list pull: no list of that name -> 404 kept for the day (a page-load try is not repeated, force is); more contacts than the page cap -> capped true', async () => {
  const { sb, restore } = setupList(lists({ labels: [{ id: 'l-other', name: 'Other', modality: 'contacts' }] }));
  try {
    const start = apolloFixtureCalls.length;
    const r = await runVisitorPeoplePull(sb, { businessId: B, userId: U, now: NOW });
    assert.equal(r.status, 404);
    assert.match(r.body.error, /no contacts list named "Prospector · Website visitors \(export\)"/);
    assert.deepEqual(apolloFixtureCalls.slice(start), ['GET /users/api_profile', 'GET /labels', 'GET /users/api_profile']);
    assert.equal(sb.db.apollo_credit_spend.length, 1, 'the balance delta is still recorded');
    assert.match(sb.db.sales_settings[0].visitor_filters.visitor_people.last_error, /no contacts list/);
    assert.deepEqual(sb.db.visit_pull_runs.filter(x => x.kind === 'people').map(x => [x.status, x.error]), [['error', 'Apollo has no contacts list named "Prospector · Website visitors (export)" - create it in Apollo (Lists) and add the visitors to it']]);
    const again = await runVisitorPeoplePull(sb, { businessId: B, userId: U, now: NOW + 3600e3 });
    assert.deepEqual([again.status, apolloFixtureCalls.length - start], [404, 6], 'an errored run row is retried on the next load, like the visit pull');
    assert.equal((await runVisitorPeoplePull(sb, { businessId: B, userId: U, force: true, now: NOW + 3600e3 })).status, 404);
  } finally { restore(); }
  const many = Array.from({ length: MAX_PAGES * 100 + 1 }, (_, i) => ({ id: `m-${i}`, first_name: 'Person', last_name: `N${i}`, organization_name: `Zz Many ${i % 7}`, organization: { name: `Zz Many ${i % 7}` } }));
  const big = setupList(lists({ contacts: { [LIST_ID]: many } }));
  try {
    const r = await runVisitorPeoplePull(big.sb, { businessId: B, userId: U, now: NOW });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.counts.pages, r.body.counts.contacts, r.body.counts.capped, r.body.calls], [MAX_PAGES, MAX_PAGES * 100, true, 3 + MAX_PAGES]);
  } finally { big.restore(); }
});

// V2a follow-up (choice 1): the record rule parks people whose company is not US / under 500 without a buyer title.
const PARK_CONTACTS = [
  { id: 'p-1', first_name: 'Pat', last_name: 'Parked', title: 'Owner', organization_name: 'Zz Small Shop', email: 'pat@zzsmall.example', organization: { name: 'Zz Small Shop', primary_domain: 'zzsmall.example', estimated_num_employees: 40, country: 'United States' } },
  { id: 'p-2', first_name: 'Sam', last_name: 'Parked', title: 'Clerk', organization_name: 'Zz Small Shop', organization: { name: 'Zz Small Shop', estimated_num_employees: 40, country: 'United States' } },
  { id: 'p-3', first_name: 'Ada', last_name: 'Abroad', title: 'CHRO', organization_name: 'Zz Abroad Ltd', organization: { name: 'Zz Abroad Ltd', estimated_num_employees: 9000, country: 'Canada' } },
  { id: 'p-4', first_name: 'Bea', last_name: 'Buyer', title: 'VP People', organization_name: 'Zz Boutique', organization: { name: 'Zz Boutique', estimated_num_employees: 30, country: 'United States' } },
  { id: 'p-5', first_name: 'Una', last_name: 'Unknown', title: 'Analyst', organization_name: 'Zz Mystery Corp', organization: { name: 'Zz Mystery Corp' } },
];
test('V2a follow-up: parked people (company name only, no record) for a US company under 500 and a non-US one; a buyer title or a US 500+ / unknown-size company still creates; parking is idempotent by name and Apollo contact id; preview says would_park; Add from People search files the company and moves every parked person; the attention count', async () => {
  const { sb, restore } = setupList(lists({ contacts: { [LIST_ID]: PARK_CONTACTS } }));
  try {
    const r = await runVisitorPeoplePull(sb, { businessId: B, userId: U, now: NOW });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.companies.map(c => [c.name, c.action, c.reason, c.people_added, c.people_parked]), [['Zz Small Shop', 'parked', 'under_500', 0, 2], ['Zz Abroad Ltd', 'parked', 'not_us', 0, 1], ['Zz Boutique', 'created', 'buyer_title', 1, 0], ['Zz Mystery Corp', 'created', 'us_size_unknown', 1, 0]]);
    assert.deepEqual([r.body.counts.parked, r.body.counts.people_parked, r.body.counts.created, r.body.counts.people_added, r.body.migration_pending], [2, 3, 2, 2, null]);
    const parked = sb.db.sales_people.filter(p => p.company_type === 'parked');
    assert.deepEqual(parked.map(p => [p.name, p.company_name, p.company_domain, p.opportunity_id, p.target_id, p.apollo_person_id, p.source_kind]), [['Pat Parked', 'Zz Small Shop', 'zzsmall.example', undefined, undefined, 'p-1', 'web_visit'], ['Sam Parked', 'Zz Small Shop', 'zzsmall.example', undefined, undefined, 'p-2', 'web_visit'], ['Ada Abroad', 'Zz Abroad Ltd', null, undefined, undefined, 'p-3', 'web_visit']]);
    assert.ok(!sb.db.sales_targets.some(t => t.name === 'Zz Small Shop' || t.name === 'Zz Abroad Ltd'), 'no record for a parked company');
    assert.ok(sb.db.sales_targets.some(t => t.name === 'Zz Boutique') && sb.db.sales_targets.some(t => t.name === 'Zz Mystery Corp'));
    noAddress(sb);
    const again = await runVisitorPeoplePull(sb, { businessId: B, userId: U, force: true, now: NOW + 3600e3 });
    assert.deepEqual([again.body.counts.people_parked, again.body.counts.people_added, again.body.counts.already_in, sb.db.sales_people.length], [0, 0, 5, 5], 'idempotent');
    sb.db.sales_people.find(p => p.name === 'Pat Parked').name = 'Patricia Parked';
    const byId = await runVisitorPeoplePull(sb, { businessId: B, userId: U, force: true, now: NOW + 7200e3 });
    assert.deepEqual([byId.body.counts.people_parked, sb.db.sales_people.length], [0, 5], 'a renamed person is still known by Apollo contact id');
    const pv = await uploadVisitedPeople(sb, { businessId: B, userId: U, body: { text: 'First Name,Last Name,Title,Company Name,# Employees,Company Country\nNew,Person,Clerk,Zz Tiny Co,12,United States\n', preview: true }, now: new Date(NOW) });
    assert.deepEqual(pv.body.companies.map(c => [c.name, c.action, c.reason, c.people_parked]), [['Zz Tiny Co', 'would_park', 'under_500', 1]]);
    const people = await peopleSearch(sb, { businessId: B, query: { company: 'Small Shop' } });
    assert.deepEqual(people.body.people.map(p => [p.name, p.company, p.no_record, p.ties.map(t => t.label)]).sort(), [['Patricia Parked', { type: 'parked', id: null, name: 'Zz Small Shop' }, true, ['Zz Small Shop', 'Identified visitor']], ['Sam Parked', { type: 'parked', id: null, name: 'Zz Small Shop' }, true, ['Zz Small Shop', 'Identified visitor']]]);
    const pat = sb.db.sales_people.find(p => p.name === 'Patricia Parked');
    const add = await addRecordFromPerson(sb, { businessId: B, userId: U, id: pat.id, now: new Date(NOW) });
    assert.equal(add.status, 201, JSON.stringify(add.body));
    const shop = sb.db.sales_targets.find(t => t.name === 'Zz Small Shop');
    assert.deepEqual([add.body.record, add.body.people_moved, shop.source, shop.kind], [{ type: 'target', id: shop.id, name: 'Zz Small Shop' }, 2, 'web_visit', 'employer']);
    assert.match(shop.evidence, /^Identified visitors: 2 · added from People search 2026-10-20$/);
    assert.deepEqual(sb.db.sales_people.filter(p => p.target_id === shop.id).map(p => [p.name, p.company_type, p.company_name]).sort(), [['Patricia Parked', 'target', 'Zz Small Shop'], ['Sam Parked', 'target', 'Zz Small Shop']]);
    assert.equal((await addRecordFromPerson(sb, { businessId: B, userId: U, id: pat.id })).status, 409, 'already has a record');
    assert.equal((await addRecordFromPerson(sb, { businessId: B, userId: U, id: randomUUID() })).status, 404);
    assert.deepEqual((await peopleSearch(sb, { businessId: B, query: { company: 'Small Shop' } })).body.people.map(p => [p.no_record, p.company.type]), [[false, 'target'], [false, 'target']]);
    assert.equal(sb.db.sales_people.filter(p => p.company_type === 'parked' && !p.archived_at).length, 1, 'Ada stays parked');
  } finally { restore(); }
});

test('V3 People search: one list over the three tables with ties, has_email as a boolean only, name_partial for obfuscated finds; q / company / tie filters; a bad tie 400', async () => {
  const { sb, restore } = setup({ partner_contacts: [{ id: randomUUID(), business_id: B, goal_id: P.harbor, name: 'Pat Broker', title: 'Broker', email: 'pat@harborlane.example', source: 'apollo', last_activity_at: '2026-10-18T00:00:00Z' }], sales_prospect_state: [{ business_id: B, contact_id: 'c-1', name: 'Dev Patel', title: 'CHRO', company: 'Quarry Labs', opportunity_id: null, updated_at: '2026-10-17T00:00:00Z' }] });
  try {
    await runVisitPull(sb, { businessId: B, userId: U, now: NOW });
    const all = await peopleSearch(sb, { businessId: B, query: {} });
    assert.equal(all.status, 200);
    assert.deepEqual(all.body.people.map(p => p.name).sort(), ['Dev Patel', 'Larry F.', 'Mona Q.', 'Pat Broker', 'Ravi S.']);
    assert.ok(!JSON.stringify(all.body).includes('@'), 'has_email only');
    const larry = all.body.people.find(p => p.name === 'Larry F.');
    assert.deepEqual([larry.company.name, larry.ties.map(t => t.kind), larry.has_email, larry.name_partial], ['Nimbus Freight', ['company', 'visit'], false, true]);
    assert.equal(all.body.people.find(p => p.name === 'Pat Broker').has_email, true);
    assert.deepEqual((await peopleSearch(sb, { businessId: B, query: { q: 'nimbus' } })).body.people.length, 3);
    assert.deepEqual((await peopleSearch(sb, { businessId: B, query: { tie: 'visit' } })).body.people.length, 3);
    assert.deepEqual((await peopleSearch(sb, { businessId: B, query: { company: 'Harbor Lane' } })).body.people.map(p => p.name), ['Pat Broker']);
    assert.equal((await peopleSearch(sb, { businessId: B, query: { tie: 'friend' } })).status, 400);
  } finally { restore(); }
});

test('V6 undo on an auto-created signal: the target reads rejected (never deleted) with a notes line, its visit people archived, the signal back to new with auto false and no time window; the list shows auto', async () => {
  const { sb, restore } = setup();
  try {
    await runVisitPull(sb, { businessId: B, userId: U, now: NOW });
    const sig = sb.db.sales_signals.find(s => s.company_name === 'Nimbus Freight');
    const targetId = sig.target_id;
    const listed = await listSignals(sb, B, 'accepted');
    assert.ok(listed.find(s => s.id === sig.id).auto === true);
    const r = await undoSignal(sb, { businessId: B, userId: U, id: sig.id, now: new Date(NOW + 3 * 86400e3) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.signal.status, r.body.signal.auto, r.body.signal.target_id, r.body.archived.people], ['new', false, null, 3]);
    const t = sb.db.sales_targets.find(x => x.id === targetId);
    assert.deepEqual([t.status, /Auto-create undone from Signals/.test(t.research_notes)], ['rejected', true]);
    assert.ok(sb.db.sales_people.filter(p => p.target_id === t.id).every(p => p.archived_at));
    assert.equal((await peopleSearch(sb, { businessId: B, query: { q: 'nimbus' } })).body.people.length, 0, 'archived people leave the search');
    assert.equal((await undoSignal(sb, { businessId: B, userId: U, id: sig.id })).status, 409, 'now new - nothing to undo');
  } finally { restore(); }
});

// Stage 4: the injected input path - the same scoring / storage / signals / auto-create as a real pull with 0 visitor calls,
// no run row, no credit row; only V2b's people search reaches Apollo. The route never passes it (it reads force / trigger /
// backfill_days only).
test('injected visit: 0 visitor searches, no run or credit row, the company stored + created + auto-accepted, one people search', async () => {
  const { sb, restore } = setup();
  try {
    const start = apolloFixtureCalls.length;
    const r = await runVisitPull(sb, { businessId: B, userId: U, now: NOW, injected: { organizations: [ORGS.find(o => o.id === 'o-nimbus')], us_ids: ['o-nimbus'] } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.injected, r.body.calls, r.body.credits, r.body.counts.companies, r.body.counts.auto.created, r.body.counts.auto.searches, r.body.counts.auto.people], [true, 1, 0, 1, 1, 1, 3]);
    assert.deepEqual(apolloFixtureCalls.slice(start), ['POST /mixed_people/api_search']);
    assert.deepEqual([sb.db.visit_pull_runs.length, sb.db.apollo_credit_spend.length, sb.db.web_visits.length], [0, 0, 1]);
    const v = sb.db.web_visits[0], t = targets(sb)[0];
    assert.deepEqual([v.company_name, v.us_500, v.pulled_on, v.seen_from, v.seen_to, t.name, t.visit_id === v.id, t.source], ['Nimbus Freight', true, '2026-10-20', '2026-10-19', '2026-10-20', 'Nimbus Freight', true, 'web_visit']);
    assert.equal(sb.db.sales_signals[0].auto, true);
    const src = await import('node:fs').then(fs => fs.readFileSync(new URL('./visitPull.js', import.meta.url), 'utf8'));
    assert.match(src, /const \{ force = false, trigger = 'manual', backfill_days: backfillDays = null \} = req\.body \|\| \{\};/, 'the route reads three fields and nothing else');
  } finally { restore(); }
});

// FIX pipeline-quick-fixes-v1 A - POST goals/people: one person by hand.
test('addPerson: a partner -> partner_contacts, a target -> sales_people, a new company -> parked, a name that matches a live record lands on it; dupes 409; an email / phone in any field or an extra field -> 400', async () => {
  const { sb, restore } = setup();
  try {
    const r1 = await addPerson(sb, { businessId: B, userId: U, body: { name: 'Pat Partner', title: 'Broker', linkedin_url: 'https://www.linkedin.com/in/pat', company: { type: 'partner', id: P.harbor } } });
    assert.equal(r1.status, 201, JSON.stringify(r1.body));
    assert.deepEqual([r1.body.company, sb.db.partner_contacts.map(c => [c.goal_id, c.name, c.title, c.linkedin_url, c.source])], [{ type: 'partner', id: P.harbor, name: 'Harbor Lane' }, [[P.harbor, 'Pat Partner', 'Broker', 'https://www.linkedin.com/in/pat', 'manual']]]);
    const r2 = await addPerson(sb, { businessId: B, userId: U, body: { name: 'Ana Target', company: { type: 'target', id: T.quarry } } });
    assert.equal(r2.status, 201);
    assert.deepEqual(sb.db.sales_people.map(p => [p.company_type, p.target_id, p.name, p.source_note]), [['target', T.quarry, 'Ana Target', 'Added from Pipeline']]);
    assert.equal((await addPerson(sb, { businessId: B, userId: U, body: { name: 'ana target', company: { type: 'target', id: T.quarry } } })).status, 409, 'same name again');
    const r3 = await addPerson(sb, { businessId: B, userId: U, body: { name: 'New Person', title: 'Owner', company: { name: 'Zz Brand New', domain: 'zzbrandnew.example' } } });
    assert.equal(r3.status, 201, JSON.stringify(r3.body));
    assert.deepEqual(r3.body.company, { type: 'parked', id: null, name: 'Zz Brand New' });
    assert.deepEqual(sb.db.sales_people.filter(p => p.company_type === 'parked').map(p => [p.company_name, p.company_domain, p.name, p.title]), [['Zz Brand New', 'zzbrandnew.example', 'New Person', 'Owner']]);
    assert.equal((await addPerson(sb, { businessId: B, userId: U, body: { name: 'New Person', company: { name: 'zz brand new' } } })).status, 409, 'parked twice');
    const r4 = await addPerson(sb, { businessId: B, userId: U, body: { name: 'Lee Match', company: { name: 'Quarry Labs' } } });
    assert.deepEqual([r4.status, r4.body.company], [201, { type: 'target', id: T.quarry, name: 'Quarry Labs' }], 'a typed name that matches a live record lands on it');
    for (const body of [
      { name: 'Jo', email: 'jo@zz.example', company: { type: 'target', id: T.quarry } },
      { name: 'Jo', phone: '312 555 0100', company: { type: 'target', id: T.quarry } },
      { name: 'Jo (jo@zz.example)', company: { type: 'target', id: T.quarry } },
      { name: 'Jo', title: 'call 312-555-0100', company: { type: 'target', id: T.quarry } },
      { name: 'Jo', linkedin_url: 'https://example.com/jo', company: { type: 'target', id: T.quarry } },
      { name: 'Jo' }, { company: { type: 'target', id: T.quarry } },
    ]) assert.equal((await addPerson(sb, { businessId: B, userId: U, body })).status, 400, JSON.stringify(body));
    assert.equal((await addPerson(sb, { businessId: B, userId: U, body: { name: 'Jo', company: { type: 'target', id: randomUUID() } } })).status, 404);
    noAddress(sb);
  } finally { restore(); }
});
