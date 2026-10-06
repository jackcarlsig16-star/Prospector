import { createClient } from '@supabase/supabase-js';
import { selectAllPages } from '../lib/selectAllPages.js';

// sales-goals-v1 REVISION 3 Stage 2 - Goals & Weekly Plan API. Mounted under
// /api/sales/:businessId, so salesGate has already enforced the workspace
// (viewer reads, member writes). The tables carry member-scoped RLS too; this
// server path uses the service key and re-checks every id it's handed
// against the workspace.
function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

const GOAL_TYPES = ['company', 'partnership'];
const LAND_STATUSES = ['not_started', 'in_progress', 'landed', 'paused', 'lost'];
const MONTH_STATUSES = ['not_started', 'in_progress', 'done', 'dropped'];
const WEEK_STATUSES = ['open', 'done', 'dropped'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isDate = v => typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const isMonday = v => isDate(v) && new Date(`${v}T00:00:00Z`).getUTCDay() === 1;
const isFirstOfMonth = v => isDate(v) && v.endsWith('-01');
const addDays = (v, n) => new Date(Date.parse(`${v}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

// Field kinds: text, required (non-empty text), int (>= 0), date, monday,
// month, enum, member (workspace member's user id), ref (row of `table` in
// this workspace). Every field is nullable except required/enum/monday/month.
const LAND_FIELDS = {
  goal_type: { kind: 'enum', values: GOAL_TYPES }, name: { kind: 'required' },
  status: { kind: 'enum', values: LAND_STATUSES }, owner_user_id: { kind: 'member' },
  target_date: { kind: 'date' }, priority: { kind: 'int' }, est_covered_lives: { kind: 'int' },
  company_domain: { kind: 'text' }, notes: { kind: 'text' },
  linked_opportunity_id: { kind: 'ref', table: 'sales_opportunities' },
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
};

async function validate(supabase, businessId, fields, body) {
  const payload = {};
  for (const [key, value] of Object.entries(body || {})) {
    const f = fields[key];
    if (!f) return { error: `unknown field: ${key}` };
    if (value === null) {
      if (['required', 'enum', 'monday', 'month'].includes(f.kind)) return { error: `${key} can't be null` };
      payload[key] = null;
      continue;
    }
    if (f.kind === 'enum' && !f.values.includes(value)) return { error: `bad enum: ${key} must be one of ${f.values.join('|')}` };
    if (f.kind === 'text' && typeof value !== 'string') return { error: `${key} must be a string or null` };
    if (f.kind === 'required' && (typeof value !== 'string' || !value.trim())) return { error: `${key} must be non-empty text` };
    if (f.kind === 'int' && !(Number.isInteger(value) && value >= 0)) return { error: `${key} must be a whole number >= 0 or null` };
    if (f.kind === 'date' && !isDate(value)) return { error: `${key} must be a YYYY-MM-DD date or null` };
    if (f.kind === 'monday' && !isMonday(value)) return { error: `${key} must be a Monday (YYYY-MM-DD)` };
    if (f.kind === 'month' && !isFirstOfMonth(value)) return { error: `${key} must be the 1st of a month (YYYY-MM-01)` };
    if (f.kind === 'member') {
      const { data, error } = await supabase.from('business_members').select('id').eq('business_id', businessId).eq('user_id', value).maybeSingle();
      if (error) return { status: 500, error: error.message };
      if (!data) return { error: `${key} is not a member of this workspace` };
    }
    if (f.kind === 'ref') {
      const { data, error } = await supabase.from(f.table).select('id').eq('business_id', businessId).eq('id', value).maybeSingle();
      if (error) return { status: 500, error: error.message };
      if (!data) return { error: `${key} not found in this workspace` };
    }
    payload[key] = f.kind === 'required' ? value.trim() : value;
  }
  return { payload };
}

const fail = (res, v) => res.status(v.status || 400).json({ error: v.error });

