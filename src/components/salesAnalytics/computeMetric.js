// Aggregation math, kept separate from metrics.registry.js (which stays
// pure declarative data). `rows` here is always the subset of
// sales_metrics_daily rows for one metric_key + one dim_type/dim_value,
// sorted by metric_date ascending - one row per day (the migration's
// UNIQUE constraint guarantees at most one row per day per dim).

function toDailySeries(rows) {
  return [...rows].sort((a, b) => a.metric_date.localeCompare(b.metric_date));
}

// This period's real activity = last day's cumulative counter minus the
// first day's (design decision - Apollo's unique_* counters are lifetime-
// cumulative, not daily deltas). Needs >=2 distinct days to mean anything;
// a single day's snapshot has no "start of period" to subtract.
export function snapshotDelta(rows) {
  const series = toDailySeries(rows);
  if (series.length < 2) return null;
  return series[series.length - 1].value - series[0].value;
}

// Point-in-time gauge - just the latest day's value in range.
export function lastValue(rows) {
  const series = toDailySeries(rows);
  if (series.length === 0) return null;
  return series[series.length - 1].value;
}

// Ratio of two AGGREGATED counts for the same period - never an average of
// each day's own rate (design decision, avoids a single sparse day
// skewing the period rate).
export function ratio(numeratorRows, denominatorRows, aggregateFn = snapshotDelta) {
  const num = aggregateFn(numeratorRows);
  const den = aggregateFn(denominatorRows);
  if (num === null || den === null || den === 0) return null;
  return num / den;
}

// dashboard-v2 - the one shared bounce-percent function (leaderboard,
// donuts, summary strip, CSV, and PDF all use this, not their own inline
// math). Apollo's own bounce_rate field = bounced / (delivered + bounced),
// confirmed exact to 6 decimal places against 3 real sequences (audit F8) -
// NOT bounced / delivered, which is what the dashboard used before this
// SPEC and which inflates the percentage (unique_delivered already
// excludes bounces, so dividing by it alone overstates the rate). Also
// used for hard-bounce % and spam-block %, which share this same
// denominator per the SPEC's design decision.
export function bounceDenominatorRate(numeratorRows, deliveredRows, bouncedRows, aggregateFn = lastValue) {
  const num = aggregateFn(numeratorRows);
  const delivered = aggregateFn(deliveredRows);
  const bounced = aggregateFn(bouncedRows);
  if (num === null || delivered === null || bounced === null) return null;
  const denom = delivered + bounced;
  return denom === 0 ? null : num / denom;
}

export function hasEnoughHistory(rows, minDays = 2) {
  return new Set(rows.map(r => r.metric_date)).size >= minDays;
}

export function formatValue(value, format) {
  if (value === null || value === undefined) return '—';
  if (format === 'percent') return `${(value * 100).toFixed(1)}%`;
  return Number(value).toLocaleString('en-US');
}

// Filters the flat row list GET /metrics returns down to one series.
export function rowsFor(allRows, metricKey, dimType = 'all', dimValue = 'all') {
  return allRows.filter(r => r.metric_key === metricKey && r.dim_type === dimType && r.dim_value === dimValue);
}

// Weekly sparkline points, one per LA week (Monday-start) that has any
// data in `allRows`, using the metric's own aggregate rule per week. Weeks
// with zero rows are skipped entirely, not zero-filled - a brand-new
// feature genuinely has no data for weeks before it existed.
export function weeklySeries(rows, aggregate, laWeekStartFn) {
  const byWeek = new Map();
  for (const r of rows) {
    const week = laWeekStartFn(new Date(r.metric_date + 'T12:00:00Z'));
    if (!byWeek.has(week)) byWeek.set(week, []);
    byWeek.get(week).push(r);
  }
  const weeks = [...byWeek.keys()].sort();
  const aggregateFn = aggregate === 'snapshot_delta' ? snapshotDelta : lastValue;
  return weeks
    .map(week => ({ x: week, y: aggregateFn(byWeek.get(week)) }))
    .filter(p => p.y !== null);
}
