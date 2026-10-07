import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CallNotesPanel from './CallNotesPanel';
import { goalsApi } from '../goals/goalsApi';
import { laWeekStart } from '../periods';

jest.mock('../goals/goalsApi', () => ({ goalsApi: { extractCallNotes: jest.fn(), createFromCallNotes: jest.fn(), appendToSection: jest.fn() } }));

const JACK = 'u-jack', CY = 'u-cy';
const members = [{ user_id: JACK }, { user_id: CY }];
const lookup = id => ({ [JACK]: { first: 'Jack', color: '#6F8CF0' }, [CY]: { first: 'Cyrus', color: '#C97626' } }[id] || { first: 'Unassigned', color: '#888' });
const links = { options: {}, load: jest.fn(), labelFor: (t, id) => `${t}: ${id}` };
const proposal = (text, extra) => ({ text, owner_user_id: null, due_date: null, link_type: null, link_id: null, company_name: null, steps: [], evidence: '', similar_to: null, ...extra });

const setup = props => render(<CallNotesPanel businessId="b1" members={members} lookup={lookup} links={links} onClose={jest.fn()} onCreated={jest.fn()} onShowCalls={jest.fn()} {...props} />);
const paste = text => fireEvent.change(screen.getByLabelText('Call notes'), { target: { value: text } });

afterEach(() => jest.clearAllMocks());

test('nothing is written until Create; only ticked, edited proposals are sent', async () => {
  goalsApi.extractCallNotes.mockResolvedValue({
    call_date: '2026-10-07', summary: ['Decided A', 'Decided B', 'Decided C'],
    tasks: [
      proposal('Send BenefitHub deck', { owner_user_id: JACK, steps: ['Draft', 'Send'], link_type: 'partner', link_id: 'p1' }),
      proposal('Call Brad', { owner_user_id: CY, due_date: '2026-10-09' }),
      proposal('Exhibit C on attribution'),
      proposal('Follow up with Christina', { similar_to: { id: 'old', text: 'Follow up with Christina at Norton' } }),
      proposal('Re-review decks'),
    ],
  });
  goalsApi.createFromCallNotes.mockResolvedValue({ goals: [{}, {}, {}], note: { id: 'n1', title: 'Weekly sync' } });
  const onCreated = jest.fn();
  setup({ onCreated });
  fireEvent.change(screen.getByLabelText('Call title'), { target: { value: 'Weekly sync' } });
  paste('Jack will send the BenefitHub deck. Cyrus to call Brad by Friday.');
  fireEvent.click(screen.getByRole('button', { name: 'Find tasks' }));
  await screen.findByText('Decided A');
  expect(goalsApi.extractCallNotes).toHaveBeenCalledWith('b1', expect.objectContaining({ title: 'Weekly sync' }));
  expect(goalsApi.createFromCallNotes).not.toHaveBeenCalled();

  // The one that matches an earlier call starts unticked.
  expect(screen.getByRole('button', { name: 'Create: Follow up with Christina' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByText(/Already a task from an earlier call/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create 4 tasks' })).toBeEnabled();

  fireEvent.click(screen.getByRole('button', { name: 'Create: Re-review decks' }));
  fireEvent.change(screen.getByLabelText('Owner of Exhibit C on attribution'), { target: { value: CY } });
  fireEvent.click(screen.getByRole('button', { name: 'Remove step: Draft' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create 3 tasks' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith(3, { id: 'n1', title: 'Weekly sync' }));

  const body = goalsApi.createFromCallNotes.mock.calls[0][1];
  expect(body.call_date).toBe('2026-10-07');
  expect(body.tasks).toEqual([
    { text: 'Send BenefitHub deck', owner_user_id: JACK, due_date: null, link_type: 'partner', link_id: 'p1', steps: ['Send'] },
    { text: 'Call Brad', owner_user_id: CY, due_date: '2026-10-09', link_type: null, link_id: null, steps: [] },
    { text: 'Exhibit C on attribution', owner_user_id: CY, due_date: null, link_type: null, link_id: null, steps: [] },
  ]);
});

test('notes pasted before: says so, offers the earlier tasks, no Find', async () => {
  goalsApi.extractCallNotes.mockResolvedValue({ duplicate: { id: 'n1', title: 'Weekly sync', call_date: '2026-10-06', task_count: 3 } });
  const onShowCalls = jest.fn();
  setup({ onShowCalls });
  paste('same notes');
  fireEvent.click(screen.getByRole('button', { name: 'Find tasks' }));
  expect(await screen.findByText(/already pasted as “Weekly sync” for the call on Oct 6 - 3 tasks came from them/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Find tasks' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Show tasks from calls' }));
  expect(onShowCalls).toHaveBeenCalled();
  expect(goalsApi.createFromCallNotes).not.toHaveBeenCalled();
});

test('a server error shows and keeps the review', async () => {
  goalsApi.extractCallNotes.mockResolvedValue({ call_date: '2026-10-07', summary: [], tasks: [proposal('Call Brad')] });
  goalsApi.createFromCallNotes.mockRejectedValue(new Error('This week is finalized - reopen it to edit'));
  setup();
  paste('notes');
  fireEvent.click(screen.getByRole('button', { name: 'Find tasks' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Create 1 task' }));
  expect(await screen.findByText('This week is finalized - reopen it to edit')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create 1 task' })).toBeEnabled();
});

test('summary reaches report §1 only on click, as one draft line for this week', async () => {
  goalsApi.extractCallNotes.mockResolvedValue({ call_date: '2026-10-06', summary: ['Decided A.', 'Decided B.', 'Decided C.'], tasks: [proposal('Call Brad')] });
  goalsApi.appendToSection.mockResolvedValue({ section: {} });
  setup();
  fireEvent.change(screen.getByLabelText('Call title'), { target: { value: 'Weekly sync' } });
  paste('notes');
  fireEvent.click(screen.getByRole('button', { name: 'Find tasks' }));
  await screen.findByText('Decided A.');
  expect(goalsApi.appendToSection).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Add to report §1' }));
  expect(await screen.findByText('Added to this week’s report §1 as a draft line')).toBeInTheDocument();
  expect(goalsApi.appendToSection).toHaveBeenCalledTimes(1);
  expect(goalsApi.appendToSection).toHaveBeenCalledWith('b1', laWeekStart(), 's1', 'From call · Oct 6 · Weekly sync: Decided A. Decided B. Decided C.');
  expect(screen.queryByRole('button', { name: 'Add to report §1' })).not.toBeInTheDocument();
  expect(goalsApi.createFromCallNotes).not.toHaveBeenCalled();
});

test('a finalized week says so and the button stays', async () => {
  goalsApi.extractCallNotes.mockResolvedValue({ call_date: '2026-10-07', summary: ['Decided A.'], tasks: [] });
  goalsApi.appendToSection.mockRejectedValue(new Error('This week is finalized - reopen it to edit'));
  setup();
  paste('notes');
  fireEvent.click(screen.getByRole('button', { name: 'Find tasks' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add to report §1' }));
  expect(await screen.findByText('This week is finalized - reopen it to edit')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add to report §1' })).toBeEnabled();
});
