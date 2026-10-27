// node --test api/sales/intentScoreRun.test.mjs  (react-scripts' Jest only runs src/)
// intent-score-v1 Stage 2 - the gatherer, the recompute runner (idempotent, snapshot, stale rows), the hook, the
// scores routes (filters, admin gate, CSV without an address), the Brief. In-memory Supabase, invented companies
// on .example; fixture people carry an email ON PURPOSE to prove it never lands in a row, the CSV or the Brief.
// 0 network, 0 Claude, 0 Apollo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { gatherInputs, recomputeScores, recomputeIfStale, scheduleRecompute, recomputeInFlight, isNamedReferral, mergeWeights, latestTouch, STALE_HOURS } from './intentScoreRun.js';
import { listScores, parseFilters, filterScoreRows, scoresCsv, recomputeRoute, exportScoresRoute, needsTouch } from './scoresRoutes.js';
import { companyBrief, briefLines } from './companyBrief.js';
import { DEFAULT_WEIGHTS } from './intentScore.js';

const NOW = Date.parse('2026-10-27T18:00:00Z'); // Tue Oct 27, 11:00 LA
const DAY = 864e5;
const ago = d => new Date(NOW - d * DAY).toISOString();
const day = d => ago(d).slice(0, 10);
const B = randomUUID(), OTHER = randomUUID(), JACK = randomUUID(), CYRUS = randomUUID();
const ID = { upside: randomUUID(), harbor: randomUUID(), hilton: randomUUID(), ixl: randomUUID(), ixlTarget: randomUUID(), quarry: randomUUID(), gone: randomUUID(), live: randomUUID(), lost: randomUUID() };
const ADDRESS = /[^\s@<>()"]+@[^\s@<>()"]+\.[a-z]{2,}/i;

