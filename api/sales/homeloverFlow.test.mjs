// node --test api/sales/homeloverFlow.test.mjs  (react-scripts' Jest only runs src/)
// homelover-flow-v1 Stage 1 - Fit level + Due (F2), the six radar axes + fit score + clients overlay (F3),
// Deprioritize with a reason / Bring back / Undo (F4), Reached n of m (F6), reply -> stage rules + They replied… (F7),
// newest-first + NEW (F11), us_footprint in research, visit re-match on create / promote + backfill (ruling F-d),
// Map Assign Activity + Undo, member colors (ruling F-b). In-memory Supabase, invented companies on .example; 0 network,
// 0 Claude, 0 Apollo. A fixture person carries an email ON PURPOSE to prove the routes refuse it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { axesFrom, fitScoreOf, clientsOverlay, fitOf } from './fitRadar.js';
import { levelFor, effectiveFit, fitSettings, dueFor, dueMap, inFitFilter } from './fitLevel.js';
import { recomputeScores } from './intentScoreRun.js';
import { listScores } from './scoresRoutes.js';
import { deprioritize, bringBack, setFit } from './fitActions.js';
import { undoFlow, listFlow } from './flowEvents.js';
import { countReach, reachFor } from './reachCount.js';
import { employerMoves, runEmployerReplyRules, replySuggestion, replySuggestionFor, theyReplied } from './replyRules.js';
import { advanceStage, insertCompanyRecord } from './companyPanel.js';
import { promoteTarget } from './targetsRoutes.js';
import { rematchVisits, planVisitMatches, backfillVisitMatches } from './visitMatch.js';
import { assignColors, memberColors } from './memberColors.js';
import { researchSystem, parseResearch } from './partnerResearch.js';
import { applyResearchFootprint, editCompanyFields } from './companyFields.js';
import { effectiveVisit, loadOverrides } from './visitPriority.js';
import { PRIORITY_TO_FIT, DEFAULT_FIT_THRESHOLDS } from '../../src/constants/fitLevels.js';
import { MEMBER_COLORS } from '../../src/constants/memberColors.js';
import { DEFAULT_WEIGHTS } from './intentScore.js';

const NOW = Date.parse('2026-11-04T20:00:00Z'); // Wed Nov 4, noon LA
const TODAY = '2026-11-04';
const DAY = 864e5;
const ago = d => new Date(NOW - d * DAY).toISOString();
const day = d => ago(d).slice(0, 10);
const B = randomUUID(), JACK = randomUUID(), CYRUS = randomUUID();
const ID = { hub: randomUUID(), acme: randomUUID(), beta: randomUUID(), mace: randomUUID(), gamma: randomUUID(), momentum: randomUUID(), river: randomUUID(), meeting: randomUUID() };
const V = { river: randomUUID(), mace1: randomUUID(), mace2: randomUUID(), acme: randomUUID(), newco: randomUUID() };
const opp = (id, organization, stage, extra = {}) => ({ id, business_id: B, organization, org_type: 'employer', stage, owner_user_id: null, owner: null, owner_team: 'homelover', co_owner_name: null, no_double_touch: false, employees: null, archived_at: null, source_kind: 'unknown', notes: '', created_at: ago(20), updated_at: ago(3), fit_level: null, deprioritized_reason: null, deprioritized_note: null, us_footprint: null, us_footprint_source: null, ...extra });
const visit = (id, company_key, company_name, extra) => ({ id, business_id: B, company_key, company_name, pulled_on: day(1), first_visit: day(1), last_visit: day(1), visits_7d: 1, unique_visitors_7d: 1, top_paths: [{ path: '/' }], priority: 'P3', matched_type: null, matched_id: null, domain: null, ...extra });

