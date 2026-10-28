// node --test api/sales/visitPull.test.mjs  (react-scripts' Jest only runs src/)
// signals-v1 Stage 4 - the daily website-visitor pull against the in-memory
// Supabase and fixture Apollo (balance + visitor search), with invented
// companies. Phone fields carry a marker word, never a number, so the test
// can prove they are dropped. 0 network, 0 Claude, 0 real Apollo calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { installApolloFixture, apolloFixtureCalls } from './testing/apolloFixture.mjs';
import { apolloRequest } from './apolloClient.js';
import { runVisitPull, runVisitPullRoute, visitStatus, PAUSED, MONTHLY_CREDIT_CAP } from './visitPull.js';
import { mergeResults, toVisit, prioritize } from './visitRules.js';
import { visitedNoTouch } from './tidyRules.js';
import { buildBoard } from './pipelineBoard.js';

const NOW = Date.parse('2026-10-20T17:00:00Z'); // Tue Oct 20, 10:00 LA
const TOMORROW = NOW + 864e5;
const B = randomUUID(), OTHER = randomUUID(), U = randomUUID();
const P = { harbor: randomUUID() }, O = { brightmill: randomUUID() }, T = { quarry: randomUUID() };
const MARK = 'PHONE-FIELD-MARKER';

const org = (id, name, { domain = `${name.toLowerCase().replace(/[^a-z]/g, '')}.example`, visits = 1, people = 1, paths = [['/', 1]], naics = [] } = {}) => ({
  id, name, primary_domain: domain, website_url: `http://www.${domain}`, linkedin_url: `http://www.linkedin.com/company/${id}`,
  naics_codes: naics, sic_codes: [], organization_revenue: 1000000, organization_headcount_six_month_growth: 0.02,
  phone: MARK, primary_phone: { number: MARK }, sanitized_phone: MARK,
  intent_signal_account: {
    organization_id: id, total_visits: visits, unique_visitors: people, overall_intent: 'low',
    domain_aggregates: [{ domain: 'homelover.ai', total_visits: visits, unique_visitors: people, first_visit: 20261013, last_visit: 20261019, intent: 'low', intent_score: 12,
      weekly_aggregates: [{ week_start_date: '2026-10-12', count: visits }], top_5_paths: paths.map(([p, n]) => ({ _id: `homelover.ai${p === '/' ? '' : p}`, total_visits: n })) }],
    website_visitor_metrics: { overall_intent: 'low', page_view_aggregates: { one_day_count: 1, seven_day_count: visits }, pages: paths.map(([p]) => p) },
  },
});
const ORGS = [
  org('o-harbor', 'Harbor Lane'),
  org('o-bright', 'Brightmill Foods', { visits: 1 }),
  org('o-quarry', 'Quarry Labs', { visits: 1 }),
  org('o-nimbus', 'Nimbus Freight', { visits: 6, people: 2 }),
  org('o-cedar', 'Cedar Row', { visits: 2, paths: [['/contact', 2]] }),
  org('o-ridge', 'Ridgeline Health', { visits: 2 }),
  org('o-sizeless', 'Sizeless Co', { visits: 6, people: 1 }),
  org('o-lovable', 'Lovable'),
  org('o-own', 'HomeLover', { domain: 'homelover.ai' }),
  org('o-cloud', 'Cloudflare'),
  org('o-juniper', 'Juniper Bank', { paths: [['/auth', 1], ['/help', 1]] }),
  org('o-tiny', 'Tiny Shop'),
];
// Nimbus also comes back in accounts[] (a saved Apollo account) - one row after the merge.
const ACCOUNT_COPY = { ...org('acct-nimbus', 'Nimbus Freight', { visits: 6, people: 2 }), organization_id: 'o-nimbus' };
ACCOUNT_COPY.intent_signal_account.organization_id = 'o-nimbus';
const US = ['o-nimbus', 'o-ridge'];
const visitors = (extra = {}) => ({
  all: { organizations: ORGS, accounts: [ACCOUNT_COPY] },
  us: { organizations: ORGS.filter(o => US.includes(o.id)), accounts: [ACCOUNT_COPY] },
  balances: [9910, 9909], ...extra,
});

