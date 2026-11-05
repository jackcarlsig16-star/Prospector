import { getSupabase, addDays } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { laDateString } from './laDate.js';
import { openFlagRows } from './huddleFlags.js';
import { DUE_DAYS, RULE_TEXT } from './tidyRules.js';
import { employerTouches } from './pipelineBoard.js';
import { boardStage } from '../../src/constants/pipelineBoard.js';
import { TEAM_LABEL } from '../../src/constants/ownership.js';
import { campaignActionRows } from './outreachRoutes.js';
import { itemUrgency, BAND_ORDER } from './priority.js';
import { openTodosFor, weekEndOf, todoGroup, todoDone } from './openTodos.js';

// sales-ia-v2 A1 - Actions: one ranked list of everything that wants a click
// today, each from the table that already holds it (nothing is written here):
// open waiting-on rows that are overdue, this week's open to-dos, open flags,
// this week's Focus 5 (planned commitments, done ones included so the screen
// can fold them) and campaign sends due + unanswered campaign replies
// (seif-campaign-v1 B4/B5; a reply is always P1).
// homelover-flow-v1 F10 - Actions is "my list": web_visit signals are gone from it (they are the Map's NEW ring and the
// Pipeline's NEW badge; Accept / Not a fit live on the panel and the Map) and Tidy suggestions leave the ranked list for
// one collapsed "Tidy (n)" group (tidy below). Every item carries due_group: today | week | later | nodate.
// FIX actions-all-weeks-v1 A1: to-dos come from openTodosFor (every open one, any week_start, TODO_CAP rows); due_group
// goes by the DUE DATE for a to-do (today = due today or overdue, week = through this LA Sunday, later, nodate); every
// other kind keeps its band's group. Focus 5 commitments still read this week's week_start.
// actions-v2 REV2 A2: every row carries a band (priority.js itemUrgency: now / today / week / housekeeping) and
// the list is ordered band -> company P (company_p; none last) -> due date -> age. priority = the chip: the
// company's own P1-P4 when the item points at a partner or employer that has one, else the kind's default below
// (shown, never used to order).

export const KINDS = ['waiting', 'todo', 'flag', 'focus', 'campaign'];
export const KIND_LABEL = { tidy: 'Tidy', waiting: 'Waiting on', todo: 'To-do', flag: 'Flag', focus: 'Focus', campaign: 'Campaign' };
const DEFAULT_PRIORITY = { flag: 1, waiting: 2, focus: 2, tidy: 3, campaign: 2 };
const DUE_GROUP = { now: 'today', today: 'today', week: 'week', housekeeping: 'later' };
const CAMPAIGN_LINK = [['goal_id', 'partner'], ['opportunity_id', 'opportunity'], ['target_id', 'target']];
export const campaignLink = c => CAMPAIGN_LINK.map(([col, type]) => (c[col] ? { type, id: c[col] } : null)).find(Boolean) || null;
const TIDY_PRIORITY = { visited_no_touch: 2, nudge: 2 };
const DAY = 864e5;
const err = (status, error) => Object.assign(new Error(error), { status });
const must = r => { if (r.error) throw err(500, r.error.message); return r.data; };
const lateDays = (due, today) => Math.round((Date.parse(today) - Date.parse(due)) / DAY);
const laMonday = today => addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));

// link_type / match.type -> the company panel's row type.
const PANEL_TYPE = { partner: 'partner', opportunity: 'employer', target: 'target', company: 'apollo' };

