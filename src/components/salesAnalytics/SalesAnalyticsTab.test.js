import { render, screen, fireEvent, within } from '@testing-library/react';
import SalesAnalyticsTab from './SalesAnalyticsTab';
import { goalsApi } from './goals/goalsApi';

// companies-v2 C1 - the sub-view row is the kit's second-level Tabs on every Sales tab; the page bodies are stubbed.
jest.mock('./goals/GoalsTab', () => ({ __esModule: true, default: () => null, homeOf: () => null }));
jest.mock('./AnalyticsView', () => () => null);
jest.mock('./DailyHuddle', () => () => null);
const mockCampaigns = { list: [] };
jest.mock('./goals/goalsApi', () => ({ goalsApi: { visitPull: jest.fn(), runTidy: jest.fn(), campaigns: jest.fn(() => Promise.resolve(mockCampaigns.list)) }, OPEN_GOALS_WEEK: 'w', OPEN_GOALS_TARGET: 't', OPEN_PIPELINE_RECORD: 'r' }));
jest.mock('./huddleApi', () => ({ fetchFlags: jest.fn(() => Promise.resolve([])), FLAGS_CHANGED: 'f' }));
jest.mock('./salesApi', () => ({ pageloadSync: jest.fn() }));
jest.mock('../../utils/authSession', () => ({ fetchMe: jest.fn(() => Promise.resolve(null)) }));
const mockMq = { phone: false };
jest.mock('../../utils/useMediaQuery', () => () => mockMq.phone);

// CRA resets mock implementations before each test, so the campaigns read is wired here.
beforeEach(() => { localStorage.clear(); mockMq.phone = false; mockCampaigns.list = []; goalsApi.campaigns.mockImplementation(() => Promise.resolve(mockCampaigns.list)); window.history.replaceState(null, '', '/?tab=pipeline&view=companies'); });

// FIX pipeline-390-toolbar-v1 T1: on a phone the frame is two rows - tabs above, the tools slot under them - and the
// selected tab is scrolled into view; wider than 760 px the one-row frame is unchanged (T2).
test('phone: the frame stacks the sub-view strip over the tools slot, the selected tab scrolls into view; desktop keeps one row', () => {
  const into = jest.fn(); Element.prototype.scrollIntoView = into;
  mockMq.phone = true;
  const { unmount } = render(<SalesAnalyticsTab businessId="b1" />);
  const frame = document.querySelector('[data-sales-frame]');
  expect(frame.getAttribute('data-frame-rows')).toBe('2');
  expect(frame.style.flexDirection).toBe('column');
  const [strip, tools] = frame.children;
  expect([strip.hasAttribute('data-sales-subviews'), tools.id, tools.getAttribute('style')]).toEqual([true, 'sales-frame-tools', null]); // the slot's layout is FRAME_CSS (so :empty can hide it)
  expect(into).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
  into.mockClear();
  fireEvent.click(within(screen.getByRole('tablist', { name: 'Pipeline views' })).getByRole('tab', { name: 'Partner workflow' }));
  expect(into).toHaveBeenCalledTimes(1);
  unmount();
  mockMq.phone = false;
  render(<SalesAnalyticsTab businessId="b1" />);
  const wide = document.querySelector('[data-sales-frame]');
  expect([wide.getAttribute('data-frame-rows'), wide.style.flexDirection, wide.style.height]).toEqual(['1', '', '44px']);
  expect([...document.querySelectorAll('style')].map(s => s.textContent).join('')).toMatch(/#sales-frame-tools:empty \{ display: none; \}/);
});

test('Pipeline and Dashboard sub-views render as Tabs level="sub" with icons; picking one sets ?view= (nav unchanged)', async () => {
  render(<SalesAnalyticsTab businessId="b1" />);
  const pipe = screen.getByRole('tablist', { name: 'Pipeline views' });
  expect(pipe).toHaveClass('ui-tabs--sub');
  const tabs = within(pipe).getAllByRole('tab');
  // dashboard-v3 A7: Campaigns stays hidden while sales_outreach_* is empty.
  expect(tabs.map(t => t.textContent)).toEqual(['Companies', 'Clients', 'Map', 'People', 'Partner workflow']);
  expect(tabs.every(t => t.querySelector('svg'))).toBe(true);
  expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  expect(document.querySelector('[data-sales-subviews] .ui-seg')).toBeNull();
  fireEvent.click(tabs[2]);
  expect(new URLSearchParams(window.location.search).get('view')).toBe('priorities');
  fireEvent.keyDown(within(pipe).getByRole('tab', { name: 'Map' }), { key: 'ArrowRight' });
  expect(new URLSearchParams(window.location.search).get('view')).toBe('people');

  fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }));
  const dash = screen.getByRole('tablist', { name: 'Dashboard views' });
  expect(within(dash).getAllByRole('tab').map(t => t.textContent)).toEqual(['Home', 'Email', 'Scorecard', 'Sources']);
  expect(within(dash).getAllByRole('tab').every(t => t.querySelector('svg'))).toBe(true);
  fireEvent.click(within(dash).getByRole('tab', { name: 'Sources' }));
  const q = new URLSearchParams(window.location.search);
  expect([q.get('tab'), q.get('view')]).toEqual(['dashboard', 'sources']);
  await screen.findByRole('tablist', { name: 'Dashboard views' });
});

test('dashboard-v3 A7: Campaigns shows once a campaign exists, with a "new" dot until it is opened once (prospector_campaigns_seen_<id>)', async () => {
  mockCampaigns.list = [{ id: 'c1' }];
  render(<SalesAnalyticsTab businessId="b1" />);
  const tab = await within(screen.getByRole('tablist', { name: 'Pipeline views' })).findByRole('tab', { name: /Campaigns/ });
  expect(within(tab).getByLabelText('new')).toBeInTheDocument();
  fireEvent.click(tab);
  expect(localStorage.getItem('prospector_campaigns_seen_b1')).toBe('1');
  expect(within(screen.getByRole('tablist', { name: 'Pipeline views' })).getByRole('tab', { name: 'Campaigns' }).querySelector('[aria-label="new"]')).toBeNull();
});
