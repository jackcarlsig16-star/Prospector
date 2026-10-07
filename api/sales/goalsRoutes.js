import { selectAllPages } from '../lib/selectAllPages.js';
import {
  getSupabase, validate, fail, findRow, weekIsFinal, FINAL_ERROR,
  isMonday, isFirstOfMonth, addDays, SCORECARD_METRICS, LINK_TARGETS,
} from './goalsShared.js';
import { PIPELINE_STATUS_IDS, TIERS, isStalePartner } from '../../src/constants/partnerPipeline.js';
import { laDateString } from './laDate.js';

// sales-goals-v1 - Goals & Weekly Plan API (REV3 Stage 2, extended in REV4
// Stage 4). Weekly report, scorecard, KPI and companies live in
// goalsReportRoutes.js.

const GOAL_TYPES = ['company', 'partnership'];
const LAND_STATUSES = ['not_started', 'in_progress', 'landed', 'paused', 'lost'];
const MONTH_STATUSES = ['not_started', 'in_progress', 'done', 'dropped'];
const WEEK_STATUSES = ['open', 'done', 'dropped'];
const WEEK_KINDS = ['commitment', 'todo'];

const LAND_FIELDS = {
  goal_type: { kind: 'enum', values: GOAL_TYPES }, name: { kind: 'required' },
  status: { kind: 'enum', values: LAND_STATUSES }, owner_user_id: { kind: 'member' },
  target_date: { kind: 'date' }, priority: { kind: 'priority' }, est_covered_lives: { kind: 'int' },
  company_domain: { kind: 'text' }, notes: { kind: 'text' },
  linked_opportunity_id: { kind: 'ref', table: 'sales_opportunities' },
  meeting_status: { kind: 'text' }, champion: { kind: 'text' }, angle: { kind: 'text' }, motto: { kind: 'text' },
  watch_outs: { kind: 'text' }, first_email: { kind: 'text' }, first_email_note: { kind: 'text' }, sources: { kind: 'text' },
  // sales-partners-pipeline-v1. pipeline_status, hot, snoozed_until and the
  // touch stamps change only through partner signals (partnerSignals.js), so
  // every change has a history row.
  category: { kind: 'text' }, tier: { kind: 'nullableEnum', values: TIERS }, partner_role: { kind: 'text' },
  known_contacts: { kind: 'text' }, target_titles: { kind: 'text' }, sequence_to_use: { kind: 'text' },
  next_step: { kind: 'text' }, do_not_say: { kind: 'text' },
};
const MONTH_FIELDS = {
  month: { kind: 'month' }, text: { kind: 'required' }, owner_user_id: { kind: 'member' },
  measurable_target: { kind: 'text' }, status: { kind: 'enum', values: MONTH_STATUSES },
  progress_note: { kind: 'text' }, sort_order: { kind: 'int' },
};
const WEEK_FIELDS = {
  week_start: { kind: 'monday' }, text: { kind: 'required' }, owner_user_id: { kind: 'member' },
  measurable_target: { kind: 'text' }, status: { kind: 'enum', values: WEEK_STATUSES },
  why_not_done: { kind: 'text' }, sort_order: { kind: 'int' },
  month_goal_id: { kind: 'ref', table: 'sales_month_goals' },
  land_goal_id: { kind: 'ref', table: 'sales_goals' },
  kind: { kind: 'enum', values: WEEK_KINDS }, category: { kind: 'text' }, contacts: { kind: 'textArray' },
  link_target: { kind: 'nullableEnum', values: LINK_TARGETS },
  metric_key: { kind: 'nullableEnum', values: SCORECARD_METRICS }, target_value: { kind: 'number' },
};
const STEP_FIELDS = { text: { kind: 'required' }, done: { kind: 'bool' }, sort_order: { kind: 'int' } };
const CADENCE_FIELDS = {
  week_start: { kind: 'monday' }, name: { kind: 'required' }, owner_user_id: { kind: 'member' }, sort_order: { kind: 'int' },
};

