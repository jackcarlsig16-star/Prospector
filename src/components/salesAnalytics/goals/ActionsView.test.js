import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import ActionsView from './ActionsView';
import { goalsApi } from './goalsApi';
import { completeFlag, reassignFlag } from '../huddleApi';
import { memberLookup } from './goalsUi';
import { actionsView, matchesActionFilters, priorityText, dueText, snoozeTo, readSort, writeSort, readFolded, dueChoices } from './actionsModel';

// sales-ia-v2 Stage 5 + actions-v2 REV2 Stage 2 - Actions. Made-up names only; no emails or phones.
jest.mock('./goalsApi', () => ({
  TODOS_CHANGED: 'todos',
  goalsApi: {
    actions: jest.fn(), acceptSignal: jest.fn(), dismissSignal: jest.fn(), undoSignal: jest.fn(),
    acceptSuggestion: jest.fn(), dismissSuggestion: jest.fn(), snoozeSuggestion: jest.fn(), undoSuggestion: jest.fn(),
    updateWeekGoal: jest.fn(), nudgeWaiting: jest.fn(), deleteWeekGoal: jest.fn(),
    contactAction: jest.fn(), contactDraft: jest.fn(),
    pipelineBoard: jest.fn(() => new Promise(() => {})), companyDetail: jest.fn(() => new Promise(() => {})),
  },
}));
jest.mock('../huddleApi', () => ({ completeFlag: jest.fn(() => Promise.resolve({})), reassignFlag: jest.fn(() => Promise.resolve({})), announceFlagsChanged: jest.fn(), FLAGS_CHANGED: 'flags' }));
jest.mock('../pipelineApi', () => ({ updateOpportunity: jest.fn() }));
jest.mock('../../../utils/useMediaQuery', () => () => false);

const JACK = 'u-jack', CY = 'u-cyrus';
const VIC = 'u-vic';
const members = [{ user_id: JACK, name: 'Jack Carlson', role: 'owner' }, { user_id: CY, name: 'Cyrus Lee', role: 'member' }, { user_id: VIC, name: 'Vic Viewer', role: 'viewer' }];
const lookup = memberLookup(members);
const TODAY = '2026-10-21';
const item = (kind, id, extra) => ({ key: `${kind}-${id}`, kind, id, text: `${kind} ${id}`, why: null, company: null, due_date: null, overdue: false, late_days: 0, owner_user_id: null, priority: 2, status: 'open', created_at: '2026-10-20T10:00:00Z', meta: {}, ...extra });
const items = [
  item('waiting', 'w1', { band: 'now', text: 'Waiting on Pat: the MSA', why: '6 d late', due_date: '2026-10-15', overdue: true, late_days: 6, company: { type: 'partner', id: 'p1', name: 'Northwind Benefits', priority: null } }),
  item('flag', 'f1', { band: 'now', text: 'Follow up the benefits lead', why: 'Flagged by Cyrus · “opened 3x”', priority: 1, owner_user_id: JACK, meta: { contact: 'Benefits lead' } }),
  item('signal', 's1', { band: 'week', text: 'Reach out: Acme Widgets', why: 'P1 Act today: US 500+ with 5+ visits', priority: 1, company: { type: 'visitor', id: 'acme widgets', name: 'Acme Widgets', priority: null }, meta: { source: 'web_visit' } }),
  item('todo', 't1', { band: 'today', text: 'Call back', why: 'Signals', due_date: TODAY, owner_user_id: JACK, company: { type: 'employer', id: 'o1', name: 'Old Mill Union', priority: null } }),
  item('todo', 't2', { band: 'week', text: 'Draft the one-pager', due_date: '2026-10-23', owner_user_id: CY, priority: 3 }),
  item('tidy', 'g1', { band: 'today', text: 'Follow up Lakeshore Mutual', why: 'Replied · no open to-do', priority: 3, company: { type: 'partner', id: 'p2', name: 'Lakeshore Mutual', priority: null }, meta: { kind: 'follow_up', ref_type: 'partner', makes_todo: true } }),
  item('focus', 'c1', { band: 'today', text: 'Book two meetings', why: 'Pipeline is thin', owner_user_id: JACK }),
  item('focus', 'c2', { band: 'today', text: 'Ship the deck', owner_user_id: JACK, status: 'done' }),
  item('signal', 's2', { band: 'week', text: 'Reach out: Hot Co', priority: 2, company: { type: null, id: null, name: 'Hot Co', priority: null }, meta: { source: 'scout' } }),
];
const rows = () => screen.getAllByRole('row').filter(r => r.hasAttribute('data-row')).map(r => r.getAttribute('data-key'));
// CRA's Jest resets mock implementations before every test, so the stubs are set here.
const setup = (props = {}) => {
  goalsApi.actions.mockResolvedValue({ items, today: TODAY, week_start: '2026-10-19' });
  goalsApi.pipelineBoard.mockImplementation(() => new Promise(() => {}));
  goalsApi.companyDetail.mockImplementation(() => new Promise(() => {}));
  completeFlag.mockResolvedValue({});
  return render(<ActionsView businessId="b1" canEdit meId={JACK} owner="team" members={members} lookup={lookup} onOpenFull={jest.fn()} {...props} />);
};
beforeEach(() => { jest.clearAllMocks(); localStorage.clear(); });

