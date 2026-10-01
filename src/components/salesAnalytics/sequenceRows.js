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

// sales-analytics-design-v1 - the "active sequences, all-time" totals the
// KPI tiles' Delivered/Reply/Bounce need (same scope the leaderboard's
// default-filtered summary strip shows - audit-confirmed 871/13.0%/0.5%/
// 14.9%). A fresh small helper rather than retrofitting the leaderboard's
// own summary calc: that one is reactive to several independent user
// filters (cohort/partner/sender/search/health), this one is a single
// fixed query, so unifying them would mean threading unrelated filter
// state through for no real reuse. `delivered: null` (vs 0) means no
// active sequence has any delivered data at all for the rows given -
// callers can tell "genuinely zero" apart from "nothing synced yet".
export function activeSequenceTotals(allRows, entities) {
  const rows = buildSequenceRows(allRows, entities).filter(r => r.active !== false);
  const totals = rows.reduce((acc, r) => {
    acc.count += 1;
    if (r.delivered !== null) { acc.delivered += r.delivered; acc.hasDelivered = true; }
    acc.opened += r.counters.unique_opened || 0;
    acc.replied += r.counters.unique_replied || 0;
    acc.bounced += r.counters.unique_bounced || 0;
    return acc;
  }, { count: 0, delivered: 0, opened: 0, replied: 0, bounced: 0, hasDelivered: false });
  return {
    count: totals.count,
    delivered: totals.hasDelivered ? totals.delivered : null,
    openRate: totals.hasDelivered && totals.delivered > 0 ? totals.opened / totals.delivered : null,
    replyRate: totals.hasDelivered && totals.delivered > 0 ? totals.replied / totals.delivered : null,
    bounceRate: totals.hasDelivered && (totals.delivered + totals.bounced) > 0 ? totals.bounced / (totals.delivered + totals.bounced) : null,
  };
}

export function needsAttention(row) {
  if (row.isPerformingPoorly) return true;
  if (row.bounceRate !== null && row.bounceRate >= HEALTH_THRESHOLDS.bounceAmber) return true;
  if (row.openRate !== null && row.openRate < HEALTH_THRESHOLDS.openAmber) return true;
  return false;
}
