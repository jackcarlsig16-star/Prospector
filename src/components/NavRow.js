import { useState } from 'react';
import { C, mono } from '../constants/colors';

// global-workspace-navigation-v1 — shared row renderer for Sidebar.js and
// MemberShell.js's business-workspace nav, extracted alongside BUSINESS_NAV
// so the two sessions can't visually diverge from each other again. `accent`
// defaults to the app gold (today's exact look); workspace color propagation
// passes activeBusiness.color instead.
//
// Active state deliberately strong, not a nudge (nav-active-state-v1) - the
// original background:C.card was a flat neutral token with no tie to the
// business's own accent color, which read as "no indicator at all" even
// though it was technically there. Accent-tinted background + thicker
// border + an inset glow bleeding in from the edge + bold bright label
// text makes active vs. inactive unmistakable at a glance.
export default function NavRow({ icon, label, active, onClick, accent = C.gold }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: "7px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
        background: active ? `${accent}33` : hovered ? `${accent}14` : "transparent",
        borderLeft: `5px solid ${active ? accent : "transparent"}`,
        boxShadow: active ? `inset 10px 0 16px -12px ${accent}` : "none",
        transition: "background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease",
      }}
    >
      <span style={{ ...mono, fontSize: 14, color: active ? accent : C.mut, transition: "color 0.18s ease" }}>{icon}</span>
      <span style={{ fontSize: 13, color: active ? C.txt : C.mut, fontWeight: active ? 600 : 400, flex: 1, lineHeight: 1.3, transition: "color 0.18s ease" }}>{label}</span>
    </div>
  );
}
