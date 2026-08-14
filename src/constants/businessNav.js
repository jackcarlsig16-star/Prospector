// global-workspace-navigation-v1 — single source of truth for the per-business
// workspace nav. Previously duplicated verbatim between Sidebar.js (owner
// session) and MemberShell.js (joined-member session, which can't render
// Sidebar itself since that assumes a full teamUsers/role/admin-badge user).
export const BUSINESS_NAV = [
  { id: "command-center", ic: "⌂", lb: "Command Center" },
  { id: "overview",       ic: "◉", lb: "Business Intel & Strategy" },
  { id: "accounts",       ic: "◈", lb: "Accounts" },
  { id: "search",         ic: "🔍", lb: "Search" },
  { id: "generation",     ic: "✉", lb: "Generation" },
  { id: "projects",       ic: "▣", lb: "Projects" },
  { id: "members",        ic: "👥", lb: "Members", ownerOnly: true },
];
