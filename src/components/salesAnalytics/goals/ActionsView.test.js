import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import ActionsView from './ActionsView';
import { goalsApi } from './goalsApi';
import { completeFlag } from '../huddleApi';
import { memberLookup } from './goalsUi';
import { actionsView, matchesActionFilters, priorityText, dueText, snoozeTo, readSort, writeSort } from './actionsModel';

// sales-ia-v2 Stage 5 - Actions. Made-up names only; no emails or phones.
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
jest.mock('../huddleApi', () => ({ completeFlag: jest.fn(() => Promise.resolve({})), announceFlagsChanged: jest.fn(), FLAGS_CHANGED: 'flags' }));
jest.mock('../pipelineApi', () => ({ updateOpportunity: jest.fn() }));
jest.mock('../../../utils/useMediaQuery', () => () => false);

const JACK = 'u-jack', CY = 'u-cyrus';
const members = [{ user_id: JACK, name: 'Jack Carlson' }, { user_id: CY, name: 'Cyrus Lee' }];
const lookup = memberLookup(members);
const TODAY = '2026-10-21';
const item = (kind, id, extra) => ({ key: `${kind}-${id}`, kind, id, text: `${kind} ${id}`, why: null, company: null, due_date: null, overdue: false, late_days: 0, owner_user_id: null, priority: 2, status: 'open', created_at: '2026-10-20T10:00:00Z', meta: {}, ...extra });
const items = [
  item('waiting', 'w1', { text: 'Waiting on Pat: the MSA', why: '6 d late', due_date: '2026-10-15', overdue: true, late_days: 6, company: { type: 'partner', id: 'p1', name: 'Northwind Benefits', priority: null } }),
  item('flag', 'f1', { text: 'Follow up the benefits lead', why: 'Flagged by Cyrus · “opened 3x”', priority: 1, owner_user_id: JACK, meta: { contact: 'Benefits lead' } }),
  item('signal', 's1', { text: 'Reach out: Acme Widgets', why: 'P1 Act today: US 500+ with 5+ visits', priority: 1, company: { type: 'visitor', id: 'acme widgets', name: 'Acme Widgets', priority: null }, meta: { source: 'web_visit' } }),
  item('todo', 't1', { text: 'Call back', why: 'Signals', due_date: TODAY, owner_user_id: JACK, company: { type: 'employer', id: 'o1', name: 'Old Mill Union', priority: null } }),
  item('todo', 't2', { text: 'Draft the one-pager', due_date: '2026-10-23', owner_user_id: CY, priority: 3 }),
  item('tidy', 'g1', { text: 'Follow up Lakeshore Mutual', why: 'Replied · no open to-do', priority: 3, company: { type: 'partner', id: 'p2', name: 'Lakeshore Mutual', priority: null }, meta: { kind: 'follow_up', ref_type: 'partner', makes_todo: true } }),
  item('focus', 'c1', { text: 'Book two meetings', why: 'Pipeline is thin', owner_user_id: JACK }),
  item('focus', 'c2', { text: 'Ship the deck', owner_user_id: JACK, status: 'done' }),
  item('signal', 's2', { text: 'Reach out: Hot Co', priority: 2, company: { type: null, id: null, name: 'Hot Co', priority: null }, meta: { source: 'scout' } }),
];
const rows = () => screen.getAllByRole('row').filter(r => r.hasAttribute('data-row')).map(r => r.getAttribute('data-key'));
// CRA's Jest resets mock implementations before every test, so the stubs are set here.
const setup = (props = {}) => {
  goalsApi.actions.mockResolvedValue({ items, today: TODAY, week_start: '2026-10-19' });
  goalsApi.pipelineBoard.mockImplementation(() => new Promise(() => {}));
  goalsApi.companyDetail.mockImplementation(() => new Promise(() => {}));
  completeFlag.mockResolvedValue({});
  return render(<ActionsView businessId="b1" canEdit meId={JACK} members={members} lookup={lookup} onPlan={jest.fn()} onOpenFull={jest.fn()} {...props} />);
};
beforeEach(() => { jest.clearAllMocks(); localStorage.clear(); });

