import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import SponsorMoney from './SponsorMoney';
import DealCard from './DealCard';
import { Details } from './BrandRail';
import { StatusLine } from '../inbox/IntelCard';
import { rowChips } from '../inbox/InboxRows';
import { brandBuckets } from '../nav/railBuckets';
import { valueLabel, brandRequest } from '../nav/filterState';

// grow-sponsor-deals-v1 Stage 4 - synthetic: the Sponsor money table + cell filters, the rail's Deal group, the Deal card
// (state chips with words, edit + Undo with expect, copy to next + Undo, remove = archive + restore, suggestions, Viewer),
// the Instagram handle links, the Inbox status line. Invented brands; recorded fetch.
const HK = 'biz-hk', B = 'b1';
let routes, bodies;
const json = (status, body) => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });
beforeEach(() => {
  routes = {}; bodies = {};
  global.fetch = jest.fn((url, init = {}) => {
    const key = `${init.method || 'GET'} ${new URL(url, 'http://x').pathname}`;
    if (init.body) (bodies[key] ||= []).push(JSON.parse(init.body));
    const hit = routes[key]; return hit ? json(200, typeof hit === 'function' ? hit(init.body ? JSON.parse(init.body) : null) : hit) : json(404, { error: `no route ${key}` });
  });
});

const MONEY = { this_month: '2026-11', default_monthly_usd: 150, months: [
  { month: '2026-10', confirmed_usd: null, paid_usd: null, unpaid_usd: null, discussing_usd: null, confirmed: 12, discussing: 0, declined: 0, paid: 0, without_amount: 12 },
  { month: '2026-11', confirmed_usd: 1050, paid_usd: 1050, unpaid_usd: 0, discussing_usd: 450, confirmed: 19, discussing: 6, declined: 0, paid: 7, without_amount: 9 },
], totals: { confirmed_usd: 1050, paid_usd: 1050, unpaid_usd: 0, discussing_usd: 450, if_all_close_usd: 1500 } };

test('S4 Sponsor money: confirmed and in discussion side by side, "—" without amounts, a cell filters the list to month + state', async () => {
  routes[`GET /api/hk/${HK}/deals/money`] = MONEY;
  const onPick = jest.fn();
  render(<SponsorMoney businessId={HK} onPick={onPick} />);
  const nov = await screen.findByText('Nov 2026');
  const row = nov.closest('tr');
  expect([...row.querySelectorAll('td')].map(td => td.textContent)).toEqual(['$1,050', '$1,050', '$0', '$450', '19', '6', '0']);
  expect([...screen.getByText('Oct 2026').closest('tr').querySelectorAll('td')].map(td => td.textContent)).toEqual(['—', '—', '—', '—', '12', '0', '0']);
  expect(document.querySelector('[data-hk-money-if-all]')).toHaveTextContent('If everything in discussion closes: $1,500 across these 2 months ($1,050 confirmed + $450 in discussion).');
  fireEvent.click(within(row).getByRole('button', { name: 'In discussion, Nov 2026: $450' }));
  expect(onPick).toHaveBeenLastCalledWith({ month: ['2026-11:discussing'] });
  fireEvent.click(within(row).getByRole('button', { name: 'Paid, Nov 2026: $1,050' }));
  expect(onPick).toHaveBeenLastCalledWith({ month: ['2026-11:confirmed'], paid: ['paid'] });
});

test('S5 rail Deal group: Deal stage with words, one line per sponsor month with its state counts, a money-cell value shows while on', () => {
  const facets = { deal_stage: [['sponsor', 19], ['discussing', 6]], month: [['2026-12', 11], ['2026-12:confirmed', 3], ['2026-12:discussing', 8], ['2026-11', 25], ['2026-11:confirmed', 19], ['2026-11:discussing', 6]], paid: [['paid', 7]], amount: [['set', 10]] };
  const out = brandBuckets({ facets, state: { view: 'money', filters: { month: ['2026-11:discussing'] } }, meId: 'u', members: [] });
  const of = k => out.find(b => b.key === k);
  expect(of('deal_stage').items.map(i => [i.label, i.count, i.tone])).toEqual([['Sponsor', 19, 'green'], ['In discussion', 6, 'mustard']]);
  expect(of('month').items.map(i => [i.label, i.active])).toEqual([['Dec 2026 · confirmed 3 · discussing 8', false], ['Nov 2026 · confirmed 19 · discussing 6', false], ['Nov 2026 · in discussion', true]]);
  expect([of('paid').label, valueLabel('paid', 'unpaid'), valueLabel('amount', 'not_set')]).toEqual(['Paid', 'Unpaid (confirmed)', 'No amount']);
  expect(brandRequest({ view: 'money', filters: {} }, 'me').owner).toBeUndefined();
  expect(brandRequest({ view: 'all', filters: {} }, 'me').owner).toBe('me');
});

