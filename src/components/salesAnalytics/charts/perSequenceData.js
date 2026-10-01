import { rowsFor, lastValue } from '../computeMetric';

// Joins each sequence's latest-snapshot delivered count with its entity
// data (sender_email, audience, cohort) - used by DeliveryMix's By
// cohort/By sender bars. allRows = GET /metrics, entities = GET /entities
// (already carries audience/sender_email, joined server-side from
// sales_sequence_tags).
export function perSequenceDelivered(allRows, entities) {
  return (entities?.sequences || [])
    .map(s => ({
      id: s.id,
      name: s.name,
      cohort: s.cohort,
      senderEmail: s.sender_email,
      audience: s.audience || 'employer',
      delivered: lastValue(rowsFor(allRows, 'unique_delivered', 'sequence', s.id)),
    }))
    .filter(r => r.delivered !== null);
}
