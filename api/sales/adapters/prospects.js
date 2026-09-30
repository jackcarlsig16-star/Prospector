import { apolloRequest } from '../apolloClient.js';

export const name = 'prospects';

// Deliberately NOT "records" in the usual sense - reads total_entries only,
// per_page 1, as SPEC'd. ctx.activeSequenceIds comes from the sequences
// adapter, which always runs first.
//
// The filter param (emailer_campaign_ids) is real but undocumented -
// confirmed working live in the audit only by checking that Apollo's own
// breadcrumbs echo it back (A7b/A7c: accounts/search silently ignores the
// equivalent filter with no error at all, so a 200 response proves
// nothing on its own here). If breadcrumbs don't confirm it, this throws
// and stores nothing rather than trusting an unverified total_entries.
export async function fetchRecords(ctx) {
  const activeIds = (ctx && ctx.activeSequenceIds) || [];
  if (activeIds.length === 0) {
    return { totalEntries: 0, skippedReason: 'no active sequences' };
  }

  const json = await apolloRequest({
    method: 'POST',
    path: '/contacts/search',
    body: { page: 1, per_page: 1, emailer_campaign_ids: activeIds },
    ctx,
  });

  const breadcrumbs = json.breadcrumbs || [];
  const echoedIds = new Set(
    breadcrumbs
      .filter(b => b.signal_field_name === 'emailer_campaign_ids')
      .map(b => b.value)
  );
  const confirmed = activeIds.every(id => echoedIds.has(id));
  if (!confirmed) {
    throw new Error('prospects adapter: breadcrumbs did not echo the emailer_campaign_ids filter for all active sequences - refusing to trust total_entries, storing nothing');
  }

  return { totalEntries: (json.pagination && json.pagination.total_entries) || 0 };
}

export function toMetrics(result) {
  if (result.skippedReason) {
    return {
      rows: [{ metric_key: 'prospects_in_cadence', dim_type: 'all', dim_value: 'all', value: 0 }],
      missing: [`prospects_in_cadence: ${result.skippedReason}`],
    };
  }
  return {
    rows: [{ metric_key: 'prospects_in_cadence', dim_type: 'all', dim_value: 'all', value: result.totalEntries }],
    missing: [],
  };
}
