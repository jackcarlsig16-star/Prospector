import { useWidth, niceTicks, compact, fmtNum, labelStep, MARK, Legend } from './chartKit';

// Lines over an ordinal x (days, weeks). points: [{ x, label, values:
// { [seriesId]: n|null } }]; series: [{ id, label, color }]. A null breaks the
// line (a gap, not a zero). 2px lines, 8px end dots with a surface ring, the
// last value labelled at the line end, a hover band per x with every series.
const PAD_L = 36;
const PAD_R = 40;
const PAD_B = 22;
const PAD_T = 14;

export default function LineChart({ label, points, series, height = 160, format = fmtNum }) {
  const [ref, width] = useWidth();
  const max = Math.max(0, ...points.flatMap(p => series.map(s => p.values[s.id] || 0)));
  const ticks = niceTicks(max, 3);
  const top = ticks[ticks.length - 1];
  const plotW = Math.max(40, width - PAD_L - PAD_R);
  const plotH = height - PAD_T - PAD_B;
  const n = points.length;
  const x = i => PAD_L + (n > 1 ? (plotW * i) / (n - 1) : plotW / 2);
  const y = v => PAD_T + plotH - (plotH * v) / (top || 1);
  const step = labelStep(n, plotW);
  const path = s => {
    let d = '', on = false;
    points.forEach((p, i) => { const v = p.values[s.id]; if (v == null) { on = false; return; } d += `${on ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `; on = true; });
    return d;
  };
  const lastKnown = s => { for (let i = n - 1; i >= 0; i--) if (points[i].values[s.id] != null) return i; return -1; };
  // End labels only where they don't collide (within 11 px of one already placed); the legend + hover carry the rest.
  const endLabels = new Set();
  let lastY = -Infinity;
  for (const s of [...series].map(s => ({ s, i: lastKnown(s) })).filter(e => e.i >= 0).sort((a, b) => y(points[a.i].values[a.s.id]) - y(points[b.i].values[b.s.id]))) {
    const yy = y(points[s.i].values[s.s.id]);
    if (yy - lastY >= 11) { endLabels.add(s.s.id); lastY = yy; }
  }
  const summary = p => `${p.label}: ${series.some(s => p.values[s.id] != null) ? series.map(s => `${s.label} ${format(p.values[s.id] ?? 0)}`).join(', ') : 'no data'}`;
  const lineSeries = series.map(s => ({ ...s, line: true }));
  return (
    <div ref={ref} style={{ minWidth: 0 }}>
      <svg className="ui-chart" role="img" aria-label={`${label}: ${points.map(summary).join('; ')}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {ticks.map(t => <g key={t}><line className="ui-chart__grid" x1={PAD_L} x2={PAD_L + plotW} y1={y(t)} y2={y(t)} /><text x={PAD_L - 6} y={y(t) + 4} textAnchor="end">{compact(t)}</text></g>)}
        <line className="ui-chart__axis" x1={PAD_L} x2={PAD_L + plotW} y1={y(0)} y2={y(0)} />
        {points.map((p, i) => i % step === 0 && <text key={p.x} x={x(i)} y={height - 6} textAnchor="middle">{p.label}</text>)}
        {series.map(s => {
          const last = lastKnown(s);
          return (
            <g key={s.id}>
              <path d={path(s)} fill="none" stroke={s.color} strokeWidth={MARK.line} strokeLinejoin="round" strokeLinecap="round" />
              {points.map((p, i) => (p.values[s.id] == null ? null
                : <circle key={p.x} cx={x(i)} cy={y(p.values[s.id])} r={i === last ? MARK.dot : 2.5} fill={s.color} stroke="var(--ui-surface)" strokeWidth={2}><title>{`${p.label} · ${s.label}: ${format(p.values[s.id])}`}</title></circle>))}
              {last >= 0 && endLabels.has(s.id) && <text className="ui-chart__value" x={x(last) + 8} y={y(points[last].values[s.id]) + 4}>{format(points[last].values[s.id])}</text>}
            </g>
          );
        })}
        {points.map((p, i) => <rect key={`h${p.x}`} className="ui-chart__hit" x={x(i) - (n > 1 ? plotW / (n - 1) / 2 : plotW / 2)} y={PAD_T} width={n > 1 ? plotW / (n - 1) : plotW} height={plotH}><title>{summary(p)}</title></rect>)}
      </svg>
      <Legend series={lineSeries} label={`${label} legend`} />
    </div>
  );
}
