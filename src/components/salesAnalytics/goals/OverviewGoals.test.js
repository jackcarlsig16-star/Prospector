import { render, screen, fireEvent, within } from '@testing-library/react';
import { PartnerSummary, weekTouches } from './OverviewGoals';

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
