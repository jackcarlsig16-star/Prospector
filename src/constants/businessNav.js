// global-workspace-navigation-v1 — single source of truth for the per-business
// workspace nav. Previously duplicated verbatim between Sidebar.js (owner
// session) and MemberShell.js (joined-member session, which can't render
// Sidebar itself since that assumes a full teamUsers/role/admin-badge user).
// generation-engine-consolidation-v1 Stage 2 — "Generation" nav entry
// removed (BusinessGenerationTab.js/EmailGenerator.js retired - static
// fintech-hardcoded templates, not AI, confirmed barely used). Real
// generation now lives on the account card and in Projects' bulk
// generation, not a separate tab.
export const BUSINESS_NAV = [
  { id: "command-center", ic: "⌂", lb: "Command Center" },
  { id: "overview",       ic: "◉", lb: "Business Intel & Strategy" },
  { id: "accounts",       ic: "◈", lb: "Accounts" },
  { id: "projects",       ic: "▣", lb: "Projects" },
  { id: "members",        ic: "👥", lb: "Members", ownerOnly: true },
];
