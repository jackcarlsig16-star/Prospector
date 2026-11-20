import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import TodayList from './TodayList';
import TodayFixes from './TodayFixes';
import { goalsApi } from '../goalsApi';
import { scoutApi } from '../../../scout/scoutApi';
import { dueWords, doneWords, nextMonday, snoozeChoices, bulkDates, scoutRow, todayQuery, SOURCE } from './todayRows';

// actions-v2 Stage 2 - the Today list, one test per state of the mockups: the groups and their rows, the overdue
// fold, Everything else collapsed, chips / source / search, the five strip, the check circle and the ⋯ menu through
// Scout's plan -> act -> undo, the bulk-date card, the empty states, the Viewer, the phone list, and Fix the list.
// Made-up rows; names, titles and companies only - no address or phone anywhere.
jest.mock('../goalsApi', () => ({ ...jest.requireActual('../goalsApi'), goalsApi: { today: jest.fn(), todayFixes: jest.fn() } }));
jest.mock('../../../scout/scoutApi', () => ({ scoutApi: { plan: jest.fn(), act: jest.fn(), undo: jest.fn() } }));

const TODAY = '2026-11-19';
const co = (name, extra = {}) => ({ type: 'employer', id: `00000000-0000-4000-8000-${name.length.toString().padStart(12, '0')}`, key: 'k', name, score: 72, band: 'P1', pinned: false, visits_7d: 0, ...extra });
let n = 0;
const row = (text, extra = {}) => ({ key: `todo:t${++n}`, kind: 'todo', id: `t${n}`, text, company: null, person: null, owner_user_id: 'u1', owner: 'Jack', due: null, overdue: false, late_days: 0, source: 'manual', verb: 'next_steps', virtual: false, rank: n, ...extra });
const GROUP = (id, label, note, rows, extra = {}) => ({ id, label, note, n: rows.length, collapsed: id === 'rest', fold: null, rows, ...extra });
const view = (over = {}) => {
  n = 0;
  const due = [
    row('Old overdue A', { due: '2026-10-10', overdue: true, late_days: 40, folded: true }),
    row('Send the benefits one-pager', { due: '2026-11-16', overdue: true, late_days: 3, folded: false, company: co('Northrop Grumman', { pinned: true }), source: 'call_notes', verb: 'draft_email' }),
    row('Confirm the December demo time', { due: TODAY }),
  ];
  const top = [row('Email the People team', { due: '2026-11-20', company: co('Cloudflare', { score: 65 }), person: { key: 'prospect:p1', name: 'Dana Mayer', title: 'VP People', heat: 48, heat_band: 'hot' }, verb: 'draft_email' }), row('Find the benefits lead', { company: co('Flowserve'), verb: 'find_people', owner_user_id: null, owner: null })];
  const visited = [row('Follow up after the pricing visit', { company: co('Qubika', { band: 'P2', score: 56, visits_7d: 4 }), verb: 'draft_email' })];
  const reply = [{ ...row('Reply to Crys Pringle', { verb: 'draft_reply', source: 'reply', person: { key: 'prospect:p2', name: 'Crys Pringle', title: null, heat: 108, heat_band: 'hot' }, company: { type: null, id: null, name: 'Solid Co' }, replied_at: '2026-11-17T10:00:00Z' }), key: 'reply:prospect:p2', kind: 'reply', id: null, virtual: true },
    { ...row('Waiting on Pat: the signed MSA', { source: 'waiting', owner_user_id: null, owner: null }), kind: 'waiting' }];
  const rest = [row('Draft the partner recap'), row('Read the S-1')];
  return {
    today: TODAY, rule: '1 due today or overdue · 2 at a pinned or P1 company.', strip: [], five: { used: 0, max: 5 }, badge: 5, members: [{ id: 'u1', name: 'Jack Zz' }, { id: 'u2', name: 'Cyrus Yy' }],
    counts: { shown: 10, mine: 10, team: 22, overdue: 2, undated: 6, snoozed: 1, open_todos: 20, sources: {} }, verbs: {},
    groups: [GROUP('due', 'Due and overdue', 'due today or earlier, earliest first', due, { fold: { overdue: 2, hidden: 1, oldest_days: 40 } }), GROUP('top', 'Pinned or P1 company', 'the company is pinned or in the top band', top), GROUP('visited', 'Visited this week', 'on the site in 7 days', visited), GROUP('reply', 'Waiting on a reply', 'they wrote back', reply), GROUP('rest', 'Everything else', 'no date, no ranked company · newest first', rest)],
    ...over,
  };
};
const lookup = id => ({ first: id === 'u1' ? 'Jack' : 'Cyrus', color: 'rgb(111, 140, 240)' });
const show = async (props = {}) => { const r = render(<TodayList businessId="b1" canEdit lookup={lookup} {...props} />); await screen.findByText('Showing', { exact: false }); return r; };
const rowOf = text => screen.getByText(text).closest('[data-today-row]');
const CARD = (verb, rows) => ({ plan_id: 'pl1', verb, rows: rows.map(t => ({ key: t, kind: 'task', title: t, from: 'open', to: 'done', skipped: null, note: null })), summary: { will: rows.length, skipped: 0 }, to: null, when: null });
const ACTED = (rows, line) => ({ plan_id: 'pl1', rows: rows.map(t => ({ key: t, title: t, ok: true, error: null })), done: rows.length, failed: 0, line, can_undo: true });
beforeEach(() => { jest.clearAllMocks(); goalsApi.today.mockResolvedValue(view()); try { localStorage.clear(); } catch { /* none */ } });

