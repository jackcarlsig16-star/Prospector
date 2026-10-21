import { useWidth, niceTicks, compact, fmtNum, MARK, Legend } from './chartKit';

// Horizontal bars: one row per category, left-aligned labels, the value at
// the bar tip, hairline ticks underneath. With 2+ series the rows group
// (one thin bar per series, a legend below). rows: [{ id, label, value }] or
// [{ id, label, values: { [seriesId]: n } }]; series: [{ id, label, color }].
const LABEL_W = 132;
const PAD_R = 44;
const ROW_GAP = 8;

export default function BarChart({ label, rows, series, color = 'var(--ui-accent)', format = fmtNum, barHeight = 16 }) {
  const [ref, width] = useWidth();
  const multi = series && series.length > 1;
  const keys = multi ? series.map(s => s.id) : null;
  const value = (r, k) => (multi ? r.values?.[k] : r.value) || 0;
  const max = Math.max(0, ...rows.flatMap(r => (multi ? keys.map(k => value(r, k)) : [value(r)])));
  const ticks = niceTicks(max, 4);
  const top = ticks[ticks.length - 1];
  const rowH = multi ? keys.length * (barHeight + MARK.gap) + ROW_GAP : barHeight + ROW_GAP;
  const plotW = Math.max(60, width - LABEL_W - PAD_R);
  const height = rows.length * rowH + 20;
  const x = v => LABEL_W + (plotW * v) / (top || 1);
  const bar = (r, k, i, j) => {
    const v = value(r, k);
    const y = i * rowH + (multi ? j * (barHeight + MARK.gap) : ROW_GAP / 2);
    const w = Math.max(v > 0 ? 2 : 0, x(v) - LABEL_W);
    const name = multi ? `${r.label} · ${series[j].label}` : r.label;
    // Each bar carries its own value at the tip; a zero bar in a group stays quiet (the hover and the legend still say so).
    return (
      <g key={`${r.id}-${k ?? ''}`}>
        <rect x={LABEL_W} y={y} width={w} height={barHeight} rx={w > MARK.radius ? MARK.radius : 0} fill={multi ? series[j].color : color}><title>{`${name}: ${format(v)}`}</title></rect>
        {(!multi || v > 0) && <text className="ui-chart__value" x={x(v) + 6} y={y + barHeight / 2 + 4}>{format(v)}</text>}
      </g>
    );
  };
  return (
    <div ref={ref} style={{ minWidth: 0 }}>
      <svg className="ui-chart" role="img" aria-label={`${label}: ${rows.map(r => `${r.label} ${multi ? keys.map(k => `${series.find(s => s.id === k).label} ${format(value(r, k))}`).join(', ') : format(value(r))}`).join('; ')}`}
        width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {ticks.map(t => <line key={t} className="ui-chart__grid" x1={x(t)} x2={x(t)} y1={0} y2={rows.length * rowH} />)}
        {rows.map((r, i) => (
          <g key={r.id}>
            <text className="ui-chart__cat" x={0} y={i * rowH + rowH / 2 + 4}><title>{r.label}</title>{r.label.length > 20 ? `${r.label.slice(0, 19)}…` : r.label}</text>
            {multi ? keys.map((k, j) => bar(r, k, i, j)) : bar(r, null, i, 0)}
          </g>
        ))}
        {ticks.map(t => <text key={`t${t}`} x={x(t)} y={rows.length * rowH + 14} textAnchor="middle">{compact(t)}</text>)}
      </svg>
      <Legend series={multi ? series : null} label={`${label} legend`} />
    </div>
  );
}
