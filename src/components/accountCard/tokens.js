// Design tokens for the unified Account Card system (account-card-full-redesign-v2).
// Centralized so no component hardcodes its own palette/spacing.

export const CARD = {
  bg: "#0a0e0a",
  surface: "#0f140f",
  surface2: "#121812",
  border: "#1f2b1f",
  borderStrong: "#2a382a",
  textPrimary: "#e5e5e0",
  textSecondary: "#a0aaa0",
  textMuted: "#6f7b6f",
  textSubtle: "#566056",
};

export const KIND = {
  business: {
    accent: "#4ade80",
    bg: "#0f2a1a",
    text: "#4ade80",
    border: "rgba(74, 222, 128, 0.30)",
    label: "BUSINESS",
  },
  influencer: {
    accent: "#e879f9",
    bg: "#2a0f28",
    text: "#e879f9",
    border: "rgba(232, 121, 249, 0.30)",
    label: "INFLUENCER",
  },
};

export const kindTokens = (accountKind) => KIND[accountKind] || KIND.business;

// account-card-color-fix-and-guided-generate-v1 (Part A1) — role colors
// restored from the exact pre-redesign values (git show 0f6d605), not
// invented. Green/magenta stay reserved for kind identity + the primary
// action; these mark specific control roles instead.
export const ROLE = {
  intelligenceLabel: "#c8922a", // pre-redesign "Intelligence" section label
  dealStageLabel: "#f59e0b",    // pre-redesign "Deal Stage" section label
  stageAccent: "#56A8F8",       // blue/teal — Stage control identity
  neutralGray: "#9aa0a6",       // true neutral (no green cast) — Source/Cold
  // account-card-cleanup-v1 Stage 1 — warm, saturated "orange creamsicle,"
  // deliberately distinct from C.orange (#F5A050, already load-bearing as a
  // warning/attention color elsewhere) and ROLE.dealStageLabel/Comms amber
  // (#f59e0b). Reserved for Generate-type actions only — meant to become
  // the app's trusted "this is accurate, generated output" signal, so it
  // must not get diluted by reuse elsewhere.
  generateAccent: "#FF8A3D",
};

// A1b — restrained neon-glow-on-focus for interactive/important elements
// only (primary action, focused inputs, kind badges) — never body text,
// section labels, or the Tier 3 utility row. `currentColor` picks up
// whatever `color` the element already has, so one rule covers every
// accent (Stage's blue, Source's per-source hue, etc.) without per-case
// plumbing.
export const GLOW_FOCUS_CLASS = "ac-glow-focus";
export const GLOW_FOCUS_STYLE = `.${GLOW_FOCUS_CLASS}:focus{box-shadow:0 0 6px currentColor;border-color:currentColor !important;outline:none;}`;

export const SPACE = { xs: 4, sm: 6, md: 8, lg: 12, xl: 16, xxl: 20, xxxl: 24 };

export const TYPE = {
  name:        { fontSize: 16, fontWeight: 600 },
  metaPrimary: { fontSize: 13, fontWeight: 400 },
  body:        { fontSize: 13, fontWeight: 400 },
  metaSecond:  { fontSize: 12, fontWeight: 400 },
  sectionLbl:  { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" },
  tiny:        { fontSize: 10, fontWeight: 400 },
};

export const RADIUS = { sm: 4, md: 6, lg: 8 };
