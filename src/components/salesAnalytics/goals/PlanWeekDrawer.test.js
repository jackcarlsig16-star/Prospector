import { render, screen, fireEvent, within } from '@testing-library/react';
import PlanWeekDrawer from './PlanWeekDrawer';
import { goalsApi } from './goalsApi';

jest.mock('./goalsApi', () => ({ goalsApi: { proposePlan: jest.fn(), savePlan: jest.fn(), weekPlans: jest.fn() } }));

const WEEK = '2026-10-12', JACK = 'u-jack';
const proposal = (rank, text, extra) => ({ rank, text, reason: `because ${rank}`, kind: 'commitment', source: 'prompt', link_type: null, link_id: null, existing_todo_id: null, due_date: null, effort_min: null, link_name: null, existing_text: null, ...extra });
const reply = {
  week_start: WEEK, owner_user_id: JACK, prompt: 'x',
  inputs: { counts: {} },
  inputs_summary: { todos: 9, replies_waiting: 3, partners: 14, flags: 2, last_week_done: 3, last_week_total: 5, trimmed: {} },
  proposals: [
    proposal(1, 'Book Solidcore December call', { link_type: 'partner', link_id: 'p1', link_name: 'Solidcore' }),
    proposal(2, 'Send Upside intros'),
    proposal(3, 'Finish the Norton deck', { existing_todo_id: 't1', existing_text: 'Norton deck' }),
    proposal(4, 'Reply to Brad'),
    proposal(5, '100 cold to gyms'),
    proposal(6, 'Pause Marriott sequence'),
    proposal(7, 'Prep pilot one-pager', { kind: 'todo', due_date: '2026-10-15' }),
  ],
};

const setup = props => render(<PlanWeekDrawer businessId="b1" weekStart={WEEK} ownerId={JACK} ownerName="Jack" onClose={jest.fn()} onSaved={jest.fn()} {...props} />);
const propose = async () => {
  fireEvent.change(screen.getByLabelText('What needs to happen this week?'), { target: { value: 'Upside intros, Solidcore' } });
  fireEvent.click(screen.getByRole('button', { name: 'Propose' }));
  await screen.findByRole('list', { name: 'Proposals' });
};
const box = text => screen.getByRole('checkbox', { name: `Keep ${text}` });

afterEach(() => jest.clearAllMocks());

test('ranks 1-5 come pre-ticked; counts, link chip and "already on your list" show', async () => {
  goalsApi.proposePlan.mockResolvedValue(reply);
  setup();
  await propose();
  expect(goalsApi.proposePlan).toHaveBeenCalledWith('b1', { week_start: WEEK, owner_user_id: JACK, prompt: 'Upside intros, Solidcore' });
  expect(reply.proposals.slice(0, 5).every(p => box(p.text).checked)).toBe(true);
  expect(box('Pause Marriott sequence').checked).toBe(false);
  expect(box('Prep pilot one-pager').checked).toBe(false);
  expect(screen.getByText('5 of 5')).toBeTruthy();
  for (const c of ['9 to-dos', '3 replies waiting', '14 partners', '2 flags', 'last week 3/5']) expect(screen.getByText(c)).toBeTruthy();
  expect(screen.getByText('→ Solidcore')).toBeTruthy();
  expect(screen.getByText('already on your list')).toBeTruthy();
  expect(screen.getByText('due Oct 15')).toBeTruthy();
});

test('a sixth commitment disables Save with the cap message; a to-do does not count', async () => {
  goalsApi.proposePlan.mockResolvedValue(reply);
  setup();
  await propose();
  fireEvent.click(box('Prep pilot one-pager'));
  expect(screen.getByText('5 of 5')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(false);
  fireEvent.click(box('Pause Marriott sequence'));
  expect(screen.getByText('6 of 5')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true);
  expect(screen.getByRole('alert').textContent).toMatch(/At most 5 commitments/);
});

test('replace toggle only when planned commitments exist', async () => {
  goalsApi.proposePlan.mockResolvedValue(reply);
  const { unmount } = setup({ hasPlanned: false });
  await propose();
  expect(screen.queryByLabelText("Replace this week's planned commitments")).toBeNull();
  unmount();
  setup({ hasPlanned: true });
  await propose();
  expect(screen.getByLabelText("Replace this week's planned commitments").checked).toBe(false);
});

test('429 shows the daily limit copy', async () => {
  goalsApi.proposePlan.mockRejectedValue(Object.assign(new Error('Daily plan limit reached - tomorrow'), { status: 429 }));
  setup();
  fireEvent.change(screen.getByLabelText('What needs to happen this week?'), { target: { value: 'x' } });
  fireEvent.click(screen.getByRole('button', { name: 'Propose' }));
  expect(await screen.findByText('Daily plan limit reached — tomorrow')).toBeTruthy();
});

test('save sends ticked rows in the order shown; proposals carry the same ranks', async () => {
  goalsApi.proposePlan.mockResolvedValue(reply);
  goalsApi.savePlan.mockResolvedValue({ plan: { id: 'plan1' } });
  const onSaved = jest.fn();
  setup({ onSaved, hasPlanned: true });
  await propose();
  fireEvent.click(screen.getByRole('button', { name: 'Move Send Upside intros up' }));
  fireEvent.click(screen.getByLabelText("Replace this week's planned commitments"));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await new Promise(r => setTimeout(r, 0));
  const [, body] = goalsApi.savePlan.mock.calls[0];
  expect(body.replace_open_planned).toBe(true);
  expect(body.chosen.map(c => [c.rank, c.text])).toEqual([[1, 'Send Upside intros'], [2, 'Book Solidcore December call'], [3, 'Finish the Norton deck'], [4, 'Reply to Brad'], [5, '100 cold to gyms']]);
  expect(body.chosen[2].existing_todo_id).toBe('t1');
  expect(body.proposals[1]).toMatchObject({ rank: 2, text: 'Book Solidcore December call', link_name: 'Solidcore' });
  expect(body.proposals.some(p => 'ticked' in p)).toBe(false);
  expect(onSaved).toHaveBeenCalled();
});

test('previous plans open read-only and Re-use prompt fills the box', async () => {
  goalsApi.weekPlans.mockResolvedValue([{ id: 'pl1', week_start: '2026-10-05', prompt: 'Last week prompt\nmore', chosen_count: 4, created_at: '2026-10-05T16:00:00Z', proposals: [proposal(1, 'Old item', { link_name: 'Upside' })] }]);
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Previous plans' }));
  fireEvent.click(await screen.findByText('Last week prompt'));
  expect(screen.getByText('→ Upside')).toBeTruthy();
  expect(screen.queryByRole('checkbox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Re-use prompt' }));
  expect(screen.getByLabelText('What needs to happen this week?').value).toBe('Last week prompt\nmore');
  expect(within(screen.getByRole('dialog')).queryByText('Old item')).toBeNull();
});