const seed = (extra = {}) => ({
  business_members: [{ business_id: B, user_id: JACK, name: 'Jack Carlson', role: 'owner' }, { business_id: B, user_id: CYRUS, name: 'Cyrus Test', role: 'member' }],
  sales_settings: [{ business_id: B, buyer_titles: ['VP People', 'CHRO'], score_weights: null }],
  sales_goals: [
    { id: ID.upside, business_id: B, goal_type: 'partnership', name: 'Upside Benefits', pipeline_status: 'live', owner_user_id: JACK, owner_team: 'homelover', category: '2. PEO', archived_at: null, last_touch_at: ago(2), source_kind: 'inbound' },
    { id: ID.harbor, business_id: B, goal_type: 'partnership', name: 'Harbor Lane', pipeline_status: 'meeting_set', owner_user_id: CYRUS, owner_team: 'homelover', category: '4. Brokers', archived_at: null, last_touch_at: ago(40), source_kind: 'partner_referral', source_partner_id: ID.upside, source_person: 'Brad', source_set_by: JACK },
    { id: ID.gone, business_id: B, goal_type: 'partnership', name: 'Gone Co', pipeline_status: 'not_started', archived_at: ago(1), source_kind: 'unknown' },
    { id: ID.live, business_id: B, goal_type: 'partnership', name: 'Live Partner', pipeline_status: 'proposal_pilot', owner_user_id: JACK, owner_team: 'homelover', category: '1. x', archived_at: null, last_touch_at: ago(1), source_kind: 'inbound' },
  ],
  sales_opportunities: [
    { id: ID.hilton, business_id: B, organization: 'Hilton Example', stage: 'contacted', owner_user_id: null, owner_team: 'upside', co_owner_name: null, no_double_touch: true, employees: 5000, archived_at: null, source_kind: 'partner_referral', source_partner_id: ID.upside, source_set_by: null, updated_at: ago(3), created_at: ago(30) },
    { id: ID.ixl, business_id: B, organization: 'IXL Learning, Inc.', stage: 'target', owner_user_id: JACK, owner_team: 'homelover', employees: null, archived_at: null, source_kind: 'partner_referral', source_partner_id: ID.upside, source_set_by: null, updated_at: ago(3), created_at: ago(30) },
    { id: ID.lost, business_id: B, organization: 'Lost Cause', stage: 'on_hold', owner_user_id: JACK, owner_team: 'homelover', employees: 9000, archived_at: null, source_kind: 'inbound', updated_at: ago(3), created_at: ago(30) },
  ],
  sales_targets: [
    { id: ID.ixlTarget, business_id: B, name: 'IXL Learning', kind: 'employer', status: 'proposed', owner_team: 'homelover', source_kind: 'website', created_at: ago(5), updated_at: ago(5) },
    { id: ID.quarry, business_id: B, name: 'Quarry Labs', kind: 'employer', status: 'researching', owner_user_id: CYRUS, owner_team: 'homelover', employees: 800, source_kind: 'website', created_at: ago(5), updated_at: ago(5) },
  ],
  web_visits: [
    { id: randomUUID(), business_id: B, company_key: 'quarry labs', company_name: 'Quarry Labs', matched_type: 'target', matched_id: ID.quarry, priority: 'P1', visits_7d: 6, unique_visitors_7d: 3, apollo_intent: 'high', intent_score: 60, top_paths: [{ path: '/pricing' }], maybe_user: false, us_500: true, last_visit: day(1), pulled_on: day(0) },
    { id: randomUUID(), business_id: B, company_key: 'quarry labs', company_name: 'Quarry Labs', matched_type: 'target', matched_id: ID.quarry, priority: 'P3', visits_7d: 1, unique_visitors_7d: 1, apollo_intent: 'low', intent_score: 5, top_paths: [{ path: '/' }], maybe_user: false, us_500: true, last_visit: day(9), pulled_on: day(8) },
    { id: randomUUID(), business_id: B, company_key: 'hilton example', company_name: 'Hilton Example', matched_type: null, matched_id: null, priority: 'P2', visits_7d: 2, unique_visitors_7d: 2, apollo_intent: 'low', intent_score: 10, top_paths: [{ path: '/employers' }], maybe_user: false, us_500: true, last_visit: day(2), pulled_on: day(0) },
  ],
  sales_visit_skip: [],
  research_runs: [
    { id: randomUUID(), business_id: B, entity_type: 'target', entity_id: ID.quarry, status: 'done', created_at: ago(2), result: { why_homelover: 'Big relocation program', first_angle: 'Benefits renewal', titles: 'VP People', housing_perk: 'no housing perk found', watch_outs: '' } },
    { id: randomUUID(), business_id: B, entity_type: 'partner', entity_id: ID.harbor, status: 'done', created_at: ago(70), result: { why_homelover: 'old' } },
  ],
  sales_people: [
    { id: randomUUID(), business_id: B, name: 'Mona Q.', title: 'VP People', source_kind: 'web_visit', target_id: ID.quarry, archived_at: null, email: 'mona@quarrylabs.example' },
    { id: randomUUID(), business_id: B, name: 'Ravi S.', title: 'Engineer', source_kind: 'web_visit', target_id: ID.quarry, archived_at: null },
  ],
  sales_prospect_state: [{ business_id: B, contact_id: 'c-pat', company: 'Harbor Lane', goal_id: ID.harbor, opportunity_id: null }],
  sales_email_messages: [{ business_id: B, contact_id: 'c-pat', apollo_message_id: 'm1', delivered_at: ago(10), replied: true, reply_class: 'willing_to_meet', num_opens: 2, num_clicks: 0, last_opened_at: ago(9), last_clicked_at: null }],
  sales_email_activity: [{ id: 1, business_id: B, contact_id: 'c-pat', apollo_message_id: 'm1', event: 'open', occurred_at: ago(9), user_agent: 'Gmail', tracking_service: null }],
  sales_partner_events: [{ id: 1, business_id: B, goal_id: ID.harbor, event: 'touch', at: ago(12), touch_type: 'call', source: null, by_user: CYRUS }],
  sales_opportunity_events: [{ id: 1, business_id: B, opportunity_id: ID.hilton, event_type: 'stage_change', changed_at: ago(20) }],
  sales_week_goals: [{ id: 1, business_id: B, kind: 'todo', status: 'done', link_type: 'opportunity', link_id: ID.ixl, completed_at: ago(1), owner_user_id: JACK, text: 'Call them' }],
  visit_priority_override: [],
  sales_company_scores: [], sales_company_score_days: [],
  ...extra,
});
const req = ({ method = 'GET', params = {}, query = {}, body = {}, role = 'member', user = JACK } = {}) => ({ method, params: { businessId: B, ...params }, query, body, auth: { user: { id: user }, isPlatformOwner: false, roles: new Map([[B, role]]) } });
const res = () => { const r = { code: 200, body: null, headers: {} }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; r.setHeader = (k, v) => { r.headers[k] = v; }; r.send = b => { r.body = b; return r; }; return r; };
const byName = (rows, name) => rows.find(r => r.components?.meta?.name === name || r.name === name);