// Status-driven timestamps, so the client never sets them.
function landTimestamps(payload, existing) {
  if (!('status' in payload)) return {};
  if (payload.status === 'landed') return { landed_at: existing?.landed_at || new Date().toISOString() };
  return { landed_at: null };
}
function weekTimestamps(payload, existing) {
  if (!('status' in payload)) return {};
  if (payload.status === 'done') return { completed_at: existing?.completed_at || new Date().toISOString() };
  return { completed_at: null };
}

// ── Members (owner pickers, person filter) ──────────────────────────────────
// Names only - viewers can read this, so no emails.
export async function listGoalMembersRoute(req, res) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('business_members')
    .select('user_id, role, name, profile:profiles!business_members_user_id_fkey(display_name)')
    .eq('business_id', req.params.businessId).not('user_id', 'is', null).order('created_at');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ members: data.map(m => ({ user_id: m.user_id, role: m.role, name: m.profile?.display_name || m.name })) });
}

// ── Companies / Partnerships to Land (sales_goals) ──────────────────────────
// GET /goals/land?goal_type=&include_archived=true
//   partner filters: category=&tier=&owner_user_id=&pipeline_status=&hot=true&stale=true
export async function listLandGoalsRoute(req, res) {
  const { goal_type, include_archived, category, tier, owner_user_id, pipeline_status, hot, stale } = req.query;
  if (goal_type && !GOAL_TYPES.includes(goal_type)) return res.status(400).json({ error: `bad enum: goal_type must be one of ${GOAL_TYPES.join('|')}` });
  if (tier && !TIERS.includes(tier)) return res.status(400).json({ error: `bad enum: tier must be one of ${TIERS.join('|')}` });
  if (pipeline_status && !PIPELINE_STATUS_IDS.includes(pipeline_status)) return res.status(400).json({ error: `bad enum: pipeline_status must be one of ${PIPELINE_STATUS_IDS.join('|')}` });
  const supabase = getSupabase();
  try {
    let goals = await selectAllPages(() => {
      let q = supabase.from('sales_goals').select('*').eq('business_id', req.params.businessId);
      if (goal_type) q = q.eq('goal_type', goal_type);
      if (include_archived !== 'true') q = q.is('archived_at', null);
      if (category) q = q.eq('category', category);
      if (tier) q = q.eq('tier', tier);
      if (owner_user_id) q = q.eq('owner_user_id', owner_user_id);
      if (pipeline_status) q = q.eq('pipeline_status', pipeline_status);
      if (hot === 'true') q = q.eq('hot', true);
      return q.order('created_at').order('id');
    });
    if (stale === 'true') { const now = Date.now(), today = laDateString(); goals = goals.filter(g => isStalePartner(g, now, today)); }
    res.json({ goals });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export async function createLandGoalRoute(req, res) {
  const supabase = getSupabase();
  const v = await validate(supabase, req.params.businessId, LAND_FIELDS, req.body);
  if (v.error) return fail(res, v);
  if (!v.payload.goal_type) return res.status(400).json({ error: 'goal_type is required' });
  if (!v.payload.name) return res.status(400).json({ error: 'name is required' });
  const { data, error } = await supabase.from('sales_goals')
    .insert({ business_id: req.params.businessId, ...v.payload, ...landTimestamps(v.payload), ...(v.payload.goal_type === 'partnership' ? { pipeline_status: 'not_started' } : {}) }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ goal: data });
}

export async function updateLandGoalRoute(req, res) {
  const supabase = getSupabase();
  const { data: existing, error: findErr } = await findRow(supabase, 'sales_goals', req.params.businessId, req.params.id);
  if (findErr) return res.status(500).json({ error: findErr.message });
  if (!existing) return res.status(404).json({ error: 'goal not found' });
  const v = await validate(supabase, req.params.businessId, LAND_FIELDS, req.body);
  if (v.error) return fail(res, v);
  // A partner's owner changes only through the 👤 Assign signal, so it's logged.
  if (existing.goal_type === 'partnership' && 'owner_user_id' in v.payload) {
    return res.status(400).json({ error: 'owner_user_id: use the partner Assign action (POST /goals/partners/:id/signal)' });
  }
  const { data, error } = await supabase.from('sales_goals')
    .update({ ...v.payload, ...landTimestamps(v.payload, existing), updated_at: new Date().toISOString() })
    .eq('id', existing.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ goal: data });
}

