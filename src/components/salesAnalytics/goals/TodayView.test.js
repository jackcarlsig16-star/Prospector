import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { buildTaskGroups } from '../tasks/taskGroups';
import { laWeekStart } from '../periods';
import { memberLookup, addDays, weekLabel } from './goalsUi';
import { yourDaySections, pickNewestFinal, teamToday, topOfList, pipelineMoves } from './todayModel';
import { YourDay } from './TodayView';
import TodayViewer from './TodayViewer';
import GoalsTab from './GoalsTab';
import { goalsApi } from './goalsApi';
import { fetchMe } from '../../../utils/authSession';
import { completeFlag, announceFlagsChanged } from '../huddleApi';

// sales-ia-v1 Stage 2 - Today. No contact names, emails or phones in fixtures.
const WEEK = laWeekStart();
const TODAY = addDays(WEEK, 2);
const members = [{ user_id: 'u-jack', name: 'Jack Carlson' }, { user_id: 'u-cyrus', name: 'Cyrus Lee' }];
const lookup = memberLookup(members);
const links = { labelFor: (type, id) => `${type}:${id}`, load: () => {} };
const todo = (id, extra) => ({ id, text: `Todo ${id}`, owner_user_id: 'u-jack', contacts: [], steps: [], status: 'open', week_start: WEEK, created_by: 'u-jack', created_at: '2026-10-12T10:00:00Z', ...extra });
const todos = [
  todo('late', { due_date: addDays(TODAY, -2) }),
  todo('today', { due_date: TODAY, link_type: 'partner', link_id: 'p1' }),
  todo('done-today', { due_date: TODAY, status: 'done' }),
  todo('later', { due_date: addDays(TODAY, 3) }),
  todo('cyrus-today', { due_date: TODAY, owner_user_id: 'u-cyrus' }),
  todo('nodate'),
];
const flags = [{ ...todo('flag', { owner_user_id: 'u-jack', prospect_contact_id: 'pc1', flagged_by: 'u-cyrus', flag_note: 'opened 3x', contacts: ['Benefits lead'] }) }];

jest.mock('./goalsApi', () => {
  const week = jest.requireActual('../periods').laWeekStart();
  const resolved = { members: [{ user_id: 'u-jack', name: 'Jack Carlson' }, { user_id: 'u-cyrus', name: 'Cyrus Lee' }], partners: [], weekPlans: [], companies: { companies: [] }, cadences: [] };
  return {
    TODOS_CHANGED: 'todos', OPEN_TASKS: 'tasks', OPEN_GOALS_WEEK: 'open-week',
    goalsApi: new Proxy({}, { get: (_, k) => {
      if (k === 'apolloCsvUrl') return () => '';
      if (k === 'weekGoals') return (id, from, to, kind) => Promise.resolve(kind === 'todo' ? global.__todos || [] : global.__commitments || []);
      if (k === 'report') return (id, w) => Promise.resolve({ report: w === week ? { status: 'draft' } : { status: 'final', finalized_by: 'u-jack', finalized_at: '2026-10-12T16:00:00Z' } });
      if (k === 'partnerEvents') return () => Promise.resolve([]);
      if (k === 'updateWeekGoal') return global.__update || (() => Promise.resolve({}));
      return () => (k in resolved ? Promise.resolve(resolved[k]) : new Promise(() => {}));
    } }),
  };
});
jest.mock('../pipelineApi', () => ({ fetchOpportunities: () => Promise.resolve([]), fetchMovement: () => Promise.resolve({ moved_forward: [{ id: 'o1', organization: 'Northwind Benefits', stage: 'meeting', updated_at: '2026-10-14T10:00:00Z' }], moved_back: [], added: [], lost: [], stalled: [] }) }));
jest.mock('../huddleApi', () => ({ fetchFlags: () => Promise.resolve(global.__flags || []), completeFlag: jest.fn(() => Promise.resolve({})), announceFlagsChanged: jest.fn(), FLAGS_CHANGED: 'flags' }));
jest.mock('../../../utils/authSession', () => ({ fetchMe: jest.fn() }));
jest.mock('../../../utils/useMediaQuery', () => () => false);

