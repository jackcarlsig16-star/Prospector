// node --test api/sales/weeklyMetrics.test.mjs
// weekly-funnel-v1 Stage 1: the registry over a fixture - every row equals its source function to the digit (the
// Scorecard's own month read, the funnel route's this / last week, pulseMath's window, the synced level), pace at three
// points of the week, rates and levels never projected, a week goal refused once its week has ended, the typed row's
// last write wins, pins made, and the Scout intent. Invented people and companies; no '@' anywhere in an output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { goalsDeps, addDays, laMonday } from './goalsShared.js';
import { laDateString } from './laDate.js';
import { hasPii } from './scrubText.js';
import { METRICS, GOAL_KEYS, MANUAL_KEYS, GROUPS, PINS_SINCE, WORDING, WEEK_ENDED_ERROR, weekList, weeklyWindows, weekEnded, elapsedOf, samePointLastWeek, paceOf, pinsMade, clampWeeks } from './weeklyMetrics.js';
import { loadWeekly, saveManual, NOTE_MAX } from './weeklyRoutes.js';
import { buildScorecard, lastSyncedValue, saveTargetRoute } from './goalsReportRoutes.js';
import { loadFunnel } from './funnelRoutes.js';
import { FUNNEL_SINCE } from './funnelMath.js';
import { windowValues } from './pulseMath.js';
import { loadPartnerData, peopleFirstTouched } from './partnerMetrics.js';
import { parseAsk, mergeVocab } from '../scout/retrieve.js';
import { VOCABULARY, glossary } from './scoutEntities.js';
import { salesIntents, salesReads, weeklyLine } from './scoutIntents.js';