const seed = () => fakeSupabase({
  business_members: [
    { business_id: B, user_id: JACK, name: 'Jack Zz', role: 'owner', created_at: ago(100), member_color: null },
    { business_id: B, user_id: CYRUS, name: 'Cyrus Test', role: 'member', created_at: ago(90), member_color: '#D9A441' },
  ],
  sales_settings: [{ business_id: B, buyer_titles: ['VP People', 'CHRO'], score_weights: null, fit_settings: null }],
  sales_goals: [{ id: ID.hub, business_id: B, goal_type: 'partnership', name: 'Hub Partner', pipeline_status: 'live', owner_user_id: JACK, owner_team: 'homelover', category: '4. Brokers', company_domain: 'hubpartner.example', archived_at: null, last_touch_at: ago(2), source_kind: 'inbound', fit_level: null, deprioritized_reason: null, us_footprint: null, created_at: ago(50), updated_at: ago(2) }],
  sales_opportunities: [
    opp(ID.acme, 'Acme Health', 'contacted', { domain: 'acmehealth.example', employees: 1250, owner_user_id: CYRUS, owner: 'Cyrus', next_action_date: '2026-11-20', source_kind: 'partner_referral' }),
    opp(ID.beta, 'Beta Corp', 'responded', { domain: 'betacorp.example' }),
    opp(ID.mace, 'Mace Group', 'contacted', { domain: 'macegroup.example', owner_user_id: CYRUS, owner: 'Cyrus' }),
    opp(ID.gamma, 'Gamma Co', 'target'),
    opp(ID.momentum, 'Momentum Services', 'verbal', { domain: 'momentum.example', employees: 390, client_status: 'verbal_yes', source_kind: 'partner_referral', source_partner_id: ID.hub }),
    opp(ID.meeting, 'Already Meeting', 'meeting', { domain: 'alreadymeeting.example' }),
  ],
  sales_targets: [{ id: ID.river, business_id: B, name: 'Riverbend Logistics', kind: 'employer', status: 'researching', owner_team: 'homelover', owner_user_id: null, domain: 'riverbend.example', source_kind: 'website', evidence: 'visited', research_notes: null, channel: 'website_visit', created_at: ago(1), updated_at: ago(1), decided_at: null, promoted_goal_id: null, source_note_id: null, fit_level: null, deprioritized_reason: null, us_footprint: null }],
  web_visits: [
    visit(V.river, 'riverbend logistics', 'Riverbend Logistics', { domain: 'riverbend.example', first_visit: TODAY, pulled_on: TODAY, last_visit: TODAY, visits_7d: 9, unique_visitors_7d: 4, priority: 'P1' }),
    visit(V.mace1, 'mace', 'Mace', { domain: 'macegroup.example', first_visit: '2026-10-22', pulled_on: '2026-10-22', last_visit: '2026-10-22' }),
    visit(V.mace2, 'mace', 'Mace', { domain: 'macegroup.example', first_visit: '2026-10-29', pulled_on: '2026-10-29', last_visit: '2026-10-29', visits_7d: 2 }),
    visit(V.acme, 'acme health', 'Acme Health', { domain: 'acmehealth.example', first_visit: '2026-10-28', visits_7d: 6, unique_visitors_7d: 3, top_paths: [{ path: '/pricing' }], apollo_intent: 'high', matched_type: 'opportunity', matched_id: ID.acme, priority: 'P1' }),
    visit(V.newco, 'newco', 'NewCo', { domain: 'newco.example' }),
  ],
  research_runs: [{ id: randomUUID(), business_id: B, entity_type: 'employer', entity_id: ID.acme, status: 'done', trigger: 'manual', created_at: ago(2), result: { why_homelover: 'Their staff relocate often', first_angle: 'relocation', titles: 'VP People', housing_perk: 'no housing perk found', watch_outs: '', us_footprint: 'mostly_us' } }],
  sales_prospect_state: [
    { business_id: B, contact_id: 'c1', name: 'Ana Buyer', title: 'VP People', company: 'Acme Health', status: 'contacted', opportunity_id: ID.acme, goal_id: null, email: 'ana@acmehealth.example' },
    { business_id: B, contact_id: 'c2', name: 'Bo Other', title: 'Analyst', company: 'Acme Health', status: 'new', opportunity_id: ID.acme, goal_id: null },
    { business_id: B, contact_id: 'c3', name: 'Cy Beta', title: 'CHRO', company: 'Beta Corp', status: 'new', opportunity_id: ID.beta, goal_id: null },
    { business_id: B, contact_id: 'c4', name: 'Pat Partner', title: 'VP Benefits', company: 'Hub Partner', status: 'new', opportunity_id: null, goal_id: ID.hub },
    { business_id: B, contact_id: 'c5', name: 'Mo Meeting', title: 'CHRO', company: 'Already Meeting', status: 'new', opportunity_id: ID.meeting, goal_id: null },
  ],
  sales_people: [
    { id: randomUUID(), business_id: B, company_type: 'employer', opportunity_id: ID.acme, target_id: null, name: 'Ana Buyer', title: 'VP People', source_kind: 'web_visit', archived_at: null },
    { id: randomUUID(), business_id: B, company_type: 'employer', opportunity_id: ID.acme, target_id: null, name: 'Dee New', title: 'CHRO', source_kind: 'web_visit', archived_at: null },
  ],
  partner_contacts: [{ id: randomUUID(), business_id: B, goal_id: ID.hub, name: 'Pat Partner', title: 'VP Benefits', apollo_contact_id: null, source: 'manual' }],
  sales_partner_events: [{ id: randomUUID(), business_id: B, goal_id: ID.hub, event: 'touch', touch_type: 'email', contact_names: ['Pat Partner'], at: ago(3), recorded_at: ago(3), source: 'manual', meta: { direction: 'sent' } }],
  sales_email_messages: [
    { business_id: B, apollo_message_id: 'm1', contact_id: 'c1', delivered_at: ago(5), replied: true, replied_at: ago(1), reply_class: 'willing_to_meet', num_opens: 2, num_clicks: 0 },
    { business_id: B, apollo_message_id: 'm3', contact_id: 'c3', delivered_at: ago(5), replied: true, replied_at: ago(2), reply_class: null, num_opens: 0, num_clicks: 0 },
    { business_id: B, apollo_message_id: 'm4', contact_id: 'c4', delivered_at: ago(5), replied: false, replied_at: null, reply_class: null, num_opens: 0, num_clicks: 0 },
    { business_id: B, apollo_message_id: 'm5', contact_id: 'c5', delivered_at: ago(5), replied: true, replied_at: ago(1), reply_class: 'follow_up_question', num_opens: 0, num_clicks: 0 },
  ],
  microsoft_messages: [
    { id: randomUUID(), business_id: B, graph_id: 'g-auto', internet_message_id: '<auto@mace>', direction: 'received', external_domains: ['macegroup.example'], external_emails: ['x@macegroup.example'], subject: 'Automatic reply: out of office', occurred_at: ago(1) },
    { id: randomUUID(), business_id: B, graph_id: 'g-beta', internet_message_id: '<re@beta>', direction: 'received', external_domains: ['betacorp.example'], external_emails: ['y@betacorp.example'], subject: 'Re: intro', occurred_at: ago(1) },
  ],
  microsoft_events: [
    { id: randomUUID(), business_id: B, graph_id: 'ev-beta', ical_uid: 'ical-beta', external_domains: ['betacorp.example'], external_emails: ['y@betacorp.example'], is_cancelled: false, start_at: ago(-2), end_at: ago(-2) },
    { id: randomUUID(), business_id: B, graph_id: 'ev-hub', ical_uid: 'ical-hub', external_domains: ['hubpartner.example'], external_emails: [], is_cancelled: false, start_at: ago(-3), end_at: ago(-3) },
    { id: randomUUID(), business_id: B, graph_id: 'ev-acme-x', ical_uid: 'ical-acme-x', external_domains: ['acmehealth.example'], external_emails: [], is_cancelled: true, start_at: ago(-1), end_at: ago(-1) },
  ],
  sales_week_goals: [
    { id: randomUUID(), business_id: B, kind: 'todo', status: 'open', text: 'Research Riverbend', week_start: '2026-11-02', link_type: 'target', link_id: ID.river, owner_user_id: JACK, due_date: TODAY },
    { id: randomUUID(), business_id: B, kind: 'todo', status: 'open', text: 'Send Beta the deck', week_start: '2026-11-02', link_type: 'opportunity', link_id: ID.beta, owner_user_id: JACK, due_date: '2026-11-07' },
    { id: randomUUID(), business_id: B, kind: 'todo', status: 'open', text: 'Call Mace', week_start: '2026-11-02', link_type: 'opportunity', link_id: ID.mace, owner_user_id: CYRUS, due_date: TODAY },
    { id: randomUUID(), business_id: B, kind: 'todo', status: 'done', text: 'Old one', week_start: '2026-10-26', link_type: 'opportunity', link_id: ID.gamma, owner_user_id: JACK, due_date: '2026-10-27', completed_at: ago(8) },
  ],
  sales_email_activity: [], sales_opportunity_events: [], sales_visit_skip: [], visit_priority_override: [], sales_stage_marks: [], sales_signals: [],
  sales_company_scores: [], sales_company_score_days: [], sales_flow_events: [], sales_outreach_contacts: [], partner_domains: [], sales_sequenced_accounts: [], sales_call_notes: [],
  sales_source_events: [], sales_week_report: [],
}, { now: () => NOW, unique: { sales_flow_events: r => (r.meta?.key ? `${r.business_id}|${r.meta.key}` : null) } });

