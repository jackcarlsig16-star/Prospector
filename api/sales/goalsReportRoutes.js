import { selectAllPages } from '../lib/selectAllPages.js';
import { STAGE_ORDER } from './pipelineStages.js';
import { PARTNER_METRICS, PARTNER_FLOWS, PEOPLE_METRIC, loadPartnerData, partnerWeekMetrics, partnerReportBlock, peopleFirstTouchedInWeek } from './partnerMetrics.js';
import { huddleWeekCounts, weekEngagement } from './huddleWeek.js';
import {
  getSupabase, validate, fail, findRow, weekIsFinal, FINAL_ERROR,
  isMonday, isFirstOfMonth, addDays, laStartOfDayMs,
  SCORECARD_METRICS, KPI_METRICS, MANUAL_METRICS, HERO_METRICS,
} from './goalsShared.js';

// sales-goals-v1 REV4 Stage 4 - weekly report, scorecard, KPI table,
// companies sequenced, infra status list. Every number here is read from
// data that's already synced (Apollo tables, pipeline, manual entries) -
// zero Apollo calls. A value with no source comes back null, never guessed.

const SECTION_KEYS = Array.from({ length: 14 }, (_, i) => `s${i + 1}`);
const INFRA_STATUSES = ['completed', 'in_progress', 'blocked'];
const HERO_WEEKS = 6;
// first-touch-people-v1 - the first-touched goal row carries a unit; a week
// with no row shows the latest earlier goal as "carried" (display only).
const FIRST_TOUCHED = 'partners_first_touched';
const UNITS = ['people', 'partners'];
// Seif's "positive responses": replies that move toward a meeting
// (Jack 2026-10-02, sales-analytics-scorecard-v1 Stage 1).
const POSITIVE_REPLY_CLASSES = ['willing_to_meet', 'follow_up_question', 'person_referral'];

const KPI_ROWS = [
  ['target_orgs', 'Target organizations', 'Apollo'],
  ['dm_contacted', 'Decision-makers contacted', 'Apollo'],
  ['positive_responses', 'Positive responses', 'Apollo'],
  ['meetings_held', 'Meetings held', 'Manual'],
  ['meetings_set', 'New meetings booked', 'Manual'],
  ['qualified_opps', 'Qualified opportunities', 'Pipeline'],
  ['covered_lives_pipeline', 'Covered lives in pipeline', 'Pipeline'],
  ['proposals_outstanding', 'Proposals / pilots outstanding', 'Pipeline'],
  ['verbal_commitments', 'Verbal commitments', 'Pipeline'],
  ['contracts_signed', 'Contracts signed', 'Pipeline'],
  ['launches_90d', 'Expected 90-day launches', 'Pipeline'],
];
const SCORECARD_SOURCES = {
  outbound_audience: 'Apollo', total_in_sequence: 'Apollo', sequences_running: 'Apollo', meetings_set: 'Manual', open_rate: 'Apollo',
  ...Object.fromEntries(PARTNER_METRICS.map(k => [k, 'App'])),
  [PEOPLE_METRIC]: 'App',
};

// Mondays whose week starts inside the month (the September sheet's
// columns: Sep 7, 14, 21, 28).
function weeksOfMonth(month) {
  const first = new Date(`${month}T00:00:00Z`);
  const offset = (8 - first.getUTCDay()) % 7;
  const weeks = [];
  for (let w = addDays(month, offset); w.slice(0, 7) === month.slice(0, 7); w = addDays(w, 7)) weeks.push(w);
  return weeks;
}

