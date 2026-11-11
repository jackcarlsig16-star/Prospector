import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import CompanyActions from './CompanyActions';
import { goalsApi } from './goalsApi';

jest.mock('./goalsApi', () => ({ goalsApi: { todoEvents: jest.fn(() => Promise.resolve([])), undoTodoEvent: jest.fn(() => Promise.resolve({})), addCompanyNote: jest.fn(), createWeekGoal: jest.fn(), deleteWeekGoal: jest.fn(), addCompanyContact: jest.fn(), copyBundle: jest.fn(), runCompanyResearch: jest.fn(), checkCompanyApollo: jest.fn(), partnerSignal: jest.fn(), partnerUndo: jest.fn(), updateTarget: jest.fn(), rejectTarget: jest.fn(), promoteTarget: jest.fn(), addToPipeline: jest.fn(), bookMeeting: jest.fn(), markContacted: jest.fn(), updatePartner: jest.fn(), updateWeekGoal: jest.fn() } }));
jest.mock('../pipelineApi', () => ({ updateOpportunity: jest.fn() }));
jest.mock('../huddleApi', () => ({ updateProspect: jest.fn() }));

// company-panel-v3 Stage 2 - the Actions row in four verb groups + the window-scoped shortcuts (invented companies).
const MEMBERS = [{ user_id: 'u1', name: 'Jack Carlson', role: 'owner' }];
const PARTNER = { type: 'partner', id: 'p1', name: 'Zz Harbor', stage: 'replied', category: '2. Brokers & PEOs' };
const TARGET = { type: 'target', id: 't1', name: 'Zz Quarry', stage: 'proposed' };
const VISITOR = { type: 'visitor', id: 'v1', name: 'Zz Visit' };
function Harness({ row, form: initial = null, bandShown = false, fit = null, onToast = jest.fn() }) {
  const React = require('react');
  const [form, setForm] = React.useState(initial);
  return (
    <aside data-center-window="window" tabIndex={-1} data-testid="win">
      <input aria-label="Some other field" />
      <CompanyActions businessId="b1" row={row} members={MEMBERS} meId="u1" form={form} setForm={setForm} bandShown={bandShown} fit={fit} onPatch={jest.fn()} onChanged={jest.fn()} onToast={onToast} onConvert={jest.fn()} onClose={jest.fn()} onOwner={jest.fn()} onAddClient={jest.fn()} />
    </aside>
  );
}
const groups = () => screen.getAllByRole('group').filter(g => g.hasAttribute('data-action-group'));
afterEach(() => jest.clearAllMocks());

// todo-events-v1: CRA resets mock implementations before each test - the to-do event reads resolve empty unless a test says otherwise
beforeEach(() => { goalsApi.todoEvents.mockResolvedValue([]); goalsApi.undoTodoEvent.mockResolvedValue({}); });

test('homelover-flow-v1 F8: four labelled groups in flow order - Reach · Decide · Capture · Learn; Mark contacted only while behind Contacted; Check Apollo once (Learn); kbd hints out of the names', () => {
  const { unmount } = render(<Harness row={PARTNER} />);
  expect(groups().map(g => g.getAttribute('aria-label'))).toEqual(['Reach', 'Decide', 'Capture', 'Learn']);
  const names = g => within(screen.getByRole('group', { name: g })).getAllByRole('button').map(b => b.getAttribute('aria-label') || b.textContent.replace(/[NTCER]$/, ''));
  expect(names('Capture')).toEqual(['Note', 'To-do', 'Contact']);
  expect(names('Reach')).toEqual(['Draft email', 'Log call', 'Book meeting'], 'a Replied partner is past Contacted: no Mark contacted');
  // FIX company-window-subtract-v1 C9: Owner is an editable fact and stage moves are the strip's - neither has a button here.
  expect(names('Decide')).toEqual(['↓ Deprioritize…']);
  expect(names('Learn')).toEqual(['Research', 'Check Apollo']);
  expect(screen.queryByRole('group', { name: 'Advance' })).toBeNull();
  expect(screen.queryByText(/^Owner:/)).toBeNull();
  expect(screen.queryByText(/^Next:/)).toBeNull();
  unmount();
  render(<Harness row={{ ...PARTNER, stage: 'not_started' }} />);
  expect(names('Reach')).toEqual(['Draft email', 'Log call', 'Book meeting', 'Mark contacted']);
  expect(screen.getAllByRole('button', { name: 'Check Apollo' })).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Note' })).toHaveAttribute('aria-keyshortcuts', 'N');
  const row = screen.getByRole('region', { name: 'Actions' }).firstElementChild;
  expect(row.lastElementChild.textContent).toBe('✦ generated');
});

