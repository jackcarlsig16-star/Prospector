import { render, screen, fireEvent, within } from '@testing-library/react';
import { PartnerSummary, GoalLine, weekTouches } from './OverviewGoals';

// goals-surface-v1 Stage 5: Overview's partner summary.
const p = (id, extra) => ({ id, name: id, pipeline_status: 'not_started', ...extra });
const partners = [
  p('a', { priority: 1 }), p('b', { priority: 1, last_touch_at: '2026-10-01T00:00:00Z' }), p('c', { priority: 1, pipeline_status: 'replied' }),
  p('d', { pipeline_status: 'in_sequence' }), p('e', { pipeline_status: 'first_email_sent' }), p('f', { pipeline_status: 'paused' }), p('g', { pipeline_status: 'live' }),
];

test('touches this week: live moves into contact stages; undone moves and undo rows do not count', () => {
  const events = [
    { id: '1', event: 'status', to_status: 'first_email_sent', goal_id: 'e' },
    { id: '2', event: 'status', to_status: 'replied', goal_id: 'c' },
    { id: '3', event: 'status', to_status: 'meeting_set', goal_id: 'c' },
    { id: '4', event: 'undo', to_status: 'replied', goal_id: 'c', meta: { undid: '3' } },
    { id: '5', event: 'status', to_status: 'researching', goal_id: 'a' },
    { id: '6', event: 'note', goal_id: 'a' },
  ];
  expect(weekTouches(events).map(e => e.id)).toEqual(['1', '2']);
});

test('stage counts sum to every partner; P1 untouched and touches link with the right partner sets', () => {
  const onOpen = jest.fn();
  render(<PartnerSummary partners={partners} touches={[{ goal_id: 'e' }, { goal_id: 'c' }, { goal_id: 'c' }]} onOpen={onOpen} />);
  const region = screen.getByRole('region', { name: 'Partner pipeline' });
  const counts = within(region).getAllByTitle(/^Open partners at /).map(b => Number(b.textContent));
  expect(counts.reduce((a, b) => a + b, 0)).toBe(partners.length);
  fireEvent.click(within(region).getByTitle('Open partners at Sent'));
  expect(onOpen).toHaveBeenLastCalledWith({ partners: { stage: 'first_email_sent' } });
  expect(within(region).getByTitle('Open partners at Sent').textContent).toBe('2');
  const p1 = within(region).getByTitle('Open the P1 partners nobody has contacted yet');
  expect(p1.textContent).toBe('1');
  fireEvent.click(p1);
  expect(onOpen).toHaveBeenLastCalledWith({ partners: { ids: ['a'], label: 'P1 untouched' } });
  fireEvent.click(within(region).getByTitle('Open the partners touched this week'));
  expect(onOpen).toHaveBeenLastCalledWith({ partners: { ids: ['e', 'c'], label: 'Touched this week' } });
  expect(within(region).getByText('on 2 partners')).toBeTruthy();
});

// overview-home-v1 Stage 1: the hero is one line; each number opens Goals filtered to what it counts.
test('goal line: value/goal per item, number alone without a goal, people unit from first_touched', () => {
  const onOpenGoals = jest.fn(), onFocusWidget = jest.fn();
  const hero = {
    earlier: [], first_touched: { unit: 'people', goal: 100, carried: false, people: Array.from({ length: 12 }, (_, i) => ({ name: `P${i}` })) },
    scorecard: { weeks: [{ week_start: '2026-10-05', metrics: { total_in_sequence: { value: 3180, goal: 3500 }, meetings_set: { value: null, goal: 2 }, partners_first_touched: { value: 5, goal: 100 } } }] },
  };
  render(<GoalLine hero={hero} weekStart="2026-10-05" onOpenGoals={onOpenGoals} onFocusWidget={onFocusWidget} />);
  expect(screen.getByText('Week 1 · Oct 5')).toBeTruthy();
  fireEvent.click(screen.getByText('12/100 people first-touched'));
  expect(onOpenGoals).toHaveBeenLastCalledWith({ partners: { stage: 'first_email_sent' } });
  fireEvent.click(screen.getByText('0/2 meetings'));
  expect(onOpenGoals).toHaveBeenLastCalledWith('score:meetings_set');
  fireEvent.click(screen.getByText('3,180/3,500 in sequence'));
  expect(onFocusWidget).toHaveBeenLastCalledWith('week_strip');
  fireEvent.click(screen.getByText('Goals →'));
  expect(onOpenGoals).toHaveBeenLastCalledWith('view:week');
  render(<GoalLine hero={{ ...hero, first_touched: { unit: 'partners', goal: null, people: [] } }} weekStart="2026-10-05" onOpenGoals={onOpenGoals} onFocusWidget={onFocusWidget} />);
  expect(screen.getByText('5 partners first-touched')).toBeTruthy();
});