const acts = text => within(screen.getByRole('group', { name: `Actions for ${text}` }));
const more = (text, label) => fireEvent.change(screen.getByLabelText(`More for ${text}`), { target: { value: screen.getByLabelText(`More for ${text}`).querySelector(`option[value="${label}"]`) ? label : [...screen.getByLabelText(`More for ${text}`).options].find(o => o.textContent === label).value } });
const undoToast = async () => fireEvent.click(within(await screen.findByRole('status')).getByRole('button', { name: 'Undo' }));
const toastGone = () => waitFor(() => expect(screen.queryByRole('status')).toBeNull());

test('model: Who = that person\'s rows, Team = all, Unassigned = nobody\'s; bands in order; Viewer kinds; folds + due choices', () => {
  const E = { kind: '', q: '', unassigned: false };
  const jack = actionsView(items, E, { owner: JACK });
  expect(jack.open.map(i => i.key)).toEqual(['flag-f1', 'todo-t1', 'focus-c1']);
  expect(jack.done.map(i => i.key)).toEqual(['focus-c2']);
  expect(jack.unassigned).toBe(4);
  expect(actionsView(items, E, { owner: 'team' }).bands.map(b => [b.id, b.rows.length])).toEqual([['now', 2], ['today', 3], ['week', 3], ['housekeeping', 0]]);
  expect(actionsView(items, { ...E, unassigned: true }, { owner: JACK }).open.map(i => i.key)).toEqual(['waiting-w1', 'signal-s1', 'tidy-g1', 'signal-s2']);
  expect(actionsView(items, { ...E, kind: 'signal' }, { owner: 'team' }).open.map(i => i.kind)).toEqual(['signal', 'signal']);
  expect(actionsView(items, { ...E, q: 'lakeshore' }, { owner: 'team' }).open.map(i => i.key)).toEqual(['tidy-g1']);
  const viewer = actionsView(items, E, { owner: 'team', viewer: true });
  expect([...new Set(viewer.open.map(i => i.kind))].sort()).toEqual(['flag', 'focus', 'todo']);
  expect(actionsView([...items, { ...items[0], key: 'later-x', kind: 'later' }], E, { owner: 'team' }).open.map(i => i.key)).not.toContain('later-x');
  expect(matchesActionFilters(items[0], { ...E, q: 'MSA' }, 'team')).toBe(true);
  expect(priorityText(items[0])).toBe('Overdue · 6 d');
  expect([dueText(items[3], TODAY), dueText(items[4], TODAY), dueText(items[5], TODAY)]).toEqual(['Today', 'Oct 23', '—']);
  expect(snoozeTo(TODAY, '7')).toBe('2026-10-28');
  // Wed Oct 21: Friday = Oct 23, next Monday = Oct 26.
  expect(dueChoices(TODAY).map(c => c[2])).toEqual([TODAY, '2026-10-22', '2026-10-23', '2026-10-26', null]);
  expect(dueChoices('2026-10-23')[2][2]).toBe('2026-10-30');
  expect(readFolded()).toEqual(['housekeeping']);
  expect(readSort()).toBeNull();
  writeSort({ id: 'due', dir: 'asc' });
  expect(readSort()).toEqual({ id: 'due', dir: 'asc' });
  writeSort(null);
});

