import { normName } from './normName';
import fixture from './normName.fixture.json';

// Ruling K6 / K-4: the 100 real names the migration proved sales_norm_name on. api/sales/dataKeys.test.mjs runs the
// same list through the server's import, so the browser, the server and SQL cannot drift without a red test.
test('normName gives the stored key for each of the 100 names', () => {
  expect(fixture).toHaveLength(100);
  expect(fixture.filter(f => normName(f.name) !== f.norm).map(f => f.name)).toEqual([]);
});

test('accents folded, "&" read as "and", asides and trailing legal suffixes dropped, a leading "the" dropped', () => {
  expect(normName('Piñata')).toBe('pinata');
  expect(normName("L'Oréal")).toBe('l oreal');
  expect(normName('EBG (Entertainment Benefits Group)')).toBe('ebg');
  expect(normName('Gallagher, Inc.')).toBe('gallagher');
  expect(normName('The Peninsula Hotels')).toBe('peninsula hotels');
  expect(normName('Ski & Snowboard Club Vail')).toBe('ski and snowboard club vail');
  expect(normName('Costco')).toBe('costco');
  expect(normName(null)).toBe('');
});
