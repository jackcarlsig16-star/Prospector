import { SA } from './theme';
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

// sales-analytics-design-v1 - replaced with the approved mockup's muted
// palette (specs/design/sales-analytics-mockup.html). Hospitality has no
// value in that mockup (HomeLover has zero Hospitality-cohort sequences
// today, so it wasn't shown) - this is a GUESS in the same muted,
// cool-leaning family as the rest, flagged for Jack to correct rather
// than silently treated as final.
export const COHORT_COLORS = {
  Fitness: '#E07A5F',
  Retail: '#6C9BD2',
  'Car Rental': '#B39DDB',
  SaaS: '#5FB3A8',
  Wireless: '#D4B26A',
  Other: '#7A8390',
  Hospitality: '#8C8FD1', // GUESS - not in the mockup, flag back if wrong
};

// Base hex unchanged; the mockup applies this at 70% opacity wherever it
// fills a shape (stacked-bar segments, chips) - that's a per-usage-site
// concern, not a second constant here.
export const PARTNER_COLOR = '#A8D04A';

export const AUDIENCE_LABELS = { employer: 'Employer', membership: 'Membership org', channel_partner: 'Channel partner' };
export function audienceColor(audience) { return audience === 'employer' ? SA.muted : PARTNER_COLOR; }

// sales-analytics-design-v1 - updated to the mockup's status hex values
// (good/warn/bad in the mockup = healthy/warning/problem here; same
// three-meaning model, new values). Single source every widget already
// imports from, so this takes effect everywhere at once, independent of
// each widget's own layout restyle stage.
export const SEMANTIC = {
  healthy: '#3DD68C',
  warning: '#F2B544',
  problem: '#FF6B6B',
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
