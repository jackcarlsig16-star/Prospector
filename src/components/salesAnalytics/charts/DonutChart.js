import { useState } from 'react';
import { C, mono } from '../../../constants/colors';
import { formatValue } from '../computeMetric';

// Hand-rolled inline SVG donut (A4b: no chart library, no new npm
// dependency). Classic stroke-dasharray-per-slice technique on stacked
// circles, rotated -90deg so the first slice starts at 12 o'clock. Donuts
// are used only for share-of-whole with <=7 slices (SPEC design decision)
// - callers are responsible for keeping slice count within that, this
// component doesn't enforce it.
//
// Legend (counts + percentages) is always visible, not just on hover -
// color is never the only signal. Hover/focus additionally swaps the
// center label to the exact value/percent for that one slice; each slice
// is a real tabIndex=0 SVG element with an aria-label and a native
// <title> tooltip, so it's keyboard-reachable, not just mouse-hoverable.
export default function DonutChart({ slices, size = 160, strokeWidth = 24, centerLabel }) {
  const [activeIndex, setActiveIndex] = useState(null);
  const validSlices = (slices || []).filter(s => s.value > 0);
  const total = validSlices.reduce((sum, s) => sum + s.value, 0);

  if (!validSlices.length || total === 0) {
    return <p style={{ ...mono, fontSize: 12, color: C.dim, padding: '12px 0' }}>No data yet.</p>;
  }

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  let offsetSoFar = 0;

  const arcs = validSlices.map((s, i) => {
    const fraction = s.value / total;
    const length = fraction * circumference;
    const arc = { ...s, index: i, length, dashoffset: -offsetSoFar, percent: fraction };
    offsetSoFar += length;
    return arc;
  });

  const active = activeIndex !== null ? arcs[activeIndex] : null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)', overflow: 'visible' }}>
          {arcs.map(arc => (
            <circle
              key={arc.label}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={arc.color}
              strokeWidth={activeIndex === arc.index ? strokeWidth + 4 : strokeWidth}
              strokeDasharray={`${arc.length} ${circumference - arc.length}`}
              strokeDashoffset={arc.dashoffset}
              tabIndex={0}
              role="img"
              aria-label={`${arc.label}: ${formatValue(arc.value, 'number')} (${(arc.percent * 100).toFixed(1)}%)`}
              onFocus={() => setActiveIndex(arc.index)}
              onBlur={() => setActiveIndex(null)}
              onMouseEnter={() => setActiveIndex(arc.index)}
              onMouseLeave={() => setActiveIndex(null)}
              style={{ cursor: 'pointer', outline: 'none', transition: 'stroke-width 0.1s' }}
            >
              <title>{`${arc.label}: ${formatValue(arc.value, 'number')} (${(arc.percent * 100).toFixed(1)}%)`}</title>
            </circle>
          ))}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', pointerEvents: 'none' }}>
          {active ? (
            <>
              <span style={{ ...mono, fontSize: 18, fontWeight: 700, color: active.color }}>{formatValue(active.value, 'number')}</span>
              <span style={{ ...mono, fontSize: 9, color: C.dim }}>{(active.percent * 100).toFixed(1)}%</span>
            </>
          ) : centerLabel !== undefined ? (
            <>
              <span style={{ ...mono, fontSize: 18, fontWeight: 700, color: C.txt }}>{formatValue(total, 'number')}</span>
              <span style={{ ...mono, fontSize: 9, color: C.dim, textTransform: 'uppercase' }}>{centerLabel}</span>
            </>
          ) : null}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {arcs.map(arc => (
          <div key={arc.label} style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: activeIndex !== null && activeIndex !== arc.index ? 0.5 : 1 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: arc.color, flexShrink: 0 }} />
            <span style={{ ...mono, fontSize: 11, color: C.txt }}>{arc.label}</span>
            <span style={{ ...mono, fontSize: 11, color: C.dim }}>{formatValue(arc.value, 'number')} ({(arc.percent * 100).toFixed(1)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}
