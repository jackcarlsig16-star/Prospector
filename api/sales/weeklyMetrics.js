import { addDays, laMonday, laStartOfDayMs } from './goalsShared.js';
import { windowValues } from './pulseMath.js';
import { funnelWindow, FUNNEL_SINCE } from './funnelMath.js';
import { partnerWeekMetrics } from './partnerMetrics.js';

// weekly-funnel-v1 Stage 1 - the ONE metric registry (W1), the weekly series (W2) and the pace rule (W4), pure over
// rows the route loads. Every row's number is an existing function over a from/to window (LA days) - never a second
// formula: the email rows + meetings + people first-touched through pulseMath.windowValues (scorecardMath inside, the
// Scorecard's digits for a whole week), the site rows through funnelMath.funnelWindow, the partner rows through
// partnerMetrics.partnerWeekMetrics, the stock rows through the Scorecard's lastSyncedValue (read by the route into
// ctx.synced). Top-target pins had no formula anywhere: pinsMade below is its one. LinkedIn is typed
// (sales_manual_metrics) - an empty cell is null, never 0.
//   unit       count | rate (a rate is a 0-1 share)
//   kind       flow (adds up over the week: paced) | stock (a level: never paced) | manual (typed: never paced)
//   direction  which way is good - it picks the arrow glyph, nothing else
// A week before a row's data began is null (the funnel's delivered rows start FUNNEL_SINCE, pins PINS_SINCE).
export const WEEKS_DEFAULT = 12, WEEKS_MIN = 2, WEEKS_MAX = 26;
export const PINS_SINCE = '2026-11-09';
export const GROUPS = ['Outbound', 'Site', 'Pipeline', 'LinkedIn'];
export const SYNCED = { total_in_sequence: 'prospects_in_cadence', sequences_running: 'sequences_active' };
export const WORDING = {
  week: 'A week runs Monday to Sunday, Pacific time.',
  pace: 'Pace = this week to date ÷ the share of the week gone (whole days, today included), for counts only - rates and levels are never projected. This week is always read against the same point last week, never against a full week.',
  goals: 'A week goal is typed by the owner before or during its week; a week that has ended takes no new goal.',
  manual: 'LinkedIn numbers are typed by a member for this week or last week; a cell nobody typed is empty, not zero.',
};
export const WEEK_ENDED_ERROR = 'That week has ended - a goal is set before or during its week';

const memo = (ctx, key, f) => { if (!ctx.memo.has(key)) ctx.memo.set(key, f()); return ctx.memo.get(key); };
const pulse = (ctx, from, to) => memo(ctx, `p|${from}|${to}`, () => windowValues({ from, to }, ctx.pulse));
const funnel = (ctx, from, to) => (from < FUNNEL_SINCE ? null : memo(ctx, `f|${from}|${to}`, () => funnelWindow(ctx.funnel, from, to)));
const partner = (ctx, from, to) => memo(ctx, `g|${from}|${to}`, () => partnerWeekMetrics(ctx.partnerData, laMonday(from), null, ctx.now, laStartOfDayMs(addDays(to, 1))));
const synced = key => (ctx, from, to) => ctx.synced.get(`${key}|${from}|${to}`) ?? null;
const typed = key => (ctx, from) => { const v = ctx.manual.get(`${key}|${from}`)?.value; return v == null ? null : Number(v); };

// Pins made (top-targets-v1): an employer's or a target's 'pin' flow event that was not undone, a partner's 'hot'
// event whose meta says pin (not renew, not a reason edit) that was not undone. -> [iso instant]
export function pinsMade(flowRows, partnerData) {
  return [
    ...flowRows.filter(e => e.kind === 'pin' && !e.undone_at).map(e => e.at),
    ...partnerData.events.filter(e => e.event === 'hot' && e.meta?.pin === 'pin' && !partnerData.undone.has(e.id)).map(e => e.at),
  ];
}
const pinsIn = (ctx, from, to) => {
  if (from < PINS_SINCE) return null;
  const a = laStartOfDayMs(from), b = laStartOfDayMs(addDays(to, 1));
  return ctx.pins.filter(at => { const t = Date.parse(at); return t >= a && t < b; }).length;
};