export function buildActions({ todos = [], flags = [], waiting = [], suggestions = [], commitments = [], refTodos = [], campaign = null, notes = new Map(), companies, members = new Map(), today }) {
  const weekEnd = weekEndOf(today);
  const company = (type, id) => {
    const t = PANEL_TYPE[type];
    const c = t && companies[t]?.get(id);
    return c ? { type: t, id, name: c.name, priority: c.priority ?? null, stage_label: c.stage_label || null, owner: c.owner || null, last_touch_at: c.last_touch_at || null } : null;
  };
  const linkCompany = row => (row.link_type ? company(row.link_type, row.link_id) : null);
  const first = id => (members.get(id) || '').split(' ')[0] || null;
  const items = [];
  const push = (kind, row, fields) => {
    const c = fields.company === undefined ? linkCompany(row) : fields.company;
    const due = fields.due_date === undefined ? row.due_date || null : fields.due_date;
    const overdue = !!due && due < today;
    items.push({
      key: `${kind}-${row.id}`, kind, id: row.id, text: fields.text, why: fields.why || null, company: c,
      due_date: due, overdue, late_days: overdue ? lateDays(due, today) : 0,
      owner_user_id: fields.owner_user_id === undefined ? row.owner_user_id || null : fields.owner_user_id,
      priority: fields.fixed_priority ? fields.priority : c?.priority || fields.priority, status: fields.status || 'open', created_at: row.created_at, meta: fields.meta || {},
      company_p: fields.company_p !== undefined ? fields.company_p : c?.priority ?? null,
      band: itemUrgency(kind, { overdue, due_date: due, today, ...fields.urgency }),
    });
    const it = items[items.length - 1];
    it.due_group = kind === 'todo' ? todoGroup(due, today, weekEnd) : DUE_GROUP[it.band] || 'later';
  };

  const lateWaiting = waiting.filter(w => w.status === 'open' && w.due_date && w.due_date < today);
  const waitingIds = new Set(lateWaiting.map(w => w.id));
  for (const w of lateWaiting) {
    push('waiting', w, { text: `Waiting on ${w.waiting_on || 'them'}: ${w.text}`, why: `${lateDays(w.due_date, today)} d late`, priority: DEFAULT_PRIORITY.waiting, owner_user_id: null, meta: { waiting_on: w.waiting_on, text: w.text } });
  }

  const refById = new Map(refTodos.map(t => [t.id, t]));
  for (const s of suggestions) {
    if (s.status !== 'proposed') continue;
    if (s.kind === 'nudge' && waitingIds.has(s.ref_id)) continue; // the waiting row itself is on the list, with Got it / Nudge
    const ref = ['todo', 'flag'].includes(s.ref_type) ? refById.get(s.ref_id) : null;
    const c = s.ref_type === 'pair' ? company('partner', s.ref_id) : ref ? linkCompany(ref) : company(s.ref_type, s.ref_id);
    // makes_todo: Accept would create a to-do (FIX actions-done-button-v1: only then can the row be marked Done).
    push('tidy', s, { text: s.text, why: s.reason, company: c, priority: TIDY_PRIORITY[s.kind] || DEFAULT_PRIORITY.tidy, owner_user_id: null, due_date: null, urgency: { tidy_kind: s.kind }, meta: { kind: s.kind, rule: RULE_TEXT[s.kind] || null, ref_type: s.ref_type, ref_id: s.ref_id, ref_id2: s.ref_id2, makes_todo: s.ref_type !== 'pair' && DUE_DAYS[s.kind] != null } });
  }

  const flagIds = new Set(flags.map(f => f.id));
  for (const f of flags) {
    push('flag', f, { urgency: { flag_age_days: f.created_at ? (Date.parse(`${today}T12:00:00Z`) - Date.parse(f.created_at)) / DAY : null }, text: f.text, why: `Flagged by ${first(f.flagged_by) || 'a teammate'}${f.flag_note ? ` · “${f.flag_note}”` : ''}`, priority: DEFAULT_PRIORITY.flag, meta: { contact: f.contacts?.[0] || null, prospect_contact_id: f.prospect_contact_id, flagged_by: f.flagged_by, flagged_by_name: first(f.flagged_by), flag_note: f.flag_note || null } });
  }

  for (const t of todos) {
    if (t.kind !== 'todo' || flagIds.has(t.id) || t.prospect_contact_id || t.status !== 'open' || todoDone(t)) continue;
    const soon = t.due_date && t.due_date <= today;
    push('todo', t, { text: t.text, why: t.category || (t.source_note_id ? 'From call notes' : null), priority: soon ? 2 : 3, meta: { category: t.category, link_type: t.link_type, link_id: t.link_id, from_note: !!t.source_note_id, note_date: notes.get(t.source_note_id) || null } });
  }

  for (const c of commitments) {
    if (c.kind !== 'commitment' || !c.plan_id || c.status === 'dropped') continue;
    push('focus', c, { text: c.text, why: c.plan_reason || 'Focus 5', company: null, priority: DEFAULT_PRIORITY.focus, due_date: null, status: c.status, meta: { plan_rank: c.plan_rank } });
  }

  if (campaign) {
    const linked = r => { const l = campaignLink(r); return l ? company(l.type, l.id) : null; };
    const metaOf = (r, action) => {
      const k = campaign.campaigns.get(r.campaign_id), t = campaign.tracks.get(r.track_id);
      return { action, campaign_id: r.campaign_id, campaign: k?.name || null, track: t?.name || null, name: r.name, segment: r.segment, step_no: r.current_step, steps: t?.steps.length || null, company_name: r.company || null, title: r.title || null, last_sent_at: r.last_sent_at, replied_at: r.replied_at, conflict: r.conflict };
    };
    const at = r => (r.company ? ` (${r.company})` : '');
    for (const r of campaign.sends) {
      const m = metaOf(r, 'send');
      push('campaign', r, { urgency: { campaign_action: 'send' }, text: `Send step ${r.current_step} to ${r.name}${at(r)}`, why: [m.campaign, m.track].filter(Boolean).join(' · '), company: linked(r), priority: DEFAULT_PRIORITY.campaign, due_date: r.next_due_date, meta: m });
    }
    for (const r of campaign.replies) {
      const m = metaOf(r, 'reply');
      push('campaign', r, { urgency: { campaign_action: 'reply' }, text: `Reply from ${r.name}${at(r)} — respond`, why: m.campaign, company: linked(r), priority: 1, fixed_priority: true, due_date: null, meta: m });
    }
  }
  const tidy = rankActions(items.filter(i => i.kind === 'tidy'));
  return Object.assign(rankActions(items.filter(i => i.kind !== 'tidy')), { tidy });
}