const recompute = s => recomputeScores(s, { businessId: B, trigger: 'test', now: NOW });
const scoreOf = (s, type, id) => s.db.sales_company_scores.find(r => r.company_type === type && r.company_id === id);

test('F3 axes: each from the stored components; no data = null ("—"), never a fake 0; the score uses only axes with data', () => {
  const caps = DEFAULT_WEIGHTS.caps;
  const full = axesFrom({ caps, usFootprint: 'mostly_us', components: {
    visits: { points: 17, inputs: { visits_7d: 6, unique_visitors_7d: 3, decayed: false } }, pages: { points: 10, inputs: { paths: ['/pricing'] } }, apollo_intent: { points: 5, inputs: { intent: 'high' } },
    people: { points: 6, inputs: { people: 2, buyers: 1 } }, fit: { points: 15, inputs: { employees: 1250, why: 'US 500+' } },
    research: { points: 10, inputs: { researched: true, decayed: false, competing_perk: false, watch_out: false } }, source: { points: 12, inputs: { label: 'partner_referral' } },
  } });
  assert.deepEqual(Object.fromEntries(Object.entries(full).map(([k, v]) => [k, v.value])), { intent: 80, industry: 100, size: 100, us_footprint: 100, buyers: 40, warm_path: 100 });
  assert.match(full.intent.why, /6 visits · 3 people/); assert.match(full.size.why, /1,250 employees/); assert.equal(full.us_footprint.why, 'Mostly US');
  assert.deepEqual(fitScoreOf(full), { score: 87, used: 6, of: 6 });
  const bare = axesFrom({ caps, usFootprint: null, components: { research: { points: -3, inputs: { researched: false } }, fit: { points: 4, inputs: { employees: null, why: 'headcount unknown' } } } });
  assert.deepEqual(Object.fromEntries(Object.entries(bare).map(([k, v]) => [k, v.value])), { intent: 0, industry: null, size: null, us_footprint: null, buyers: 0, warm_path: 0 });
  assert.deepEqual([bare.industry.why, bare.size.why, bare.us_footprint.why], ['not researched yet', 'headcount unknown', 'US footprint not in research yet']);
  assert.deepEqual(fitScoreOf(bare), { score: 0, used: 3, of: 6 });
  const decayed = axesFrom({ caps, components: { research: { points: -3, inputs: { researched: true, decayed: true } } } });
  assert.deepEqual([decayed.industry.value, decayed.industry.why], [null, 'research older than 60 d - refresh']);
  assert.equal(fitScoreOf({ intent: { value: null } }).score, null, 'no axis with data = no score');
  // Weights: a 0 weight drops an axis; a doubled one counts twice.
  assert.equal(fitScoreOf(full, { intent: 0, industry: 1, size: 1, us_footprint: 1, buyers: 1, warm_path: 1 }).score, 88);
  assert.deepEqual(clientsOverlay([full, bare, null]), { n: 2, axes: { intent: 40, industry: 100, size: 100, us_footprint: 100, buyers: 20, warm_path: 50 } });
});

test('F2 levels: thresholds (REVISABLE), a hand-set Fit wins, Deprioritized beats everything, priority 1-4 maps to Fit', () => {
  assert.deepEqual([levelFor(70), levelFor(69), levelFor(45), levelFor(44), levelFor(null)], ['strong', 'good', 'good', 'low', null]);
  assert.equal(levelFor(60, { strong: 60, good: 30 }), 'strong');
  assert.deepEqual(fitSettings({ thresholds: { strong: 80 }, weights: { intent: 2, junk: 5 } }).thresholds, { strong: 80, good: 45 });
  assert.equal(fitSettings({ weights: { intent: 2 } }).weights.intent, 2);
  assert.deepEqual(effectiveFit({ fit_level: null }, 80, DEFAULT_FIT_THRESHOLDS), { level: 'strong', source: 'computed', reason: null, note: null });
  assert.deepEqual(effectiveFit({ fit_level: 'low' }, 80), { level: 'low', source: 'hand', reason: null, note: null });
  assert.deepEqual(effectiveFit({ fit_level: 'deprioritized', deprioritized_reason: 'too_small', deprioritized_note: 'n' }, 90), { level: 'deprioritized', source: 'deprioritized', reason: 'too_small', note: 'n' });
  assert.deepEqual(effectiveFit({}, null), { level: null, source: null, reason: null, note: null });
  assert.deepEqual(PRIORITY_TO_FIT, { 1: 'strong', 2: 'good', 3: 'low', 4: 'low' });
  const sql = fs.readFileSync(new URL('../../supabase/migrations/20261104_homelover_flow_v1.sql', import.meta.url), 'utf8');
  assert.match(sql, /WHEN 1 THEN 'strong' WHEN 2 THEN 'good' ELSE 'low'/);
  assert.match(sql, /fit_level IS DISTINCT FROM ''deprioritized'' OR deprioritized_reason IS NOT NULL/, 'the DB refuses Deprioritized without a reason');
  assert.ok(!/@[a-z0-9-]+\.[a-z]{2,}/i.test(sql.replace(/-- /g, '')), 'no address in the migration');
  assert.deepEqual([inFitFilter('low'), inFitFilter('deprioritized'), inFitFilter('low', ['strong', 'good']), inFitFilter('good', ['strong', 'good'])], [true, false, false, true]);
});

