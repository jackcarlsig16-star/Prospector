import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import GoalHero from './GoalHero';
import { goalsApi } from './goalsApi';

// goals-surface-v1 Stage 3: the five goal cards.
jest.mock('./goalsApi', () => ({ goalsApi: { hero: jest.fn(), saveTarget: jest.fn() } }));

const m = (value, goal = null) => ({ value, goal });
const week = (w, aud, seq, part, meet) => ({ week_start: w, metrics: { outbound_audience: m(aud, 1000), total_in_sequence: m(seq), partners_first_touched: m(part, 5), people_first_touched: m(part == null ? null : part * 3), meetings_set: m(meet) } });
// first-touch-people-v1: the first-touched goal row's unit + this week's people.
const PEOPLE = [{ goal_id: 'g1', id: 'c1', name: 'Lisa Park', partner: 'BenefitHub', first_touch_at: '2026-10-06T19:00:00Z', source: 'logged' }, { goal_id: 'g2', id: 'c2', name: 'Seq Person', partner: 'Domuso', first_touch_at: '2026-10-05T15:00:00Z', source: 'apollo' }];
let firstTouched;
const SEP = { weeks: [week('2026-09-07', 100, 3000, 1, 1), week('2026-09-14', 200, 3010, 2, 3), week('2026-09-21', 300, 3020, 0, 4), week('2026-09-28', 400, 3050, 3, 2)] };
const OCT = { month: '2026-10-01', weeks: [week('2026-10-05', 500, 3093, 4, null)], month_total: { outbound_audience: { value: 500, goal: null } } };

beforeEach(() => {
  localStorage.clear();
  const engagement = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05'].map((w, i) => ({ week_start: w, real_clicks: i, replies: 1 }));
  const targets = [{ metric_key: 'real_replies_clicks', period_start: '2026-10-05', goal: '10' }];
  firstTouched = { unit: 'partners', goal: 5, carried: false, people: PEOPLE };
  goalsApi.hero.mockImplementation((id, week, owner, skipMonth) => Promise.resolve({ scorecard: skipMonth ? null : OCT, earlier: SEP.weeks, engagement, targets, first_touched: firstTouched }));
  goalsApi.saveTarget.mockResolvedValue({});
});

const props = extra => ({ businessId: 'b1', weekStart: '2026-10-05', owner: 'team', commitments: [{ metric_key: 'outbound_audience', target_value: 5500000 }], missingHeadcount: 82, canEdit: true, reloadKey: 0, onDrill: jest.fn(), onGoalSaved: jest.fn(), ...extra });