test('model: due words, done lines, dates, the nine sources, the query', () => {
  expect(dueWords({ kind: 'todo', overdue: true, late_days: 3 }, TODAY)).toEqual({ text: '3 d late', tone: 'bad' });
  expect(dueWords({ kind: 'todo', due: TODAY }, TODAY)).toEqual({ text: 'Today', tone: 'text' });
  expect(dueWords({ kind: 'todo', due: '2026-11-20' }, TODAY)).toEqual({ text: 'Fri Nov 20', tone: 'muted' });
  expect(dueWords({ kind: 'reply', replied_at: '2026-11-17T10:00:00Z' }, TODAY).text).toBe('replied Nov 17');
  expect(dueWords({ kind: 'todo', due: null }, TODAY)).toBeNull();
  expect(nextMonday(TODAY)).toBe('2026-11-23');
  expect(snoozeChoices(TODAY)).toEqual([['Tomorrow', '2026-11-20'], ['Monday', '2026-11-23'], ['1 week', '2026-11-26']]);
  expect(bulkDates(TODAY)).toEqual(['2026-11-20', '2026-11-23', '2026-11-27']);
  const res = titles => ({ rows: titles.map(t => ({ title: t, ok: true })), line: 'server line' });
  expect(doneWords('task_done', res(['Send it']))).toBe('Done: Send it.');
  expect(doneWords('snooze', res(['Find the lead']), { date: '2026-11-23' })).toBe('Snoozed until Mon Nov 23: Find the lead.');
  expect(doneWords('assign', res(['Email them']), { ownerName: 'Cyrus' })).toBe('Email them is now Cyrus’s.');
  expect(doneWords('task_drop', res(['Draft it']))).toBe('Dropped: Draft it.');
  expect(doneWords('task_due', res(['a', 'b', 'c']), { date: '2026-11-20' })).toBe('Dated 3 to-dos Fri Nov 20.');
  expect(doneWords('task_done', { ...res(['a']), failed: 1 })).toBe('server line');
  expect(Object.keys(SOURCE)).toHaveLength(9);
  expect(scoutRow({ kind: 'reply', person: { key: 'prospect:p2', name: 'Crys Pringle' }, company: { id: null } })).toEqual({ entity: 'people', id: 'prospect:p2', title: 'Crys Pringle', company: null });
  expect(todayQuery({ owner: 'me', chip: 'overdue', source: 'reply', q: 'x' })).toEqual({ owner: 'me', chips: 'overdue', source: 'reply', q: 'x' });
  expect(todayQuery({ owner: 'team', chip: null, source: '', q: '' })).toEqual({});
});

