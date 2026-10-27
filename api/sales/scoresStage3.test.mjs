// node --test api/sales/scoresStage3.test.mjs  (react-scripts' Jest only runs src/)
// intent-score-v1 Stage 3 server pieces: one company's score (S4), saved views (S5), Not a fit by record (S3),
// the Write email route with a fixture call (S7: the cap, the lint on the returned draft, the usage row, no
// address) and its lint route. In-memory Supabase, invented companies. 0 network, 0 Claude, 0 Apollo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { recomputeScores } from './intentScoreRun.js';
import { scoreOf, listViews, saveView, deleteView, SAVED_VIEWS_MAX } from './scoresRoutes.js';
import { setVisitPriority } from './visitPriority.js';
import { composeEmail, lintPasted, composeStatus, COMPOSE_DAILY_CAP } from './composeRoutes.js';

const NOW = Date.parse('2026-10-27T18:00:00Z');
const DAY = 864e5;
const ago = d => new Date(NOW - d * DAY).toISOString();
const B = randomUUID(), JACK = randomUUID();
const ID = { quarry: randomUUID(), harbor: randomUUID() };
const ADDRESS = /[^\s@<>()"]+@[^\s@<>()"]+\.[a-z]{2,}/i;
const seed = (extra = {}) => ({
  business_members: [{ business_id: B, user_id: JACK, name: 'Jack Carlson', role: 'owner' }],
  sales_settings: [{ business_id: B, buyer_titles: ['VP People'], score_weights: null, saved_views: [] }],
  sales_goals: [{ id: ID.harbor, business_id: B, goal_type: 'partnership', name: 'Harbor Lane', pipeline_status: 'replied', owner_user_id: JACK, owner_team: 'homelover', category: '4. Brokers', archived_at: null, last_touch_at: ago(3), source_kind: 'inbound' }],
  sales_opportunities: [],
  sales_targets: [{ id: ID.quarry, business_id: B, name: 'Quarry Labs', kind: 'employer', status: 'researching', owner_user_id: JACK, owner_team: 'homelover', employees: 800, source_kind: 'website', created_at: ago(5), updated_at: ago(5) }],
  web_visits: [{ id: randomUUID(), business_id: B, company_key: 'quarry labs', company_name: 'Quarry Labs', matched_type: 'target', matched_id: ID.quarry, priority: 'P1', visits_7d: 6, unique_visitors_7d: 3, apollo_intent: 'high', intent_score: 60, top_paths: [{ path: '/pricing' }], maybe_user: false, us_500: true, last_visit: ago(1).slice(0, 10), pulled_on: ago(0).slice(0, 10) }],
  sales_visit_skip: [], research_runs: [{ id: randomUUID(), business_id: B, entity_type: 'target', entity_id: ID.quarry, status: 'done', created_at: ago(2), result: { why_homelover: 'Big relocation program', first_angle: 'Benefits renewal', housing_perk: 'no housing perk found' } }],
  sales_people: [{ id: randomUUID(), business_id: B, name: 'Mona Q.', title: 'VP People', source_kind: 'web_visit', target_id: ID.quarry, archived_at: null, email: 'mona@quarrylabs.example' }],
  sales_prospect_state: [], sales_email_messages: [], sales_email_activity: [], sales_partner_events: [], sales_opportunity_events: [], sales_week_goals: [],
  visit_priority_override: [], sales_company_scores: [], sales_company_score_days: [], business_anthropic_usage: [],
  ...extra,
});
const unique = { sales_visit_skip: r => `${r.business_id}|${r.company_key}` };

