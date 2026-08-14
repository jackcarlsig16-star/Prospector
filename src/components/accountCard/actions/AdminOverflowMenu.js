import { mono } from '../../../constants/colors';
import { CARD, RADIUS } from '../tokens';

// Tier 4 — administrative/destructive actions kept out of the daily
// workflow per Section 10. Rendered as a small dropdown anchored under the
// header's ••• trigger; parent controls open/close state.
export default function AdminOverflowMenu({ open, onClose, actions = [] }) {
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: "absolute", top: 40, right: 12, zIndex: 41,
          background: CARD.surface2, border: `1px solid ${CARD.borderStrong}`, borderRadius: RADIUS.md,
          minWidth: 160, padding: 4, boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        }}
      >
        {actions.map(a => (
          <button
            key={a.key}
            onClick={() => { a.onClick(); if (!a.keepOpen) onClose(); }}
            disabled={a.disabled}
            style={{
              ...mono, display: "block", width: "100%", textAlign: "left",
              fontSize: 11, padding: "6px 10px", background: "transparent", border: "none",
              color: a.danger ? "#f06060" : CARD.textSecondary, cursor: a.disabled ? "default" : "pointer",
              opacity: a.disabled ? 0.5 : 1, borderRadius: RADIUS.sm,
            }}
          >
            {a.icon} {a.label}
          </button>
        ))}
      </div>
    </>
  );
}
