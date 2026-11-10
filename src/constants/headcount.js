// heat-size-v1 - company size as the lists, the CSVs and the chips read it. employees + employees_source live on the
// three record tables (sales_goals / sales_opportunities / sales_targets; company-workflow-v1, headcount-auto-v1):
// 'apollo' = filled from Apollo at 0 credits, 'manual' = typed in the company window, 'research' = a research run.
// Size is NOT a heat input (H3) - it sorts and filters, it never scores.
export const HEADCOUNT_SOURCE_WORD = { apollo: 'Apollo', manual: 'typed', research: 'researched' };
export const HEADCOUNT_SOURCE_GLYPH = { apollo: '◇', manual: '✎', research: '◆' };

// "unknown" is never blank (S1); a known count prints as a plain integer in a CSV.
export const headcountCsv = n => (n == null ? 'unknown' : String(Math.round(Number(n))));
export const headcountSourceWord = (n, source) => (n == null ? '' : HEADCOUNT_SOURCE_WORD[source] || '');
// The DataTable's sortValue: a number, or null so an unknown count stays last in both directions (ui/DataTable sortRows).
export const headcountSortValue = n => (n == null || !Number.isFinite(Number(n)) ? null : Number(n));
