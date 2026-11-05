import { navFrom, normalizeNav, SUB_VIEWS, companyWindowUrl, readOpenParam } from './salesNav';
import { readPeopleCompany, writePeopleCompany } from './salesNav';

test('?tab= wins and an unknown sub-view falls back to the tab default', () => {
  expect(navFrom({ tab: 'pipeline', view: 'partners' })).toEqual({ tab: 'pipeline', view: 'partners' });
  expect(navFrom({ tab: 'dashboard', view: 'nope' })).toEqual({ tab: 'dashboard', view: 'overview' });
  // dashboard-v3 A2: the Scorecard is a sub-view again; the old Weekly report link opens it; ?view=sequenced lands on Email.
  expect(navFrom({ tab: 'dashboard', view: 'weekly' })).toEqual({ tab: 'dashboard', view: 'scorecard' });
  expect(navFrom({ tab: 'dashboard', view: 'scorecard' })).toEqual({ tab: 'dashboard', view: 'scorecard' });
  expect(navFrom({ tab: 'dashboard', view: 'sequenced' })).toEqual({ tab: 'dashboard', view: 'analytics' });
  expect(navFrom({ storedTab: 'dashboard', storedView: 'sequenced' })).toEqual({ tab: 'dashboard', view: 'overview' });
  expect(navFrom({ tab: 'actions', view: 'weekly' })).toEqual({ tab: 'actions', view: null });
  expect(normalizeNav('bogus')).toEqual({ tab: 'actions', view: null });
});

test.each([
  ['today', null, 'actions', null],
  ['huddle', null, 'pipeline', 'people'],
  ['reports', 'weekly', 'dashboard', 'scorecard'],
  ['reports', 'scorecard', 'dashboard', 'scorecard'],
  ['reports', null, 'dashboard', 'overview'],
  ['reports', 'analytics', 'dashboard', 'analytics'],
  ['pipeline', 'board', 'pipeline', 'companies'],
  ['pipeline', 'sequenced', 'dashboard', 'analytics'],
  ['pipeline', 'partners', 'pipeline', 'partners'],
])('old ?tab=%s&view=%s lands on %s / %s', (tab, view, toTab, toView) => {
  expect(navFrom({ tab, view })).toEqual({ tab: toTab, view: toView });
});

test('old Reports > Website visitors lands on Pipeline with the Website visitors channel', () => {
  expect(navFrom({ tab: 'reports', view: 'visitors' })).toEqual({ tab: 'pipeline', view: 'companies', channel: 'website_visit' });
  expect(navFrom({ storedTab: 'reports', storedView: 'visitors' })).toEqual({ tab: 'pipeline', view: 'companies', channel: 'website_visit' });
});

test.each([
  ['report', 'dashboard', 'scorecard'], ['week', 'actions', null], ['partners', 'pipeline', 'partners'],
  ['companies', 'dashboard', 'analytics'], ['pipeline', 'pipeline', 'companies'],
])('old ?gview=%s lands on %s / %s', (gview, tab, view) => {
  expect(navFrom({ gview, storedTab: 'dashboard', storedView: 'analytics' })).toEqual({ tab, view });
});

test('stored keys from v1 and the old prospector_goals_view map the same way', () => {
  expect(navFrom({ storedTab: 'huddle' })).toEqual({ tab: 'pipeline', view: 'people' });
  expect(navFrom({ storedLegacy: 'companies' })).toEqual({ tab: 'dashboard', view: 'analytics' });
  expect(navFrom({ storedLegacy: 'companies', storedTab: 'dashboard', storedView: 'scorecard' })).toEqual({ tab: 'dashboard', view: 'scorecard' });
  expect(navFrom({})).toEqual({ tab: 'actions', view: null });
});

// company-panel-v2 - the People company filter rides in ?company=<type>:<id>&cname=.
test('readPeopleCompany / writePeopleCompany round-trip; a bad type or a missing id reads as null; writing null clears both params', () => {
  expect(readPeopleCompany('?tab=pipeline&view=people&company=partner:g1&cname=Gallagher')).toEqual({ type: 'partner', id: 'g1', name: 'Gallagher' });
  expect(readPeopleCompany('?company=employer:o1')).toEqual({ type: 'employer', id: 'o1', name: '' });
  expect(readPeopleCompany('?company=target:t1')).toBeNull();
  expect(readPeopleCompany('?company=partner:')).toBeNull();
  expect(readPeopleCompany('?tab=pipeline')).toBeNull();
  window.history.replaceState(null, '', '/?tab=pipeline&view=people');
  writePeopleCompany({ type: 'partner', id: 'g1', name: 'Gallagher' });
  expect(window.location.search).toBe('?tab=pipeline&view=people&company=partner%3Ag1&cname=Gallagher');
  expect(readPeopleCompany()).toEqual({ type: 'partner', id: 'g1', name: 'Gallagher' });
  writePeopleCompany(null);
  expect(window.location.search).toBe('?tab=pipeline&view=people');
});

test('priorities-v2 D9: the Priorities sub-view is labelled Map; its id stays priorities', () => {
  expect(SUB_VIEWS.pipeline.find(([id]) => id === 'priorities')).toEqual(['priorities', 'Map']);
});

test('dashboard-v3 A2: Dashboard = Home · Email · Scorecard · Sources (ids overview · analytics · scorecard · sources); no Sequenced', () => {
  expect(SUB_VIEWS.dashboard).toEqual([['overview', 'Home'], ['analytics', 'Email'], ['scorecard', 'Scorecard'], ['sources', 'Sources']]);
});

test('company-panel-v3 Copy link: Pipeline > Companies with ?open=<type>-<id>; only a real record key opens', () => {
  const id = '4639934a-34a0-4b2f-8903-9627ddeab6e9';
  expect(companyWindowUrl({ type: 'employer', id }, 'https://app.example/sales?tab=dashboard&view=sources&x=1')).toBe(`https://app.example/sales?tab=pipeline&view=companies&open=employer-${id}`);
  expect(readOpenParam(`?open=employer-${id}`)).toBe(`employer-${id}`);
  expect(readOpenParam('?open=visitor-acme')).toBeNull();
  expect(readOpenParam('')).toBeNull();
});

test('homelover-team-emails-v1: Sales › Settings opens on Team emails', () => {
  expect(normalizeNav('settings')).toEqual({ tab: 'settings', view: 'team-emails' });
  expect(normalizeNav('settings', 'bogus')).toEqual({ tab: 'settings', view: 'team-emails' });
  expect(SUB_VIEWS.settings).toEqual([['team-emails', 'Team emails']]);
});
