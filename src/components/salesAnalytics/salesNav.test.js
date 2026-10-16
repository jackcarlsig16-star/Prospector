import { navFrom, normalizeNav } from './salesNav';

test('?tab= wins and an unknown sub-view falls back to the tab default', () => {
  expect(navFrom({ tab: 'pipeline', view: 'partners' })).toEqual({ tab: 'pipeline', view: 'partners' });
  expect(navFrom({ tab: 'reports', view: 'nope' })).toEqual({ tab: 'reports', view: 'weekly' });
  expect(navFrom({ tab: 'huddle', view: 'weekly' })).toEqual({ tab: 'huddle', view: null });
  expect(normalizeNav('bogus')).toEqual({ tab: 'today', view: null });
});

test.each([
  ['report', 'reports', 'weekly'], ['week', 'today', null], ['partners', 'pipeline', 'partners'],
  ['companies', 'pipeline', 'sequenced'], ['pipeline', 'pipeline', 'board'],
])('old ?gview=%s lands on %s / %s', (gview, tab, view) => {
  expect(navFrom({ gview, storedTab: 'reports', storedView: 'analytics' })).toEqual({ tab, view });
});

test('a stored prospector_goals_view maps the same way, only while no new key exists', () => {
  expect(navFrom({ storedLegacy: 'companies' })).toEqual({ tab: 'pipeline', view: 'sequenced' });
  expect(navFrom({ storedLegacy: 'companies', storedTab: 'reports', storedView: 'scorecard' })).toEqual({ tab: 'reports', view: 'scorecard' });
  expect(navFrom({})).toEqual({ tab: 'today', view: null });
});
