import { selectAllPages } from '../lib/selectAllPages.js';
import { getSupabase } from './goalsShared.js';
import { orgKey } from './opportunityMatch.js';
import { OWNER_TEAMS } from '../../src/constants/ownership.js';
import { BOARD_COLOR_IDS, BOARD_TYPES, boardStage, compareBoardRows, matchesBoardFilters } from '../../src/constants/pipelineBoard.js';

// pipeline-board-v1 - GET goals/pipeline-board: one row per company across
// partners (sales_goals), employers (sales_opportunities), targets
// (sales_targets) and, on request, Apollo-sequenced companies with no linked
// opportunity. Read-only. Rows carry an explicit field list - no emails, no
// phones, no Apollo ids leave this route.

const isEmployer = o => o.org_type === 'employer' || o.org_type === 'membership';

export function buildBoard({ partners, opportunities, targets, sequenced, memberNames }, filters = {}) {
  const rows = [];
  for (const g of partners) {
    rows.push({
      type: 'partner', id: g.id, name: g.name, ...boardStage('partner', g),
      owner_team: g.owner_team || null, owner: memberNames.get(g.owner_user_id) || null, tier: g.tier || null,
      next_step: g.next_step || null, next_step_due: null, last_touch_at: g.last_touch_at || null,
      top: !!g.hot, record_id: g.record_id || null,
    });
  }
  const employers = opportunities.filter(isEmployer);
  for (const o of employers) {
    rows.push({
      type: 'employer', id: o.id, name: o.organization, ...boardStage('employer', o),
      owner_team: o.owner_team || null, owner: o.owner || null, tier: o.tier || null,
      next_step: o.next_action || null, next_step_due: o.next_action_date || null, last_touch_at: null,
      top: !!o.is_top, record_id: o.record_id || null,
    });
  }
  for (const t of targets) {
    const stage = boardStage('target', t);
    if (!stage) continue;
    rows.push({
      type: 'target', id: t.id, name: t.name, ...stage, owner_team: t.owner_team || null, owner: null, tier: null,
      next_step: null, next_step_due: null, last_touch_at: null, top: false, record_id: t.record_id || null,
    });
  }
  if (filters.includeApollo) {
    // Linked = any opportunity (employer or not) carrying the Apollo id or the same org key.
    const linkedIds = new Set(opportunities.map(o => o.apollo_account_id).filter(Boolean));
    const linkedKeys = new Set(opportunities.map(o => orgKey(o.organization)).filter(Boolean));
    const seen = new Set();
    for (const s of sequenced) {
      if (seen.has(s.account_id) || linkedIds.has(s.account_id) || linkedKeys.has(orgKey(s.name))) continue;
      seen.add(s.account_id);
      rows.push({
        type: 'apollo', id: s.account_id, name: s.name || 'Unnamed company', ...boardStage('apollo', s),
        owner_team: null, owner: null, tier: null, next_step: null, next_step_due: null,
        last_touch_at: s.first_sequenced_at || null, top: false, record_id: null,
      });
    }
  }
  return rows.filter(r => matchesBoardFilters(r, filters)).sort(compareBoardRows);
}

export function parseBoardFilters(query) {
  const { type, owner_team, owner, tier, color, q, include_apollo } = query;
  if (type && type !== 'all' && !BOARD_TYPES.includes(type)) return { error: `type must be one of all|${BOARD_TYPES.join('|')}` };
  if (owner_team && ![...OWNER_TEAMS, 'unset'].includes(owner_team)) return { error: `owner_team must be one of ${OWNER_TEAMS.join('|')}|unset` };
  if (color && !BOARD_COLOR_IDS.includes(color)) return { error: `color must be one of ${BOARD_COLOR_IDS.join('|')}` };
  if (q && q.length > 120) return { error: 'q must be up to 120 characters' };
  const t = type === 'all' ? null : type || null;
  return { filters: { type: t, ownerTeam: owner_team || null, owner: owner || null, tier: tier || null, color: color || null, q: q || null, includeApollo: include_apollo === 'true' || t === 'apollo' } };
}

// GET /goals/pipeline-board?type=&owner_team=&owner=&tier=&color=&q=&include_apollo=true
export async function pipelineBoardRoute(req, res) {
  const { filters, error } = parseBoardFilters(req.query);
  if (error) return res.status(400).json({ error });
  const businessId = req.params.businessId;
  const supabase = getSupabase();
  try {
    const [partners, opportunities, targets, sequenced, members] = await Promise.all([
      selectAllPages(() => supabase.from('sales_goals')
        .select('id, name, category, tier, pipeline_status, hot, next_step, last_touch_at, owner_user_id, owner_team, record_id')
        .eq('business_id', businessId).eq('goal_type', 'partnership').is('archived_at', null).order('id')),
      selectAllPages(() => supabase.from('sales_opportunities')
        .select('id, organization, org_type, stage, owner, owner_team, tier, next_action, next_action_date, is_top, record_id, apollo_account_id')
        .eq('business_id', businessId).is('archived_at', null).order('id')),
      selectAllPages(() => supabase.from('sales_targets').select('id, name, status, owner_team, record_id')
        .eq('business_id', businessId).in('status', ['proposed', 'researching']).order('id')),
      filters.includeApollo
        ? selectAllPages(() => supabase.from('sales_sequenced_accounts').select('account_id, name, first_sequenced_at')
          .eq('business_id', businessId).order('account_id'))
        : [],
      supabase.from('business_members').select('user_id, name, profile:profiles!business_members_user_id_fkey(display_name)')
        .eq('business_id', businessId).not('user_id', 'is', null),
    ]);
    if (members.error) throw new Error(members.error.message);
    const memberNames = new Map(members.data.map(m => [m.user_id, m.profile?.display_name || m.name]));
    const rows = buildBoard({ partners, opportunities, targets, sequenced, memberNames }, filters);
    res.json({ rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
