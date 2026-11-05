import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import ExplorerView, { Chart } from './ExplorerView';
import { goalsApi } from './goalsApi';
import { exportWidgetCsv } from '../exportCsv';
import { niceMax, scales, csvOf, cleanState, readPrefs, geometry, bucketAt, labelEvery } from './explorerModel';

jest.mock('./goalsApi', () => ({ goalsApi: { explorer: jest.fn(), explorerViews: jest.fn(), saveExplorerView: jest.fn(), deleteExplorerView: jest.fn() } }));
jest.mock('../exportCsv', () => ({ exportWidgetCsv: jest.fn() }));
jest.mock('../../../utils/useMediaQuery', () => () => false);

// dashboard-v3 Stage 3 - the Explorer over an invented read: chips re-read with the layers on, Table mode shows the very
// same numbers the chart draws, hover + pin, splits carry a legend in the entity's color, Save view / Share for a Member
// only, the threshold band behind a delivery layer, the pure model pieces.
const series = (layer, kind, values, over = {}) => ({ layer, split_key: 'team', label: over.label || layer, color: over.color || '#8FA8FF', kind, values, ...over });
const DATA = {
  from: '2026-10-19', to: '2026-11-05', by: 'week', split: 'team', today: '2026-11-05', layers: ['sent', 'human_open_rate', 'reply_rate', 'visitors'],
  labels: [{ key: '2026-10-19', label: 'Oct 19', current: false }, { key: '2026-10-26', label: 'Oct 26', current: false }, { key: '2026-11-02', label: 'Nov 2', current: true }],
  series: [
    series('sent', 'count', [494, 292, 229], { label: 'Sent' }),
    series('human_open_rate', 'rate', [0.021, 0.066, 0.027], { label: 'Human opens %', color: '#AFC0FF' }),
    series('reply_rate', 'rate', [0, 0, 0], { label: 'Replies %', color: '#B39DDB' }),
    series('visitors', 'count', [88, 202, 113], { label: 'Visitors', color: '#FF9F57' }),
  ],
  notes: { visitors: 'from Oct 20' }, band: { good: 0.02, concerning: 0.05 }, cached_at: null,
};
const PERSON = { ...DATA, split: 'person', series: [
  series('sent', 'count', [245, 46, 77], { split_key: 'u-jack', label: 'Jack · Sent', color: '#3DBA8C' }),
  series('sent', 'count', [249, 246, 152], { split_key: 'u-cyrus', label: 'Cyrus · Sent', color: '#D9A441' }),
  series('visitors', 'count', [88, 202, 113], { label: 'Visitors · team-wide', color: '#FF9F57' }),
] };
beforeEach(() => {
  localStorage.clear();
  goalsApi.explorer.mockImplementation((b, p) => Promise.resolve(p.split === 'person' ? PERSON : { ...DATA, layers: p.layers.split(','), by: p.by, split: p.split }));
  goalsApi.explorerViews.mockResolvedValue([]);
  goalsApi.saveExplorerView.mockImplementation((b, body) => Promise.resolve({ view: { id: 'v1', kind: 'explorer', name: body.name, state: body.state }, views: [{ id: 'v1', kind: 'explorer', name: body.name, state: body.state }] }));
  goalsApi.deleteExplorerView.mockResolvedValue([]);
});
afterEach(() => jest.clearAllMocks());

test('model: nice axis maxima, scales per kind, geometry + bucket hit test, day labels, prefs round-trip, the CSV', () => {
  expect([niceMax(0), niceMax(3), niceMax(229), niceMax(494), niceMax(523), niceMax(0.027), niceMax(0.066), niceMax(0.09)]).toEqual([1, 3, 250, 500, 600, 0.03, 0.08, 0.1]);
  expect(scales(DATA.series)).toEqual({ hasCounts: true, hasRates: true, maxCount: 500, maxRate: 0.08 });
  expect(scales([DATA.series[0]])).toMatchObject({ hasRates: false, maxRate: 1 });
  const g = geometry(3, 300);
  expect(g.slot).toBe((1340 - 44 - 48) / 3);
  expect([bucketAt(10, g, 3), bucketAt(44 + g.slot * 1.5, g, 3), bucketAt(1300, g, 3)]).toEqual([null, 1, null]);
  expect([labelEvery(9), labelEvery(60)]).toEqual([1, 7]);
  expect(cleanState({ layers: ['visitors', 'nope'], show: 'table', by: 'day', split: 'cohort', height: 'tall' })).toEqual({ layers: ['visitors'], show: 'table', by: 'day', split: 'cohort', height: 'tall' });
  expect(readPrefs('home').layers).toEqual(['sent', 'human_open_rate', 'visitors', 'reply_rate']);
  localStorage.setItem('prospector_explorer_home', '{bad json');
  expect(readPrefs('home').show).toBe('lines');
  const csv = csvOf(DATA);
  expect(csv.columns.map(c => c.label)).toEqual(['Week of', 'Sent', 'Human opens %', 'Replies %', 'Visitors']);
  expect(csv.rows[2]).toEqual({ bucket: '2026-11-02', s0: 229, s1: '2.70', s2: '0.00', s3: 113 });
});