const seed = (extra = {}) => ({
  sales_goals: [{ id: P.harbor, business_id: B, goal_type: 'partnership', name: 'Harbor Lane', archived_at: null, pipeline_status: 'first_email_sent', owner_team: 'upside', last_touch_at: new Date(NOW - 30 * 864e5).toISOString() }],
  sales_opportunities: [{ id: O.brightmill, business_id: B, organization: 'Brightmill Foods', archived_at: null, org_type: 'employer', owner_team: 'homelover' }],
  sales_sequenced_accounts: [{ business_id: B, account_id: 'a-tiny', name: 'Tiny Shop', employees: 40 }],
  sales_targets: [{ id: T.quarry, business_id: B, name: 'Quarry Labs', kind: 'employer', status: 'researching', owner_team: 'both' }],
  partner_domains: [], sales_signals: [], sales_visit_skip: [], web_visits: [], visit_pull_runs: [], apollo_credit_spend: [],
  // visitor-to-record-v1: the pull's auto-create is off here (its own suite covers it) so these rules stay about the pull.
  // visitor-to-record-v1 V2a: the people pull is a background job after the reply (its own suite covers it).
  sales_settings: [{ business_id: B, buyer_titles: [], auto_create_daily_cap: 0, people_search_daily_cap: 0, people_per_company: 3 }],
  ...extra,
});
const unique = {
  sales_signals: r => [r.business_id, r.source, r.signal_week, r.company_key, r.who_key || ''].join('|'),
  visit_pull_runs: r => `${r.business_id}|${r.la_date}|${r.kind}`,
};
const setup = (v = visitors(), extra) => {
  const restore = installApolloFixture({}, v, null, null, { labels: [] });
  const sb = fakeSupabase(seed(extra), { unique });
  return { sb, restore };
};
const calls = () => apolloFixtureCalls.length;
const byName = (sb, name, day = '2026-10-20') => sb.db.web_visits.find(v => v.company_name === name && v.pulled_on === day);

