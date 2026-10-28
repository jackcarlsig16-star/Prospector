// global-workspace-navigation-v1 — single source of truth for the per-business
// workspace nav (Sidebar.js), in nav-admin-cleanup-v1's menu order.
// feature: the item only shows when businesses.features[feature] is true
// (set per workspace by the platform owner in Admin > Settings); hiddenWith:
// the item hides when that feature (or any of those features) is on
// (actions-home-attention-v1 D1: a goals_sales workspace lives in Sales &
// Marketing; hk-legacy-cleanup-v1 Stage 2: an hk_sales workspace lives in the
// Sales OS shell and the six legacy pages are hidden there - Jack ruled scrap,
// so there is no path back to them from the shell. The pages stay in the code
// and in every other workspace).
// ideas/tools are app-level pages shown inside the workspace: App.js renders
// them for these views instead of BusinessDetailPage (APP_LEVEL_VIEWS).
export const BUSINESS_NAV = [
  { id: "command-center",  ic: "⌂", lb: "Command Center", hiddenWith: ["goals_sales", "hk_sales"] },
  { id: "sales-analytics", ic: "📈", lb: "Sales & Marketing", feature: "goals_sales" },
  { id: "hk-sales",        ic: "✿", lb: "Grow", feature: "hk_sales" },
  { id: "accounts",        ic: "◈", lb: "Accounts", hiddenWith: "hk_sales" },
  { id: "projects",        ic: "▣", lb: "Projects", hiddenWith: "hk_sales" },
  { id: "overview",        ic: "◉", lb: "Business Intel & Strategy", hiddenWith: "hk_sales" },
  { id: "ideas",           ic: "◆", lb: "Ideas", hiddenWith: "hk_sales" },
  { id: "tools",           ic: "⚒", lb: "Tools", hiddenWith: "hk_sales" },
];

export const TOOLS_NAV = [
  { id: "deal",       ic: "$",  lb: "Deal Workspace" },
  { id: "blueprints", ic: "📊", lb: "Deck Blueprints" },
  { id: "lookalike",  ic: "◈",  lb: "Account Lookalike" },
];

export const APP_LEVEL_VIEWS = ["ideas", "tools"];

const on = (b, f) => !!b?.features?.[f];
const hidden = (b, n) => [].concat(n.hiddenWith || []).some(f => on(b, f));
export const workspaceNav = b => (b ? BUSINESS_NAV.filter(n => (!n.feature || on(b, n.feature)) && !hidden(b, n)) : []);
// Where a workspace opens: Sales & Marketing (its Actions tab) with goals_sales, the HumanKind Sales OS shell with
// hk_sales, else Command Center.
export const homePage = b => (on(b, 'goals_sales') ? 'sales-analytics' : on(b, 'hk_sales') ? 'hk-sales' : 'command-center');
