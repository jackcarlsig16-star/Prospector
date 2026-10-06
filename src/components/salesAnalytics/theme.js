// sales-analytics-design-v1 - single source of truth for every generic
// (non-cohort, non-status) UI token this feature uses. Cohort/Partner/
// health-status colors stay in palette.js - a color never lives in two
// places. Scoped to src/components/salesAnalytics only; the rest of the
// app keeps its own existing dark-terminal HUD theme untouched.
//
// Stage 4 - every SA.* value is now a CSS custom-property reference
// (`var(--sa-x)`), not a literal hex string. #sales-analytics-root (the
// page's own outer wrapper, in SalesAnalyticsTab.js) defines the dark
// values; a @media print block on that same selector redefines them to
// the light print palette (SA_THEME_CSS below, injected once via a
// <style> tag). This is what makes print actually go light without any
// component needing print-aware logic, a runtime theme switch, or
// Chrome's "Background graphics" setting (SPEC requirement) - the browser
// itself resolves the right value per media context, same as any other
// CSS cascade.
const TOKEN_CSS_VARS = {
  ground: '--sa-ground', surface: '--sa-surface', surface2: '--sa-surface-2', border: '--sa-border',
  text: '--sa-text', muted: '--sa-muted', faint: '--sa-faint', accent: '--sa-accent',
  good: '--sa-good', warn: '--sa-warn', bad: '--sa-bad', barNeutral: '--sa-bar-neutral',
  track: '--sa-track', inset: '--sa-inset', borderStrong: '--sa-border-strong', link: '--sa-link',
  soft: '--sa-soft', neutral: '--sa-neutral',
};

const DARK_VALUES = {
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
// listed, the rest spread from DARK_VALUES unchanged.
const PRINT_VALUES = {
  ...DARK_VALUES,
  ground: '#FFFFFF', surface: '#FFFFFF', surface2: '#F7F8FA', border: '#E3E6EA',
  text: '#14171C', muted: '#5B6470', faint: '#8A93A0',
  track: '#E3E6EA', inset: '#F7F8FA', borderStrong: '#B8BEC7', link: '#3A55C8', soft: '#3B4350', neutral: '#B8BEC7',
};

export const SA = Object.fromEntries(Object.entries(TOKEN_CSS_VARS).map(([key, cssVar]) => [key, `var(${cssVar})`]));

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

function cssVarBlock(values) {
  return Object.entries(TOKEN_CSS_VARS).map(([key, cssVar]) => `${cssVar}: ${values[key]};`).join(' ');
}

export const SA_THEME_ROOT_ID = 'sales-analytics-root';
export const SA_THEME_CSS = `
  #${SA_THEME_ROOT_ID} { ${cssVarBlock(DARK_VALUES)} }
  @media print {
    #${SA_THEME_ROOT_ID} { ${cssVarBlock(PRINT_VALUES)} }
  }
`;

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
