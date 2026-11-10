// visitor-trend-v1 Stage 0 - READ-ONLY (0 writes, 0 Claude, 0 Apollo). HomeLover only. One read each of visit_pull_runs,
// apollo_credit_spend (this LA month, all businesses - the Apollo account is shared) and web_visits. Prints
// (a) the last 20 ok pull runs (date, window, companies, credits) and the month's spend vs the 500 cap;
// (b) the per-window series for the last 30 days: companies per ok run window, split new / returning by the builder's
//     definition (is_new = no web_visits row for the company with seen_from before the window's first day), plus
//     Σ visits_7d. Company names never printed - counts only.
// Usage: node scripts/verify/visitor-trend-v1-stage0.mjs
import { createRequire } from 'module';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { selectAllPages } = await import('../../api/lib/selectAllPages.js');
const { laDateString } = await import('../../api/sales/laDate.js');
const { monthSpend, MONTHLY_CREDIT_CAP } = await import('../../api/sales/visitPull.js');

const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = (await svc.from('businesses').select('id').ilike('name', '%homelover%')).data[0].id;
const today = laDateString();
const laMonth = today.slice(0, 7);
const DAY = 864e5;
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const wd = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
const md = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const t0 = Date.now();
const [runs, visits, spend] = await Promise.all([
  selectAllPages(() => svc.from('visit_pull_runs').select('id, la_date, kind, window_start, window_end, lookback_days, status, calls, credits, created_at').eq('business_id', HL).order('la_date', { ascending: false })),
  selectAllPages(() => svc.from('web_visits').select('id, company_key, pulled_on, seen_from, seen_to, visits_7d, unique_visitors_7d').eq('business_id', HL).order('id')),
  monthSpend(svc, laMonth),
]);
console.log(`read ${runs.length} pull runs + ${visits.length} web_visits rows in ${Date.now() - t0} ms (today ${today}, month ${laMonth})`);

// ---- (a)
const ok = runs.filter(r => r.status === 'ok' && ['daily', 'backfill'].includes(r.kind)).sort((a, b) => b.la_date.localeCompare(a.la_date) || b.created_at.localeCompare(a.created_at));
// A run's rows: the pull writes pulled_on = la_date, seen_from = window_start, seen_to = window_end; runs before Oct 27 (FIX visit-window)
// recorded no window - their rows match by pulled_on alone (reported apart, never silently merged).
const rowsOf = r => (r.window_start ? visits.filter(v => v.pulled_on === r.la_date && v.seen_from === r.window_start && v.seen_to === r.window_end) : []);
const rowsByDay = r => visits.filter(v => v.pulled_on === r.la_date && !v.seen_from);
console.log(`\n(a) ok daily/backfill runs ${ok.length} of ${runs.length} rows (kinds ${JSON.stringify(runs.reduce((o, r) => { o[r.kind] = (o[r.kind] || 0) + 1; return o; }, {}))}; the 'people' kind = the visitor-people pull, not a window) (${JSON.stringify(runs.reduce((o, r) => { o[r.status] = (o[r.status] || 0) + 1; return o; }, {}))}); the last 20 - date (weekday) · kind · window · lookback · companies · credits · calls:`);
for (const r of ok.slice(0, 20)) console.log(`    ${r.la_date} (${wd(r.la_date)}) · ${r.kind} · ${r.window_start ? `${r.window_start} -> ${r.window_end} (${r.lookback_days} d)` : 'no window recorded (pre Oct 27)'} · ${r.window_start ? rowsOf(r).length : `${rowsByDay(r).length} by pulled_on`} companies · ${r.credits} credits · ${r.calls} calls`);
const last20 = ok.slice(0, 20);
const creditsPerRun = last20.map(r => r.credits);
const avg = creditsPerRun.length ? creditsPerRun.reduce((a, b) => a + b, 0) / creditsPerRun.length : 0;
const monthRuns = ok.filter(r => r.la_date.startsWith(laMonth));
console.log(`    credits per run over the last 20: min ${Math.min(...creditsPerRun)} · avg ${avg.toFixed(1)} · max ${Math.max(...creditsPerRun)} · zero-credit runs ${creditsPerRun.filter(c => c === 0).length}`);
console.log(`    this month (${laMonth}): apollo_credit_spend across all businesses ${spend} of ${MONTHLY_CREDIT_CAP} · HomeLover visit pulls this month ${monthRuns.length} runs, ${monthRuns.reduce((n, r) => n + r.credits, 0)} credits`);
console.log(`    two extra runs a week at the avg = +${(2 * avg).toFixed(1)} credits/week, +${(2 * avg * 52 / 12).toFixed(0)}/month`);