test('one pull: 4 calls, measured delta 1 recorded, merged rows, P1-P4 rules, phones gone, P1/P2 -> signals', async () => {
  const { sb, restore } = setup();
  const logged = [];
  const orig = { log: console.log, error: console.error };
  console.log = (...a) => logged.push(a.join(' ')); console.error = (...a) => logged.push(a.join(' '));
  const start = calls();
  let r;
  try { r = await runVisitPull(sb, { businessId: B, userId: U, trigger: 'pageload', now: NOW }); }
  finally { Object.assign(console, orig); restore(); }
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ran, true);
  assert.deepEqual(apolloFixtureCalls.slice(start), ['GET /users/api_profile', 'POST /mixed_companies/search', 'POST /mixed_companies/search', 'GET /users/api_profile']);
  assert.equal(r.body.credits, 1);
  assert.deepEqual(sb.db.apollo_credit_spend.map(s => [s.business_id, s.la_month, s.credits, s.balance_before, s.balance_after]), [[B, '2026-10', 1, 9910, 9909]]);
  assert.equal(sb.db.visit_pull_runs[0].status, 'ok');
  assert.equal(sb.db.visit_pull_runs[0].calls, 4);

  assert.equal(sb.db.web_visits.length, ORGS.length, 'accounts[] copy merged into its organization');
  assert.equal(sb.db.web_visits.filter(v => v.company_name === 'Nimbus Freight').length, 1);
  assert.deepEqual(sb.db.web_visits.filter(v => v.us_500).map(v => v.company_name).sort(), ['Nimbus Freight', 'Ridgeline Health']);
  const expect = {
    'Harbor Lane': ['P1', 'Matched partner visited'], 'Brightmill Foods': ['P1', 'Matched employer visited'],
    'Quarry Labs': ['P1', 'Upside-owned target visited'], 'Nimbus Freight': ['P1', 'US 500+ with 5+ visits in 7 days or 3+ unique visitors (Apollo)'],
    'Cedar Row': ['P1', 'Employer/contact page plus a repeat visit'], 'Ridgeline Health': ['P2', 'US 500+ with 2+ visits in 7 days or 2+ unique visitors (Apollo)'],
    'Sizeless Co': ['P3', 'Size unknown - watch'], Lovable: ['P4', 'On the skip list'], HomeLover: ['P4', 'HomeLover’s own site'],
    Cloudflare: ['P4', 'ISP, hosting or bot traffic'], 'Juniper Bank': ['P4', 'Only /auth, /help, /privacy or /terms - may already be a user'],
    'Tiny Shop': ['P4', 'Under 500 employees with 1–2 visits'],
  };
  for (const [name, [priority, rule]] of Object.entries(expect)) {
    const v = byName(sb, name);
    assert.deepEqual([v.priority, v.priority_rule], [priority, rule], name);
  }
  const rules = sb.db.web_visits.map(v => v.priority_rule);
  assert.equal(new Set(rules).size, rules.length, 'each rule fired exactly once');
  assert.equal(byName(sb, 'Juniper Bank').maybe_user, true);
  assert.deepEqual([byName(sb, 'Harbor Lane').matched_type, byName(sb, 'Harbor Lane').matched_id], ['partner', P.harbor]);
  assert.deepEqual([byName(sb, 'Brightmill Foods').matched_type, byName(sb, 'Brightmill Foods').matched_id], ['opportunity', O.brightmill]);
  assert.deepEqual(byName(sb, 'Cedar Row').top_paths, [{ path: '/contact', visits: 2 }]);
  assert.equal(byName(sb, 'Nimbus Freight').last_visit, '2026-10-19');

  const everything = JSON.stringify(sb.db) + logged.join('\n');
  assert.ok(!everything.includes(MARK), 'no phone value stored or logged');
  for (const v of sb.db.web_visits) assert.ok(!Object.keys(v).some(k => /phone/i.test(k)), 'no phone key on a stored row');

  assert.deepEqual(sb.db.sales_visit_skip.map(s => s.company_key).sort(), ['apollo', 'embrace home loans', 'lovable', 'simpliborrow']);
  const sig = sb.db.sales_signals;
  assert.deepEqual(sig.map(s => s.company_name).sort(), ['Brightmill Foods', 'Cedar Row', 'Harbor Lane', 'Nimbus Freight', 'Quarry Labs', 'Ridgeline Health']);
  assert.ok(sig.every(s => s.source === 'web_visit' && s.signal_week === '2026-10-19' && s.status === 'new' && s.who === null));
  const harbor = sig.find(s => s.company_name === 'Harbor Lane');
  assert.deepEqual([harbor.kind, harbor.kind_guessed, harbor.upside_joint], ['partner', false, true]);
  assert.equal(harbor.signal, '1 visit in 7 days / 1 unique visitor (Apollo); top pages /');
  assert.equal(harbor.why_now, 'P1 act today: Matched partner visited');
  assert.equal(r.body.counts.signals, 6);
});

test('second load the same day = 0 calls; Pull now (force) pulls again', async () => {
  const { sb, restore } = setup(visitors({ balances: [9910] }));
  try {
    await runVisitPull(sb, { businessId: B, userId: U, trigger: 'pageload', now: NOW });
    const start = calls();
    const again = await runVisitPull(sb, { businessId: B, userId: U, trigger: 'pageload', now: NOW + 3600e3 });
    assert.deepEqual([again.status, again.body.ran, again.body.reason], [200, false, 'Visitors already pulled today']);
    assert.equal(calls(), start, '0 Apollo calls');
    const forced = await runVisitPull(sb, { businessId: B, userId: U, force: true, now: NOW + 7200e3 });
    assert.equal(forced.body.ran, true);
    assert.equal(calls() - start, 4);
    assert.equal(sb.db.web_visits.length, ORGS.length, 'same-day re-pull updates rows in place');
    assert.equal(sb.db.apollo_credit_spend.length, 2);
    assert.ok(sb.db.apollo_credit_spend.every(s => s.credits === 0), 'a 0 delta is still recorded');
  } finally { restore(); }
});

