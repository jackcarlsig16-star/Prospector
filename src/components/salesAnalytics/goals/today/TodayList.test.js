import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import TodayList from './TodayList';
import TodayFixes from './TodayFixes';
import { goalsApi } from '../goalsApi';
import { scoutApi } from '../../../scout/scoutApi';
import { dueWords, doneWords, nextMonday, snoozeChoices, bulkDates, scoutRow, todayQuery, SOURCE, queueWork, readLine } from './todayRows';

// actions-v2 Stage 2 - the Today list, one test per state of the mockups: the groups and their rows, the overdue
// fold, Everything else collapsed, chips / source / search, the five strip, the check circle and the ⋯ menu through
// Scout's plan -> act -> undo, the bulk-date card, the empty states, the Viewer, the phone list, and Fix the list.
// Made-up rows; names, titles and companies only - no address or phone anywhere.
jest.mock('../goalsApi', () => ({ ...jest.requireActual('../goalsApi'), goalsApi: { today: jest.fn(), todayFixes: jest.fn(), todayWork: jest.fn() } }));
jest.mock('../priorities/ComposePanel', () => ({ row }) => <div data-compose-stub>{row.name} · {row.to} · {row.prefill.subject} · {row.prefill.body}</div>);
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
  // a waiting row is read-only (R8): its verb opens the panel, nothing else
  expect(within(rowOf('Waiting on Pat: the signed MSA')).getAllByRole('button').map(b => b.className)).toEqual(['td-vb']);
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
  expect(onCount).toHaveBeenCalledWith(2, []);
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

// --- Stage 3: the work panel ---
const GROUNDS = [{ id: 'G1', kind: 'activity', text: 'Dana Mayer: 2 sent, 1 opened, 0 clicked, 0 replied; last opened Nov 12' }, { id: 'G2', kind: 'nba', rule: 'follow_up_clicked', text: 'Follow up: they opened twice' }, { id: 'G3', kind: 'note', text: 'Call note Nov 9 (Intro): they asked about cost' }];
const PACK = { records: 1, asks: [{ id: 'sequence', label: 'Write a 3-touch sequence', text: 'Question: Write a 3-touch outreach sequence\nCloudflare · employer · P1 65', chars: 71 }, { id: 'research', label: 'Research the account', text: 'Question: Research this account\nCloudflare · employer', chars: 53 }, { id: 'call', label: 'Prep me for a call', blocked: true }] };
const WORK = (over = {}) => ({ key: 'todo:t4', verb: 'draft_email', row: { text: 'Email the People team', company: { type: 'employer', id: 'c1', name: 'Cloudflare' }, person: { key: 'prospect:p1', name: 'Dana Mayer', title: 'VP People' } }, grounds: GROUNDS,
  steps: [{ text: 'Follow up — they clicked', ground: 'G2', based_on: 'Follow up: they opened twice', source: 'rule' }, { text: 'Answer the cost question from the intro call', ground: 'G3', based_on: 'Call note Nov 9 (Intro): they asked about cost', source: 'model' }],
  draft: { to: { name: 'Dana Mayer', title: 'VP People', company: 'Cloudflare' }, tone: null, subject: 'A home benefit for the Cloudflare team', body: 'Hi Dana,\n\nOne line.\n\nJack', lint: { ok: true, issues: 0 } },
  prompt_pack: PACK, usage: { calls: 1, cost_usd: 0.0183, cap: { used: 4, max: 30 } }, ...over });
const verbOf = text => within(rowOf(text)).getByRole('button', { name: new RegExp(`^(Draft email|Draft reply|Prep call|Find people|Next steps): ${text}`) });
const panel = () => document.querySelector('[data-work]');
let clip;
beforeEach(() => { clip = jest.fn().mockResolvedValue(); Object.assign(navigator, { clipboard: { writeText: clip } }); });

