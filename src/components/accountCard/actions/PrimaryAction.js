import { mono } from '../../../constants/colors';
import { kindTokens, RADIUS, ROLE } from '../tokens';

// Tier 1 — one dominant action per Section 10. account-card-cleanup-v1
// Stage 1 — sized proportionate to the Tier 2/3 buttons below it (not
// full-width/full-height) so it reads as the primary action, not the only
// thing on the card. "Generate"-variant actions (action.variant ===
// 'generate') get the reserved orange accent instead of the kind color —
// every other primary action (Run Assay first, Assess this creator first)
// keeps the existing green/magenta kind accent.
export default function PrimaryAction({ accountKind, action }) {
  if (!action) return null;
  const kind = kindTokens(accountKind);
  const accent = action.variant === 'generate' ? ROLE.generateAccent : kind.accent;
  return (
    <button
      onClick={e => { e.stopPropagation(); action.onClick(); }}
      disabled={action.disabled || action.loading}
      style={{
        ...mono,
        fontSize: 12,
        fontWeight: 600,
        height: 32,
        padding: "0 16px",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: `${accent}16`,
        border: `1px solid ${accent}`,
        color: accent,
        borderRadius: RADIUS.md,
        cursor: action.disabled || action.loading ? "default" : "pointer",
        letterSpacing: "0.02em",
        opacity: action.disabled ? 0.5 : 1,
        // A1b — subtle neon glow so the primary action reads as "alive", not flat
        boxShadow: action.disabled ? "none" : `0 0 8px ${accent}55`,
        textShadow: action.disabled ? "none" : `0 0 6px ${accent}66`,
        transition: "box-shadow 0.15s, text-shadow 0.15s",
      }}
    >
      {action.loading ? "…" : `${action.icon || "✦"} ${action.label}`}
    </button>
  );
}
