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
import { autoCreateSignal, uploadVisitedPeople, peopleSearch } from './visitorRoutes.js';
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
  'First Name,Last Name,Title,Company,Email,Company Domain,Person Linkedin Url,City,State,Last Visit,Page Views,Pages Visited,Phone',
  'Jean,Horton,VP Human Resources,Zz ADP,jean@zzadp.example,zzadp.example,https://www.linkedin.com/in/jean-h,Chicago,IL,2026-10-17,4,"/pricing, /employer-partners",312-555-0100',
  'Sam,Rivera,Head of People,Zz ADP,,zzadp.example,,,,2026-10-19,1,/benefits,',
  'Margo,R.,Benefits Manager,Harbor Lane,,,,Houston,TX,10/18/2026,2,/,',
  'Ana,Example,Director,Quarry Labs,,,,,,2026-10-19,1,/,',
].join('\n');

test('V2a Visited People export: unknown company -> new employer target (source web_visit) with its people; a partner match -> partner_contacts; a target match -> sales_people; obfuscated names kept; the email and phone columns never land; re-upload adds nobody twice; the reply carries names only', async () => {
  const { sb, restore } = setup();
  try {
    const r = await uploadVisitedPeople(sb, { businessId: B, userId: U, body: { text: CSV }, now: new Date(NOW) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.companies.map(c => [c.name, c.action, c.type, c.people_added, c.already_in]), [['Zz ADP', 'created', 'target', 2, 0], ['Harbor Lane', 'matched', 'partner', 1, 0], ['Quarry Labs', 'matched', 'target', 1, 0]]);
    const adp = sb.db.sales_targets.find(t => t.name === 'Zz ADP');
    assert.deepEqual([adp.kind, adp.source, adp.channel, adp.source_kind], ['employer', 'web_visit', 'website_visit', 'website']);
    assert.match(adp.evidence, /^Identified visitors: 2 \(Apollo Visited People\) · last visit 2026-10-19$/);
    const adpPeople = sb.db.sales_people.filter(p => p.target_id === adp.id);
    assert.deepEqual(adpPeople.map(p => [p.name, p.title, p.location, p.linkedin_url, p.source_kind]), [['Jean Horton', 'VP Human Resources', 'Chicago, IL', 'https://www.linkedin.com/in/jean-h', 'web_visit'], ['Sam Rivera', 'Head of People', null, null, 'web_visit']]);
    assert.match(adpPeople[0].note, /^Identified visitor · 2026-10-17 · pages \/pricing, \/employer-partners$/);
    assert.deepEqual(sb.db.partner_contacts.map(c => [c.goal_id, c.name, c.title, c.source]), [[P.harbor, 'Margo R.', 'Benefits Manager', 'manual']]);
    assert.deepEqual(sb.db.sales_people.filter(p => p.target_id === T.quarry).map(p => p.name), ['Ana Example']);
    assert.ok(!ADDRESS.test(JSON.stringify(sb.db)) && !/555/.test(humanText(sb.db.sales_people)) && !ADDRESS.test(JSON.stringify(r.body)), humanText(sb.db.sales_people));
    const again = await uploadVisitedPeople(sb, { businessId: B, userId: U, body: { text: CSV }, now: new Date(NOW) });
    assert.deepEqual(again.body.companies.map(c => [c.action, c.people_added, c.already_in]), [['matched', 0, 2], ['matched', 0, 1], ['matched', 0, 1]]);
    assert.equal((await uploadVisitedPeople(sb, { businessId: B, userId: U, body: { text: 'a,b\n1,2' } })).status, 400);
    assert.equal((await uploadVisitedPeople(sb, { businessId: B, userId: U, body: {} })).status, 400);
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