test('isNamedReferral: a co-owner, no-double-touch, a referring person or a user-set source = NAMED; the Oct 22 backfill (nothing set) = LIST', () => {
  assert.equal(isNamedReferral({}), false);
  assert.equal(isNamedReferral({ source_set_by: null, no_double_touch: false, co_owner_name: null }), false);
  assert.equal(isNamedReferral({ co_owner_name: 'Brad' }), true);
  assert.equal(isNamedReferral({ no_double_touch: true }), true);
  assert.equal(isNamedReferral({ source_person: 'Brad' }), true);
  assert.equal(isNamedReferral({ source_set_by: JACK }), true);
});

test('mergeWeights: NULL or partial settings fall back to the defaults block by block; latestTouch picks the newest', () => {
  assert.deepEqual(mergeWeights(null), DEFAULT_WEIGHTS);
  const w = mergeWeights({ thresholds: { P1: 70 }, source: { inbound: 15 } });
  assert.deepEqual(w.thresholds, { P1: 70, P2: 40, P3: 15 });
  assert.equal(w.source.inbound, 15);
  assert.equal(w.source.website, 6);
  assert.equal(w.caps.visits, 25);
  assert.equal(latestTouch([{ at: ago(5) }, null, { at: ago(1), who: 'Jack' }, { at: ago(3) }]).who, 'Jack');
  assert.equal(latestTouch([]), null);
});

test('gatherInputs: one pass -> inputs per live record with the NAMED rule, the matched visit, buyer people, touches from every source, heat, research state, the employer + target dupe; no address in any input', async () => {
  const db = fakeSupabase(seed());
  const { inputs, weights, names } = await gatherInputs(db, B, { now: NOW });
  assert.equal(inputs.length, 8, 'archived partner left out');
  assert.equal(names.get(CYRUS), 'Cyrus Test');
  assert.deepEqual(weights, DEFAULT_WEIGHTS);
  const harbor = inputs.find(i => i.name === 'Harbor Lane');
  assert.deepEqual([harbor.source.via_upside, harbor.source.named, harbor.source.partner_name], [true, true, 'Upside Benefits']);
  assert.equal(harbor.heat.replied, true, 'heat by goal_id');
  assert.equal(harbor.meta.researched, 'decayed');
  assert.deepEqual([harbor.meta.last_touch_channel, harbor.meta.last_touch_who], ['apollo reply', null], 'the newest touch wins (the Apollo reply at 9 d beats the call at 12 d)');
  const hilton = inputs.find(i => i.name === 'Hilton Example');
  assert.deepEqual([hilton.source.via_upside, hilton.source.named], [true, true], 'no_double_touch makes it NAMED');
  assert.equal(hilton.visit.visits_7d, 2, 'unmatched visit found by name');
  assert.equal(hilton.meta.last_touch_channel, 'stage');
  const ixl = inputs.find(i => i.name === 'IXL Learning, Inc.');
  assert.deepEqual([ixl.source.via_upside, ixl.source.named], [true, false], 'backfilled Upside row = LIST');
  assert.deepEqual([ixl.meta.last_touch_channel, ixl.meta.last_touch_who], ['to-do done', 'Jack Carlson']);
  const ixlT = inputs.find(i => i.name === 'IXL Learning');
  assert.equal(ixlT.duplicate_of, `employer:${ID.ixl}`);
  const quarry = inputs.find(i => i.name === 'Quarry Labs');
  assert.equal(quarry.visit.visits_7d, 6, 'the latest pull row, not the older one');
  assert.deepEqual([...quarry.people].sort((x, y) => x.title.localeCompare(y.title)), [{ title: 'Engineer', is_buyer: false }, { title: 'VP People', is_buyer: true }]);
  assert.equal(quarry.meta.researched, 'fresh');
  assert.ok(!ADDRESS.test(JSON.stringify(inputs)), 'no address in the inputs');
});