const groups = filter => buildTaskGroups({ todos, flags, filter, meId: 'u-jack', today: TODAY });
const ids = items => items.map(t => t.id);

test('Your-day sections come from buildTaskGroups output: overdue, due today (open + ticked today), flagged', () => {
  const s = yourDaySections(groups('me'), TODAY);
  expect(s.map(x => x.id)).toEqual(['overdue', 'due', 'flagged']);
  expect(ids(s[0].items)).toEqual(['late']);
  expect(ids(s[1].items)).toEqual(['today', 'done-today']);
  expect(ids(s[2].items)).toEqual(['flag']);
  const team = yourDaySections(groups('team'), TODAY, { forMe: false });
  expect(ids(team[1].items)).toEqual(['today', 'cyrus-today', 'done-today']);
  expect(team[2].label).toBe('Flagged');
  expect(teamToday(members, groups, TODAY)).toEqual([
    { member: members[0], overdue: 1, due: 1, flags: 1 }, { member: members[1], overdue: 0, due: 1, flags: 0 }]);
  expect(ids(topOfList(groups('team'), TODAY))).toEqual(['today', 'cyrus-today', 'late']);
});

test('hidden sections stay hidden: no Follow-ups due, no Research ready, the chip slot stays empty', () => {
  render(<YourDay sections={yourDaySections(groups('me'), TODAY)} today={TODAY} lookup={lookup} links={links} canEdit onDone={jest.fn()} onContacted={jest.fn()} onAllTasks={jest.fn()} />);
  expect(screen.getByText('3 things')).toBeTruthy();
  expect(screen.getByText('! Overdue')).toBeTruthy();
  expect(screen.getByText('Due today')).toBeTruthy();
  expect(screen.getByText('⚑ Flagged for you')).toBeTruthy();
  expect(screen.queryByText(/Follow-ups/)).toBeNull();
  expect(screen.queryByText(/Research ready/)).toBeNull();
  expect(document.querySelector('[data-today-chips]').children).toHaveLength(0);
  // Never color-only: late text, a struck row with a check, the flag glyph + Mark contacted.
  expect(screen.getByText(/2d late/)).toBeTruthy();
  expect(within(document.querySelector('[data-task-id="done-today"]')).getByLabelText('done')).toBeTruthy();
  expect(screen.getByText('partner:p1')).toBeTruthy();
  expect(screen.getByText(/Flagged by Cyrus · “opened 3x”/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Mark contacted' })).toBeTruthy();
});

test('a tick uses the Tasks drawer path and Mark contacted the Huddle path', async () => {
  global.__todos = todos; global.__flags = flags; global.__commitments = [];
  global.__update = jest.fn(() => Promise.resolve({}));
  fetchMe.mockResolvedValue({ profile: { id: 'u-jack' }, memberships: [{ business_id: 'b1', role: 'member' }] });
  render(<GoalsTab businessId="b1" section="actions" view={null} onNav={jest.fn()} />);
  await screen.findByText('Your day');
  await screen.findByText('Todo late');
  fireEvent.click(screen.getByRole('button', { name: 'Done: Todo late' }));
  await waitFor(() => expect(global.__update).toHaveBeenCalledWith('b1', 'late', { status: 'done' }));
  fireEvent.click(screen.getByRole('button', { name: 'Mark contacted' }));
  await waitFor(() => expect(completeFlag).toHaveBeenCalledWith('b1', 'flag'));
  expect(announceFlagsChanged).toHaveBeenCalled();
  // The header button plus the Focus card's link (no plan this week yet).
  expect(screen.getAllByRole('button', { name: 'Plan this week' })).toHaveLength(2);
  expect(screen.queryByText('View only')).toBeNull();
  expect(screen.getByRole('button', { name: 'All tasks →' })).toBeTruthy();
  expect(screen.getByLabelText('This week at a glance')).toBeTruthy();
  expect(screen.getByLabelText(/^Focus 5/)).toBeTruthy();
  // The task-drawer-shaped group is what the Overdue rows come from.
  expect(screen.getByLabelText('Overdue').textContent).toContain('Todo late');
});

test('the newest finalized report is picked when the latest week is not final', () => {
  const r = w => ({ week_start: w, report: { status: w === WEEK ? 'draft' : 'final' } });
  expect(pickNewestFinal([r(WEEK), r(addDays(WEEK, -7)), r(addDays(WEEK, -14))]).week_start).toBe(addDays(WEEK, -7));
  expect(pickNewestFinal([r(addDays(WEEK, -14)), r(addDays(WEEK, -7))]).week_start).toBe(addDays(WEEK, -7));
  expect(pickNewestFinal([r(WEEK)])).toBeNull();
  expect(pickNewestFinal([])).toBeNull();
  // Pipeline moves: partner events become rows only when they change the stage; movement buckets join them, newest first.
  const partnersById = new Map([['p1', { id: 'p1', name: 'Lakeshore Mutual' }]]);
  const events = [
    { id: 'e1', goal_id: 'p1', event: 'status', from_status: 'first_email_sent', to_status: 'meeting_set', at: '2026-10-15T09:00:00Z' },
    { id: 'e2', goal_id: 'p1', event: 'note', at: '2026-10-15T10:00:00Z' },
    { id: 'e3', goal_id: 'p1', event: 'touch', from_status: 'meeting_set', to_status: 'meeting_set', at: '2026-10-15T11:00:00Z' },
    { id: 'e4', goal_id: 'gone', event: 'status', from_status: 'replied', to_status: 'meeting_set', at: '2026-10-15T12:00:00Z' },
  ];
  const movement = { moved_forward: [{ id: 'o1', organization: 'Northwind Benefits', stage: 'meeting', updated_at: '2026-10-14T10:00:00Z' }], added: [{ id: 'o2', organization: 'Old Mill Union', stage: 'target', updated_at: '2026-10-16T10:00:00Z' }] };
  expect(pipelineMoves({ events, partnersById, movement }).map(m => `${m.name} → ${m.to}`)).toEqual(['Lakeshore Mutual → Meeting', 'Northwind Benefits → Meeting']);
});

test('a Viewer render has zero buttons except Open report / Download PDF / links', async () => {
  const commitments = [{ id: 'c1', text: 'Book the meeting', status: 'done', owner_user_id: 'u-jack', plan_id: 'pl', plan_rank: 1 }];
  render(<TodayViewer businessId="b1" hero={null} weekStart={WEEK} members={members} lookup={lookup} links={links} today={TODAY} partners={[]} commitments={commitments}
    team={teamToday(members, groups, TODAY)} top={topOfList(groups('team'), TODAY)} glance={{ rows: [{ id: 'todos', label: 'To-dos', value: '1 / 5', onOpen: jest.fn() }], onReport: jest.fn() }}
    onOpenReport={jest.fn()} onDownload={jest.fn()} onPipeline={jest.fn()} />);
  await screen.findByRole('button', { name: 'Open report' });
  await screen.findByText(/Northwind Benefits/);
  const card = screen.getByLabelText('Latest report');
  expect(card.textContent).toContain(`${weekLabel(addDays(WEEK, -7))} report`);
  expect(card.textContent).toContain('Finalized by Jack');
  expect(card.textContent).toContain(`${weekLabel(WEEK).split(' · ')[0]} report is in progress`);
  const stray = screen.getAllByRole('button').filter(b => !['Open report', 'Download PDF'].includes(b.textContent) && !b.hasAttribute('data-link'));
  expect(stray.map(b => b.textContent)).toEqual([]);
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByLabelText('The team today').textContent).toContain('! 1 overdue · 1 due today · ⚑ 1 flag');
  expect(screen.getByLabelText('Focus 5').textContent).toContain('1 of 1 done');
  expect(screen.getByLabelText('Focus 5').textContent).toContain('Not planned yet');
  fireEvent.click(screen.getByRole('button', { name: 'Open report' }));
});