test('scoreOf: 404 before a recompute, then the row + breakdown lines (no meta leaked); a bad type is 400', async () => {
  const db = fakeSupabase(seed());
  assert.equal((await scoreOf(db, B, { type: 'target', id: ID.quarry, now: NOW })).status, 404);
  await recomputeScores(db, { businessId: B, trigger: 'test', now: NOW });
  const r = await scoreOf(db, B, { type: 'target', id: ID.quarry, now: NOW });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.row.name, r.body.row.band, 'meta' in r.body.row.components], ['Quarry Labs', 'P1', false]);
  assert.ok(r.body.lines.some(l => /^\+\d+ visits/.test(l)) && r.body.lines.some(l => /people \(VP People\)/.test(l)));
  assert.equal((await scoreOf(db, B, { type: 'visitor', id: 'x' })).status, 400);
});

test('saved views: save (name, filters, y, view), list, replace by name, delete, the cap', async () => {
  const db = fakeSupabase(seed());
  const s = await saveView(db, { businessId: B, userId: JACK, body: { name: "Brad's companies", filters: { source: ['upside'], band: 'P1', needs_touch: true, min: 40, junk: 'x' }, y: 'size', view: 'bars' }, now: NOW });
  assert.equal(s.status, 201);
  assert.deepEqual([s.body.view.name, s.body.view.filters, s.body.view.y, s.body.view.view], ["Brad's companies", { source: ['upside'], band: 'P1', needs_touch: true, min: '40' }, 'size', 'bars']);
  assert.equal((await listViews(db, B)).body.views.length, 1);
  const again = await saveView(db, { businessId: B, userId: JACK, body: { name: "Brad's companies", filters: {}, y: 'nope', view: 'nope' }, now: NOW });
  assert.deepEqual([again.body.views.length, again.body.view.id, again.body.view.y, again.body.view.view], [1, s.body.view.id, 'intent', 'dots']);
  assert.equal((await saveView(db, { businessId: B, userId: JACK, body: { name: '  ' } })).status, 400);
  for (let i = 0; i < SAVED_VIEWS_MAX - 1; i++) await saveView(db, { businessId: B, userId: JACK, body: { name: `v${i}` } });
  assert.equal((await saveView(db, { businessId: B, userId: JACK, body: { name: 'one too many' } })).status, 409);
  const d = await deleteView(db, { businessId: B, id: s.body.view.id });
  assert.equal(d.body.views.length, SAVED_VIEWS_MAX - 1);
  assert.equal((await deleteView(db, { businessId: B, id: 'nope' })).status, 404);
  assert.ok(!ADDRESS.test(JSON.stringify(db.db.sales_settings)));
});

test('Not a fit by record: works without a visit row, keys the override by the record name, closes the score; priority null undoes it', async () => {
  const db = fakeSupabase(seed(), { unique });
  const r = await setVisitPriority(db, { businessId: B, userId: JACK, body: { record: { type: 'partner', id: ID.harbor }, not_a_fit: true } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.company_key, r.body.override.not_a_fit], ['harbor lane', true]);
  assert.equal(db.db.sales_visit_skip.length, 1);
  await recomputeScores(db, { businessId: B, trigger: 'test', now: NOW });
  const harbor = db.db.sales_company_scores.find(s => s.company_id === ID.harbor);
  assert.ok(harbor.closed && harbor.score <= 10);
  const back = await setVisitPriority(db, { businessId: B, userId: JACK, body: { record: { type: 'partner', id: ID.harbor }, priority: null } });
  assert.deepEqual(back.body, { company_key: 'harbor lane', override: null });
  assert.equal((await setVisitPriority(db, { businessId: B, userId: JACK, body: { record: { type: 'partner', id: randomUUID() }, not_a_fit: true } })).status, 404);
  assert.equal((await setVisitPriority(db, { businessId: B, userId: JACK, body: { record: { type: 'visitor', id: 'x' }, not_a_fit: true } })).status, 400);
  assert.equal((await setVisitPriority(db, { businessId: B, userId: JACK, body: { company_key: 'nobody here', not_a_fit: true } })).status, 404, 'the company_key form still needs a visit row');
});

