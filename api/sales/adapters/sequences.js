import { apolloPaginate } from '../apolloClient.js';
import { cohortForSequenceName } from '../cohort.js';

// sync.js runs this adapter FIRST and always - accounts.js and prospects.js
// both read ctx.sequenceCohortById / ctx.activeSequenceIds that sync.js
// derives from this adapter's own records after it returns. This is a real
// cross-adapter dependency, not adapter independence - the array order in
// sync.js matters for that reason alone.
export const name = 'sequences';

function isNumeric(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// Trimmed to exactly what Stage 2 metrics + the Stage 3 leaderboard widget
// need: id/name/active/cohort plus every real unique_* field the sequence
// carries (detected dynamically, not a hand-picked subset - Apollo's own
// field list for this isn't fully documented, see the audit A6b).
export async function fetchRecords(ctx) {
  const records = await apolloPaginate({
    method: 'POST',
    path: '/emailer_campaigns/search',
    body: {},
    ctx,
    extractRecords: json => json.emailer_campaigns || [],
    extractPagination: json => json.pagination,
  });

  return records.map(r => {
    const uniqueFields = {};
    for (const key of Object.keys(r)) {
      if (key.startsWith('unique_')) uniqueFields[key] = r[key];
    }
    return {
      id: r.id,
      name: r.name,
      active: !!r.active,
      archived: !!r.archived,
      cohort: cohortForSequenceName(r.name),
      num_steps: typeof r.num_steps === 'number' ? r.num_steps : null,
      is_performing_poorly: !!r.is_performing_poorly,
      created_at: r.created_at || null,
      ...uniqueFields,
    };
  });
}

// toMetrics(records, date, ctx) - ctx is unused here (kept for interface
// consistency with accounts.js, which does need it). Returns {rows,
// missing} rather than a bare array: a real, confirmed data quirk (one
// live sequence returned the literal string "loading" for unique_opened,
// loaded_stats:true notwithstanding - audit A6b) means non-numeric unique_*
// values are real and must be tracked, not coerced to 0 or silently
// dropped (landmine).
export function toMetrics(records) {
  const rows = [];
  const missing = [];

  rows.push({ metric_key: 'sequences_total', dim_type: 'all', dim_value: 'all', value: records.length });
  rows.push({ metric_key: 'sequences_active', dim_type: 'all', dim_value: 'all', value: records.filter(r => r.active).length });

  const uniqueKeys = new Set();
  records.forEach(r => Object.keys(r).forEach(k => { if (k.startsWith('unique_')) uniqueKeys.add(k); }));

  for (const key of uniqueKeys) {
    let allSum = 0;
    const cohortSums = {};
    for (const r of records) {
      const value = r[key];
      if (!isNumeric(value)) {
        missing.push(`sequence ${r.id} (${r.name}): ${key} = ${JSON.stringify(value)}`);
        continue;
      }
      allSum += value;
      cohortSums[r.cohort] = (cohortSums[r.cohort] || 0) + value;
      rows.push({ metric_key: key, dim_type: 'sequence', dim_value: r.id, value });
    }
    rows.push({ metric_key: key, dim_type: 'all', dim_value: 'all', value: allSum });
    for (const [cohort, sum] of Object.entries(cohortSums)) {
      rows.push({ metric_key: key, dim_type: 'cohort', dim_value: cohort, value: sum });
    }
  }

  return { rows, missing };
}
