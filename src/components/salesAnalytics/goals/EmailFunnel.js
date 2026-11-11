import { useState, useEffect, useMemo } from 'react';
import { SA } from '../theme';
import { goalsApi } from './goalsApi';
import { cardStyle, h3Style, subStyle, labelStyle, numStyle, ErrorNote } from './goalsUi';
import { funnelTables, ratePoints, pointLabel, pctOf, dayLabel, PAGE_WINDOWS, SERIES_DAYS } from './funnelModel';

// email-funnel-v1 F5 - Pipeline › Web visitors, above the 30-day trend chart: the daily email's three tables from the
// same route (GET goals/funnel) in the same words, one sentence per rate on how it is computed, and the company rate
// per day over the trailing 30 days. The rate has its own small chart, not a line on the trend chart: that chart's
// right axis already carries 7-day visits (a count), a rate would need a third scale, and its bars are pull windows
// (Fri–Sun is one bar) while the funnel's series is one row per day. Nothing shows until the route says ready (R5).
export const RATE_COLOR = SA.accent;
const ARROW_COLOR = { '▲': SA.good, '▼': SA.bad, '—': SA.faint };
const th = { ...labelStyle, textAlign: 'right', padding: '6px 0 6px 8px', fontSize: 11, letterSpacing: 0, overflowWrap: 'anywhere' };
const td = { padding: '7px 0 7px 8px', overflowWrap: 'anywhere', textAlign: 'right', borderTop: `1px solid ${SA.track}`, fontSize: 13, ...numStyle, verticalAlign: 'top' };

function Cell({ c }) {
  return (
    <td style={td}>
      <span style={{ color: c.muted ? SA.muted : SA.text, fontWeight: c.strong ? 600 : 400, whiteSpace: 'nowrap' }}>{c.main}{c.arrow && <span data-arrow style={{ color: ARROW_COLOR[c.arrow], marginLeft: 4 }}>{c.arrow}</span>}</span>
      {c.sub && <span style={{ color: SA.muted, fontSize: 12, display: 'block', lineHeight: 1.35, overflowWrap: 'anywhere' }}>{c.sub}</span>}
    </td>
  );
}

function FunnelTable({ id, t }) {
  return (
    <div data-funnel-table={id} style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <h4 style={{ ...labelStyle, margin: 0, color: SA.soft }}>{t.title}</h4>
      {t.sub && <span style={{ ...subStyle, fontSize: 12, lineHeight: 1.45 }}>{t.sub}</span>}
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <thead><tr>{t.heads.map((h, i) => <th key={h || 'step'} scope="col" style={{ ...th, ...(i === 0 ? { textAlign: 'left', paddingLeft: 0, width: '31%' } : {}) }}>{h || <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Step</span>}</th>)}</tr></thead>
        <tbody>
          {t.rows.map(r => (
            <tr key={r.key} data-row={r.key}>
              <th scope="row" style={{ ...td, textAlign: 'left', paddingLeft: 0, fontWeight: 400, color: SA.soft }}>{r.label}</th>
              {r.cells.map((c, i) => <Cell key={t.heads[i + 1]} c={c} />)}
            </tr>
          ))}
        </tbody>
      </table>
      {t.how && t.how.map(s => <span key={s} data-how style={{ ...subStyle, fontSize: 12, lineHeight: 1.45 }}>{s}</span>)}
    </div>
  );
}

