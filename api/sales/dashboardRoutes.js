import { getSupabase, addDays } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { laDateString } from './laDate.js';
import { MONTHLY_CREDIT_CAP, monthSpend } from './visitPull.js';
import { STAGE_ORDER, SIDE_LANES, STAGE_LABELS } from '../../src/components/salesAnalytics/pipelineStages.js';
import { boardStage, BOARD_COLOR_IDS } from '../../src/constants/pipelineBoard.js';
import { PIPELINE_STATUSES } from '../../src/constants/partnerPipeline.js';
import { CHANNEL_IDS, CHANNEL_LABEL } from '../../src/constants/salesChannels.js';
import { OWNER_TEAMS } from '../../src/constants/ownership.js';

// sales-ia-v2 D1 - the Dashboard's 13 charts, aggregated here so the page
// makes one read. Nothing is written. Range = the last `days` LA days
// (7 | 30 | 90) ending today; snapshot charts (pipeline, partners, companies,
// covered lives) ignore it and say "as of today". Owner = a member's user id
// (partners by owner_user_id, employers by the owner name, to-dos, meetings
// through their record); Team = owner_team. Visitors, signals, outreach and
// credits have no owner, so they stay team-wide whatever the filter says - the
// page labels them. Meetings = stage moves counted from history (partner
// events to Meeting set, employer events to Meeting), never a typed number.
// Replies = every Apollo reply; there is no "positive" class yet.

export const RANGES = [7, 30, 90];
export const VISITOR_HISTORY_DAYS = 30;
const DAY = 864e5;
const err = (status, error) => Object.assign(new Error(error), { status });
const must = r => { if (r.error) throw err(500, r.error.message); return r.data; };
export const laMonday = d => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));
const laDayOf = iso => laDateString(new Date(iso));
const sum = (rows, f) => rows.reduce((n, r) => n + (Number(f(r)) || 0), 0);
const SIGNAL_LABEL = { scout: 'Scout', web_visit: 'Website' };