test('F2 Due: earliest open to-do / next_action_date -> Today · This week · Later; never a priority word', async () => {
  assert.deepEqual(dueFor(['2026-11-10', TODAY], TODAY), { due: 'today', date: TODAY });
  assert.deepEqual(dueFor(['2026-11-08'], TODAY), { due: 'week', date: '2026-11-08' });
  assert.deepEqual(dueFor(['2026-11-09'], TODAY), { due: 'later', date: '2026-11-09' });
  assert.deepEqual(dueFor(['2026-11-01'], TODAY).due, 'today', 'overdue is Today');
  assert.equal(dueFor([null, undefined, 'x'], TODAY), null);
  const m = await dueMap(seed(), B, { today: TODAY });
  assert.deepEqual([m.get(`target:${ID.river}`)?.due, m.get(`employer:${ID.beta}`)?.due, m.get(`employer:${ID.acme}`)?.due, m.get(`employer:${ID.gamma}`)], ['today', 'week', 'later', undefined]);
});

test('recompute stores the axes + fit per company; the Map list carries fit, due, first seen, NEW; Deprioritized is hidden by default', async () => {
  const s = seed();
  await recompute(s);
  const acme = scoreOf(s, 'employer', ID.acme);
  assert.deepEqual([acme.components.meta.fit.level, acme.components.meta.fit.used, acme.components.meta.fit.us_footprint], ['strong', 6, 'mostly_us'], 'research gave the US footprint');
  assert.equal(acme.components.axes.industry.value, 100);
  const gamma = scoreOf(s, 'employer', ID.gamma);
  assert.deepEqual([gamma.components.meta.fit.level, gamma.components.meta.fit.used, gamma.components.axes.industry.value, gamma.components.axes.size.value], ['low', 3, null, null]);
  const r = await listScores(s, B, {}, { now: NOW });
  const row = r.body.rows.find(x => x.id === ID.acme);
  assert.deepEqual([row.fit_level, row.fit_source, row.fit_score, row.due, row.due_date, row.first_seen, row.new_today], ['strong', 'computed', 93, 'later', '2026-11-20', '2026-10-28', false]);
  assert.deepEqual(row.axes.us_footprint, { value: 100, why: 'Mostly US' });
  const river = r.body.rows.find(x => x.id === ID.river);
  assert.deepEqual([river.first_seen, river.new_today, river.due], [TODAY, true, 'today'], 'a visitor matched by name is first seen today = NEW');
  assert.deepEqual([r.body.counts.new_today, r.body.counts.due.today, r.body.counts.fit.strong >= 1], [1, 2, true]);
  const newest = await listScores(s, B, { sort: 'newest' }, { now: NOW });
  assert.equal(newest.body.rows[0].id, ID.river, 'F11: newest first');
  assert.deepEqual((await listScores(s, B, { due: 'today' }, { now: NOW })).body.rows.map(x => x.id).sort(), [ID.mace, ID.river].sort());
  assert.deepEqual((await listScores(s, B, { fit: 'strong,good' }, { now: NOW })).body.rows.every(x => ['strong', 'good'].includes(x.fit_level)), true);
});

