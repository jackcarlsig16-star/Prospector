import { C } from '../../../constants/colors';
import { perSequenceDelivered } from './perSequenceData';
import DonutChart from './DonutChart';

// Not a mandated color per the SPEC (only cohort/Partner hues are
// reserved) - distinct from the cohort palette since this is a different
// chart with its own legend, not meant to be cross-referenced against the
// cohort bars.
const SENDER_COLORS = { 'jack@homelover.ai': C.gold, 'cyrus@homelover.ai': C.green };
const UNKNOWN_COLOR = C.dim;

export default function DeliveredBySenderDonut({ allRows, entities }) {
  const perSeq = perSequenceDelivered(allRows, entities);
  const bySender = {};
  perSeq.forEach(r => {
    const key = r.senderEmail || 'Unknown';
    bySender[key] = (bySender[key] || 0) + r.delivered;
  });
  const slices = Object.entries(bySender).map(([label, value]) => ({
    label,
    value,
    color: SENDER_COLORS[label] || UNKNOWN_COLOR,
  }));
  return <DonutChart slices={slices} centerLabel="Delivered" />;
}
