// The people filer's summary, observed counts only: "12 people filed · 4 linked to records · 7 companies left without a
// record (5 no visit row, 2 size unknown)".
const REASON_WORD = { no_visit_row: 'no visit row', size_unknown: 'size unknown', under_500: 'under 500', not_us: 'not US', skip_list: 'skip list' };
export const filedText = c => {
  const reasons = Object.entries(c.reasons || {}).map(([k, n]) => `${n} ${REASON_WORD[k] || k}`).join(', ');
  return `${c.people_added ?? 0} ${c.people_added === 1 ? 'person' : 'people'} filed · ${c.people_linked ?? 0} linked to records · ${c.no_record ?? 0} compan${c.no_record === 1 ? 'y' : 'ies'} left without a record${reasons ? ` (${reasons})` : ''}`;
};
