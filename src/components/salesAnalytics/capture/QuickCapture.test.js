import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import QuickCapture from './QuickCapture';
import { fetchMe } from '../../../utils/authSession';
import { goalsApi } from '../goals/goalsApi';

jest.mock('../../../utils/authSession', () => ({ fetchMe: jest.fn() }));
jest.mock('../goals/goalsApi', () => ({ goalsApi: { members: jest.fn(), createWeekGoal: jest.fn(), pipelineBoard: jest.fn(), addPerson: jest.fn(), people: jest.fn(), createTarget: jest.fn(), createPartner: jest.fn(), partnerDupeCheck: jest.fn() }, OPEN_TASKS: 'prospector:open-tasks', OPEN_PIPELINE_RECORD: 'prospector:open-pipeline-record' }));
jest.mock('../pipelineApi', () => ({ createOpportunity: jest.fn() }));
jest.mock('../tasks/linkTargets', () => ({ ...jest.requireActual('../tasks/linkTargets'), useLinkOptions: () => ({ options: {}, load: jest.fn(), labelFor: () => '' }) }));

const ME = { profile: { id: 'u-jack' }, memberships: [{ business_id: 'b1', role: 'member' }] };
const VIEWER = { profile: { id: 'u-seif' }, memberships: [{ business_id: 'b1', role: 'viewer' }] };
const members = [{ user_id: 'u-jack', name: 'Jack Carlson' }, { user_id: 'u-cyrus', name: 'Cyrus Lee' }];

beforeEach(() => {
  fetchMe.mockResolvedValue(ME);
  goalsApi.members.mockResolvedValue(members);
  goalsApi.createWeekGoal.mockResolvedValue({ id: 'g1' });
  global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
});
afterEach(() => jest.clearAllMocks());

const setup = props => render(<QuickCapture businessId="b1" features={{ goals_sales: true }} activeUser={{ name: 'Jack Carlson' }} onSaveNuggets={jest.fn()} compact={false} {...props} />);
const plus = () => screen.findByRole('button', { name: 'Quick capture' });
const dialog = () => screen.queryByRole('dialog', { name: 'Quick capture' });
// one-plus-button-v1: the "+" opens a menu first; Task is the capture panel in Task mode.
const openCapture = async () => { fireEvent.click(await plus()); fireEvent.click(within(screen.getByRole('menu', { name: 'Capture or add' })).getByRole('menuitem', { name: /^Task/ })); };
const pressed = label => screen.getByRole('button', { name: new RegExp(`^${label}`) }).getAttribute('aria-pressed');

test('C opens the panel from the page, but not while typing in a field; Esc closes it', async () => {
  const { container } = render(<><input aria-label="Other field" /><QuickCapture businessId="b1" features={{ goals_sales: true }} activeUser={{ name: 'Jack' }} onSaveNuggets={jest.fn()} /></>);
  await plus();
  const other = screen.getByLabelText('Other field');
  other.focus();
  fireEvent.keyDown(other, { key: 'c' });
  expect(dialog()).toBeNull();
  fireEvent.keyDown(container, { key: 'c' });
  expect(dialog()).toBeTruthy();
  await screen.findByLabelText('New task');
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(dialog()).toBeNull();
  // Meta+C (copy) never opens it.
  fireEvent.keyDown(document.body, { key: 'c', metaKey: true });
  expect(dialog()).toBeNull();
});

test('mode keys switch the mode only while focus is outside a text field', async () => {
  setup();
  await openCapture();
  const input = await screen.findByLabelText('New task');
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(input, { key: 'n' });
  expect(pressed('Task')).toBe('true');
  expect(pressed('Note')).toBe('false');
  fireEvent.keyDown(document.body, { key: 'n' });
  expect(pressed('Note')).toBe('true');
  await screen.findByLabelText('Call notes');
  expect(document.activeElement).toBe(screen.getByLabelText('Call notes'));
  fireEvent.keyDown(document.body, { key: 'i' });
  expect(pressed('Idea')).toBe('true');
  expect(screen.getByText('Saves to Ideas on this browser')).toBeInTheDocument();
  fireEvent.keyDown(document.body, { key: 't' });
  expect(pressed('Task')).toBe('true');
});

test('a Viewer never sees the "+"; neither does a workspace without Sales & Marketing', async () => {
  fetchMe.mockResolvedValue(VIEWER);
  setup();
  await waitFor(() => expect(fetchMe).toHaveBeenCalled());
  await act(() => Promise.resolve());
  expect(screen.queryByRole('button', { name: 'Quick capture' })).toBeNull();
  fireEvent.keyDown(document.body, { key: 'c' });
  expect(dialog()).toBeNull();

  fetchMe.mockClear(); fetchMe.mockResolvedValue(ME);
  setup({ features: { goals_sales: false } });
  await act(() => Promise.resolve());
  expect(fetchMe).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Quick capture' })).toBeNull();
});

