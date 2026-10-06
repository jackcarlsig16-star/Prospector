import { apolloPaginate } from '../apolloClient.js';

export const name = 'accounts';

export async function fetchRecords(ctx) {
  const records = await apolloPaginate({
    method: 'POST',
    path: '/accounts/search',
    body: {},
    ctx,
    extractRecords: json => json.accounts || [],
    extractPagination: json => json.pagination,
  });

  return records.map(r => ({
    id: r.id,
    name: r.name || null,
    domain: r.domain || null,
    num_contacts: typeof r.num_contacts === 'number' ? r.num_contacts : null,
    contact_emailer_campaign_ids: r.contact_emailer_campaign_ids || [],
    contact_campaign_status_tally: r.contact_campaign_status_tally || {},
  }));
}

// toMetrics(records, date, ctx) - ctx.sequenceCohortById (from the
// sequences adapter, which always runs first) is required for the
// per-cohort breakdown.
//
// companies_in_cadence = accounts with >=1 'active' contact per
// contact_campaign_status_tally (design decision, audit A6f - accounts/
// search has no per-campaign breakdown, only this rolled-up tally).
//
// Per-cohort is an approximation, not an exact count: tally is a single
// rollup across ALL of an account's assigned sequences, not broken out per
// sequence. An account counts toward every cohort any of its
// contact_emailer_campaign_ids belongs to, as long as it has >=1 active
// contact somewhere - not proof that specific active contact sits in that
// cohort's sequence. This is the best signal Apollo's API gives here
// (confirmed live in the audit: accounts/search silently ignores a
// contact_emailer_campaign_ids filter - A7c), not a precision guarantee.
export function toMetrics(records, date, ctx) {
  const rows = [];
  const missing = [];

  rows.push({ metric_key: 'accounts_total', dim_type: 'all', dim_value: 'all', value: records.length });

  const inCadence = records.filter(r => (r.contact_campaign_status_tally.active || 0) >= 1);
  rows.push({ metric_key: 'companies_in_cadence', dim_type: 'all', dim_value: 'all', value: inCadence.length });

  const cohortById = (ctx && ctx.sequenceCohortById) || {};
  const cohortCounts = {};
  for (const r of inCadence) {
    const cohorts = new Set(
      (r.contact_emailer_campaign_ids || []).map(id => cohortById[id]).filter(Boolean)
    );
    if (cohorts.size === 0) {
      missing.push(`account ${r.id}: no matching sequence id for cohort attribution`);
      continue;
    }
    for (const cohort of cohorts) {
      cohortCounts[cohort] = (cohortCounts[cohort] || 0) + 1;
    }
  }
  for (const [cohort, count] of Object.entries(cohortCounts)) {
    rows.push({ metric_key: 'companies_in_cadence', dim_type: 'cohort', dim_value: cohort, value: count });
  }

  return { rows, missing };
}
