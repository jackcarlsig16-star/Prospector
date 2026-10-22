import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import TargetsList, { openTargets } from './TargetsList';
import { goalsApi } from '../goals/goalsApi';

jest.mock('../goals/goalsApi', () => ({ goalsApi: { promoteTarget: jest.fn(), rejectTarget: jest.fn(), copyBundle: jest.fn(), partners: jest.fn() } }));

const target = (id, name, extra) => ({ id, name, kind: 'partner', status: 'researching', suggested_category: null, owner_team: null, co_owner_name: null, no_double_touch: false, evidence: null, research_notes: null, promoted_goal_id: null, source: { label: 'Seif weekly', date: '2026-10-12' }, created_at: '2026-10-13T00:00:00Z', ...extra });
const targets = [
  target('t1', 'Fundrise', { suggested_category: '3. Renter Platforms', owner_team: 'upside', co_owner_name: 'Brad', no_double_touch: true, evidence: 'worth approaching', research_notes: 'Person: Ana' }),
  target('t2', 'Deloitte', { kind: 'employer', status: 'proposed' }),
  target('t3', 'Plaid', { status: 'rejected' }),
  target('t4', 'Lockton', { status: 'accepted', promoted_goal_id: 'g9' }),
];

beforeEach(() => { goalsApi.partners.mockResolvedValue([{ category: '4. Brokers' }, { category: '3. Renter Platforms' }, { category: null }]); });
afterEach(() => jest.clearAllMocks());

test('openTargets counts proposed + researching only', () => {
  expect(openTargets(targets).map(t => t.id)).toEqual(['t1', 't2']);
});

test('a Viewer sees the rows and Copy for Claude, but no Promote / Not a fit; promoted + not-a-fit rows hide behind the closed toggle', () => {
  render(<TargetsList businessId="b1" targets={targets} canEdit={false} onChanged={jest.fn()} />);
  expect(screen.getByText('Targets · 2 open')).toBeInTheDocument();
  expect(screen.getByText('Fundrise')).toBeInTheDocument();
  expect(screen.queryByText('Lockton')).not.toBeInTheDocument();
  expect(screen.queryByText('Plaid')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Promote/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Not a fit' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Copy for Claude' })).toHaveLength(2);
  expect(screen.getAllByText(/From Seif weekly · Oct 12/)).toHaveLength(2);
  expect(screen.getByLabelText('Owner: Upside, co-owner Brad - don\'t double-touch')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show closed (promoted · not a fit) · 2' }));
  expect(screen.getByText('Plaid')).toBeInTheDocument();
  expect(screen.getByText('Lockton')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Copy for Claude' })).toHaveLength(4);
  fireEvent.click(screen.getByRole('button', { name: 'Hide closed (promoted · not a fit) · 2' }));
  expect(screen.queryByText('Lockton')).not.toBeInTheDocument();
});

test('only closed targets: the list says so instead of "No targets yet"', () => {
  render(<TargetsList businessId="b1" targets={targets.slice(2)} canEdit={false} onChanged={jest.fn()} />);
  expect(screen.getByText('Targets · 0 open')).toBeInTheDocument();
  expect(screen.getByText('No open targets.')).toBeInTheDocument();
  expect(screen.queryByText(/No targets yet/)).not.toBeInTheDocument();
});

test('Member: Promote → partner opens the confirm panel with the suggested category pre-set and sends the edited fields', async () => {
  goalsApi.promoteTarget.mockResolvedValue({ created: { type: 'partner', id: 'g1', name: 'Fundrise' }, relinked: 1 });
  const onChanged = jest.fn();
  render(<TargetsList businessId="b1" targets={targets} canEdit onChanged={onChanged} />);
  const row = screen.getByText('Fundrise').closest('li');
  expect(within(row).getByRole('button', { name: 'Not a fit' })).toBeInTheDocument();
  // A promoted row is closed; once shown it keeps only Copy.
  fireEvent.click(screen.getByRole('button', { name: /Show closed/ }));
  const done = screen.getByText('Lockton').closest('li');
  expect(within(done).queryByRole('button', { name: /Promote/ })).not.toBeInTheDocument();
  expect(within(done).getByText('Promoted')).toBeInTheDocument();

  fireEvent.click(within(row).getByRole('button', { name: 'Promote → partner' }));
  const panel = screen.getByRole('form', { name: 'Promote Fundrise to partner' });
  expect(within(panel).getByLabelText('Category')).toHaveValue('3. Renter Platforms');
  expect(within(panel).getByLabelText('Owner team')).toHaveValue('upside');
  expect(within(panel).getByLabelText('Co-owner')).toHaveValue('Brad');
  expect(within(panel).getByRole('checkbox')).toBeChecked();
  await waitFor(() => expect(goalsApi.partners).toHaveBeenCalledWith('b1'));
  expect(goalsApi.promoteTarget).not.toHaveBeenCalled();
  fireEvent.change(within(panel).getByLabelText('Category'), { target: { value: '4. Brokers' } });
  fireEvent.click(within(panel).getByRole('button', { name: 'Promote to partner' }));
  await waitFor(() => expect(goalsApi.promoteTarget).toHaveBeenCalledWith('b1', 't1', { to: 'partner', name: 'Fundrise', category: '4. Brokers', owner_team: 'upside', co_owner_name: 'Brad', no_double_touch: true }));
  await screen.findByText(/Fundrise → Partners \(Not started\) · 1 to-do moved/);
  expect(onChanged).toHaveBeenCalled();
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
});

