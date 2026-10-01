// sales-analytics-design-v1 - single source of truth for every generic
// (non-cohort, non-status) UI token this feature uses: ground/surface/
// border/text/accent, the screen-vs-print palette split, type scale, and
// shape/spacing. Cohort/Partner/health-status colors stay in palette.js
// (their own established home, used by widgets this file doesn't touch) -
// a color never lives in two places. Scoped to src/components/
// salesAnalytics only; the rest of the app keeps its own existing
// dark-terminal HUD theme (constants/colors.js, constants/tokens.js)
// untouched.

export const SA = {
  ground: '#0B0D10',
  surface: '#12161B',
  surface2: '#171C22',
  border: '#232A33',
  text: '#E9ECF0',
  muted: '#8B95A3',
  faint: '#5E6773',
  accent: '#8FA8FF', // the ONE accent - primary button, selected states, Apollo source badge
  good: '#3DD68C',
  warn: '#F2B544',
  bad: '#FF6B6B',
};

// Print media never depends on Chrome's "Background graphics" checkbox
// (SPEC requirement) - components that render into the print-only area
// read from this instead of SA when rendering for print.
export const SA_PRINT = {
  ground: '#FFFFFF',
  surface: '#FFFFFF',
  border: '#E3E6EA',
  text: '#14171C',
  muted: '#5B6470',
  accent: SA.accent,
  good: SA.good,
  warn: SA.warn,
  bad: SA.bad,
};

export const saSans = { fontFamily: "'Geist', ui-sans-serif, system-ui, -apple-system, sans-serif" };
export const saMono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

// Small uppercase labels use Geist Mono; everything else uses Geist (UI).
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