test('D30 / D32 / D43: nothing is generated until the verb is clicked; the verb is a button that opens ONE panel under its row, filled while open; Esc and Close shut it and the focus returns', async () => {
  let release; goalsApi.todayWork.mockReturnValue(new Promise(r => { release = r; }));
  await show();
  expect(goalsApi.todayWork).not.toHaveBeenCalled();
  const verb = verbOf('Email the People team');
  expect(verb).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(verb);
  expect(goalsApi.todayWork).toHaveBeenCalledWith('b1', 'todo:t4', { verb: 'draft_email' });
  // D38 working: the panel is up at once, "Reading <company>…", skeletons, no draft yet
  expect(panel()).toHaveAttribute('data-work', 'working');
  expect(panel()).toHaveTextContent('Reading Cloudflare…');
  expect(panel().querySelectorAll('.td-sk').length).toBeGreaterThanOrEqual(6);
  expect(verb).toHaveAttribute('aria-expanded', 'true');
  expect(document.querySelector('[data-today-work="todo:t4"]').previousSibling).toBe(rowOf('Email the People team'));
  await act(async () => { release(WORK()); });
  expect(panel()).toHaveAttribute('data-work', 'ready');
  // one panel at a time
  goalsApi.todayWork.mockResolvedValue(WORK({ key: 'todo:t6', verb: 'draft_email' }));
  fireEvent.click(verbOf('Follow up after the pricing visit'));
  await waitFor(() => expect(document.querySelectorAll('[data-today-work]').length).toBe(1));
  expect(document.querySelector('[data-today-work]')).toHaveAttribute('data-today-work', 'todo:t6');
  fireEvent.keyDown(panel(), { key: 'Escape' });
  expect(panel()).toBeNull();
  await waitFor(() => expect(verbOf('Follow up after the pricing visit')).toHaveFocus());
  fireEvent.click(verbOf('Email the People team'));
  await waitFor(() => expect(panel()).toHaveAttribute('data-work', 'ready'));
  fireEvent.click(within(panel()).getByRole('button', { name: 'Close' }));
  expect(panel()).toBeNull();
});

test('D33 the three panes of Draft email: steps with what each is based on, the draft To (name · title, company - never an address) with the Q8 buttons, the Claude prompt with its real length; the cost comes from the usage row', async () => {
  goalsApi.todayWork.mockResolvedValue(WORK());
  await show();
  fireEvent.click(verbOf('Email the People team'));
  await waitFor(() => expect(panel()).toHaveAttribute('data-work', 'ready'));
  const p = within(panel());
  const steps = [...panel().querySelectorAll('[data-work-step]')];
  expect(steps.map(x => x.textContent)).toEqual(['1Follow up — they clickedFollow up: they opened twiceUse draft', '2Answer the cost question from the intro callCall note Nov 9 (Intro): they asked about costAdd to-do']);
  expect(panel().querySelector('[data-work-to]')).toHaveTextContent('Dana Mayer · VP People, Cloudflare');
  expect(panel().querySelector('[data-work-subject]')).toHaveTextContent('A home benefit for the Cloudflare team');
  expect(p.getByLabelText('Draft body')).toHaveValue('Hi Dana,\n\nOne line.\n\nJack');
  expect([...panel().querySelector('[data-work-pane="middle"]').querySelectorAll('button')].map(b => b.textContent)).toEqual(['Copy', 'Open in Write email', 'Shorter', 'Warmer', 'Try again']);
  expect(p.queryByText(/mail draft/i)).toBeNull();
  expect(p.getByText('Nothing is sent from Prospector')).toBeInTheDocument();
  // Use draft puts the cursor in the draft
  fireEvent.click(p.getByRole('button', { name: 'Use draft' }));
  await waitFor(() => expect(p.getByLabelText('Draft body')).toHaveFocus());
  // the Claude pane: three asks, the preview, the real length; a blocked ask is not copied and says so
  expect(panel().querySelector('[data-work-prompt]')).toHaveTextContent('Question: Write a 3-touch outreach sequence');
  expect(panel().querySelector('[data-work-chars]')).toHaveTextContent('71');
  fireEvent.click(p.getByRole('button', { name: 'Research the account' }));
  expect(panel().querySelector('[data-work-chars]')).toHaveTextContent('53');
  fireEvent.click(p.getByRole('button', { name: 'Copy prompt' }));
  await waitFor(() => expect(clip).toHaveBeenCalledWith('Question: Research this account\nCloudflare · employer'));
  expect(await screen.findByText('Prompt copied · 53 characters.')).toBeInTheDocument();
  fireEvent.click(p.getByRole('button', { name: 'Prep me for a call' }));
  expect(panel().querySelector('[data-work-pack-blocked]')).toHaveTextContent('Not copied: the pack still held an address or phone shape.');
  expect(p.queryByRole('button', { name: 'Copy prompt' })).toBeNull();
  expect(panel().querySelector('[data-work-read]')).toHaveTextContent('The to-do · Cloudflare’s record · the person’s email activity · 1 call note');
  expect(panel().querySelector('[data-work-cost]')).toHaveTextContent('$0.018 · Write email 4 of 30 today');
  expect(panel().textContent).not.toMatch(/@/);
  expect(readLine({ grounds: [] }, { company: null })).toBe('The to-do');
});