test('chart: counts as columns on the left axis, rates as lines on the right with an end label, this week shaded; Columns mode draws everything as columns; the band only with a delivery layer', () => {
  const { container, rerender } = render(<Chart data={DATA} show="lines" height="standard" hover={null} pinned={null} onHover={() => {}} onPin={() => {}} />);
  expect(container.querySelectorAll('[data-col="sent"]')).toHaveLength(3);
  expect(container.querySelectorAll('[data-col="visitors"]')).toHaveLength(3);
  expect(container.querySelectorAll('[data-line]')).toHaveLength(2);
  expect(container.querySelector('[data-end-label="human_open_rate"]')).toHaveTextContent('2.7%');
  expect(container.querySelectorAll('[data-shade="current"]')).toHaveLength(1);
  expect(container.querySelector('[data-band]')).toBeNull();
  expect(container.querySelector('svg')).toHaveAttribute('aria-label', 'Explorer: Sent, Human opens %, Replies %, Visitors by week');
  rerender(<Chart data={DATA} show="columns" height="compact" hover={1} pinned={null} onHover={() => {}} onPin={() => {}} />);
  expect(container.querySelectorAll('[data-line]')).toHaveLength(0);
  expect(container.querySelectorAll('[data-col="human_open_rate"]')).toHaveLength(3);
  expect(container.querySelectorAll('[data-shade="active"]')).toHaveLength(1);
  expect(container.querySelector('svg')).toHaveAttribute('viewBox', '0 0 1340 220');
  const band = { ...DATA, series: [...DATA.series, series('hard_bounce_rate', 'rate', [0.036, 0.017, 0.004], { color: '#FF7878' })] };
  rerender(<Chart data={band} show="lines" height="standard" hover={null} pinned={2} onHover={() => {}} onPin={() => {}} />);
  expect(container.querySelector('[data-band="good"]')).toBeInTheDocument();
  expect(container.querySelector('[data-band="concerning"]')).toBeInTheDocument();
  expect(container.querySelector('[data-pin-line]')).toBeInTheDocument();
});