test('recomputeScores: writes one row per company + today\'s snapshot, is idempotent, drops rows of archived records, scores the planner\'s rulings (Upside named vs list, closed, live, duplicate)', async () => {
  const db = fakeSupabase(seed({ sales_company_scores: [{ business_id: B, company_type: 'partner', company_id: ID.gone, score: 50, band: 'P2', components: {}, closed: false, flagged_out: false, computed_at: ago(2) }] }));
  const r1 = await recomputeScores(db, { businessId: B, trigger: 'test', now: NOW });
  assert.deepEqual([r1.ran, r1.counts.companies, r1.counts.removed, r1.counts.live, r1.counts.duplicates, r1.counts.closed], [true, 8, 1, 2, 1, 1]);
  assert.equal(db.db.sales_company_scores.length, 8);
  assert.equal(db.db.sales_company_score_days.length, 8);
  assert.ok(db.db.sales_company_score_days.every(d => d.day === day(0)));
  const harbor = byName(db.db.sales_company_scores, 'Harbor Lane');
  assert.equal(harbor.components.source.points, 12, 'NAMED referral +12');
  assert.equal(harbor.components.engagement.points, 10);
  assert.equal(harbor.components.stage.points, 8);
  assert.equal(harbor.components.research.points, -3, 'decayed research');
  const hilton = byName(db.db.sales_company_scores, 'Hilton Example');
  assert.equal(hilton.components.source.points, 12);
  const ixl = byName(db.db.sales_company_scores, 'IXL Learning, Inc.');
  assert.equal(ixl.components.source.points, 6, 'Upside LIST +6');
  assert.equal(ixl.components.fit.points, 4, 'unknown headcount');
  assert.equal(byName(db.db.sales_company_scores, 'IXL Learning').duplicate_of, `employer:${ID.ixl}`);
  assert.ok(byName(db.db.sales_company_scores, 'Lost Cause').closed && byName(db.db.sales_company_scores, 'Lost Cause').score <= 10);
  assert.ok(byName(db.db.sales_company_scores, 'Live Partner').flagged_out && byName(db.db.sales_company_scores, 'Upside Benefits').flagged_out);
  const quarry = byName(db.db.sales_company_scores, 'Quarry Labs');
  assert.ok(quarry.score >= 60 && quarry.band === 'P1', `Quarry ${quarry.score}`);
  assert.equal(quarry.components.people.points, 8);
  const r2 = await recomputeScores(db, { businessId: B, trigger: 'test', now: NOW + 60e3 });
  assert.equal(db.db.sales_company_scores.length, 8, 'idempotent');
  assert.equal(db.db.sales_company_score_days.length, 8, 'one snapshot per day');
  assert.equal(r2.counts.removed, 0);
  assert.ok(!ADDRESS.test(JSON.stringify(db.db.sales_company_scores)), 'no address in a score row');
});