test('D37 Copy never marks done: the line offers Done; Shorter / Warmer / Try again re-call with the tone; Open in Write email opens the panel with THAT draft, as edited', async () => {
  goalsApi.todayWork.mockResolvedValue(WORK());
  scoutApi.plan.mockResolvedValue(CARD('task_done', ['Email the People team']));
  scoutApi.act.mockResolvedValue(ACTED(['Email the People team'], 'Marked done 1'));
  await show();
  fireEvent.click(verbOf('Email the People team'));
  await waitFor(() => expect(panel()).toHaveAttribute('data-work', 'ready'));
  const p = within(panel());
  fireEvent.change(p.getByLabelText('Draft body'), { target: { value: 'Hi Dana,\n\nEdited.\n\nJack' } });
  fireEvent.click(p.getByRole('button', { name: 'Copy' }));
  await waitFor(() => expect(clip).toHaveBeenCalledWith('Subject: A home benefit for the Cloudflare team\n\nHi Dana,\n\nEdited.\n\nJack\n'));
  const toast = await waitFor(() => { const t = document.querySelector('[data-today-toast="copied"]'); expect(t).not.toBeNull(); return t; });
  expect(toast).toHaveTextContent('Draft copied. Mark it done when it’s sent.');
  expect(scoutApi.plan).not.toHaveBeenCalled();
  fireEvent.click(p.getByRole('button', { name: 'Open in Write email' }));
  expect(document.querySelector('[data-compose-stub]')).toHaveTextContent('Cloudflare · Dana Mayer · A home benefit for the Cloudflare team · Hi Dana, Edited. Jack');
  fireEvent.click(p.getByRole('button', { name: 'Shorter' }));
  expect(goalsApi.todayWork).toHaveBeenLastCalledWith('b1', 'todo:t4', { verb: 'draft_email', tone: 'shorter' });
  await waitFor(() => expect(panel()).toHaveAttribute('data-work', 'ready'));
  fireEvent.click(within(panel()).getByRole('button', { name: 'Warmer' }));
  expect(goalsApi.todayWork).toHaveBeenLastCalledWith('b1', 'todo:t4', { verb: 'draft_email', tone: 'warmer' });
  await waitFor(() => expect(panel()).toHaveAttribute('data-work', 'ready'));
  fireEvent.click(within(panel()).getByRole('button', { name: 'Try again' }));
  expect(goalsApi.todayWork).toHaveBeenLastCalledWith('b1', 'todo:t4', { verb: 'draft_email' });
  expect(goalsApi.todayWork).toHaveBeenCalledTimes(4);
  // Done on the copied line is the to-do's own Done (Scout's verb), nothing more
  fireEvent.click(within(toast).getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(scoutApi.plan).toHaveBeenCalledWith(expect.objectContaining({ verb: 'task_done', keys: ['todos:t4'] })));
});

