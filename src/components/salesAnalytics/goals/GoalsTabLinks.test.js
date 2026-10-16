import { homeOf } from './GoalsTab';

jest.mock('./goalsApi', () => ({ goalsApi: {}, TODOS_CHANGED: 'todos', OPEN_TASKS: 'tasks' }));
jest.mock('../../../utils/authSession', () => ({ fetchMe: jest.fn() }));
jest.mock('../../../utils/useMediaQuery', () => () => false);

// The Stage 0 link inventory: every go() target and its home (Design E; D9 in
// Stage 2 sends 'view:week' to Today, 'score:<m>' stays with the scorecard).
test.each([
  ['view:report', 'reports', 'weekly'], ['section:s4', 'reports', 'weekly'],
  ['view:week', 'today', null], ['view:this_week', 'today', null], ['score:meetings_set', 'reports', 'scorecard'],
  ['week:prev', 'today', null], ['plan', 'today', null],
  ['view:partners', 'pipeline', 'partners'], ['view:companies', 'pipeline', 'sequenced'], ['missing', 'pipeline', 'sequenced'], ['view:pipeline', 'pipeline', 'board'],
  ['overview', 'reports', 'analytics'], ['overview:week_strip', 'reports', 'analytics'],
  ['huddle', 'huddle', null], ['huddle:reply', 'huddle', null], ['huddle:flags', 'huddle', null],
])('%s → %s / %s', (target, tab, view) => {
  expect(homeOf(target)).toEqual({ tab, view });
});

test('object targets: partners and companies', () => {
  expect(homeOf({ partners: { stage: 'meeting_set' } })).toEqual({ tab: 'pipeline', view: 'partners' });
  expect(homeOf({ companies: '2026-10-05' })).toEqual({ tab: 'pipeline', view: 'sequenced' });
});

test('an unknown target (an old commitment link_target) has no home, so go() falls back to Reports', () => {
  expect(homeOf('view:retired')).toBeNull();
  expect(homeOf('whatever:x')).toBeNull();
  expect(homeOf(null)).toBeNull();
  expect(homeOf({ other: 1 })).toBeNull();
});
