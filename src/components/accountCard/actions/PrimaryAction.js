import { mono } from '../../../constants/colors';
import { CARD, kindTokens, RADIUS } from '../tokens';

// Tier 1 — one dominant action per Section 10.
export default function PrimaryAction({ accountKind, action }) {
  if (!action) return null;
  const kind = kindTokens(accountKind);
  return (
    <button
      onClick={e => { e.stopPropagation(); action.onClick(); }}
      disabled={action.disabled || action.loading}
      style={{
        ...mono,
        width: "100%",
        fontSize: 13,
        fontWeight: 600,
        padding: "10px 14px",
        background: `${kind.accent}16`,
        border: `1px solid ${kind.accent}`,
        color: kind.accent,
        borderRadius: RADIUS.md,
        cursor: action.disabled || action.loading ? "default" : "pointer",
        letterSpacing: "0.02em",
        opacity: action.disabled ? 0.5 : 1,
        // A1b — subtle neon glow so the primary action reads as "alive", not flat
        boxShadow: action.disabled ? "none" : `0 0 8px ${kind.accent}55`,
        textShadow: action.disabled ? "none" : `0 0 6px ${kind.accent}66`,
        transition: "box-shadow 0.15s, text-shadow 0.15s",
      }}
    >
      {action.loading ? "…" : `${action.icon || "✦"} ${action.label}`}
    </button>
  );
}