test('recomputeScores only = one company: that row only, 404 for an unknown one; a bad trigger is 400', async () => {
  const db = fakeSupabase(seed());
  const r = await recomputeScores(db, { businessId: B, trigger: 'manual', now: NOW, only: { type: 'target', id: ID.quarry } });
  assert.deepEqual([r.rows.length, db.db.sales_company_scores.length, r.counts.removed], [1, 1, 0]);
  await assert.rejects(() => recomputeScores(db, { businessId: B, trigger: 'manual', now: NOW, only: { type: 'target', id: randomUUID() } }), e => e.status === 404);
  await assert.rejects(() => recomputeScores(db, { businessId: B, trigger: 'cron', now: NOW }), e => e.status === 400);
});

test('snapshot retention: yesterday\'s row stays, a 31-day-old one goes; the trend reads yesterday', async () => {
  const old = { business_id: B, company_type: 'target', company_id: ID.quarry, score: 20, band: 'P3' };
  const db = fakeSupabase(seed({ sales_company_score_days: [{ ...old, day: day(1) }, { ...old, day: day(31) }] }));
  await recomputeScores(db, { businessId: B, trigger: 'test', now: NOW });
  const days = db.db.sales_company_score_days.filter(d => d.company_id === ID.quarry).map(d => d.day).sort();
  assert.deepEqual(days, [day(1), day(0)]);
  const list = await listScores(db, B, {}, { now: NOW });
  const q = list.body.rows.find(r => r.name === 'Quarry Labs');
  assert.deepEqual([q.prev_score, q.prev_band, q.trend, q.band_changed], [20, 'P3', 'up', true]);
  assert.equal(list.body.has_previous, true);
  assert.equal(list.body.counts.band_changed, 1);
});

test('recomputeIfStale: runs when there is no row or the newest is older than 24 h, else reports fresh', async () => {
  const db = fakeSupabase(seed());
  const a = await recomputeIfStale(db, B, { now: NOW });
  assert.equal(a.ran, true);
  const b = await recomputeIfStale(db, B, { now: NOW + 3600e3 });
  assert.deepEqual([b.ran, b.reason], [false, 'fresh']);
  const c = await recomputeIfStale(db, B, { now: NOW + (STALE_HOURS + 1) * 3600e3 });
  assert.equal(c.ran, true);
});

test('scheduleRecompute: never throws, one run in flight per workspace, a call during a run folds into one follow-up', async () => {
  const db = fakeSupabase(seed());
  const logs = [];
  assert.equal(scheduleRecompute(db, B, 'signal'), null, 'the in-memory Supabase never gets a background run unless forced');
  const p1 = scheduleRecompute(db, B, 'signal', { log: (...a) => logs.push(a.join(' ')), force: true });
  const p2 = scheduleRecompute(db, B, 'heat', { log: (...a) => logs.push(a.join(' ')), force: true });
  assert.equal(p1, p2, 'the second call joins the first');
  assert.equal(recomputeInFlight(), 1);
  await p1;
  await new Promise(r => setTimeout(r, 20));
  while (recomputeInFlight()) await new Promise(r => setTimeout(r, 5));
  assert.equal(db.db.sales_company_scores.length, 8);
  assert.deepEqual(logs, []);
  // Every chained call returns another link; awaiting any link rejects with "boom".
  const link = () => new Proxy(() => {}, { get: (_t, k) => (k === 'then' ? (res, rej) => Promise.reject(new Error('boom')).then(res, rej) : link), apply: () => link() });
  await scheduleRecompute({ from: link }, OTHER, 'source', { log: (...a) => logs.push(a.join(' ')) });
  assert.match(logs[0], /\[scores\/recompute source\] boom/);
});

