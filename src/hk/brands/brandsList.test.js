import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import BrandsScreen from './BrandsScreen';
import BrandsSpace from './BrandsSpace';

// grow-ui-refresh-v1 REV2 Stage 3c - the Brands list to mockup 3 (U6): columns, the row's primary + quick commands (shown
// on hover / focus by CSS), selected tint, the forest bulk bar, the Sort control, Viewer. Invented brands; recorded
// fetch; no address in any fixture.
const HK = 'biz-hk';
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const members = [{ user_id: 'u-me', first_name: 'Rowan', palette_index: 1 }, { user_id: 'u-sky', first_name: 'Sky', palette_index: 2 }];
const shell = role => ({ me: { user_id: 'u-me', first_name: 'Rowan', role }, members });
let routes, bodies;
const json = (status, body) => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });
beforeEach(() => {
  routes = {}; bodies = {};
  global.fetch = jest.fn((url, init = {}) => {
    const key = `${init.method || 'GET'} ${new URL(url, 'http://x').pathname}`;
    if (init.body) (bodies[key] ||= []).push(JSON.parse(init.body));
    const hit = routes[key]; return hit ? json(200, typeof hit === 'function' ? hit(JSON.parse(init.body || 'null')) : hit) : json(404, { error: `no route ${key}` });
  });
  Object.assign(navigator, { clipboard: { writeText: jest.fn(() => Promise.resolve()) } });
});
const row = over => ({ id: 'b1', name: 'Zz Alder Apparel', domain: 'alderapparel.invalid', category: 'National CPG', is_local: false, heat: 20, heat_band: 'cool', status: 'candidate', relationship: 'prospect', owner_user_id: null, owner_hint: null, targeted_at: '2026-10-28T00:00:00Z', last_touch_at: null, score: 60, research: { industry: 'Outdoor apparel', fit: 'possible', chicago_presence: 'no' }, contact: { has_email: true, title: 'Marketing lead' }, primary: { kind: 'pitch', label: 'Pitch' }, command: 'hk pitch alderapparel.invalid', ...over });
const ROWS = [row(), row({ id: 'b2', name: 'Zz Birch Bars', domain: null, research: null, score: 45, contact: { has_email: false, title: null }, primary: { kind: 'research', label: 'Research' }, command: 'hk pitch Zz Birch Bars', is_local: true, heat_band: 'warm' }),
  row({ id: 'b3', name: 'Zz Cedar Cola', owner_user_id: 'u-sky', status: 'claimed', score: null, primary: { kind: 'owned', label: 'Owned by Sky' }, targeted_at: null, last_touch_at: '2026-10-20T00:00:00Z' })];
const listOf = (over = {}) => ({ rows: ROWS, total: 3, facets: null, next: null, loading: false, error: '', estimate: { per_call: 0.05, rows: 5 }, loadMore: () => {}, reload: jest.fn(async () => {}), ...over });