test('F4 Deprioritize: a reason is required; the record keeps its stage, leaves the default Map + Due lists; Bring back / Undo restore exactly', async () => {
  const s = seed();
  assert.equal((await deprioritize(s, { businessId: B, userId: JACK, type: 'employer', id: ID.mace, body: {}, now: new Date(NOW) })).status, 400);
  assert.equal((await deprioritize(s, { businessId: B, userId: JACK, type: 'employer', id: ID.mace, body: { reason: 'other' }, now: new Date(NOW) })).status, 400, 'Other needs a note');
  assert.equal((await deprioritize(s, { businessId: B, userId: JACK, type: 'employer', id: ID.mace, body: { reason: 'other', note: 'ask bo@mace.example' }, now: new Date(NOW) })).status, 400, 'no address in a note');
  assert.equal((await deprioritize(s, { businessId: B, userId: JACK, type: 'employer', id: ID.mace, body: { reason: 'too_small', expect: 'responded' }, now: new Date(NOW) })).status, 409, 'stale screen');
  const before = { ...s.db.sales_opportunities.find(o => o.id === ID.mace) };
  const r = await deprioritize(s, { businessId: B, userId: JACK, type: 'employer', id: ID.mace, body: { reason: 'mostly_outside_us', expect: 'contacted' }, now: new Date(NOW) });
  assert.equal(r.status, 200, r.body.error);
  const mace = s.db.sales_opportunities.find(o => o.id === ID.mace);
  assert.deepEqual([mace.fit_level, mace.deprioritized_reason, mace.deprioritized_by, mace.stage, mace.us_footprint, mace.us_footprint_source], ['deprioritized', 'mostly_outside_us', JACK, 'contacted', 'mostly_outside_us', 'deprioritize'], 'stage unchanged; Mostly outside US sets the footprint when unknown');
  assert.equal((await deprioritize(s, { businessId: B, userId: JACK, type: 'employer', id: ID.mace, body: { reason: 'too_small' }, now: new Date(NOW) })).status, 409, 'already deprioritized');
  await recompute(s);
  const list = await listScores(s, B, {}, { now: NOW });
  assert.ok(!list.body.rows.some(x => x.id === ID.mace), 'hidden from the default Map');
  assert.equal(list.body.counts.due.today, 1, 'off the Due list despite its to-do due today');
  const shown = await listScores(s, B, { fit: 'deprioritized' }, { now: NOW });
  assert.deepEqual([shown.body.rows.length, shown.body.rows[0].deprioritized_reason, shown.body.rows[0].due], [1, 'mostly_outside_us', null]);
  const events = await listFlow(s, B, 'employer', ID.mace);
  assert.deepEqual([events.length, events[0].kind, events[0].text, events[0].by_user], [1, 'deprioritize', 'Deprioritized · Mostly outside US', JACK]);
  assert.deepEqual(events[0].prev, { fit_level: null, fit_set_by: null, fit_set_at: null, deprioritized_reason: null, deprioritized_note: null, deprioritized_at: null, deprioritized_by: null, us_footprint: null, us_footprint_source: null, us_footprint_at: null });
  // Bring back = the exact prior row (the footprint it set goes too).
  const bb = await bringBack(s, { businessId: B, userId: CYRUS, type: 'employer', id: ID.mace, now: new Date(NOW + 1000) });
  assert.equal(bb.status, 200, bb.body.error);
  const after = s.db.sales_opportunities.find(o => o.id === ID.mace);
  for (const k of ['fit_level', 'fit_set_by', 'fit_set_at', 'deprioritized_reason', 'deprioritized_note', 'deprioritized_at', 'deprioritized_by', 'us_footprint', 'us_footprint_source', 'us_footprint_at', 'stage']) assert.equal(after[k] ?? null, before[k] ?? null, k);
  assert.equal((await bringBack(s, { businessId: B, userId: CYRUS, type: 'employer', id: ID.mace, now: new Date(NOW) })).status, 409);
  // Undo of a deprioritize: restores; refused once something it set changed since.
  const again = await deprioritize(s, { businessId: B, userId: JACK, type: 'employer', id: ID.mace, body: { reason: 'wrong_industry', note: 'construction' }, now: new Date(NOW + 2000) });
  const u = await undoFlow(s, { businessId: B, eventId: again.body.event.id, byUser: JACK, now: new Date(NOW + 3000) });
  assert.equal(u.status, 200, u.body.error);
  assert.deepEqual([s.db.sales_opportunities.find(o => o.id === ID.mace).fit_level, s.db.sales_flow_events.filter(e => e.kind === 'undo').length], [null, 1]);
  assert.equal((await undoFlow(s, { businessId: B, eventId: again.body.event.id, byUser: JACK, now: new Date(NOW + 3000) })).status, 409, 'already undone');
  const third = await deprioritize(s, { businessId: B, userId: JACK, type: 'employer', id: ID.mace, body: { reason: 'too_small' }, now: new Date(NOW + 4000) });
  s.db.sales_opportunities.find(o => o.id === ID.mace).fit_level = 'low';
  assert.equal((await undoFlow(s, { businessId: B, eventId: third.body.event.id, byUser: JACK, now: new Date(NOW + 5000) })).body.code, 'drift');
  assert.equal((await undoFlow(s, { businessId: B, eventId: again.body.event.id, byUser: JACK, now: new Date(NOW + 3 * 60e3 + 10000) })).status, 409, 'window');
});

test('F4 on a partner never moves its stage; a visitor without a record carries the reason on its override; a hand-set Fit wins and clears', async () => {
  const s = seed();
  const eventsBefore = s.db.sales_partner_events.length;
  const r = await deprioritize(s, { businessId: B, userId: JACK, type: 'partner', id: ID.hub, body: { reason: 'upside_owns', expect: 'live' }, now: new Date(NOW) });
  assert.equal(r.status, 200, r.body.error);
  const hub = s.db.sales_goals.find(g => g.id === ID.hub);
  assert.deepEqual([hub.pipeline_status, hub.fit_level, hub.owner_user_id, s.db.sales_partner_events.length], ['live', 'deprioritized', JACK, eventsBefore], 'stage, owner and partner history untouched');
  // Visitor: Riverbend has no row.
  assert.equal((await deprioritize(s, { businessId: B, userId: JACK, type: 'visitor', id: 'nobody here', body: { reason: 'too_small' }, now: new Date(NOW) })).status, 404);
  const v = await deprioritize(s, { businessId: B, userId: JACK, type: 'visitor', id: 'riverbend logistics', body: { reason: 'has_housing_perk' }, now: new Date(NOW) });
  assert.equal(v.status, 200, v.body.error);
  const o = (await loadOverrides(s, B)).get('riverbend logistics');
  assert.deepEqual([o.deprioritized_reason, o.priority, o.not_a_fit], ['has_housing_perk', null, false]);
  assert.deepEqual(effectiveVisit({ priority: 'P1', priority_rule: 'x' }, o).deprioritized, { reason: 'has_housing_perk', note: null });
  assert.equal(effectiveVisit({ priority: 'P1' }, o).priority, 'P1', 'the computed priority is kept');
  assert.equal((await bringBack(s, { businessId: B, userId: JACK, type: 'visitor', id: 'riverbend logistics', now: new Date(NOW) })).status, 200);
  assert.equal((await loadOverrides(s, B)).get('riverbend logistics'), undefined, 'cleared');
  // Hand-set Fit.
  assert.equal((await setFit(s, { businessId: B, userId: JACK, type: 'employer', id: ID.gamma, body: { level: 'huge' }, now: new Date(NOW) })).status, 400);
  const f = await setFit(s, { businessId: B, userId: JACK, type: 'employer', id: ID.gamma, body: { level: 'strong' }, now: new Date(NOW) });
  assert.equal(f.status, 200, f.body.error);
  await recompute(s);
  assert.deepEqual([scoreOf(s, 'employer', ID.gamma).components.meta.fit.level, scoreOf(s, 'employer', ID.gamma).components.meta.fit.source], ['strong', 'hand'], 'hand-set wins over a low score');
  assert.equal((await setFit(s, { businessId: B, userId: JACK, type: 'partner', id: ID.hub, body: { level: 'good' }, now: new Date(NOW) })).body.code, 'deprioritized', 'bring back first');
  assert.equal((await setFit(s, { businessId: B, userId: JACK, type: 'employer', id: ID.gamma, body: { level: null }, now: new Date(NOW) })).status, 200);
  await recompute(s);
  assert.equal(scoreOf(s, 'employer', ID.gamma).components.meta.fit.source, 'computed');
  const fit = await fitOf(s, B, { type: 'employer', id: ID.acme });
  assert.deepEqual([fit.status, fit.body.level, fit.body.used, fit.body.overlay.n, fit.body.axes.length], [200, 'strong', 6, 1, 6], 'the panel body + the clients overlay (1 client)');
});

