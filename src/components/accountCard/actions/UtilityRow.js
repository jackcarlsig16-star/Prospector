import { mono } from '../../../constants/colors';
import { CARD, RADIUS } from '../tokens';

// Tier 3 — utility actions, visually quiet per Section 10 ("should NOT
// compete with daily workflow actions"). Supports plain buttons and real
// links (href) in the same row.
export default function UtilityRow({ actions = [] }) {
  if (!actions.length) return null;
  const itemStyle = {
    ...mono,
    fontSize: 10,
    height: 24,
    padding: "0 9px",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    background: "transparent",
    border: `1px solid ${CARD.border}`,
    color: CARD.textMuted,
    borderRadius: RADIUS.sm,
    textDecoration: "none",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
  return (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
      {actions.map(a => a.href ? (
        <a key={a.key} href={a.href} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={itemStyle}>{a.icon} {a.label}</a>
      ) : (
        <button key={a.key} onClick={e => { e.stopPropagation(); a.onClick(); }} disabled={a.disabled} style={{ ...itemStyle, opacity: a.disabled ? 0.5 : 1 }}>{a.icon} {a.label}</button>
      ))}
    </div>
  );
}