test('Task mode saves through QuickAdd as a this-week to-do and says so', async () => {
  setup();
  await openCapture();
  const input = await screen.findByLabelText('New task');
  fireEvent.change(input, { target: { value: 'Send the deck' } });
  fireEvent.submit(input.closest('form'));
  await screen.findByText('Added: Send the deck');
  expect(goalsApi.createWeekGoal).toHaveBeenCalledTimes(1);
  const [id, body] = goalsApi.createWeekGoal.mock.calls[0];
  expect(id).toBe('b1');
  expect(body).toMatchObject({ text: 'Send the deck', kind: 'todo', owner_user_id: 'u-jack', due_date: null, link_type: null, link_id: null });
  expect(body.week_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test('an Idea save appends exactly one item in the Ideas page shape', async () => {
  const onSaveNuggets = jest.fn();
  setup({ onSaveNuggets });
  await openCapture();
  await screen.findByLabelText('New task');
  fireEvent.keyDown(document.body, { key: 'i' });
  fireEvent.change(screen.getByLabelText('Idea'), { target: { value: '  Joint webinar with a broker partner  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save idea ⌘↵' }));
  await screen.findByText('Saved to Ideas on this browser');
  expect(onSaveNuggets).toHaveBeenCalledTimes(1);
  const next = onSaveNuggets.mock.calls[0][0]([{ id: 'ng_old' }]);
  expect(next).toHaveLength(2);
  expect(next[1]).toEqual({ id: 'ng_old' });
  const n = next[0];
  expect(Object.keys(n).sort()).toEqual(['adminNotes', 'anonymous', 'category', 'downvotes', 'id', 'priority', 'realName', 'releaseTag', 'shippedAt', 'status', 'submittedAt', 'submittedBy', 'summary', 'text', 'upvotes', 'workflow'].sort());
  expect(n).toMatchObject({ text: 'Joint webinar with a broker partner', workflow: null, category: 'Feature Request', priority: 'Medium', submittedBy: 'Jack Carlson', realName: 'Jack Carlson', anonymous: false, upvotes: ['Jack Carlson'], downvotes: [], status: 'pending', adminNotes: '', releaseTag: '', shippedAt: null });
  expect(n.id).toMatch(/^ng_\d+$/);
  expect(screen.getByLabelText('Idea').value).toBe('');
});

// one-plus-button-v1 - one "+": Capture (Task · Note · Idea) | Add (Employer · Partner · Target · Person).
test('the header "+" opens one menu with seven items in two groups; Note / Idea open the panel in that mode; Employer opens the employer panel; Person opens the Add person form with no email / phone input and, once added, asks Pipeline to open the record on its People card', async () => {
  goalsApi.pipelineBoard.mockResolvedValue([{ type: 'employer', id: 'o1', name: 'Solidcore' }]);
  goalsApi.addPerson.mockResolvedValue({ person: { id: 'sp1', name: 'Jean Horton' }, company: { type: 'employer', id: 'o1', name: 'Solidcore' } });
  const opened = jest.fn();
  window.addEventListener('prospector:open-pipeline-record', e => opened(e.detail));
  setup();
  fireEvent.click(await plus());
  const menu = screen.getByRole('menu', { name: 'Capture or add' });
  expect(within(menu).getAllByRole('menuitem').map(b => b.textContent.replace(/[TNI]$/, ''))).toEqual(['Task', 'Note', 'Idea', 'Employer', 'Partner', 'Target', 'Person']);
  expect(within(menu).getByRole('group', { name: 'Capture' })).toBeInTheDocument();
  expect(within(menu).getByRole('group', { name: 'Add' })).toBeInTheDocument();
  fireEvent.click(within(menu).getByRole('menuitem', { name: /^Idea/ }));
  expect(dialog()).toBeTruthy();
  expect(screen.getByText('Saves to Ideas on this browser')).toBeInTheDocument();
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(dialog()).toBeNull();
  fireEvent.click(await plus());
  fireEvent.click(within(screen.getByRole('menu', { name: 'Capture or add' })).getByRole('menuitem', { name: 'Employer' }));
  expect(await screen.findByText('Add opportunity')).toBeInTheDocument();
  fireEvent.keyDown(document.body, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByText('Add opportunity')).toBeNull());
  fireEvent.click(await plus());
  fireEvent.click(within(screen.getByRole('menu', { name: 'Capture or add' })).getByRole('menuitem', { name: 'Person' }));
  const form = await waitFor(() => { const f = document.querySelector('[data-add-person]'); if (!f) throw new Error('no form'); return f; });
  expect(form.querySelectorAll('input[type="email"], input[type="tel"]')).toHaveLength(0);
  expect(within(form).queryByLabelText(/email|phone/i)).toBeNull();
  fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Jean Horton' } });
  fireEvent.change(within(form).getByLabelText('Company'), { target: { value: 'solid' } });
  const list = await within(form).findByRole('listbox', { name: 'Company suggestions' });
  fireEvent.click(within(list).getByRole('button', { name: /^Solidcore/ }));
  fireEvent.click(within(form).getByRole('button', { name: 'Add person' }));
  await waitFor(() => expect(goalsApi.addPerson).toHaveBeenCalledWith('b1', { name: 'Jean Horton', company: { type: 'employer', id: 'o1' } }));
  await waitFor(() => expect(opened).toHaveBeenCalledWith({ key: 'employer-o1', section: 'people' }));
  expect(await screen.findByText('Jean Horton added to Solidcore')).toBeInTheDocument();
});
