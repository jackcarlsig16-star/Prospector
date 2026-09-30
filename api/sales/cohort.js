// Cohort = a keyword map over sequence names (audit A6j; SPEC design
// decision - not a separate Apollo field). This is the real implementation,
// needed here in Stage 2 because the sequences adapter must tag each
// sequence with a cohort before per-cohort metrics can be computed. The
// SPEC's Stage 3 says metrics.registry.js (a client-side file) "holds" this
// map - that file can't import server-side api/sales/* code across the
// CRA build boundary, so Stage 3 will need its own copy of this list kept
// in sync by hand, or a shared plain-data module under src/. Flagged in the
// Stage 2 report rather than silently resolved.

const COHORT_KEYWORDS = [
  ['Retail', /retail/i],
  ['Hospitality', /hospitality|hotel|motel/i],
  ['SaaS', /saas/i],
  ['Car Rental', /car rental/i],
  ['Fitness', /fitness|gym/i],
  ['Wireless', /wireless|cell phone/i],
];

export function cohortForSequenceName(name) {
  const n = name || '';
  for (const [cohort, pattern] of COHORT_KEYWORDS) {
    if (pattern.test(n)) return cohort;
  }
  return 'Other';
}
