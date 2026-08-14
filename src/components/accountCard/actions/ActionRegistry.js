// Section 10/11/26 — the extensibility mechanism. An "action" is a plain
// data object, not a component: { tier: 1|2|3|4, key, label, icon, onClick,
// active, loading, disabled, badge, danger }. Composers (AccountCard.js,
// business/influencer state modules) build arrays of these; groupByTier
// splits them for PrimaryAction/ActionGroup/UtilityRow/AdminOverflowMenu to
// render. Adding a new action anywhere in the app means pushing one object
// into an array with a tier number — never touching this file or the
// tier-renderer components.

export function groupByTier(actions = []) {
  return {
    1: actions.filter(a => a.tier === 1),
    2: actions.filter(a => a.tier === 2),
    3: actions.filter(a => a.tier === 3),
    4: actions.filter(a => a.tier === 4),
  };
}
