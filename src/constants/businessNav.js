// global-workspace-navigation-v1 — single source of truth for the per-business
// workspace nav (Sidebar.js), in nav-admin-cleanup-v1's menu order.
// businessIds: when present, the tab only shows for businesses whose id is in
// the list (checked in Sidebar.js).
// ideas/tools are app-level pages shown inside the workspace: App.js renders
// them for these views instead of BusinessDetailPage (APP_LEVEL_VIEWS).
export const BUSINESS_NAV = [
  { id: "command-center",  ic: "⌂", lb: "Command Center" },
  { id: "sales-analytics", ic: "📈", lb: "Goals & Sales", businessIds: ["bc69beab-effd-452d-9e81-fd652333bb95"] },
  { id: "accounts",        ic: "◈", lb: "Accounts" },
  { id: "projects",        ic: "▣", lb: "Projects" },
  { id: "overview",        ic: "◉", lb: "Business Intel & Strategy" },
  { id: "ideas",           ic: "◆", lb: "Ideas" },
  { id: "tools",           ic: "⚒", lb: "Tools" },
];

export const TOOLS_NAV = [
  { id: "deal",       ic: "$",  lb: "Deal Workspace" },
  { id: "blueprints", ic: "📊", lb: "Deck Blueprints" },
  { id: "lookalike",  ic: "◈",  lb: "Account Lookalike" },
];

export const APP_LEVEL_VIEWS = ["ideas", "tools"];