function daysBetween(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
export function weeksBetween(from, to) {
  const out = [];
  for (let w = laMonday(from); w <= to; w = addDays(w, 7)) out.push(w);
  return out;
}

// The employer rows' owner is a typed name; a member matches on the full name or the first name.
export function ownerMatcher(members, ownerId) {
  const m = members.find(x => x.user_id === ownerId);
  if (!m) return () => false;
  const names = new Set([m.name, m.name.split(' ')[0]].map(s => s.trim().toLowerCase()));
  return name => !!name && names.has(String(name).trim().toLowerCase());
}
// 'both' rows belong to each team, so a HomeLover or Upside filter keeps them.
const inTeam = (team, rowTeam) => !team || rowTeam === team || (team !== 'both' && rowTeam === 'both');

export function buildDashboard({ today, days, owner = null, team = null, members = [], partners = [], opportunities = [], targets = [], visits = [], signals = [], emails = [], partnerEvents = [], oppEvents = [], weekRows = [], waiting = [], creditsUsed = 0, firstPull = null }) {
  const from = addDays(today, -(days - 1));
  const week = laMonday(today);
  const isOwnerName = ownerMatcher(members, owner);
  const keepPartner = p => (!owner || p.owner_user_id === owner) && inTeam(team, p.owner_team);
  const keepOpp = o => (!owner || isOwnerName(o.owner)) && inTeam(team, o.owner_team);
  const keepTarget = t => !owner && inTeam(team, t.owner_team);
  const myPartners = partners.filter(keepPartner);
  const myOpps = opportunities.filter(keepOpp);
  const myTargets = targets.filter(keepTarget);
  const partnerIds = new Set(myPartners.map(p => p.id));
  const oppIds = new Set(myOpps.map(o => o.id));
  const dayList = daysBetween(from, today);
  const weekList = weeksBetween(from, today);
  const weekOf = iso => laMonday(laDayOf(iso));
  const inRange = iso => { const d = laDayOf(iso); return d >= from && d <= today; };
  const emptyWeeks = fields => Object.fromEntries(weekList.map(w => [w, Object.fromEntries(fields.map(f => [f, 0]))]));

  const stageIds = [...STAGE_ORDER, ...SIDE_LANES];
  const pipeline_by_stage = stageIds.map(id => ({ id, label: STAGE_LABELS[id], count: myOpps.filter(o => o.stage === id).length }))
    .filter(s => STAGE_ORDER.includes(s.id) || s.count > 0);
  const covered_lives_by_stage = stageIds.map(id => ({ id, label: STAGE_LABELS[id], lives: sum(myOpps.filter(o => o.stage === id), o => o.covered_lives) }))
    .filter(s => STAGE_ORDER.includes(s.id) || s.lives > 0);

  const ownerRows = [...members.map(m => ({ owner_user_id: m.user_id, name: m.name })), { owner_user_id: null, name: 'Unassigned' }]
    .filter(r => !owner || r.owner_user_id === owner);
  const partners_by_status_owner = ownerRows.map(r => ({
    ...r, counts: Object.fromEntries(PIPELINE_STATUSES.map(s => [s.id, myPartners.filter(p => (p.owner_user_id || null) === r.owner_user_id && (p.pipeline_status || 'not_started') === s.id).length])),
  })).filter(r => r.owner_user_id !== null || Object.values(r.counts).some(Boolean));

  const byCategory = new Map();
  for (const p of myPartners) { const k = p.category || 'Uncategorized'; byCategory.set(k, (byCategory.get(k) || 0) + 1); }
  const partners_by_category = [...byCategory].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

  // A day without a pull is null (unknown), not zero; a pull with no visitors is 0.
  const pulledDays = new Set(visits.map(v => v.pulled_on));
  const visitors_per_day = dayList.map(day => ({ day, companies: pulledDays.has(day) ? new Set(visits.filter(v => v.pulled_on === day).map(v => v.company_key)).size : null }));
  const visitors_by_priority_day = dayList.map(day => (!pulledDays.has(day) ? { day, P1: null, P2: null, P3: null, P4: null }
    : { day, ...Object.fromEntries(['P1', 'P2', 'P3', 'P4'].map(p => [p, new Set(visits.filter(v => v.pulled_on === day && v.priority === p).map(v => v.company_key)).size])) }));
  const history_days = firstPull ? Math.floor((Date.parse(today) - Date.parse(firstPull)) / DAY) + 1 : 0;

  const outreach = emptyWeeks(['sent', 'opened', 'clicked', 'replied']);
  for (const e of emails) {
    const w = outreach[laMonday(e.day)];
    if (!w || e.day < from || e.day > today) continue;
    w.sent += (e.delivered || 0) + (e.hard_bounced || 0) + (e.spam_blocked || 0); w.opened += e.opened || 0; w.clicked += e.clicked || 0; w.replied += e.replied || 0;
  }
  const outreach_per_week = weekList.map(w => ({ week_start: w, ...outreach[w] }));

  const undone = new Set(partnerEvents.filter(e => e.event === 'undo').map(e => e.meta?.undid).filter(Boolean));
  const rm = emptyWeeks(['replies', 'meetings']);
  for (const w of weekList) rm[w].replies = outreach[w].replied;
  for (const e of partnerEvents) {
    if (e.event !== 'status' || e.to_status !== 'meeting_set' || undone.has(e.id) || !partnerIds.has(e.goal_id) || !inRange(e.at)) continue;
    rm[weekOf(e.at)].meetings += 1;
  }
  for (const e of oppEvents) {
    if (e.event_type !== 'stage_change' || e.to_stage !== 'meeting' || !oppIds.has(e.opportunity_id) || !inRange(e.changed_at)) continue;
    rm[weekOf(e.changed_at)].meetings += 1;
  }
  const replies_meetings_per_week = weekList.map(w => ({ week_start: w, ...rm[w] }));

  const signalRows = signals.filter(s => inRange(s.created_at));
  const signals_by_channel = ['scout', 'web_visit'].map(source => ({
    source, label: SIGNAL_LABEL[source], ...Object.fromEntries(['new', 'accepted', 'dismissed'].map(st => [st, signalRows.filter(s => s.source === source && s.status === st).length])),
  }));

  const companies = [
    ...myPartners.map(p => ({ channel: p.channel || 'unknown', band: boardStage('partner', p)?.color })),
    ...myOpps.map(o => ({ channel: o.channel || 'unknown', band: boardStage('employer', o)?.color })),
    ...myTargets.map(t => ({ channel: t.channel || 'unknown', band: boardStage('target', t)?.color })),
  ].filter(c => c.band);
  const companies_by_channel_stage = CHANNEL_IDS.map(channel => ({
    channel, label: CHANNEL_LABEL[channel], bands: Object.fromEntries(BOARD_COLOR_IDS.map(b => [b, companies.filter(c => c.channel === channel && c.band === b).length])),
  })).filter(r => Object.values(r.bands).some(Boolean));

  const todoDone = t => t.status === 'done' || (t.steps?.length > 0 && t.steps.every(s => s.done));
  const todos = weekRows.filter(t => t.kind === 'todo' && t.week_start === week && t.status !== 'dropped' && !t.prospect_contact_id);
  const todos_per_owner = ownerRows.map(r => {
    const mine = todos.filter(t => (t.owner_user_id || null) === r.owner_user_id);
    return { ...r, done: mine.filter(todoDone).length, open: mine.filter(t => !todoDone(t)).length };
  }).filter(r => r.owner_user_id !== null || r.done + r.open > 0);

  const openWaiting = waiting.filter(w => w.kind === 'waiting' && w.status === 'open');
  const waitingOn = { open: openWaiting.length, overdue: openWaiting.filter(w => w.due_date && w.due_date < today).length };

  return {
    today, days, from, week_start: week, month: today.slice(0, 7), owner, team,
    history_start: firstPull, history_days, history_full: history_days >= VISITOR_HISTORY_DAYS,
    members: members.map(m => ({ user_id: m.user_id, name: m.name })),
    pipeline_by_stage, partners_by_status_owner, partners_by_category, visitors_per_day, visitors_by_priority_day,
    outreach_per_week, replies_meetings_per_week, signals_by_channel, companies_by_channel_stage, todos_per_owner,
    waiting: waitingOn, covered_lives_by_stage,
    credits: { used: creditsUsed, cap: MONTHLY_CREDIT_CAP, month: today.slice(0, 7), all_businesses: true },
  };
}

export function parseDashboardQuery(query = {}) {
  const days = query.days == null || query.days === '' ? 30 : Number(query.days);
  if (!RANGES.includes(days)) return { error: `days must be one of ${RANGES.join('|')}` };
  const team = query.team || null;
  if (team && !OWNER_TEAMS.includes(team)) return { error: `team must be one of ${OWNER_TEAMS.join('|')}` };
  return { days, owner: query.owner || null, team };
}

// GET /goals/dashboard?days=7|30|90&owner=<user id>&team=homelover|upside|both
export async function loadDashboard(supabase, businessId, { days, owner, team }, now = new Date()) {
  const today = laDateString(now);
  const from = addDays(today, -(days - 1));
  const fromIso = `${from}T00:00:00-08:00`; // the LA day starts no earlier than 00:00 PST; the builder trims to LA dates exactly
  const week = laMonday(today);
  // Every table but the email counts has an id; that one's primary key is (day, mailbox, sequence_id, step).
  const all = (table, cols, narrow = q => q, order = ['id']) => selectAllPages(() => order.reduce((q, k) => q.order(k), narrow(supabase.from(table).select(cols).eq('business_id', businessId))));
  const [members, partners, opportunities, targets, visits, signals, emails, partnerEvents, oppEvents, weekRows, waiting, firstPullRows, creditsUsed] = await Promise.all([
    supabase.from('business_members').select('user_id, name').eq('business_id', businessId).not('user_id', 'is', null).order('created_at').then(must),
    all('sales_goals', 'id, name, category, pipeline_status, owner_user_id, owner_team, channel', q => q.eq('goal_type', 'partnership').is('archived_at', null)),
    all('sales_opportunities', 'id, organization, stage, owner, owner_team, channel, covered_lives', q => q.is('archived_at', null)),
    all('sales_targets', 'id, name, status, owner_team, channel', q => q.in('status', ['proposed', 'researching'])),
    all('web_visits', 'id, pulled_on, company_key, priority', q => q.gte('pulled_on', from)),
    all('sales_signals', 'id, source, status, created_at', q => q.gte('created_at', fromIso)),
    all('sales_email_daily_counts', 'day, mailbox, sequence_id, step, delivered, hard_bounced, spam_blocked, opened, clicked, replied', q => q.gte('day', from), ['day', 'mailbox', 'sequence_id', 'step']),
    all('sales_partner_events', 'id, goal_id, event, to_status, at, meta', q => q.gte('at', fromIso)),
    all('sales_opportunity_events', 'id, opportunity_id, event_type, to_stage, changed_at', q => q.gte('changed_at', fromIso)),
    all('sales_week_goals', 'id, kind, status, owner_user_id, week_start, prospect_contact_id', q => q.eq('week_start', week).eq('kind', 'todo')),
    all('sales_week_goals', 'id, kind, status, due_date', q => q.eq('kind', 'waiting').eq('status', 'open')),
    supabase.from('web_visits').select('pulled_on').eq('business_id', businessId).order('pulled_on').limit(1).then(must),
    monthSpend(supabase, today.slice(0, 7)),
  ]);
  const todoIds = weekRows.map(r => r.id);
  const steps = todoIds.length ? await all('sales_week_goal_steps', 'id, goal_id, done', q => q.in('goal_id', todoIds)) : [];
  for (const r of weekRows) r.steps = steps.filter(st => st.goal_id === r.id);
  return buildDashboard({ today, days, owner, team, members, partners, opportunities, targets, visits, signals, emails, partnerEvents, oppEvents, weekRows, waiting, creditsUsed, firstPull: firstPullRows[0]?.pulled_on || null });
}

export async function dashboardRoute(req, res) {
  const q = parseDashboardQuery(req.query);
  if (q.error) return res.status(400).json({ error: q.error });
  try { res.json(await loadDashboard(getSupabase(), req.params.businessId, q)); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}