test('Member: band sections with counts (Housekeeping folded, remembered), the frame owner decides the list, Unassigned chip, sort, done fold', async () => {
  const hk = item('tidy', 'h1', { band: 'housekeeping', text: 'Set a date or drop: Read the S-1', meta: { kind: 'set_a_date', makes_todo: false } });
  goalsApi.actions.mockResolvedValue({ items: [...items, hk], today: TODAY, week_start: '2026-10-19' });
  goalsApi.pipelineBoard.mockImplementation(() => new Promise(() => {}));
  goalsApi.companyDetail.mockImplementation(() => new Promise(() => {}));
  const { rerender } = render(<ActionsView businessId="b1" canEdit meId={JACK} owner={JACK} members={members} lookup={lookup} onOpenFull={jest.fn()} />);
  await screen.findByText('Call back');
  expect(rows()).toEqual(['flag-f1', 'todo-t1', 'focus-c1']);
  expect(screen.getByRole('button', { name: /^Now 1/ })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('button', { name: /^Housekeeping 0/ })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('group', { name: 'Who' })).toBeNull();
  // Unassigned (n): what nobody owns, whoever is picked.
  const chip = screen.getByRole('button', { name: /^Unassigned \(5\)/ });
  fireEvent.click(chip);
  expect(chip).toHaveAttribute('aria-pressed', 'true');
  expect(rows()).toEqual(['waiting-w1', 'tidy-g1', 'signal-s1', 'signal-s2']);
  fireEvent.click(screen.getByRole('button', { name: /^Housekeeping 1/ }));
  expect(rows()).toContain('tidy-h1');
  expect(JSON.parse(localStorage.getItem('prospector_actions_folded'))).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: /^Clear/ }));
  rerender(<ActionsView businessId="b1" canEdit meId={JACK} owner="team" members={members} lookup={lookup} onOpenFull={jest.fn()} />);
  expect(rows()).toEqual(['waiting-w1', 'flag-f1', 'todo-t1', 'tidy-g1', 'focus-c1', 'signal-s1', 'todo-t2', 'signal-s2', 'tidy-h1']);
  const table = screen.getByRole('table', { name: 'Actions' });
  const heads = within(table).getAllByRole('columnheader');
  expect(heads.map(h => h.textContent.replace(/ [↕▲▼]$/, ''))).toEqual(['Priority', 'What to do', 'Company', 'Why', 'Kind', 'Due', 'Owner', '']);
  fireEvent.click(within(table).getByRole('button', { name: /^Due/ }));
  expect(JSON.parse(localStorage.getItem('prospector_actions_sort'))).toEqual({ id: 'due', dir: 'asc' });
  expect(screen.getAllByText(/sorted by Due/).length).toBeGreaterThan(0);
  fireEvent.click(within(table).getByRole('button', { name: /^Due/ })); fireEvent.click(within(table).getByRole('button', { name: /^Due/ }));
  const fold = screen.getByRole('button', { name: '1 done ▸' });
  fireEvent.click(fold);
  expect(acts('Ship the deck').getByRole('button', { name: 'Reopen' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'signal' } });
  fireEvent.change(screen.getByLabelText('Search actions'), { target: { value: 'hot' } });
  expect(rows()).toEqual(['signal-s2']);
  fireEvent.click(screen.getByRole('button', { name: /^Clear/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Old Mill Union' }));
  expect(goalsApi.pipelineBoard).toHaveBeenCalledWith('b1', true);
  expect(screen.getByTitle('Hot Co is not in the Pipeline yet')).toBeTruthy();
});

test('A3 slots: every row = Primary · Done/Due · More, same order per kind', async () => {
  const pair = item('tidy', 'g2', { band: 'housekeeping', text: 'Possible duplicate: Lockton / Lockton Inc', meta: { kind: 'duplicate', ref_type: 'pair', makes_todo: false } });
  goalsApi.actions.mockResolvedValue({ items: [...items, pair], today: TODAY, week_start: '2026-10-19' });
  localStorage.setItem('prospector_actions_folded', '[]');
  render(<ActionsView businessId="b1" canEdit meId={JACK} owner="team" members={members} lookup={lookup} onOpenFull={jest.fn()} />);
  await screen.findByText('Call back');
  const shape = text => [...screen.getByRole('group', { name: `Actions for ${text}` }).children].map(el => (el.tagName === 'SELECT' ? `[${el.options[0].textContent}]` : el.tagName === 'BUTTON' ? el.textContent : '·'));
  expect(shape('Reach out: Acme Widgets')).toEqual(['Accept', 'Done', '[More ▾]']);
  expect(shape('Follow up Lakeshore Mutual')).toEqual(['Accept', 'Done', '[More ▾]']);
  expect(shape('Possible duplicate: Lockton / Lockton Inc')).toEqual(['Accept', '·', '[More ▾]']);
  expect(shape('Waiting on Pat: the MSA')).toEqual(['Got it', '[Due ▾]', '[More ▾]']);
  expect(shape('Call back')).toEqual(['Done', '[Due ▾]', '·']);
  expect(shape('Follow up the benefits lead')).toEqual(['Contacted', '·', '·']);
  expect(shape('Book two meetings')).toEqual(['Done', '·', '·']);
  expect([...screen.getByLabelText('More for Follow up Lakeshore Mutual').options].map(o => o.textContent)).toEqual(['More ▾', 'Dismiss for 7 days', 'Snooze 7 days']);
});

test('Accept a signal: the row leaves at once, toast + Undo; Tidy Accept hands the to-do id to its undo', async () => {
  goalsApi.acceptSignal.mockResolvedValue({ todo: { id: 'td', text: 'Reach out: Acme Widgets' }, via: 'new_target' });
  goalsApi.undoSignal.mockResolvedValue({ signal: { status: 'new' } });
  setup();
  await screen.findByText('Reach out: Acme Widgets');
  fireEvent.click(acts('Reach out: Acme Widgets').getByRole('button', { name: 'Accept' }));
  expect(rows()).not.toContain('signal-s1');
  await waitFor(() => expect(goalsApi.acceptSignal).toHaveBeenCalledWith('b1', 's1', { ownerUserId: undefined }));
  expect((await screen.findByRole('status')).textContent).toContain('Accepted · to-do added: Reach out: Acme Widgets');
  await undoToast();
  await waitFor(() => expect(goalsApi.undoSignal).toHaveBeenCalledWith('b1', 's1', undefined));
  await waitFor(() => expect(goalsApi.actions).toHaveBeenCalledTimes(2));
  await toastGone();
  goalsApi.acceptSuggestion.mockResolvedValue({ suggestion: {}, todo: { id: 'td2', text: 'Follow up Lakeshore Mutual' } });
  fireEvent.click(acts('Follow up Lakeshore Mutual').getByRole('button', { name: 'Accept' }));
  await waitFor(() => expect(goalsApi.acceptSuggestion).toHaveBeenCalledWith('b1', 'g1', { ownerUserId: undefined }));
  await undoToast();
  await waitFor(() => expect(goalsApi.undoSuggestion).toHaveBeenCalledWith('b1', 'g1', 'td2', undefined));
});

test('Done on a signal and a Tidy row: Accept with done, Undo hands the touch id back; Dismiss / Snooze from More', async () => {
  goalsApi.acceptSignal.mockResolvedValue({ todo: { id: 'td', text: 'Reach out: Acme Widgets' }, via: 'partner', touch_event_id: 'ev1' });
  goalsApi.undoSignal.mockResolvedValue({ signal: { status: 'new' } });
  goalsApi.acceptSuggestion.mockResolvedValue({ suggestion: {}, todo: { id: 'td2', text: 'Follow up Lakeshore Mutual' }, touch_event_id: 'ev2' });
  goalsApi.undoSuggestion.mockResolvedValue({ suggestion: { status: 'proposed' } });
  goalsApi.dismissSignal.mockResolvedValue({});
  goalsApi.snoozeSuggestion.mockResolvedValue({});
  setup();
  await screen.findByText('Reach out: Acme Widgets');
  const doneBtn = acts('Reach out: Acme Widgets').getByRole('button', { name: 'Done' });
  expect(doneBtn).toHaveAttribute('title', 'Already did it — logs it as done (Undo for 10 s)');
  fireEvent.click(doneBtn);
  await waitFor(() => expect(goalsApi.acceptSignal).toHaveBeenCalledWith('b1', 's1', { done: true }));
  expect((await screen.findByRole('status')).textContent).toContain('Done: Reach out: Acme Widgets');
  await undoToast();
  await waitFor(() => expect(goalsApi.undoSignal).toHaveBeenCalledWith('b1', 's1', 'ev1'));
  await toastGone();
  fireEvent.click(acts('Follow up Lakeshore Mutual').getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(goalsApi.acceptSuggestion).toHaveBeenCalledWith('b1', 'g1', { done: true }));
  await undoToast();
  await waitFor(() => expect(goalsApi.undoSuggestion).toHaveBeenCalledWith('b1', 'g1', 'td2', 'ev2'));
  await toastGone();
  more('Reach out: Hot Co', 'dismiss');
  await waitFor(() => expect(goalsApi.dismissSignal).toHaveBeenCalledWith('b1', 's2'));
  await toastGone().catch(() => {});
});

test('A4 owner select: a to-do is PATCHed (Undo back), a signal is accepted for that person, a flag is reassigned; waiting shows —; Viewers can\'t be picked', async () => {
  goalsApi.updateWeekGoal.mockResolvedValue({});
  goalsApi.acceptSignal.mockResolvedValue({ todo: { id: 'tdc', text: 'Reach out: Acme Widgets' } });
  goalsApi.undoSignal.mockResolvedValue({});
  setup();
  await screen.findByText('Call back');
  const sel = screen.getByLabelText('Owner of Call back');
  expect([...sel.options].map(o => o.textContent)).toEqual(['Unassigned', 'Jack', 'Cyrus']);
  fireEvent.change(sel, { target: { value: CY } });
  await waitFor(() => expect(goalsApi.updateWeekGoal).toHaveBeenCalledWith('b1', 't1', { owner_user_id: CY }));
  expect((await screen.findByRole('status')).textContent).toContain('Call back: owner Cyrus');
  await undoToast();
  await waitFor(() => expect(goalsApi.updateWeekGoal).toHaveBeenCalledWith('b1', 't1', { owner_user_id: JACK }));
  await toastGone();
  fireEvent.change(screen.getByLabelText('Owner of Reach out: Acme Widgets'), { target: { value: CY } });
  await waitFor(() => expect(goalsApi.acceptSignal).toHaveBeenCalledWith('b1', 's1', { ownerUserId: CY }));
  expect(rows()).not.toContain('signal-s1');
  expect((await screen.findByRole('status')).textContent).toContain('Accepted for Cyrus');
  await undoToast();
  await waitFor(() => expect(goalsApi.undoSignal).toHaveBeenCalledWith('b1', 's1', undefined));
  await toastGone();
  fireEvent.change(screen.getByLabelText('Owner of Follow up the benefits lead'), { target: { value: CY } });
  await waitFor(() => expect(reassignFlag).toHaveBeenCalledWith('b1', 'f1', CY));
  await undoToast();
  await waitFor(() => expect(reassignFlag).toHaveBeenCalledWith('b1', 'f1', JACK));
  expect(screen.queryByLabelText('Owner of Waiting on Pat: the MSA')).toBeNull();
  const waitRow = screen.getAllByRole('row').find(r => r.getAttribute('data-key') === 'waiting-w1');
  expect(within(waitRow).getAllByText('—').length).toBeGreaterThan(0);
});

test('A4 due date: Due ▾ moves a to-do / waiting row (Undo back); text edits in the row detail (Enter saves, Esc cancels, Undo)', async () => {
  goalsApi.updateWeekGoal.mockResolvedValue({});
  setup();
  await screen.findByText('Call back');
  fireEvent.change(screen.getByLabelText('Due date for Call back'), { target: { value: 'friday' } });
  await waitFor(() => expect(goalsApi.updateWeekGoal).toHaveBeenCalledWith('b1', 't1', { due_date: '2026-10-23' }));
  expect((await screen.findByRole('status')).textContent).toContain('Due Oct 23: Call back');
  await undoToast();
  await waitFor(() => expect(goalsApi.updateWeekGoal).toHaveBeenCalledWith('b1', 't1', { due_date: TODAY }));
  await toastGone();
  fireEvent.change(screen.getByLabelText('Due date for Waiting on Pat: the MSA'), { target: { value: 'none' } });
  await waitFor(() => expect(goalsApi.updateWeekGoal).toHaveBeenCalledWith('b1', 'w1', { due_date: null }));
  await toastGone().catch(() => {});
  fireEvent.click(screen.getByRole('button', { name: 'Show details for Call back' }));
  fireEvent.click(screen.getByRole('button', { name: 'Change the text: Call back' }));
  const input = screen.getByLabelText('Edit Call back');
  fireEvent.change(input, { target: { value: 'Call back about the pilot' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(goalsApi.updateWeekGoal).not.toHaveBeenCalledWith('b1', 't1', { text: 'Call back about the pilot' });
  fireEvent.click(screen.getByRole('button', { name: 'Change the text: Call back' }));
  fireEvent.change(screen.getByLabelText('Edit Call back'), { target: { value: 'Call back about the pilot' } });
  fireEvent.keyDown(screen.getByLabelText('Edit Call back'), { key: 'Enter' });
  await waitFor(() => expect(goalsApi.updateWeekGoal).toHaveBeenCalledWith('b1', 't1', { text: 'Call back about the pilot' }));
  await undoToast();
  await waitFor(() => expect(goalsApi.updateWeekGoal).toHaveBeenCalledWith('b1', 't1', { text: 'Call back' }));
});

test('to-do Done, waiting Got it / Nudge (More), Focus Done - each with its reverse write on Undo', async () => {
  goalsApi.updateWeekGoal.mockResolvedValue({});
  goalsApi.nudgeWaiting.mockResolvedValue({ id: 'nd', text: 'Nudge Pat re the MSA' });
  setup();
  await screen.findByText('Call back');
  fireEvent.click(acts('Call back').getByRole('button', { name: 'Done' }));
  expect(rows()).not.toContain('todo-t1');
  await waitFor(() => expect(goalsApi.updateWeekGoal).toHaveBeenCalledWith('b1', 't1', { status: 'done' }));
  await undoToast();
  await waitFor(() => expect(goalsApi.updateWeekGoal).toHaveBeenCalledWith('b1', 't1', { status: 'open' }));
  await toastGone();
  more('Waiting on Pat: the MSA', 'nudge');
  await waitFor(() => expect(goalsApi.nudgeWaiting).toHaveBeenCalledWith('b1', 'w1'));
  expect(rows()).toContain('waiting-w1');
  await undoToast();
  await waitFor(() => expect(goalsApi.deleteWeekGoal).toHaveBeenCalledWith('b1', 'nd'));
  await toastGone();
  fireEvent.click(acts('Waiting on Pat: the MSA').getByRole('button', { name: 'Got it' }));
  expect(rows()).not.toContain('waiting-w1');
  await waitFor(() => expect(goalsApi.updateWeekGoal).toHaveBeenCalledWith('b1', 'w1', { status: 'done' }));
  fireEvent.click(acts('Book two meetings').getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(goalsApi.updateWeekGoal).toHaveBeenCalledWith('b1', 'c1', { status: 'done' }));
});

test('Contacted (flag) is the deferred write: the row leaves, the flag closes only when the 10 s window ends; Undo keeps it open', async () => {
  jest.useFakeTimers();
  try {
    setup();
    await screen.findByText('Follow up the benefits lead');
    fireEvent.click(acts('Follow up the benefits lead').getByRole('button', { name: 'Contacted' }));
    expect(rows()).not.toContain('flag-f1');
    expect(completeFlag).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(goalsApi.actions).toHaveBeenCalledTimes(2));
    expect(completeFlag).not.toHaveBeenCalled();
    await screen.findByText('Follow up the benefits lead');
    fireEvent.click(acts('Follow up the benefits lead').getByRole('button', { name: 'Contacted' }));
    act(() => { jest.advanceTimersByTime(10000); });
    await waitFor(() => expect(completeFlag).toHaveBeenCalledWith('b1', 'f1', { keepalive: true }));
  } finally { jest.useRealTimers(); }
});

test('Contacted flushes on page unload and on unmount - never lost', async () => {
  jest.useFakeTimers();
  try {
    const view = setup();
    await screen.findByText('Follow up the benefits lead');
    fireEvent.click(acts('Follow up the benefits lead').getByRole('button', { name: 'Contacted' }));
    expect(completeFlag).not.toHaveBeenCalled();
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(completeFlag).toHaveBeenCalledTimes(1);
    act(() => { jest.advanceTimersByTime(10000); });
    expect(completeFlag).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(completeFlag).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});

test('Viewer: to-dos, Focus 5 and flags only, read-only - no buttons, no selects, no edit', async () => {
  setup({ canEdit: false, meId: 'u-seif' });
  await screen.findByText('Call back');
  expect(rows()).toEqual(['flag-f1', 'todo-t1', 'focus-c1', 'todo-t2']);
  expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
  expect(screen.queryByRole('group', { name: /^Actions for/ })).toBeNull();
  const table = screen.getByRole('table', { name: 'Actions' });
  expect(within(table).getAllByRole('columnheader')).toHaveLength(7);
  const buttons = within(table).getAllByRole('button').filter(b => !['ui-table__sort', 'ui-table__toggle', 'ui-table__disclose'].some(c => b.classList.contains(c)));
  expect(buttons.map(b => b.textContent)).toEqual(['Old Mill Union']);
  expect(within(table).queryByRole('combobox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show details for Call back' }));
  expect(screen.queryByRole('button', { name: /^Change the text/ })).toBeNull();
  expect(screen.getByLabelText('Kind').querySelectorAll('option')).toHaveLength(4);
  expect(screen.queryByRole('button', { name: 'Plan this week' })).toBeNull();
});

// FIX actions-row-detail-v1 - the row detail, one per kind.
test('model: where each kind came from, the company line and the dates, in words', () => {
  const { actionSource, companyLine, datesLine } = require('./actionsModel');
  expect(actionSource(item('signal', 'a', { meta: { source: 'scout', score: 82, who: 'Head of People' } }))).toBe('Signal Scout · score 82 · Head of People');
  expect(actionSource(item('signal', 'b', { meta: { source: 'web_visit' } }))).toBe('Website visit');
  expect(actionSource(item('tidy', 'c', { meta: { rule: 'No touch in 14 days after a site visit' } }))).toBe('Tidy rule: No touch in 14 days after a site visit');
  expect(actionSource(item('todo', 'd', { meta: { from_note: true, note_date: '2026-10-14' } }))).toBe('From call notes Oct 14');
  expect(actionSource(item('todo', 'e', { meta: { category: 'Signals' } }))).toBe('To-do · Signals');
  expect(actionSource(item('waiting', 'f', { due_date: '2026-10-15', late_days: 6, meta: { waiting_on: 'Pat' } }))).toBe('Pat owes it · due Oct 15 · 6 days late');
  expect(actionSource(item('flag', 'g', { meta: { flagged_by_name: 'Cyrus', flag_note: 'opened 3x' } }))).toBe('Flagged by Cyrus · “opened 3x”');
  expect(actionSource(item('focus', 'h', { why: 'Pipeline is thin', meta: { plan_rank: 2 } }))).toBe('Focus 5 #2 · Pipeline is thin');
  expect(companyLine({ type: 'partner', name: 'Lakeshore Mutual', stage_label: 'Replied', priority: 1, owner: 'Jack', last_touch_at: '2026-10-09T15:00:00Z' })).toBe('Lakeshore Mutual · Replied · P1 · Jack · last touch Oct 9');
  expect(companyLine({ type: 'employer', name: 'Old Mill Union', priority: null })).toBe('Old Mill Union · no touch yet');
  expect(companyLine({ type: 'visitor', name: 'Acme Widgets', stage_label: 'Website visit' })).toBe('Acme Widgets · Website visit');
  // 03:00 UTC on the 21st is the 20th in LA.
  expect(datesLine(item('todo', 'i', { created_at: '2026-10-21T03:00:00Z', due_date: '2026-10-23' }), 'Jack')).toBe('Added Oct 20 · due Oct 23 · owner Jack');
  expect(datesLine(item('signal', 'j'), null)).toBe('Added Oct 20 · no due date · no owner');
});

test('Member: the disclosure opens the full row under it; the text cell toggles too; row buttons do not; Open company opens the window', async () => {
  setup();
  await screen.findByText('Waiting on Pat: the MSA');
  const btn = screen.getByRole('button', { name: 'Show details for Waiting on Pat: the MSA' });
  fireEvent.click(btn);
  const panel = document.getElementById(btn.getAttribute('aria-controls'));
  expect(within(panel).getByText('Where it came from').nextSibling).toHaveTextContent('They owe it · due Oct 15 · 6 days late');
  expect(within(panel).getByText('Company').nextSibling).toHaveTextContent('Northwind Benefits · no touch yet');
  expect(within(panel).getByText('Dates').nextSibling).toHaveTextContent('Added Oct 20 · due Oct 15 · no owner');
  expect(panel.textContent).not.toMatch(/@/);
  expect(within(panel).queryAllByRole('button').map(b => b.textContent)).toEqual(['Waiting on Pat: the MSA ✎', 'Open company →']);
  fireEvent.click(screen.getByText('Follow up the benefits lead'));
  expect(document.querySelectorAll('[data-action-detail]')).toHaveLength(1);
  expect(screen.getByText('Flagged by a teammate')).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('button', { name: /Hide details for Follow up the benefits lead/ }), { key: 'Escape' });
  expect(document.querySelectorAll('[data-action-detail]')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Show details for Follow up Lakeshore Mutual' }));
  expect(screen.getByText('Tidy rule: a housekeeping check')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'Due date for Call back' }), { target: { value: '' } });
  fireEvent.click(screen.getByRole('group', { name: 'Actions for Call back' }));
  expect(document.querySelector('[data-action-detail]').closest('[data-detail]')).toHaveAttribute('data-detail', 'tidy-g1');
  fireEvent.click(screen.getByRole('button', { name: 'Open company →' }));
  expect(goalsApi.pipelineBoard).toHaveBeenCalledWith('b1', true);
});

// seif-campaign-v1 B4/B5 + actions-v2 A3 - campaign rows. A send: Copy email · Sent · More (Stop, Skip…); a reply: Respond · — ·
// More (Promote…). Copy email puts subject + body on the clipboard (never an address); Sent + Undo; Promote opens the dialog.
test('campaign rows: Copy email, Sent with Undo, Promote from More; no address on screen', async () => {
  const send = item('campaign', 'k1', { band: 'today', text: 'Send step 1 to Ana Alder (Alder Consulting)', why: 'Fall campaign · Consultants / brokers · knows Seif', due_date: TODAY, owner_user_id: JACK,
    meta: { action: 'send', campaign: 'Fall campaign', track: 'Consultants / brokers · knows Seif', name: 'Ana Alder', segment: 'consultant_broker', step_no: 1, steps: 3, company_name: 'Alder Consulting', title: 'Principal', last_sent_at: null, conflict: 'already in an Apollo sequence' } });
  const reply = item('campaign', 'k2', { band: 'now', text: 'Reply from Ben Birch (Birch Group) — respond', priority: 1, owner_user_id: JACK,
    meta: { action: 'reply', campaign: 'Fall campaign', name: 'Ben Birch', segment: 'corporate', step_no: 2, steps: 3, company_name: 'Birch Group', replied_at: '2026-10-21T17:00:00Z' } });
  goalsApi.actions.mockResolvedValue({ items: [reply, send], today: TODAY, week_start: '2026-10-19' });
  goalsApi.contactDraft.mockResolvedValue({ step_no: 1, subject: 'Hi from us', body: 'Hi Ana, a quick idea.' });
  goalsApi.contactAction.mockImplementation((b, id, action) => Promise.resolve(action === 'sent' ? { contact: { id }, event: { id: 'ev-1' } } : action === 'undo' ? { contact: { id }, undone: 'ev-1' } : { contact: { id }, record: { type: 'employer', id: 'o9', name: 'Birch Group' }, created: true, event: { id: 'ev-2' } }));
  const writeText = jest.fn(() => Promise.resolve());
  Object.assign(navigator, { clipboard: { writeText } });
  render(<ActionsView businessId="b1" canEdit meId={JACK} owner="team" members={members} lookup={lookup} onOpenFull={jest.fn()} />);
  const sendRow = await screen.findByRole('group', { name: 'Actions for Send step 1 to Ana Alder (Alder Consulting)' });
  expect([...screen.getByLabelText('More for Send step 1 to Ana Alder (Alder Consulting)').options].map(o => o.textContent)).toContain('Stop (no more steps)');
  fireEvent.click(within(sendRow).getByRole('button', { name: 'Copy email' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('Subject: Hi from us\n\nHi Ana, a quick idea.'));
  expect(await screen.findByRole('status')).toHaveTextContent('Step 1 email for Ana Alder copied');
  fireEvent.click(within(sendRow).getByRole('button', { name: 'Sent' }));
  await waitFor(() => expect(goalsApi.contactAction).toHaveBeenCalledWith('b1', 'k1', 'sent', { step_no: 1 }));
  expect(await screen.findByText('Ana Alder: step 1 sent')).toBeInTheDocument();
  expect(rows()).not.toContain('campaign-k1');
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(goalsApi.contactAction).toHaveBeenCalledWith('b1', 'k1', 'undo', { event_id: 'ev-1' }));

  const replyRow = screen.getByRole('group', { name: 'Actions for Reply from Ben Birch (Birch Group) — respond' });
  expect(within(replyRow).getByRole('button', { name: 'Respond' })).toBeInTheDocument();
  expect(within(replyRow).queryByRole('button', { name: 'Sent' })).toBeNull();
  more('Reply from Ben Birch (Birch Group) — respond', 'promote');
  const dialog = await screen.findByRole('dialog', { name: 'Promote Birch Group' });
  expect(within(dialog).getByRole('button', { name: 'Employer', pressed: true })).toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText(/Hand to/), { target: { value: CY } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Promote' }));
  await waitFor(() => expect(goalsApi.contactAction).toHaveBeenCalledWith('b1', 'k2', 'promote', { to: 'employer', owner_user_id: CY }));
  expect(await screen.findByText('Birch Group added to Pipeline as employer')).toBeInTheDocument();
  expect(document.body.textContent).not.toContain('@');
});

test('Viewer: campaign rows are not on a Viewer list', async () => {
  goalsApi.actions.mockResolvedValue({ items: [item('campaign', 'k1', { text: 'Send step 1 to Ana', meta: { action: 'send', name: 'Ana', step_no: 1 } }), items[3]], today: TODAY, week_start: '2026-10-19' });
  render(<ActionsView businessId="b1" canEdit={false} meId="u-seif" owner="team" members={members} lookup={lookup} onOpenFull={jest.fn()} />);
  await screen.findByText('Call back');
  expect(screen.queryByText('Send step 1 to Ana')).toBeNull();
});