test('model: Mine = mine or unowned, Team = all; Viewer kinds; priority / due text; sort memory', () => {
  const mine = actionsView(items, { who: 'mine', kind: '', q: '' }, { meId: JACK });
  expect(mine.open.map(i => i.key)).not.toContain('todo-t2');
  expect(mine.open.map(i => i.key)).toContain('signal-s1');
  expect(mine.done.map(i => i.key)).toEqual(['focus-c2']);
  expect(actionsView(items, { who: 'team', kind: '', q: '' }, { meId: JACK }).open.map(i => i.key)).toContain('todo-t2');
  expect(actionsView(items, { who: 'team', kind: 'signal', q: '' }, { meId: JACK }).open.map(i => i.kind)).toEqual(['signal', 'signal']);
  expect(actionsView(items, { who: 'team', kind: '', q: 'lakeshore' }, { meId: JACK }).open.map(i => i.key)).toEqual(['tidy-g1']);
  const viewer = actionsView(items, { who: 'team', kind: '', q: '' }, { meId: 'u-seif', viewer: true });
  expect([...new Set(viewer.open.map(i => i.kind))].sort()).toEqual(['flag', 'focus', 'todo']);
  // A kind the screen has no buttons for yet (a server row ahead of its UI) is hidden, not a crash.
  expect(actionsView([...items, { ...items[0], key: 'later-x', kind: 'later' }], { who: 'team', kind: '', q: '' }, { meId: JACK }).open.map(i => i.key)).not.toContain('later-x');
  expect(matchesActionFilters(items[0], { who: 'mine', kind: '', q: 'MSA' }, JACK)).toBe(true);
  expect(priorityText(items[0])).toBe('Overdue · 6 d');
  expect(priorityText(items[1])).toBe('P1');
  expect([dueText(items[3], TODAY), dueText(items[4], TODAY), dueText(items[5], TODAY)]).toEqual(['Today', 'Oct 23', '—']);
  expect(snoozeTo(TODAY, '7')).toBe('2026-10-28');
  expect(readSort()).toBeNull();
  writeSort({ id: 'due', dir: 'asc' });
  expect(readSort()).toEqual({ id: 'due', dir: 'asc' });
  writeSort(null);
  expect(readSort()).toBeNull();
});

test('Member: the list keeps the server ranking, Mine by default, every column sorts, done Focus folds into "n done ▸"', async () => {
  setup();
  await screen.findByText('Waiting on Pat: the MSA');
  expect(rows()).toEqual(['waiting-w1', 'flag-f1', 'signal-s1', 'todo-t1', 'tidy-g1', 'focus-c1', 'signal-s2']);
  expect(screen.queryByText('Draft the one-pager')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Team' }));
  expect(rows()).toContain('todo-t2');
  const table = screen.getByRole('table', { name: 'Actions' });
  const heads = within(table).getAllByRole('columnheader');
  expect(heads.map(h => h.getAttribute('aria-sort')).filter(Boolean)).toHaveLength(7);
  expect(heads.map(h => h.textContent.replace(/ [↕▲▼]$/, ''))).toEqual(['Priority', 'What to do', 'Company', 'Why', 'Kind', 'Due', 'Owner', '']);
  fireEvent.click(within(table).getByRole('button', { name: /^Due/ }));
  expect(rows()[0]).toBe('waiting-w1');
  expect(JSON.parse(localStorage.getItem('prospector_actions_sort'))).toEqual({ id: 'due', dir: 'asc' });
  fireEvent.click(within(table).getByRole('button', { name: /^Due/ })); fireEvent.click(within(table).getByRole('button', { name: /^Due/ }));
  expect(localStorage.getItem('prospector_actions_sort')).toBeNull();
  // Done Focus items fold; opening the fold shows the row with Reopen.
  expect(screen.queryByText('Ship the deck')).toBeNull();
  const fold = screen.getByRole('button', { name: '1 done ▸' });
  expect(fold.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(fold);
  expect(screen.getByText('Ship the deck')).toBeTruthy();
  expect(within(screen.getByRole('group', { name: 'Actions for Ship the deck' })).getByRole('button', { name: 'Reopen' })).toBeTruthy();
  // Kind + search filters, Clear keeps Mine/Team.
  fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'signal' } });
  expect(rows()).toEqual(['signal-s1', 'signal-s2']);
  fireEvent.change(screen.getByLabelText('Search actions'), { target: { value: 'hot' } });
  expect(rows()).toEqual(['signal-s2']);
  fireEvent.click(screen.getByRole('button', { name: /^Clear/ }));
  expect(rows().filter(k => k !== 'focus-c2')).toHaveLength(8); // the opened fold keeps its row
  expect(screen.getByRole('button', { name: 'Team' }).getAttribute('aria-pressed')).toBe('true');
  // Company: a Pipeline row opens the company window (board load); a company not in the Pipeline is plain text.
  fireEvent.click(screen.getByRole('button', { name: 'Old Mill Union' }));
  expect(goalsApi.pipelineBoard).toHaveBeenCalledWith('b1', true);
  expect(screen.queryByRole('button', { name: 'Hot Co' })).toBeNull();
  expect(screen.getByTitle('Hot Co is not in the Pipeline yet')).toBeTruthy();
});

