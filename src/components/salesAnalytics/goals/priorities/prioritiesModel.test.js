import { yValue, yScale, ringSpecs, haloLevel, hollowness, isDimmed, toggleLit, pageOf, filterParams, filtersFromView, activeFilterCount, labelCandidates, labelText, placeLabels, readPrefs, writePrefs, LS_KEY, HEIGHTS, heightPx, BAND_WORDS, BANDS, TOP_LABELS, EMPTY_FILTERS, RING_ORDER } from './prioritiesModel';

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

// FIX priorities-labels-v1 - the name-label rule and its collision pass.
const ranked = [
  row({ key: 'a', name: 'Hilton', score: 73, band: 'P1', employees: 100 }),
  row({ key: 'b', name: 'Apple', score: 63, band: 'P1', employees: 90000 }),
  row({ key: 'c', name: 'City of Minneapolis', score: 45, band: 'P2', employees: null }),
  row({ key: 'd', name: 'Veritiv', score: 30, band: 'P3', employees: 7000 }),
  ...Array.from({ length: 12 }, (_, i) => row({ key: `p4-${i}`, name: `Small ${i}`, score: 12 - i, band: 'P4', employees: 10 + i, days_since_touch: i })),
];

test('labelCandidates: the selected row first, then P1 / P2, then the top 10 by the current Y; off = selected only; all = everyone; a phone = P1 + selected only', () => {
  const on = labelCandidates(ranked, { mode: 'on', selectedKey: 'p4-5' }).map(r => r.key);
  expect(on[0]).toBe('p4-5');
  expect(on.slice(1, 4)).toEqual(['a', 'b', 'c']);
  expect(on).toEqual(['p4-5', 'a', 'b', 'c', 'd', 'p4-0', 'p4-1', 'p4-2', 'p4-3', 'p4-4']); // top 10 by intent = a..d + 6 P4s; the selected one counted once
  expect(on).toContain('d');
  expect(labelCandidates(ranked, { mode: 'off', selectedKey: 'd' }).map(r => r.key)).toEqual(['d']);
  expect(labelCandidates(ranked, { mode: 'off' })).toEqual([]);
  expect(labelCandidates(ranked, { mode: 'all' })).toHaveLength(ranked.length);
  expect(labelCandidates(ranked, { mode: 'on', phone: true, selectedKey: 'd' }).map(r => r.key)).toEqual(['d', 'a', 'b']);
  const bySize = labelCandidates(ranked, { mode: 'on', y: 'size' }).map(r => r.key);
  expect(bySize.slice(0, 3)).toEqual(['a', 'b', 'c']);
  expect(bySize).toContain('d'); // 7,000 employees is in the top 10 by size
  expect(bySize).not.toContain('p4-0'); // 10 employees is not
});

test('labelText: whole up to 14 characters, then an ellipsis; a bigger budget keeps more', () => {
  expect(labelText('Hilton Example')).toBe('Hilton Example');
  expect(labelText('City of Minneapolis')).toBe('City of Minne…');
  expect(labelText('City of Minneapolis', 24)).toBe('City of Minneapolis');
  expect(labelText('City of Minneapolis', 8)).toBe('City of Minne…');
  expect(labelText(null)).toBe('');
});