test('GET goals/scores: ranked rows (live + duplicates out, longest-untouched first inside a band), counts, sources, filters (segment / owner / source / band / min / window / needs_touch / q), Upside rows flagged', async () => {
  const db = fakeSupabase(seed());
  await recomputeScores(db, { businessId: B, trigger: 'test', now: NOW });
  const all = await listScores(db, B, {}, { now: NOW });
  assert.equal(all.status, 200);
  const b = all.body;
  assert.deepEqual([b.counts.companies, b.counts.ranked, b.counts.live, b.counts.duplicates, b.rows.length, b.live.length], [8, 5, 2, 1, 5, 2]);
  assert.deepEqual([...b.rows.map(r => r.name)].sort(), ['Harbor Lane', 'Hilton Example', 'IXL Learning, Inc.', 'Lost Cause', 'Quarry Labs']);
  assert.deepEqual(b.rows.slice(0, 2).map(r => r.name), ['Quarry Labs', 'Hilton Example'], 'the P1 visitor first, then the Upside employer');
  assert.ok(b.rows.every((r, i) => !i || b.rows[i - 1].score >= r.score), 'score descending');
  assert.deepEqual(b.rows.map(r => r.rank), [1, 2, 3, 4, 5]);
  const hilton = b.rows.find(r => r.name === 'Hilton Example');
  assert.deepEqual([hilton.upside_owned, hilton.no_double_touch, hilton.touch_locked, hilton.source_label], [true, true, true, 'upside']);
  assert.equal(b.sources.upside, 3);
  assert.deepEqual(b.source_order[0], 'upside');
  assert.equal(b.stale, false);
  assert.ok(b.rows.every(r => !('meta' in r.components)), 'meta folded into the row, not exposed');
  assert.ok(!ADDRESS.test(JSON.stringify(b)));
  const f = async q => (await listScores(db, B, q, { now: NOW })).body.rows.map(r => r.name);
  assert.deepEqual(await f({ segment: 'partners' }), ['Harbor Lane']);
  assert.deepEqual(await f({ segment: 'visitors' }), ['Quarry Labs', 'Hilton Example']);
  assert.deepEqual(await f({ owner: 'unassigned' }), ['Hilton Example']);
  assert.deepEqual(await f({ owner: CYRUS }), ['Quarry Labs', 'Harbor Lane']);
  assert.deepEqual(await f({ source: 'website' }), ['Quarry Labs']);
  assert.deepEqual(await f({ source: 'upside,website' }).then(x => x.length), 4);
  assert.deepEqual(await f({ band: 'P1' }), ['Quarry Labs']);
  assert.deepEqual(await f({ min: 60 }), ['Quarry Labs']);
  assert.deepEqual(await f({ window: 7 }), ['Quarry Labs', 'Hilton Example']);
  assert.deepEqual(await f({ q: 'ixl' }), ['IXL Learning, Inc.']);
  assert.deepEqual(await f({ needs_touch: '1' }), ['Quarry Labs', 'Hilton Example'], 'score >= 40 and no touch in 14 d: Harbor was touched 9 d ago (the Apollo reply), Hilton 20 d (stage), Quarry never');
});

test('needs a touch = score >= 40, not closed, no touch in 14 d; parseFilters drops unknown values', () => {
  assert.equal(needsTouch({ score: 50, closed: false, last_touch_at: null }, NOW), true);
  assert.equal(needsTouch({ score: 50, closed: false, last_touch_at: ago(15) }, NOW), true);
  assert.equal(needsTouch({ score: 50, closed: false, last_touch_at: ago(13) }, NOW), false);
  assert.equal(needsTouch({ score: 39, closed: false, last_touch_at: null }, NOW), false);
  assert.equal(needsTouch({ score: 90, closed: true, last_touch_at: null }, NOW), false);
  assert.deepEqual(parseFilters({ segment: 'nope', owner: 'u1', source: 'upside,bogus', band: 'P9', min: '250', window: '14', needs_touch: 'true', q: ' Hi ' }), { segment: 'all', owner: 'u1', source: ['upside'], band: '', needs_touch: true, min: 100, window: null, q: 'hi' });
  assert.deepEqual(filterScoreRows([{ score: 10, name: 'a', type: 'partner' }], parseFilters({ min: 5 })).length, 1);
});

test('POST goals/scores/recompute: a Member is refused for the whole workspace (403) but may recompute one company; owner / admin run it all; bad body 400', async () => {
  const db = fakeSupabase(seed());
  const deny = res();
  await recomputeRoute(req({ method: 'POST', role: 'member' }), deny);
  assert.equal(deny.code, 403);
  assert.equal(db.db.sales_company_scores.length, 0);
});

