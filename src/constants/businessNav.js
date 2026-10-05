// global-workspace-navigation-v1 — single source of truth for the per-business
// workspace nav (Sidebar.js).
// generation-engine-consolidation-v1 Stage 2 — "Generation" nav entry
// removed (BusinessGenerationTab.js/EmailGenerator.js retired - static
// fintech-hardcoded templates, not AI, confirmed barely used). Real
// generation now lives on the account card and in Projects' bulk
// generation, not a separate tab.
// sales-analytics-core-v1 — businessIds is a new optional filter field:
// when present, the tab only shows for businesses whose id is in the list
// (checked in Sidebar.js alongside the existing ownerOnly
// check). Every other entry has no businessIds and is unaffected.
export const BUSINESS_NAV = [
  { id: "command-center", ic: "⌂", lb: "Command Center" },
  { id: "overview",       ic: "◉", lb: "Business Intel & Strategy" },
  { id: "accounts",       ic: "◈", lb: "Accounts" },
  { id: "projects",       ic: "▣", lb: "Projects" },
  { id: "members",        ic: "👥", lb: "Members", ownerOnly: true },
  { id: "sales-analytics", ic: "📈", lb: "Sales Analytics", businessIds: ["bc69beab-effd-452d-9e81-fd652333bb95"] },
];