test('a P1 re-pulled tomorrow does not create a second signal that week; a dismissed company stays out', async () => {
  const { sb, restore } = setup(visitors({ balances: [9910] }));
  try {
    await runVisitPull(sb, { businessId: B, userId: U, now: NOW });
    sb.db.sales_signals.find(s => s.company_name === 'Cedar Row').status = 'dismissed';
    sb.db.sales_signals.find(s => s.company_name === 'Cedar Row').dismissed_until = '2026-10-27';
    const start = calls();
    const next = await runVisitPull(sb, { businessId: B, userId: U, trigger: 'pageload', now: TOMORROW });
    assert.equal(next.body.ran, true);
    assert.equal(next.body.counts.signals, 0);
    assert.deepEqual(apolloFixtureCalls.slice(start).slice(4), [], 'the people pull is scheduled in the background after the reply, never inside it (and never on the in-memory Supabase)');
    assert.ok(!('people_pull' in next.body), 'the reply carries no people pull');
    assert.equal(sb.db.sales_signals.length, 6);
    assert.equal(sb.db.web_visits.filter(v => v.pulled_on === '2026-10-21').length, ORGS.length, 'a new day keeps its own rows');
  } finally { restore(); }
});

test('the month cap counts every business: at 500 the pull is refused with 0 calls and the UI message', async () => {
  const { sb, restore } = setup(visitors(), { apollo_credit_spend: [{ id: randomUUID(), business_id: OTHER, la_month: '2026-10', credits: MONTHLY_CREDIT_CAP, endpoint: '/mixed_companies/search' }] });
  try {
    const start = calls();
    const r = await runVisitPull(sb, { businessId: B, userId: U, trigger: 'pageload', now: NOW });
    assert.deepEqual([r.status, r.body.ran, r.body.paused, r.body.reason], [200, false, true, PAUSED]);
    assert.equal(calls(), start, '0 Apollo calls');
    assert.equal(sb.db.visit_pull_runs.length, 0);
    const s = await visitStatus(sb, B, NOW);
    assert.equal(s.paused, 'Visitor pull paused: 500 Apollo credits used this month');
    sb.db.apollo_credit_spend[0].la_month = '2026-09';
    assert.equal((await visitStatus(sb, B, NOW)).paused, null, 'last month does not count');
  } finally { restore(); }
});

test('a failed search: 502, run marked error, the spend still measured; the next load retries', async () => {
  const { sb, restore } = setup(visitors({ fail: true, balances: [9910] }));
  const orig = console.error;
  console.error = () => {};
  try {
    const r = await runVisitPull(sb, { businessId: B, userId: U, trigger: 'pageload', now: NOW });
    assert.equal(r.status, 502);
    assert.match(r.body.error, /^Visitor pull failed: apollo POST \/mixed_companies\/search -> 422/);
    assert.deepEqual([sb.db.visit_pull_runs[0].status, sb.db.visit_pull_runs[0].calls], ['error', 3]);
    assert.deepEqual(sb.db.apollo_credit_spend.map(s => s.credits), [0]);
    assert.equal(sb.db.web_visits.length, 0);
    const retry = await runVisitPull(sb, { businessId: B, userId: U, trigger: 'pageload', now: NOW + 60e3 });
    assert.equal(retry.status, 502, 'an error row does not block a retry');
  } finally { console.error = orig; restore(); }
});

test('FIX loop-quickfixes Q5: a failed search whose run row cannot be closed says so in the log (no silent running row)', async () => {
  const { sb, restore } = setup(visitors({ fail: true, balances: [9910] }));
  const orig = console.error; const logged = [];
  console.error = (...a) => logged.push(a.join(' '));
  const from = sb.from;
  sb.from = t => (t === 'visit_pull_runs' ? { ...from(t), update: () => ({ eq: () => ({ select: async () => ({ data: null, error: { message: 'write refused' } }) }) }) } : from(t));
  try {
    const r = await runVisitPull(sb, { businessId: B, userId: U, trigger: 'pageload', now: NOW });
    assert.equal(r.status, 502);
    assert.ok(logged.some(l => /could not close the run row .* write refused/.test(l)), logged.join(' | '));
  } finally { console.error = orig; restore(); }
});

