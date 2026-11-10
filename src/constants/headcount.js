// heat-size-v1 - company size as the lists, the CSVs and the chips read it. employees + employees_source live on the
// three record tables (sales_goals / sales_opportunities / sales_targets; company-workflow-v1, headcount-auto-v1):
// 'apollo' = filled from Apollo at 0 credits, 'manual' = typed in the company window, 'research' = a research run.
// Size is NOT a heat input (H3) - it sorts and filters, it never scores.
export const HEADCOUNT_SOURCE_WORD = { apollo: 'Apollo', manual: 'typed', research: 'researched' };
export const HEADCOUNT_SOURCE_GLYPH = { apollo: '◇', manual: '✎', research: '◆' };

// "unknown" is never blank (S1); a known count prints as a plain integer in a CSV.
export const headcountCsv = n => (n == null ? 'unknown' : String(Math.round(Number(n))));
export const headcountSourceWord = (n, source) => (n == null ? '' : HEADCOUNT_SOURCE_WORD[source] || '');
export const headcountText = n => (n == null ? 'unknown' : Number(n).toLocaleString('en-US'));
// The DataTable's sortValue: a number, or null so an unknown count stays last in both directions (ui/DataTable sortRows).
export const headcountSortValue = n => (n == null || !Number.isFinite(Number(n)) ? null : Number(n));

// S1 size chips (bucket edges PROPOSED, REVISABLE): Unknown is its own chip - a missing count never hides in a bucket.
export const SIZE_BUCKETS = [['unknown', 'Unknown'], ['lt200', '< 200'], ['200_999', '200–999'], ['1k_4999', '1,000–4,999'], ['5k', '5,000+']];
export function sizeBucketOf(n) {
  const v = headcountSortValue(n);
  return v == null ? 'unknown' : v < 200 ? 'lt200' : v < 1000 ? '200_999' : v < 5000 ? '1k_4999' : '5k';
}
export const sizeCounts = (rows, employeesOf) => Object.fromEntries(SIZE_BUCKETS.map(([id]) => [id, rows.filter(r => sizeBucketOf(employeesOf(r)) === id).length]));
export const inSizeFilter = (n, sizes) => !sizes?.length || sizes.includes(sizeBucketOf(n));
// Multi-select: a pressed chip joins the set, pressed again it leaves; an empty set = every size (nothing narrows).
export const toggleSize = (sizes, id) => (sizes.includes(id) ? sizes.filter(s => s !== id) : [...sizes, id]);
export const sizeLabels = sizes => sizes.map(id => SIZE_BUCKETS.find(([x]) => x === id)?.[1] || id).join(' + ');
// R5: the list header's coverage line, observed from the rows; the people part only where people are listed.
export const coverageLine = ({ companies = 0, known = 0, noCompanyPeople = null } = {}) =>
  `headcount known for ${known} of ${companies} ${companies === 1 ? 'company' : 'companies'}${noCompanyPeople != null ? ` · ${noCompanyPeople} ${noCompanyPeople === 1 ? 'person has' : 'people have'} no company record` : ''}`;
