import { render, screen, fireEvent, within } from '@testing-library/react';
import SalesAnalyticsTab from './SalesAnalyticsTab';

// companies-v2 C1 - the sub-view row is the kit's second-level Tabs on every Sales tab; the page bodies are stubbed.
jest.mock('./goals/GoalsTab', () => ({ __esModule: true, default: () => null, homeOf: () => null }));
jest.mock('./AnalyticsView', () => () => null);
jest.mock('./DailyHuddle', () => () => null);
jest.mock('./goals/goalsApi', () => ({ goalsApi: { visitPull: jest.fn(), runTidy: jest.fn() }, OPEN_GOALS_WEEK: 'w', OPEN_GOALS_TARGET: 't', OPEN_PIPELINE_RECORD: 'r' }));
jest.mock('./huddleApi', () => ({ fetchFlags: jest.fn(() => Promise.resolve([])), FLAGS_CHANGED: 'f' }));
jest.mock('./salesApi', () => ({ pageloadSync: jest.fn() }));
jest.mock('../../utils/authSession', () => ({ fetchMe: jest.fn(() => Promise.resolve(null)) }));

beforeEach(() => { localStorage.clear(); window.history.replaceState(null, '', '/?tab=pipeline&view=companies'); });

test('Pipeline and Dashboard sub-views render as Tabs level="sub" with icons; picking one sets ?view= (nav unchanged)', async () => {
  render(<SalesAnalyticsTab businessId="b1" features={{}} />);
  const pipe = screen.getByRole('tablist', { name: 'Pipeline views' });
  expect(pipe).toHaveClass('ui-tabs--sub');
  const tabs = within(pipe).getAllByRole('tab');
  expect(tabs.map(t => t.textContent)).toEqual(['Companies', 'Map', 'People', 'Partner workflow', 'Campaigns']);
  expect(tabs.every(t => t.querySelector('svg'))).toBe(true);
  expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  expect(document.querySelector('[data-sales-subviews] .ui-seg')).toBeNull();
  fireEvent.click(tabs[1]);
  expect(new URLSearchParams(window.location.search).get('view')).toBe('priorities');
  fireEvent.keyDown(within(pipe).getByRole('tab', { name: 'Map' }), { key: 'ArrowRight' });
  expect(new URLSearchParams(window.location.search).get('view')).toBe('people');

  fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }));
  const dash = screen.getByRole('tablist', { name: 'Dashboard views' });
  expect(within(dash).getAllByRole('tab').map(t => t.textContent)).toEqual(['Overview', 'Sources', 'Analytics', 'Sequenced']);
  expect(within(dash).getAllByRole('tab').every(t => t.querySelector('svg'))).toBe(true);
  fireEvent.click(within(dash).getByRole('tab', { name: 'Sources' }));
  const q = new URLSearchParams(window.location.search);
  expect([q.get('tab'), q.get('view')]).toEqual(['dashboard', 'sources']);
  await screen.findByRole('tablist', { name: 'Dashboard views' });
});