test('placeLabels: same spot -> right then left, then shift up, down in 12 px steps, max 3 steps, then drop; obstacles count; right overflow flips left; middle anchor tries centered, right, left', () => {
  const same = Array.from({ length: 16 }, (_, i) => ({ key: `k${i}`, text: 'Acme', x: 100, y: 100, pad: 8 }));
  const placed = placeLabels(same, { maxX: 1000 });
  expect(placed.map(l => l.shifted)).toEqual([0, 0, -12, -12, 12, 12, -24, -24, 24, 24, -36, -36, 36, 36]);
  expect(placed.map(l => l.anchor)).toEqual(['start', 'end', 'start', 'end', 'start', 'end', 'start', 'end', 'start', 'end', 'start', 'end', 'start', 'end']);
  expect(placed.map(l => l.key)).toEqual(Array.from({ length: 14 }, (_, i) => `k${i}`));
  expect(placed[0]).toMatchObject({ x: 108, y: 100, anchor: 'start' });
  expect(placed[1]).toMatchObject({ x: 92, y: 100, anchor: 'end' });
  expect(placeLabels(same, { maxX: 1000 })).toEqual(placed);
  const blocked = placeLabels([{ key: 'z', text: 'Acme', x: 100, y: 100, pad: 8 }], { obstacles: [{ x0: 60, x1: 140, y0: 95, y1: 105 }] });
  expect(blocked[0]).toMatchObject({ shifted: -12, anchor: 'start' });
  expect(placeLabels([{ key: 'z', text: 'Acme', x: 100, y: 100, pad: 8 }], { obstacles: [{ x0: 100, x1: 140, y0: 95, y1: 105 }] })[0]).toMatchObject({ shifted: 0, anchor: 'end' });
  const left = placeLabels([{ key: 'r', text: 'Long company name', x: 980, y: 50, pad: 8 }], { minX: 0, maxX: 1000 });
  expect(left[0]).toMatchObject({ anchor: 'end', x: 972 });
  const mid = placeLabels([{ key: 'm1', text: 'Acme', x: 300, y: 40, pad: 0, anchor: 'middle' }, { key: 'm2', text: 'Acme', x: 320, y: 40, pad: 0, anchor: 'middle' }, { key: 'm3', text: 'Acme', x: 280, y: 40, pad: 0, anchor: 'middle' }, { key: 'm4', text: 'Acme', x: 300, y: 40, pad: 0, anchor: 'middle' }]);
  expect(mid.map(l => [l.x, l.y, l.anchor])).toEqual([[300, 40, 'middle'], [320, 40, 'start'], [280, 40, 'end'], [300, 28, 'middle']]);
  expect(placeLabels([{ key: 'top', text: 'Acme', x: 10, y: 5, pad: 8 }], { minY: 0 })).toHaveLength(1);
  expect(placeLabels([{ key: 'top', text: 'Acme', x: 10, y: 5, pad: 8 }], { minY: 0 })[0].shifted).toBe(12);
});

test('prefs (priorities-v2): one key holds view / y / height / rings / names; defaults standard, rings off, names on; junk falls back per field', () => {
  localStorage.clear();
  expect(readPrefs()).toEqual({ view: null, y: 'intent', height: 'standard', rings: false, names: 'on' });
  writePrefs({ view: 'bars', y: 'size', height: 'tall', rings: true, names: 'all' });
  expect(JSON.parse(localStorage.getItem(LS_KEY))).toEqual({ view: 'bars', y: 'size', height: 'tall', rings: true, names: 'all' });
  expect(readPrefs()).toEqual({ view: 'bars', y: 'size', height: 'tall', rings: true, names: 'all' });
  localStorage.setItem(LS_KEY, JSON.stringify({ view: 'pie', y: 'mood', height: 'huge', rings: 'yes', names: 'everything' }));
  expect(readPrefs()).toEqual({ view: null, y: 'intent', height: 'standard', rings: false, names: 'on' });
  localStorage.setItem(LS_KEY, '{not json');
  expect(readPrefs().height).toBe('standard');
});

test('heights, band words, top labels (priorities-v2)', () => {
  expect(HEIGHTS.map(([id, , px]) => [id, px])).toEqual([['compact', 360], ['standard', 560], ['tall', 800]]);
  expect([heightPx('compact'), heightPx('tall'), heightPx('nope')]).toEqual([360, 800, 560]);
  expect(BANDS.map(b => BAND_WORDS[b])).toEqual(['Act now', 'Warm', 'Watch', 'Backlog']);
  expect(TOP_LABELS).toBe(10);
});