test('Promote → employer sends no category; an "already" reply shows the notice and creates nothing', async () => {
  goalsApi.promoteTarget.mockResolvedValue({ already: { type: 'opportunity', id: 'o1', name: '[solidcore]' } });
  const onOpenRecord = jest.fn(), onChanged = jest.fn();
  render(<TargetsList businessId="b1" targets={targets} canEdit onChanged={onChanged} onOpenRecord={onOpenRecord} />);
  const row = screen.getByText('Deloitte').closest('li');
  fireEvent.click(within(row).getByRole('button', { name: 'Promote → employer' }));
  const panel = screen.getByRole('form', { name: 'Promote Deloitte to employer' });
  expect(within(panel).queryByLabelText('Category')).not.toBeInTheDocument();
  expect(goalsApi.partners).not.toHaveBeenCalled();
  fireEvent.click(within(panel).getByRole('button', { name: 'Promote to employer' }));
  await waitFor(() => expect(goalsApi.promoteTarget).toHaveBeenCalledWith('b1', 't2', { to: 'employer', name: 'Deloitte', owner_team: null, co_owner_name: null, no_double_touch: false }));
  await screen.findByText('Already here: [solidcore] (employer)');
  expect(onChanged).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  expect(onOpenRecord).toHaveBeenCalledWith({ targetId: 't2', type: 'opportunity', id: 'o1', name: '[solidcore]' });
});

test('Not a fit drops via the reject route and Undo sends the dropped to-dos back', async () => {
  goalsApi.rejectTarget.mockResolvedValueOnce({ target: { id: 't1', status: 'rejected' }, dropped: ['w1'] }).mockResolvedValueOnce({ target: { id: 't1', status: 'researching' }, reopened: ['w1'] });
  const onChanged = jest.fn();
  render(<TargetsList businessId="b1" targets={targets} canEdit onChanged={onChanged} />);
  fireEvent.click(within(screen.getByText('Fundrise').closest('li')).getByRole('button', { name: 'Not a fit' }));
  await waitFor(() => expect(goalsApi.rejectTarget).toHaveBeenCalledWith('b1', 't1'));
  await screen.findByText('Not a fit: Fundrise · 1 to-do dropped');
  expect(onChanged).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(goalsApi.rejectTarget).toHaveBeenLastCalledWith('b1', 't1', { undo: true, reopen: ['w1'] }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
});

test('Copy for Claude puts the bundle on the clipboard and says so', async () => {
  goalsApi.copyBundle.mockResolvedValue('# Fundrise — target (partner)\n\n## What I need:\n\n');
  const writeText = jest.fn().mockResolvedValue();
  Object.assign(navigator, { clipboard: { writeText } });
  render(<TargetsList businessId="b1" targets={targets.slice(0, 1)} canEdit={false} onChanged={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy for Claude' }));
  await waitFor(() => expect(goalsApi.copyBundle).toHaveBeenCalledWith('b1', 'target', 't1'));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('## What I need:')));
  await screen.findByText('Copied for Claude ✓');
});

// FIX loop-quickfixes Q8 - a cut-off evidence line opens in place: "more" only when clipped, one at a time, Esc closes.
test('evidence: more opens the whole line in place, one at a time; less / Esc closes; short lines get no toggle', () => {
  const sw = jest.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function () { return this.textContent.length > 40 ? 900 : 100; });
  const cw = jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
  const long = 'renter-investing platforms are worth approaching because their users move every 18 months on average';
  const list = [target('t1', 'Fundrise', { evidence: long }), target('t2', 'Deloitte', { evidence: `${long} - second` }), target('t5', 'Short Co', { evidence: 'small' })];
  const onKeyWindow = jest.fn();
  window.addEventListener('keydown', onKeyWindow);
  render(<TargetsList businessId="b1" targets={list} canEdit={false} onChanged={jest.fn()} />);
  const [m1, m2] = screen.getAllByRole('button', { name: 'more' });
  expect(screen.getAllByRole('button', { name: 'more' })).toHaveLength(2); // not on the short one
  fireEvent.click(m1);
  expect(m1).toHaveAttribute('aria-expanded', 'true');
  expect(document.getElementById(m1.getAttribute('aria-controls'))).toHaveStyle({ whiteSpace: 'normal' });
  fireEvent.click(m2);
  expect(m1).toHaveAttribute('aria-expanded', 'false');
  expect(m2).toHaveAttribute('aria-expanded', 'true');
  fireEvent.keyDown(m2, { key: 'Escape' });
  expect(m2).toHaveAttribute('aria-expanded', 'false');
  expect(m2).toHaveFocus();
  expect(onKeyWindow).not.toHaveBeenCalled(); // the drawer's own Esc (close) doesn't fire while a line was open
  window.removeEventListener('keydown', onKeyWindow);
  sw.mockRestore(); cw.mockRestore();
});
