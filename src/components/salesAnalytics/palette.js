// dashboard-v2 Stage 3 - single source of truth for every color this
// feature uses. The same cohort is the same color in every widget, chart,
// legend, and the PDF - nothing else computes its own color. Color is
// never the only signal; every colored mark pairs with a text label or
// legend entry (enforced in the components that use this file, not here).
//
// 7 real, deliberately-chosen cohort hues plus one reserved Partner hue,
// spaced to stay clear of the 3 semantic colors below (healthy/warning/
// problem) so a colored dot never carries two different meanings
// depending on context - e.g. no cohort reuses the same green as
// "healthy" or the same red as "problem". Not reused from
// colors.js/tokens.js's existing tokens (which are mostly warm
// gold/orange/red, i.e. exactly the zone reserved for semantics here) -
// chosen fresh, cool-leaning (180-340 degrees of hue) plus one warm lime
// for Partner that sits clear of amber (45deg) and green (150deg).

export const COHORT_COLORS = {
  SaaS: '#22D3D3',
  Retail: '#4F96F0',
  Hospitality: '#7B6FEE',
  Wireless: '#A862E8',
  'Car Rental': '#D158D8',
  Fitness: '#F0569E',
  Other: '#8C8C92',
};

export const PARTNER_COLOR = '#A8D04A';

// Matches this app's existing C.green / T.amber / C.red tokens exactly -
// reusing the established meaning of those colors rather than inventing a
// fourth palette for "healthy/warning/problem".
export const SEMANTIC = {
  healthy: '#42E890',
  warning: '#FFB800',
  problem: '#F06060',
};

export function cohortColor(cohort) {
  return COHORT_COLORS[cohort] || COHORT_COLORS.Other;
}

// PROPOSED (SPEC) - revisable starting thresholds, flag back rather than
// silently tuning.
export const HEALTH_THRESHOLDS = {
  bounceAmber: 0.03,
  bounceRed: 0.08,
  openAmber: 0.05,
};

export function bounceHealthColor(bouncePercent) {
  if (bouncePercent === null || bouncePercent === undefined) return null;
  if (bouncePercent >= HEALTH_THRESHOLDS.bounceRed) return SEMANTIC.problem;
  if (bouncePercent >= HEALTH_THRESHOLDS.bounceAmber) return SEMANTIC.warning;
  return SEMANTIC.healthy;
}

export function openHealthColor(openPercent) {
  if (openPercent === null || openPercent === undefined) return null;
  if (openPercent < HEALTH_THRESHOLDS.openAmber) return SEMANTIC.warning;
  return SEMANTIC.healthy;
}
