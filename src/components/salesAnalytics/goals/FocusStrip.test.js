import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FocusStrip, { focusLink } from './FocusStrip';
import { goalsApi } from './goalsApi';
import { laWeekStart } from '../periods';

jest.mock('./goalsApi', () => ({ TODOS_CHANGED: 'x', goalsApi: { weekGoals: jest.fn(), weekPlans: jest.fn(), updateWeekGoal: jest.fn() } }));

const JACK = 'u-jack', CY = 'u-cy';
const goal = (id, extra) => ({ id, text: `Commitment ${id}`, kind: 'commitment', status: 'open', owner_user_id: JACK, plan_id: 'pl1', plan_rank: 1, plan_reason: 'why', ...extra });
const plans = [{ id: 'pl1', week_start: laWeekStart(), proposals: [{ rank: 1, link_name: 'Solidcore' }, { rank: 2, link_name: null }] }];

afterEach(() => jest.clearAllMocks());

test('Huddle Focus: only the owner\'s planned commitments, link chip from the plan proposals, check = done', async () => {
  goalsApi.weekGoals.mockResolvedValue([
    goal('a'), goal('b', { plan_rank: 2 }), goal('typed', { plan_id: null }), goal('cy', { owner_user_id: CY }), goal('gone', { status: 'dropped' }),
  ]);
  goalsApi.weekPlans.mockResolvedValue(plans);
  goalsApi.updateWeekGoal.mockImplementation(async (b, id, body) => ({ id, ...body }));
  render(<FocusStrip businessId="b1" ownerId={JACK} ownerName="Jack" canEdit onPlan={jest.fn()} />);
  await screen.findByText('Commitment a');
  expect(screen.getByText('Focus · Jack')).toBeTruthy();
  expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  expect(screen.getByText('→ Solidcore')).toBeTruthy();
  expect(screen.getByText('0 of 2 done')).toBeTruthy();
  fireEvent.click(screen.getAllByRole('checkbox')[0]);
  await waitFor(() => expect(screen.getByText('1 of 2 done')).toBeTruthy());
  expect(goalsApi.updateWeekGoal).toHaveBeenCalledWith('b1', 'a', { status: 'done' });
  // P5: the done item folds into "1 done ▸" (no struck-through row); opening it lists the item, still untickable.
  expect(screen.queryByText('Commitment a')).toBeNull();
  expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  const fold = screen.getByRole('button', { name: '1 done ▸' });
  expect(fold.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(fold);
  expect(screen.getByText('Commitment a').style.textDecoration).not.toBe('line-through');
  expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  expect(screen.getAllByRole('checkbox')[1].checked).toBe(true);
  expect(screen.getByRole('button', { name: '1 done ▾' })).toBeTruthy();
});

test('viewer sees the strip but cannot check', async () => {
  goalsApi.weekGoals.mockResolvedValue([goal('a')]);
  goalsApi.weekPlans.mockResolvedValue(plans);
  render(<FocusStrip businessId="b1" ownerId={JACK} ownerName="Jack" canEdit={false} onPlan={jest.fn()} />);
  expect((await screen.findByRole('checkbox')).disabled).toBe(true);
  expect(screen.queryByRole('button', { name: 'Plan this week' })).toBeNull();
});

test('focusLink matches plan and rank, else none', () => {
  expect(focusLink({ plan_id: 'pl1', plan_rank: 1 }, plans)).toBe('Solidcore');
  expect(focusLink({ plan_id: 'pl1', plan_rank: 2 }, plans)).toBeNull();
  expect(focusLink({ plan_id: 'other', plan_rank: 1 }, plans)).toBeNull();
});
