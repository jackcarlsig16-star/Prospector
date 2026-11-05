// homelover-flow-v1 F2 / F4 - one Fit level (how much we want them), separate from Due (when to act) and from the
// intent band (how hot the signal is). Shared by the routes and the panel / Map; the stored values match the CHECK
// constraints in supabase/migrations/20261104_homelover_flow_v1.sql.
export const FIT_LEVELS = ['strong', 'good', 'low', 'deprioritized'];
export const FIT_WORD = { strong: 'Strong', good: 'Good', low: 'Low', deprioritized: 'Deprioritized' };
// A person may set these three by hand; Deprioritized only ever comes with a reason (F4).
export const HAND_FIT_LEVELS = ['strong', 'good', 'low'];
// Record priority 1-4 -> the hand-set Fit it migrated onto (F2; 4 -> low, never auto-Deprioritized).
export const PRIORITY_TO_FIT = { 1: 'strong', 2: 'good', 3: 'low', 4: 'low' };
// REVISABLE in sales_settings.fit_settings: { thresholds: { strong, good }, weights: { <axis>: n } }.
export const DEFAULT_FIT_THRESHOLDS = { strong: 70, good: 45 };

export const DEPRIORITIZE_REASONS = [
  ['mostly_outside_us', 'Mostly outside US'], ['too_small', 'Too small'], ['wrong_industry', 'Wrong industry'],
  ['has_housing_perk', 'Has housing perk'], ['upside_owns', 'Upside owns'], ['other', 'Other'],
];
export const DEPRIORITIZE_REASON_IDS = DEPRIORITIZE_REASONS.map(([id]) => id);
export const DEPRIORITIZE_REASON_WORD = Object.fromEntries(DEPRIORITIZE_REASONS);
export const DEPRIORITIZE_NOTE_MAX = 200;

// Intent bands keep their thresholds; only the words change (F2).
export const BAND_WORD = { P1: 'Hot', P2: 'Warm', P3: 'Cool', P4: 'Cold' };

export const DUE_LEVELS = ['today', 'week', 'later'];
export const DUE_WORD = { today: 'Today', week: 'This week', later: 'Later' };

export const US_FOOTPRINTS = ['mostly_us', 'mixed', 'mostly_outside_us'];
export const US_FOOTPRINT_WORD = { mostly_us: 'Mostly US', mixed: 'Mixed', mostly_outside_us: 'Mostly outside US' };

export const FIT_AXES = [
  ['intent', 'Intent'], ['industry', 'Industry'], ['size', 'Size'], ['us_footprint', 'US footprint'], ['buyers', 'Buyers reachable'], ['warm_path', 'Warm path'],
];
export const FIT_AXIS_IDS = FIT_AXES.map(([id]) => id);
export const FIT_AXIS_WORD = Object.fromEntries(FIT_AXES);