test('D38 failure: the pane says what failed and offers Try again; the Claude pane still works; a withheld draft says why; the daily cap offers no retry', async () => {
  goalsApi.todayWork.mockResolvedValue({ key: 'todo:t4', verb: 'draft_email', grounds: GROUNDS, steps: [], prompt_pack: PACK, failed: { status: 502, error: 'The draft failed: timeout' } });
  await show();
  fireEvent.click(verbOf('Email the People team'));
  await waitFor(() => expect(panel()).toHaveAttribute('data-work', 'failed'));
  expect(panel().querySelector('[data-work-failed]')).toHaveTextContent('The draft failed: timeout');
  expect(panel().querySelector('[data-work-nosteps]')).toHaveTextContent('No steps: the call did not finish.');
  expect(panel().querySelector('[data-work-prompt]')).toHaveTextContent('Question: Write a 3-touch outreach sequence');
  goalsApi.todayWork.mockResolvedValue(WORK({ steps: [], note: 'Nothing to suggest beyond the draft.', draft: { to: { name: 'Dana Mayer', title: null, company: 'Cloudflare' }, withheld: true, reason: 'Draft withheld: it held an address or phone shape. Try again.' } }));
  fireEvent.click(within(panel().querySelector('[data-work-failed]')).getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(panel().querySelector('[data-work-withheld]')).not.toBeNull());
  expect(panel().querySelector('[data-work-withheld]')).toHaveTextContent('Draft withheld: it held an address or phone shape.');
  expect(within(panel()).queryByRole('button', { name: 'Copy' })).toBeNull();
  expect(panel().querySelector('[data-work-nosteps]')).toHaveTextContent('Nothing to suggest beyond the draft.');
  goalsApi.todayWork.mockResolvedValue({ failed: { status: 429, error: 'Write email cap reached (30 per day for this workspace)' }, prompt_pack: PACK, grounds: [] });
  fireEvent.click(within(panel().querySelector('[data-work-withheld]')).getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(panel().querySelector('[data-work-failed]')).toHaveTextContent('Write email cap reached'));
  expect(within(panel().querySelector('[data-work-failed]')).queryByRole('button')).toBeNull();
  // a network failure is said too
  goalsApi.todayWork.mockRejectedValue(new Error('Failed to fetch'));
  fireEvent.click(within(panel()).getByRole('button', { name: 'Close' }));
  fireEvent.click(verbOf('Email the People team'));
  await waitFor(() => expect(panel().querySelector('[data-work-failed]')).toHaveTextContent('Failed to fetch'));
  expect(panel().querySelector('[data-work-nopack]')).not.toBeNull();
});