test('F6 Reached n of m: a person seen in two sources counts once; buyers and replies from real touches; computed live', async () => {
  const two = countReach({
    people: [{ contact_id: 'c1', name: 'Ana Buyer', title: 'VP People', status: 'contacted' }, { name: 'Ana Buyer', title: null }, { name: 'Bo Other', title: 'Analyst' }, { name: 'Dee New', title: 'CHRO' }],
    messages: [{ contact_id: 'c1', delivered_at: '2026-11-01', replied: true }], buyerTitles: ['VP People', 'CHRO'],
  });
  assert.deepEqual([two.known, two.reached, two.buyers, two.buyers_reached, two.buyers_not_yet, two.replies], [3, 1, 2, 1, 1, 1]);
  assert.deepEqual(two.people[0], { name: 'Ana Buyer', title: 'VP People', buyer: true, reached: true, replied: true, via: ['apollo', 'status'] });
  const touch = countReach({ people: [{ name: 'Pat Partner', title: 'VP Benefits' }], partnerTouches: [{ contact_names: ['Pat Partner'], meta: { direction: 'received' } }], outreach: [{ name: 'Pat Partner', last_sent_at: '2026-11-01', status: 'active' }] });
  assert.deepEqual([touch.reached, touch.replies, touch.people[0].via], [1, 1, ['campaign', 'touch']]);
  assert.deepEqual(countReach({}), { known: 0, reached: 0, buyers: 0, buyers_reached: 0, buyers_not_yet: 0, replies: 0, people: [] });
  const s = seed();
  const acme = await reachFor(s, B, { type: 'employer', id: ID.acme });
  assert.deepEqual([acme.status, acme.body.known, acme.body.reached, acme.body.buyers_reached, acme.body.buyers_not_yet, acme.body.replies], [200, 3, 1, 1, 1, 1]);
  assert.ok(!JSON.stringify(acme.body).includes('@'), 'never an address');
  const hub = await reachFor(s, B, { type: 'partner', id: ID.hub });
  assert.deepEqual([hub.body.known, hub.body.reached, hub.body.people[0].via], [1, 1, ['apollo', 'touch']], 'partner_contacts + the linked prospect = one person, reached by the touch and the delivery');
});

test('F7 rules: a reply moves Contacted -> Responded once; a calendar meeting moves only from Contacted / Responded; forward only; partners never', async () => {
  const s = seed();
  const plan = employerMoves({
    employers: s.db.sales_opportunities, prospects: s.db.sales_prospect_state, messages: s.db.sales_email_messages,
    received: s.db.microsoft_messages, events: s.db.microsoft_events, applied: new Set(),
  });
  assert.deepEqual(plan.moves.map(m => [m.name, m.from, m.to, m.kind, m.source]).sort(), [['Acme Health', 'contacted', 'responded', 'reply_move', 'apollo'], ['Beta Corp', 'responded', 'meeting', 'meeting_move', 'calendar']]);
  assert.deepEqual([plan.skipped.auto, plan.skipped.cancelled, plan.skipped.not_contacted >= 1], [1, 1, true], 'the auto-reply, the cancelled meeting, Beta already Responded');
  assert.ok(!plan.moves.some(m => m.name === 'Already Meeting'), 'a reply at Meeting is not a move back');
  const run1 = await runEmployerReplyRules(s, B, { now: new Date(NOW) });
  assert.deepEqual([run1.counts.applied, run1.counts.refused], [2, 0]);
  const stage = id => s.db.sales_opportunities.find(o => o.id === id).stage;
  assert.deepEqual([stage(ID.acme), stage(ID.beta), stage(ID.mace), stage(ID.meeting)], ['responded', 'meeting', 'contacted', 'meeting']);
  assert.equal(s.db.sales_goals.find(g => g.id === ID.hub).pipeline_status, 'live', 'the partner domain on the calendar moved nobody');
  const ev = s.db.sales_flow_events.find(e => e.record_id === ID.acme);
  assert.deepEqual([ev.kind, ev.text, ev.by_user, ev.meta.key, ev.prev], ['reply_move', 'Reply from Acme Health → Replied', null, 'apollo:m1', { stage: 'contacted' }]);
  const run2 = await runEmployerReplyRules(s, B, { now: new Date(NOW + 1000) });
  assert.deepEqual([run2.counts.applied, run2.skipped.already, s.db.sales_flow_events.length], [0, 1, 2], 'once: the keys are settled (Beta is past Responded now)');
  // Undo of an automatic move stays open for days.
  const u = await undoFlow(s, { businessId: B, eventId: ev.id, byUser: JACK, now: new Date(NOW + 3 * DAY) });
  assert.deepEqual([u.status, stage(ID.acme)], [200, 'contacted']);
  assert.equal((await runEmployerReplyRules(s, B, { now: new Date(NOW + 3 * DAY) })).counts.applied, 0, 'an undone key is never re-applied');
  // expect mismatch = no move.
  assert.equal((await advanceStage(s, { businessId: B, userId: null, type: 'employer', id: ID.beta, body: { expect: 'responded', to: 'proposal_pilot' }, now: new Date(NOW) })).status, 409);
  assert.equal((await advanceStage(s, { businessId: B, userId: null, type: 'employer', id: ID.beta, body: { expect: 'meeting', to: 'contacted' }, now: new Date(NOW) })).body.code, 'not_forward');
  assert.equal((await advanceStage(s, { businessId: B, userId: null, type: 'partner', id: ID.hub, body: { expect: 'live', to: 'meeting' }, now: new Date(NOW) })).status, 400, 'to is employers only');
});

