import { C } from '../../constants/colors';

// Hand-rolled inline SVG line chart (A4b: no chart library in this repo,
// no new npm dependency). Renders nothing for fewer than 2 points - "never
// zero-filled charts" (Stage 3 empty-state rule) applies here too, not
// just to the widget-level empty state.
export default function LineChart({ points, width = 280, height = 60, color = C.gold, strokeWidth = 1.5, showDots = false }) {
  if (!points || points.length < 2) return null;

  const values = points.map(p => p.y);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = max - min || 1;
  const stepX = width / (points.length - 1);
  const toY = v => height - ((v - min) / range) * height;

  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i * stepX).toFixed(1)} ${toY(p.y).toFixed(1)}`)
    .join(' ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', overflow: 'visible' }}>
      <path d={d} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      {showDots && points.map((p, i) => (
        <circle key={i} cx={i * stepX} cy={toY(p.y)} r={2.5} fill={color} />
      ))}
    </svg>
  );
}