// POST /goals/land/:id/archive  body { archived: false } to restore
export async function archiveLandGoalRoute(req, res) {
  const supabase = getSupabase();
  const { data: existing, error: findErr } = await findRow(supabase, 'sales_goals', req.params.businessId, req.params.id);
  if (findErr) return res.status(500).json({ error: findErr.message });
  if (!existing) return res.status(404).json({ error: 'goal not found' });
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('sales_goals')
    .update({ archived_at: req.body?.archived === false ? null : now, updated_at: now })
    .eq('id', existing.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ goal: data });
}

// ── Monthly goals (REV3; kept, unused by the REV4 UI) ───────────────────────
// GET /goals/month?from=YYYY-MM-01&to=YYYY-MM-01 (inclusive)
export async function listMonthGoalsRoute(req, res) {
  const { from, to } = req.query;
  if (!isFirstOfMonth(from) || !isFirstOfMonth(to) || from > to) return res.status(400).json({ error: 'from and to must be YYYY-MM-01 with from <= to' });
  const supabase = getSupabase();
  try {
    const goals = await selectAllPages(() => supabase.from('sales_month_goals').select('*')
      .eq('business_id', req.params.businessId).gte('month', from).lte('month', to)
      .order('month').order('sort_order').order('created_at').order('id'));
    res.json({ goals });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export async function createMonthGoalRoute(req, res) {
  const supabase = getSupabase();
  const v = await validate(supabase, req.params.businessId, MONTH_FIELDS, req.body);
  if (v.error) return fail(res, v);
  if (!v.payload.month) return res.status(400).json({ error: 'month is required' });
  if (!v.payload.text) return res.status(400).json({ error: 'text is required' });
  const { data, error } = await supabase.from('sales_month_goals')
    .insert({ business_id: req.params.businessId, ...v.payload }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ goal: data });
}

export async function updateMonthGoalRoute(req, res) {
  const supabase = getSupabase();
  const { data: existing, error: findErr } = await findRow(supabase, 'sales_month_goals', req.params.businessId, req.params.id);
  if (findErr) return res.status(500).json({ error: findErr.message });
  if (!existing) return res.status(404).json({ error: 'goal not found' });
  const v = await validate(supabase, req.params.businessId, MONTH_FIELDS, req.body);
  if (v.error) return fail(res, v);
  const { data, error } = await supabase.from('sales_month_goals')
    .update({ ...v.payload, updated_at: new Date().toISOString() }).eq('id', existing.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ goal: data });
}

// Month and week goals have no archived_at - "dropped" is the soft state,
// delete is for mistakes. Linked week goals keep existing (FK SET NULL).
export async function deleteMonthGoalRoute(req, res) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('sales_month_goals').delete()
    .eq('business_id', req.params.businessId).eq('id', req.params.id).select('id');
  if (error) return res.status(500).json({ error: error.message });
  if (!data.length) return res.status(404).json({ error: 'goal not found' });
  res.json({ deleted: data[0].id });
}