test('F7 suggestions: Apollo reply_class only suggests; They replied… maps outcome -> stage + suggestion with expect and Undo', async () => {
  assert.deepEqual(replySuggestion({ replyClass: 'willing_to_meet' }), { text: 'Book the meeting', action: 'book_meeting', source: 'apollo' });
  assert.equal(replySuggestion({ replyClass: 'person_referral' }).text, 'Follow the referral');
  assert.equal(replySuggestion({ replyClass: 'not_interested' }).text, 'Mark lost?');
  assert.deepEqual(replySuggestion({ outlookReply: true }), { text: 'They replied — what did they say?', action: 'they_replied', source: 'outlook' });
  assert.equal(replySuggestion({ outcome: 'meeting_set', replyClass: 'not_interested' }), null, 'a person\'s outcome wins');
  assert.equal(replySuggestion({}), null);
  const s = seed();
  await runEmployerReplyRules(s, B, { now: new Date(NOW) });
  const sug = await replySuggestionFor(s, B, ID.acme);
  assert.deepEqual([s.db.sales_opportunities.find(o => o.id === ID.acme).stage, sug.body.suggestion.text, sug.body.reply_class], ['responded', 'Book the meeting', 'willing_to_meet'], 'willing_to_meet never moved it past Responded');
  // They replied… on Mace (still Contacted).
  assert.equal((await theyReplied(s, { businessId: B, userId: JACK, id: ID.mace, body: { outcome: 'maybe', expect: 'contacted' }, now: new Date(NOW) })).status, 400);
  assert.equal((await theyReplied(s, { businessId: B, userId: JACK, id: ID.mace, body: { outcome: 'meeting_set', expect: 'responded' }, now: new Date(NOW) })).status, 409, 'stale');
  const t = await theyReplied(s, { businessId: B, userId: JACK, id: ID.mace, body: { outcome: 'meeting_set', expect: 'contacted' }, now: new Date(NOW) });
  assert.deepEqual([t.status, t.body.stage, t.body.suggestion], [200, { before: 'contacted', after: 'meeting' }, null]);
  assert.equal(s.db.sales_opportunities.find(o => o.id === ID.mace).stage, 'meeting');
  const u = await undoFlow(s, { businessId: B, eventId: t.body.event.id, byUser: JACK, now: new Date(NOW + 5000) });
  assert.deepEqual([u.status, s.db.sales_opportunities.find(o => o.id === ID.mace).stage], [200, 'contacted']);
  const no = await theyReplied(s, { businessId: B, userId: JACK, id: ID.mace, body: { outcome: 'no', expect: 'contacted' }, now: new Date(NOW + 6000) });
  assert.deepEqual([no.body.stage.after, no.body.suggestion.text], ['responded', 'Mark lost?']);
  assert.equal((await replySuggestionFor(s, B, ID.mace)).body.suggestion.text, 'Mark lost?', 'the outcome drives the panel suggestion');
  const past = await theyReplied(s, { businessId: B, userId: JACK, id: ID.beta, body: { outcome: 'interested', expect: 'meeting' }, now: new Date(NOW + 7000) });
  assert.deepEqual([past.status, past.body.stage], [200, { before: 'meeting', after: 'meeting' }], 'never backwards: Interested on a Meeting keeps Meeting');
});

test('ruling F-d: visits match on create and promote (name or domain); the backfill plans by name then domain and reports before -> after', async () => {
  const s = seed();
  const plan = planVisitMatches(s.db.web_visits, { ctx: { partners: s.db.sales_goals, opportunities: s.db.sales_opportunities, companies: [], targets: s.db.sales_targets, domains: [] }, domains: [{ type: 'employer', id: ID.mace, name: 'Mace Group', domain: 'macegroup.example' }] });
  assert.deepEqual(plan.map(p => [p.company_key, p.type, p.via]).sort(), [['mace', 'employer', 'domain'], ['mace', 'employer', 'domain'], ['riverbend logistics', 'target', 'name']]);
  const dry = await backfillVisitMatches(s, B, { apply: false });
  assert.deepEqual([dry.before.unmatched, dry.planned, dry.by_type, dry.matched, dry.after.unmatched], [4, 3, { employer: 2, target: 1 }, 0, 4]);
  assert.equal(s.db.web_visits.filter(v => !v.matched_id).length, 4, 'a dry run writes nothing');
  const applied = await backfillVisitMatches(s, B, { apply: true });
  assert.deepEqual([applied.matched, applied.after.unmatched], [3, 1]);
  assert.ok(s.db.web_visits.filter(v => v.company_key === 'mace').every(v => v.matched_type === 'opportunity' && v.matched_id === ID.mace), "Mace's rows point at the Mace employer");
  // Create: the still-unmatched NewCo row follows a new employer with that domain.
  const made = await insertCompanyRecord(s, { businessId: B, userId: JACK, name: 'New Company', domain: 'newco.example', to: 'employer', channel: 'manual', evidence: 'typed', now: new Date(NOW) });
  assert.deepEqual([made.created.type, made.visits_matched], ['employer', 1]);
  assert.equal(s.db.web_visits.find(v => v.id === V.newco).matched_id, made.created.id);
  assert.equal(await rematchVisits(s, { businessId: B, type: 'employer', id: made.created.id, name: 'New Company', domain: 'newco.example' }), 0, 'already matched rows never move');
  // Promote: a fresh target whose unmatched visit row shares its name.
  const s2 = seed();
  const p = await promoteTarget(s2, { businessId: B, userId: JACK, targetId: ID.river, body: { to: 'employer' } });
  assert.equal(p.status, 201, p.body.error);
  assert.deepEqual([p.body.visits_moved, s2.db.web_visits.find(v => v.id === V.river).matched_type, s2.db.web_visits.find(v => v.id === V.river).matched_id], [1, 'opportunity', p.body.created.id]);
});

