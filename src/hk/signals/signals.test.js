import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { HeatChip, ListButtons, pipelineBlock, heatBarStyle, UNDO_MS } from './Heat';
import SignalsPanel from './SignalsPanel';

// grow-signals-v1 Stage 3 - heat chips, + Target / + Pipeline with Undo, the Signals panel (Act / Dismiss only, the
// Sponsors heading at 0 points), Viewers read-only. Recorded fetch; invented brands; no address in any fixture.
const HK = 'biz-hk';
const members = [{ user_id: 'u-jack', first_name: 'Jack', palette_index: 1 }, { user_id: 'u-pete', first_name: 'Pete', palette_index: 2 }];
const shell = role => ({ me: { user_id: 'u-jack', first_name: 'Jack', role }, members });
let calls, routes, bodies;
const json = (status, body) => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });
beforeEach(() => {
  calls = []; routes = {}; bodies = {};
  global.fetch = jest.fn((url, init = {}) => {
    const method = init.method || 'GET'; const u = new URL(url, 'http://x'); const key = `${method} ${u.pathname}`; calls.push(key);
    if (init.body) (bodies[key] ||= []).push(JSON.parse(init.body));
    const hit = routes[key]; return hit ? json(200, typeof hit === 'function' ? hit(init.body ? JSON.parse(init.body) : null) : hit) : json(404, { error: `no route ${key}` });
  });
});
afterEach(() => jest.useRealTimers());
const brand = over => ({ id: 'b1', name: 'Zz Bluefin Run', status: 'candidate', relationship: 'prospect', owner_user_id: null, owner_unclear: false, heat: 45, heat_band: 'hot', targeted_at: null, ...over });

test('the chip always shows the word; Cold shows only where asked; the bar skips Cold', () => {
  const { container, rerender } = render(<HeatChip band="hot" />);
  expect(screen.getByText('Hot')).toHaveClass('hk-heat--hot');
  rerender(<><HeatChip band="warm" /><HeatChip band="cool" /><HeatChip band="cold" /></>);
  expect(screen.getByText('Warm')).toBeInTheDocument(); expect(screen.getByText('Cool')).toBeInTheDocument(); expect(screen.queryByText('Cold')).toBeNull();
  rerender(<HeatChip band="cold" showCold />);
  expect(container.querySelector('[data-hk-heat="cold"]')).toHaveTextContent('Cold');
  expect(heatBarStyle('hot').boxShadow).toMatch(/--hk-heat-hot-bar/); expect(heatBarStyle('cold')).toBeUndefined();
});