// ── Computed numbers ────────────────────────────────────────────────────────
// Last synced value of a sales_metrics_daily metric inside [from, to] (LA
// dates), or null when no sync landed in that range.
async function lastSyncedValue(supabase, businessId, metricKey, from, to) {
  const { data, error } = await supabase.from('sales_metrics_daily').select('value, metric_date')
    .eq('business_id', businessId).eq('metric_key', metricKey).eq('dim_type', 'all')
    .gte('metric_date', from).lte('metric_date', to).order('metric_date', { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  return data.length ? Number(data[0].value) : null;
}

async function openRate(supabase, businessId, from, to, mailboxes) {
  const rows = await selectAllPages(() => {
    let q = supabase.from('sales_email_daily_counts').select('delivered, opened, mailbox')
      .eq('business_id', businessId).gte('day', from).lte('day', to);
    if (mailboxes) q = q.in('mailbox', mailboxes.length ? mailboxes : ['-']);
    return q.order('day').order('mailbox').order('sequence_id').order('step');
  });
  const delivered = rows.reduce((n, r) => n + (r.delivered || 0), 0);
  const opened = rows.reduce((n, r) => n + (r.opened || 0), 0);
  return delivered ? opened / delivered : null;
}

async function mailboxesFor(supabase, businessId, ownerUserId) {
  const { data, error } = await supabase.from('sales_mailbox_owners').select('mailbox_email, user_id').eq('business_id', businessId);
  if (error) throw new Error(error.message);
  return { all: data, forOwner: ownerUserId ? data.filter(m => m.user_id === ownerUserId).map(m => m.mailbox_email) : null };
}

async function sequencedRows(supabase, businessId, from, to) {
  return selectAllPages(() => supabase.from('sales_sequenced_accounts').select('*')
    .eq('business_id', businessId).gte('week_start', from).lte('week_start', to)
    .order('week_start').order('first_sequenced_at').order('account_id'));
}

function audience(rows) {
  const withEmployees = rows.filter(r => r.employees != null);
  return { value: withEmployees.reduce((n, r) => n + r.employees, 0), companies: rows.length, companies_with_employees: withEmployees.length };
}

async function manualActuals(supabase, businessId, weeks) {
  if (!weeks.length) return new Map();
  const { data, error } = await supabase.from('sales_metric_targets').select('period_start, metric_key, actual, actual_by, actual_at')
    .eq('business_id', businessId).eq('period', 'week').in('period_start', weeks).in('metric_key', MANUAL_METRICS);
  if (error) throw new Error(error.message);
  return new Map(data.map(r => [`${r.period_start}|${r.metric_key}`, r]));
}

// Scorecard actuals for one week. ownerUserId narrows outbound_audience
// (companies by mailbox owner) and open_rate (that owner's mailboxes); the
// other metrics are team-wide only. boxes = mailboxesFor(ownerUserId).
async function weekScorecard(supabase, businessId, weekStart, { all, forOwner }, manual) {
  const weekEnd = addDays(weekStart, 6);
  const [allRows, inSequence, running, rate] = await Promise.all([
    sequencedRows(supabase, businessId, weekStart, weekStart),
    lastSyncedValue(supabase, businessId, 'prospects_in_cadence', weekStart, weekEnd),
    lastSyncedValue(supabase, businessId, 'sequences_active', weekStart, weekEnd),
    openRate(supabase, businessId, weekStart, weekEnd, forOwner),
  ]);
  const rows = forOwner ? allRows.filter(r => forOwner.includes(r.mailbox_email)) : allRows;
  const meetings = manual.get(`${weekStart}|meetings_set`);
  return {
    outbound_audience: audience(rows),
    total_in_sequence: { value: inSequence },
    sequences_running: { value: running },
    meetings_set: { value: meetings?.actual ?? null, entered_by: meetings?.actual_by || null, entered_at: meetings?.actual_at || null },
    open_rate: { value: rate },
    mailboxes: all.length,
  };
}

async function targetsFor(supabase, businessId, period, starts) {
  if (!starts.length) return new Map();
  const { data, error } = await supabase.from('sales_metric_targets').select('period_start, metric_key, goal')
    .eq('business_id', businessId).eq('period', period).in('period_start', starts);
  if (error) throw new Error(error.message);
  return new Map(data.map(r => [`${r.period_start}|${r.metric_key}`, r.goal == null ? null : Number(r.goal)]));
}

// Scorecard rows (actual + week goal per metric) for any list of Mondays.
async function scorecardWeeks(supabase, businessId, weeks, ownerUserId) {
  // Independent reads, so they run together (was ~2.5 s one after another).
  const [manual, weekGoals, partnerData, boxes] = await Promise.all([
    manualActuals(supabase, businessId, weeks),
    targetsFor(supabase, businessId, 'week', weeks),
    loadPartnerData(supabase, businessId),
    mailboxesFor(supabase, businessId, ownerUserId),
  ]);
  const keys = [...SCORECARD_METRICS, ...PARTNER_METRICS, PEOPLE_METRIC];
  const weekActuals = await Promise.all(weeks.map(w => weekScorecard(supabase, businessId, w, boxes, manual)));
  return weeks.map((w, i) => {
    const actual = { ...weekActuals[i], ...partnerWeekMetrics(partnerData, w, ownerUserId) };
    return { week_start: w, metrics: Object.fromEntries(keys.map(k => [k, { ...actual[k], goal: weekGoals.get(`${w}|${k}`) ?? null }])) };
  });
}

export async function buildScorecard(supabase, businessId, month, ownerUserId) {
  const weeks = weeksOfMonth(month);
  const monthEnd = weeks.length ? addDays(weeks[weeks.length - 1], 6) : month;
  const keys = [...SCORECARD_METRICS, ...PARTNER_METRICS, PEOPLE_METRIC];
  const [perWeek, monthGoals, monthOpenRate] = await Promise.all([
    scorecardWeeks(supabase, businessId, weeks, ownerUserId),
    targetsFor(supabase, businessId, 'month', [month]),
    weeks.length ? mailboxesFor(supabase, businessId, ownerUserId).then(b => openRate(supabase, businessId, weeks[0], monthEnd, b.forOwner)) : null,
  ]);
  // Month column: sums for flows, the latest week's value for stock numbers.
  const vals = k => perWeek.map(w => w.metrics[k].value).filter(v => v != null);
  const last = k => { const v = vals(k); return v.length ? v[v.length - 1] : null; };
  const sum = k => { const v = vals(k); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
  const monthActual = {
    outbound_audience: sum('outbound_audience'),
    total_in_sequence: last('total_in_sequence'),
    sequences_running: last('sequences_running'),
    meetings_set: sum('meetings_set'),
    open_rate: monthOpenRate,
    ...Object.fromEntries(PARTNER_METRICS.map(k => [k, PARTNER_FLOWS.includes(k) ? sum(k) : last(k)])),
    [PEOPLE_METRIC]: sum(PEOPLE_METRIC),
  };
  return {
    month, owner_user_id: ownerUserId || null, weeks: perWeek,
    month_total: Object.fromEntries(keys.map(k => [k, { value: monthActual[k], goal: monthGoals.get(`${month}|${k}`) ?? null, source: SCORECARD_SOURCES[k] }])),
    sources: SCORECARD_SOURCES,
  };
}

// Pipeline stage of every opportunity as of `endMs`, rebuilt from the events
// table so editing a stage today doesn't rewrite a past week. covered_lives
// and expected_launch aren't historized - their current values are used.
async function pipelineAsOf(supabase, businessId, endMs) {
  const [opps, events] = await Promise.all([
    selectAllPages(() => supabase.from('sales_opportunities').select('id, stage, covered_lives, expected_launch, created_at')
      .eq('business_id', businessId).order('id')),
    selectAllPages(() => supabase.from('sales_opportunity_events').select('opportunity_id, event_type, to_stage, changed_at')
      .eq('business_id', businessId).lt('changed_at', new Date(endMs).toISOString()).order('changed_at').order('id')),
  ]);
  const byOpp = new Map();
  for (const e of events) { if (!byOpp.has(e.opportunity_id)) byOpp.set(e.opportunity_id, []); byOpp.get(e.opportunity_id).push(e); }
  const out = [];
  for (const o of opps) {
    const ev = byOpp.get(o.id) || [];
    if (!ev.length && Date.parse(o.created_at) >= endMs) continue;
    if (ev.some(e => e.event_type === 'archived')) continue;
    const staged = ev.filter(e => e.to_stage);
    out.push({ ...o, stage: staged.length ? staged[staged.length - 1].to_stage : o.stage });
  }
  return out;
}

async function kpiForWeek(supabase, businessId, weekStart, manual) {
  const weekEnd = addDays(weekStart, 6);
  const startMs = laStartOfDayMs(weekStart);
  const endMs = laStartOfDayMs(addDays(weekStart, 7));
  const meetingIdx = STAGE_ORDER.indexOf('meeting');
  const opps = await pipelineAsOf(supabase, businessId, endMs);
  const active = opps.filter(o => o.stage !== 'lost');
  const qualified = active.filter(o => STAGE_ORDER.indexOf(o.stage) >= meetingIdx);
  const { count: contracts, error: cErr } = await supabase.from('sales_opportunity_events').select('id', { count: 'exact', head: true })
    .eq('business_id', businessId).eq('event_type', 'stage_change').eq('to_stage', 'contract')
    .gte('changed_at', new Date(startMs).toISOString()).lt('changed_at', new Date(endMs).toISOString());
  if (cErr) throw new Error(cErr.message);
  const { count: positive, error: pErr } = await supabase.from('sales_email_messages').select('apollo_message_id', { count: 'exact', head: true })
    .eq('business_id', businessId).eq('replied', true).in('reply_class', POSITIVE_REPLY_CLASSES)
    .gte('delivered_at', new Date(startMs).toISOString()).lt('delivered_at', new Date(endMs).toISOString());
  if (pErr) throw new Error(pErr.message);
  const launchBy = addDays(weekEnd, 90);
  return {
    target_orgs: await lastSyncedValue(supabase, businessId, 'companies_in_cadence', weekStart, weekEnd),
    dm_contacted: await lastSyncedValue(supabase, businessId, 'prospects_in_cadence', weekStart, weekEnd),
    positive_responses: positive,
    meetings_held: manual.get(`${weekStart}|meetings_held`)?.actual ?? null,
    meetings_set: manual.get(`${weekStart}|meetings_set`)?.actual ?? null,
    qualified_opps: qualified.length,
    covered_lives_pipeline: qualified.reduce((n, o) => n + (o.covered_lives || 0), 0),
    proposals_outstanding: active.filter(o => o.stage === 'proposal_pilot').length,
    verbal_commitments: active.filter(o => o.stage === 'verbal').length,
    contracts_signed: contracts,
    launches_90d: active.filter(o => o.expected_launch && o.expected_launch > weekEnd && o.expected_launch <= launchBy).length,
  };
}

// KPI targets carry forward: the latest week target at or before the week.
async function kpiTargets(supabase, businessId, weekStart) {
  const { data, error } = await supabase.from('sales_metric_targets').select('period_start, metric_key, goal')
    .eq('business_id', businessId).eq('period', 'week').in('metric_key', [...KPI_METRICS, 'meetings_set'])
    .lte('period_start', weekStart).not('goal', 'is', null).order('period_start', { ascending: false });
  if (error) throw new Error(error.message);
  const out = {};
  for (const r of data) if (!(r.metric_key in out)) out[r.metric_key] = Number(r.goal);
  return out;
}

export async function buildKpi(supabase, businessId, weekStart) {
  const lastWeek = addDays(weekStart, -7);
  const manual = await manualActuals(supabase, businessId, [lastWeek, weekStart]);
  const [prev, now, targets] = await Promise.all([
    kpiForWeek(supabase, businessId, lastWeek, manual),
    kpiForWeek(supabase, businessId, weekStart, manual),
    kpiTargets(supabase, businessId, weekStart),
  ]);
  return KPI_ROWS.map(([key, label, source]) => ({
    key, label, source, last_week: prev[key], this_week: now[key],
    change: prev[key] != null && now[key] != null ? now[key] - prev[key] : null,
    target: targets[key] ?? null,
  }));
}

async function commitmentProgress(supabase, businessId, weekStart) {
  const goals = await selectAllPages(() => supabase.from('sales_week_goals').select('*')
    .eq('business_id', businessId).eq('week_start', weekStart).eq('kind', 'commitment').order('sort_order').order('id'));
  const needsScorecard = goals.some(g => g.metric_key);
  const actual = needsScorecard ? await weekScorecard(supabase, businessId, weekStart, ...await Promise.all([
    mailboxesFor(supabase, businessId, null), manualActuals(supabase, businessId, [weekStart]),
  ])) : null;
  return goals.map(g => ({
    id: g.id, text: g.text, owner_user_id: g.owner_user_id, status: g.status, link_target: g.link_target,
    metric_key: g.metric_key, target_value: g.target_value == null ? null : Number(g.target_value),
    progress: g.metric_key ? actual[g.metric_key].value : null,
  }));
}

// ── Scorecard / KPI / companies endpoints ───────────────────────────────────
// GET /goals/scorecard?month=YYYY-MM-01&owner=<user id>
export async function scorecardRoute(req, res) {
  const { month, owner } = req.query;
  if (!isFirstOfMonth(month)) return res.status(400).json({ error: 'month must be YYYY-MM-01' });
  const supabase = getSupabase();
  try {
    if (owner) {
      const v = await validate(supabase, req.params.businessId, { owner: { kind: 'member' } }, { owner });
      if (v.error) return fail(res, v);
    }
    res.json(await buildScorecard(supabase, req.params.businessId, month, owner || null));
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// GET /goals/kpi?week_start=<Monday>
export async function kpiRoute(req, res) {
  const { week_start } = req.query;
  if (!isMonday(week_start)) return res.status(400).json({ error: 'week_start must be a Monday (YYYY-MM-DD)' });
  try {
    res.json({ week_start, rows: await buildKpi(getSupabase(), req.params.businessId, week_start) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// GET /goals/companies?from=<Monday>&to=<Monday> - companies whose first
// step-1 send fell in those weeks, with cohort (from the sequence) and the
// member who owns the sending mailbox.
export async function listCompaniesRoute(req, res) {
  const { from, to } = req.query;
  if (!isMonday(from) || !isMonday(to) || from > to) return res.status(400).json({ error: 'from and to must be Mondays (YYYY-MM-DD) with from <= to' });
  const businessId = req.params.businessId;
  const supabase = getSupabase();
  try {
    const [rows, { all }, snap] = await Promise.all([
      sequencedRows(supabase, businessId, from, to),
      mailboxesFor(supabase, businessId),
      supabase.from('sales_raw_snapshots').select('payload').eq('business_id', businessId).eq('entity', 'sequences')
        .order('captured_at', { ascending: false }).limit(1),
    ]);
    if (snap.error) throw new Error(snap.error.message);
    const cohortById = new Map(((snap.data[0] && snap.data[0].payload) || []).map(s => [s.id, s.cohort || null]));
    const ownerByMailbox = new Map(all.map(m => [m.mailbox_email, m.user_id]));
    const companies = rows.map(r => ({
      account_id: r.account_id, name: r.name, employees: r.employees, week_start: r.week_start,
      first_sequenced_at: r.first_sequenced_at, sequence_id: r.sequence_id,
      cohort: cohortById.get(r.sequence_id) || null, mailbox_email: r.mailbox_email,
      sequenced_by: ownerByMailbox.get(r.mailbox_email) || null,
      employees_updated_by: r.employees_updated_by, employees_updated_at: r.employees_updated_at,
    }));
    res.json({ companies, total: audience(rows) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// PATCH /goals/companies/:accountId { employees } - headcount is typed in;
// Apollo has no 0-credit employee count.
export async function updateCompanyRoute(req, res) {
  const keys = Object.keys(req.body || {});
  const unknown = keys.find(k => k !== 'employees');
  if (unknown) return res.status(400).json({ error: `unknown field: ${unknown}` });
  const employees = req.body?.employees;
  if (employees !== null && !(Number.isInteger(employees) && employees >= 0)) return res.status(400).json({ error: 'employees must be a whole number >= 0 or null' });
  const { data, error } = await getSupabase().from('sales_sequenced_accounts')
    .update({ employees, employees_updated_by: req.auth.user.id, employees_updated_at: new Date().toISOString() })
    .eq('business_id', req.params.businessId).eq('account_id', req.params.accountId).select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'company not found' });
  res.json({ company: data });
}

// ── Targets and manual values ───────────────────────────────────────────────
// GET /goals/targets?period=week|month&from=&to=
export async function listTargetsRoute(req, res) {
  const { period, from, to } = req.query;
  const ok = period === 'week' ? isMonday(from) && isMonday(to) : period === 'month' ? isFirstOfMonth(from) && isFirstOfMonth(to) : false;
  if (!ok || from > to) return res.status(400).json({ error: 'period must be week|month with from/to as Mondays (week) or 1sts (month), from <= to' });
  try {
    const targets = await selectAllPages(() => getSupabase().from('sales_metric_targets').select('*')
      .eq('business_id', req.params.businessId).eq('period', period).gte('period_start', from).lte('period_start', to)
      .order('period_start').order('metric_key'));
    res.json({ targets });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// PUT /goals/targets { period, period_start, metric_key, goal?, actual? }
// actual is only accepted for manual metrics (meetings).
export async function saveTargetRoute(req, res) {
  const allowed = ['period', 'period_start', 'metric_key', 'goal', 'actual', 'unit'];
  const unknown = Object.keys(req.body || {}).find(k => !allowed.includes(k));
  if (unknown) return res.status(400).json({ error: `unknown field: ${unknown}` });
  const { period, period_start, metric_key } = req.body || {};
  if (!['week', 'month'].includes(period)) return res.status(400).json({ error: 'bad enum: period must be week|month' });
  if (period === 'week' ? !isMonday(period_start) : !isFirstOfMonth(period_start)) return res.status(400).json({ error: `period_start must be a ${period === 'week' ? 'Monday' : '1st of a month'} (YYYY-MM-DD)` });
  const metrics = [...SCORECARD_METRICS, ...KPI_METRICS, ...PARTNER_METRICS, ...HERO_METRICS];
  if (!metrics.includes(metric_key)) return res.status(400).json({ error: `bad enum: metric_key must be one of ${metrics.join('|')}` });
  const num = v => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0);
  if ('goal' in req.body && !num(req.body.goal)) return res.status(400).json({ error: 'goal must be a number >= 0 or null' });
  if ('actual' in req.body) {
    if (!MANUAL_METRICS.includes(metric_key) || period !== 'week') return res.status(400).json({ error: `actual can only be set for ${MANUAL_METRICS.join(', ')} per week - other numbers are computed` });
    if (!num(req.body.actual)) return res.status(400).json({ error: 'actual must be a number >= 0 or null' });
  }
  if (!('goal' in req.body) && !('actual' in req.body)) return res.status(400).json({ error: 'send goal and/or actual' });
  if ('unit' in req.body && (metric_key !== FIRST_TOUCHED || period !== 'week' || !UNITS.includes(req.body.unit))) {
    return res.status(400).json({ error: `unit (${UNITS.join('|')}) only applies to the weekly ${FIRST_TOUCHED} goal` });
  }
  const supabase = getSupabase();
  try {
    if (period === 'week' && await weekIsFinal(supabase, req.params.businessId, period_start)) return res.status(409).json({ error: FINAL_ERROR });
  } catch (e) { return res.status(500).json({ error: e.message }); }
  const now = new Date().toISOString();
  const row = { business_id: req.params.businessId, period, period_start, metric_key, updated_by: req.auth.user.id, updated_at: now };
  if ('goal' in req.body) row.goal = req.body.goal;
  if ('unit' in req.body) row.unit = req.body.unit;
  if ('actual' in req.body) Object.assign(row, { actual: req.body.actual, actual_by: req.auth.user.id, actual_at: now });
  const { data, error } = await supabase.from('sales_metric_targets')
    .upsert(row, { onConflict: 'business_id,period,period_start,metric_key' }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ target: data });
}

// ── Weekly report ───────────────────────────────────────────────────────────
// GET /goals/report?week_start=<Monday> - status, section notes, infra list
// and commitments with live progress. A final week returns its frozen
// snapshot alongside.
export async function getReportRoute(req, res) {
  const { week_start } = req.query;
  if (!isMonday(week_start)) return res.status(400).json({ error: 'week_start must be a Monday (YYYY-MM-DD)' });
  const businessId = req.params.businessId;
  const supabase = getSupabase();
  try {
    const [{ data: report, error: rErr }, sections, infra, commitments, partnerData, huddle] = await Promise.all([
      supabase.from('sales_week_report').select('*').eq('business_id', businessId).eq('week_start', week_start).maybeSingle(),
      selectAllPages(() => supabase.from('sales_week_report_sections').select('*').eq('business_id', businessId).eq('week_start', week_start).order('section_key')),
      selectAllPages(() => supabase.from('sales_infra_items').select('*').eq('business_id', businessId).eq('week_start', week_start).order('sort_order').order('created_at').order('id')),
      commitmentProgress(supabase, businessId, week_start),
      loadPartnerData(supabase, businessId),
      huddleWeekCounts(supabase, businessId, week_start),
    ]);
    if (rErr) throw new Error(rErr.message);
    res.json({
      week_start,
      report: report || { status: 'draft', snapshot: null, finalized_at: null, finalized_by: null, reopened_at: null, reopened_by: null },
      sections, infra, commitments,
      partners: partnerReportBlock(partnerData, week_start),
      huddle,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// PUT /goals/report/:weekStart/sections/:key { notes }
export async function saveSectionRoute(req, res) {
  const { weekStart, key } = req.params;
  if (!isMonday(weekStart)) return res.status(400).json({ error: 'week must be a Monday (YYYY-MM-DD)' });
  if (!SECTION_KEYS.includes(key)) return res.status(400).json({ error: `section must be one of ${SECTION_KEYS.join('|')}` });
  const unknown = Object.keys(req.body || {}).find(k => k !== 'notes');
  if (unknown) return res.status(400).json({ error: `unknown field: ${unknown}` });
  if (typeof req.body?.notes !== 'string') return res.status(400).json({ error: 'notes must be a string' });
  const supabase = getSupabase();
  try {
    if (await weekIsFinal(supabase, req.params.businessId, weekStart)) return res.status(409).json({ error: FINAL_ERROR });
  } catch (e) { return res.status(500).json({ error: e.message }); }
  const { data, error } = await supabase.from('sales_week_report_sections').upsert({
    business_id: req.params.businessId, week_start: weekStart, section_key: key, notes: req.body.notes,
    updated_by: req.auth.user.id, updated_at: new Date().toISOString(),
  }, { onConflict: 'business_id,week_start,section_key' }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ section: data });
}

// POST /goals/report/:weekStart/sections/:key/append { line } - adds a line
// under the section's existing notes (call-notes-to-tasks-v1: the call
// summary as a §1 draft line). Done server-side so the read and the write
// are milliseconds apart rather than a whole screen's lifetime.
export async function appendSectionRoute(req, res) {
  const { weekStart, key } = req.params;
  if (!isMonday(weekStart)) return res.status(400).json({ error: 'week must be a Monday (YYYY-MM-DD)' });
  if (!SECTION_KEYS.includes(key)) return res.status(400).json({ error: `section must be one of ${SECTION_KEYS.join('|')}` });
  const unknown = Object.keys(req.body || {}).find(k => k !== 'line');
  if (unknown) return res.status(400).json({ error: `unknown field: ${unknown}` });
  const line = typeof req.body?.line === 'string' ? req.body.line.trim() : '';
  if (!line || line.length > 2000) return res.status(400).json({ error: 'line must be 1-2000 characters' });
  const businessId = req.params.businessId;
  const supabase = getSupabase();
  try {
    if (await weekIsFinal(supabase, businessId, weekStart)) return res.status(409).json({ error: FINAL_ERROR });
    const { data: current, error: rErr } = await supabase.from('sales_week_report_sections').select('notes')
      .eq('business_id', businessId).eq('week_start', weekStart).eq('section_key', key).maybeSingle();
    if (rErr) throw new Error(rErr.message);
    const before = (current?.notes || '').replace(/\s+$/, '');
    if (before.split('\n').some(l => l.trim() === line)) return res.json({ section: current, already: true });
    const { data, error } = await supabase.from('sales_week_report_sections').upsert({
      business_id: businessId, week_start: weekStart, section_key: key, notes: before ? `${before}\n${line}` : line,
      updated_by: req.auth.user.id, updated_at: new Date().toISOString(),
    }, { onConflict: 'business_id,week_start,section_key' }).select().single();
    if (error) throw new Error(error.message);
    res.json({ section: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// POST /goals/report/:weekStart/finalize - freezes scorecard (the week's
// month), KPI table, commitments with progress, section notes, infra list
// and partner numbers. Later edits to live data never change the snapshot.
export async function finalizeReportRoute(req, res) {
  const { weekStart } = req.params;
  if (!isMonday(weekStart)) return res.status(400).json({ error: 'week must be a Monday (YYYY-MM-DD)' });
  const businessId = req.params.businessId;
  const supabase = getSupabase();
  try {
    if (await weekIsFinal(supabase, businessId, weekStart)) return res.status(409).json({ error: 'This week is already finalized' });
    const [scorecard, kpi, commitments, sections, infra, partnerData, huddle] = await Promise.all([
      buildScorecard(supabase, businessId, `${weekStart.slice(0, 7)}-01`, null),
      buildKpi(supabase, businessId, weekStart),
      commitmentProgress(supabase, businessId, weekStart),
      selectAllPages(() => supabase.from('sales_week_report_sections').select('section_key, notes').eq('business_id', businessId).eq('week_start', weekStart).order('section_key')),
      selectAllPages(() => supabase.from('sales_infra_items').select('component, status, note').eq('business_id', businessId).eq('week_start', weekStart).order('sort_order').order('id')),
      loadPartnerData(supabase, businessId),
      huddleWeekCounts(supabase, businessId, weekStart),
    ]);
    const now = new Date().toISOString();
    const { data, error } = await supabase.from('sales_week_report').upsert({
      business_id: businessId, week_start: weekStart, status: 'final',
      snapshot: { taken_at: now, scorecard, kpi, commitments, sections, infra, partners: partnerReportBlock(partnerData, weekStart), huddle },
      finalized_at: now, finalized_by: req.auth.user.id, updated_at: now,
    }, { onConflict: 'business_id,week_start' }).select().single();
    if (error) throw new Error(error.message);
    res.json({ report: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// POST /goals/report/:weekStart/reopen - back to draft, who/when recorded.
// The last snapshot stays on the row until the next finalize replaces it.
export async function reopenReportRoute(req, res) {
  const { weekStart } = req.params;
  if (!isMonday(weekStart)) return res.status(400).json({ error: 'week must be a Monday (YYYY-MM-DD)' });
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('sales_week_report')
    .update({ status: 'draft', reopened_at: now, reopened_by: req.auth.user.id, updated_at: now })
    .eq('business_id', req.params.businessId).eq('week_start', weekStart).eq('status', 'final').select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(409).json({ error: 'This week is not finalized' });
  res.json({ report: data });
}

// ── Section 2 infrastructure list ───────────────────────────────────────────
const INFRA_FIELDS = {
  week_start: { kind: 'monday' }, component: { kind: 'required' },
  status: { kind: 'enum', values: INFRA_STATUSES }, note: { kind: 'text' }, sort_order: { kind: 'int' },
};

export async function createInfraRoute(req, res) {
  const supabase = getSupabase();
  const v = await validate(supabase, req.params.businessId, INFRA_FIELDS, req.body);
  if (v.error) return fail(res, v);
  if (!v.payload.week_start) return res.status(400).json({ error: 'week_start is required' });
  if (!v.payload.component) return res.status(400).json({ error: 'component is required' });
  try {
    if (await weekIsFinal(supabase, req.params.businessId, v.payload.week_start)) return res.status(409).json({ error: FINAL_ERROR });
  } catch (e) { return res.status(500).json({ error: e.message }); }
  const { data, error } = await supabase.from('sales_infra_items').insert({ business_id: req.params.businessId, ...v.payload }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ item: data });
}

async function infraOr404(supabase, res, businessId, id) {
  const { data, error } = await findRow(supabase, 'sales_infra_items', businessId, id);
  if (error) { res.status(500).json({ error: error.message }); return null; }
  if (!data) { res.status(404).json({ error: 'item not found' }); return null; }
  if (await weekIsFinal(supabase, businessId, data.week_start)) { res.status(409).json({ error: FINAL_ERROR }); return null; }
  return data;
}

export async function updateInfraRoute(req, res) {
  const supabase = getSupabase();
  try {
    const item = await infraOr404(supabase, res, req.params.businessId, req.params.id);
    if (!item) return;
    const v = await validate(supabase, req.params.businessId, INFRA_FIELDS, req.body);
    if (v.error) return fail(res, v);
    if (v.payload.week_start && v.payload.week_start !== item.week_start) return res.status(400).json({ error: "week_start can't change - carry the item forward instead" });
    const { data, error } = await supabase.from('sales_infra_items')
      .update({ ...v.payload, updated_at: new Date().toISOString() }).eq('id', item.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ item: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export async function deleteInfraRoute(req, res) {
  const supabase = getSupabase();
  try {
    const item = await infraOr404(supabase, res, req.params.businessId, req.params.id);
    if (!item) return;
    const { error } = await supabase.from('sales_infra_items').delete().eq('id', item.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ deleted: item.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// POST /goals/infra/carry-forward { week_start } - copies last week's items
// that aren't completed. Idempotent via sales_infra_items_carry_once.
export async function carryForwardInfraRoute(req, res) {
  const weekStart = req.body?.week_start;
  if (!isMonday(weekStart)) return res.status(400).json({ error: 'week_start must be a Monday (YYYY-MM-DD)' });
  const businessId = req.params.businessId;
  const supabase = getSupabase();
  try {
    if (await weekIsFinal(supabase, businessId, weekStart)) return res.status(409).json({ error: FINAL_ERROR });
    const [previous, already] = await Promise.all([
      selectAllPages(() => supabase.from('sales_infra_items').select('*').eq('business_id', businessId)
        .eq('week_start', addDays(weekStart, -7)).neq('status', 'completed').order('sort_order').order('id')),
      selectAllPages(() => supabase.from('sales_infra_items').select('carried_from_id').eq('business_id', businessId)
        .eq('week_start', weekStart).not('carried_from_id', 'is', null).order('id')),
    ]);
    const done = new Set(already.map(r => r.carried_from_id));
    const carried = [];
    for (const item of previous.filter(i => !done.has(i.id))) {
      const { data, error } = await supabase.from('sales_infra_items').insert({
        business_id: businessId, week_start: weekStart, component: item.component, status: item.status,
        note: item.note, sort_order: item.sort_order, carried_from_id: item.id,
      }).select().single();
      if (error?.code === '23505') continue;
      if (error) throw new Error(error.message);
      carried.push(data);
    }
    res.json({ carried, skipped: previous.length - carried.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// GET /goals/hero?week_start=<Monday>&owner=<user id>&skip_month=1 -
// everything the goal hero needs for its 6 weeks in one call
// (goals-surface-v1, FIX-A): this month's scorecard, scorecard rows for the
// earlier weeks only (not their whole months), real clicks + replies per week
// (team-wide) and the week targets. Goals passes skip_month=1 because it has
// already loaded this month's scorecard.
export async function heroRoute(req, res) {
  const { week_start, owner, skip_month } = req.query;
  if (!isMonday(week_start)) return res.status(400).json({ error: 'week_start must be a Monday (YYYY-MM-DD)' });
  const businessId = req.params.businessId;
  const month = `${week_start.slice(0, 7)}-01`;
  const weeks = Array.from({ length: HERO_WEEKS }, (_, i) => addDays(week_start, (i - HERO_WEEKS + 1) * 7));
  const supabase = getSupabase();
  try {
    if (owner) {
      const v = await validate(supabase, businessId, { owner: { kind: 'member' } }, { owner });
      if (v.error) return fail(res, v);
    }
    const [scorecard, earlier, engagement, targets, ftRow, partnerData] = await Promise.all([
      skip_month === '1' ? null : buildScorecard(supabase, businessId, month, owner || null),
      scorecardWeeks(supabase, businessId, weeks.filter(w => w < month), owner || null),
      Promise.all(weeks.map(w => weekEngagement(supabase, businessId, w))),
      selectAllPages(() => supabase.from('sales_metric_targets').select('period_start, metric_key, goal')
        .eq('business_id', businessId).eq('period', 'week').in('metric_key', HERO_METRICS)
        .gte('period_start', weeks[0]).lte('period_start', week_start).order('period_start').order('metric_key')),
      supabase.from('sales_metric_targets').select('period_start, goal, unit')
        .eq('business_id', businessId).eq('period', 'week').eq('metric_key', FIRST_TOUCHED).lte('period_start', week_start).not('goal', 'is', null)
        .order('period_start', { ascending: false }).limit(1).maybeSingle().then(r => { if (r.error) throw new Error(r.error.message); return r.data; }),
      loadPartnerData(supabase, businessId),
    ]);
    const first_touched = {
      unit: ftRow?.unit || 'people', goal: ftRow ? Number(ftRow.goal) : null, carried: !!ftRow && ftRow.period_start !== week_start,
      people: peopleFirstTouchedInWeek(partnerData, week_start, owner || null),
    };
    res.json({ scorecard, earlier, engagement: weeks.map((w, i) => ({ week_start: w, ...engagement[i] })), targets, first_touched });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