const pRank = p => p ?? 9;
export function rankActions(items) {
  return [...items].sort((a, b) => (BAND_ORDER[a.band] - BAND_ORDER[b.band]) || (pRank(a.company_p) - pRank(b.company_p))
    || ((a.due_date == null) - (b.due_date == null)) || (a.due_date && b.due_date ? a.due_date.localeCompare(b.due_date) : 0)
    || String(a.created_at || '').localeCompare(String(b.created_at || '')));
}

// GET /goals/actions -> { items, tidy: { count, items }, groups: { today, week, later, nodate }, todos: { total, shown }, today, week_start }
export async function listActions(supabase, businessId, now = new Date()) {
  const today = laDateString(now);
  const week = laMonday(today);
  const all = (table, cols, narrow) => selectAllPages(() => narrow(supabase.from(table).select(cols).eq('business_id', businessId)).order('id'));
  const [openTodos, commitments, flagRows, waiting, suggestions, memberRows, campaign] = await Promise.all([
    openTodosFor(supabase, businessId),
    all('sales_week_goals', '*', q => q.eq('week_start', week).eq('kind', 'commitment')),
    all('sales_week_goals', '*', q => q.not('prospect_contact_id', 'is', null).neq('status', 'dropped').neq('status', 'done')),
    all('sales_week_goals', '*', q => q.eq('kind', 'waiting').eq('status', 'open')),
    all('sales_suggestions', '*', q => q.eq('status', 'proposed')),
    supabase.from('business_members').select('user_id, name').eq('business_id', businessId).not('user_id', 'is', null).then(must),
    campaignActionRows(supabase, businessId, today),
  ]);
  const flags = openFlagRows(flagRows);
  const weekRows = [...openTodos.rows, ...commitments];
  const refIds = suggestions.filter(s => ['todo', 'flag'].includes(s.ref_type)).map(s => s.ref_id);
  const refTodos = refIds.length ? must(await supabase.from('sales_week_goals').select('id, link_type, link_id').eq('business_id', businessId).in('id', refIds)) : [];
  const ids = { partner: new Set(), opportunity: new Set(), target: new Set(), company: new Set() };
  const note = (type, id) => { if (ids[type] && id) ids[type].add(id); };
  for (const r of [...weekRows, ...flags, ...waiting, ...refTodos]) note(r.link_type, r.link_id);
  for (const s of suggestions) { note(s.ref_type === 'pair' ? 'partner' : s.ref_type, s.ref_id); }
  for (const r of [...campaign.sends, ...campaign.replies]) { const l = campaignLink(r); if (l) note(l.type, l.id); }
  const noteIds = [...new Set(weekRows.map(r => r.source_note_id).filter(Boolean))];
  const memberName = new Map(memberRows.map(m => [m.user_id, m.name]));
  const ownerOf = (userId, team) => (memberName.get(userId) || '').split(' ')[0] || TEAM_LABEL[team] || null;
  const pick = async (table, type, cols, map) => (ids[type].size ? (await selectAllPages(() => supabase.from(table).select(cols).eq('business_id', businessId).in(cols.split(',')[0].trim(), [...ids[type]]).order(cols.split(',')[0].trim()))).map(map) : []);
  const [partners, opportunities, targets, apollo] = await Promise.all([
    pick('sales_goals', 'partner', 'id, name, priority, pipeline_status, category, owner_user_id, owner_team, last_touch_at',
      r => [r.id, { name: r.name, priority: r.priority, stage_label: boardStage('partner', r).stage_label, owner: ownerOf(r.owner_user_id, r.owner_team), last_touch_at: r.last_touch_at }]),
    pick('sales_opportunities', 'opportunity', 'id, organization, priority, stage, owner, owner_team',
      r => [r.id, { name: r.organization, priority: r.priority, stage_label: boardStage('employer', r).stage_label, owner: (r.owner || '').split(' ')[0] || TEAM_LABEL[r.owner_team] || null }]),
    pick('sales_targets', 'target', 'id, name, status, owner_team', r => [r.id, { name: r.name, priority: null, stage_label: boardStage('target', r)?.stage_label, owner: TEAM_LABEL[r.owner_team] || null }]),
    pick('sales_sequenced_accounts', 'company', 'account_id, name, first_sequenced_at', r => [r.account_id, { name: r.name || r.account_id, priority: null, stage_label: boardStage('apollo', r).stage_label, last_touch_at: r.first_sequenced_at }]),
  ]);
  // Employer last touch = the Pipeline's: the latest stage event or done linked to-do (FIX actions-row-detail-v1).
  const oppIds = [...ids.opportunity];
  const [oppEvents, oppDone, noteRows] = await Promise.all([
    oppIds.length ? all('sales_opportunity_events', 'opportunity_id, event_type, changed_at', q => q.in('opportunity_id', oppIds).eq('event_type', 'stage_change')) : [],
    oppIds.length ? all('sales_week_goals', 'link_type, link_id, status, completed_at', q => q.eq('link_type', 'opportunity').in('link_id', oppIds).eq('status', 'done')) : [],
    noteIds.length ? all('sales_call_notes', 'id, call_date', q => q.in('id', noteIds)) : [],
  ]);
  const oppTouch = employerTouches(oppEvents, oppDone);
  for (const [id, c] of opportunities) c.last_touch_at = oppTouch.get(id) || null;
  const companies = { partner: new Map(partners), employer: new Map(opportunities), target: new Map(targets), apollo: new Map(apollo) };
  const items = buildActions({
    todos: openTodos.rows, commitments, flags, waiting, suggestions, refTodos, campaign,
    notes: new Map(noteRows.map(n => [n.id, n.call_date])), companies, members: memberName, today,
  });
  const groups = Object.fromEntries(['today', 'week', 'later', 'nodate'].map(g => [g, items.filter(i => i.due_group === g).length]));
  return { items: [...items], tidy: { count: items.tidy.length, items: items.tidy }, groups, todos: { total: openTodos.total, shown: openTodos.rows.length }, today, week_start: week };
}
export async function listActionsRoute(req, res) {
  try { res.json(await listActions(getSupabase(), req.params.businessId)); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}
