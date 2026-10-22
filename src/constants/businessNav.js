// global-workspace-navigation-v1 — single source of truth for the per-business
// workspace nav (Sidebar.js), in nav-admin-cleanup-v1's menu order.
// feature: the item only shows when businesses.features[feature] is true
// (set per workspace by the platform owner in Admin > Settings); hiddenWith:
// the item hides when that feature is on (actions-home-attention-v1 D1: a
// goals_sales workspace lives in Sales & Marketing; Command Center stays in
// the code and in every other workspace).
// ideas/tools are app-level pages shown inside the workspace: App.js renders
// them for these views instead of BusinessDetailPage (APP_LEVEL_VIEWS).
export const BUSINESS_NAV = [
  { id: "command-center",  ic: "⌂", lb: "Command Center", hiddenWith: "goals_sales" },
  { id: "sales-analytics", ic: "📈", lb: "Sales & Marketing", feature: "goals_sales" },
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

const on = (b, f) => !!b?.features?.[f];
export const workspaceNav = b => (b ? BUSINESS_NAV.filter(n => (!n.feature || on(b, n.feature)) && !(n.hiddenWith && on(b, n.hiddenWith))) : []);
// Where a workspace opens: Sales & Marketing (its Actions tab) with goals_sales, else Command Center.
export const homePage = b => (on(b, 'goals_sales') ? 'sales-analytics' : 'command-center');
