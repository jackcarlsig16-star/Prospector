// Design tokens for the unified Account Card system (account-card-full-redesign-v2).
// Values live in src/ui/tokens.js.
import { KIND } from '../../ui/tokens';

export { CARD, KIND, ROLE, CARD_TYPE as TYPE, CARD_RADIUS as RADIUS } from '../../ui/tokens';

export const kindTokens = (accountKind) => KIND[accountKind] || KIND.business;

// A1b — restrained neon-glow-on-focus for interactive/important elements
// only (primary action, focused inputs, kind badges) — never body text,
// section labels, or the Tier 3 utility row. `currentColor` picks up
// whatever `color` the element already has, so one rule covers every
// accent (Stage's blue, Source's per-source hue, etc.) without per-case
// plumbing.
export const GLOW_FOCUS_CLASS = "ac-glow-focus";
export const GLOW_FOCUS_STYLE = `.${GLOW_FOCUS_CLASS}:focus{box-shadow:0 0 6px currentColor;border-color:currentColor !important;outline:none;}`;