const m = (key, name, group, source, unit, kind, value, extra = {}) => ({ key, name, group, source, unit, kind, direction: 'up', goalable: true, goalKey: key, value, ...extra });
export const METRICS = [
  m('delivered', 'Delivered', 'Outbound', 'Apollo', 'count', 'flow', (c, f, t) => { const p = pulse(c, f, t); return p.rows.length ? p.delivered : null; }, { hint: 'emails delivered, by send date' }),
  m('deliverability', 'Deliverability', 'Outbound', 'Apollo', 'rate', 'flow', (c, f, t) => pulse(c, f, t).delivered_rate, { hint: 'delivered ÷ (delivered + hard bounces + spam blocks)' }),
  m('human_open_rate', 'Human open rate', 'Outbound', 'Apollo', 'rate', 'flow', (c, f, t) => pulse(c, f, t).human_open_rate, { hint: 'tracked opens ÷ delivered, bots hidden' }),
  m('human_clicks', 'Human clicks', 'Outbound', 'Apollo', 'count', 'flow', (c, f, t) => funnel(c, f, t)?.human_clicks ?? null, { hint: 'of emails sent in the week, so far' }),
  m('replies', 'Replies', 'Outbound', 'Apollo', 'count', 'flow', (c, f, t) => funnel(c, f, t)?.replies ?? null, { hint: 'of emails sent in the week, so far' }),
  m('meetings_set', 'Meetings set', 'Outbound', 'Outlook', 'count', 'flow', (c, f, t) => pulse(c, f, t).meetings, { hint: 'events with an external domain' }),
  m('total_in_sequence', 'In sequence', 'Outbound', 'Apollo', 'count', 'stock', synced('total_in_sequence'), { context: true, hint: 'people in active sequences' }),
  m('sequences_running', 'Sequences running', 'Outbound', 'Apollo', 'count', 'stock', synced('sequences_running'), { context: true, hint: 'active sequences' }),
  m('companies_visited', 'Companies visited', 'Site', 'Website', 'count', 'flow', (c, f, t) => funnel(c, f, t)?.companies_visited ?? null, { hint: 'emailed and seen on the site in the week' }),
  m('people_identified', 'People identified', 'Site', 'Website', 'count', 'flow', (c, f, t) => funnel(c, f, t)?.people_identified ?? null, { hint: 'emailed and identified on the site in the week' }),
  m('email_site_company_rate', 'Email → site company rate', 'Site', 'Website', 'rate', 'flow', (c, f, t) => funnel(c, f, t)?.company_rate.rate ?? null, { hint: 'companies visited ÷ companies emailed' }),
  m('people_first_touched', 'People first-touched', 'Pipeline', 'App', 'count', 'flow', (c, f, t) => pulse(c, f, t).first_touched, { goalKey: 'partners_first_touched', hint: 'emailed, called, met or messaged' }),
  m('tier1_touched_pct', 'Tier 1 touched', 'Pipeline', 'App', 'rate', 'stock', (c, f, t) => partner(c, f, t).tier1_touched_pct.value, { hint: 'T1 partners with any touch' }),
  m('partner_meetings', 'Partner meetings', 'Pipeline', 'App', 'count', 'flow', (c, f, t) => partner(c, f, t).partner_meetings.value, { hint: 'moved to Meeting' }),
  m('partners_pilot_live', 'Pilot / live', 'Pipeline', 'App', 'count', 'stock', (c, f, t) => partner(c, f, t).partners_pilot_live.value, { hint: 'at week end' }),
  m('top_target_pins', 'Top-target pins', 'Pipeline', 'App', 'count', 'flow', pinsIn, { hint: 'pins made in the week' }),
  m('linkedin_requests', 'Connection requests', 'LinkedIn', 'Typed', 'count', 'manual', typed('linkedin_requests')),
  m('linkedin_accepted', 'Accepted', 'LinkedIn', 'Typed', 'count', 'manual', typed('linkedin_accepted')),
  m('linkedin_replies', 'Replies', 'LinkedIn', 'Typed', 'count', 'manual', typed('linkedin_replies')),
  m('linkedin_posts', 'Posts', 'LinkedIn', 'Typed', 'count', 'manual', typed('linkedin_posts')),
];
export const MANUAL_KEYS = METRICS.filter(x => x.kind === 'manual').map(x => x.key);
export const GOAL_KEYS = [...new Set(METRICS.filter(x => x.goalable).map(x => x.goalKey))];

