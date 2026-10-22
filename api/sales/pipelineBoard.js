import ExcelJS from 'exceljs';
import { selectAllPages } from '../lib/selectAllPages.js';
import { hasRole } from '../lib/requireAuth.js';
import { getSupabase, addDays } from './goalsShared.js';
import { orgKey } from './opportunityMatch.js';
import { OWNER_TEAMS, TEAM_LABEL } from '../../src/constants/ownership.js';
import { cleanText } from './scrubText.js';
import { laDateString } from './laDate.js';
import { normName } from './intakeMatch.js';
import { openFlagRows } from './huddleFlags.js';
import { loadOverrides, effectiveVisit } from './visitPriority.js';
import { BOARD_COLORS, BOARD_COLOR_IDS, BOARD_TYPES, SHEET_FILLS, boardStage, compareBoardRows, matchesBoardFilters } from '../../src/constants/pipelineBoard.js';

// pipeline-board-v1 - GET goals/pipeline-board: one row per company across
// partners (sales_goals), employers (sales_opportunities), targets
// (sales_targets) and, on request, Apollo-sequenced companies with no linked
// opportunity. Read-only. Rows carry an explicit field list - no emails, no
// phones, no Apollo ids leave this route. sales-ia-v2 P1 adds channel,
// priority (+ who set it), open to-dos / waiting counts, employer last touch,
// covered lives, the channel buttons a row shows under, and Visitor / Signal
// rows for companies no record carries yet.

const isEmployer = o => o.org_type === 'employer' || o.org_type === 'membership';
const DAY = 864e5;
export const CALL_NOTE_DAYS = 30; // REVISABLE (spec P1)
// A to-do's link_type -> the board row type it counts on.
const LINK_ROW = { partner: 'partner', opportunity: 'employer', target: 'target', company: 'apollo' };
const RECORD_TYPES = ['partner', 'employer', 'target'];
const pInt = p => (p ? Number(String(p).replace('P', '')) : null);

// signals-v1 Stage 4 (D11): the latest visit per matched record, keyed as the
// board keys its rows (an opportunity match lands on the employer row).
// sales-ia-v2 P3: priority is the effective one (a person's override first).
const VISIT_TYPE = { partner: 'partner', opportunity: 'employer', target: 'target' };
export function visitedByRow(visits, overrides = new Map()) {
  const out = new Map();
  for (const raw of visits) {
    const v = effectiveVisit(raw, overrides.get(raw.company_key));
    const key = `${VISIT_TYPE[v.matched_type]}:${v.matched_id}`;
    const prior = out.get(key);
    if (!prior || v.pulled_on > prior.pulled_on) out.set(key, { last_visit: v.last_visit || v.pulled_on, visits_7d: v.visits_7d ?? null, pulled_on: v.pulled_on, priority: pInt(v.priority) });
  }
  return out;
}

// Open to-dos and open "waiting on them" per row, newest carried copy only.
export function openWorkByRow(linked, today) {
  const out = new Map();
  for (const t of openFlagRows(linked)) {
    const type = LINK_ROW[t.link_type];
    if (!type) continue;
    const key = `${type}:${t.link_id}`;
    const w = out.get(key) || { todos: 0, todos_overdue: 0, waiting: 0, waiting_overdue: 0 };
    const late = !!t.due_date && t.due_date < today;
    if (t.kind === 'waiting') { w.waiting++; if (late) w.waiting_overdue++; } else { w.todos++; if (late) w.todos_overdue++; }
    out.set(key, w);
  }
  return out;
}

// An employer's last touch: its latest stage change or a linked to-do ticked
// done, whichever is later. Created / archived are not contact (FIX loop-quickfixes Q4).
export function employerTouches(oppEvents, linked) {
  const out = new Map();
  const bump = (id, at) => { if (at && (!out.has(id) || at > out.get(id))) out.set(id, at); };
  for (const e of oppEvents) if (e.event_type === 'stage_change') bump(e.opportunity_id, e.changed_at);
  for (const t of linked) if (t.link_type === 'opportunity' && t.status === 'done') bump(t.link_id, t.completed_at);
  return out;
}

// Records Intake created or touched in the last CALL_NOTE_DAYS: a partner note
// event from a call note, or a to-do a call note made, linked to the record.
export function noteTouchedRows({ noteEvents, linked, since }) {
  const out = new Set(noteEvents.map(e => `partner:${e.goal_id}`));
  for (const t of linked) if (t.source_note_id && t.created_at >= since && LINK_ROW[t.link_type]) out.add(`${LINK_ROW[t.link_type]}:${t.link_id}`);
  return out;
}