test('Accept a signal: the row leaves at once, the to-do text is in the toast, Undo calls the signal undo route and reloads', async () => {
  goalsApi.acceptSignal.mockResolvedValue({ todo: { id: 'td', text: 'Reach out: Acme Widgets' }, via: 'new_target' });
  goalsApi.undoSignal.mockResolvedValue({ signal: { status: 'new' } });
  setup();
  await screen.findByText('Reach out: Acme Widgets');
  fireEvent.click(within(screen.getByRole('group', { name: 'Actions for Reach out: Acme Widgets' })).getByRole('button', { name: 'Accept' }));
  expect(rows()).not.toContain('signal-s1');
  await waitFor(() => expect(goalsApi.acceptSignal).toHaveBeenCalledWith('b1', 's1'));
  const toast = await screen.findByRole('status');
  expect(toast.textContent).toContain('Accepted · to-do added: Reach out: Acme Widgets');
  fireEvent.click(within(toast).getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(goalsApi.undoSignal).toHaveBeenCalledWith('b1', 's1'));
  await waitFor(() => expect(goalsApi.actions).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  // Tidy Accept hands the to-do id to its undo; Dismiss / Snooze park for 7 days.
  goalsApi.acceptSuggestion.mockResolvedValue({ suggestion: {}, todo: { id: 'td2', text: 'Follow up Lakeshore Mutual' } });
  fireEvent.click(within(screen.getByRole('group', { name: 'Actions for Follow up Lakeshore Mutual' })).getByRole('button', { name: 'Accept' }));
  await waitFor(() => expect(goalsApi.acceptSuggestion).toHaveBeenCalledWith('b1', 'g1'));
  fireEvent.click(within(await screen.findByRole('status')).getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(goalsApi.undoSuggestion).toHaveBeenCalledWith('b1', 'g1', 'td2'));
});

// FIX actions-done-button-v1 REV2 - Done on a signal / to-do-making Tidy row.
test('Done on a signal and on a Tidy row: Accept with done, "Done: <text>" toast, Undo hands the touch id back; no Done on a pair row or for a Viewer', async () => {
  goalsApi.acceptSignal.mockResolvedValue({ todo: { id: 'td', text: 'Reach out: Acme Widgets' }, via: 'partner', touch_event_id: 'ev1' });
  goalsApi.undoSignal.mockResolvedValue({ signal: { status: 'new' } });
  goalsApi.acceptSuggestion.mockResolvedValue({ suggestion: {}, todo: { id: 'td2', text: 'Follow up Lakeshore Mutual' }, touch_event_id: 'ev2' });
  goalsApi.undoSuggestion.mockResolvedValue({ suggestion: { status: 'proposed' } });
  const pair = item('tidy', 'g2', { text: 'Possible duplicate: Lockton / Lockton Inc', priority: 3, meta: { kind: 'duplicate', ref_type: 'pair', makes_todo: false } });
  goalsApi.actions.mockResolvedValue({ items: [...items, pair], today: TODAY, week_start: '2026-10-19' });
  render(<ActionsView businessId="b1" canEdit meId={JACK} members={members} lookup={lookup} onPlan={jest.fn()} onOpenFull={jest.fn()} />);
  await screen.findByText('Reach out: Acme Widgets');
  const acts = text => within(screen.getByRole('group', { name: `Actions for ${text}` }));
  const doneBtn = acts('Reach out: Acme Widgets').getByRole('button', { name: 'Done' });
  expect(doneBtn).toHaveAttribute('title', 'Already did it — logs it as done (Undo for 10 s)');
  expect(doneBtn).toHaveClass('ui-btn--secondary');
  expect(acts('Reach out: Acme Widgets').getAllByRole('button').map(b => b.textContent)).toEqual(['Accept', 'Done', 'Dismiss']);
  expect(acts('Follow up Lakeshore Mutual').getAllByRole('button').map(b => b.textContent)).toEqual(['Accept', 'Done', 'Dismiss', 'Snooze']);
  expect(acts('Possible duplicate: Lockton / Lockton Inc').getAllByRole('button').map(b => b.textContent)).toEqual(['Accept', 'Dismiss', 'Snooze']);
  fireEvent.click(doneBtn);
  expect(rows()).not.toContain('signal-s1');
  await waitFor(() => expect(goalsApi.acceptSignal).toHaveBeenCalledWith('b1', 's1', { done: true }));
  const toast = await screen.findByRole('status');
  expect(toast.textContent).toContain('Done: Reach out: Acme Widgets');
  fireEvent.click(within(toast).getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(goalsApi.undoSignal).toHaveBeenCalledWith('b1', 's1', 'ev1'));
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  fireEvent.click(acts('Follow up Lakeshore Mutual').getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(goalsApi.acceptSuggestion).toHaveBeenCalledWith('b1', 'g1', { done: true }));
  const t2 = await screen.findByRole('status');
  expect(t2.textContent).toContain('Done: Follow up Lakeshore Mutual');
  fireEvent.click(within(t2).getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(goalsApi.undoSuggestion).toHaveBeenCalledWith('b1', 'g1', 'td2', 'ev2'));
});

test('Viewer: no Done button anywhere (no signal or Tidy rows, no actions column)', async () => {
  setup({ canEdit: false, meId: 'u-seif' });
  await screen.findByText('Call back');
  expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
  expect(screen.queryByText('Reach out: Acme Widgets')).toBeNull();
});

test('to-do Done / Snooze / Reassign, waiting Got it / Nudge, Focus Done - each with its reverse write on Undo', async () => {
  goalsApi.updateWeekGoal.mockResolvedValue({});
  goalsApi.nudgeWaiting.mockResolvedValue({ id: 'nd', text: 'Nudge Pat re the MSA' });
  setup();
  await screen.findByText('Call back');
  const acts = text => within(screen.getByRole('group', { name: `Actions for ${text}` }));
  fireEvent.click(acts('Call back').getByRole('button', { name: 'Done' }));
  expect(rows()).not.toContain('todo-t1');
  await waitFor(() => expect(goalsApi.updateWeekGoal).toHaveBeenCalledWith('b1', 't1', { status: 'done' }));
  fireEvent.click(within(await screen.findByRole('status')).getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(goalsApi.updateWeekGoal).toHaveBeenCalledWith('b1', 't1', { status: 'open' }));
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  await screen.findByText('Call back');
  fireEvent.change(acts('Call back').getByLabelText('Snooze Call back'), { target: { value: '7' } });
  await waitFor(() => expect(goalsApi.updateWeekGoal).toHaveBeenCalledWith('b1', 't1', { due_date: '2026-10-28' }));
  expect((await screen.findByRole('status')).textContent).toContain('Snoozed to Oct 28');
  fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(goalsApi.updateWeekGoal).toHaveBeenCalledWith('b1', 't1', { due_date: TODAY }));
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  fireEvent.change(acts('Call back').getByLabelText('Reassign Call back'), { target: { value: CY } });
  await waitFor(() => expect(goalsApi.updateWeekGoal).toHaveBeenCalledWith('b1', 't1', { owner_user_id: CY }));
  expect((await screen.findByRole('status')).textContent).toContain('Reassigned to Cyrus');
  fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(goalsApi.updateWeekGoal).toHaveBeenCalledWith('b1', 't1', { owner_user_id: JACK }));
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  fireEvent.click(acts('Waiting on Pat: the MSA').getByRole('button', { name: 'Nudge' }));
  await waitFor(() => expect(goalsApi.nudgeWaiting).toHaveBeenCalledWith('b1', 'w1'));
  expect(rows()).toContain('waiting-w1');
  fireEvent.click(within(await screen.findByRole('status')).getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(goalsApi.deleteWeekGoal).toHaveBeenCalledWith('b1', 'nd'));
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  fireEvent.click(acts('Waiting on Pat: the MSA').getByRole('button', { name: 'Got it' }));
  expect(rows()).not.toContain('waiting-w1');
  await waitFor(() => expect(goalsApi.updateWeekGoal).toHaveBeenCalledWith('b1', 'w1', { status: 'done' }));
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeNull());
  fireEvent.click(acts('Book two meetings').getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(goalsApi.updateWeekGoal).toHaveBeenCalledWith('b1', 'c1', { status: 'done' }));
});

