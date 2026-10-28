import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import CompanyActions from './CompanyActions';
import { goalsApi } from './goalsApi';

jest.mock('./goalsApi', () => ({ goalsApi: { addCompanyNote: jest.fn(), createWeekGoal: jest.fn(), deleteWeekGoal: jest.fn(), addCompanyContact: jest.fn(), copyBundle: jest.fn(), runCompanyResearch: jest.fn(), checkCompanyApollo: jest.fn(), partnerSignal: jest.fn(), partnerUndo: jest.fn(), updateTarget: jest.fn(), rejectTarget: jest.fn(), promoteTarget: jest.fn(), addToPipeline: jest.fn(), bookMeeting: jest.fn(), markContacted: jest.fn(), updatePartner: jest.fn(), updateWeekGoal: jest.fn() } }));
jest.mock('../pipelineApi', () => ({ updateOpportunity: jest.fn() }));
jest.mock('../huddleApi', () => ({ updateProspect: jest.fn() }));

// company-panel-v3 Stage 2 - the Actions row in four verb groups + the window-scoped shortcuts (invented companies).
const MEMBERS = [{ user_id: 'u1', name: 'Jack Carlson', role: 'owner' }];
const PARTNER = { type: 'partner', id: 'p1', name: 'Zz Harbor', stage: 'replied', category: '2. Brokers & PEOs' };
const TARGET = { type: 'target', id: 't1', name: 'Zz Quarry', stage: 'proposed' };
const VISITOR = { type: 'visitor', id: 'v1', name: 'Zz Visit' };
function Harness({ row, form: initial = null, bandShown = false, onToast = jest.fn() }) {
  const React = require('react');
  const [form, setForm] = React.useState(initial);
  return (
    <aside data-center-window="window" tabIndex={-1} data-testid="win">
      <input aria-label="Some other field" />
      <CompanyActions businessId="b1" row={row} members={MEMBERS} meId="u1" form={form} setForm={setForm} bandShown={bandShown} onPatch={jest.fn()} onChanged={jest.fn()} onToast={onToast} onConvert={jest.fn()} onClose={jest.fn()} />
    </aside>
  );
}
const groups = () => screen.getAllByRole('group').filter(g => g.hasAttribute('data-action-group'));
afterEach(() => jest.clearAllMocks());

test('four labelled groups in order - Capture · Reach · Learn · Advance - with their buttons; Check Apollo once (Learn); kbd hints out of the names', () => {
  render(<Harness row={PARTNER} />);
  expect(groups().map(g => g.getAttribute('aria-label'))).toEqual(['Capture', 'Reach', 'Learn', 'Advance']);
  const names = g => within(screen.getByRole('group', { name: g })).getAllByRole('button').map(b => b.getAttribute('aria-label') || b.textContent.replace(/[NTCER]$/, ''));
  expect(names('Capture')).toEqual(['Note', 'To-do', 'Contact']);
  expect(names('Reach')).toEqual(['Draft email', 'Book meeting', 'Mark contacted']);
  expect(names('Learn')).toEqual(['Research', 'Check Apollo']);
  expect(within(screen.getByRole('group', { name: 'Advance' })).getByRole('button', { name: /^Next:/ })).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Check Apollo' })).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Note' })).toHaveAttribute('aria-keyshortcuts', 'N');
  expect(screen.getByText('✦ generated · updates with stage + signals')).toBeInTheDocument();
});

test('a target advances with Promote ▾ · Not a fit; a visitor with Add to pipeline ▾ and no Book meeting / Mark contacted (no record yet)', () => {
  const { unmount } = render(<Harness row={TARGET} />);
  expect(within(screen.getByRole('group', { name: 'Advance' })).getAllByRole('button').map(b => b.textContent)).toEqual(expect.arrayContaining(['Promote ▾', 'Not a fit']));
  unmount();
  render(<Harness row={VISITOR} />);
  expect(within(screen.getByRole('group', { name: 'Advance' })).getByRole('button', { name: 'Add to pipeline ▾' })).toBeInTheDocument();
  expect(within(screen.getByRole('group', { name: 'Reach' })).queryByRole('button', { name: 'Book meeting' })).toBeNull();
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
  render(<Harness row={PARTNER} bandShown onToast={onToast} />);
  fireEvent.click(screen.getByRole('button', { name: 'Book meeting' }));
  await waitFor(() => expect(goalsApi.bookMeeting).toHaveBeenCalledWith('b1', 'partner', 'p1', {}));
  fireEvent.click(screen.getByRole('button', { name: 'Mark contacted' }));
  await waitFor(() => expect(goalsApi.markContacted).toHaveBeenCalledWith('b1', 'partner', 'p1', { touch_type: 'email' }));
  await onToast.mock.calls[1][0].undo();
  expect(goalsApi.partnerUndo).toHaveBeenCalledWith('b1', 'p1', 'ev1');
});

test('axe: the grouped Actions row has 0 violations', async () => {
  const axe = require('axe-core');
  const { container } = render(<Harness row={PARTNER} />);
  const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false } }, resultTypes: ['violations'] });
  expect(r.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(' | ')}`)).toEqual([]);
});