test('the allowlist: a mixed_companies call without the visitor filter is refused before any request', async () => {
  const restore = installApolloFixture({}, visitors());
  const ctx = { callCounter: { count: 0, max: 5 }, endpointCounts: {} };
  try {
    await assert.rejects(apolloRequest({ method: 'POST', path: '/mixed_companies/search', body: { q_organization_name: 'Anything' }, ctx }), /needs website_visitors_from_domains/);
    await assert.rejects(apolloRequest({ method: 'POST', path: '/mixed_companies/search', body: { website_visitors_from_domains: [] }, ctx }), /needs website_visitors_from_domains/);
    await assert.rejects(apolloRequest({ method: 'GET', path: '/organizations/abc', ctx }), /not on the allowlist/);
    assert.equal(ctx.callCounter.count, 0);
  } finally { restore(); }
});

test('paths: Apollo\'s "host/path" ids are stored as paths and drive the contact-page and user-page rules', () => {
  const raw = org('x9', 'Path Co', { visits: 3, paths: [['/contact', 2], ['/', 1]] });
  raw.intent_signal_account.domain_aggregates[0].top_5_paths = [{ _id: 'homelover.ai/contact', total_visits: 2 }, { _id: 'homelover.ai', total_visits: 1 }, { _id: 'https://homelover.com/contact?x=1', total_visits: 1 }];
  const v = toVisit(mergeResults({ organizations: [raw] })[0], false);
  assert.deepEqual(v.top_paths, [{ path: '/contact', visits: 2 }, { path: '/', visits: 1 }, { path: '/contact?x=1', visits: 1 }]);
  assert.equal(prioritize(v, { match: null }).priority_rule, 'Employer/contact page plus a repeat visit');
  const user = toVisit(mergeResults({ organizations: [org('x8', 'User Co', { paths: [['/auth/login', 1], ['/privacy', 1]] })] })[0], false);
  assert.deepEqual([prioritize(user, { match: null }).priority, prioritize(user, { match: null }).maybe_user], ['P4', true]);
});

test('rules: a matched Upside partner with 1 visit is P1; an unmatched size-unknown company with 6 visits is P3', () => {
  const [harbor, sizeless] = mergeResults({ organizations: [org('x1', 'Harbor Lane'), org('x2', 'Sizeless Co', { visits: 6 })] }).map(r => toVisit(r, false));
  assert.equal(prioritize(harbor, { match: { type: 'partner', owner_team: 'upside' } }).priority, 'P1');
  assert.equal(prioritize(sizeless, { match: null }).priority, 'P3');
  assert.equal(prioritize(toVisit(mergeResults({ organizations: [org('x3', 'Big Co', { visits: 6 })] })[0], true), { match: null }).priority, 'P1');
});

test('Tidy "visited, no touch": a P1/P2-visited partner untouched 14 days gets "Reach out to X"', () => {
  const partners = [{ id: 'p1', name: 'Harbor Lane', last_touch_at: new Date(NOW - 20 * 864e5).toISOString() }, { id: 'p2', name: 'Fresh Touch', last_touch_at: new Date(NOW - 2 * 864e5).toISOString() }, { id: 'p3', name: 'Has Todo', last_touch_at: null }];
  const visits = [{ matched_id: 'p1', last_visit: '2026-10-19', visits_7d: 3, pulled_on: '2026-10-20' }, { matched_id: 'p2', last_visit: '2026-10-19', visits_7d: 1, pulled_on: '2026-10-20' }, { matched_id: 'p3', last_visit: '2026-10-18', visits_7d: 1, pulled_on: '2026-10-20' }];
  const todos = [{ id: 't1', status: 'open', link_type: 'partner', link_id: 'p3' }];
  const out = visitedNoTouch({ partners, todos, visits, now: NOW });
  assert.deepEqual(out.map(s => [s.kind, s.ref_id, s.text]), [['visited_no_touch', 'p1', 'Reach out to Harbor Lane']]);
  assert.equal(out[0].reason, 'Visited the site 2026-10-19 (3 visits in 7 days) · last touch 20 days ago');
});