test('Mark contacted is the deferred write: the row leaves, the flag closes only when the 10 s window ends; Undo keeps it open', async () => {
  jest.useFakeTimers();
  try {
    setup();
    await screen.findByText('Follow up the benefits lead');
    fireEvent.click(within(screen.getByRole('group', { name: 'Actions for Follow up the benefits lead' })).getByRole('button', { name: 'Mark contacted' }));
    expect(rows()).not.toContain('flag-f1');
    expect(completeFlag).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(goalsApi.actions).toHaveBeenCalledTimes(2));
    expect(completeFlag).not.toHaveBeenCalled();
    await screen.findByText('Follow up the benefits lead');
    fireEvent.click(within(screen.getByRole('group', { name: 'Actions for Follow up the benefits lead' })).getByRole('button', { name: 'Mark contacted' }));
    act(() => { jest.advanceTimersByTime(10000); });
    await waitFor(() => expect(completeFlag).toHaveBeenCalledWith('b1', 'f1', { keepalive: true }));
  } finally { jest.useRealTimers(); }
});

test('Mark contacted flushes on page unload and on unmount - never lost', async () => {
  jest.useFakeTimers();
  try {
    const view = setup();
    await screen.findByText('Follow up the benefits lead');
    fireEvent.click(within(screen.getByRole('group', { name: 'Actions for Follow up the benefits lead' })).getByRole('button', { name: 'Mark contacted' }));
    expect(completeFlag).not.toHaveBeenCalled();
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(completeFlag).toHaveBeenCalledTimes(1);
    expect(completeFlag).toHaveBeenCalledWith('b1', 'f1', { keepalive: true });
    act(() => { jest.advanceTimersByTime(10000); });
    expect(completeFlag).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(completeFlag).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});

test('Viewer: the Team list with to-dos, Focus 5 and flags only, read-only - no buttons, no selects, no Mine/Team', async () => {
  setup({ canEdit: false, meId: 'u-seif' });
  await screen.findByText('Call back');
  expect(rows()).toEqual(['flag-f1', 'todo-t1', 'todo-t2', 'focus-c1']);
  expect(screen.queryByRole('group', { name: 'Who' })).toBeNull();
  expect(screen.queryByRole('group', { name: /^Actions for/ })).toBeNull();
  const table = screen.getByRole('table', { name: 'Actions' });
  expect(within(table).getAllByRole('columnheader')).toHaveLength(7); // no Actions column at all for a Viewer
  const buttons = within(table).getAllByRole('button').filter(b => !['ui-table__sort', 'ui-table__toggle', 'ui-table__disclose'].some(c => b.classList.contains(c)));
  expect(buttons.map(b => b.textContent)).toEqual(['Old Mill Union']);
  expect(table.querySelectorAll('.ui-table__disclose')).toHaveLength(4); // the read-only detail is a Viewer's too
  expect(within(table).queryByRole('combobox')).toBeNull();
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
  expect(datesLine(item('signal', 'j'), null)).toBe('Added Oct 20 · no due date · owner Team');
});

test('Member: the disclosure opens the full row under it; the text cell toggles too; row buttons do not; Open company opens the window', async () => {
  setup();
  await screen.findByText('Waiting on Pat: the MSA');
  const btn = screen.getByRole('button', { name: 'Show details for Waiting on Pat: the MSA' });
  fireEvent.click(btn);
  const panel = document.getElementById(btn.getAttribute('aria-controls'));
  expect(within(panel).getByText('Where it came from').nextSibling).toHaveTextContent('They owe it · due Oct 15 · 6 days late');
  expect(within(panel).getByText('Company').nextSibling).toHaveTextContent('Northwind Benefits · no touch yet');
  expect(within(panel).getByText('Dates').nextSibling).toHaveTextContent('Added Oct 20 · due Oct 15 · owner Team');
  expect(panel.textContent).not.toMatch(/@/);
  expect(within(panel).queryAllByRole('button').map(b => b.textContent)).toEqual(['Open company →']);
  fireEvent.click(screen.getByText('Follow up the benefits lead'));
  expect(document.querySelectorAll('[data-action-detail]')).toHaveLength(1);
  expect(screen.getByText('Flagged by a teammate')).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('button', { name: /Hide details for Follow up the benefits lead/ }), { key: 'Escape' });
  expect(document.querySelectorAll('[data-action-detail]')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Show details for Follow up Lakeshore Mutual' }));
  expect(screen.getByText('Tidy rule: a housekeeping check')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'Snooze Call back' }), { target: { value: '' } });
  fireEvent.click(screen.getByRole('group', { name: 'Actions for Call back' }));
  expect(document.querySelector('[data-action-detail]').closest('[data-detail]')).toHaveAttribute('data-detail', 'tidy-g1');
  fireEvent.click(screen.getByRole('button', { name: 'Open company →' }));
  expect(goalsApi.pipelineBoard).toHaveBeenCalledWith('b1', true);
});