test('the list: five group headers with counts, a row once with its rank, company pill + pin + visits, person + heat, owner, due, From glyph and the verb', async () => {
  await show();
  expect(goalsApi.today).toHaveBeenCalledWith('b1', { owner: 'me' });
  expect([...document.querySelectorAll('tr[data-today-group]')].map(g => g.getAttribute('data-today-group'))).toEqual(['due', 'top', 'visited', 'reply', 'rest']);
  expect(document.querySelector('tr[data-today-group="due"]')).toHaveTextContent('Due and overdue3due today or earlier');
  const r = rowOf('Send the benefits one-pager');
  expect(r).toHaveTextContent('2'); expect(r).toHaveTextContent('Northrop Grumman'); expect(r).toHaveTextContent('P172'); expect(r).toHaveTextContent('3 d late');
  expect(within(r).getByRole('img', { name: 'Pinned company' })).toBeInTheDocument();
  expect(within(r).getByRole('img', { name: 'From: Call notes' })).toBeInTheDocument();
  expect(r.querySelector('[data-today-verb="draft_email"]')).toHaveTextContent('Draft email');
  expect(within(r).getByRole('link', { name: 'Northrop Grumman' }).getAttribute('href')).toMatch(/open=employer-/);
  const p = rowOf('Email the People team');
  expect(p).toHaveTextContent('Dana Mayer'); expect(p.querySelector('[data-heat-band="hot"]')).toHaveTextContent('Hot 48'); expect(p).toHaveTextContent('Fri Nov 20');
  expect(rowOf('Follow up after the pricing visit')).toHaveTextContent('4 visits');
  expect(rowOf('Find the benefits lead')).toHaveTextContent('Unassigned');
  expect(rowOf('Reply to Crys Pringle')).toHaveTextContent('replied Nov 17');
  expect(screen.getByText('Showing', { exact: false })).toHaveTextContent('Showing 10 of 22 open · ranked for you, not sortable');
  expect(screen.getByLabelText('How this is ranked')).toHaveTextContent('1 due today or overdue');
  expect(document.querySelector('table').textContent).not.toMatch(/@/);
});

test('the overdue fold and Everything else: old overdue rows wait behind "Show all n overdue"; the last group opens on a click', async () => {
  await show();
  expect(screen.queryByText('Old overdue A')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Show all 2 overdue · oldest is 40 d late/ }));
  expect(screen.getByText('Old overdue A')).toBeInTheDocument();
  expect(screen.queryByText('Draft the partner recap')).toBeNull();
  const toggle = screen.getByRole('button', { name: /Everything else/ });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  expect(screen.getByText('Draft the partner recap')).toBeInTheDocument();
});

test('chips, source and search re-read the list from the server; an empty group that is not "Visited" still shows its header', async () => {
  await show();
  expect(screen.getByRole('button', { name: /Mine 10/ })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: /Overdue 2/ }).querySelector('b')).toHaveClass('td-bad');
  fireEvent.click(screen.getByRole('button', { name: /Team 22/ }));
  await waitFor(() => expect(goalsApi.today).toHaveBeenLastCalledWith('b1', {}));
  fireEvent.click(screen.getByRole('button', { name: /Undated 6/ }));
  await waitFor(() => expect(goalsApi.today).toHaveBeenLastCalledWith('b1', { chips: 'undated' }));
  fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'call_notes' } });
  await waitFor(() => expect(goalsApi.today).toHaveBeenLastCalledWith('b1', { chips: 'undated', source: 'call_notes' }));
  jest.useFakeTimers();
  fireEvent.change(screen.getByLabelText('Search to-dos'), { target: { value: 'cloud' } });
  act(() => { jest.advanceTimersByTime(300); });
  jest.useRealTimers();
  await waitFor(() => expect(goalsApi.today).toHaveBeenLastCalledWith('b1', { chips: 'undated', source: 'call_notes', q: 'cloud' }));
});

