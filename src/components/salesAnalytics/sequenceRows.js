import { rowsFor, lastValue, ratio, bounceDenominatorRate } from './computeMetric';
import { HEALTH_THRESHOLDS } from './palette';

// Every unique_* field the sequences adapter keeps (api/sales/adapters/
// sequences.js detects these dynamically from Apollo - this list mirrors
// what's actually been observed live, audit F1).
export const UNIQUE_COUNTER_KEYS = [
  'unique_scheduled', 'unique_delivered', 'unique_opened', 'unique_clicked',
  'unique_replied', 'unique_bounced', 'unique_hard_bounced', 'unique_spam_blocked',
  'unique_unsubscribed',
];

// One full row per sequence, joining entities (name/cohort/active/
// Partner/sender/num_steps/is_performing_poorly/created_at/archived, all
// from GET /entities - Stage 2) with every kept unique_* counter + derived
// rate from allRows (GET /metrics). An id present in one but not the
// other still gets a row - "Unknown (<last 6 chars>)" per the names-fix-v1
// rule, never hidden. Bounce/hard-bounce/spam-block % all share the same
// delivered+bounced denominator (dashboard-v2 design decision, matches
// Apollo's own bounce_rate exactly - audit F8).
export function buildSequenceRows(allRows, entities) {
  const entityById = new Map((entities?.sequences || []).map(s => [s.id, s]));
  const idsFromMetrics = new Set(
    allRows.filter(r => r.dim_type === 'sequence' && r.metric_key.startsWith('unique_')).map(r => r.dim_value)
  );
  const allIds = new Set([...entityById.keys(), ...idsFromMetrics]);

  return [...allIds].map(id => {
    const entity = entityById.get(id);
    const name = entity ? entity.name : `Unknown (${id.slice(-6)})`;
    const cohort = entity ? (entity.cohort || 'Other') : 'Unknown';

    const counters = {};
    const counterRows = {};
    for (const key of UNIQUE_COUNTER_KEYS) {
      const rows = rowsFor(allRows, key, 'sequence', id);
      counterRows[key] = rows;
      counters[key] = lastValue(rows);
    }

    const deliveredRows = counterRows.unique_delivered;
    const bouncedRows = counterRows.unique_bounced;

    return {
      id, name, cohort,
      active: entity ? entity.active : undefined,
      archived: entity ? entity.archived : undefined,
      numSteps: entity ? entity.num_steps : null,
      isPerformingPoorly: entity ? !!entity.is_performing_poorly : false,
      createdAt: entity ? entity.created_at : null,
      isPartner: entity ? !!entity.is_partner : false,
      senderEmail: entity ? entity.sender_email : null,
      counters,
      delivered: counters.unique_delivered,
      openRate: ratio(counterRows.unique_opened, deliveredRows, lastValue),
      replyRate: ratio(counterRows.unique_replied, deliveredRows, lastValue),
      clickRate: ratio(counterRows.unique_clicked, deliveredRows, lastValue),
      unsubscribeRate: ratio(counterRows.unique_unsubscribed, deliveredRows, lastValue),
      bounceRate: bounceDenominatorRate(bouncedRows, deliveredRows, bouncedRows, lastValue),
      hardBounceRate: bounceDenominatorRate(counterRows.unique_hard_bounced, deliveredRows, bouncedRows, lastValue),
      spamBlockRate: bounceDenominatorRate(counterRows.unique_spam_blocked, deliveredRows, bouncedRows, lastValue),
    };
  }).filter(r => r.delivered !== null || r.active !== undefined); // drop pure ghosts (no data, no entity)
}

export function needsAttention(row) {
  if (row.isPerformingPoorly) return true;
  if (row.bounceRate !== null && row.bounceRate >= HEALTH_THRESHOLDS.bounceAmber) return true;
  if (row.openRate !== null && row.openRate < HEALTH_THRESHOLDS.openAmber) return true;
  return false;
}
