import { mono } from '../../../constants/colors';
import { CARD, RADIUS } from '../tokens';

// Tier 2 — frequent actions, consistent treatment per Section 11 (icon,
// label, disabled/loading/active state, optional badge).
export default function ActionGroup({ actions = [] }) {
  if (!actions.length) return null;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {actions.map(a => (
        <button
          key={a.key}
          onClick={e => { e.stopPropagation(); a.onClick(); }}
          disabled={a.disabled}
          title={a.tooltip}
          style={{
            ...mono,
            fontSize: 11,
            height: 28,
            padding: "0 12px",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            background: a.active ? `${CARD.textPrimary}0f` : "transparent",
            border: `1px solid ${a.active ? CARD.borderStrong : CARD.border}`,
            color: a.active ? CARD.textPrimary : CARD.textSecondary,
            borderRadius: RADIUS.sm,
            cursor: a.disabled ? "default" : "pointer",
            opacity: a.disabled ? 0.5 : 1,
          }}
        >
          {a.loading ? "⟳" : a.icon} {a.label}
          {a.badge != null && <span style={{ ...mono, fontSize: 9, color: CARD.textMuted }}>({a.badge})</span>}
        </button>
      ))}
    </div>
  );
}
