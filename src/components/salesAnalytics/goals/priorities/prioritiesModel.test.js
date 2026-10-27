import { yValue, yScale, ringSpecs, haloLevel, hollowness, isDimmed, toggleLit, pageOf, filterParams, filtersFromView, activeFilterCount, EMPTY_FILTERS, RING_ORDER } from './prioritiesModel';

// intent-score-v1 S3 - the pure half of the Priorities view.
const row = (over = {}) => ({ key: 'employer-1', name: 'Acme', score: 55, band: 'P2', source_label: 'upside', employees: 5000, days_since_touch: 3, researched: 'fresh', components: { visits: { points: 17 }, people: { points: 6 }, fit: { points: 15 }, research: { points: 10 }, engagement: { points: 0 } }, ...over });

test('yValue / yScale: intent linear 0-100, size log with unknown on the baseline, activity inverted so recent is high', () => {
  expect(yValue(row(), 'intent')).toBe(55);
  expect(yValue(row({ employees: null }), 'size')).toBeNull();
  expect(yValue(row({ days_since_touch: 200 }), 'activity')).toBe(90);
  expect(yValue(row({ days_since_touch: null }), 'activity')).toBeNull();
  const intent = yScale('intent', [row()]);
  expect([intent.to(0), intent.to(50), intent.to(100), intent.to(140)]).toEqual([0, 0.5, 1, 1]);
  const size = yScale('size', [row({ employees: 10000 })]);
  expect(size.to(null)).toBe(0);
  expect(size.to(10000)).toBe(1);
  expect(size.to(100)).toBeCloseTo(0.5, 5);
  expect(size.ticks.map(t => t.label)).toEqual(['10', '100', '1k', '10k']);
  expect(size.format(null)).toBe('unknown');
  const act = yScale('activity', []);
  expect([act.to(0), act.to(45), act.to(90), act.to(null)]).toEqual([1, 0.5, 0, 0]);
  expect(act.format(0)).toBe('today');
});

test('ringSpecs: one ring per component with points, in RING_ORDER, radius growing with points up to the cap', () => {
  const rings = ringSpecs(row().components, { visits: 25, people: 15, fit: 15, research: 10, engagement: 10 }, { base: 5, extra: 14 });
  expect(rings.map(r => r.key)).toEqual(['visits', 'people', 'fit', 'research']);
  expect(RING_ORDER).toEqual(['visits', 'people', 'fit', 'research', 'engagement']);
  const fit = rings.find(r => r.key === 'fit');
  expect(fit.r).toBeCloseTo(5 + 2 + 2 * 1.5 + 14, 5);
  expect(ringSpecs({}, undefined)).toEqual([]);
});

test('halo: bright within 7 days, faint within 30, none after or never; hollow: fresh = solid, decayed, none = hollow', () => {
  expect([haloLevel(row({ days_since_touch: 0 })), haloLevel(row({ days_since_touch: 7 })), haloLevel(row({ days_since_touch: 8 })), haloLevel(row({ days_since_touch: 31 })), haloLevel(row({ days_since_touch: null }))]).toEqual(['bright', 'bright', 'faint', null, null]);
  expect([hollowness(row()), hollowness(row({ researched: 'decayed' })), hollowness(row({ researched: 'none' })), hollowness(row({ researched: undefined }))]).toEqual(['solid', 'decayed', 'hollow', 'hollow']);
});

test('legend: an empty lit set lights everything; a lit set dims the others, toggling adds and removes', () => {
  const lit = toggleLit(new Set(), 'upside');
  expect(isDimmed(row(), new Set())).toBe(false);
  expect(isDimmed(row(), lit)).toBe(false);
  expect(isDimmed(row({ source_label: 'website' }), lit)).toBe(true);
  expect(toggleLit(lit, 'upside').size).toBe(0);
  expect([...toggleLit(lit, 'website')]).toEqual(['upside', 'website']);
});

test('pageOf: 40 per page, clamped page, from/to/total', () => {
  const rows = Array.from({ length: 95 }, (_, i) => ({ key: String(i) }));
  expect(pageOf(rows, 0)).toMatchObject({ page: 0, pages: 3, from: 1, to: 40, total: 95 });
  expect(pageOf(rows, 9)).toMatchObject({ page: 2, from: 81, to: 95 });
  expect(pageOf(rows, 2).rows).toHaveLength(15);
  expect(pageOf([], 0)).toMatchObject({ page: 0, pages: 1, from: 0, to: 0, total: 0 });
});

test('filters <-> query: only the set filters become params; a saved view round-trips; the active count', () => {
  expect(filterParams(EMPTY_FILTERS)).toEqual({ segment: null, owner: null, source: null, band: null, needs_touch: null, min: null, window: null, q: null });
  const f = { ...EMPTY_FILTERS, segment: 'partners', source: ['upside', 'website'], needs_touch: true, min: 40, window: '7', q: 'ac' };
  expect(filterParams(f)).toEqual({ segment: 'partners', owner: null, source: 'upside,website', band: null, needs_touch: '1', min: 40, window: '7', q: 'ac' });
  expect(activeFilterCount(f)).toBe(6);
  expect(filtersFromView({ source: 'upside,website', min: '40', needs_touch: '1', band: 'P1' })).toEqual({ ...EMPTY_FILTERS, source: ['upside', 'website'], min: 40, needs_touch: true, band: 'P1' });
  expect(filtersFromView(null)).toEqual(EMPTY_FILTERS);
});