// The company rate per day: a line through the days that have a rate (a day with no company emailed is a gap), the
// y axis from 0 to the tallest day, hover / tap / arrow keys = the day's fraction.
const PLOT_H = 120;
export const niceTop = max => { const p = max * 100; const step = p <= 5 ? 1 : p <= 20 ? 5 : p <= 50 ? 10 : 25; return Math.max(step, Math.ceil(p / step) * step) / 100; };
export function RateChart({ points }) {
  const [hover, setHover] = useState(null);
  const withRate = points.filter(p => p.rate != null);
  if (!points.length) return null;
  const top = niceTop(Math.max(0, ...withRate.map(p => p.rate)));
  const x = i => (points.length > 1 ? (i / (points.length - 1)) * 100 : 50);
  const y = r => 100 - (r / top) * 100;
  let d = '', on = false;
  points.forEach((p, i) => { if (p.rate == null) { on = false; return; } d += `${on ? 'L' : 'M'}${x(i).toFixed(2)} ${y(p.rate).toFixed(2)} `; on = true; });
  const last = withRate[withRate.length - 1];
  const label = `Company rate per day, last ${points.length} days: ${withRate.length} days with email delivered${last ? `, latest ${pointLabel(last)}` : ''}`;
  const move = e => { if (e.key === 'ArrowRight') { e.preventDefault(); setHover(h => Math.min(points.length - 1, (h ?? -1) + 1)); } else if (e.key === 'ArrowLeft') { e.preventDefault(); setHover(h => Math.max(0, (h ?? points.length) - 1)); } else if (e.key === 'Escape') setHover(null); };
  const hp = hover != null ? points[hover] : null;
  return (
    <div data-rate-chart data-points={points.length} style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <h4 style={{ ...labelStyle, margin: 0, color: SA.soft }}>Company rate per day · last {points.length} days</h4>
        <span data-rate-hover role="status" style={{ fontSize: 12, color: hp ? SA.text : SA.muted, ...numStyle }}>{hp ? pointLabel(hp) : 'Each day: of the companies emailed that day, the share that visited that day. Hover or tap a day.'}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, minWidth: 0 }}>
        <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: PLOT_H, fontSize: 11, color: SA.faint, textAlign: 'right', flex: 'none', ...numStyle }}><span>{pctOf(top)}</span><span>0 %</span></div>
        <div role="img" aria-label={label} tabIndex={0} onKeyDown={move} onBlur={() => setHover(null)} onMouseLeave={() => setHover(null)} style={{ position: 'relative', flex: 1, minWidth: 0, height: PLOT_H, borderBottom: `1px solid ${SA.border}`, borderTop: `1px dashed ${SA.track}` }}>
          <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
            <path d={d} fill="none" stroke={RATE_COLOR} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          </svg>
          {points.map((p, i) => (p.rate == null ? null : <i key={p.day} data-rate-point={p.day} data-rate={p.rate} aria-hidden="true" style={{ position: 'absolute', left: `${x(i)}%`, top: `${y(p.rate)}%`, width: hover === i ? 9 : 5, height: hover === i ? 9 : 5, borderRadius: 999, background: RATE_COLOR, transform: 'translate(-50%, -50%)', pointerEvents: 'none' }} />))}
          <div aria-hidden="true" style={{ position: 'absolute', inset: 0, display: 'flex' }}>
            {points.map((p, i) => <span key={p.day} data-rate-day={p.day} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} style={{ flex: 1, minWidth: 0, background: hover === i ? SA.track : 'transparent', opacity: 0.5 }} />)}
          </div>
        </div>
      </div>
      <div aria-hidden="true" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: SA.faint, paddingLeft: 44, ...numStyle }}><span>{dayLabel(points[0].day)}</span><span>{dayLabel(points[points.length - 1].day)}</span></div>
    </div>
  );
}

export default function EmailFunnel({ businessId }) {
  const [funnel, setFunnel] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    goalsApi.funnel(businessId, { windows: PAGE_WINDOWS.join(','), days: SERIES_DAYS }).then(f => { if (live) setFunnel(f); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [businessId]);
  const tables = useMemo(() => funnelTables(funnel), [funnel]);
  const points = useMemo(() => ratePoints(funnel), [funnel]);
  if (error) return <ErrorNote message={error} />;
  if (!tables) return null;
  return (
    <section aria-label="Email to site funnel" data-email-funnel style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <h3 style={h3Style}>Email → site</h3>
        <span data-funnel-since style={{ ...subStyle, fontSize: 13 }}>{tables.since}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 24, alignItems: 'start' }}>
        <FunnelTable id="steps" t={tables.steps} />
        <FunnelTable id="rates" t={tables.rates} />
        {tables.week && <FunnelTable id="week" t={tables.week} />}
      </div>
      <RateChart points={points} />
    </section>
  );
}