test('five cards with actual, goal, %, week-on-week; numbers come from the scorecard and engagement', async () => {
  render(<GoalHero {...props()} />);
  const card = name => within(screen.getByRole('region', { name }));
  await screen.findByRole('region', { name: 'Audience reached' });
  expect(card('Audience reached').getByText('500')).toBeTruthy();
  expect(card('Audience reached').getByText('of 5.50M commitment')).toBeTruthy();
  expect(card('Audience reached').getByText('This week: 500')).toBeTruthy();
  expect(card('Audience reached').getByTitle('Change vs last week').textContent).toBe('▲ 100 weekly vs last week');
  expect(card('Audience reached').getByRole('button', { name: '82 missing headcount → fill' })).toBeTruthy();
  expect(card('People in sequence').getByText('3,093')).toBeTruthy();
  expect(card('People in sequence').getByTitle('Change vs last week').textContent).toBe('▲ 43 vs last week');
  expect(card('Partners first-touched').getByText('of 5 partners · 12 people · week 1 · Oct 5')).toBeTruthy();
  expect(card('Partners first-touched').getByRole('img', { name: 'Partners first-touched to goal: Reached 800, Left 200' })).toBeTruthy();
  expect(card('Real replies + clicks').getByText('6')).toBeTruthy();
  expect(card('Real replies + clicks').getByText(/^of 10 ·/)).toBeTruthy();
  expect(goalsApi.hero).toHaveBeenCalledTimes(1);
  expect(goalsApi.hero).toHaveBeenCalledWith('b1', '2026-10-05', null, false);
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
  expect(goalsApi.hero).toHaveBeenCalledWith('b1', '2026-10-05', 'u-cy', false);
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

test("on Goals the hero reuses the tab's scorecard: skips that month and waits for the matching one", async () => {
  const { rerender } = render(<GoalHero {...props({ scorecard: null })} />);
  await waitFor(() => expect(goalsApi.hero).toHaveBeenCalledWith('b1', '2026-10-05', null, true));
  expect(screen.getByText('Loading goals…')).toBeTruthy();
  rerender(<GoalHero {...props({ scorecard: { ...OCT, owner_user_id: 'u-cy' } })} />);
  expect(screen.getByText('Loading goals…')).toBeTruthy();
  rerender(<GoalHero {...props({ scorecard: { ...OCT, owner_user_id: null } })} />);
  expect(within(await screen.findByRole('region', { name: 'Audience reached' })).getByText('This week: 500')).toBeTruthy();
  rerender(<GoalHero {...props({ scorecard: null, scorecardError: new Error('scorecard down') })} />);
  expect(screen.getByText('scorecard down')).toBeTruthy();
});

test('unit people: label, number, ring and sub-line flip; the sparkline goal is the carried one; toggling writes the unit with the goal', async () => {
  firstTouched = { unit: 'people', goal: 100, carried: true, people: PEOPLE };
  const p = props();
  render(<GoalHero {...p} />);
  const card = within(await screen.findByRole('region', { name: 'People first-touched' }));
  expect(screen.queryByRole('region', { name: 'Partners first-touched' })).toBeNull();
  expect(card.getByTitle('Open the people first-touched this week').textContent).toBe('12');
  expect(card.getByText('of 100 people · 4 partners · week 1 · Oct 5 · carried')).toBeTruthy();
  expect(card.getByRole('img', { name: 'People first-touched to goal: Reached 120, Left 880' })).toBeTruthy();
  expect(card.getByRole('img', { name: /^Last 6 weeks/ }).querySelector('line title').textContent).toBe('Goal this week: 100');
  expect(card.queryByRole('button', { name: 'Set goal' })).toBeNull();
  const toggle = within(card.getByRole('group', { name: 'Count for People first-touched' }));
  expect(toggle.getByRole('button', { name: 'People' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(toggle.getByRole('button', { name: 'Partners' }));
  await waitFor(() => expect(goalsApi.saveTarget).toHaveBeenCalledWith('b1', { period: 'week', period_start: '2026-10-05', metric_key: 'partners_first_touched', goal: 100, unit: 'partners' }));
  await waitFor(() => expect(p.onGoalSaved).toHaveBeenCalled());
});

test('clicking the people number lists the week\'s people with partner, date and source; Escape closes', async () => {
  firstTouched = { unit: 'people', goal: null, carried: false, people: PEOPLE };
  render(<GoalHero {...props()} />);
  const card = within(await screen.findByRole('region', { name: 'People first-touched' }));
  expect(card.getByText('4 partners · week 1 · Oct 5')).toBeTruthy();
  fireEvent.click(card.getByTitle('Open the people first-touched this week'));
  const dialog = within(screen.getByRole('dialog', { name: 'People first-touched' }));
  const rows = dialog.getAllByRole('listitem').map(li => li.textContent);
  expect(rows).toEqual(['Lisa ParkBenefitHubOct 6Logged', 'Seq PersonDomusoOct 5Apollo']);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('no goal: Set goal carries the unit toggle (default people) and saves goal + unit; viewers get neither', async () => {
  firstTouched = { unit: 'people', goal: null, carried: false, people: [] };
  const { unmount } = render(<GoalHero {...props()} />);
  const card = within(await screen.findByRole('region', { name: 'People first-touched' }));
  fireEvent.click(card.getByRole('button', { name: 'Set goal' }));
  fireEvent.click(within(card.getByRole('group', { name: 'Count for People first-touched' })).getByRole('button', { name: 'Partners' }));
  fireEvent.change(card.getByLabelText('Goal for People first-touched'), { target: { value: '20' } });
  fireEvent.click(card.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(goalsApi.saveTarget).toHaveBeenCalledWith('b1', { period: 'week', period_start: '2026-10-05', metric_key: 'partners_first_touched', goal: 20, unit: 'partners' }));
  unmount();
  firstTouched = { unit: 'people', goal: 100, carried: false, people: [] };
  render(<GoalHero {...props({ canEdit: false })} />);
  const viewer = within(await screen.findByRole('region', { name: 'People first-touched' }));
  expect(viewer.getByText('of 100 people · 4 partners · week 1 · Oct 5')).toBeTruthy();
  expect(viewer.queryByRole('group')).toBeNull();
  expect(viewer.queryByRole('button', { name: 'Set goal' })).toBeNull();
});