const B = '00000000-0000-4000-8000-0000000000b1';
const u = n => `${n}0000000-0000-4000-8000-000000000000`;
const NOW = Date.parse('2026-11-19T16:00:00Z'); // Thu Nov 19, 08:00 PST
const TODAY = '2026-11-19', MON = '2026-11-16', LAST = '2026-11-09';
const count = (day, delivered, hard_bounced, spam_blocked, opened, replied = 0) => ({ business_id: B, day, mailbox: 'box-one', sequence_id: 's1', step: 1, delivered, hard_bounced, spam_blocked, opened, clicked: 0, replied });
const msg = (id, contact, day, account = null) => ({ business_id: B, apollo_message_id: id, contact_id: contact, account_id: account, mailbox: 'box-one', delivered_at: `${day}T16:00:00Z`, delivered_day: day, sequence_id: 's1', step: 1 });
const act = (id, m, event, at, user_agent = 'Mozilla/5.0 (Macintosh)') => ({ id, business_id: B, apollo_message_id: m, event, occurred_at: at, user_agent, tracking_service: null, sender: 'box-one' });
const pe = (id, goal, at, extra) => ({ id, business_id: B, goal_id: goal, from_status: null, to_status: null, touch_type: null, contact_names: null, source: null, meta: {}, at, ...extra });
const DELIVERED = [msg('m1', 'c1', '2026-11-10', 'a1'), msg('m2', 'c2', '2026-11-11'), msg('m3', 'c3', '2026-11-12', 'a1'), msg('m4', 'c4', '2026-11-17', 'a1'), msg('m5', 'c5', '2026-11-18'), msg('m6', 'c6', '2026-11-03')];
const seed = (extra = {}) => fakeSupabase({
  business_members: [{ business_id: B, user_id: u('a'), role: 'owner', created_at: '2026-09-01T00:00:00Z' }, { business_id: B, user_id: u('c'), role: 'member', created_at: '2026-09-02T00:00:00Z' }],
  profiles: [{ id: u('a'), display_name: 'Ana Owner' }, { id: u('c'), display_name: 'Cy Member' }],
  sales_email_daily_counts: [
    count('2026-10-20', 90, 6, 4, 9), count('2026-11-03', 80, 2, 1, 10),
    count('2026-11-09', 50, 1, 0, 6), count('2026-11-10', 48, 0, 2, 9, 1), count('2026-11-12', 51, 1, 1, 7), count('2026-11-13', 49, 2, 0, 4),
    count('2026-11-16', 40, 0, 0, 8), count('2026-11-17', 52, 1, 0, 9), count('2026-11-18', 47, 0, 1, 5),
  ],
  sales_email_delivered: DELIVERED,
  sales_email_messages: [
    ...DELIVERED.map(d => ({ business_id: B, apollo_message_id: d.apollo_message_id, delivered_at: d.delivered_at, replied: false, reply_class: null, replied_at: null, replied_seen_at: null })),
  ].map(x => (x.apollo_message_id === 'm1' ? { ...x, replied: true, reply_class: 'follow_up_question', replied_at: '2026-11-11T18:00:00Z' } : x.apollo_message_id === 'm4' ? { ...x, replied: true, reply_class: 'willing_to_meet', replied_at: '2026-11-18T18:00:00Z' } : x)),
  sales_email_activity: [
    act(1, 'm1', 'open', '2026-11-10T20:00:00Z'), act(2, 'm2', 'open', '2026-11-11T16:00:01Z'), act(3, 'm3', 'open', '2026-11-12T22:00:00Z'), act(4, 'm1', 'click', '2026-11-10T21:00:00Z'),
    act(5, 'm4', 'open', '2026-11-17T20:00:00Z'), act(6, 'm5', 'open', '2026-11-18T23:00:00Z'), act(7, 'm4', 'click', '2026-11-17T21:00:00Z'), act(8, 'm6', 'open', '2026-11-03T20:00:00Z'),
  ],
  sales_prospect_state: [{ business_id: B, contact_id: 'c2', name: 'Dana Mayer', company: 'Beta Co', opportunity_id: null, goal_id: null }, { business_id: B, contact_id: 'c5', name: 'Lee Stone', company: 'Beta Co', opportunity_id: null, goal_id: null }],
  sales_opportunities: [{ id: u('1'), business_id: B, organization: 'Acme', apollo_account_id: 'a1' }],
  web_visits: [
    { id: 1, business_id: B, company_key: 'acme', pulled_on: '2026-11-12', seen_from: '2026-11-12', seen_to: '2026-11-12', matched_type: 'opportunity', matched_id: u('1') },
    { id: 2, business_id: B, company_key: 'beta co', pulled_on: '2026-11-18', seen_from: '2026-11-18', seen_to: '2026-11-18', matched_type: null, matched_id: null },
  ],
  sales_people: [{ id: u('7'), business_id: B, name: 'Lee Stone', company_name: 'Beta Co', opportunity_id: null, target_id: null, apollo_person_id: null, created_at: '2026-11-18T20:00:00Z', source_kind: 'web_visit', archived_at: null }],
  microsoft_events: [
    { id: 1, business_id: B, graph_id: 'g1', ical_uid: 'i1', external_domains: ['acme.test'], start_at: '2026-11-20T18:00:00Z', is_cancelled: false, created_at_graph: '2026-11-10T18:00:00Z' },
    { id: 2, business_id: B, graph_id: 'g2', ical_uid: 'i2', external_domains: ['beta.test'], start_at: '2026-11-24T18:00:00Z', is_cancelled: false, created_at_graph: '2026-11-17T18:00:00Z' },
    { id: 3, business_id: B, graph_id: 'g3', ical_uid: 'i3', external_domains: ['beta.test'], start_at: '2026-11-25T18:00:00Z', is_cancelled: false, created_at_graph: '2026-11-13T18:00:00Z' },
    { id: 4, business_id: B, graph_id: 'g4', ical_uid: 'i4', external_domains: [], start_at: '2026-11-18T18:00:00Z', is_cancelled: false, created_at_graph: '2026-11-17T19:00:00Z' },
  ],
  sales_goals: [
    { id: u('2'), business_id: B, goal_type: 'partnership', name: 'North Partners', owner_user_id: u('a'), tier: '1', pipeline_status: 'meeting_set', known_contacts: null, archived_at: null },
    { id: u('3'), business_id: B, goal_type: 'partnership', name: 'South Partners', owner_user_id: u('c'), tier: '1', pipeline_status: 'not_started', known_contacts: null, archived_at: null },
    { id: u('4'), business_id: B, goal_type: 'partnership', name: 'East Partners', owner_user_id: u('c'), tier: '2', pipeline_status: 'live', known_contacts: null, archived_at: null },
  ],
  sales_partner_events: [
    pe('e1', u('2'), '2026-11-10T18:00:00Z', { event: 'touch', touch_type: 'email', contact_names: ['Rae North'] }),
    pe('e2', u('2'), '2026-11-12T18:00:00Z', { event: 'status', from_status: 'first_email_sent', to_status: 'meeting_set' }),
    pe('e3', u('4'), '2026-11-17T18:00:00Z', { event: 'status', from_status: 'meeting_set', to_status: 'live' }),
    pe('e4', u('4'), '2026-11-17T19:00:00Z', { event: 'touch', touch_type: 'call', contact_names: ['Kit East'] }),
    pe('e5', u('2'), '2026-11-17T20:00:00Z', { event: 'hot', meta: { hot: true, pin: 'pin' } }),
    pe('e6', u('4'), '2026-11-18T20:00:00Z', { event: 'hot', meta: { hot: true, pin: 'renew' } }),
    pe('e7', u('3'), '2026-11-18T21:00:00Z', { event: 'hot', meta: { hot: true, pin: 'pin' } }),
    pe('e8', u('3'), '2026-11-18T21:01:00Z', { event: 'undo', meta: { undid: 'e7' } }),
  ],
  partner_contacts: [],
  sales_flow_events: [
    { id: 'f1', business_id: B, kind: 'pin', at: '2026-11-13T18:00:00Z', undone_at: null },
    { id: 'f2', business_id: B, kind: 'pin', at: '2026-11-16T18:00:00Z', undone_at: null },
    { id: 'f3', business_id: B, kind: 'pin', at: '2026-11-17T18:00:00Z', undone_at: '2026-11-17T18:00:05Z' },
    { id: 'f4', business_id: B, kind: 'pin_renew', at: '2026-11-17T19:00:00Z', undone_at: null },
  ],
  sales_metrics_daily: [
    { business_id: B, metric_key: 'prospects_in_cadence', dim_type: 'all', metric_date: '2026-11-10', value: 900 }, { business_id: B, metric_key: 'prospects_in_cadence', dim_type: 'all', metric_date: '2026-11-14', value: 940 },
    { business_id: B, metric_key: 'prospects_in_cadence', dim_type: 'all', metric_date: '2026-11-18', value: 1010 }, { business_id: B, metric_key: 'sequences_active', dim_type: 'all', metric_date: '2026-11-12', value: 7 },
    { business_id: B, metric_key: 'sequences_active', dim_type: 'all', metric_date: '2026-11-18', value: 9 },
  ],
  sales_metric_targets: [
    { business_id: B, period: 'week', period_start: LAST, metric_key: 'delivered', goal: 150 }, { business_id: B, period: 'week', period_start: LAST, metric_key: 'deliverability', goal: 0.99 },
    { business_id: B, period: 'week', period_start: MON, metric_key: 'delivered', goal: 400 }, { business_id: B, period: 'week', period_start: MON, metric_key: 'human_open_rate', goal: 0.2 },
    { business_id: B, period: 'week', period_start: '2026-10-05', metric_key: 'partners_first_touched', goal: 100, unit: 'people' },
  ],
  sales_manual_metrics: [{ business_id: B, metric_key: 'linkedin_requests', week_start: LAST, value: 40, entered_by: u('c'), entered_at: '2026-11-16T17:00:00Z', note: null }],
  ...extra,
});
const of = (body, key) => body.metrics.find(x => x.key === key);
const at = (body, key, week) => of(body, key).series.find(s => s.week_start === week).value;
const res = () => { const r = { code: 200, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };

test('W1: the registry - groups in order, every key once, units / kinds / direction, the goal keys the migration admits', () => {
  assert.deepEqual([...new Set(METRICS.map(x => x.group))], GROUPS);
  assert.equal(new Set(METRICS.map(x => x.key)).size, METRICS.length);
  assert.deepEqual(METRICS.filter(x => x.group === 'Outbound' && !x.context).map(x => x.key), ['delivered', 'deliverability', 'human_open_rate', 'human_clicks', 'replies', 'meetings_set']);
  assert.deepEqual(METRICS.filter(x => x.context).map(x => x.key), ['total_in_sequence', 'sequences_running']);
  assert.deepEqual(METRICS.filter(x => x.group === 'Site').map(x => x.key), ['companies_visited', 'people_identified', 'email_site_company_rate']);
  assert.deepEqual(MANUAL_KEYS, ['linkedin_requests', 'linkedin_accepted', 'linkedin_replies', 'linkedin_posts']);
  for (const x of METRICS) { assert.ok(['count', 'rate'].includes(x.unit) && ['flow', 'stock', 'manual'].includes(x.kind) && ['up', 'down'].includes(x.direction) && typeof x.value === 'function', x.key); }
  const admitted = ['total_in_sequence', 'sequences_running', 'meetings_set', 'human_open_rate', 'partners_first_touched', 'tier1_touched_pct', 'partner_meetings', 'partners_pilot_live',
    'delivered', 'deliverability', 'human_clicks', 'replies', 'companies_visited', 'people_identified', 'email_site_company_rate', 'top_target_pins', ...MANUAL_KEYS];
  assert.deepEqual([...GOAL_KEYS].sort(), [...admitted].sort());
});

test('W2: every row equals its source function to the digit - the Scorecard month read, the funnel route, the pulse window, the synced level', async () => {
  const sb = seed();
  const { status, body } = await loadWeekly(sb, B, { weeks: 12, now: NOW });
  assert.equal(status, 200);
  assert.deepEqual(body.weeks, weekList(TODAY, 12)); assert.equal(body.weeks.length, 12); assert.equal(body.weeks[11], MON); assert.equal(body.week_start, MON);
  // the Scorecard's own rows for last week (buildScorecard = GET goals/scorecard)
  const card = (await buildScorecard(sb, B, '2026-11-01', null)).weeks.find(w => w.week_start === LAST).metrics;
  for (const k of ['total_in_sequence', 'sequences_running', 'human_open_rate', 'meetings_set', 'people_first_touched', 'tier1_touched_pct', 'partner_meetings', 'partners_pilot_live']) assert.equal(at(body, k, LAST), card[k].value, k);
  assert.equal(at(body, 'meetings_set', LAST), 2); assert.equal(at(body, 'partner_meetings', LAST), 1); assert.equal(at(body, 'total_in_sequence', LAST), 940);
  assert.ok(at(body, 'human_open_rate', LAST) > 0 && at(body, 'people_first_touched', LAST) >= 1);
  // the funnel route's this week / last week (funnelWindow)
  const f = (await loadFunnel(sb, B, { windows: ['this_week', 'last_week'], now: NOW })).body.windows;
  for (const [k, pick] of [['human_clicks', w => w.human_clicks], ['replies', w => w.replies], ['companies_visited', w => w.companies_visited], ['people_identified', w => w.people_identified], ['email_site_company_rate', w => w.company_rate.rate]]) {
    assert.equal(at(body, k, LAST), pick(f.last_week), `${k} last week`); assert.equal(of(body, k).this_week.to_date, pick(f.this_week), `${k} this week`);
  }
  assert.equal(at(body, 'companies_visited', LAST), 1); assert.equal(of(body, 'people_identified').this_week.to_date, 1); assert.equal(at(body, 'replies', LAST), 1);
  // the pulse window (delivered, deliverability) and the same point last week for all of them
  const partnerData = await loadPartnerData(sb, B);
  const pctx = { counts: (await sb.from('sales_email_daily_counts').select('*').eq('business_id', B)).data, opens: (await sb.from('sales_email_activity').select('*').eq('event', 'open')).data, deliveredAt: new Map(DELIVERED.map(d => [d.apollo_message_id, d.delivered_at])), events: (await sb.from('microsoft_events').select('*')).data, visits: [], people: peopleFirstTouched(partnerData, null), now: NOW };
  const whole = windowValues({ from: LAST, to: addDays(LAST, 6) }, pctx), toDate = windowValues({ from: MON, to: TODAY }, pctx), same = windowValues(samePointLastWeek(TODAY), pctx);
  assert.equal(at(body, 'delivered', LAST), whole.delivered); assert.equal(whole.delivered, 198);
  assert.equal(at(body, 'deliverability', LAST), whole.delivered_rate); assert.equal(whole.delivered_rate, 198 / 205);
  assert.equal(of(body, 'delivered').this_week.to_date, toDate.delivered); assert.equal(toDate.delivered, 139);
  assert.equal(of(body, 'delivered').this_week.same_point_last_week, same.delivered); assert.equal(same.delivered, 149);
  assert.equal(of(body, 'delivered').this_week.delta, -10);
  assert.equal(of(body, 'human_open_rate').this_week.to_date, toDate.human_open_rate); assert.equal(of(body, 'human_open_rate').this_week.same_point_last_week, same.human_open_rate);
  assert.equal(of(body, 'meetings_set').this_week.same_point_last_week, 1);
  assert.deepEqual(body.same_point, { from: LAST, to: '2026-11-12' });
  // the synced level over the cut window
  assert.equal(of(body, 'total_in_sequence').this_week.to_date, await lastSyncedValue(sb, B, 'prospects_in_cadence', MON, TODAY));
  assert.equal(of(body, 'total_in_sequence').this_week.same_point_last_week, 900); assert.equal(of(body, 'sequences_running').this_week.to_date, 9);
  // a week before a row's data began is empty, never 0; a week with no sends is empty
  assert.ok('2026-10-19' < FUNNEL_SINCE); assert.equal(at(body, 'human_clicks', '2026-10-19'), null); assert.equal(at(body, 'companies_visited', '2026-10-19'), null);
  assert.equal(at(body, 'delivered', '2026-10-19'), 90); assert.equal(at(body, 'delivered', '2026-10-26'), null); assert.equal(at(body, 'deliverability', '2026-10-26'), null);
  assert.equal(at(body, 'top_target_pins', '2026-11-02'), null);
  // goals ride on their week; first-touched carries the Scorecard's way
  assert.equal(of(body, 'delivered').this_week.goal, 400); assert.equal(of(body, 'delivered').this_week.progress, 139 / 400);
  assert.deepEqual(of(body, 'delivered').last_week, { week_start: LAST, value: 198, goal: 150, hit: true });
  assert.equal(of(body, 'deliverability').last_week.hit, false); assert.equal(of(body, 'replies').last_week.hit, null);
  const ft = of(body, 'people_first_touched').series.find(s => s.week_start === MON); assert.equal(ft.goal, 100); assert.equal(ft.carried, true);
  assert.ok(!JSON.stringify(body).includes('@'));
});

test('W4: pace - Monday, midweek and Sunday; rates, levels and typed numbers are never projected', async () => {
  const flow = METRICS.find(x => x.key === 'delivered'), rate = METRICS.find(x => x.key === 'human_open_rate'), stock = METRICS.find(x => x.key === 'total_in_sequence'), typed = METRICS.find(x => x.key === 'linkedin_requests');
  assert.deepEqual(elapsedOf('2026-11-16'), { days: 1, share: 1 / 7 }); assert.deepEqual(elapsedOf('2026-11-19'), { days: 4, share: 4 / 7 }); assert.deepEqual(elapsedOf('2026-11-22'), { days: 7, share: 1 });
  assert.equal(paceOf(flow, 20, '2026-11-16'), 140); assert.equal(paceOf(flow, 139, '2026-11-19'), 243); assert.equal(paceOf(flow, 310, '2026-11-22'), 310);
  assert.equal(paceOf(flow, 0, '2026-11-17'), 0); assert.equal(paceOf(flow, null, '2026-11-19'), null);
  assert.equal(paceOf(rate, 0.16, '2026-11-19'), null); assert.equal(paceOf(stock, 900, '2026-11-19'), null); assert.equal(paceOf(typed, 40, '2026-11-19'), null);
  assert.deepEqual(samePointLastWeek('2026-11-16'), { from: LAST, to: LAST }); assert.deepEqual(samePointLastWeek('2026-11-22'), { from: LAST, to: '2026-11-15' });
  assert.deepEqual(weeklyWindows(TODAY, 2), [{ from: LAST, to: '2026-11-15' }, { from: MON, to: TODAY }, { from: LAST, to: '2026-11-12' }]);
  assert.equal(clampWeeks('12'), 12); assert.equal(clampWeeks('900'), 26); assert.equal(clampWeeks(undefined), 12); assert.equal(clampWeeks('x'), 12);
  const { body } = await loadWeekly(seed(), B, { now: NOW });
  assert.deepEqual(body.elapsed, { days: 4, share: 4 / 7 });
  assert.equal(of(body, 'delivered').this_week.pace, 243);
  for (const x of body.metrics) if (x.unit === 'rate' || x.kind !== 'flow') assert.equal(x.this_week.pace, null, x.key);
  assert.ok(body.metrics.filter(x => x.unit === 'rate').length >= 4);
  // a Sunday: the pace is the week itself
  const sun = (await loadWeekly(seed(), B, { now: Date.parse('2026-11-22T20:00:00Z') })).body;
  assert.equal(of(sun, 'delivered').this_week.pace, of(sun, 'delivered').this_week.to_date);
});

test('pins made: a pin counts, an undone pin / a renewal / a reason edit do not; partners through the hot event', async () => {
  const sb = seed();
  const data = await loadPartnerData(sb, B);
  const made = pinsMade((await sb.from('sales_flow_events').select('*')).data, data);
  assert.deepEqual(made.sort(), ['2026-11-13T18:00:00Z', '2026-11-16T18:00:00Z', '2026-11-17T20:00:00Z']);
  const { body } = await loadWeekly(sb, B, { now: NOW });
  assert.equal(at(body, 'top_target_pins', LAST), 1); assert.equal(of(body, 'top_target_pins').this_week.to_date, 2);
  assert.equal(laMonday(PINS_SINCE), PINS_SINCE);
});

test('W3: a week goal is refused once its week has ended (409, nothing written); this week takes one on a new key', async () => {
  assert.equal(weekEnded(MON, '2026-11-22'), false); assert.equal(weekEnded(MON, '2026-11-23'), true); assert.equal(weekEnded(MON, '2026-11-10'), false);
  const sb = seed(); goalsDeps.supabase = sb;
  try {
    const before = (await sb.from('sales_metric_targets').select('*')).data.length;
    const thisWeek = laMonday(laDateString());
    const put = async body => { const r = res(); await saveTargetRoute({ params: { businessId: B }, body, auth: { user: { id: u('a') } } }, r); return r; };
    const late = await put({ period: 'week', period_start: addDays(thisWeek, -7), metric_key: 'human_open_rate', goal: 0.18 });
    assert.equal(late.code, 409); assert.equal(late.body.error, WEEK_ENDED_ERROR); assert.equal(late.body.code, 'week_ended');
    assert.equal((await sb.from('sales_metric_targets').select('*')).data.length, before);
    const ok = await put({ period: 'week', period_start: thisWeek, metric_key: 'deliverability', goal: 0.98 });
    assert.equal(ok.code, 200); assert.equal(ok.body.target.goal, 0.98); assert.equal(ok.body.target.updated_by, u('a'));
    const next = await put({ period: 'week', period_start: addDays(thisWeek, 7), metric_key: 'human_open_rate', goal: 0.18 });
    assert.equal(next.code, 200);
    assert.equal((await put({ period: 'week', period_start: thisWeek, metric_key: 'linkedin_posts', goal: 3 })).code, 200);
    assert.equal((await put({ period: 'week', period_start: thisWeek, metric_key: 'people_first_touched', goal: 3 })).code, 400);
    // a month goal is not a week goal
    assert.equal((await put({ period: 'month', period_start: '2026-01-01', metric_key: 'total_in_sequence', goal: 10 })).code, 200);
  } finally { goalsDeps.supabase = null; }
});

test('W5: a typed number - last write wins with who and when, null clears, only this week and last week, never inferred', async () => {
  const sb = seed();
  const save = (userId, body, now = NOW) => saveManual(sb, { businessId: B, userId, body, now });
  const a = await save(u('c'), { metric_key: 'linkedin_accepted', week_start: LAST, value: 12, note: ' counted  Monday ' });
  assert.equal(a.status, 200); assert.equal(a.body.metric.value, 12); assert.equal(a.body.metric.note, 'counted Monday'); assert.equal(a.body.metric.entered_by, u('c'));
  const b = await save(u('a'), { metric_key: 'linkedin_accepted', week_start: LAST, value: 15 }, NOW + 60e3);
  assert.equal(b.body.metric.value, 15); assert.equal(b.body.metric.entered_by, u('a')); assert.equal(b.body.metric.note, null);
  const rows = (await sb.from('sales_manual_metrics').select('*').eq('metric_key', 'linkedin_accepted')).data;
  assert.equal(rows.length, 1); assert.equal(rows[0].value, 15); assert.equal(rows[0].entered_at, new Date(NOW + 60e3).toISOString());
  let body = (await loadWeekly(sb, B, { now: NOW })).body;
  assert.equal(at(body, 'linkedin_accepted', LAST), 15); assert.deepEqual(of(body, 'linkedin_accepted').entered.last_week, { by: 'Ana', at: new Date(NOW + 60e3).toISOString(), note: null });
  assert.equal(at(body, 'linkedin_requests', LAST), 40); assert.equal(of(body, 'linkedin_requests').entered.last_week.by, 'Cy');
  // nobody typed it: empty, not 0 - and no pace, no same point
  assert.equal(of(body, 'linkedin_posts').this_week.to_date, null); assert.equal(at(body, 'linkedin_posts', LAST), null); assert.equal(of(body, 'linkedin_posts').entered.this_week, null);
  assert.equal(of(body, 'linkedin_requests').this_week.same_point_last_week, null); assert.equal(of(body, 'linkedin_requests').this_week.pace, null);
  const cleared = await save(u('c'), { metric_key: 'linkedin_accepted', week_start: LAST, value: null });
  assert.equal(cleared.status, 200);
  body = (await loadWeekly(sb, B, { now: NOW })).body;
  assert.equal(at(body, 'linkedin_accepted', LAST), null); assert.equal(of(body, 'linkedin_accepted').entered.last_week.by, 'Cy');
  assert.equal((await save(u('c'), { metric_key: 'linkedin_posts', week_start: MON, value: 2 })).status, 200);
  const closed = await save(u('c'), { metric_key: 'linkedin_posts', week_start: '2026-11-02', value: 2 });
  assert.equal(closed.status, 409); assert.equal(closed.body.code, 'week_closed');
  assert.equal((await save(u('c'), { metric_key: 'linkedin_posts', week_start: addDays(MON, 7), value: 2 })).status, 409);
  assert.equal((await save(u('c'), { metric_key: 'delivered', week_start: MON, value: 2 })).status, 400);
  assert.equal((await save(u('c'), { metric_key: 'linkedin_posts', week_start: '2026-11-17', value: 2 })).status, 400);
  assert.equal((await save(u('c'), { metric_key: 'linkedin_posts', week_start: MON, value: -1 })).status, 400);
  assert.equal((await save(u('c'), { metric_key: 'linkedin_posts', week_start: MON, value: '2' })).status, 400);
  assert.equal((await save(u('c'), { metric_key: 'linkedin_posts', week_start: MON, value: 2, note: 'x'.repeat(NOTE_MAX + 1) })).status, 400);
  assert.equal((await save(u('c'), { metric_key: 'linkedin_posts', week_start: MON, value: 2, note: `ask cy${String.fromCharCode(64)}example.test` })).status, 400);
  assert.equal((await save(u('c'), { metric_key: 'linkedin_posts', week_start: MON, value: 2, who: 'x' })).status, 400);
});

test('W8: the three asks route to the weekly intent alone; its lines carry the numbers and the direction; the glossary explains pace and the week', async () => {
  const vocab = mergeVocab([VOCABULARY]);
  const ids = q => salesIntents.filter(i => i.match(parseAsk(q, vocab, { today: TODAY }))).map(i => i.id);
  for (const q of ['how are we pacing this week', "what's our open rate trend", "did we hit last week's goals"]) assert.deepEqual(ids(q), ['weekly'], q);
  assert.deepEqual(ids('how are our emails doing this month'), ['emails']);
  assert.deepEqual(ids("what's our email to site rate"), ['email_site']);
  assert.ok(!ids('who visited yesterday').includes('weekly') && !ids('show me my open tasks').includes('weekly'));
  const sb = seed();
  const intent = salesIntents.find(i => i.id === 'weekly');
  const run = q => intent.run(sb, { businessId: B, ask: parseAsk(q, vocab, { today: TODAY }), now: NOW, auth: { user: { id: u('a') } }, today: TODAY });
  const all = await run('how are we pacing this week');
  assert.equal(all.read, 'goals/weekly?weeks=12 · week of 2026-11-16 · day 4 of 7');
  const d = all.items.find(x => x.id === 'delivered').text;
  assert.equal(d, 'Delivered (Outbound) · this week to date 139 · same point last week 149 · ▼ worse than the same point last week by 10 · on pace for about 243 by Sunday · goal 400, 35 % of it · last week 198 against a goal of 150: hit · earlier weeks, oldest first: 90, 80, 198');
  assert.ok(!all.items.some(x => ['total_in_sequence', 'sequences_running'].includes(x.id)));
  assert.match(all.items.find(x => x.id === 'linkedin_requests').text, /last week 40, no goal was set .* last week entered by Cy$/);
  assert.equal(all.items[all.items.length - 1].text, `${WORDING.week} ${WORDING.pace} ${WORDING.goals} ${WORDING.manual}`);
  const one = await run("what's our open rate trend");
  assert.deepEqual(one.items.map(x => x.id), ['human_open_rate', 'how']);
  assert.match(one.items[0].text, /^Human open rate \(Outbound\) · this week to date \d+\.\d % · same point last week \d+\.\d % · .*goal 20\.0 %/);
  assert.ok(!/on pace/.test(one.items[0].text));
  for (const it of [...all.items, ...one.items]) assert.ok(!hasPii(it.text), it.text);
  const { body } = await salesReads.loadWeekly(sb, B, { weeks: 12, now: NOW });
  assert.equal(weeklyLine(of(body, 'delivered'), body), d);
  const g = await glossary(seed({ sales_settings: [{ business_id: B, score_weights: null, buyer_titles: [] }] }), { businessId: B });
  const line = g.lines.find(l => l.startsWith('Weekly funnel'));
  assert.ok(line && line.includes('Monday to Sunday') && line.includes('Pace = this week to date') && line.includes('never projected') && !hasPii(line));
});
