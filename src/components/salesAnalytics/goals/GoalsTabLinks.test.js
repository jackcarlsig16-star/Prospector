import { homeOf } from './GoalsTab';

jest.mock('./goalsApi', () => ({ goalsApi: {}, TODOS_CHANGED: 'todos', OPEN_TASKS: 'tasks' }));
jest.mock('../../../utils/authSession', () => ({ fetchMe: jest.fn() }));
jest.mock('../../../utils/useMediaQuery', () => () => false);

// The Stage 0 link inventory: every go() target and its home (Design E;
// sales-ia-v2 N1: Today -> Actions, Reports -> Dashboard, Huddle -> Pipeline >
// People, Board -> Companies, Sequenced -> Dashboard).
test.each([
  ['view:report', 'dashboard', 'weekly'], ['section:s4', 'dashboard', 'weekly'],
  ['view:week', 'actions', null], ['view:this_week', 'actions', null], ['score:meetings_set', 'dashboard', 'scorecard'],
  ['week:prev', 'actions', null], ['plan', 'actions', null],
  ['view:partners', 'pipeline', 'partners'], ['view:companies', 'dashboard', 'sequenced'], ['missing', 'dashboard', 'sequenced'], ['view:pipeline', 'pipeline', 'companies'],
  ['overview', 'dashboard', 'analytics'], ['overview:week_strip', 'dashboard', 'analytics'],
  ['huddle', 'pipeline', 'people'], ['huddle:reply', 'pipeline', 'people'], ['huddle:flags', 'pipeline', 'people'],
])('%s → %s / %s', (target, tab, view) => {
  expect(homeOf(target)).toEqual({ tab, view });
});

test('object targets: partners and companies', () => {
  expect(homeOf({ partners: { stage: 'meeting_set' } })).toEqual({ tab: 'pipeline', view: 'partners' });
  expect(homeOf({ companies: '2026-10-05' })).toEqual({ tab: 'dashboard', view: 'sequenced' });
});

test('an unknown target (an old commitment link_target) has no home, so go() falls back to the Dashboard', () => {
  expect(homeOf('view:retired')).toBeNull();
  expect(homeOf('whatever:x')).toBeNull();
  expect(homeOf(null)).toBeNull();
  expect(homeOf({ other: 1 })).toBeNull();
});
