import { render, screen } from '@testing-library/react';
import { niceTicks, compact, labelStep } from './chartKit';
import BarChart from './BarChart';
import ColumnChart from './ColumnChart';
import LineChart from './LineChart';
import Meter from './Meter';

// sales-ia-v2 Stage 6 - the chart kit's pure helpers and what each piece
// draws (jsdom: no ResizeObserver, so the fallback width).
test('niceTicks: clean steps from 0 past the max; compact figures', () => {
  expect(niceTicks(0)).toEqual([0, 1]);
  expect(niceTicks(1, 4)).toEqual([0, 1]);
  expect(niceTicks(3, 4)).toEqual([0, 1, 2, 3]);
  expect(niceTicks(0.6, 3, false)).toEqual([0, 0.2, 0.4, 0.6]);
  expect(niceTicks(7, 4)).toEqual([0, 2, 4, 6, 8]);
  expect(niceTicks(1200, 4)).toEqual([0, 500, 1000, 1500]);
  expect(niceTicks(23, 3)).toEqual([0, 10, 20, 30]);
  expect(compact(1500)).toBe('1.5K'); expect(compact(2000000)).toBe('2M'); expect(compact(7)).toBe('7'); expect(compact(null)).toBe('—');
  expect(labelStep(30, 600)).toBe(3); expect(labelStep(5, 600)).toBe(1); expect(labelStep(90, 400)).toBe(10);
});

const series2 = [{ id: 'a', label: 'Replies', color: '#199e70' }, { id: 'b', label: 'Meetings', color: '#8FA8FF' }];

test('BarChart: one bar per row with its value at the tip; grouped rows get a legend', () => {
  const { container, rerender } = render(<BarChart label="Pipeline by stage" rows={[{ id: 't', label: 'Target', value: 3 }, { id: 'c', label: 'Contacted', value: 0 }]} />);
  expect(screen.getByRole('img', { name: /Pipeline by stage: Target 3; Contacted 0/ })).toBeTruthy();
  expect(container.querySelectorAll('rect').length).toBe(2);
  expect(container.querySelector('ul.ui-legend')).toBeNull();
  rerender(<BarChart label="Signals" series={series2} rows={[{ id: 's', label: 'Scout', values: { a: 2, b: 1 } }]} />);
  expect(container.querySelectorAll('rect').length).toBe(2);
  expect(screen.getByRole('list', { name: 'Signals legend' }).textContent).toBe('RepliesMeetings');
});

test('ColumnChart: stacked segments skip zero and null (a gap), a hover band per x lists every series', () => {
  const points = [
    { x: 'd1', label: 'Oct 19', values: { a: null, b: null } },
    { x: 'd2', label: 'Oct 20', values: { a: 2, b: 0 } },
    { x: 'd3', label: 'Oct 21', values: { a: 1, b: 3 } },
  ];
  const { container } = render(<ColumnChart label="Visitors by priority" points={points} series={series2} mode="stacked" />);
  expect(container.querySelectorAll('rect:not(.ui-chart__hit)').length).toBe(3);
  expect(container.querySelectorAll('rect.ui-chart__hit').length).toBe(3);
  expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Visitors by priority: Oct 19: no data; Oct 20: Replies 2, Meetings 0; Oct 21: Replies 1, Meetings 3');
});

test('LineChart: a null breaks the line, the last value is labelled, 2 series get a legend', () => {
  const points = [
    { x: 'w1', label: 'Sep 28', values: { a: 4, b: 1 } }, { x: 'w2', label: 'Oct 5', values: { a: null, b: 2 } }, { x: 'w3', label: 'Oct 12', values: { a: 6, b: 2 } },
  ];
  const { container } = render(<LineChart label="Outreach" points={points} series={series2} />);
  const paths = [...container.querySelectorAll('path')].map(p => p.getAttribute('d'));
  expect(paths[0].match(/M/g).length).toBe(2);
  expect(paths[1].match(/M/g).length).toBe(1);
  expect([...container.querySelectorAll('text.ui-chart__value')].map(t => t.textContent)).toEqual(['6', '2']);
  expect(screen.getByRole('list', { name: 'Outreach legend' })).toBeTruthy();
});

test('Meter: value of cap, state by share', () => {
  render(<Meter label="Apollo credits" value={134} cap={500} caption="October" />);
  const m = screen.getByRole('meter', { name: 'Apollo credits' });
  expect(m.getAttribute('aria-valuenow')).toBe('134');
  expect(m.textContent).toContain('of 500 · October');
});
