import { render } from '@testing-library/react';
import DotsChart from './DotsChart';

// FIX map-fill-space-v1 - the plot spans the width it is given (M1) and the Intent axis fits the data (M2): band zones
// clip to the range, a band with no room keeps its gutter letter + count and shows an edge label, two past one edge stack.
const row = (id, score, band) => ({ type: 'target', id, key: `target-${id}`, name: `Co ${id}`, score, band, source_label: 'website', components: {}, owner_user_id: null, owner_team: 'homelover', researched: 'done', rank: 1 });
const THRESHOLDS = { P1: 75, P2: 50, P3: 25 };
const ROWS = [row('a', 73, 'P2'), row('b', 58, 'P2'), row('c', 42, 'P3')];
const zone = band => document.querySelector(`[data-band-zone="${band}"]`);
const texts = sel => [...document.querySelectorAll(sel)].map(t => t.textContent);

test('M1: the zone rect runs from the 56 px band column to the 36 px tick gutter at two widths; the SVG viewBox is the given width', () => {
  for (const width of [1200, 700]) {
    const { unmount } = render(<DotsChart rows={ROWS} lit={new Set()} thresholds={THRESHOLDS} counts={{ P1: 8, P2: 13, P3: 70, P4: 339 }} width={width} height={560} />);
    expect(document.querySelector('svg').getAttribute('viewBox')).toBe(`0 0 ${width} 560`);
    expect(document.querySelector('svg').getAttribute('width')).toBe('100%');
    const r = zone('P2').querySelector('rect');
    expect(Number(r.getAttribute('x'))).toBe(56);
    expect(Number(r.getAttribute('width'))).toBe(width - 56 - 36);
    unmount();
  }
});

test('M2 fitted: 42-73 -> range 30-85; P4 (0-25) is out below with "Cold ↓ <25" and keeps its count; P1 (75-100) clips to 75-85; only the 75 and 50 guides draw, P4 has no rect', () => {
  render(<DotsChart rows={ROWS} lit={new Set()} thresholds={THRESHOLDS} counts={{ P1: 8, P2: 13, P3: 70, P4: 339 }} width={1000} height={560} yfit />);
  expect(texts('[data-y-tick]')).toEqual(['30', '40', '50', '60', '70', '80', '85']);
  expect(zone('P4').getAttribute('data-band-out')).toBe('bottom');
  expect(zone('P4').querySelector('rect')).toBeNull();
  expect(zone('P4').querySelector('[data-band-edge]').textContent).toBe('Cold ↓ <25');
  expect(zone('P4').querySelector('[data-band-count]').textContent).toBe('339');
  expect(zone('P1').getAttribute('data-band-out')).toBeNull();
  const p1 = zone('P1').querySelector('rect'); const plotH = 560 - 20 - 40;
  expect(Number(p1.getAttribute('y'))).toBe(20);
  expect(Number(p1.getAttribute('height'))).toBeCloseTo(plotH * (10 / 55), 3);
  expect([...document.querySelectorAll('[data-band-guide]')].map(g => g.getAttribute('data-band-guide'))).toEqual(['P1', 'P2']); // the 25 threshold sits under the range
  expect(document.querySelector('svg').getAttribute('aria-label')).toContain('Intent (30-85 of 0-100, fitted to the data)');
});

test('M2 edge stacking: every score under 20 puts P1 and P2 above the range as two stacked "↑" labels; 0-100 draws all four zones and no edge label', () => {
  const low = [row('a', 12, 'P4'), row('b', 9, 'P4')];
  const { unmount } = render(<DotsChart rows={low} lit={new Set()} thresholds={THRESHOLDS} width={1000} height={560} yfit />);
  expect(texts('[data-y-tick]')).toEqual(['0', '5', '10', '15', '20']);
  expect(texts('[data-band-edge]')).toEqual(['Hot ↑ 75+', 'Warm ↑ 50+', 'Cool ↑ 25+']);
  const ys = [...document.querySelectorAll('[data-band-edge]')].map(t => Number(t.getAttribute('y')));
  expect(ys).toEqual([30, 58, 86]);
  unmount();
  render(<DotsChart rows={low} lit={new Set()} thresholds={THRESHOLDS} width={1000} height={560} />);
  expect(texts('[data-y-tick]')).toEqual(['0', '25', '50', '75', '100']);
  expect(document.querySelectorAll('[data-band-zone] rect')).toHaveLength(4);
  expect(document.querySelector('[data-band-edge]')).toBeNull();
});

test('phone: the SVG takes its pixel width from W so the box scrolls instead of shrinking the drawing', () => {
  render(<DotsChart rows={ROWS} lit={new Set()} thresholds={THRESHOLDS} width={720} height={560} phone />);
  expect(document.querySelector('svg').getAttribute('width')).toBe('720');
});
