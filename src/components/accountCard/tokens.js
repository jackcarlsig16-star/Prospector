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
