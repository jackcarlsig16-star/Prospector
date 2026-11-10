import { getSupabase } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { laDateString } from './laDate.js';
import { seenBeforeKeys, isNewCompany } from './visitRules.js';

// visitor-trend-v1 Stage 1 (T1, rulings R1-R3, R5) - GET goals/visitors/trend?days=30: companies identified per pull
// window over the trailing days, split new / returning by the one rule (visitRules.js), with Σ visits_7d (Apollo's
// rolling count - never "visits that day").
// T1 LANDMINE (R2): the windows come from the ROWS - web_visits (seen_from, seen_to), which the pull writes once and
// never rewrites - NEVER from visit_pull_runs' window columns: a re-pull overwrites them (Nov 9: a 41-company Fri-Sun
// pull then a 23-company Nov 8-9 re-pull on the same run row) and the Oct 27 fix migration re-stamped the older ones.
// visit_pull_runs is read for ONE thing: which rows came from a backfill (kind = backfill, matched on pulled_on =
// la_date AND the backfill's own window), and those are hidden from the bars (R1) while still seeding "first seen".
// A window covers the days seen_from .. seen_to - 1 (seen_to = the pull morning); a zero-length window (seen_from =
// seen_to, the pre-Oct-27 daily pulls) covers that one day. Windows pulled on the same day whose ranges overlap merge
// into one bar (companies de-duplicated, new / returning decided once per company). Sunday pulls stay their own bars.
const DAY = 864e5;
export const DAYS_DEFAULT = 30, DAYS_MIN = 7, DAYS_MAX = 90;
const reply = (status, body) => ({ status, body });
const send = (res, r) => res.status(r.status).json(r.body);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const wd = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
const md = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const dayNum = d => Number(d.slice(8, 10));
const sameMonth = (a, b) => a.slice(0, 7) === b.slice(0, 7);

export const coveredDays = (from, to) => { const out = []; for (let d = from; d < to || out.length === 0; d = addDays(d, 1)) { out.push(d); if (d >= to) break; } return out; };
export const windowLabel = days => (days.length === 1 ? `${wd(days[0])} ${md(days[0])}`
  : `${wd(days[0])}–${wd(days[days.length - 1])} ${md(days[0])}–${sameMonth(days[0], days[days.length - 1]) ? dayNum(days[days.length - 1]) : md(days[days.length - 1])}`);

// rows: web_visits (company_key, pulled_on, seen_from, seen_to, visits_7d); runs: visit_pull_runs (la_date, kind, status,
// window_start, window_end). Pure. -> { windows, summary, since, days }
export function buildTrend({ rows, runs = [], today, days = DAYS_DEFAULT }) {
  const backfill = new Set(runs.filter(r => r.kind === 'backfill' && r.status === 'ok' && r.window_start).map(r => `${r.la_date}|${r.window_start}|${r.window_end}`));
  const isBackfill = r => backfill.has(`${r.pulled_on}|${r.seen_from}|${r.seen_to}`);
  const rangeStart = addDays(today, -(days - 1));
  const inRange = rows.filter(r => r.seen_from && r.seen_to && r.seen_to >= rangeStart && !isBackfill(r));
  // Raw windows by (pulled_on, seen_from, seen_to), then the same-day overlap merge.
  const raw = new Map();
  for (const r of inRange) { const k = `${r.pulled_on}|${r.seen_from}|${r.seen_to}`; if (!raw.has(k)) raw.set(k, { pulled_on: r.pulled_on, start: r.seen_from, end: r.seen_to, rows: [] }); raw.get(k).rows.push(r); }
  const merged = [];
  for (const w of [...raw.values()].sort((a, b) => a.pulled_on.localeCompare(b.pulled_on) || a.start.localeCompare(b.start))) {
    const hit = merged.find(m => m.pulled_on === w.pulled_on && w.start <= m.end && m.start <= w.end);
    if (hit) { hit.start = w.start < hit.start ? w.start : hit.start; hit.end = w.end > hit.end ? w.end : hit.end; hit.rows.push(...w.rows); hit.merged += 1; }
    else merged.push({ ...w, rows: [...w.rows], merged: 1 });
  }
  const windows = merged.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.pulled_on.localeCompare(b.pulled_on)).map(w => {
    const latest = new Map();
    for (const r of w.rows) { const c = latest.get(r.company_key); if (!c || r.seen_to > c.seen_to || (r.seen_to === c.seen_to && String(r.id) > String(c.id))) latest.set(r.company_key, r); }
    const seenBefore = seenBeforeKeys(rows, w.start);
    const keys = [...latest.keys()].sort();
    const fresh = keys.filter(k => isNewCompany(k, seenBefore));
    const cover = coveredDays(w.start, w.end);
    return {
      start: w.start, end: w.end, pulled_on: w.pulled_on, days: cover, label: windowLabel(cover), merged: w.merged,
      companies: keys.length, new: fresh.length, returning: keys.length - fresh.length,
      visits_7d: [...latest.values()].reduce((n, r) => n + (r.visits_7d || 0), 0),
      company_keys: keys, new_keys: fresh,
    };
  });
  const distinct = new Set(windows.flatMap(w => w.company_keys));
  const busiest = windows.reduce((b, w) => (!b || w.companies > b.companies ? w : b), null);
  const summary = {
    windows: windows.length, companies: distinct.size, company_windows: windows.reduce((n, w) => n + w.companies, 0),
    new: windows.reduce((n, w) => n + w.new, 0), returning: windows.reduce((n, w) => n + w.returning, 0),
    visits_7d: windows.reduce((n, w) => n + w.visits_7d, 0),
    busiest: busiest ? { label: busiest.label, start: busiest.start, companies: busiest.companies } : null,
  };
  return { days, today, since: windows[0]?.start || null, windows, summary };
}

export const clampDays = v => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.min(DAYS_MAX, Math.max(DAYS_MIN, n)) : DAYS_DEFAULT; };

export async function visitorsTrend(supabase, businessId, { days = DAYS_DEFAULT, now = Date.now() } = {}) {
  const today = laDateString(new Date(now));
  const [rows, runs] = await Promise.all([
    selectAllPages(() => supabase.from('web_visits').select('id, company_key, pulled_on, seen_from, seen_to, visits_7d').eq('business_id', businessId).order('id')),
    selectAllPages(() => supabase.from('visit_pull_runs').select('id, la_date, kind, status, window_start, window_end').eq('business_id', businessId).eq('kind', 'backfill').order('id')),
  ]);
  return reply(200, buildTrend({ rows, runs, today, days: clampDays(days) }));
}
export async function visitorsTrendRoute(req, res) {
  try { send(res, await visitorsTrend(getSupabase(), req.params.businessId, { days: req.query.days })); }
  catch (e) { res.status(500).json({ error: e.message }); }
}