test('+ Target then Undo within 10 s; the Undo line goes away after 10 s', async () => {
  routes[`POST /api/hk/${HK}/brands/b1/target`] = b => ({ brand: { id: 'b1', targeted_at: b.on ? '2026-10-29T15:00:00Z' : null } });
  const onChanged = jest.fn();
  render(<ListButtons businessId={HK} brand={brand()} meId="u-jack" members={members} canEdit onChanged={onChanged} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add Zz Bluefin Run to Targets' }));
  expect(await screen.findByText('Targeted')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Zz Bluefin Run added to Targets.');
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(await screen.findByRole('button', { name: 'Add Zz Bluefin Run to Targets' })).toBeInTheDocument();
  expect(bodies[`POST /api/hk/${HK}/brands/b1/target`]).toEqual([{ on: true }, { on: false }]);
  expect(onChanged).toHaveBeenCalledTimes(2);
  jest.useFakeTimers();
  fireEvent.click(screen.getByRole('button', { name: 'Add Zz Bluefin Run to Targets' }));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  expect(screen.queryByText('Undo')).toBeInTheDocument();
  act(() => { jest.advanceTimersByTime(UNDO_MS + 10); });
  expect(screen.queryByText('Undo')).toBeNull();
});

test('+ Pipeline claims and Undo sends the stale-screen guard; refused brands say why before a click', async () => {
  routes[`POST /api/hk/${HK}/brands/b1/pipeline`] = b => (b.undo ? { brand: { id: 'b1' }, undone: true } : { brand: { id: 'b1', owner_user_id: 'u-jack', status: 'claimed', updated_at: '2026-10-29T15:00:01Z' } });
  render(<ListButtons businessId={HK} brand={brand()} meId="u-jack" members={members} canEdit />);
  fireEvent.click(screen.getByRole('button', { name: 'Add Zz Bluefin Run to your Pipeline' }));
  expect(await screen.findByText('In Pipeline')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(bodies[`POST /api/hk/${HK}/brands/b1/pipeline`]).toEqual([{}, { undo: true, expect_updated_at: '2026-10-29T15:00:01Z' }]));
  const first = id => members.find(m => m.user_id === id)?.first_name;
  expect(pipelineBlock(brand({ owner_user_id: 'u-pete', status: 'claimed' }), 'u-jack', first)).toBe('Owned by Pete');
  expect(pipelineBlock(brand({ owner_unclear: true }), 'u-jack')).toMatch(/Unclear/);
  expect(pipelineBlock(brand({ relationship: 'sponsor' }), 'u-jack')).toMatch(/sponsor/);
  expect(pipelineBlock(brand({ relationship: 'founding_partner' }), 'u-jack')).toMatch(/founding partner/);
  expect(pipelineBlock(brand({ relationship: 'do_not_contact' }), 'u-jack')).toMatch(/do not contact/);
});

test('a Pipeline button for the other founder\'s brand is disabled with the reason; Viewers get no buttons', () => {
  const { rerender } = render(<ListButtons businessId={HK} brand={brand({ id: 'b2', name: 'Zz Harbor Yoga', owner_user_id: 'u-pete', status: 'claimed' })} meId="u-jack" members={members} canEdit />);
  expect(screen.getByRole('button', { name: 'Add Zz Harbor Yoga to your Pipeline' })).toBeDisabled();
  expect(screen.getByText('Owned by Pete')).toBeInTheDocument();
  rerender(<ListButtons businessId={HK} brand={brand()} meId="u-jack" members={members} canEdit={false} />);
  expect(screen.queryByRole('button')).toBeNull();
});

const signal = over => ({ id: 's1', kind: 'reply_pricing', words: 'replied: pricing question', points: 35, occurred_at: '2026-10-29T14:00:00Z', detail: 'Zz Bluefin Run replied: pricing question', brand: brand(), domain: null, seen_at: null, acted_at: null, dismissed_at: null, ...over });
const sponsorSig = { id: 's9', kind: 'sponsor_lapsed', words: 'sponsor: no period this month', points: 0, occurred_at: '2026-10-29T12:00:00Z', detail: 'Zz Northwind Juice sponsor: no period this month', brand: brand({ id: 'b9', name: 'Zz Northwind Juice', relationship: 'sponsor', heat: 0, heat_band: 'cold' }), seen_at: '2026-10-29T12:00:00Z' };

test('Signals panel: prospects with heat, unseen bold then marked seen, Sponsors heading at 0 points, Act and Dismiss with Undo, no Snooze', async () => {
  let open = [signal()];
  routes[`GET /api/hk/${HK}/signals`] = () => ({ prospects: open, sponsors: [sponsorSig], unseen_hot_warm: open.filter(s => !s.seen_at).length });
  routes[`POST /api/hk/${HK}/signals/seen`] = { seen: 1 };
  routes[`POST /api/hk/${HK}/signals/s1/act`] = { acted: true };
  routes[`POST /api/hk/${HK}/signals/s1/dismiss`] = b => { open = b.undo ? [signal({ seen_at: 'x' })] : []; return { dismissed: !b.undo }; };
  const onOpenBrand = jest.fn(), onSeen = jest.fn();
  render(<SignalsPanel businessId={HK} canEdit onOpenBrand={onOpenBrand} onGo={() => {}} onSeen={onSeen} />);
  const panel = await screen.findByRole('region', { name: 'Signals' });
  const row = within(panel).getByText('Zz Bluefin Run replied: pricing question').closest('[data-hk-signal]');
  expect(row).toHaveClass('hk-rcard__sig--unseen');
  expect(within(row).getByText('Hot')).toBeInTheDocument();
  await waitFor(() => expect(bodies[`POST /api/hk/${HK}/signals/seen`]).toEqual([{ ids: ['s1'] }]));
  await waitFor(() => expect(onSeen).toHaveBeenCalled());
  expect(within(panel).getByText(/Sponsors \(1\) · 0 points, not counted in heat/)).toBeInTheDocument();
  expect(within(panel).queryByText(/Snooze/)).toBeNull();
  fireEvent.click(within(row).getByRole('button', { name: 'Zz Bluefin Run replied: pricing question' }));
  expect(onOpenBrand).toHaveBeenCalledWith('b1');
  fireEvent.click(within(row).getByRole('button', { name: /^Dismiss/ }));
  expect(await within(panel).findByText('No prospect signals right now.')).toBeInTheDocument();
  fireEvent.click(within(panel).getByRole('button', { name: 'Undo' }));
  expect(await within(panel).findByText('Zz Bluefin Run replied: pricing question')).toBeInTheDocument();
  expect(bodies[`POST /api/hk/${HK}/signals/s1/dismiss`]).toEqual([{}, { undo: true }]);
});

test('Viewer: the panel reads, marks nothing seen, has no Dismiss', async () => {
  routes[`GET /api/hk/${HK}/signals`] = { prospects: [signal()], sponsors: [], unseen_hot_warm: 1 };
  render(<SignalsPanel businessId={HK} canEdit={false} onOpenBrand={() => {}} onGo={() => {}} />);
  const panel = await screen.findByRole('region', { name: 'Signals' });
  const words = within(panel).getByRole('button', { name: 'Zz Bluefin Run replied: pricing question' });
  expect(within(panel).queryByRole('button', { name: /^Dismiss/ })).toBeNull();
  fireEvent.click(words);
  expect(calls.filter(c => c.startsWith('POST'))).toEqual([]);
});

test('Brands: a Heat column with the word, + Target on the row; Hot leads + Targets are rail views (nav tests); Viewer sees chips only', async () => {
  const BrandsScreen = require('../brands/BrandsScreen').default;
  const rows = [brand(), brand({ id: 'b3', name: 'Zz Cedar Coffee', heat: 0, heat_band: 'cold' })];
  const list = { rows, total: 2, facets: null, next: null, loading: false, error: '', loadMore: () => {}, reload: async () => {} };
  const { unmount } = render(<BrandsScreen businessId={HK} shell={shell('owner')} compact={false} canEdit onOpenBrand={() => {}} list={list} />);
  expect(await screen.findByText('Zz Cedar Coffee')).toBeInTheDocument();
  expect(screen.getByText('Hot')).toHaveClass('hk-heat--hot');
  expect(screen.getByRole('columnheader', { name: /Heat/ })).toBeInTheDocument();
  // grow-ui-refresh U6: Target is the row's quick command (shown on hover / focus), pressed when targeted.
  const row = screen.getByText('Zz Bluefin Run').closest('tr');
  expect(within(row).getByRole('button', { name: 'Toggle Target' })).toHaveAttribute('data-tip', 'Toggle Target (T)');
  unmount();
  render(<BrandsScreen businessId={HK} shell={shell('viewer')} compact={false} canEdit={false} onOpenBrand={() => {}} list={list} />);
  expect(await screen.findByText('Zz Cedar Coffee')).toBeInTheDocument();
  expect(screen.getByText('Hot')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Toggle Target' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Add to your Pipeline' })).toBeNull();
});
