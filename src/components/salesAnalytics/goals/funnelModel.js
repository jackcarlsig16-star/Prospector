// email-funnel-v1 Stage 2 (F5 / F6) - what the Web visitors tables, the rate chart and the Home tile show, built from
// GET goals/funnel's body alone (funnelMath on the server is the one function; nothing here computes a step or a rate
// except a day's rate from that day's own row, n ÷ d as the route stored them). The words are the route's
// (step_words, wording), so the page and the daily email read the same.
export const PAGE_WINDOWS = ['yesterday', '7d', '30d', 'this_week', 'last_week'];
export const SERIES_DAYS = 30;
export const HEADS = ['', 'Yesterday', 'Last 7 d', 'Last 30 d'];
export const WEEK_HEADS = ['', 'This week', 'Last week', 'Change'];
export const WEEK_STEPS = ['delivered', 'companies_visited', 'replies', 'meetings'];
export const pctOf = x => (x == null ? '—' : `${(100 * x).toFixed(1)} %`);
const n = v => Number(v || 0).toLocaleString('en-US');
const md = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export const dayLabel = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const delta = (a, b) => (a === b ? '—' : a > b ? `+${a - b}` : `−${b - a}`);

// -> null until the delivered rows reach the funnel's first day (R5), else the three tables as { main, sub } cells.
export function funnelTables(f) {
  if (!f?.ready || !f.windows) return null;
  const W = f.windows, cols = [W.yesterday, W['7d'], W['30d']], tw = W.this_week, lw = W.last_week;
  if (cols.some(w => !w)) return null;
  const word = s => f.step_words?.[s] || s.replace(/_/g, ' ');
  return {
    steps: {
      title: 'Email funnel', sub: `Counts with their share of delivered · opens, clicks, replies and meetings are ${f.wording.cohort}.`, heads: HEADS,
      rows: f.steps.map(s => ({ key: s, label: word(s), cells: cols.map(w => (s === 'delivered' ? { main: n(w[s]), strong: true } : { main: String(w[s]), sub: `· ${pctOf(w.delivered ? w[s] / w.delivered : null)}` })) })),
    },
    rates: {
      title: 'Email → site', heads: HEADS,
      rows: [
        { key: 'company_rate', label: 'Company rate', cells: cols.map((w, i) => ({ main: pctOf(w.company_rate.rate), strong: true, arrow: i === 2 && f.trend_30d ? f.trend_30d.arrow : null, sub: `· ${w.company_rate.n} of ${w.company_rate.d} companies` })) },
        { key: 'person_rate', label: 'Person rate', cells: cols.map(w => ({ main: pctOf(w.person_rate.rate), strong: true, sub: `· ${w.person_rate.n} of ${w.person_rate.d} people` })) },
      ],
      how: [f.wording.company, f.wording.person],
    },
    week: tw && lw ? {
      title: 'This week vs last week', sub: `Mon ${md(tw.from)} → today against Mon ${md(lw.from)} → Sun ${md(lw.to)}.`, heads: WEEK_HEADS,
      rows: WEEK_STEPS.map(s => ({ key: s, label: word(s), cells: [{ main: String(tw[s]), strong: true }, { main: String(lw[s]) }, { main: delta(tw[s], lw[s]), muted: true }] })),
    } : null,
    since: f.wording.since,
  };
}

// The rate chart's points: one per day row of the route's series; a day with no company emailed is a gap, never a zero.
export const ratePoints = f => (f?.series || []).map(r => ({ day: r.day, n: r.companies_visited, d: r.companies_emailed, rate: r.companies_emailed ? r.companies_visited / r.companies_emailed : null }));
export const pointLabel = p => (p.rate == null ? `${dayLabel(p.day)} · no email delivered` : `${dayLabel(p.day)} · ${pctOf(p.rate)} · ${p.n} of ${p.d} companies emailed that day visited that day`);

// F6: the Home tile's metric in the pulse tile's shape - the 30-day window's company rate and fraction, the day rates as
// the sparkline, the route's 30-day arrow when it exists. null while the funnel is not ready.
export const EMAIL_SITE_TILE = { key: 'email_site', label: 'Email → site (30 d)', src: m => m.source };
export function emailSiteMetric(f) {
  const w = f?.ready ? f.windows?.['30d'] : null;
  if (!w) return null;
  const t = f.trend_30d;
  return {
    kind: 'rate', value: w.company_rate.rate, n: w.company_rate.n, d: w.company_rate.d,
    fraction: `${w.company_rate.n} of ${w.company_rate.d} companies`, trend: t ? (t.arrow === '▲' ? 'good' : t.arrow === '▼' ? 'bad' : 'flat') : 'flat', vs_prior: !!t,
    series: ratePoints(f).map(p => p.rate), source: 'companies emailed that visited the site',
  };
}
