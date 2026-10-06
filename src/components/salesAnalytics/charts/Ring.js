import { SA, saSans } from '../theme';

const R = 36;
const C = 2 * Math.PI * R;

// Donut for a share of a whole (<= 5 slices) or a single "% to goal" ring.
// parts: [{ label, count, color }]. Color is never the only signal - the
// legend (or the caller's own labels) carries the numbers, and the aria
// label lists every slice.
export default function Ring({ parts, center, caption, size = 88, stroke = 12, label, track = true }) {
  const total = parts.reduce((n, p) => n + (p.count || 0), 0);
  const nonZero = parts.filter(p => p.count > 0).length;
  let offset = 0;
  const segs = [];
  for (const p of parts) {
    if (!p.count || !total) continue;
    const len = (C * p.count) / total;
    const gap = nonZero > 1 ? 3 : 0;
    segs.push({ color: p.color, dash: `${Math.max(len - gap, 0.1).toFixed(2)} ${C.toFixed(2)}`, off: (-offset).toFixed(2) });
    offset += len;
  }
  const aria = `${label}: ${parts.map(p => `${p.label} ${p.count}`).join(', ')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" role="img" aria-label={aria} style={{ flex: 'none' }}>
      {track && <circle cx="48" cy="48" r={R} fill="none" stroke={SA.track} strokeWidth={stroke} />}
      {segs.map((s, i) => (
        <circle key={i} cx="48" cy="48" r={R} fill="none" stroke={s.color} strokeWidth={stroke}
          strokeDasharray={s.dash} strokeDashoffset={s.off} transform="rotate(-90 48 48)" />
      ))}
      <text x="48" y={caption ? 47 : 55} textAnchor="middle" fill={SA.text}
        style={{ ...saSans, fontSize: caption ? 18 : 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{center}</text>
      {caption && <text x="48" y="62" textAnchor="middle" fill={SA.muted} style={{ ...saSans, fontSize: 10, fontWeight: 500 }}>{caption}</text>}
    </svg>
  );
}

export function RingLegend({ parts, showPct = false }) {
  const total = parts.reduce((n, p) => n + (p.count || 0), 0);
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {parts.map(p => (
        <li key={p.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: p.color, flex: 'none' }} />
          {p.label}
          <span style={{ color: SA.muted, fontVariantNumeric: 'tabular-nums' }}>
            {showPct ? `${total ? Math.round((p.count * 100) / total) : 0}%` : p.count.toLocaleString('en-US')}
          </span>
        </li>
      ))}
    </ul>
  );
}