// ---- (b)
const since = addDays(today, -29);
const windows = ok.filter(r => (r.window_end || r.la_date) >= since).sort((a, b) => a.window_end.localeCompare(b.window_end) || a.created_at.localeCompare(b.created_at));
console.log(`\n(b) windows with window_end >= ${since} (30 days): ${windows.length} ok runs; per window: label · companies · new · returning · Σ visits_7d · Σ unique_visitors_7d`);
let totals = { companies: 0, new: 0, returning: 0, visits: 0 };
const series = [];
for (const r of windows) {
  const rows = r.window_start ? rowsOf(r) : rowsByDay(r);
  const latest = new Map();
  for (const v of rows) { const c = latest.get(v.company_key); if (!c || v.seen_to > c.seen_to) latest.set(v.company_key, v); }
  const keys = [...latest.keys()];
  // The builder's rule (visitorEmail.js loadVisitorData): seen before = any row for the company with seen_from < the window's first day.
  // The covered days are window_start .. window_end - 1 (window_end = the pull morning); the builder's first day = window_start.
  const first = r.window_start || addDays(r.la_date, -1);
  const lastDay = r.window_start ? addDays(r.window_end, -1) : addDays(r.la_date, -1);
  const seenBefore = new Set(visits.filter(v => keys.includes(v.company_key) && v.seen_from && v.seen_from < first).map(v => v.company_key));
  const nNew = keys.filter(k => !seenBefore.has(k)).length;
  const v7 = [...latest.values()].reduce((n, v) => n + (v.visits_7d || 0), 0);
  const u7 = [...latest.values()].reduce((n, v) => n + (v.unique_visitors_7d || 0), 0);
  const days = r.lookback_days || 1;
  const label = `${days <= 1 ? `${wd(first)} ${md(first)}` : `${wd(first)}–${wd(lastDay)} ${md(first)}–${md(lastDay)}`}${r.kind === 'backfill' ? ' backfill' : ''}${r.window_start ? '' : ' (by pulled_on)'}`;
  series.push({ la_date: r.la_date, start: r.window_start, end: r.window_end, days, label, companies: keys.length, new: nNew, returning: keys.length - nNew, visits_7d: v7 });
  totals = { companies: totals.companies + keys.length, new: totals.new + nNew, returning: totals.returning + keys.length - nNew, visits: totals.visits + v7 };
  console.log(`    ${label.padEnd(34)} · ${String(keys.length).padStart(3)} companies · ${String(nNew).padStart(3)} new · ${String(keys.length - nNew).padStart(3)} returning · ${v7} visits_7d · ${u7} visitors_7d${rows.length !== keys.length ? ` (${rows.length} rows, ${rows.length - keys.length} duplicate keys)` : ''}`);
}
const busiest = [...series].sort((a, b) => b.companies - a.companies)[0];
console.log(`    30-day sums: ${totals.companies} company-windows · ${totals.new} new · ${totals.returning} returning · ${totals.visits} visits_7d · distinct companies ${new Set(windows.flatMap(r => rowsOf(r).map(v => v.company_key))).size} · busiest ${busiest ? `${busiest.label} (${busiest.companies})` : 'none'}`);
console.log(`    rows in web_visits not matched to any ok run window (seen_from/seen_to/pulled_on mismatch): ${visits.filter(v => !ok.some(r => v.pulled_on === r.la_date && v.seen_from === r.window_start && v.seen_to === r.window_end)).length} of ${visits.length}`);
console.log(`    windows of more than one day in the 30 days: ${series.filter(s => s.days > 1).map(s => `${s.label} (${s.days} d)`).join(', ') || 'none'}`);
console.log(`\nwrites 0 · Claude 0 · Apollo 0 · restored: yes (nothing changed)`);
