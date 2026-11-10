import { useState, useEffect, useMemo } from 'react';
import { SA } from '../theme';
import { PRIORITY_COLORS } from '../palette';
import useMediaQuery from '../../../utils/useMediaQuery';
import { Chart } from './ExplorerView';
import { geometry, heightPx } from './explorerModel';
import { goalsApi } from './goalsApi';
import { cardStyle, h3Style, subStyle, numStyle, ErrorNote } from './goalsUi';

// visitor-trend-v1 T2 - Pipeline › Web visitors: companies identified per pull window over the trailing 30 days, from
// GET goals/visitors/trend (every number the route's; this file draws and formats). One bar per window (a Monday pull's
// Fri–Sun is one bar), stacked NEW (first window ever listing the company) / RETURNING in the email's two hues, and the
// line = Σ visits_7d of the window's companies - Apollo's rolling 7-day count, never "visits that day". Hover = the
// window's days · companies (new · returning) · 7-day visits; click a bar = the Companies list filtered to that window
// (onPickWindow). The Explorer's Chart draws it with the R6 props (stacked + countLine); 390 shows 14 bars and swipes.
export const DAYS = 30;
export const PHONE_BARS = 14;
export const NEW_COLOR = PRIORITY_COLORS.P1, RETURNING_COLOR = PRIORITY_COLORS.P3, LINE_COLOR = SA.link;
export const LINE_LABEL = "7-day visits, Apollo's rolling count";
const n = v => Number(v || 0).toLocaleString('en-US');
const wd = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
const dayNum = d => Number(d.slice(8, 10));
// The axis word: "Thu 5", "Fri–Sun 6–8" - the full label (with the month) is the hover card's.
export const axisLabel = w => (w.days.length === 1 ? `${wd(w.days[0])} ${dayNum(w.days[0])}` : `${wd(w.days[0])}–${wd(w.days[w.days.length - 1])} ${dayNum(w.days[0])}–${dayNum(w.days[w.days.length - 1])}`);
export const summaryLine = t => (t.summary.windows
  ? `Last ${t.days} days: ${n(t.summary.companies)} companies identified · ${n(t.summary.new)} new · ${n(t.summary.returning)} returning · busiest: ${t.summary.busiest.label} (${n(t.summary.busiest.companies)})`
  : `Last ${t.days} days: no pull windows yet`);
export const chartData = t => ({
  by: 'window', from: t.since, to: t.today, label: `Companies identified per pull window, last ${t.days} days: new and returning stacked, with ${LINE_LABEL}`,
  labels: t.windows.map(w => ({ key: `${w.start}_${w.end}`, label: axisLabel(w), current: false })),
  // The stack draws the first series at the bottom: RETURNING under, NEW on top (the one the eye is asked about).
  series: [
    { layer: 'returning', split_key: 'team', kind: 'count', label: 'Returning', color: RETURNING_COLOR, values: t.windows.map(w => w.returning) },
    { layer: 'new', split_key: 'team', kind: 'count', label: 'New', color: NEW_COLOR, values: t.windows.map(w => w.new) },
    { layer: 'visits_7d', split_key: 'team', kind: 'count', line: true, label: LINE_LABEL, color: LINE_COLOR, values: t.windows.map(w => w.visits_7d) },
  ],
});

function HoverCard({ w, geom, index }) {
  const left = Math.min(92, Math.max(0, ((geom.center(index) - geom.padL) / geom.plotW) * 100));
  return (
    <div data-trend-hover role="status" style={{ position: 'absolute', top: 8, left: `${left}%`, transform: left > 60 ? 'translateX(-100%)' : 'none', zIndex: 3, minWidth: 200, padding: '8px 10px', borderRadius: 8, background: SA.surface2, border: `1px solid ${SA.borderStrong}`, boxShadow: '0 8px 24px rgba(0,0,0,.4)', fontSize: 12, pointerEvents: 'none' }}>
      <div style={{ fontWeight: 600, color: SA.text, marginBottom: 4 }}>{w.label}{w.merged > 1 ? ` · ${w.merged} pulls` : ''}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: SA.soft }}><span>Companies</span><span style={{ ...numStyle, color: SA.text }}>{n(w.companies)} <span style={{ color: SA.muted }}>({n(w.new)} new · {n(w.returning)} returning)</span></span></div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: SA.soft }}><span>7-day visits</span><span style={{ ...numStyle, color: SA.text }}>{n(w.visits_7d)}</span></div>
      <div style={{ color: SA.faint, marginTop: 4 }}>Click the bar to list these companies</div>
    </div>
  );
}

const Swatch = ({ color, line }) => <i aria-hidden="true" style={{ display: 'inline-block', width: line ? 14 : 10, height: line ? 2 : 10, borderRadius: 2, background: color }} />;

export default function VisitorTrendChart({ businessId, onPickWindow, onLoaded }) {
  const phone = useMediaQuery('(max-width: 760px)');
  const [trend, setTrend] = useState(null);
  const [error, setError] = useState('');
  const [hover, setHover] = useState(null);
  useEffect(() => {
    let live = true;
    goalsApi.visitorsTrend(businessId, { days: DAYS }).then(t => { if (live) { setTrend(t); if (onLoaded) onLoaded(t); } }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [businessId, onLoaded]);
  const data = useMemo(() => (trend ? chartData(trend) : null), [trend]);
  const geom = useMemo(() => (trend ? geometry(trend.windows.length, heightPx('standard')) : null), [trend]);
  if (error) return <ErrorNote message={error} />;
  if (!trend) return <span style={subStyle}>Loading the 30-day trend…</span>;
  const bars = trend.windows.length;
  const s = trend.summary;
  return (
    <section aria-label="Visitors, last 30 days" data-visitor-trend data-bars={bars} style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 10, position: 'relative', minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <h3 style={h3Style}>Last 30 days</h3>
        <span data-trend-summary style={{ ...subStyle, fontSize: 13 }}>{summaryLine(trend)}{trend.since ? ` · since ${new Date(`${trend.since}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}` : ''}</span>
      </div>
      {bars === 0 && <span style={subStyle}>No pull windows in the last 30 days.</span>}
      {bars > 0 && (
        <div style={{ position: 'relative', minWidth: 0, ...(phone ? { overflowX: 'auto' } : {}) }} {...(phone ? { tabIndex: 0, role: 'region', 'aria-label': 'Chart (swipe sideways for all 30 days)' } : {})}>
          <div data-trend-plot style={phone && bars > PHONE_BARS ? { width: `${(bars / PHONE_BARS) * 100}%` } : undefined}>
            <Chart data={data} show="lines" height="standard" hover={hover} pinned={null} onHover={setHover} onPin={i => { if (i != null && onPickWindow) onPickWindow(trend.windows[i]); }} stacked countLine />
          </div>
          {hover != null && geom && <HoverCard w={trend.windows[hover]} geom={geom} index={hover} />}
        </div>
      )}
      <div data-trend-legend style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontSize: 12, color: SA.muted }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Swatch color={NEW_COLOR} />New <b style={{ ...numStyle, color: SA.text }}>{n(s.new)}</b></span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Swatch color={RETURNING_COLOR} />Returning <b style={{ ...numStyle, color: SA.text }}>{n(s.returning)}</b></span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Swatch color={LINE_COLOR} line />{LINE_LABEL} <b style={{ ...numStyle, color: SA.text }}>{n(s.visits_7d)}</b></span>
        <span style={{ color: SA.faint }}>One bar per pull window (a Monday pull covers Fri–Sun) · companies on the left, 7-day visits on the right · click a bar to list its companies</span>
      </div>
    </section>
  );
}
