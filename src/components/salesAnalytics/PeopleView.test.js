import { render, screen, fireEvent, within } from '@testing-library/react';
import PeopleView from './PeopleView';
import { fetchLive } from './huddleApi';

// FIX actions-row-detail-v1 - a People row's detail: the full text of every cut-off cell + Open company.
// Made-up names only; no emails or phones.
jest.mock('./huddleApi', () => ({ fetchLive: jest.fn(), FLAGS_CHANGED: 'flags' }));

const row = {
  contact_id: 'c1', name: 'Morgan Example', in_pipeline: true, title: 'Senior Director of Total Rewards and Benefits Strategy',
  company: 'Lakeshore Mutual Holdings International', last_activity_kind: 'click', last_activity_at: '2026-10-20T17:05:00Z',
  insight: 'Clicked the pricing link in step 3', sequence: { name: 'Q4 Benefits Leaders Outreach' }, step: 3, heat_7d: 4,
  human_clicks: 1, owner: 'team', status: 'active', status_label: 'Active', closed: false, flag: { owner_name: 'Cyrus Lee' },
  email: 'not-shown@example.invalid',
};

test('People: the Person cell opens the full row under it; Open company opens the window; never an email', async () => {
  fetchLive.mockResolvedValue({ rows: [row] });
  const onOpenCompany = jest.fn();
  render(<PeopleView businessId="b1" myUserId="u1" ownerColor={() => '#888'} ownerLabel={() => 'Team'} canEdit={false} onOpenCompany={onOpenCompany} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Show details for Morgan Example' }));
  const panel = document.querySelector('[data-person-detail]');
  expect(within(panel).getByText('Title').nextSibling).toHaveTextContent('Senior Director of Total Rewards and Benefits Strategy');
  expect(within(panel).getByText('Last activity').nextSibling).toHaveTextContent('Clicked · Clicked the pricing link in step 3 · Tue, Oct 20');
  expect(within(panel).getByText('Sequence').nextSibling).toHaveTextContent('Q4 Benefits Leaders Outreach · step 3');
  expect(within(panel).getByText('Flag').nextSibling).toHaveTextContent('Flagged to Cyrus Lee');
  expect(panel.textContent).not.toMatch(/@/);
  fireEvent.click(within(panel).getByRole('button', { name: 'Open company →' }));
  expect(onOpenCompany).toHaveBeenCalledWith(row);
});

// FIX people-apollo-visibility-v1 F2 - search by last name finds a "First L." row; Members see the full name, Viewers don't.
test('People: last-name search finds the shortened row; full name in the tooltip + detail for Members only', async () => {
  const short = { ...row, contact_id: 'c2', name: 'Avery Quillfeather', in_pipeline: false, company: "Daisy's Gym", flag: null };
  fetchLive.mockResolvedValue({ rows: [row, short] });
  const props = { businessId: 'b1', myUserId: 'u1', ownerColor: () => '#888', ownerLabel: () => 'Team', onOpenCompany: jest.fn() };
  const { unmount } = render(<PeopleView {...props} canEdit />);
  await screen.findByText('Avery Q.');
  fireEvent.change(screen.getByLabelText('Search people'), { target: { value: 'quillfeather' } });
  expect(screen.queryByText('Morgan Example')).toBeNull();
  expect(screen.getByText('Avery Q.')).toHaveAttribute('title', 'Avery Quillfeather');
  fireEvent.click(screen.getByRole('button', { name: /^Show details for/ }));
  expect(within(document.querySelector('[data-person-detail]')).getByText('Person').nextSibling).toHaveTextContent('Avery Quillfeather');
  unmount();
  render(<PeopleView {...props} canEdit={false} />);
  fireEvent.change(await screen.findByLabelText('Search people'), { target: { value: 'quillfeather' } });
  expect(await screen.findByText('Avery Q.')).not.toHaveAttribute('title');
  expect(document.body.innerHTML).not.toMatch(/Quillfeather/);
  fireEvent.click(screen.getByRole('button', { name: 'Show details for Avery Q.' }));
  expect(within(document.querySelector('[data-person-detail]')).getByText('Person').nextSibling).toHaveTextContent('Avery Q.');
});
