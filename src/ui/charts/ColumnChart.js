import { useWidth, niceTicks, compact, fmtNum, labelStep, MARK, Legend } from './chartKit';

// Columns over an ordinal x (days, weeks, categories). mode: 'single' |
// 'grouped' | 'stacked'. points: [{ x, label, values: { [seriesId]: n|null } }];
// series: [{ id, label, color }]. A null value is a gap (unknown), never a
// zero. Every column has a title; a transparent band over each x lists all
// the series on hover. Y ticks on the left, x labels thinned to fit.
const PAD_L = 36;
const PAD_B = 22;
const PAD_T = 14;

export default function ColumnChart({ label, points, series, mode = 'single', height = 160, format = fmtNum }) {
  const [ref, width] = useWidth();
  const stacked = mode === 'stacked';
  const total = p => series.reduce((n, s) => n + (p.values[s.id] || 0), 0);
  const max = Math.max(0, ...points.flatMap(p => (stacked ? [total(p)] : series.map(s => p.values[s.id] || 0))));
  const ticks = niceTicks(max, 3);
  const top = ticks[ticks.length - 1];
  const plotW = Math.max(40, width - PAD_L - 8);
  const plotH = height - PAD_T - PAD_B;
  const band = plotW / Math.max(points.length, 1);
  const y = v => PAD_T + plotH - (plotH * v) / (top || 1);
  const perBar = stacked || mode === 'single' ? 1 : series.length;
  const colW = Math.min(MARK.bar, (band - 6 - (perBar - 1) * MARK.gap) / perBar);
  const step = labelStep(points.length, plotW);
  const known = p => series.some(s => p.values[s.id] != null);
  const summary = p => `${p.label}: ${known(p) ? series.map(s => `${s.label} ${format(p.values[s.id] ?? 0)}`).join(', ') : 'no data'}`;
  return (
    <div ref={ref} style={{ minWidth: 0 }}>
      <svg className="ui-chart" role="img" aria-label={`${label}: ${points.map(summary).join('; ')}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {ticks.map(t => <g key={t}><line className="ui-chart__grid" x1={PAD_L} x2={width - 8} y1={y(t)} y2={y(t)} /><text x={PAD_L - 6} y={y(t) + 4} textAnchor="end">{compact(t)}</text></g>)}
        <line className="ui-chart__axis" x1={PAD_L} x2={width - 8} y1={y(0)} y2={y(0)} />
        {points.map((p, i) => {
          const x0 = PAD_L + i * band + (band - perBar * colW - (perBar - 1) * MARK.gap) / 2;
          let acc = 0;
          return (
            <g key={p.x}>
              {known(p) && series.map((s, j) => {
                const v = p.values[s.id] || 0;
                if (stacked) {
                  const yTop = y(acc + v), h = Math.max(0, y(acc) - yTop - (acc > 0 && v > 0 ? MARK.gap : 0));
                  acc += v;
                  return v > 0 ? <rect key={s.id} x={x0} y={yTop} width={colW} height={h} fill={s.color} rx={j === series.length - 1 || acc >= total(p) ? MARK.radius : 0}><title>{`${p.label} · ${s.label}: ${format(v)}`}</title></rect> : null;
                }
                const bx = x0 + j * (colW + MARK.gap);
                return v > 0 ? <rect key={s.id} x={bx} y={y(v)} width={colW} height={Math.max(2, y(0) - y(v))} rx={MARK.radius} fill={s.color}><title>{`${p.label} · ${s.label}: ${format(v)}`}</title></rect> : null;
              })}
              {i % step === 0 && <text x={PAD_L + i * band + band / 2} y={height - 6} textAnchor="middle">{p.label}</text>}
              <rect className="ui-chart__hit" x={PAD_L + i * band} y={PAD_T} width={band} height={plotH}><title>{summary(p)}</title></rect>
            </g>
          );
        })}
      </svg>
      <Legend series={series} label={`${label} legend`} />
    </div>
  );
}
