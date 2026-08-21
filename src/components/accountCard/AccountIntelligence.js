import { mono } from '../../constants/colors';
import { CARD, RADIUS, ROLE } from './tokens';

// Section 12 — generic Intelligence section frame. Business/influencer
// content (compact summary + drawer trigger, or the Creator/Fit/Relationship
// modules) is supplied by the composer as children, kept kind-agnostic here
// so this stays a reusable layout primitive.
export default function AccountIntelligence({ children, action }) {
  return (
    <div style={{ background: CARD.surface, border: `1px solid ${CARD.border}`, borderRadius: RADIUS.md, padding: "14px" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
        {/* account-card-density-v1 — glow at the same 66 alpha step
            PrimaryAction.js already uses, so this reads as the established
            pattern rather than a new one. Hue stays ROLE.intelligenceLabel:
            the mockup renders this green only because its whole artboard is
            driven by one themeable {{accent}} knob, not because Intelligence
            was decided to stop being gold. */}
        <p style={{ ...mono, margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: ROLE.intelligenceLabel, textShadow: `0 0 6px ${ROLE.intelligenceLabel}66`, flex: 1 }}>Intelligence</p>
        {action}
      </div>
      {children}
    </div>
  );
}