test('the check circle: one row planned and acted in one go through Scout, the done line with Undo, the list re-read', async () => {
  scoutApi.plan.mockResolvedValue(CARD('task_done', ['Confirm the December demo time']));
  scoutApi.act.mockResolvedValue(ACTED(['Confirm the December demo time'], 'Marked done 1'));
  scoutApi.undo.mockResolvedValue({ line: 'undone', rows: [] });
  await show();
  fireEvent.click(screen.getByRole('button', { name: 'Done: Confirm the December demo time' }));
  await waitFor(() => expect(scoutApi.act).toHaveBeenCalledWith({ plan_id: 'pl1' }));
  expect(scoutApi.plan).toHaveBeenCalledWith({ scope: 'b1', verb: 'task_done', rows: [{ entity: 'todos', id: 't3', title: 'Confirm the December demo time' }], keys: ['todos:t3'], args: {}, text: '' });
  const toast = await screen.findByText('Done: Confirm the December demo time.');
  expect(toast.closest('[data-today-toast]')).toHaveAttribute('data-today-toast', 'done');
  expect(goalsApi.today).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: /Undo 10 s/ }));
  await waitFor(() => expect(scoutApi.undo).toHaveBeenCalledWith({ plan_id: 'pl1' }));
  expect(await screen.findByText('Undone.')).toBeInTheDocument();
  expect(goalsApi.today).toHaveBeenCalledTimes(3);
});

test('the ⋯ menu changes in place: Reassign lists the members, Snooze and Due list days and a date field, Drop is last; each is a Scout verb; "Set date" opens Due', async () => {
  scoutApi.plan.mockResolvedValue(CARD('snooze', ['Email the People team']));
  scoutApi.act.mockResolvedValue(ACTED(['Email the People team'], 'Snoozed 1'));
  await show();
  fireEvent.click(screen.getByRole('button', { name: 'More for Email the People team' }));
  const menu = screen.getByRole('menu');
  expect(within(menu).getAllByRole('menuitem').map(i => i.textContent)).toEqual(['ReassignJack', 'Snooze', 'DueFri Nov 20', 'Open Cloudflare', 'Drop']);
  fireEvent.click(within(menu).getByRole('menuitem', { name: /Snooze/ }));
  expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map(i => i.textContent)).toEqual(['TomorrowFri Nov 20', 'MondayMon Nov 23', '1 weekThu Nov 26']);
  expect(screen.getByLabelText('Pick a date')).toHaveAttribute('type', 'date');
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Monday/ }));
  await waitFor(() => expect(scoutApi.plan).toHaveBeenCalledWith(expect.objectContaining({ verb: 'snooze', args: { date: '2026-11-23' }, keys: ['todos:t4'] })));
  expect(await screen.findByText('Snoozed until Mon Nov 23: Email the People team.')).toBeInTheDocument();
  expect(screen.queryByRole('menu')).toBeNull();
  // reassign
  scoutApi.plan.mockResolvedValue(CARD('assign', ['Email the People team']));
  fireEvent.click(screen.getByRole('button', { name: 'More for Email the People team' }));
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Reassign/ }));
  expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map(i => i.textContent)).toEqual(['Jacknow', 'Cyrus', 'Unassigned']);
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Cyrus' }));
  await waitFor(() => expect(scoutApi.plan).toHaveBeenLastCalledWith(expect.objectContaining({ verb: 'assign', args: { owner_user_id: 'u2' } })));
  expect(await screen.findByText('Email the People team is now Cyrus’s.')).toBeInTheDocument();
  // Set date on an undated row opens the Due list
  fireEvent.click(within(rowOf('Find the benefits lead')).getByRole('button', { name: 'Set date' }));
  expect(document.querySelector('[data-today-menu]')).toHaveAttribute('data-today-menu', 'due');
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  // a reply nobody answers: Add to-do; a waiting row has no menu and no check
  scoutApi.plan.mockResolvedValue(CARD('reply_todos', ['Crys Pringle']));
  fireEvent.click(screen.getByRole('button', { name: 'More for Reply to Crys Pringle' }));
  expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map(i => i.textContent)).toEqual(['Add to-do']);
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Add to-do' }));
  await waitFor(() => expect(scoutApi.plan).toHaveBeenLastCalledWith(expect.objectContaining({ verb: 'reply_todos', rows: [{ entity: 'people', id: 'prospect:p2', title: 'Crys Pringle', company: null }] })));
  expect(within(rowOf('Waiting on Pat: the signed MSA')).queryByRole('button')).toBeNull();
  expect(within(rowOf('Reply to Crys Pringle')).queryByRole('button', { name: /^Done/ })).toBeNull();
});