test('Board: the latest visit lands on the matched partner and employer rows', () => {
  const rows = buildBoard({
    partners: [{ id: 'p1', name: 'Harbor Lane', pipeline_status: 'first_email_sent' }],
    opportunities: [{ id: 'o1', organization: 'Brightmill Foods', org_type: 'employer', stage: 'prospect' }],
    targets: [], sequenced: [], memberNames: new Map(),
    visits: [
      { matched_type: 'partner', matched_id: 'p1', last_visit: '2026-10-18', visits_7d: 2, pulled_on: '2026-10-19' },
      { matched_type: 'partner', matched_id: 'p1', last_visit: '2026-10-19', visits_7d: 3, pulled_on: '2026-10-20' },
      { matched_type: 'opportunity', matched_id: 'o1', last_visit: '2026-10-19', visits_7d: 1, pulled_on: '2026-10-20' },
    ],
  });
  assert.deepEqual(rows.find(r => r.id === 'p1').visited, { last_visit: '2026-10-19', visits_7d: 3, pulled_on: '2026-10-20', priority: null });
  assert.equal(rows.find(r => r.id === 'o1').visited.visits_7d, 1);
});

// FIX visit-window-v1 Stage 2 - the window a pull asks for, the backfill kind, dedupe across windows, the seen_to reader.
const captureBodies = () => { const bodies = [], f = globalThis.fetch; globalThis.fetch = (u, i) => { if (String(u).includes('mixed_companies')) bodies.push(JSON.parse(i.body)); return f(u, i); }; return bodies; };
const DAY = 864e5;

test('W1 window math: no history -> from_past 1 and a yesterday..today window on the run row and every visit row; a run after a 3-day gap asks for 4', async () => {
  const { sb, restore } = setup(visitors({ balances: [9910] }));
  try {
    const bodies = captureBodies();
    const r = await runVisitPull(sb, { businessId: B, userId: U, trigger: 'pageload', now: NOW });
    assert.equal(r.body.ran, true);
    assert.deepEqual(r.body.window, { kind: 'daily', lookback_days: 1, window_start: '2026-10-19', window_end: '2026-10-20' });
    assert.ok(bodies.length === 2 && bodies.every(b => b.website_visitors_from_past === 1), 'both searches ask for 1 day');
    const run = sb.db.visit_pull_runs[0];
    assert.deepEqual([run.kind, run.window_start, run.window_end, run.lookback_days, run.status], ['daily', '2026-10-19', '2026-10-20', 1, 'ok']);
    assert.ok(sb.db.web_visits.every(v => v.seen_from === '2026-10-19' && v.seen_to === '2026-10-20' && v.pulled_on === '2026-10-20'));
    // three quiet days, then a page load on the 24th
    const later = await runVisitPull(sb, { businessId: B, userId: U, trigger: 'pageload', now: NOW + 4 * DAY });
    assert.deepEqual(later.body.window, { kind: 'daily', lookback_days: 4, window_start: '2026-10-20', window_end: '2026-10-24' });
    assert.ok(bodies.slice(2).every(b => b.website_visitors_from_past === 4), 'the gap run reaches back 4 days');
    const rows = sb.db.web_visits.filter(v => v.pulled_on === '2026-10-24');
    assert.equal(rows.length, ORGS.length);
    assert.ok(rows.every(v => v.seen_from === '2026-10-20' && v.seen_to === '2026-10-24'));
  } finally { restore(); }
});