test('U6 columns in mockup order; Industry from research else Category (J6); Market; Contact role or "No email"; Score or —; each row carries its primary + quick commands and the chevron', () => {
  render(<BrandsScreen businessId={HK} shell={shell('owner')} compact={false} canEdit onOpenBrand={() => {}} list={listOf()} />);
  expect(screen.getAllByRole('columnheader').map(h => (h.querySelector('.ui-sr-only')?.textContent || h.textContent).replace(/[↑↓↕▲▼]/g, '').trim())).toEqual(['Select', 'Brand', 'Target', 'Industry', 'Market', 'Heat', 'Stage', 'Owner', 'Contact', 'Last touch', 'Score', 'Actions']);
  const r1 = screen.getByText('Zz Alder Apparel').closest('tr'), r2 = screen.getByText('Zz Birch Bars').closest('tr'), r3 = screen.getByText('Zz Cedar Cola').closest('tr');
  expect(r1).toHaveTextContent('Outdoor apparel'); expect(r2).toHaveTextContent('National CPG');
  expect(r1).toHaveTextContent('National'); expect(r2).toHaveTextContent('Chicago');
  expect(r1).toHaveTextContent('Marketing lead'); expect(within(r2).getByText('No email')).toHaveClass('hk-label--block');
  expect(within(r1).getByText('60')).toHaveClass('hk-score'); expect(r3.querySelector('.hk-score')).toBeNull();
  expect(within(r1).getByRole('button', { name: 'Pitch' })).toBeInTheDocument();
  expect(within(r2).getByRole('button', { name: 'Research' })).toBeInTheDocument();
  expect(r3).toHaveTextContent('Owned by Sky');
  for (const name of ['Toggle Target', 'Add to your Pipeline', 'Snooze 14 days', 'Not a fit']) expect(within(r1).getByRole('button', { name })).toBeInTheDocument();
  expect(within(r1).getByRole('button', { name: 'Open Zz Alder Apparel' })).toBeInTheDocument();
  expect(r1.querySelector('.hk-rowacts__full')).not.toBeNull();
  expect(screen.getByRole('columnheader', { name: 'Target' })).toHaveTextContent(/^TargetTarget$/);
});

test('U6 forest bulk bar on 3 selected rows: Pitch n ready (amber, ready rows only) · Research n ~$ · Claim · + Target · + Pipeline · Set status ▾ · Copy batch command; selected rows tinted', async () => {
  const list = listOf();
  render(<BrandsScreen businessId={HK} shell={shell('owner')} compact={false} canEdit onOpenBrand={() => {}} list={list} />);
  for (const n of ['Zz Alder Apparel', 'Zz Birch Bars', 'Zz Cedar Cola']) fireEvent.click(screen.getByRole('checkbox', { name: `Select ${n}` }));
  const bar = screen.getByRole('toolbar', { name: 'Bulk actions' });
  expect(bar).toHaveClass('hk-fbulk');
  expect(within(bar).getAllByRole('button').map(b => b.textContent.trim())).toEqual(['Pitch 1 ready', 'Research 1 · ~$0.05', 'Claim', '+ Target', '+ Pipeline', 'Set status ▾', 'Copy batch command', 'More ▾']);
  expect(within(bar).getByRole('button', { name: 'Pitch 1 ready' })).toHaveClass('hk-fbulk__btn--amber');
  expect(screen.getByText('Zz Alder Apparel').closest('tr').getAttribute('style')).toMatch(/--ui-row-tint/);
  fireEvent.click(within(bar).getByRole('button', { name: 'Copy batch command' }));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hk pitch alderapparel.invalid'));
  fireEvent.click(within(bar).getByRole('button', { name: 'Set status ▾' }));
  expect(within(bar).getAllByRole('menuitem').map(m => m.textContent)).toEqual(['Meeting', 'Signed', 'Passed', 'Skipped']);
});

test('Bulk Pitch claims each ready brand through Pitch and copies ONE hk pitch line; bulk Research asks with the estimate first, then one brand per request', async () => {
  routes[`POST /api/hk/${HK}/brands/b1/pitch`] = { claimed: true, command: 'hk pitch alderapparel.invalid', brand: { id: 'b1', updated_at: 't1' } };
  routes[`POST /api/hk/${HK}/research/batch`] = b => ({ results: [{ brand_id: b.brand_ids[0], status: 'researched', cost_usd: 0.05 }], stopped: null });
  const list = listOf();
  render(<BrandsScreen businessId={HK} shell={shell('owner')} compact={false} canEdit onOpenBrand={() => {}} list={list} />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Zz Alder Apparel' })); fireEvent.click(screen.getByRole('checkbox', { name: 'Select Zz Birch Bars' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pitch 1 ready' }));
  expect(await screen.findByText('Pitched 1 brand. Copied hk pitch alderapparel.invalid. Paste into Claude.')).toBeInTheDocument();
  expect(bodies[`POST /api/hk/${HK}/brands/b1/pitch`]).toEqual([{}]);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Zz Birch Bars' }));
  fireEvent.click(screen.getByRole('button', { name: 'Research 1 · ~$0.05' }));
  const ask = screen.getByRole('alertdialog', { name: 'Research these brands?' });
  expect(ask).toHaveTextContent('Research 1 brand · about $0.05.');
  expect(bodies[`POST /api/hk/${HK}/research/batch`]).toBeUndefined();
  fireEvent.click(within(ask).getByRole('button', { name: 'Research 1' }));
  expect(await screen.findByText('Researched 1 brand ($0.05).')).toBeInTheDocument();
  expect(bodies[`POST /api/hk/${HK}/research/batch`]).toEqual([{ brand_ids: ['b2'], confirm: true }]);
});