test('a refusal says why and writes nothing; the bulk date card under Undated shows Scout\'s confirm card with every row before anything is written', async () => {
  scoutApi.plan.mockResolvedValueOnce({ cant: { reason: 'that to-do is no longer open', pills: [] } });
  await show();
  fireEvent.click(screen.getByRole('button', { name: 'Done: Confirm the December demo time' }));
  expect(await screen.findByText('that to-do is no longer open')).toBeInTheDocument();
  expect(scoutApi.act).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /Undated 6/ }));
  const card = await waitFor(() => { const c = document.querySelector('[data-today-datecard]'); expect(c).not.toBeNull(); return c; });
  expect(card).toHaveTextContent('Set a date on 4 of these');
  scoutApi.plan.mockResolvedValue({ ...CARD('task_due', ['Find the benefits lead', 'Follow up after the pricing visit', 'Confirm']), to: '2026-11-20' });
  scoutApi.act.mockResolvedValue(ACTED(['a', 'b', 'c'], 'Moved 3 of 3'));
  fireEvent.click(within(card).getByRole('button', { name: 'Fri Nov 20' }));
  const confirm = await waitFor(() => { const c = document.querySelector('[data-today-card] [data-scout-confirm]'); expect(c).not.toBeNull(); return c; });
  expect(document.querySelectorAll('[data-scout-card-row]')).toHaveLength(3);
  expect(scoutApi.act).not.toHaveBeenCalled();
  expect(scoutApi.plan).toHaveBeenLastCalledWith(expect.objectContaining({ verb: 'task_due', args: { date: '2026-11-20' } }));
  fireEvent.click(confirm);
  expect(await screen.findByText('Dated 3 to-dos Fri Nov 20.')).toBeInTheDocument();
});

test('the five strip shows only when slots exist, folds and remembers; empty states: nothing ranked, nothing matching', async () => {
  goalsApi.today.mockResolvedValue(view({ strip: [{ slot: 1, id: 'c1', text: 'Send the benefits one-pager', company: 'Northrop Grumman', due: '2026-11-16', late_days: 3 }, { slot: 2, id: 'c2', text: 'Book two meetings', company: null, due: null, late_days: 0 }], five: { used: 2, max: 5 } }));
  const first = await show();
  const strip = screen.getByLabelText('This week’s five');
  expect(strip).toHaveTextContent('2 of 5'); expect(strip).toHaveTextContent('Northrop Grumman · 3 d late'); expect(strip).toHaveTextContent('no company · no date');
  fireEvent.click(within(strip).getByRole('button', { name: 'Hide' }));
  expect(strip.querySelector('[data-today-slot]')).toBeNull();
  expect(localStorage.getItem('prospector_today_strip')).toBe('0');
  first.unmount();
  const v = view(); v.groups = v.groups.map(g => (g.id === 'rest' ? g : { ...g, n: 0, rows: [], fold: null }));
  goalsApi.today.mockResolvedValue(v);
  const second = await show();
  expect(screen.queryByLabelText('This week’s five')).toBeNull();
  expect(document.querySelector('[data-today-empty="ranked"]')).toHaveTextContent('Nothing due, nothing ranked.You have 2 undated to-dos in Everything else.');
  second.unmount();
  const none = view(); none.groups = none.groups.map(g => ({ ...g, n: 0, rows: [], fold: null })); none.counts.shown = 0;
  goalsApi.today.mockResolvedValue(none);
  await show();
  fireEvent.click(screen.getByRole('button', { name: /Overdue/ }));
  await waitFor(() => expect(document.querySelector('[data-today-empty="none"]')).toHaveTextContent('No to-dos match.'));
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  await waitFor(() => expect(goalsApi.today).toHaveBeenLastCalledWith('b1', { owner: 'me' }));
});

