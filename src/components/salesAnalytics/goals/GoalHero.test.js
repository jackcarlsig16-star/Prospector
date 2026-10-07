import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import GoalHero from './GoalHero';
import { goalsApi } from './goalsApi';

// goals-surface-v1 Stage 3: the five goal cards.
jest.mock('./goalsApi', () => ({ goalsApi: { scorecard: jest.fn(), engagement: jest.fn(), targets: jest.fn(), saveTarget: jest.fn() } }));

const m = (value, goal = null) => ({ value, goal });
const week = (w, aud, seq, part, meet) => ({ week_start: w, metrics: { outbound_audience: m(aud, 1000), total_in_sequence: m(seq), partners_first_touched: m(part, 5), meetings_set: m(meet) } });
const SEP = { month: '2026-09-01', weeks: [week('2026-09-07', 100, 3000, 1, 1), week('2026-09-14', 200, 3010, 2, 3), week('2026-09-21', 300, 3020, 0, 4), week('2026-09-28', 400, 3050, 3, 2)], month_total: {} };
const OCT = { month: '2026-10-01', weeks: [week('2026-10-05', 500, 3093, 4, null)], month_total: { outbound_audience: { value: 500, goal: null } } };

beforeEach(() => {
  localStorage.clear();
  goalsApi.scorecard.mockImplementation((id, month) => Promise.resolve(month === '2026-10-01' ? OCT : SEP));
  goalsApi.engagement.mockResolvedValue(['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05'].map((w, i) => ({ week_start: w, real_clicks: i, replies: 1 })));
  goalsApi.targets.mockResolvedValue([{ metric_key: 'real_replies_clicks', period_start: '2026-10-05', goal: '10' }]);
  goalsApi.saveTarget.mockResolvedValue({});
});

const props = extra => ({ businessId: 'b1', weekStart: '2026-10-05', owner: 'team', commitments: [{ metric_key: 'outbound_audience', target_value: 5500000 }], missingHeadcount: 82, canEdit: true, reloadKey: 0, onDrill: jest.fn(), onGoalSaved: jest.fn(), ...extra });

test('five cards with actual, goal, %, week-on-week; numbers come from the scorecard and engagement', async () => {
  render(<GoalHero {...props()} />);
  const card = name => within(screen.getByRole('region', { name }));
  await screen.findByRole('region', { name: 'Audience reached' });
  expect(card('Audience reached').getByText('500')).toBeTruthy();
  expect(card('Audience reached').getByText('of 5.50M commitment')).toBeTruthy();
  expect(card('Audience reached').getByRole('button', { name: '82 missing headcount → fill' })).toBeTruthy();
  expect(card('People in sequence').getByText('3,093')).toBeTruthy();
  expect(card('People in sequence').getByTitle('Change vs last week').textContent).toBe('▲ 43 vs last week');
  expect(card('Partners first-touched').getByText(/^of 5 ·/)).toBeTruthy();
  expect(card('Partners first-touched').getByRole('img', { name: 'Partners first-touched to goal: Reached 800, Left 200' })).toBeTruthy();
  expect(card('Real replies + clicks').getByText('6')).toBeTruthy();
  expect(card('Real replies + clicks').getByText(/^of 10 ·/)).toBeTruthy();
  expect(goalsApi.scorecard).toHaveBeenCalledWith('b1', '2026-09-01', null);
  expect(goalsApi.engagement).toHaveBeenCalledWith('b1', '2026-08-31', '2026-10-05');
});

test('a card with no goal offers Set goal; saving writes the target and reloads', async () => {
  const p = props();
  render(<GoalHero {...p} />);
  const aud = within(await screen.findByRole('region', { name: 'Audience reached' }));
  fireEvent.click(aud.getByRole('button', { name: 'Set goal' }));
  fireEvent.change(aud.getByLabelText('Goal for Audience reached'), { target: { value: '5,000,000' } });
  fireEvent.click(aud.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(goalsApi.saveTarget).toHaveBeenCalledWith('b1', { period: 'month', period_start: '2026-10-01', metric_key: 'outbound_audience', goal: 5000000 }));
  await waitFor(() => expect(p.onGoalSaved).toHaveBeenCalled());
  const meet = within(screen.getByRole('region', { name: 'Meetings set' }));
  fireEvent.click(meet.getByRole('button', { name: 'Set goal' }));
  fireEvent.change(meet.getByLabelText('Goal for Meetings set'), { target: { value: '3' } });
  fireEvent.click(meet.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(goalsApi.saveTarget).toHaveBeenLastCalledWith('b1', { period: 'week', period_start: '2026-10-05', metric_key: 'meetings_set', goal: 3 }));
});

test('viewers see "No goal set", never the button; person filter marks team-only cards', async () => {
  render(<GoalHero {...props({ canEdit: false, owner: 'u-cy' })} />);
  await screen.findByRole('region', { name: 'Audience reached' });
  expect(screen.queryByRole('button', { name: 'Set goal' })).toBeNull();
  expect(screen.getAllByText('No goal set').length).toBeGreaterThan(0);
  expect(within(screen.getByRole('region', { name: 'People in sequence' })).getByText('team')).toBeTruthy();
  expect(within(screen.getByRole('region', { name: 'Partners first-touched' })).queryByText('team')).toBeNull();
  expect(goalsApi.scorecard).toHaveBeenCalledWith('b1', '2026-10-01', 'u-cy');
});

test('clicking a card drills; the hero collapses to one line and remembers it', async () => {
  const p = props();
  render(<GoalHero {...p} />);
  fireEvent.click(within(await screen.findByRole('region', { name: 'Partners first-touched' })).getByTitle('Open Partners (Sent)'));
  expect(p.onDrill).toHaveBeenCalledWith('partners');
  fireEvent.click(screen.getByRole('button', { name: 'Collapse ▴' }));
  expect(screen.queryByRole('region', { name: 'Audience reached' })).toBeNull();
  expect(screen.getByText(/Audience/).textContent).toMatch(/Audience 500/);
  expect(localStorage.getItem('prospector_goals_hero')).toBe('collapsed');
});
