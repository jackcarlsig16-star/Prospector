import { render, screen, fireEvent } from '@testing-library/react';
import FitRadar, { radarAxes } from './FitRadar';
import { ringSpecs, RING_ORDER } from './priorities/prioritiesModel';

// company-window-v4 Stage 2 - the Fit radar over the Map's five ring components (invented score rows).
const COMPONENTS = { visits: { points: 9 }, pages: { points: 4 }, people: { points: 6 }, fit: { points: 15 }, research: { points: 10 }, engagement: { points: 0 }, source: { points: 12 }, stage: { points: 2 }, recency: { points: -4 } };
const SCORE = { row: { score: 54, band: 'P2', components: COMPONENTS, computed_at: '2026-11-05T18:00:00Z' }, caps: { visits: 25, pages: 10, apollo_intent: 5, people: 15, fit: 15, research: 10, source: 12, engagement: 10, stage: 10, recency: 10 } };

test('radarAxes: the five RING_ORDER axes with points / cap = the Map\'s ring rule (clamped at 0 and 1); null points without a score', () => {
  const axes = radarAxes(SCORE);
  expect(axes.map(a => a.key)).toEqual(RING_ORDER);
  expect(axes.map(a => `${a.points}/${a.cap}`)).toEqual(['9/25', '6/15', '15/15', '10/10', '0/10']);
  const rings = ringSpecs(COMPONENTS, SCORE.caps);
  for (const a of axes) { const r = rings.find(x => x.key === a.key); expect(a.value).toBeCloseTo(r ? r.points / SCORE.caps[a.key] : 0, 6); }
  expect(radarAxes({ row: { components: { ...COMPONENTS, research: { points: -3 } } }, caps: SCORE.caps }).find(a => a.key === 'research').value).toBe(0);
  expect(radarAxes(null).map(a => [a.points, a.value, a.cap])).toEqual([[null, null, 25], [null, null, 15], [null, null, 15], [null, null, 10], [null, null, 10]]);
});

test('no score: a dashed polygon, "no score yet", every axis "— of cap", Recompute score for a Member only', () => {
  const onRecompute = jest.fn();
  const { unmount } = render(<FitRadar score={null} canEdit onRecompute={onRecompute} />);
  const card = screen.getByRole('region', { name: 'Fit' });
  expect(card.getAttribute('data-section')).toBe('fit');
  expect(screen.getByText('intent components · no score yet')).toBeInTheDocument();
  expect(card.querySelector('[data-fit-radar]').getAttribute('data-fit-radar')).toBe('none');
  expect(card.querySelector('[data-fit-polygon]').getAttribute('stroke-dasharray')).toBe('4 3');
  expect(screen.getByRole('img', { name: 'Fit radar: no score yet' })).toBeInTheDocument();
  expect([...card.querySelectorAll('[data-axis]')].map(el => el.textContent)).toEqual(['Visits — of 25', 'People — of 15', 'Fit — of 15', 'Research — of 10', 'Engagement — of 10']);
  fireEvent.click(screen.getByRole('button', { name: 'Recompute score' }));
  expect(onRecompute).toHaveBeenCalled();
  unmount();
  render(<FitRadar score={null} canEdit={false} />);
  expect(screen.queryByRole('button')).toBeNull();
});

test('scored: a solid polygon with a point per axis, the numbers = the ring points, research ✓, a negative in red, the header carries the score and date', () => {
  render(<FitRadar score={{ ...SCORE, row: { ...SCORE.row, components: { ...COMPONENTS, engagement: { points: 3 }, research: { points: -2 } } } }} canEdit onRecompute={jest.fn()} />);
  const card = screen.getByRole('region', { name: 'Fit' });
  expect(card.querySelector('[data-fit-radar]').getAttribute('data-fit-radar')).toBe('scored');
  expect(card.querySelector('[data-fit-polygon]').getAttribute('stroke-dasharray')).toBeNull();
  expect(card.querySelectorAll('circle')).toHaveLength(5);
  expect(screen.getByText('intent components · score 54 · Nov 5')).toBeInTheDocument();
  expect([...card.querySelectorAll('[data-axis]')].map(el => `${el.dataset.axis}:${el.dataset.points}`)).toEqual(['visits:9', 'people:6', 'fit:15', 'research:-2', 'engagement:3']);
  expect(card.querySelector('[data-axis="research"] b').textContent).toBe('-2');
  expect(card.querySelector('[data-axis="research"] b')).toHaveStyle({ color: 'var(--sa-bad)' });
  expect(screen.getByRole('img', { name: 'Fit radar: Visits 9 of 25, People 6 of 15, Fit 15 of 15, Research -2 of 10, Engagement 3 of 10' })).toBeInTheDocument();
  document.body.innerHTML = '';
  render(<FitRadar score={SCORE} canEdit={false} />);
  expect(screen.getByRole('region', { name: 'Fit' }).querySelector('[data-axis="research"]').textContent).toBe('Research ✓ 10');
});