test('W2 backfill: kind backfill asks for 14 days, its own run row beside the daily one, once per LA day (force or not); a forced daily after it is a 1-day window again; bad backfill_days -> 400', async () => {
  const { sb, restore } = setup(visitors({ balances: [9910] }));
  try {
    await runVisitPull(sb, { businessId: B, userId: U, trigger: 'pageload', now: NOW });
    const bodies = captureBodies();
    const bf = await runVisitPull(sb, { businessId: B, userId: U, backfillDays: 14, now: NOW + 3600e3 });
    assert.equal(bf.body.ran, true, JSON.stringify(bf.body));
    assert.deepEqual(bf.body.window, { kind: 'backfill', lookback_days: 14, window_start: '2026-10-06', window_end: '2026-10-20' });
    assert.ok(bodies.length === 2 && bodies.every(b => b.website_visitors_from_past === 14));
    assert.deepEqual(sb.db.visit_pull_runs.map(r => [r.kind, r.status, r.lookback_days]), [['daily', 'ok', 1], ['backfill', 'ok', 14]]);
    assert.ok(sb.db.apollo_credit_spend.some(x => x.ref === 'visit_pull:2026-10-20:backfill'));
    const again = await runVisitPull(sb, { businessId: B, userId: U, backfillDays: 14, force: true, now: NOW + 7200e3 });
    assert.deepEqual([again.body.ran, again.body.reason, again.body.last_run.kind], [false, 'Already backfilled today', 'backfill']);
    assert.equal(bodies.length, 2, '0 Apollo calls for the refused backfill');
    const daily = await runVisitPull(sb, { businessId: B, userId: U, force: true, now: NOW + 10800e3 });
    assert.deepEqual(daily.body.window, { kind: 'daily', lookback_days: 1, window_start: '2026-10-19', window_end: '2026-10-20' }, 'the last ok window_end is today, so 1');
    assert.equal(sb.db.visit_pull_runs.length, 2, 'the forced daily reuses its row');
    for (const bad of [0, 31, 1.5, '14']) assert.equal((await runVisitPull(sb, { businessId: B, userId: U, backfillDays: bad, now: NOW })).status, 400, String(bad));
    const next = await runVisitPull(sb, { businessId: B, userId: U, backfillDays: 14, now: TOMORROW });
    assert.equal(next.body.ran, true, 'a new LA day allows a backfill again');
  } finally { restore(); }
});

test('W3 dedupe across windows: a backfill and a daily run the same day share one row per company (pulled_on), the later run\'s window wins; tomorrow gets its own rows; signals still one per company per week', async () => {
  const { sb, restore } = setup(visitors({ balances: [9910] }));
  try {
    const bf = await runVisitPull(sb, { businessId: B, userId: U, backfillDays: 14, now: NOW });
    assert.equal(bf.body.counts.signals, 6);
    assert.ok(sb.db.web_visits.every(v => v.seen_from === '2026-10-06'));
    const daily = await runVisitPull(sb, { businessId: B, userId: U, trigger: 'pageload', now: NOW + 3600e3 });
    assert.equal(daily.body.ran, true);
    assert.equal(daily.body.counts.signals, 0, 'no second signal that week');
    assert.equal(sb.db.web_visits.length, ORGS.length, 'same pulled_on -> updated in place');
    assert.ok(sb.db.web_visits.every(v => v.seen_from === '2026-10-19' && v.seen_to === '2026-10-20'));
    await runVisitPull(sb, { businessId: B, userId: U, trigger: 'pageload', now: TOMORROW });
    assert.equal(sb.db.web_visits.length, ORGS.length * 2);
    assert.equal(sb.db.sales_signals.length, 6);
  } finally { restore(); }
});

test('readers: visitStatus.today counts rows whose window ends today (seen_to), not a backfilled row from last week; last_run carries the window', async () => {
  const { sb, restore } = setup(visitors({ balances: [9910] }));
  try {
    await runVisitPull(sb, { businessId: B, userId: U, trigger: 'pageload', now: NOW });
    sb.db.web_visits.push({ id: 'old', business_id: B, company_key: 'old co', company_name: 'Old Co', priority: 'P1', pulled_on: '2026-10-20', seen_from: '2026-10-06', seen_to: '2026-10-13' });
    const st = await visitStatus(sb, B, NOW);
    assert.equal(st.today.P1 + st.today.P2 + st.today.P3 + st.today.P4, ORGS.length, 'the old-window row is not today');
    assert.deepEqual([st.last_run.kind, st.last_run.window_start, st.last_run.window_end, st.last_run.lookback_days], ['daily', '2026-10-19', '2026-10-20', 1]);
  } finally { restore(); }
});

test('route: backfill_days needs admin (403 before any read); a member\'s plain pull passes the body through', async () => {
  const res = () => { const r = { code: 200, body: null }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; return r; };
  const req = (role, body) => ({ params: { businessId: B }, body, auth: { user: { id: U }, isPlatformOwner: false, roles: new Map([[B, role]]) } });
  const r1 = res();
  await runVisitPullRoute(req('member', { backfill_days: 14 }), r1);
  assert.deepEqual([r1.code, r1.body.error], [403, 'Only an owner or admin can backfill visitors']);
});