// Which channel buttons (sales-ia-v2 P1) a row shows under. 'all' = records.
function channelsOf(r, { scoutKeys, noteTouched, since, apolloLinked }) {
  const c = [];
  if (RECORD_TYPES.includes(r.type)) c.push('all');
  if (r.visited || r.type === 'visitor') c.push('website');
  if (r.type === 'signal' || scoutKeys.has(normName(r.name))) c.push('scout');
  if (r.type === 'apollo' || apolloLinked) c.push('apollo');
  if (r.type === 'partner' || r.channel === 'partner_referral') c.push('partners');
  if ((r.channel === 'call_note' && (r.created_at || '') >= since) || noteTouched.has(`${r.type}:${r.id}`)) c.push('call_notes');
  if (r.type === 'target') c.push('targets');
  return c;
}

export function buildBoard({
  partners, opportunities, targets, sequenced, memberNames, visits = [], linked = [], oppEvents = [], noteEvents = [],
  overrides = new Map(), scout = [], allVisits = [], now = Date.now(),
}, filters = {}) {
  const today = laDateString(new Date(now));
  const since = new Date(now - CALL_NOTE_DAYS * DAY).toISOString();
  const work = openWorkByRow(linked, today);
  const touches = employerTouches(oppEvents, linked);
  const setBy = (by, at) => ({ priority_set_by: by ? memberNames.get(by) || null : null, priority_set_at: at || null });
  const rows = [];
  const extra = new Map(); // row key -> fields used here only (created_at, Apollo link)
  for (const g of partners) {
    rows.push({
      type: 'partner', id: g.id, name: g.name, ...boardStage('partner', g),
      owner_team: g.owner_team || null, owner: memberNames.get(g.owner_user_id) || null, tier: g.tier || null,
      next_step: g.next_step || null, next_step_due: g.next_meeting_at || null, last_touch_at: g.last_touch_at || null,
      top: !!g.hot, record_id: g.record_id || null, channel: g.channel || 'unknown', priority: g.priority ?? null, ...setBy(g.priority_set_by, g.priority_set_at),
      covered_lives: null,
      // pipeline-quick-panel-v1: the quick panel's header; not sheet columns.
      category: g.category || null, co_owner_name: g.co_owner_name || null, no_double_touch: !!g.no_double_touch,
    });
    extra.set(`partner:${g.id}`, { created_at: g.created_at });
  }
  const employers = opportunities.filter(isEmployer);
  for (const o of employers) {
    rows.push({
      type: 'employer', id: o.id, name: o.organization, ...boardStage('employer', o),
      owner_team: o.owner_team || null, owner: o.owner || null, tier: o.tier || null,
      next_step: o.next_action || null, next_step_due: o.next_action_date || null, last_touch_at: touches.get(o.id) || null,
      top: !!o.is_top, record_id: o.record_id || null, channel: o.channel || 'unknown', priority: o.priority ?? null, ...setBy(o.priority_set_by, o.priority_set_at),
      covered_lives: o.covered_lives ?? null,
    });
    extra.set(`employer:${o.id}`, { created_at: o.created_at, apollo: !!o.apollo_account_id });
  }
  for (const t of targets) {
    const stage = boardStage('target', t);
    if (!stage) continue;
    rows.push({
      type: 'target', id: t.id, name: t.name, ...stage, owner_team: t.owner_team || null, owner: null, tier: null,
      next_step: null, next_step_due: null, last_touch_at: null, top: false, record_id: t.record_id || null,
      channel: t.channel || 'unknown', priority: null, priority_set_by: null, priority_set_at: null, covered_lives: null,
    });
    extra.set(`target:${t.id}`, { created_at: t.created_at });
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
        channel: 'apollo_outbound', priority: null, priority_set_by: null, priority_set_at: null, covered_lives: null,
      });
    }
  }
  const visited = visitedByRow(visits, overrides);
  for (const r of rows) r.visited = visited.get(`${r.type}:${r.id}`) || null;

  // sales-ia-v2 P1: unmatched website visitors (last 7 days) and Scout
  // signals no record carries yet are rows of their own.
  const names = new Set(rows.map(r => normName(r.name)));
  const latestVisit = new Map();
  for (const v of allVisits) if (!v.matched_id && (!latestVisit.has(v.company_key) || v.pulled_on > latestVisit.get(v.company_key).pulled_on)) latestVisit.set(v.company_key, v);
  for (const raw of latestVisit.values()) {
    const o = overrides.get(raw.company_key);
    const v = effectiveVisit(raw, o);
    rows.push({
      type: 'visitor', id: v.company_key, name: v.company_name || v.company_key, stage: 'visited', stage_label: 'Website visit', color: 'light',
      owner_team: null, owner: null, tier: null, next_step: null, next_step_due: null, last_touch_at: null, top: false, record_id: null,
      channel: 'website_visit', priority: pInt(v.priority), priority_set_by: o ? memberNames.get(o.set_by) || null : null, priority_set_at: o?.set_at || null,
      not_a_fit: !!o?.not_a_fit, priority_rule: v.priority_rule || null, covered_lives: null,
      visited: { last_visit: v.last_visit || v.pulled_on, visits_7d: v.visits_7d ?? null, pulled_on: v.pulled_on, priority: pInt(v.priority) },
    });
    names.add(raw.company_key);
  }
  const scoutKeys = new Set(scout.map(s => s.company_key));
  const latestSignal = new Map();
  for (const s of scout) if (!latestSignal.has(s.company_key) || s.created_at > latestSignal.get(s.company_key).created_at) latestSignal.set(s.company_key, s);
  for (const s of latestSignal.values()) {
    if (names.has(s.company_key)) continue;
    rows.push({
      type: 'signal', id: s.id, name: s.company_name, stage: s.status, stage_label: s.status === 'new' ? 'New signal' : s.status === 'dismissed' ? 'Signal dismissed' : 'Signal accepted', color: 'light',
      owner_team: s.upside_joint ? 'both' : null, owner: null, tier: null, next_step: null, next_step_due: null, last_touch_at: null, top: false, record_id: null,
      channel: 'scout', priority: null, priority_set_by: null, priority_set_at: null, covered_lives: null, visited: null,
    });
  }

  const noteTouched = noteTouchedRows({ noteEvents, linked, since });
  for (const r of rows) {
    const key = `${r.type}:${r.id}`;
    const x = extra.get(key) || {};
    r.work = work.get(key) || null;
    r.channels = channelsOf({ ...r, created_at: x.created_at }, { scoutKeys, noteTouched, since, apolloLinked: !!x.apollo });
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

async function loadBoard(businessId, filters) {
  const supabase = getSupabase();
  const now = Date.now();
  const weekAgo = addDays(laDateString(new Date(now)), -7);
  const all = (table, cols, narrow = x => x) => selectAllPages(() => narrow(supabase.from(table).select(cols).eq('business_id', businessId)));
  const [partners, opportunities, targets, sequenced, members, allVisits, linked, oppEvents, noteEvents, overrides, scout] = await Promise.all([
    all('sales_goals', 'id, name, category, tier, pipeline_status, hot, next_step, next_meeting_at, last_touch_at, owner_user_id, owner_team, co_owner_name, no_double_touch, record_id, channel, priority, priority_set_by, priority_set_at, created_at',
      x => x.eq('goal_type', 'partnership').is('archived_at', null).order('id')),
    all('sales_opportunities', 'id, organization, org_type, stage, owner, owner_team, tier, next_action, next_action_date, is_top, record_id, apollo_account_id, channel, priority, priority_set_by, priority_set_at, covered_lives, created_at',
      x => x.is('archived_at', null).order('id')),
    all('sales_targets', 'id, name, status, owner_team, record_id, channel, created_at', x => x.in('status', ['proposed', 'researching']).order('id')),
    filters.includeApollo ? all('sales_sequenced_accounts', 'account_id, name, first_sequenced_at', x => x.order('account_id')) : [],
    supabase.from('business_members').select('user_id, name, profile:profiles!business_members_user_id_fkey(display_name)')
      .eq('business_id', businessId).not('user_id', 'is', null),
    all('web_visits', 'id, company_key, company_name, matched_type, matched_id, last_visit, visits_7d, priority, priority_rule, noise_reason, pulled_on', x => x.gte('pulled_on', weekAgo).order('id')),
    all('sales_week_goals', 'id, kind, status, due_date, link_type, link_id, carried_from_id, completed_at, source_note_id, created_at',
      x => x.in('kind', ['todo', 'waiting']).in('link_type', Object.keys(LINK_ROW)).order('id')),
    all('sales_opportunity_events', 'opportunity_id, event_type, changed_at', x => x.eq('event_type', 'stage_change').order('id')),
    all('sales_partner_events', 'id, goal_id', x => x.not('meta->>from_note_id', 'is', null).gte('at', new Date(now - CALL_NOTE_DAYS * DAY).toISOString()).order('id')),
    loadOverrides(supabase, businessId),
    all('sales_signals', 'id, company_key, company_name, status, upside_joint, created_at', x => x.eq('source', 'scout').order('id')),
  ]);
  if (members.error) throw new Error(members.error.message);
  const memberNames = new Map(members.data.map(m => [m.user_id, m.profile?.display_name || m.name]));
  const visits = allVisits.filter(v => v.matched_id);
  return buildBoard({ partners, opportunities, targets, sequenced, memberNames, visits, allVisits, linked, oppEvents, noteEvents, overrides, scout, now }, filters);
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
// color as the fill. Apollo-only, visitor and signal rows never go out, and free text is scrubbed
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
  const ordered = [...rows.filter(r => r.top), ...rows.filter(r => !r.top)].filter(r => RECORD_TYPES.includes(r.type));
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