test('Sort control: Score, high to low sets sort=score in the view state', () => {
  const setState = jest.fn();
  render(<BrandsSpace businessId={HK} shell={shell('owner')} compact={false} canEdit state={{ view: 'targets', filters: {}, q: '', sort: null, dir: null, layout: null, saved: null }} setState={setState} list={listOf()} onOpenBrand={() => {}} />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), { target: { value: 'score' } });
  expect(setState).toHaveBeenCalledWith(expect.objectContaining({ sort: 'score', dir: null }));
  expect(screen.queryByRole('button', { name: /Columns|Export CSV/ })).toBeNull();
});

test('Viewer: rows and labels read; no checkboxes, primary, quick commands or bulk bar; the chevron still opens the brand', () => {
  const onOpenBrand = jest.fn();
  render(<BrandsScreen businessId={HK} shell={shell('viewer')} compact={false} canEdit={false} onOpenBrand={onOpenBrand} list={listOf()} />);
  expect(document.querySelectorAll('input[type="checkbox"], [data-hk-primary], .hk-qcs, [data-hk-bulk]').length).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'Open Zz Alder Apparel' }));
  expect(onOpenBrand).toHaveBeenCalledWith('b1');
});

test('Bulk More ▾: Release releases each selected brand; Mark do-not-contact asks for a reason first, then sends it with each', async () => {
  routes[`PATCH /api/hk/${HK}/brands/b1`] = { brand: { id: 'b1' } }; routes[`PATCH /api/hk/${HK}/brands/b2`] = { brand: { id: 'b2' } };
  const list = listOf();
  render(<BrandsScreen businessId={HK} shell={shell('owner')} compact={false} canEdit onOpenBrand={() => {}} list={list} />);
  const pick = () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Select Zz Alder Apparel' })); fireEvent.click(screen.getByRole('checkbox', { name: 'Select Zz Birch Bars' })); };
  pick();
  fireEvent.click(screen.getByRole('button', { name: 'More ▾' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Release' }));
  await waitFor(() => expect([bodies[`PATCH /api/hk/${HK}/brands/b1`], bodies[`PATCH /api/hk/${HK}/brands/b2`]]).toEqual([[{ claim: false }], [{ claim: false }]]));
  await waitFor(() => expect(list.reload).toHaveBeenCalled());
  pick();
  fireEvent.click(screen.getByRole('button', { name: 'More ▾' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Mark do-not-contact…' }));
  const form = screen.getByRole('form', { name: 'Mark do-not-contact' });
  expect(within(form).getByRole('button', { name: 'Mark do-not-contact' })).toBeDisabled();
  fireEvent.change(within(form).getByRole('textbox'), { target: { value: 'Asked us to stop' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Mark do-not-contact' }));
  await waitFor(() => expect(bodies[`PATCH /api/hk/${HK}/brands/b2`][1]).toEqual({ relationship: 'do_not_contact', dnc_reason: 'Asked us to stop' }));
  expect(bodies[`PATCH /api/hk/${HK}/brands/b1`][1]).toEqual({ relationship: 'do_not_contact', dnc_reason: 'Asked us to stop' });
});
