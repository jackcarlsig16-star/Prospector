import ExcelJS from 'exceljs';
import { selectAllPages } from '../lib/selectAllPages.js';
import { hasRole } from '../lib/requireAuth.js';
import { getSupabase, addDays } from './goalsShared.js';
import { orgKey } from './opportunityMatch.js';
import { OWNER_TEAMS, TEAM_LABEL } from '../../src/constants/ownership.js';
import { cleanText } from './scrubText.js';
import { laDateString } from './laDate.js';
import { BOARD_COLORS, BOARD_COLOR_IDS, BOARD_TYPES, SHEET_FILLS, boardStage, compareBoardRows, matchesBoardFilters } from '../../src/constants/pipelineBoard.js';

// pipeline-board-v1 - GET goals/pipeline-board: one row per company across
// partners (sales_goals), employers (sales_opportunities), targets
// (sales_targets) and, on request, Apollo-sequenced companies with no linked
// opportunity. Read-only. Rows carry an explicit field list - no emails, no
// phones, no Apollo ids leave this route.

const isEmployer = o => o.org_type === 'employer' || o.org_type === 'membership';

// signals-v1 Stage 4 (D11): the latest visit per matched record, keyed as the
// board keys its rows (an opportunity match lands on the employer row).
const VISIT_TYPE = { partner: 'partner', opportunity: 'employer', target: 'target' };
export function visitedByRow(visits) {
  const out = new Map();
  for (const v of visits) {
    const key = `${VISIT_TYPE[v.matched_type]}:${v.matched_id}`;
    const prior = out.get(key);
    if (!prior || v.pulled_on > prior.pulled_on) out.set(key, { last_visit: v.last_visit || v.pulled_on, visits_7d: v.visits_7d ?? null, pulled_on: v.pulled_on });
  }
  return out;
}

export function buildBoard({ partners, opportunities, targets, sequenced, memberNames, visits = [] }, filters = {}) {
  const rows = [];
  for (const g of partners) {
    rows.push({
      type: 'partner', id: g.id, name: g.name, ...boardStage('partner', g),
      owner_team: g.owner_team || null, owner: memberNames.get(g.owner_user_id) || null, tier: g.tier || null,
      next_step: g.next_step || null, next_step_due: g.next_meeting_at || null, last_touch_at: g.last_touch_at || null,
      top: !!g.hot, record_id: g.record_id || null,
      // pipeline-quick-panel-v1: the quick panel's header; not sheet columns.
      category: g.category || null, co_owner_name: g.co_owner_name || null, no_double_touch: !!g.no_double_touch,
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
  const visited = visitedByRow(visits);
  for (const r of rows) r.visited = visited.get(`${r.type}:${r.id}`) || null;
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

async function loadBoard(businessId, filters) {
  const supabase = getSupabase();
  const [partners, opportunities, targets, sequenced, members, visits] = await Promise.all([
    selectAllPages(() => supabase.from('sales_goals')
      .select('id, name, category, tier, pipeline_status, hot, next_step, next_meeting_at, last_touch_at, owner_user_id, owner_team, co_owner_name, no_double_touch, record_id')
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
    selectAllPages(() => supabase.from('web_visits').select('id, matched_type, matched_id, last_visit, visits_7d, pulled_on')
      .eq('business_id', businessId).not('matched_id', 'is', null).gte('pulled_on', addDays(laDateString(), -7)).order('id')),
  ]);
  if (members.error) throw new Error(members.error.message);
  const memberNames = new Map(members.data.map(m => [m.user_id, m.profile?.display_name || m.name]));
  return buildBoard({ partners, opportunities, targets, sequenced, memberNames, visits }, filters);
}

// GET /goals/pipeline-board?type=&owner_team=&owner=&tier=&color=&q=&include_apollo=true
export async function pipelineBoardRoute(req, res) {
  const { filters, error } = parseBoardFilters(req.query);
  if (error) return res.status(400).json({ error });
  try {
    res.json({ rows: await loadBoard(req.params.businessId, filters) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// The joint sheet for Upside: the board's columns + a Status word, the row's
// color as the fill. Apollo-only rows never go out, and free text is scrubbed
// of emails / phone numbers.
export const SHEET_COLUMNS = [
  { header: 'Top', width: 6, value: r => (r.top ? '★' : '') },
  { header: 'Account', width: 36, value: r => r.name, free: true },
  { header: 'Type', width: 10, value: r => TYPE_LABEL[r.type] },
  { header: 'Status', width: 16, value: r => COLOR_LABEL[r.color] },
  { header: 'Stage', width: 20, value: r => r.stage_label || '' },
  { header: 'Owner Team', width: 12, value: r => TEAM_LABEL[r.owner_team] || '' },
  { header: 'Owner', width: 18, value: r => r.owner || '', free: true },
  { header: 'Priority Tier', width: 12, value: r => (r.tier === 'active' ? 'Active' : r.tier || '') },
  { header: 'Next Step', width: 48, value: r => r.next_step || '', free: true },
  { header: 'Next Step Due', width: 14, value: r => r.next_step_due || '' },
  { header: 'Last Touch', width: 12, value: r => (r.last_touch_at || '').slice(0, 10) },
  { header: 'Record ID', width: 12, value: r => r.record_id || '' },
  // Update from sheet matches on this first (type:id), so a renamed row still lands.
  { header: 'Prospector ID', width: 46, value: r => `${r.type}:${r.id}` },
];
const TYPE_LABEL = { partner: 'Partner', employer: 'Employer', target: 'Target' };
const COLOR_LABEL = Object.fromEntries(BOARD_COLORS.map(c => [c.id, c.label]));
// Upside receives this file: not even a stray "@" goes out.
const sheetText = v => cleanText(v, 500).replace(/\s*@\s*/g, ' at ');

export async function buildSheet(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Joint pipeline', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = SHEET_COLUMNS.map(c => ({ header: c.header, width: c.width }));
  ws.getRow(1).font = { bold: true };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: SHEET_COLUMNS.length } };
  // Same order as the screen: the Top section first, then the color sections.
  const ordered = [...rows.filter(r => r.top), ...rows.filter(r => !r.top)].filter(r => r.type !== 'apollo');
  for (const r of ordered) {
    const row = ws.addRow(SHEET_COLUMNS.map(c => (c.free ? sheetText(c.value(r)) : c.value(r))));
    const fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SHEET_FILLS[r.color] } };
    row.eachCell({ includeEmpty: true }, cell => { cell.fill = fill; });
    if (r.color === 'faded') row.font = { color: { argb: 'FF808080' } };
  }
  return wb.xlsx.writeBuffer();
}

// GET /goals/pipeline-board/export?<same filters> - Member+ (the gate lets Viewers GET).
export async function pipelineBoardExportRoute(req, res) {
  const businessId = req.params.businessId;
  if (!hasRole(req, businessId, 'member')) return res.status(403).json({ error: 'Export is for members only' });
  const { filters, error } = parseBoardFilters({ ...req.query, include_apollo: 'false' });
  if (error) return res.status(400).json({ error });
  try {
    const buf = await buildSheet(await loadBoard(businessId, { ...filters, includeApollo: false }));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="joint-pipeline-${laDateString()}.xlsx"`);
    res.send(Buffer.from(buf));
  } catch (e) { res.status(500).json({ error: e.message }); }
}