// ── Weekly goals: commitments and to-dos ────────────────────────────────────
// GET /goals/week?from=<Monday>&to=<Monday>&kind=commitment|todo
// Each goal comes with its steps (to-dos use them; commitments have none).
export async function listWeekGoalsRoute(req, res) {
  const { from, to, kind } = req.query;
  if (!isMonday(from) || !isMonday(to) || from > to) return res.status(400).json({ error: 'from and to must be Mondays (YYYY-MM-DD) with from <= to' });
  if (kind && !WEEK_KINDS.includes(kind)) return res.status(400).json({ error: `bad enum: kind must be one of ${WEEK_KINDS.join('|')}` });
  const supabase = getSupabase();
  try {
    const goals = await selectAllPages(() => {
      let q = supabase.from('sales_week_goals').select('*, steps:sales_week_goal_steps(*)')
        .eq('business_id', req.params.businessId).gte('week_start', from).lte('week_start', to);
      if (kind) q = q.eq('kind', kind);
      return q.order('week_start').order('sort_order').order('created_at').order('id');
    });
    for (const g of goals) g.steps.sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
    res.json({ goals });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export async function createWeekGoalRoute(req, res) {
  const supabase = getSupabase();
  const v = await validate(supabase, req.params.businessId, WEEK_FIELDS, req.body);
  if (v.error) return fail(res, v);
  if (!v.payload.week_start) return res.status(400).json({ error: 'week_start is required' });
  if (!v.payload.text) return res.status(400).json({ error: 'text is required' });
  try {
    if (await weekIsFinal(supabase, req.params.businessId, v.payload.week_start)) return res.status(409).json({ error: FINAL_ERROR });
  } catch (e) { return res.status(500).json({ error: e.message }); }
  const { data, error } = await supabase.from('sales_week_goals')
    .insert({ business_id: req.params.businessId, ...v.payload, ...weekTimestamps(v.payload) }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ goal: data });
}

export async function updateWeekGoalRoute(req, res) {
  const supabase = getSupabase();
  const { data: existing, error: findErr } = await findRow(supabase, 'sales_week_goals', req.params.businessId, req.params.id);
  if (findErr) return res.status(500).json({ error: findErr.message });
  if (!existing) return res.status(404).json({ error: 'goal not found' });
  const v = await validate(supabase, req.params.businessId, WEEK_FIELDS, req.body);
  if (v.error) return fail(res, v);
  try {
    for (const week of new Set([existing.week_start, v.payload.week_start].filter(Boolean))) {
      if (await weekIsFinal(supabase, req.params.businessId, week)) return res.status(409).json({ error: FINAL_ERROR });
    }
  } catch (e) { return res.status(500).json({ error: e.message }); }
  const { data, error } = await supabase.from('sales_week_goals')
    .update({ ...v.payload, ...weekTimestamps(v.payload, existing), updated_at: new Date().toISOString() })
    .eq('id', existing.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ goal: data });
}

export async function deleteWeekGoalRoute(req, res) {
  const supabase = getSupabase();
  const { data: existing, error: findErr } = await findRow(supabase, 'sales_week_goals', req.params.businessId, req.params.id);
  if (findErr) return res.status(500).json({ error: findErr.message });
  if (!existing) return res.status(404).json({ error: 'goal not found' });
  try {
    if (await weekIsFinal(supabase, req.params.businessId, existing.week_start)) return res.status(409).json({ error: FINAL_ERROR });
  } catch (e) { return res.status(500).json({ error: e.message }); }
  const { error } = await supabase.from('sales_week_goals').delete().eq('id', existing.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ deleted: existing.id });
}

// Unfinished = a commitment still open, or a to-do not done/dropped whose
// steps aren't all ticked.
function isUnfinished(g) {
  if (g.status !== 'open') return false;
  if (g.kind !== 'todo') return true;
  return !(g.steps.length && g.steps.every(s => s.done));
}