test('Viewer: the same list on Team, with no check circle, no ⋯, no verb column and no date card', async () => {
  await show({ canEdit: false });
  expect(goalsApi.today).toHaveBeenCalledWith('b1', {});
  expect(document.querySelector('[data-today-viewer]')).not.toBeNull();
  expect(screen.queryByRole('button', { name: /^Done:/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /^More for/ })).toBeNull();
  expect(document.querySelector('[data-today-verb]')).toBeNull();
  expect(screen.queryByText('Scout can')).toBeNull();
  expect(within(rowOf('Find the benefits lead')).queryByRole('button', { name: 'Set date' })).toBeNull();
  expect(document.querySelectorAll('thead th')).toHaveLength(7);
});

test('phone: one card per row under its group label, Done and ⋯ at 44 px, no table', async () => {
  await show({ compact: true });
  expect(document.querySelector('table')).toBeNull();
  expect([...document.querySelectorAll('section[data-today-group]')].map(g => g.getAttribute('data-today-group'))).toEqual(['due', 'top', 'visited', 'reply', 'rest']);
  const card = rowOf('Send the benefits one-pager');
  expect(card.tagName).toBe('ARTICLE');
  expect(within(card).getByRole('button', { name: 'Done: Send the benefits one-pager' })).toHaveTextContent('Done');
  expect(within(card).getByRole('button', { name: 'More for Send the benefits one-pager' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Search to-dos')).toBeNull();
  expect(screen.getByRole('button', { name: /Show all 2 overdue/ })).toBeInTheDocument();
});

test('Fix the list: at most five fixes, each button Scout\'s confirm card (rows listed, nothing written before Confirm), one Undo; Date with Scout asks the day first; a Viewer reads', async () => {
  const FIXES = { n: 2, today: TODAY, feeds: [], items: [
    { id: 'replies', n: 4, title: '4 replies have no to-do', note: 'People wrote back and nothing on the list answers them.', action: { label: 'Add 4 to-dos', verb: 'reply_todos', rows: [{ entity: 'people', id: 'prospect:p2', title: 'Crys Pringle', company: null }] } },
    { id: 'undated', n: 9, title: '9 of your to-dos have no date', note: 'They sit in Everything else until dated.', action: { label: 'Date with Scout', verb: 'task_due', needs: 'date', rows: [{ entity: 'todos', id: 't1', title: 'Read the S-1' }] } },
  ] };
  goalsApi.todayFixes.mockResolvedValue(FIXES);
  scoutApi.plan.mockResolvedValue(CARD('reply_todos', ['Crys Pringle']));
  scoutApi.act.mockResolvedValue(ACTED(['Crys Pringle'], 'Added 1'));
  scoutApi.undo.mockResolvedValue({ line: 'undone', rows: [] });
  const onCount = jest.fn();
  const r = render(<TodayFixes businessId="b1" canEdit onCount={onCount} />);
  expect(await screen.findByText('4 replies have no to-do')).toBeInTheDocument();
  expect(onCount).toHaveBeenCalledWith(2);
  expect(screen.getByLabelText('Fix the list')).toHaveTextContent('The 2 things most worth fixing, worst first. Never more than five.');
  fireEvent.click(screen.getByRole('button', { name: 'Add 4 to-dos' }));
  const confirm = await waitFor(() => { const c = document.querySelector('[data-scout-confirm]'); expect(c).not.toBeNull(); return c; });
  expect(scoutApi.act).not.toHaveBeenCalled();
  fireEvent.click(confirm);
  expect(await screen.findByText('Added 1 to-do.', { exact: false })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Undo 10 s/ }));
  await waitFor(() => expect(scoutApi.undo).toHaveBeenCalledWith({ plan_id: 'pl1' }));
  // the date first, then the card
  scoutApi.plan.mockResolvedValue(CARD('task_due', ['Read the S-1']));
  fireEvent.click(screen.getByRole('button', { name: 'Date with Scout' }));
  expect(scoutApi.plan).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Mon Nov 23' }));
  await waitFor(() => expect(scoutApi.plan).toHaveBeenLastCalledWith(expect.objectContaining({ verb: 'task_due', args: { date: '2026-11-23' }, keys: ['todos:t1'] })));
  r.unmount();
  render(<TodayFixes businessId="b1" canEdit={false} />);
  expect(await screen.findByText('4 replies have no to-do')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add 4 to-dos' })).toBeNull();
});