test('Explorer (Member): reads with the layers on, a chip toggles a layer and re-reads, Table mode = the same numbers as the read, hover card + pin, Save view posts the state, Share downloads the CSV', async () => {
  window.html2canvas = jest.fn(async () => ({ toDataURL: () => 'data:image/png;base64,' }));
  render(<ExplorerView businessId="b1" canEdit context="home" />);
  await screen.findByRole('img', { name: /^Explorer:/ });
  expect(goalsApi.explorer).toHaveBeenCalledWith('b1', { layers: 'sent,human_open_rate,visitors,reply_rate', by: 'week', split: 'team' });
  const chips = screen.getByRole('group', { name: 'Layers' });
  expect(within(chips).getAllByRole('button')).toHaveLength(9);
  expect(within(chips).getByRole('button', { name: /Visitors/ })).toHaveAttribute('aria-pressed', 'true');
  expect(within(chips).getByRole('button', { name: /Visitors/ })).toHaveTextContent('from Oct 20');
  expect(within(chips).getByRole('button', { name: /Meetings/ })).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(within(chips).getByRole('button', { name: /Meetings/ }));
  await waitFor(() => expect(goalsApi.explorer).toHaveBeenLastCalledWith('b1', { layers: 'sent,human_open_rate,visitors,reply_rate,meetings', by: 'week', split: 'team' }));
  expect(JSON.parse(localStorage.getItem('prospector_explorer_home')).layers).toContain('meetings');
  // Table mode: every cell is the read's digit, this week marked.
  fireEvent.click(within(screen.getByRole('group', { name: 'Show' })).getByRole('button', { name: 'Table' }));
  const table = await screen.findByRole('table');
  expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Week of', 'Sent', 'Human opens %', 'Replies %', 'Visitors']);
  expect(table.querySelector('[data-cell="sent:team:2026-11-02"]')).toHaveTextContent('229');
  expect(table.querySelector('[data-cell="human_open_rate:team:2026-10-26"]')).toHaveTextContent('6.6%');
  expect(table.querySelector('[data-cell="visitors:team:2026-10-19"]')).toHaveTextContent('88');
  expect(table.querySelector('tr[data-current]')).toHaveTextContent('Nov 2 · this week');
  fireEvent.click(within(screen.getByRole('group', { name: 'Show' })).getByRole('button', { name: 'Lines' }));
  // Hover + pin: the card lists every series' value for the bucket.
  const svg = await screen.findByRole('img', { name: /^Explorer:/ });
  svg.getBoundingClientRect = () => ({ left: 0, width: 1340, top: 0, height: 300 });
  fireEvent.mouseMove(svg, { clientX: 44 + ((1340 - 92) / 3) * 1.5 });
  const card = await waitFor(() => { const el = document.querySelector('[data-hover-card]'); if (!el) throw new Error('no card'); return el; });
  expect(card).toHaveAttribute('data-hover-card', 'hover');
  expect(card).not.toHaveAttribute('role');
  expect(card).toHaveTextContent('Week of Oct 26');
  expect(card).toHaveTextContent('Sent292');
  expect(card).toHaveTextContent('Human opens %6.6%');
  fireEvent.click(svg, { clientX: 44 + ((1340 - 92) / 3) * 1.5 });
  expect(screen.getByRole('status')).toHaveAttribute('data-hover-card', 'pinned');
  fireEvent.mouseLeave(svg);
  expect(screen.getByRole('status')).toHaveTextContent('pinned');
  fireEvent.click(svg, { clientX: 44 + ((1340 - 92) / 3) * 1.5 });
  expect(screen.queryByRole('status')).toBeNull();
  expect(document.querySelector('[data-hover-card]')).toBeNull();
  // Save view: the name + the state go to POST goals/explorer/views; the list shows it.
  fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'View name' }), { target: { value: 'Bounces by mailbox' } });
  fireEvent.submit(document.querySelector('[data-save-form]'));
  await waitFor(() => expect(goalsApi.saveExplorerView).toHaveBeenCalledWith('b1', { name: 'Bounces by mailbox', state: { layers: ['sent', 'human_open_rate', 'visitors', 'reply_rate', 'meetings'], show: 'lines', by: 'week', split: 'team', height: 'standard' } }));
  await screen.findByRole('combobox', { name: 'Saved view' });
  // Share: the CSV through the shared exporter, the PNG through html2canvas.
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  await waitFor(() => expect(exportWidgetCsv).toHaveBeenCalledWith('explorer', expect.any(Array), expect.any(Array)));
  await waitFor(() => expect(window.html2canvas).toHaveBeenCalled());
  expect(exportWidgetCsv.mock.calls[0][1][2].s0).toBe(229);
});

test('split Person: one series per member in their color, Visitors stays team-wide, the legend carries first names; a saved view applies its state', async () => {
  goalsApi.explorerViews.mockResolvedValue([{ id: 'v9', kind: 'explorer', name: 'Day by day', state: { layers: ['sent'], show: 'table', by: 'day', split: 'team', height: 'tall' } }]);
  render(<ExplorerView businessId="b1" canEdit context="home" />);
  await screen.findByRole('img', { name: /^Explorer:/ });
  fireEvent.click(within(screen.getByRole('group', { name: 'Split' })).getByRole('button', { name: 'Person' }));
  await waitFor(() => expect(goalsApi.explorer).toHaveBeenLastCalledWith('b1', expect.objectContaining({ split: 'person' })));
  const legend = await waitFor(() => document.querySelector('[data-explorer-legend]'));
  expect(legend).toHaveTextContent('Jack');
  expect(legend).toHaveTextContent('Cyrus');
  expect(legend).not.toHaveTextContent('Visitors');
  expect(screen.getByRole('img', { name: 'Explorer: Jack · Sent, Cyrus · Sent, Visitors · team-wide by week' })).toBeInTheDocument();
  await act(async () => { fireEvent.change(screen.getByRole('combobox', { name: 'Saved view' }), { target: { value: 'v9' } }); });
  await waitFor(() => expect(goalsApi.explorer).toHaveBeenLastCalledWith('b1', { layers: 'sent', by: 'day', split: 'team' }));
  expect(document.querySelector('[data-explorer-state]')).toHaveAttribute('data-explorer-state', 'table|day|team|tall');
});

test('a Viewer reads the chart and every control that only reads; no Save view, no Share, no save form', async () => {
  render(<ExplorerView businessId="b1" canEdit={false} context="home" />);
  await screen.findByRole('img', { name: /^Explorer:/ });
  expect(screen.queryByRole('button', { name: 'Save view' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
  expect(screen.getByRole('group', { name: 'Layers' })).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Chart height' })).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('group', { name: 'By' })).getByRole('button', { name: 'Day' }));
  await waitFor(() => expect(goalsApi.explorer).toHaveBeenLastCalledWith('b1', expect.objectContaining({ by: 'day' })));
});
