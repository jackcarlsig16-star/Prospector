import { SA, saSans } from '../theme';

const R = 36;
const C = 2 * Math.PI * R;
const keyOf = p => p.id ?? p.label;

// Donut for a share of a whole (<= 5 slices) or a single "% to goal" ring.
// parts: [{ id?, label, count, color }]. Color is never the only signal - the
// legend (or the caller's own labels) carries the numbers, and the aria
// label lists every slice.
// goals-surface-v1: with onSelect, a click on a slice filters the list the
// ring summarizes (selected = that slice's id; the others dim). Slices are
// mouse targets only - the legend rows are the keyboard buttons, so each
// slice has exactly one tab stop.
export default function Ring({ parts, center, caption, size = 88, stroke = 12, label, track = true, onSelect, selected }) {
  const total = parts.reduce((n, p) => n + (p.count || 0), 0);
  const nonZero = parts.filter(p => p.count > 0).length;
  let offset = 0;
  const segs = [];
  for (const p of parts) {
    if (!p.count || !total) continue;
    const len = (C * p.count) / total;
    const gap = nonZero > 1 ? 3 : 0;
    segs.push({ key: keyOf(p), color: p.color, dash: `${Math.max(len - gap, 0.1).toFixed(2)} ${C.toFixed(2)}`, off: (-offset).toFixed(2) });
    offset += len;
  }
  const aria = `${label}: ${parts.map(p => `${p.label} ${p.count}`).join(', ')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" role="img" aria-label={aria} style={{ flex: 'none' }}>
      {track && <circle cx="48" cy="48" r={R} fill="none" stroke={SA.track} strokeWidth={stroke} />}
      {segs.map(s => (
        <circle key={s.key} cx="48" cy="48" r={R} fill="none" stroke={s.color} strokeWidth={stroke}
          strokeDasharray={s.dash} strokeDashoffset={s.off} transform="rotate(-90 48 48)"
          onClick={onSelect ? () => onSelect(selected === s.key ? null : s.key) : undefined}
          style={{ cursor: onSelect ? 'pointer' : undefined, opacity: selected != null && selected !== s.key ? 0.3 : 1, transition: 'opacity 120ms' }} />
      ))}
      <text x="48" y={caption ? 47 : 55} textAnchor="middle" fill={SA.text} pointerEvents="none"
        style={{ ...saSans, fontSize: caption ? 18 : 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{center}</text>
      {caption && <text x="48" y="62" textAnchor="middle" fill={SA.muted} pointerEvents="none" style={{ ...saSans, fontSize: 10, fontWeight: 500 }}>{caption}</text>}
    </svg>
  );
}

export function RingLegend({ parts, showPct = false, onSelect, selected }) {
  const total = parts.reduce((n, p) => n + (p.count || 0), 0);
  const value = p => (showPct ? `${total ? Math.round((p.count * 100) / total) : 0}%` : p.count.toLocaleString('en-US'));
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: onSelect ? 2 : 6 }}>
      {parts.map(p => {
        const swatch = <span style={{ width: 10, height: 10, borderRadius: 3, background: p.color, flex: 'none' }} />;
        const num = <span style={{ color: SA.muted, fontVariantNumeric: 'tabular-nums' }}>{value(p)}</span>;
        if (!onSelect) return <li key={keyOf(p)} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>{swatch}{p.label}{num}</li>;
        const on = selected === keyOf(p);
        return (
          <li key={keyOf(p)}>
            <button type="button" aria-pressed={on} disabled={!p.count} onClick={() => onSelect(on ? null : keyOf(p))}
              title={p.count ? `Show only ${p.label}` : undefined}
              style={{ ...saSans, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, minHeight: 28, padding: '0 8px', marginLeft: -8, borderRadius: 8, cursor: p.count ? 'pointer' : 'default',
                border: `1px solid ${on ? SA.accent : 'transparent'}`, background: on ? 'color-mix(in srgb, var(--sa-accent) 14%, transparent)' : 'transparent',
                color: SA.text, opacity: selected != null && !on ? 0.6 : 1, textAlign: 'left' }}>
              {swatch}{p.label}{num}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
