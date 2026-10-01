import { rowsFor, lastValue } from '../computeMetric';
import { cohortColor, COHORT_COLORS } from '../palette';
import DonutChart from './DonutChart';

// Delivered (all-time) by cohort - same dim_type='cohort' unique_delivered
// rows the old (pre-v2) cohort widget used, just a donut instead of a bar.
export default function DeliveredByCohortDonut({ allRows }) {
  const slices = Object.keys(COHORT_COLORS).map(cohort => ({
    label: cohort,
    value: lastValue(rowsFor(allRows, 'unique_delivered', 'cohort', cohort)) || 0,
    color: cohortColor(cohort),
  }));
  return <DonutChart slices={slices} centerLabel="Delivered" />;
}