async function findRow(supabase, table, businessId, id) {
  return supabase.from(table).select('*').eq('business_id', businessId).eq('id', id).maybeSingle();
}

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
export async function listLandGoalsRoute(req, res) {
  const { goal_type, include_archived } = req.query;
  if (goal_type && !GOAL_TYPES.includes(goal_type)) return res.status(400).json({ error: `bad enum: goal_type must be one of ${GOAL_TYPES.join('|')}` });
  const supabase = getSupabase();
  try {
    const goals = await selectAllPages(() => {
      let q = supabase.from('sales_goals').select('*').eq('business_id', req.params.businessId);
      if (goal_type) q = q.eq('goal_type', goal_type);
      if (include_archived !== 'true') q = q.is('archived_at', null);
      return q.order('created_at').order('id');
    });
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
    .insert({ business_id: req.params.businessId, ...v.payload, ...landTimestamps(v.payload) }).select().single();
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

// ── Monthly goals ───────────────────────────────────────────────────────────
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

// ── Weekly goals ────────────────────────────────────────────────────────────
// GET /goals/week?from=<Monday>&to=<Monday> (inclusive) - e.g. last + this week.
export async function listWeekGoalsRoute(req, res) {
  const { from, to } = req.query;
  if (!isMonday(from) || !isMonday(to) || from > to) return res.status(400).json({ error: 'from and to must be Mondays (YYYY-MM-DD) with from <= to' });
  const supabase = getSupabase();
  try {
    const goals = await selectAllPages(() => supabase.from('sales_week_goals').select('*')
      .eq('business_id', req.params.businessId).gte('week_start', from).lte('week_start', to)
      .order('week_start').order('sort_order').order('created_at').order('id'));
    res.json({ goals });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export async function createWeekGoalRoute(req, res) {
  const supabase = getSupabase();
  const v = await validate(supabase, req.params.businessId, WEEK_FIELDS, req.body);
  if (v.error) return fail(res, v);
  if (!v.payload.week_start) return res.status(400).json({ error: 'week_start is required' });
  if (!v.payload.text) return res.status(400).json({ error: 'text is required' });
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
  const { data, error } = await supabase.from('sales_week_goals')
    .update({ ...v.payload, ...weekTimestamps(v.payload, existing), updated_at: new Date().toISOString() })
    .eq('id', existing.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ goal: data });
}

export async function deleteWeekGoalRoute(req, res) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('sales_week_goals').delete()
    .eq('business_id', req.params.businessId).eq('id', req.params.id).select('id');
  if (error) return res.status(500).json({ error: error.message });
  if (!data.length) return res.status(404).json({ error: 'goal not found' });
  res.json({ deleted: data[0].id });
}

// POST /goals/week/carry-over { week_start } - copies the previous week's
// still-open goals into week_start. Idempotent: a goal already carried into
// that week is skipped, and the sales_week_goals_carry_once unique index
// turns a concurrent double-press into a no-op instead of a duplicate.
export async function carryOverWeekGoalsRoute(req, res) {
  const weekStart = req.body?.week_start;
  if (!isMonday(weekStart)) return res.status(400).json({ error: 'week_start must be a Monday (YYYY-MM-DD)' });
  const businessId = req.params.businessId;
  const supabase = getSupabase();
  try {
    const [open, already] = await Promise.all([
      selectAllPages(() => supabase.from('sales_week_goals').select('*').eq('business_id', businessId)
        .eq('week_start', addDays(weekStart, -7)).eq('status', 'open').order('sort_order').order('id')),
      selectAllPages(() => supabase.from('sales_week_goals').select('carried_from_id').eq('business_id', businessId)
        .eq('week_start', weekStart).not('carried_from_id', 'is', null).order('id')),
    ]);
    const done = new Set(already.map(r => r.carried_from_id));
    const carried = [];
    for (const g of open.filter(g => !done.has(g.id))) {
      const { data, error } = await supabase.from('sales_week_goals').insert({
        business_id: businessId, week_start: weekStart, text: g.text, owner_user_id: g.owner_user_id,
        measurable_target: g.measurable_target, month_goal_id: g.month_goal_id, land_goal_id: g.land_goal_id,
        carried_from_id: g.id, sort_order: g.sort_order,
      }).select().single();
      if (error?.code === '23505') continue;
      if (error) throw new Error(error.message);
      carried.push(data);
    }
    res.json({ carried, skipped: open.length - carried.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── "How the week went" notes ───────────────────────────────────────────────
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