const month = over => ({ id: 'p1', brand_id: B, period: '2026-11', kind: 'monthly', state: 'confirmed', amount_usd: 150, paid: true, deal_type: 'Challenge / Reward', details: { 'Discount code': 'HK10' }, note: null, source: 'sheet', ...over });
const deal = over => ({ stage: 'sponsor', months: [month(), month({ id: 'p0', period: '2026-10', state: 'discussing', amount_usd: null, paid: false, details: {}, deal_type: null })], suggestions: { confirm: [], use_amount: [], notes: [] }, default_monthly_usd: 150, ...over });
const card = (props = {}) => render(<DealCard businessId={HK} brand={{ id: B, name: 'Zz Fig Bakery', relationship: 'sponsor' }} deal={deal()} canEdit isOwnerRole onChanged={jest.fn(() => Promise.resolve())} {...props} />);

test('S6 Deal card: stage chip, months newest first with state words, amount, Paid, Details; state edit + Undo sends the old value back with expect + source', async () => {
  const P = `/api/hk/${HK}/sponsors/${B}/periods/p1`;
  routes[`PATCH ${P}`] = b => (b.expect ? { period: month(), prev: {}, changed: ['state'] } : { period: month({ state: 'discussing', source: 'user' }), prev: { state: 'confirmed', source: 'sheet' }, changed: ['state'] });
  card();
  const c = screen.getByRole('region', { name: 'Deal' });
  expect(c.querySelector('[data-hk-deal-stage]')).toHaveTextContent('Sponsor');
  expect([...c.querySelectorAll('[data-hk-month]')].map(li => li.dataset.hkMonth)).toEqual(['2026-11', '2026-10']);
  const nov = c.querySelector('[data-hk-month="2026-11"]');
  expect(nov.querySelector('[data-hk-month-state]')).toHaveTextContent('Confirmed');
  expect(nov).toHaveTextContent('$150'); expect(nov.querySelector('[data-hk-month-paid]')).toHaveTextContent('Paid');
  expect(c.querySelector('[data-hk-month="2026-10"] [data-hk-month-state]')).toHaveTextContent('In discussion');
  expect(within(nov).getByText('Discount code').closest('div')).toHaveTextContent('HK10');
  fireEvent.change(within(nov).getByLabelText('Nov 2026 state'), { target: { value: 'discussing' } });
  await waitFor(() => expect(bodies[`PATCH ${P}`]).toEqual([{ state: 'discussing' }]));
  const undo = await screen.findByText(/Nov 2026 → In discussion/);
  fireEvent.click(within(undo).getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(bodies[`PATCH ${P}`][1]).toEqual({ state: 'confirmed', source: 'sheet', expect: { state: 'discussing' } }));
});