test('GET goals/scores/export.csv: the table columns, Live rows marked, every value quoted when needed, no "@" anywhere', async () => {
  const db = fakeSupabase(seed());
  await recomputeScores(db, { businessId: B, trigger: 'test', now: NOW });
  const list = await listScores(db, B, {}, { now: NOW });
  const csv = scoresCsv(list.body.rows, list.body.live);
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'Company,Type,Score,Band,Status,Source,Owner,Visits 7d,People,Last touch,Employees,Stage,Researched,Change');
  assert.equal(lines.length, 1 + 5 + 2);
  assert.ok(lines[1].startsWith('Quarry Labs,target,'));
  assert.ok(lines.some(l => l.includes('"IXL Learning, Inc.",employer')), 'comma-bearing name quoted');
  assert.ok(lines.some(l => l.includes(',Live,')), 'closed-won / pilot under Live');
  assert.ok(lines.some(l => l.includes('Lost Cause,employer') && l.includes(',Closed,')));
  assert.ok(!csv.includes('@'));
});

test('Brief: one block with refs B1.., score breakdown, source + referrer, visits, people (names + titles only), research, open to-dos, last touch, next step; the Upside line; no address', async () => {
  const db = fakeSupabase(seed({ sales_week_goals: [{ id: 1, business_id: B, kind: 'todo', status: 'open', link_type: 'target', link_id: ID.quarry, text: 'Send the deck', due_date: day(-2), owner_user_id: CYRUS, week_start: day(1) }] }));
  const r = await companyBrief(db, { businessId: B, type: 'target', id: ID.quarry, now: NOW });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const b = r.body;
  assert.deepEqual([b.company.name, b.score.band, b.upside_owned], ['Quarry Labs', 'P1', false]);
  assert.ok(b.lines.every((l, i) => l.ref === `B${i + 1}` && l.kind && l.text));
  const text = b.lines.map(l => l.text).join('\n');
  assert.match(text, /Intent \d+ · P1/);
  assert.match(text, /Visited 6 times in 7 d · 3 unique visitors · pages \/pricing/);
  assert.match(text, /Mona Q\. — VP People/);
  assert.match(text, /Why HomeLover: Big relocation program/);
  assert.match(text, /Open to-do: Send the deck/);
  assert.match(text, /Source: Website/);
  assert.match(text, /Never touched|Last touch:/);
  assert.ok(b.markdown.startsWith('# Brief: Quarry Labs') && b.markdown.includes('[B1]'));
  assert.ok(!ADDRESS.test(JSON.stringify(b)), 'no address in the Brief');
  assert.equal(db.db.sales_company_scores.length, 1, 'a missing score row is computed for that company');
  const h = await companyBrief(db, { businessId: B, type: 'employer', id: ID.hilton, now: NOW });
  assert.match(h.body.lines.map(l => l.text).join('\n'), /Upside-owned · no double touch/);
  assert.match(h.body.lines.map(l => l.text).join('\n'), /Source: Brad \/ Upside · Upside Benefits/);
  assert.equal(h.body.no_double_touch, true);
  assert.equal((await companyBrief(db, { businessId: B, type: 'visitor', id: 'x', now: NOW })).status, 400);
});

test('briefLines is pure and scrubs: an address inside a research field never reaches a line', () => {
  const lines = briefLines({ type: 'employer', name: 'Acme', score: null, meta: { stage: 'target', owner: null }, sourceRow: { source_kind: 'inbound', source_note: 'mail hr@acme.example' }, detail: { research: { runs: [{ status: 'done', created_at: ago(1), result: { why_homelover: 'ping me at ceo@acme.example' } }] } }, now: NOW });
  assert.ok(!lines.some(l => ADDRESS.test(l.text)), JSON.stringify(lines));
  assert.equal(lines[0].text, 'Acme · employer · stage target · unassigned');
});
