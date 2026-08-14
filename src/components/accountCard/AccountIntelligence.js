import { mono } from '../../constants/colors';
import { CARD, RADIUS } from './tokens';

// Section 12 — generic Intelligence section frame. Business/influencer
// content (compact summary + drawer trigger, or the Creator/Fit/Relationship
// modules) is supplied by the composer as children, kept kind-agnostic here
// so this stays a reusable layout primitive.
export default function AccountIntelligence({ children, action }) {
  return (
    <div style={{ background: CARD.surface, border: `1px solid ${CARD.border}`, borderRadius: RADIUS.lg, padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
        <p style={{ ...mono, margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: CARD.textSubtle, flex: 1 }}>Intelligence</p>
        {action}
      </div>
      {children}
    </div>
  );
}