// POST /goals/week/carry-over { week_start, kind? } - copies the previous
// week's unfinished commitments and/or to-dos into week_start, to-dos with
// their steps (ticked state kept). Idempotent: a goal already carried into
// that week is skipped, and the sales_week_goals_carry_once unique index
// turns a concurrent double-press into a no-op instead of a duplicate.
export async function carryOverWeekGoalsRoute(req, res) {
  const weekStart = req.body?.week_start;
  const kind = req.body?.kind;
  if (!isMonday(weekStart)) return res.status(400).json({ error: 'week_start must be a Monday (YYYY-MM-DD)' });
  if (kind !== undefined && !WEEK_KINDS.includes(kind)) return res.status(400).json({ error: `bad enum: kind must be one of ${WEEK_KINDS.join('|')}` });
  const businessId = req.params.businessId;
  const supabase = getSupabase();
  try {
    if (await weekIsFinal(supabase, businessId, weekStart)) return res.status(409).json({ error: FINAL_ERROR });
    const [previous, already] = await Promise.all([
      selectAllPages(() => {
        let q = supabase.from('sales_week_goals').select('*, steps:sales_week_goal_steps(*)').eq('business_id', businessId)
          .eq('week_start', addDays(weekStart, -7));
        if (kind) q = q.eq('kind', kind);
        return q.order('sort_order').order('id');
      }),
      selectAllPages(() => supabase.from('sales_week_goals').select('carried_from_id').eq('business_id', businessId)
        .eq('week_start', weekStart).not('carried_from_id', 'is', null).order('id')),
    ]);
    const done = new Set(already.map(r => r.carried_from_id));
    const unfinished = previous.filter(isUnfinished);
    const carried = [];
    for (const g of unfinished.filter(g => !done.has(g.id))) {
      const { data, error } = await supabase.from('sales_week_goals').insert({
        business_id: businessId, week_start: weekStart, text: g.text, owner_user_id: g.owner_user_id,
        measurable_target: g.measurable_target, month_goal_id: g.month_goal_id, land_goal_id: g.land_goal_id,
        kind: g.kind, category: g.category, contacts: g.contacts, link_target: g.link_target,
        metric_key: g.metric_key, target_value: g.target_value, carried_from_id: g.id, sort_order: g.sort_order,
        prospect_contact_id: g.prospect_contact_id, flag_note: g.flag_note, flagged_by: g.flagged_by,
      }).select().single();
      if (error?.code === '23505') continue;
      if (error) throw new Error(error.message);
      if (g.steps.length) {
        const { error: stepErr } = await supabase.from('sales_week_goal_steps').insert(g.steps.map(s => ({
          business_id: businessId, goal_id: data.id, text: s.text, done: s.done, done_at: s.done_at, sort_order: s.sort_order,
        })));
        if (stepErr) throw new Error(stepErr.message);
      }
      carried.push(data);
    }
    res.json({ carried, skipped: unfinished.length - carried.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── To-do steps ─────────────────────────────────────────────────────────────
async function stepGoalOr404(supabase, res, businessId, goalId) {
  const { data: goal, error } = await findRow(supabase, 'sales_week_goals', businessId, goalId);
  if (error) { res.status(500).json({ error: error.message }); return null; }
  if (!goal) { res.status(404).json({ error: 'goal not found' }); return null; }
  if (await weekIsFinal(supabase, businessId, goal.week_start)) { res.status(409).json({ error: FINAL_ERROR }); return null; }
  return goal;
}

function validateStep(body) {
  const payload = {};
  for (const [key, value] of Object.entries(body || {})) {
    if (!STEP_FIELDS[key]) return { error: `unknown field: ${key}` };
    if (key === 'text' && (typeof value !== 'string' || !value.trim())) return { error: 'text must be non-empty text' };
    if (key === 'done' && typeof value !== 'boolean') return { error: 'done must be true or false' };
    if (key === 'sort_order' && !(Number.isInteger(value) && value >= 0)) return { error: 'sort_order must be a whole number >= 0' };
    payload[key] = key === 'text' ? value.trim() : value;
  }
  if ('done' in payload) payload.done_at = payload.done ? new Date().toISOString() : null;
  return { payload };
}

// POST /goals/week/:id/steps { text, sort_order? }
export async function createStepRoute(req, res) {
  const supabase = getSupabase();
  try {
    const goal = await stepGoalOr404(supabase, res, req.params.businessId, req.params.id);
    if (!goal) return;
    const v = validateStep(req.body);
    if (v.error) return fail(res, v);
    if (!v.payload.text) return res.status(400).json({ error: 'text is required' });
    const { data, error } = await supabase.from('sales_week_goal_steps')
      .insert({ business_id: req.params.businessId, goal_id: goal.id, ...v.payload }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ step: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

async function stepOr404(supabase, res, businessId, stepId) {
  const { data: step, error } = await findRow(supabase, 'sales_week_goal_steps', businessId, stepId);
  if (error) { res.status(500).json({ error: error.message }); return null; }
  if (!step) { res.status(404).json({ error: 'step not found' }); return null; }
  return (await stepGoalOr404(supabase, res, businessId, step.goal_id)) ? step : null;
}

// PATCH /goals/steps/:id { text?, done?, sort_order? }
export async function updateStepRoute(req, res) {
  const supabase = getSupabase();
  try {
    const step = await stepOr404(supabase, res, req.params.businessId, req.params.id);
    if (!step) return;
    const v = validateStep(req.body);
    if (v.error) return fail(res, v);
    const { data, error } = await supabase.from('sales_week_goal_steps')
      .update({ ...v.payload, updated_at: new Date().toISOString() }).eq('id', step.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ step: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export async function deleteStepRoute(req, res) {
  const supabase = getSupabase();
  try {
    const step = await stepOr404(supabase, res, req.params.businessId, req.params.id);
    if (!step) return;
    const { error } = await supabase.from('sales_week_goal_steps').delete().eq('id', step.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ deleted: step.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── Planned cadences ────────────────────────────────────────────────────────
// GET /goals/cadences?from=<Monday>&to=<Monday>
export async function listCadencesRoute(req, res) {
  const { from, to } = req.query;
  if (!isMonday(from) || !isMonday(to) || from > to) return res.status(400).json({ error: 'from and to must be Mondays (YYYY-MM-DD) with from <= to' });
  const supabase = getSupabase();
  try {
    const cadences = await selectAllPages(() => supabase.from('sales_cadence_plan').select('*')
      .eq('business_id', req.params.businessId).gte('week_start', from).lte('week_start', to)
      .order('week_start').order('sort_order').order('created_at').order('id'));
    res.json({ cadences });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export async function createCadenceRoute(req, res) {
  const supabase = getSupabase();
  const v = await validate(supabase, req.params.businessId, CADENCE_FIELDS, req.body);
  if (v.error) return fail(res, v);
  if (!v.payload.week_start) return res.status(400).json({ error: 'week_start is required' });
  if (!v.payload.name) return res.status(400).json({ error: 'name is required' });
  const { data, error } = await supabase.from('sales_cadence_plan')
    .insert({ business_id: req.params.businessId, ...v.payload }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ cadence: data });
}

export async function updateCadenceRoute(req, res) {
  const supabase = getSupabase();
  const { data: existing, error: findErr } = await findRow(supabase, 'sales_cadence_plan', req.params.businessId, req.params.id);
  if (findErr) return res.status(500).json({ error: findErr.message });
  if (!existing) return res.status(404).json({ error: 'cadence not found' });
  const v = await validate(supabase, req.params.businessId, CADENCE_FIELDS, req.body);
  if (v.error) return fail(res, v);
  const { data, error } = await supabase.from('sales_cadence_plan')
    .update({ ...v.payload, updated_at: new Date().toISOString() }).eq('id', existing.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ cadence: data });
}

export async function deleteCadenceRoute(req, res) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('sales_cadence_plan').delete()
    .eq('business_id', req.params.businessId).eq('id', req.params.id).select('id');
  if (error) return res.status(500).json({ error: error.message });
  if (!data.length) return res.status(404).json({ error: 'cadence not found' });
  res.json({ deleted: data[0].id });
}

// ── "How the week went" notes (REV3; kept, unused by the REV4 UI) ───────────
// GET /goals/notes?from=<Monday>&to=<Monday>
export async function listWeekNotesRoute(req, res) {
  const { from, to } = req.query;
  if (!isMonday(from) || !isMonday(to) || from > to) return res.status(400).json({ error: 'from and to must be Mondays (YYYY-MM-DD) with from <= to' });
  const supabase = getSupabase();
  try {
    const notes = await selectAllPages(() => supabase.from('sales_week_notes').select('*')
      .eq('business_id', req.params.businessId).gte('week_start', from).lte('week_start', to).order('week_start'));
    res.json({ notes });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// PUT /goals/notes/:weekStart { recap }
export async function saveWeekNoteRoute(req, res) {
  const { weekStart } = req.params;
  if (!isMonday(weekStart)) return res.status(400).json({ error: 'week must be a Monday (YYYY-MM-DD)' });
  const keys = Object.keys(req.body || {});
  const unknown = keys.find(k => k !== 'recap');
  if (unknown) return res.status(400).json({ error: `unknown field: ${unknown}` });
  if (typeof req.body?.recap !== 'string') return res.status(400).json({ error: 'recap must be a string' });
  const { data, error } = await getSupabase().from('sales_week_notes').upsert({
    business_id: req.params.businessId, week_start: weekStart, recap: req.body.recap,
    updated_by: req.auth.user.id, updated_at: new Date().toISOString(),
  }, { onConflict: 'business_id,week_start' }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ note: data });
}
