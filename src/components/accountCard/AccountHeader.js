import { mono } from '../../constants/colors';
import { CARD, kindTokens } from './tokens';
import AccountBadge from './AccountBadge';

// Identity area per Section 8. Kind-agnostic — callers pass `meta` (the
// website/handle/location line) and `signals` (small "what matters right
// now" indicators, e.g. stale/at-risk, BDR assignment) so this component
// doesn't need to know about business vs. influencer data shapes.
export default function AccountHeader({
  accountKind, name, meta, signals = [],
  isFav, onToggleFav, expanded, onToggle, onOpenOverflow,
  onReassay, reassaying,
}) {
  const kind = kindTokens(accountKind);

  return (
    <div
      onClick={onToggle}
      style={{
        padding: "12px 14px",
        cursor: "pointer",
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        ...(expanded ? { borderBottom: `1px solid ${CARD.border}` } : {}),
      }}
    >
      <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: kind.accent, flexShrink: 0, marginTop: 6 }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: CARD.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</p>
          <AccountBadge tone={kind.accent} glow>{kind.label}</AccountBadge>
        </div>
        {meta && <p style={{ ...mono, margin: "2px 0 0", fontSize: 12, color: CARD.textMuted }}>{meta}</p>}
        {signals.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            {signals}
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
        <button onClick={() => onToggleFav && onToggleFav()} style={{ background: "transparent", border: "none", fontSize: 14, color: isFav ? "#f5c542" : CARD.textSubtle, cursor: "pointer", padding: "0 2px", lineHeight: 1 }}>★</button>
        {/* account-card-cleanup-v1 Stage 5 — Re-assay relocated here from the
            Tier-3 utility row, matching the star/overflow icon-button
            treatment instead of a full labeled button. */}
        {onReassay && (
          <button
            onClick={() => onReassay()}
            disabled={reassaying}
            title={reassaying ? "Analyzing…" : "Re-assay"}
            style={{ background: "transparent", border: "none", fontSize: 14, color: CARD.textSubtle, cursor: reassaying ? "default" : "pointer", padding: "0 2px", lineHeight: 1, opacity: reassaying ? 0.5 : 1, display: "inline-block", animation: reassaying ? "spin 0.7s linear infinite" : "none" }}
          >↻</button>
        )}
        {onOpenOverflow && (
          <button onClick={onOpenOverflow} style={{ background: "transparent", border: "none", fontSize: 14, color: CARD.textMuted, cursor: "pointer", padding: "2px 4px", lineHeight: 1 }} title="More">•••</button>
        )}
        <span style={{ fontSize: 10, color: CARD.textSubtle, marginLeft: 2 }}>{expanded ? "▲" : "▼"}</span>
      </div>
    </div>
  );
}