test('a target decides with Add to pipeline ▾ (primary) · Not a fit; a visitor with Add to pipeline ▾ and no Book meeting / Mark contacted (no record yet); an employer past Target gets They replied…; deprioritized = Bring back', () => {
  const { unmount } = render(<Harness row={TARGET} />);
  expect(within(screen.getByRole('group', { name: 'Decide' })).getAllByRole('button').map(b => b.textContent)).toEqual(expect.arrayContaining(['Add to pipeline ▾', 'Not a fit']));
  expect(within(screen.getByRole('group', { name: 'Decide' })).getByRole('button', { name: 'Add to pipeline ▾' })).toHaveClass('ui-btn--primary');
  unmount();
  const r2 = render(<Harness row={VISITOR} />);
  expect(within(screen.getByRole('group', { name: 'Decide' })).getByRole('button', { name: 'Add to pipeline ▾' })).toBeInTheDocument();
  expect(within(screen.getByRole('group', { name: 'Reach' })).queryByRole('button', { name: 'Book meeting' })).toBeNull();
  r2.unmount();
  const r3 = render(<Harness row={{ type: 'employer', id: 'o1', name: 'Zz Elm', stage: 'contacted' }} />);
  expect(within(screen.getByRole('group', { name: 'Reach' })).getByRole('button', { name: '↩ They replied…' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Mark contacted' })).toBeNull();
  r3.unmount();
  render(<Harness row={{ type: 'employer', id: 'o1', name: 'Zz Elm', stage: 'contacted' }} fit={{ level: 'deprioritized', reason: 'too_small' }} />);
  expect(screen.getByRole('button', { name: 'Bring back' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '↓ Deprioritize…' })).toBeNull();
});

test('homelover-flow-v1 F9: a live partner has Partner · Capture · Decide - Add referred client, Log referral, Book check-in, Draft email; Owner ▾ · Pause…; no Mark contacted, no Research group', () => {
  render(<Harness row={{ ...PARTNER, stage: 'live' }} />);
  expect(groups().map(g => g.getAttribute('aria-label'))).toEqual(['Partner', 'Capture', 'Decide']);
  const names = g => within(screen.getByRole('group', { name: g })).getAllByRole('button').map(b => b.textContent.replace(/[NTCER]$/, ''));
  expect(names('Partner')).toEqual(['+ Add referred client', 'Log referral', 'Book check-in', 'Draft email']);
  expect(names('Decide')).toEqual(['Owner: Unassigned ▾', 'Pause…']);
  expect(screen.queryByRole('button', { name: 'Mark contacted' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Log referral' }));
  expect(screen.getByRole('group', { name: 'Log referral' })).toBeInTheDocument();
});

test('shortcuts (D3): N / T / C open the forms, E drafts, R researches - only inside the window, never from a field, an open menu or with a modifier', async () => {
  goalsApi.runCompanyResearch.mockResolvedValue({});
  render(<Harness row={PARTNER} />);
  const win = screen.getByTestId('win');
  fireEvent.keyDown(document.body, { key: 'n' });
  expect(screen.queryByLabelText('Note', { selector: 'textarea' })).toBeNull();
  fireEvent.keyDown(win, { key: 'n' });
  expect(screen.getByLabelText('Note', { selector: 'textarea' })).toBeInTheDocument();
  fireEvent.keyDown(screen.getByLabelText('Note', { selector: 'textarea' }), { key: 't' }); // typing in the note never fires
  expect(screen.queryByLabelText('To-do', { selector: 'input' })).toBeNull();
  fireEvent.keyDown(screen.getByLabelText('Some other field'), { key: 't' });
  expect(screen.queryByLabelText('To-do', { selector: 'input' })).toBeNull();
  fireEvent.keyDown(win, { key: 't', metaKey: true });
  expect(screen.queryByLabelText('To-do', { selector: 'input' })).toBeNull();
  fireEvent.keyDown(win, { key: 'T' });
  expect(screen.getByLabelText('To-do', { selector: 'input' })).toBeInTheDocument();
  fireEvent.keyDown(win, { key: 'c' });
  expect(screen.getByLabelText('Contact name')).toBeInTheDocument();
  const menu = document.createElement('div'); menu.setAttribute('role', 'menu'); win.appendChild(menu);
  fireEvent.keyDown(win, { key: 'r' });
  expect(goalsApi.runCompanyResearch).not.toHaveBeenCalled();
  win.removeChild(menu);
  fireEvent.keyDown(win, { key: 'r' });
  await waitFor(() => expect(goalsApi.runCompanyResearch).toHaveBeenCalledWith('b1', 'partner', 'p1'));
});

test('Reach (D4): Book meeting and Mark contacted are the same writes as the band (no person here), each with Undo', async () => {
  goalsApi.bookMeeting.mockResolvedValue({ next_step: 'Book meeting', todo: { id: 'wg1' }, before: { next_step: null } });
  goalsApi.markContacted.mockResolvedValue({ event: { id: 'ev1' } });
  const onToast = jest.fn();
  render(<Harness row={{ ...PARTNER, stage: 'researching' }} bandShown onToast={onToast} />);
  fireEvent.click(screen.getByRole('button', { name: 'Book meeting' }));
  await waitFor(() => expect(goalsApi.bookMeeting).toHaveBeenCalledWith('b1', 'partner', 'p1', {}));
  fireEvent.click(screen.getByRole('button', { name: 'Mark contacted' }));
  await waitFor(() => expect(goalsApi.markContacted).toHaveBeenCalledWith('b1', 'partner', 'p1', { touch_type: 'email' }));
  await onToast.mock.calls[1][0].undo();
  expect(goalsApi.partnerUndo).toHaveBeenCalledWith('b1', 'p1', 'ev1');
});

test('company-progress-bar-v1 D3: an employer at Target moves to Contacted - the toast says so and Undo puts Target back', async () => {
  const { updateOpportunity } = require('../pipelineApi');
  goalsApi.markContacted.mockResolvedValue({ todo: { id: 'wg2', event_id: 'ev-wg2' }, stage: { before: 'target', after: 'contacted' } });
  const onToast = jest.fn();
  render(<Harness row={{ type: 'employer', id: 'o1', name: 'Zz Acme', stage: 'target' }} onToast={onToast} />);
  fireEvent.click(screen.getByRole('button', { name: 'Mark contacted' }));
  await waitFor(() => expect(onToast).toHaveBeenCalled());
  expect(onToast.mock.calls[0][0].text).toBe('Zz Acme marked contacted · moved to Contacted');
  await onToast.mock.calls[0][0].undo();
  expect(updateOpportunity).toHaveBeenCalledWith('b1', 'o1', { stage: 'target', allow_backward: true });
  // todo-events-v1: the done to-do comes off through its create event (dropped on the server, never deleted)
  expect(goalsApi.undoTodoEvent).toHaveBeenCalledWith('b1', 'ev-wg2');
});

test('axe: the grouped Actions row has 0 violations', async () => {
  const axe = require('axe-core');
  const { container } = render(<Harness row={PARTNER} />);
  const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false } }, resultTypes: ['violations'] });
  expect(r.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(' | ')}`)).toEqual([]);
});
