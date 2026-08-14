import { C, mono } from '../constants/colors';

// global-workspace-navigation-v1 — shared row renderer for Sidebar.js and
// MemberShell.js's business-workspace nav, extracted alongside BUSINESS_NAV
// so the two sessions can't visually diverge from each other again. `accent`
// defaults to the app gold (today's exact look); workspace color propagation
// passes activeBusiness.color instead.
export default function NavRow({ icon, label, active, onClick, accent = C.gold }) {
  return (
    <div onClick={onClick} style={{ padding:"7px 12px", cursor:"pointer", display:"flex", alignItems:"center", gap:8, background:active?C.card:"transparent", borderLeft:`3px solid ${active?accent:"transparent"}` }}>
      <span style={{ ...mono, fontSize:14, color:active?accent:C.mut }}>{icon}</span>
      <span style={{ fontSize:13, color:active?C.txt:C.mut, flex:1, lineHeight:1.3 }}>{label}</span>
    </div>
  );
}
