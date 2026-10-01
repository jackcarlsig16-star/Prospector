import { C } from '../../../constants/colors';
import { PARTNER_COLOR } from '../palette';
import { perSequenceDelivered } from './perSequenceData';
import DonutChart from './DonutChart';

export default function DirectVsPartnerDonut({ allRows, entities }) {
  const perSeq = perSequenceDelivered(allRows, entities);
  let direct = 0;
  let partner = 0;
  perSeq.forEach(r => {
    if (r.isPartner) partner += r.delivered;
    else direct += r.delivered;
  });
  const slices = [
    { label: 'Direct', value: direct, color: C.blue },
    { label: 'Partner', value: partner, color: PARTNER_COLOR },
  ];
  return <DonutChart slices={slices} centerLabel="Delivered" />;
}
