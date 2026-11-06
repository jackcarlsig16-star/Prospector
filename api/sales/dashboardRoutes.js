import { getSupabase } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { laDateString } from './laDate.js';
import { STAGE_ORDER, SIDE_LANES, STAGE_LABELS } from '../../src/components/salesAnalytics/pipelineStages.js';
import { PARTNER_STATUS_GROUPS, LIVES_METRIC } from '../../src/constants/homeCards.js';
import { pipelineKpis } from './goalsReportRoutes.js';
import { openTodosFor } from './openTodos.js';

// dashboard-v3 Stage 5 (H) - GET goals/dashboard?owner=<user id>: the Home small cards in one read, nothing written.
// Employers by stage (every main stage, a side lane only when used), partners by status (the six groups of
// src/constants/homeCards.js) and by owner, open to-dos per owner (openTodosFor - the rows Actions and Needs attention
// count - split overdue by due date), open waiting-on rows (no owner: team-wide whatever the filter says) and covered
// lives = the KPI table's covered_lives_pipeline (pipelineKpis) with that metric's latest goal. Owner = a member's
// user id: partners by owner_user_id, employers by the typed owner name (full or first name), to-dos by owner.
const err = (status, error) => Object.assign(new Error(error), { status });
const must = r => { if (r.error) throw err(500, r.error.message); return r.data; };

export function ownerMatcher(members, ownerId) {
  const m = members.find(x => x.user_id === ownerId);
  if (!m) return () => false;
  const names = new Set([m.name, m.name.split(' ')[0]].map(s => s.trim().toLowerCase()));
  return name => !!name && names.has(String(name).trim().toLowerCase());
}

export function buildHomeCards({ today, owner = null, members = [], partners = [], opportunities = [], todos = [], waiting = [], livesGoal = null }) {
  const isOwnerName = ownerMatcher(members, owner);
  const myPartners = partners.filter(p => !owner || p.owner_user_id === owner);
  const myOpps = opportunities.filter(o => !owner || isOwnerName(o.owner));
  const by_stage = [...STAGE_ORDER, ...SIDE_LANES].map(id => ({ id, label: STAGE_LABELS[id], count: myOpps.filter(o => o.stage === id).length }))
    .filter(s => STAGE_ORDER.includes(s.id) || s.count > 0);
  const statusOf = p => p.pipeline_status || 'not_started';
  const by_status = PARTNER_STATUS_GROUPS.map(g => ({ id: g.id, label: g.label, count: myPartners.filter(p => g.statuses.includes(statusOf(p))).length }));
  const ownerRows = [...members.map(m => ({ owner_user_id: m.user_id, name: m.name })), { owner_user_id: null, name: 'Unassigned' }]
    .filter(r => !owner || r.owner_user_id === owner);
  const by_owner = ownerRows.map(r => ({ ...r, count: myPartners.filter(p => (p.owner_user_id || null) === r.owner_user_id).length }))
    .filter(r => r.owner_user_id !== null || r.count > 0);
  const per_owner = ownerRows.map(r => {
    const mine = todos.filter(t => (t.owner_user_id || null) === r.owner_user_id);
    return { ...r, open: mine.length, overdue: mine.filter(t => t.due_date && t.due_date < today).length };
  }).filter(r => r.owner_user_id !== null || r.open > 0);
  const openWaiting = waiting.filter(w => w.kind === 'waiting' && w.status === 'open');
  return {
    today, owner,
    members: members.map(m => ({ user_id: m.user_id, name: m.name })),
    employers: { total: by_stage.reduce((n, s) => n + s.count, 0), by_stage },
    partners: { total: myPartners.length, by_status, by_owner },
    todos: { per_owner, open: per_owner.reduce((n, r) => n + r.open, 0), overdue: per_owner.reduce((n, r) => n + r.overdue, 0) },
    waiting: { open: openWaiting.length, overdue: openWaiting.filter(w => w.due_date && w.due_date < today).length, scope: 'team' },
    lives: { value: pipelineKpis(myOpps, today).covered_lives_pipeline, goal: livesGoal, metric: LIVES_METRIC },
  };
}

export async function loadDashboard(supabase, businessId, { owner = null } = {}, now = new Date()) {
  const today = laDateString(now);
  const all = (table, cols, narrow = q => q) => selectAllPages(() => narrow(supabase.from(table).select(cols).eq('business_id', businessId)).order('id'));
  const [members, partners, opportunities, openTodos, waiting, goalRows] = await Promise.all([
    supabase.from('business_members').select('user_id, name').eq('business_id', businessId).not('user_id', 'is', null).order('created_at').then(must),
    all('sales_goals', 'id, pipeline_status, owner_user_id', q => q.eq('goal_type', 'partnership').is('archived_at', null)),
    all('sales_opportunities', 'id, stage, owner, covered_lives', q => q.is('archived_at', null)),
    openTodosFor(supabase, businessId, null, { cols: 'id, status, owner_user_id, due_date, created_at' }),
    all('sales_week_goals', 'id, kind, status, due_date', q => q.eq('kind', 'waiting').eq('status', 'open')),
    supabase.from('sales_metric_targets').select('period_start, goal').eq('business_id', businessId).eq('metric_key', LIVES_METRIC)
      .not('goal', 'is', null).lte('period_start', today).order('period_start', { ascending: false }).limit(1).then(must),
  ]);
  return buildHomeCards({ today, owner, members, partners, opportunities, todos: openTodos.rows, waiting, livesGoal: goalRows[0] ? Number(goalRows[0].goal) : null });
}

export async function dashboardRoute(req, res) {
  try { res.json(await loadDashboard(getSupabase(), req.params.businessId, { owner: req.query.owner || null })); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}