test('D40 the five verbs: Prep call shows a brief, Find people lists the stored people with Add and Draft (no search), Next steps has no middle pane; Draft reply is a draft', async () => {
  const v = view();
  v.groups[1].rows[1] = { ...v.groups[1].rows[1], verb: 'find_people' };
  v.groups[0].rows[2] = { ...v.groups[0].rows[2], verb: 'next_steps' };
  v.groups[2].rows[0] = { ...v.groups[2].rows[0], verb: 'prep_call' };
  goalsApi.today.mockResolvedValue(v);
  await show();
  // Prep call
  goalsApi.todayWork.mockResolvedValue(WORK({ key: 'todo:t6', verb: 'prep_call', draft: undefined, brief: { text: 'Who: Qubika.\nWhy now: 4 visits.\nAsk: three questions.' } }));
  fireEvent.click(verbOf('Follow up after the pricing visit'));
  await waitFor(() => expect(panel()).toHaveAttribute('data-work', 'ready'));
  expect(panel().querySelector('[data-work-brief]')).toHaveTextContent('Who: Qubika. Why now: 4 visits.');
  expect(within(panel()).queryByLabelText('Draft body')).toBeNull();
  fireEvent.click(within(panel().querySelector('[data-work-pane="middle"]')).getByRole('button', { name: 'Copy' }));
  await waitFor(() => expect(clip).toHaveBeenCalledWith('Who: Qubika.\nWhy now: 4 visits.\nAsk: three questions.'));
  expect(await screen.findByText('Brief copied. Mark it done when it’s sent.')).toBeInTheDocument();
  // Find people: stored people only; Draft re-calls for that person, Add is Scout's Add task card for them
  goalsApi.todayWork.mockResolvedValue(WORK({ key: 'todo:t5', verb: 'find_people', draft: undefined, steps: [], usage: { calls: 0, cost_usd: null, cap: null }, people: [{ key: 'person:x1', name: 'Frank Wagner', title: 'Benefits Manager', heat: 12, heat_band: 'warm', buyer: true }, { key: 'person:x2', name: 'Mo Earley', title: null, heat: null, heat_band: null, buyer: false }] }));
  fireEvent.click(verbOf('Find the benefits lead'));
  await waitFor(() => expect(panel().querySelectorAll('[data-work-person]').length).toBe(2));
  expect(panel().querySelector('[data-work-person="person:x1"]')).toHaveTextContent(/^Frank Wagner.*Benefits Manager · a buyer title/);
  expect(panel().querySelector('[data-work-person="person:x2"]')).toHaveTextContent('no title stored');
  expect(panel().querySelector('[data-work-cost]')).toBeNull();
  scoutApi.plan.mockResolvedValue({ ...CARD('add_task', ['Reach out to Frank Wagner']), fields: { task: 'Reach out to Frank Wagner', linked_to: 'Flowserve', linked_detail: 'Employer', owner: 'Jack', due: TODAY, due_note: 'no date said - due today' } });
  fireEvent.click(within(panel()).getByRole('button', { name: 'Add a to-do for Frank Wagner' }));
  await waitFor(() => expect(scoutApi.plan).toHaveBeenLastCalledWith(expect.objectContaining({ verb: 'add_task', text: 'add a task to reach out to Frank Wagner', keys: ['people:person:x1'] })));
  // the card shows inside the panel, nothing written before Confirm
  await waitFor(() => expect(panel().querySelector('[data-scout-taskcard]')).not.toBeNull());
  expect(scoutApi.act).not.toHaveBeenCalled();
  goalsApi.todayWork.mockResolvedValue(WORK({ key: 'todo:t5' }));
  fireEvent.click(within(panel()).getByRole('button', { name: 'Draft an email to Frank Wagner' }));
  expect(goalsApi.todayWork).toHaveBeenLastCalledWith('b1', 'todo:t5', { verb: 'draft_email', person: { key: 'person:x1' } });
  await waitFor(() => expect(within(panel()).getByLabelText('Draft body')).toBeInTheDocument());
  // Next steps: two panes, the steps wide; a step's Add to-do is the same card, linked to nothing here
  goalsApi.todayWork.mockResolvedValue(WORK({ key: 'todo:t3', verb: 'next_steps', draft: undefined, steps: [], note: 'Nothing stored to base a step on - link this to-do to a company or a person first.', prompt_pack: null, grounds: [], usage: { calls: 0, cost_usd: null, cap: null } }));
  fireEvent.click(verbOf('Confirm the December demo time'));
  await waitFor(() => { expect(panel()).toHaveAttribute('data-work-verb', 'next_steps'); expect(panel()).toHaveAttribute('data-work', 'ready'); });
  expect(panel().querySelector('[data-work-pane="middle"]')).toBeNull();
  expect(panel().querySelector('.td-panes--two')).not.toBeNull();
  expect(panel().querySelector('[data-work-nosteps]')).toHaveTextContent('Nothing stored to base a step on');
  expect(panel().querySelector('[data-work-nopack]')).not.toBeNull();
  // Draft reply on a virtual reply row: a draft; the footer offers Add to-do, not Done
  goalsApi.todayWork.mockResolvedValue(WORK({ key: 'reply:prospect:p2', verb: 'draft_reply' }));
  fireEvent.click(verbOf('Reply to Crys Pringle'));
  await waitFor(() => { expect(panel()).toHaveAttribute('data-work-verb', 'draft_reply'); expect(panel()).toHaveAttribute('data-work', 'ready'); });
  expect(within(panel()).getByText('Draft · reply')).toBeInTheDocument();
  expect(within(panel()).queryByRole('button', { name: 'Done' })).toBeNull();
  expect(within(panel()).getByRole('button', { name: 'Add to-do' })).toBeInTheDocument();
});

test('R4 finishing: "Done and mark <person> contacted" is ONE Scout verb (task_finish) acted at once, one Undo; the row leaves and takes its panel; a row with no person offers Done only', async () => {
  goalsApi.todayWork.mockResolvedValue(WORK());
  scoutApi.plan.mockResolvedValue(CARD('task_finish', ['Email the People team']));
  scoutApi.act.mockResolvedValue({ ...ACTED(['Email the People team'], 'Finished 1'), rows: [{ key: 'todos:t4', title: 'Email the People team', ok: true, error: null, to: 'done · Dana Mayer contacted' }] });
  scoutApi.undo.mockResolvedValue({ line: 'undone', rows: [] });
  await show();
  fireEvent.click(verbOf('Email the People team'));
  await waitFor(() => expect(panel()).toHaveAttribute('data-work', 'ready'));
  expect(within(panel()).getByText('Sent it yourself?')).toBeInTheDocument();
  const gone = view(); gone.groups[1].rows = gone.groups[1].rows.slice(1);
  goalsApi.today.mockResolvedValue(gone);
  fireEvent.click(within(panel()).getByRole('button', { name: 'Done and mark Dana contacted' }));
  await waitFor(() => expect(scoutApi.act).toHaveBeenCalledWith({ plan_id: 'pl1' }));
  expect(scoutApi.plan).toHaveBeenCalledWith(expect.objectContaining({ verb: 'task_finish', keys: ['todos:t4'] }));
  expect(await screen.findByText('Done: Email the People team. Dana Mayer marked contacted.')).toBeInTheDocument();
  await waitFor(() => expect(panel()).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: /Undo 10 s/ }));
  await waitFor(() => expect(scoutApi.undo).toHaveBeenCalledWith({ plan_id: 'pl1' }));
  expect(scoutApi.undo).toHaveBeenCalledTimes(1);
  // no person on the row: Done only
  goalsApi.todayWork.mockResolvedValue(WORK({ key: 'todo:t6' }));
  fireEvent.click(verbOf('Follow up after the pricing visit'));
  await waitFor(() => expect(panel()).toHaveAttribute('data-work', 'ready'));
  expect(within(panel()).getByRole('button', { name: 'Done' })).toBeInTheDocument();
  expect(within(panel()).queryByRole('button', { name: /mark .* contacted/ })).toBeNull();
});

