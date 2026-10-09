// shell-facelift-v1 - the one place every design value lives. The four older
// token files (constants/tokens.js, constants/colors.js, accountCard/tokens.js,
// salesAnalytics/theme.js) re-export from here with their values unchanged;
// only src/ui kit components use the unified KIT_* set at the bottom.

// ── HUD palette (constants/tokens.js `T`) ─────────────────────────────────────
export const T = {
  neon:    '#39FF14',
  amber:   '#FFB800',
  amber2:  '#F59E0B',
  cyan:    '#00F5FF',
  magenta: '#FF3DFF',
  red:     '#FF4444',
  // tier-badge-metal-colors-v1 - tin nudged off silver's blue-grey hue
  // (was #8899AA, read as "darker silver" not a distinct metal) toward a
  // duller, warmer grey so all four tiers are distinguishable by hue, not
  // just lightness.
  tier: {
    gold:   '#FFD700',
    silver: '#7EB8D4',
    tin:    '#8C8C82',
    slag:   '#555566',
  },
  bg: {
    base:         '#050f05',
    card:         '#0a0f0a',
    cardExpanded: '#0d150d',
    surface:      '#0a1a0f',
  },
  border: {
    muted:  '#333',
    dim:    '#1a1a1a',
    subtle: 'rgba(255,255,255,0.06)',
    mid:    'rgba(255,255,255,0.12)',
  },
  text: {
    primary: '#e8e8e8',
    muted:   '#888',
    dim:     '#555',
  },
  spacing: {
    pill: '2px 7px',
    row:  '12px 14px',
    gap:  { xs: 4, sm: 6, md: 8 },
  },
};

// ── App colors (constants/colors.js `C`) ──────────────────────────────────────
// bg/sur/card/txt/mut/dim are the --c-* vars in index.css (dark on :root, light
// under body.mode-straight-shooter).
export const C = {
  bg: "var(--c-bg)", sur: "var(--c-sur)", card: "var(--c-card)", brd: "#2E3548", brdM: "#3A4258",
  txt: "var(--c-txt)", mut: "var(--c-mut)", dim: "var(--c-dim)",
  gold: T.tier.gold, goldBg: "#1A1500", goldBdr: "#4A3800", goldTxt: "#FFE066",
  silver: T.tier.silver, silverBg: "#15191E", silverBdr: "#3A4250",
  tin: T.tier.tin, tinBg: "#111418", tinBdr: "#2A3340",
  slag: T.tier.slag, slagBg: "#0E0E12", slagBdr: "#26262E",
  green: "#42E890", red: "#F06060", orange: "#F5A050", purple: "#A878F0", blue: "#56A8F8",
};
export const TS = {
  Gold: { c: C.gold, bg: C.goldBg, b: C.goldBdr, t: C.goldTxt, i: "◆" },
  Silver: { c: C.silver, bg: C.silverBg, b: C.silverBdr, t: C.silver, i: "◇" },
  Tin: { c: C.tin, bg: C.tinBg, b: C.tinBdr, t: C.tin, i: "○" },
  Slag: { c: C.slag, bg: C.slagBg, b: C.slagBdr, t: C.slag, i: "×" },
};
// tier-badge-metal-colors-v1 - the single flat tier->color lookup. Several
// call sites had drifted into their own local Gold/Silver/Tin/Slag maps
// (some wrong - e.g. one swapped Silver/Tin, another only had Gold/Silver/
// Bronze and fell back to a neutral color for Tin/Slag). This is the one
// source of truth; import this instead of redefining locally.
export const TIER_COLOR = { Gold: TS.Gold.c, Silver: TS.Silver.c, Tin: TS.Tin.c, Slag: TS.Slag.c };
export const mono = { fontFamily: "'SF Mono', ui-monospace, monospace" };
// business-intel-strategy-visual-redesign-v1 — narrative body text (profile
// field values) reads better as sans-serif; mono stays reserved for data/
// keys/tags/metrics, unchanged everywhere else in the app.
export const sans = { fontFamily: "'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif" };
// Shared preset swatch picker values - projects and businesses create modals both use this set.
// Second row (earth tones) added on request - same flat hex-array structure,
// no named layer, wraps into its own row via the picker's existing
// flex-wrap layout with no rendering changes needed.
export const PRESET_SWATCH_COLORS = ['#6366f1','#3b82f6','#14b8a6','#22c55e','#eab308','#f97316','#ef4444','#ec4899','#8b5cf6','#8B4513','#D2B48C','#C1440E','#808000','#A18A73','#A0522D'];

