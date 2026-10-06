import { useState } from 'react';
import { C, mono } from '../constants/colors';

// global-workspace-navigation-v1 — row renderer for Sidebar.js's
// business-workspace nav, extracted alongside BUSINESS_NAV. `accent`
// defaults to the app gold (today's exact look); workspace color propagation
// passes activeBusiness.color instead.
//
// Active state deliberately strong, not a nudge (nav-active-state-v1) - the
// original background:C.card was a flat neutral token with no tie to the
// business's own accent color, which read as "no indicator at all" even
// though it was technically there. Accent-tinted background + thicker
// border + an inset glow bleeding in from the edge + bold bright label
// text makes active vs. inactive unmistakable at a glance.
export default function NavRow({ icon, label, active, onClick, accent = C.gold, sub = false, tall = false, badge = 0 }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: "100%", minHeight: tall ? 44 : undefined, textAlign: "left", font: "inherit", border: "none",
        padding: sub ? "5px 12px 5px 30px" : "7px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
        background: active ? `${accent}33` : hovered ? `${accent}14` : "transparent",
        borderLeft: `5px solid ${active ? accent : "transparent"}`,
        boxShadow: active ? `inset 10px 0 16px -12px ${accent}` : "none",
        transition: "background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease",
      }}
    >
      <span aria-hidden="true" style={{ ...mono, fontSize: sub ? 12 : 14, color: active ? accent : C.mut, transition: "color 0.18s ease" }}>{icon}</span>
      <span style={{ fontSize: sub ? 12 : 13, color: active ? C.txt : C.mut, fontWeight: active ? 600 : 400, flex: 1, lineHeight: 1.3, transition: "color 0.18s ease" }}>{label}</span>
      {badge > 0 && (
        <span style={{ ...mono, minWidth: 16, height: 16, borderRadius: 8, background: "#EF4444", color: "#fff", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>{badge}</span>
      )}
    </button>
  );
}
