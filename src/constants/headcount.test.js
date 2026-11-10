// heat-size-v1 Stage 1 - company size in the lists: an unknown count sorts last in BOTH directions (the kit's sortRows
// over headcountSortValue), prints "unknown" never blank, and names its source.
import { sortRows } from '../ui/DataTable';
import { headcountSortValue, headcountCsv, headcountSourceWord, headcountText, HEADCOUNT_SOURCE_WORD, HEADCOUNT_SOURCE_GLYPH, SIZE_BUCKETS, sizeBucketOf, sizeCounts, inSizeFilter, toggleSize, sizeLabels, coverageLine } from './headcount';

const rows = [{ n: 'Mid', employees: 800 }, { n: 'None', employees: null }, { n: 'Big', employees: 12000 }, { n: 'Str', employees: '45' }, { n: 'Small', employees: 12 }];
const col = { id: 'size', sortValue: r => headcountSortValue(r.employees) };

test('unknown headcount sorts last ascending and descending; numeric strings count', () => {
  expect(sortRows(rows, col, 'asc').map(r => r.n)).toEqual(['Small', 'Str', 'Mid', 'Big', 'None']);
  expect(sortRows(rows, col, 'desc').map(r => r.n)).toEqual(['Big', 'Mid', 'Str', 'Small', 'None']);
  expect(headcountSortValue(undefined)).toBeNull();
  expect(headcountSortValue('abc')).toBeNull();
});

test('CSV words: a count or "unknown", the source word only beside a count; every source has a word and a glyph', () => {
  expect([headcountCsv(null), headcountCsv(0), headcountCsv(12000), headcountCsv('45')]).toEqual(['unknown', '0', '12000', '45']);
  expect([headcountSourceWord(null, 'apollo'), headcountSourceWord(5000, 'apollo'), headcountSourceWord(7, 'manual'), headcountSourceWord(7, 'research'), headcountSourceWord(7, null)]).toEqual(['', 'Apollo', 'typed', 'researched', '']);
  expect(Object.keys(HEADCOUNT_SOURCE_GLYPH)).toEqual(Object.keys(HEADCOUNT_SOURCE_WORD));
});

test('size buckets: unknown / < 200 / 200–999 / 1,000–4,999 / 5,000+ with the edges; counts over rows; toggle; labels; the coverage line', () => {
  expect([null, undefined, 'x', 0, 199, 200, 999, 1000, 4999, 5000, 120000].map(sizeBucketOf)).toEqual(['unknown', 'unknown', 'unknown', 'lt200', 'lt200', '200_999', '200_999', '1k_4999', '1k_4999', '5k', '5k']);
  expect(sizeCounts(rows, r => r.employees)).toEqual({ unknown: 1, lt200: 2, '200_999': 1, '1k_4999': 0, '5k': 1 });
  expect(inSizeFilter(800, [])).toBe(true);
  expect([inSizeFilter(800, ['200_999']), inSizeFilter(null, ['200_999']), inSizeFilter(null, ['unknown', '5k'])]).toEqual([true, false, true]);
  expect(toggleSize([], '5k')).toEqual(['5k']);
  expect(toggleSize(['5k', 'unknown'], '5k')).toEqual(['unknown']);
  expect(sizeLabels(['5k', 'unknown'])).toBe('5,000+ + Unknown');
  expect(SIZE_BUCKETS.map(([, l]) => l)).toEqual(['Unknown', '< 200', '200–999', '1,000–4,999', '5,000+']);
  expect(coverageLine({ companies: 469, known: 176 })).toBe('headcount known for 176 of 469 companies');
  expect(coverageLine({ companies: 1, known: 1, noCompanyPeople: 1 })).toBe('headcount known for 1 of 1 company · 1 person has no company record');
  expect(coverageLine({ companies: 12, known: 3, noCompanyPeople: 178 })).toBe('headcount known for 3 of 12 companies · 178 people have no company record');
  expect(headcountText(12000)).toBe('12,000');
});