// ── Account Card (accountCard/tokens.js, account-card-full-redesign-v2) ───────
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
  // generation-modal-advanced-inputs-v1 — Project's own accent family,
  // established as a real reusable token (not an inline hex) per the spec's
  // explicit instruction, so LinkedProjects.js or anywhere else Project
  // context appears can pick it up later without re-deriving a color.
  // Deliberately a different red from C.red (#F06060, already load-bearing
  // for danger/error/Competitor elsewhere) - Project is a category, not a
  // warning, and needs to read distinctly from ROLE.generateAccent's orange
  // when the two sit side by side in the same panel.
  projectAccent: "#E5484D",
  // generation-modal-project-picker-and-advanced-visibility-v1 — third
  // terminal accent, same family logic as generateAccent (orange) and
  // projectAccent (red): glow-not-fill, thin border, monospace label.
  // Deliberately distinct from the #2dd4bf teal already scattered around
  // the app (AccountCardComms's old email-type toggle, plan-type toggles)
  // - this is a real named accent for "this is an expansion/disclosure
  // control," not a restyle of an existing ad hoc teal usage.
  advancedAccent: "#22D3EE",
};

export const CARD_TYPE = {
  name:        { fontSize: 16, fontWeight: 600 },
  metaPrimary: { fontSize: 13, fontWeight: 400 },
  body:        { fontSize: 13, fontWeight: 400 },
  metaSecond:  { fontSize: 12, fontWeight: 400 },
  sectionLbl:  { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" },
  tiny:        { fontSize: 10, fontWeight: 400 },
};

export const CARD_RADIUS = { sm: 4, md: 6, lg: 8 };

// ── Sales module (salesAnalytics/theme.js, sales-analytics-design-v1) ─────────
export const SA_DARK_VALUES = {
  ground: '#0B0D10', surface: '#12161B', surface2: '#171C22', border: '#232A33',
  text: '#E9ECF0', muted: '#8B95A3', faint: '#5E6773',
  accent: '#8FA8FF', // the ONE accent - primary button, selected states, Apollo source badge
  good: '#3DD68C', warn: '#F2B544', bad: '#FF6B6B',
  barNeutral: '#4A5565', // the leaderboard's inline Delivered bar fill (mockup value, not cohort/status-colored on purpose)
  // sales-goals-v1 REV4 (specs/design/goals-mockup.dc.html)
  track: '#1C222A', // row dividers, empty bar/ring track
  inset: '#0F1317', // cards inside cards, text areas
  borderStrong: '#46505E', // checkbox outlines, an expanded card's border
  link: '#AFC0FF',
  soft: '#C9D0D9', // secondary text a step brighter than muted
  neutral: '#4A5462', // "not started" status
};

// Print media (DECIDED): white ground/surface, dark text, same accent/
// status hues as the screen - only the 7 values that actually differ are
// listed, the rest spread from SA_DARK_VALUES unchanged.
export const SA_PRINT_VALUES = {
  ...SA_DARK_VALUES,
  ground: '#FFFFFF', surface: '#FFFFFF', surface2: '#F7F8FA', border: '#E3E6EA',
  text: '#14171C', muted: '#5B6470', faint: '#8A93A0',
  track: '#E3E6EA', inset: '#F7F8FA', borderStrong: '#B8BEC7', link: '#3A55C8', soft: '#3B4350', neutral: '#B8BEC7',
};

// A handful of call sites need a translucent wash of SA.bad (row tints,
// pill backgrounds, banner borders) - string-concatenating a hex alpha
// suffix onto a CSS var() reference isn't valid CSS, so these are
// pre-mixed instead via color-mix() (Chromium has supported this for
// years - this app already assumes an evergreen browser, Google Fonts/
// CSS Grid are used unconditionally elsewhere). Three levels, covering
// every alpha value previously hand-picked per call site.
export const SA_BAD_TINT = 'color-mix(in srgb, var(--sa-bad) 5%, transparent)'; // row backgrounds
export const SA_BAD_BG = 'color-mix(in srgb, var(--sa-bad) 10%, transparent)'; // pill/banner backgrounds
export const SA_BAD_BORDER = 'color-mix(in srgb, var(--sa-bad) 27%, transparent)'; // banner borders

export const saSans = { fontFamily: "'Geist', ui-sans-serif, system-ui, -apple-system, sans-serif" };
export const saMono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

// Small uppercase labels use Geist Mono; everything else uses Geist (UI).
// SA_TYPE.body is also applied once, on #sales-analytics-root itself, so
// every element inherits Geist by default (the app's own global body CSS
// sets monospace - without this, anything here that doesn't explicitly
// request SA_TYPE.label would silently inherit that instead of Geist).
export const SA_TYPE = {
  pageTitle: { ...saSans, fontSize: 34, fontWeight: 600, letterSpacing: '-0.025em' },
  cardTitle: { ...saSans, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' },
  kpiValue: { ...saSans, fontSize: 38, fontWeight: 600, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' },
  body: { ...saSans, fontSize: 14 },
  label: { ...saMono, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' },
};

export const SA_SHAPE = {
  radiusCard: 14,
  radiusInner: 10,
  radiusPill: 999,
  space: [4, 8, 12, 16, 24], // index by scale step, e.g. SA_SHAPE.space[2] === 12
};

// ── UI kit (shell-facelift-v1) ────────────────────────────────────────────────
// The one shared shell vocabulary: the sales module's look (Geist UI, Geist
// Mono labels, one blue accent) for every page that adopts src/ui. Dark is the
// sales screen palette; light (body.mode-straight-shooter) starts from the
// sales print palette. New values only where a check needed them:
// - control: input / switch outlines need 3:1 against the surface (WCAG
//   1.4.11); SA borderStrong is 2.2:1.
// - light good/warn/bad: the sales print hues are 1.8-2.1:1 on white. These
//   pass the dataviz validator (light, all pairs; CVD 6.7 = floor band, so a
//   StatusPill always carries an icon + label, never color alone).
// - dangerInk: danger button text; light bad is 4.0:1 on white, under 4.5.
export const KIT_SPACE = [4, 8, 12, 16, 24, 32];
export const KIT_MAX_WIDTH = 1100;
export const KIT_RADIUS = { card: SA_SHAPE.radiusCard, control: 8, pill: SA_SHAPE.radiusPill };

export const KIT_DARK = {
  ground: SA_DARK_VALUES.ground,
  surface: SA_DARK_VALUES.surface, surface2: SA_DARK_VALUES.surface2, inset: SA_DARK_VALUES.inset,
  border: SA_DARK_VALUES.border, control: '#6B7480',
  text: SA_DARK_VALUES.text, soft: SA_DARK_VALUES.soft, muted: SA_DARK_VALUES.muted, faint: SA_DARK_VALUES.faint,
  accent: SA_DARK_VALUES.accent, onAccent: SA_DARK_VALUES.ground,
  good: SA_DARK_VALUES.good, warn: SA_DARK_VALUES.warn, bad: SA_DARK_VALUES.bad, off: '#6B7480',
  dangerInk: SA_DARK_VALUES.bad,
};

export const KIT_LIGHT = {
  ground: SA_PRINT_VALUES.surface2,
  surface: SA_PRINT_VALUES.surface, surface2: SA_PRINT_VALUES.surface2, inset: SA_PRINT_VALUES.inset,
  border: SA_PRINT_VALUES.border, control: '#7A828E',
  text: SA_PRINT_VALUES.text, soft: SA_PRINT_VALUES.soft, muted: SA_PRINT_VALUES.muted, faint: SA_PRINT_VALUES.faint,
  accent: SA_PRINT_VALUES.link, onAccent: '#FFFFFF',
  good: '#1E8A4C', warn: '#A06A00', bad: '#E0465A', off: '#7A828E',
  dangerInk: '#B42F3E',
};

export const KIT_TYPE = {
  title: SA_TYPE.pageTitle,
  subtitle: { ...saSans, fontSize: 14 },
  cardTitle: SA_TYPE.cardTitle,
  body: SA_TYPE.body,
  small: { ...saSans, fontSize: 13 },
  label: SA_TYPE.label,
};
