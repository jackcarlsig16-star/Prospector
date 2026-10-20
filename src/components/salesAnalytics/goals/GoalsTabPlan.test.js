import { render, screen, waitFor } from '@testing-library/react';
import GoalsTab from './GoalsTab';
import { fetchMe } from '../../../utils/authSession';

// Anything not listed stays pending, so only the parts under test render data.
jest.mock('./goalsApi', () => {
  const resolved = {
    members: [{ user_id: 'u-jack', name: 'Jack Carlson' }],
    commitments: [{ id: 'c1', kind: 'commitment', text: 'Book Solidcore', status: 'open', owner_user_id: 'u-jack', plan_id: 'pl1', plan_rank: 1, plan_reason: 'Replied Oct 9' }],
    weekPlans: [],
    partners: [],
  };
  return {
    TODOS_CHANGED: 'todos', OPEN_TASKS: 'tasks',
    goalsApi: new Proxy({}, { get: (_, k) => {
      if (k === 'apolloCsvUrl') return () => '';
      if (k === 'weekGoals') return (id, from, to, kind) => Promise.resolve(kind === 'commitment' ? resolved.commitments : []);
      return () => (k in resolved ? Promise.resolve(resolved[k]) : new Promise(() => {}));
    } }),
  };
});
jest.mock('../../../utils/authSession', () => ({ fetchMe: jest.fn() }));
jest.mock('../../../utils/useMediaQuery', () => () => false);

// sales-ia-v2 N2: the tools (Plan this week, View only, Export) portal into the frame row.
beforeEach(() => { if (!document.getElementById('sales-frame-tools')) { const slot = document.createElement('div'); slot.id = 'sales-frame-tools'; document.body.appendChild(slot); } });
const me = role => ({ profile: { id: 'u-jack' }, memberships: [{ business_id: 'b1', role }] });

beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } });

test('member gets "Plan this week"; planned commitments show ✦ with the reason', async () => {
  fetchMe.mockResolvedValue(me('member'));
  render(<GoalsTab businessId="b1" section="dashboard" view="weekly" onNav={jest.fn()} />);
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Plan this week' }).length).toBeGreaterThan(0));
  expect(screen.getByLabelText('Planned')).toBeTruthy();
  expect(screen.getByTitle('Replied Oct 9').textContent).toMatch(/Book Solidcore/);
});

test('viewer sees ✦ but never the button or the nudge', async () => {
  fetchMe.mockResolvedValue(me('viewer'));
  render(<GoalsTab businessId="b1" section="dashboard" view="weekly" onNav={jest.fn()} />);
  await screen.findByText('View only');
  expect(screen.getByLabelText('Planned')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Plan this week' })).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
});