test('D41 Scout opens the same panel on a row: the ask is held until the list is up, moves to Team when the row is not one of mine, and says so when the row is gone', async () => {
  goalsApi.todayWork.mockResolvedValue(WORK({ verb: 'next_steps', draft: undefined }));
  queueWork({ key: 'todo:t4', verb: 'next_steps' });
  await show();
  await waitFor(() => expect(goalsApi.todayWork).toHaveBeenCalledWith('b1', 'todo:t4', { verb: 'next_steps' }));
  await waitFor(() => expect(panel()).toHaveAttribute('data-work-verb', 'next_steps'));
  // while the list is on screen; verb null = the row's own verb; a row that is not mine is looked for under Team
  goalsApi.today.mockImplementation(async (_b, q) => (q.owner === 'me' ? view({ groups: view().groups.map(g => ({ ...g, rows: [], n: 0, fold: null })) }) : view()));
  fireEvent.click(screen.getByRole('button', { name: /^Team/ }));
  fireEvent.click(screen.getByRole('button', { name: /^Mine/ }));
  await waitFor(() => expect(document.querySelector('[data-today-empty]')).not.toBeNull());
  goalsApi.todayWork.mockClear();
  act(() => queueWork({ key: 'todo:t6', verb: null }));
  await waitFor(() => expect(goalsApi.todayWork).toHaveBeenCalledWith('b1', 'todo:t6', { verb: 'draft_email' }));
  expect(document.querySelector('[data-today]')).toHaveAttribute('data-today', 'team');
  act(() => queueWork({ key: 'todo:nope', verb: null }));
  expect(await screen.findByText('That to-do is not on the list any more.')).toBeInTheDocument();
});

test('D42 phone: the card has the verb (flex, 44 px), Done and ⋯; the verb opens a full-height sheet with Draft · Next steps · n · Claude tabs, Copy + Open in Write email, then Done and mark contacted', async () => {
  goalsApi.todayWork.mockResolvedValue(WORK());
  await show({ compact: true });
  const card = rowOf('Email the People team');
  expect([...card.querySelector('.td-pact').children].map(b => b.className)).toEqual(['td-vb', 'td-dn', 'td-mb']);
  fireEvent.click(verbOf('Email the People team'));
  const sheet = await waitFor(() => { const s = document.querySelector('[data-work-sheet] [role="dialog"]'); expect(s).toHaveAttribute('data-work', 'ready'); return s; });
  expect(sheet).toHaveAttribute('aria-modal', 'true');
  expect(sheet).toHaveAccessibleName('Draft email: Email the People team');
  expect(within(sheet).getAllByRole('tab').map(t => [t.textContent, t.getAttribute('aria-selected')])).toEqual([['Draft', 'true'], ['Next steps · 2', 'false'], ['Claude', 'false']]);
  expect(within(sheet).getByLabelText('Draft body')).toBeInTheDocument();
  expect(within(sheet).getByText('Nothing is sent')).toBeInTheDocument();
  expect([...sheet.querySelectorAll('.td-big')].map(b => b.textContent)).toEqual(['Copy', 'Open in Write email', 'Done', 'Done and mark Dana contacted']);
  expect([...sheet.querySelectorAll('[data-work-tone], [data-work-again]')].map(b => b.textContent)).toEqual(['Shorter', 'Warmer', 'Try again']);
  fireEvent.click(within(sheet).getByRole('tab', { name: 'Next steps · 2' }));
  expect(sheet.querySelectorAll('[data-work-step]').length).toBe(2);
  expect(within(sheet).queryByLabelText('Draft body')).toBeNull();
  fireEvent.click(within(sheet).getByRole('tab', { name: 'Claude' }));
  expect(sheet.querySelector('[data-work-prompt]')).not.toBeNull();
  fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
  expect(document.querySelector('[data-work-sheet]')).toBeNull();
});