test('S6 Copy to next month (Undo archives it), Remove = archive (Undo restores), Add month posts the default amount unless changed', async () => {
  const base = `/api/hk/${HK}/sponsors/${B}/periods`;
  routes[`POST ${base}/p1/copy-next`] = { period: month({ id: 'p2', period: '2026-12', state: 'discussing' }), undo: { archive: 'p2' } };
  routes[`DELETE ${base}/p2`] = { ok: true, undo: { restore: 'p2' } };
  routes[`DELETE ${base}/p1`] = { ok: true, undo: { restore: 'p1' } };
  routes[`POST ${base}/p1/restore`] = { ok: true };
  routes[`POST ${base}`] = { period: month({ id: 'p3', period: '2027-01' }), undo: { archive: 'p3' } };
  card();
  const nov = document.querySelector('[data-hk-month="2026-11"]');
  fireEvent.click(within(nov).getByRole('button', { name: 'Copy to next month' }));
  fireEvent.click(within(await screen.findByText(/Dec 2026 added as In discussion/)).getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(global.fetch.mock.calls.some(([u, i]) => i?.method === 'DELETE' && u.endsWith('/periods/p2'))).toBe(true));
  await waitFor(() => expect(document.querySelector('[data-hk-deal-undo]')).toBeNull());
  fireEvent.click(within(nov).getByRole('button', { name: 'Remove' }));
  fireEvent.click(within(await screen.findByText(/Nov 2026 removed/)).getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(bodies[`POST ${base}/p1/restore`]).toEqual([{}]));
  await waitFor(() => expect(document.querySelector('[data-hk-deal-undo]')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '+ Add month' }));
  const form = document.querySelector('[data-hk-month-form]');
  expect(within(form).getByLabelText('Amount in dollars')).toHaveValue('150');
  fireEvent.change(within(form).getByLabelText('Month'), { target: { value: '2027-01' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Add month' }));
  await waitFor(() => expect(bodies[`POST ${base}`]).toEqual([{ period: '2027-01', state: 'discussing', amount_usd: 150 }]));
});

test('S6 ruling 3 suggestions are a click, not a write; a Viewer sees the months with no controls; a member sees no Remove', async () => {
  routes[`PATCH /api/hk/${HK}/sponsors/${B}/periods/p0`] = { period: month({ id: 'p0', period: '2026-10' }), prev: { state: 'discussing', source: 'sheet' }, changed: ['state'] };
  const r = card({ deal: deal({ suggestions: { confirm: [{ thread_id: 't1', month: '2026-10', period_id: 'p0' }], use_amount: [], notes: [{ thread_id: 't1', month: '2026-11', words: 'Email says $200 - the month says $150' }] } }) });
  expect(document.querySelector('[data-hk-deal-suggest="confirm"]')).toHaveTextContent('Email says Oct 2026 is confirmed.');
  expect(document.querySelector('[data-hk-deal-note]')).toHaveTextContent('Email says $200 - the month says $150');
  expect(global.fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm?' }));
  await waitFor(() => expect(bodies[`PATCH /api/hk/${HK}/sponsors/${B}/periods/p0`]).toEqual([{ state: 'confirmed' }]));
  r.unmount();
  card({ canEdit: false, isOwnerRole: false });
  const c = screen.getByRole('region', { name: 'Deal' });
  expect(c.querySelectorAll('[data-hk-month]').length).toBe(2);
  expect(within(c).queryAllByRole('button').length).toBe(0); expect(within(c).queryAllByRole('combobox').length).toBe(0);
  render(<DealCard businessId={HK} brand={{ id: 'b2', name: 'Zz Member', relationship: 'sponsor' }} deal={deal()} canEdit isOwnerRole={false} onChanged={jest.fn()} />);
  expect(screen.queryAllByRole('button', { name: 'Remove' }).length).toBe(0);
  expect(screen.getAllByRole('button', { name: 'Copy to next month' }).length).toBe(1);
});

test('S8 Details: the Instagram handle shows as @handle with Open DM (ig.me) and Open profile; edit saves through PATCH', async () => {
  routes[`PATCH /api/hk/${HK}/brands/${B}`] = { brand: { id: B } };
  const onChanged = jest.fn(() => Promise.resolve());
  render(<Details businessId={HK} brand={{ id: B, name: 'Zz Fig Bakery', source: 'import', relationship: 'sponsor', instagram_handle: 'zz.fig_bakery' }} research={null} owner={null} canEdit onChanged={onChanged} />);
  const row = document.querySelector('[data-hk-detail="Instagram"]');
  expect(row).toHaveTextContent('@zz.fig_bakery');
  expect(within(row).getByRole('link', { name: 'Open DM' })).toHaveAttribute('href', 'https://ig.me/m/zz.fig_bakery');
  expect(within(row).getByRole('link', { name: 'Open profile' })).toHaveAttribute('href', 'https://instagram.com/zz.fig_bakery');
  fireEvent.click(within(row).getByRole('button', { name: 'Edit Instagram' }));
  fireEvent.change(screen.getByLabelText('Instagram handle'), { target: { value: '' } });
  fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(bodies[`PATCH /api/hk/${HK}/brands/${B}`]).toEqual([{ instagram_handle: null }]));
});

test('S7 status line: a saved brand reads brand · deal stage · owner · open month + who reached out + Open DM; a new sender reads New · not in Grow; the row chip says it too', () => {
  const s = { kind: 'saved', brand_id: B, brand_name: 'Zz Fig Bakery', deal_stage: 'discussing', owner_words: 'Yours', open_month: { period: '2026-11', state: 'discussing', words: 'Nov: in discussion' }, reached: { mine: false, first_name: 'Sky', line: 'Sky emailed them Oct 28' }, instagram_handle: 'zzfig', line: 'Zz Fig Bakery · In discussion · Yours · Nov: in discussion' };
  const onOpenBrand = jest.fn();
  const { container } = render(<StatusLine s={s} onOpenBrand={onOpenBrand} />);
  expect(container.firstChild).toHaveTextContent('Zz Fig Bakery' + 'In discussion' + 'Yours' + 'Nov: in discussion' + 'Sky emailed them Oct 28');
  expect(screen.getByRole('link', { name: 'Open DM' })).toHaveAttribute('href', 'https://ig.me/m/zzfig');
  fireEvent.click(screen.getByRole('button', { name: 'Zz Fig Bakery' }));
  expect(onOpenBrand).toHaveBeenCalledWith(B);
  render(<StatusLine s={{ kind: 'new', line: 'New · not in Grow' }} onOpenBrand={onOpenBrand} />);
  expect(document.querySelector('[data-hk-status-line="new"]')).toHaveTextContent('New · not in Grow');
  const chips = rowChips({ chip: { kind: 'matches', brand_id: B, brand_name: 'Zz Fig Bakery' }, status_line: s });
  expect(chips[0].text).toBe('Zz Fig Bakery · In discussion · Yours · Nov: in discussion · Sky emailed them Oct 28');
  expect(rowChips({ chip: { kind: 'untracked' }, status_line: { kind: 'new' } })[0].text).toBe('New · not in Grow');
});
