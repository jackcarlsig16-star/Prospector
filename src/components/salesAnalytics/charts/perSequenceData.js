import { rowsFor, lastValue } from '../computeMetric';

// Joins each sequence's latest-snapshot delivered count with its entity
// data (sender_email, is_partner, cohort) - the one join both the sender
// donut and the Direct-vs-Partner donut need. allRows = GET /metrics,
// entities = GET /entities (already carries is_partner/sender_email,
// joined server-side from sales_sequence_tags).
export function perSequenceDelivered(allRows, entities) {
  return (entities?.sequences || [])
    .map(s => ({
      id: s.id,
      name: s.name,
      cohort: s.cohort,
      senderEmail: s.sender_email,
      isPartner: s.is_partner,
      delivered: lastValue(rowsFor(allRows, 'unique_delivered', 'sequence', s.id)),
    }))
    .filter(r => r.delivered !== null);
}