test('P3 numbering: the rows shown read 1…n; the folded overdue rows take the numbers after group 1 when the fold opens. R2: "Add to this week\'s five" and a slot\'s remove show only once the data-keys migration has run. R1: bulk drop is Scout\'s card', async () => {
  const v = view();
  const [old, a, b] = v.groups[0].rows;
  v.groups[0].rows = [{ ...a, rank: 1, rank_open: 1 }, { ...b, rank: 2, rank_open: 2 }, { ...old, rank: null, rank_open: 3 }];
  let k = 2, o = 3;
  for (const g of v.groups.slice(1)) g.rows = g.rows.map(r => ({ ...r, rank: ++k, rank_open: ++o }));
  v.groups[4].rows = v.groups[4].rows.map((r, i) => ({ ...r, stale: i === 1 }));
  goalsApi.today.mockResolvedValue(v);
  const nums = () => [...document.querySelectorAll('[data-today-row] .td-rk')].map(x => x.textContent);
  await show();
  expect(nums()).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  fireEvent.click(document.querySelector('[data-today-fold]'));
  expect(nums()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
  expect(within(rowOf('Old overdue A')).getByText('3')).toBeInTheDocument();
  expect(within(rowOf('Email the People team')).getByText('4')).toBeInTheDocument();
  // before the migration: no five item in the menu
  fireEvent.click(within(rowOf('Email the People team')).getByRole('button', { name: /^More for/ }));
  expect(within(screen.getByRole('menu')).queryByRole('menuitem', { name: 'Add to this week’s five' })).toBeNull();
  fireEvent.keyDown(window, { key: 'Escape' });
  // bulk drop sits in Everything else: the card first, 0 writes
  fireEvent.click(screen.getByRole('button', { name: /Everything else/ }));
  expect(document.querySelector('[data-today-stale]')).toHaveTextContent('1 here has not been touched in 30 days or more');
  scoutApi.plan.mockResolvedValue(CARD('task_drop', ['Read the S-1']));
  fireEvent.click(document.querySelector('[data-today-bulkdrop]'));
  await waitFor(() => expect(scoutApi.plan).toHaveBeenLastCalledWith(expect.objectContaining({ verb: 'task_drop', keys: ['todos:t10'] })));
  await waitFor(() => expect(document.querySelector('[data-scout-confirm]')).not.toBeNull());
  expect(scoutApi.act).not.toHaveBeenCalled();
  // after the migration
  goalsApi.today.mockResolvedValue({ ...v, five: { used: 1, max: 5, can_add: true }, strip: [{ slot: 1, id: 'c1', todo_id: 't9', text: 'Draft the partner recap', company: null, due: null, late_days: 0 }] });
  scoutApi.plan.mockResolvedValue(CARD('five_add', ['Email the People team']));
  scoutApi.act.mockResolvedValue(ACTED(['Email the People team'], 'Added 1'));
  fireEvent.click(screen.getByRole('button', { name: /^Team/ }));
  await waitFor(() => expect(document.querySelector('[data-today-slot-remove]')).not.toBeNull());
  fireEvent.click(within(rowOf('Email the People team')).getByRole('button', { name: /^More for/ }));
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Add to this week’s five' }));
  await waitFor(() => expect(scoutApi.plan).toHaveBeenLastCalledWith(expect.objectContaining({ verb: 'five_add', keys: ['todos:t4'] })));
  expect(await screen.findByText('Added to this week’s five: Email the People team.')).toBeInTheDocument();
  scoutApi.plan.mockResolvedValue(CARD('five_remove', ['Draft the partner recap']));
  fireEvent.click(screen.getByRole('button', { name: 'Remove from this week’s five: Draft the partner recap' }));
  await waitFor(() => expect(scoutApi.plan).toHaveBeenLastCalledWith(expect.objectContaining({ verb: 'five_remove', keys: ['todos:t9'] })));
});