test('ruling F-b: member colors are stored per member; a member without one gets the next free MEMBER_COLORS entry by join order and keeps it', async () => {
  const list = assignColors([{ user_id: 'b', created_at: '2', member_color: null }, { user_id: 'a', created_at: '1', member_color: null }, { user_id: 'c', created_at: '3', member_color: MEMBER_COLORS[0] }]);
  assert.deepEqual(list.map(m => [m.user_id, m.color, m.assigned]), [['a', MEMBER_COLORS[1], true], ['b', MEMBER_COLORS[2], true], ['c', MEMBER_COLORS[0], false]]);
  const s = seed();
  const colors = await memberColors(s, B);
  assert.deepEqual([colors.get(CYRUS), colors.get(JACK)], ['#D9A441', MEMBER_COLORS[0]]);
  assert.equal(s.db.business_members.find(m => m.user_id === JACK).member_color, MEMBER_COLORS[0], 'saved, so it never shifts');
  s.db.business_members.find(m => m.user_id === CYRUS).created_at = ago(200);
  assert.equal((await memberColors(s, B)).get(JACK), MEMBER_COLORS[0], 'join order changing later changes nothing');
});

test('research: us_footprint rides the existing single call; junk is null; research never writes over a manual value', async () => {
  const sys = researchSystem({ name: 'HomeLover' }, [], 'employer');
  assert.match(sys, /"us_footprint": "mostly_us\|mixed\|mostly_outside_us\|unknown"/);
  assert.match(sys, /us_footprint: where their employees mostly are/);
  const parsed = parseResearch('{"website": "https://acme.example", "domain": "acme.example", "website_confidence": "high", "us_footprint": "mostly_outside_us"}', []);
  assert.equal(parsed.us_footprint, 'mostly_outside_us');
  assert.equal(parseResearch('{"us_footprint": "unknown"}', []).us_footprint, null);
  assert.equal(parseResearch('{"us_footprint": "<b>everywhere</b>"}', []).us_footprint, null);
  const s = seed();
  assert.deepEqual(await applyResearchFootprint(s, { businessId: B, type: 'employer', id: ID.gamma, result: { us_footprint: 'mixed' } }), { written: true });
  assert.deepEqual([s.db.sales_opportunities.find(o => o.id === ID.gamma).us_footprint, s.db.sales_opportunities.find(o => o.id === ID.gamma).us_footprint_source], ['mixed', 'research']);
  s.db.sales_opportunities.find(o => o.id === ID.beta).us_footprint = 'mostly_us'; s.db.sales_opportunities.find(o => o.id === ID.beta).us_footprint_source = 'manual';
  assert.deepEqual(await applyResearchFootprint(s, { businessId: B, type: 'employer', id: ID.beta, result: { us_footprint: 'mixed' } }), { written: false });
  assert.equal(s.db.sales_opportunities.find(o => o.id === ID.beta).us_footprint, 'mostly_us');
  assert.deepEqual(await applyResearchFootprint(s, { businessId: B, type: 'employer', id: ID.beta, result: { us_footprint: 'nope' } }), { written: false });
});

test('F1 Map Assign on an employer / target is Activity + Undo (the prior owner comes back); picking nobody is "Unassigned"', async () => {
  const s = seed();
  const r = await editCompanyFields(s, { businessId: B, type: 'employer', id: ID.acme, body: { owner_user_id: JACK }, byUser: JACK, now: new Date(NOW) });
  assert.equal(r.status, 200, r.body.error);
  assert.deepEqual([r.body.fields.owner_user_id, r.body.fields.owner, r.body.before], [JACK, 'Jack', { owner_user_id: CYRUS }]);
  const ev = s.db.sales_flow_events.find(e => e.id === r.body.event.id);
  assert.deepEqual([ev.kind, ev.text, ev.prev, ev.meta.set], ['assign', 'Assigned to Jack', { owner_user_id: CYRUS, owner: 'Cyrus' }, { owner_user_id: JACK, owner: 'Jack' }]);
  const u = await undoFlow(s, { businessId: B, eventId: ev.id, byUser: JACK, now: new Date(NOW + 5000) });
  assert.equal(u.status, 200, u.body.error);
  assert.deepEqual([s.db.sales_opportunities.find(o => o.id === ID.acme).owner_user_id, s.db.sales_opportunities.find(o => o.id === ID.acme).owner], [CYRUS, 'Cyrus']);
  const same = await editCompanyFields(s, { businessId: B, type: 'employer', id: ID.acme, body: { owner_user_id: CYRUS }, byUser: JACK, now: new Date(NOW) });
  assert.deepEqual([same.status, same.body.event], [200, null], 'the current owner again = no event, no error');
  const none = await editCompanyFields(s, { businessId: B, type: 'target', id: ID.river, body: { owner_user_id: JACK }, byUser: JACK, now: new Date(NOW) });
  const off = await editCompanyFields(s, { businessId: B, type: 'target', id: ID.river, body: { owner_user_id: null }, byUser: JACK, now: new Date(NOW) });
  assert.deepEqual([none.body.event != null, s.db.sales_flow_events.find(e => e.id === off.body.event.id).text], [true, 'Unassigned']);
});