// ── Weeks and pace (W4) ─────────────────────────────────────────────────────
export const clampWeeks = v => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(WEEKS_MAX, Math.max(WEEKS_MIN, n)) : WEEKS_DEFAULT; };
export const weekList = (today, n = WEEKS_DEFAULT) => { const mon = laMonday(today); return Array.from({ length: n }, (_, i) => addDays(mon, -7 * (n - 1 - i))); };
export const weekEnded = (weekStart, today) => addDays(weekStart, 6) < today;
// Whole LA days into the week, today included: Monday 1 of 7 ... Sunday 7 of 7.
export const elapsedOf = today => { const days = ((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7) + 1; return { days, share: days / 7 }; };
export const samePointLastWeek = today => ({ from: addDays(laMonday(today), -7), to: addDays(today, -7) });
// "On pace for ~n": counts that add up over the week only; a rate, a level or a typed number is never projected.
export const paceOf = (metric, toDate, today) => (metric.unit !== 'count' || metric.kind !== 'flow' || toDate == null ? null : Math.round(toDate / elapsedOf(today).share));
// Every window the series reads (the route preloads the synced levels for exactly these).
export function weeklyWindows(today, n = WEEKS_DEFAULT) {
  const mon = laMonday(today);
  return [...weekList(today, n).map(w => ({ from: w, to: w === mon ? today : addDays(w, 6) })), samePointLastWeek(today)];
}

// ctx: { now, pulse: { counts, opens, deliveredAt, events, visits: [], people, now }, funnel: funnelContext(rows),
// partnerData, synced: Map 'key|from|to' -> value, pins: [iso], manual: Map 'key|week' -> row }.
// goals: Map 'week|goalKey' -> number; firstTouched: Map week -> { goal, carried } (the Scorecard's carried rule);
// names: Map user id -> first name.
export function buildWeekly(ctx, { today, weeks = WEEKS_DEFAULT, goals = new Map(), firstTouched = new Map(), names = new Map() }) {
  ctx.memo = ctx.memo || new Map();
  const list = weekList(today, weeks), mon = laMonday(today), last = addDays(mon, -7), same = samePointLastWeek(today);
  const goalOf = (x, w) => {
    if (!x.goalable) return { goal: null };
    if (x.goalKey === 'partners_first_touched') { const g = firstTouched.get(w); return { goal: g?.goal ?? null, ...(g?.carried ? { carried: true } : {}) }; }
    return { goal: goals.get(`${w}|${x.goalKey}`) ?? null };
  };
  const hit = (x, value, goal) => (value == null || goal == null ? null : x.direction === 'up' ? value >= goal : value <= goal);
  const entry = (x, w) => { const r = ctx.manual.get(`${x.key}|${w}`); return r ? { by: names.get(r.entered_by) || 'a member', at: r.entered_at, note: r.note || null } : null; };
  const metrics = METRICS.map(x => {
    const series = list.map(w => ({ week_start: w, value: x.value(ctx, w, w === mon ? today : addDays(w, 6)), ...goalOf(x, w), ...(w === mon ? { current: true } : {}) }));
    const cur = series[series.length - 1], prev = series[series.length - 2];
    const at = x.kind === 'manual' ? null : x.value(ctx, same.from, same.to);
    return {
      key: x.key, name: x.name, group: x.group, source: x.source, unit: x.unit, kind: x.kind, direction: x.direction, goalable: x.goalable, goal_key: x.goalKey, hint: x.hint || null, ...(x.context ? { context: true } : {}),
      series,
      this_week: { week_start: mon, to_date: cur.value, same_point_last_week: at, delta: cur.value == null || at == null ? null : cur.value - at, pace: paceOf(x, cur.value, today), goal: cur.goal, progress: cur.value != null && cur.goal ? cur.value / cur.goal : null },
      last_week: prev ? { week_start: last, value: prev.value, goal: prev.goal, hit: hit(x, prev.value, prev.goal) } : null,
      ...(x.kind === 'manual' ? { entered: { this_week: entry(x, mon), last_week: entry(x, last) } } : {}),
    };
  });
  return { today, week_start: mon, weeks: list, elapsed: elapsedOf(today), same_point: same, groups: GROUPS, wording: WORDING, funnel_since: FUNNEL_SINCE, pins_since: PINS_SINCE, metrics };
}
