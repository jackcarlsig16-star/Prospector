// heat-size-v1 Stage 1 - company size in the lists: an unknown count sorts last in BOTH directions (the kit's sortRows
// over headcountSortValue), prints "unknown" never blank, and names its source.
import { sortRows } from '../ui/DataTable';
import { headcountSortValue, headcountCsv, headcountSourceWord, HEADCOUNT_SOURCE_WORD, HEADCOUNT_SOURCE_GLYPH } from './headcount';

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