test('composeEmail: one STANDARD call with the Brief as the user turn, the draft linted, the usage row counted toward the cap; an address in the draft is a lint failure, never a stored value', async () => {
  const db = fakeSupabase(seed());
  const calls = [];
  const call = async args => {
    calls.push(args);
    db.db.business_anthropic_usage.push({ id: randomUUID(), business_id: B, call_type: args.callType, created_at: new Date(NOW).toISOString() });
    return { stop_reason: 'end_turn', usage: { input_tokens: 900, output_tokens: 200 }, content: [{ type: 'text', text: JSON.stringify({ subject: 'Quick idea for Quarry Labs', body: 'Hi,\n\nSaw 6 visits from Quarry Labs this week and the relocation program stood out.\n\nWorth 15 minutes? [Tue 10am] [Thu 2pm]\n\nJack', why_this_company: 'visits + relocation', claims: [{ claim: '6 visits', brief_ref: 'B4' }, { claim: 'relocation program', brief_ref: 'B99' }] }) }] };
  };
  const r = await composeEmail(db, { businessId: B, userId: JACK, userName: 'Jack Carlson', type: 'target', id: ID.quarry, now: NOW, call });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].callType, calls[0].thinking, calls[0].max_tokens], ['intent_compose', false, 1200]);
  assert.ok(calls[0].messages[0].content.includes('# Brief: Quarry Labs') && calls[0].messages[0].content.includes('[B1]'));
  assert.ok(calls[0].system.includes('"Jack"'));
  assert.equal(r.body.draft.subject, 'Quick idea for Quarry Labs');
  assert.deepEqual([r.body.lint.ok, r.body.lint.issues.map(i => i.rule)], [false, ['claim_unmatched']], 'B99 is not a Brief line');
  assert.deepEqual(r.body.cap, { used: 1, max: COMPOSE_DAILY_CAP });
  assert.equal(r.body.sign_off, 'Jack');
  assert.ok(!ADDRESS.test(JSON.stringify(r.body)));
  const st = await composeStatus(db, B, { now: NOW });
  assert.deepEqual([st.body.used, st.body.max], [1, COMPOSE_DAILY_CAP]);
  assert.equal((await composeEmail(db, { businessId: B, userId: JACK, userName: 'Jack', type: 'visitor', id: 'x', now: NOW, call })).status, 400);
  for (let i = 1; i < COMPOSE_DAILY_CAP; i++) db.db.business_anthropic_usage.push({ id: randomUUID(), business_id: B, call_type: 'intent_compose', created_at: new Date(NOW).toISOString() });
  const capped = await composeEmail(db, { businessId: B, userId: JACK, userName: 'Jack', type: 'target', id: ID.quarry, now: NOW, call });
  assert.deepEqual([capped.status, calls.length], [429, 1], 'the cap stops the call');
  const cut = await composeEmail(db, { businessId: B, userId: JACK, userName: 'Jack', type: 'target', id: ID.quarry, now: NOW + DAY, call: async () => ({ stop_reason: 'max_tokens', content: [] }) });
  assert.equal(cut.status, 502);
});

test('lintPasted: the same rules on a pasted draft against the company Brief (a dash, a price, an unknown number), or without a company', async () => {
  const db = fakeSupabase(seed());
  const r = await lintPasted(db, { businessId: B, userName: 'Jack Carlson', type: 'target', id: ID.quarry, body: { subject: 'Hi', body: 'We saw 6 visits — pricing is $9 per seat and 300 people signed up.\n\nJack' }, now: NOW });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.refs > 3);
  assert.deepEqual(r.body.lint.issues.map(i => i.rule).sort(), ['dash', 'number_unverified', 'number_unverified', 'pricing']);
  const ok = await lintPasted(db, { businessId: B, userName: 'Jack Carlson', body: { subject: 'Hi', body: 'Short and plain.\n\nJack' }, now: NOW });
  assert.deepEqual([ok.body.lint.ok, ok.body.refs], [true, 0]);
  assert.equal((await lintPasted(db, { businessId: B, userName: 'Jack', body: { body: 5 } })).status, 400);
});