// seif-campaign-v1 B4/B5 - campaign rows. A send: Copy email puts subject + body on the clipboard (never an address),
// Sent removes the row and Undo sends the server's undo with the event id. A reply: Promote opens the dialog.
test('campaign rows: Copy email, Sent with Undo, Promote dialog; no address on screen', async () => {
  const send = item('campaign', 'k1', { text: 'Send step 1 to Ana Alder (Alder Consulting)', why: 'Fall campaign · Consultants / brokers · knows Seif', due_date: TODAY, owner_user_id: JACK,
    meta: { action: 'send', campaign: 'Fall campaign', track: 'Consultants / brokers · knows Seif', name: 'Ana Alder', segment: 'consultant_broker', step_no: 1, steps: 3, company_name: 'Alder Consulting', title: 'Principal', last_sent_at: null, conflict: 'already in an Apollo sequence' } });
  const reply = item('campaign', 'k2', { text: 'Reply from Ben Birch (Birch Group) — respond', priority: 1, owner_user_id: JACK,
    meta: { action: 'reply', campaign: 'Fall campaign', name: 'Ben Birch', segment: 'corporate', step_no: 2, steps: 3, company_name: 'Birch Group', replied_at: '2026-10-21T17:00:00Z' } });
  goalsApi.actions.mockResolvedValue({ items: [send, reply], today: TODAY, week_start: '2026-10-19' });
  goalsApi.contactDraft.mockResolvedValue({ step_no: 1, subject: 'Hi from us', body: 'Hi Ana, a quick idea.' });
  goalsApi.contactAction.mockImplementation((b, id, action) => Promise.resolve(action === 'sent' ? { contact: { id }, event: { id: 'ev-1' } } : action === 'undo' ? { contact: { id }, undone: 'ev-1' } : { contact: { id }, record: { type: 'employer', id: 'o9', name: 'Birch Group' }, created: true, event: { id: 'ev-2' } }));
  const writeText = jest.fn(() => Promise.resolve());
  Object.assign(navigator, { clipboard: { writeText } });
  render(<ActionsView businessId="b1" canEdit meId={JACK} members={members} lookup={lookup} onPlan={jest.fn()} onOpenFull={jest.fn()} />);
  const sendRow = await screen.findByRole('group', { name: 'Actions for Send step 1 to Ana Alder (Alder Consulting)' });
  expect(within(sendRow).queryByRole('button', { name: 'Promote…' })).toBeNull();
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
  expect(within(replyRow).queryByRole('button', { name: 'Sent' })).toBeNull();
  fireEvent.click(within(replyRow).getByRole('button', { name: 'Promote…' }));
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
  render(<ActionsView businessId="b1" canEdit={false} meId="u-seif" members={members} lookup={lookup} onPlan={null} onOpenFull={jest.fn()} />);
  await screen.findByText('Call back');
  expect(screen.queryByText('Send step 1 to Ana')).toBeNull();
});
