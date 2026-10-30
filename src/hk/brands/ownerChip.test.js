import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import OwnerChip from './OwnerChip';
import BrandPage from './BrandPage';
import BrandsScreen from './BrandsScreen';
import ReachLine from './ReachLine';
import Briefing from '../inbox/Briefing';

// grow-owner-chip-and-site-label - the owner chip (member / sheet owner / none) on the brand page, Brands rows, phone
// cards; Save as website / Wrong site + Undo (on Briefing rows: Yes, save / Wrong site in the expand). Invented brands; no address in any fixture.
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
    const hit = routes[key]; return hit ? json(200, typeof hit === 'function' ? hit(init.body ? JSON.parse(init.body) : null) : hit) : json(404, { error: `no route ${key}` });
  });
});
const brand = over => ({ id: 'b1', name: 'Zz Alder Oats', domain: null, status: 'claimed', relationship: 'prospect', owner_user_id: null, owner_hint: null, is_local: false, category: null, source: 'import', heat_band: 'cold', targeted_at: null, updated_at: '2026-10-29T15:00:00Z', created_at: '2026-10-27T00:00:00Z', ...over });

test('OwnerChip: member -> avatar + first name; sheet owner -> "Sheet: Pete · not in Grow yet"; neither -> Unclaimed', () => {
  const { container, rerender } = render(<OwnerChip owner={members[1]} hint="pete" />);
  expect(container).toHaveTextContent('Sky'); expect(container).not.toHaveTextContent('Sheet');
  rerender(<OwnerChip hint="pete" chip />);
  expect(container).toHaveTextContent('Sheet: Pete · not in Grow yet'); expect(container.firstChild).toHaveClass('hk-chip--grey');
  rerender(<OwnerChip hint="  " />);
  expect(container).toHaveTextContent('Unclaimed');
});

const openPage = async b => {
  routes[`GET /api/hk/${HK}/brands/b1`] = { brand: b, contacts: [], touches: [], replies: [], events: [], verdict: null, email_touches_sent: 0, max_email_touches: 3 };
  routes[`GET /api/hk/${HK}/brands/b1/reach`] = { eligible: false, score: 0, why: [], research: null, suggestion: null, research_attempted_at: null };
  const r = render(<BrandPage businessId={HK} brandId="b1" shell={shell('owner')} canEdit onBack={() => {}} />);
  await screen.findByRole('heading', { name: 'Zz Alder Oats' });
  return r;
};

test('Brand page: Claimed with a sheet owner never shows Unclaimed; a member owner shows the name; no owner at all stays Unclaimed', async () => {
  const a = await openPage(brand({ owner_hint: 'pete' }));
  expect(screen.getByText('Claimed')).toBeInTheDocument();
  expect(screen.getByText('Sheet: Pete · not in Grow yet')).toBeInTheDocument();
  expect(screen.queryByText('Unclaimed')).toBeNull();
  a.unmount();
  const b = await openPage(brand({ owner_user_id: 'u-sky', owner_hint: 'pete' }));
  expect(document.querySelector('[data-hk-owner="member"]')).toHaveTextContent('Sky');
  expect(screen.queryByText(/Sheet:/)).toBeNull();
  b.unmount();
  await openPage(brand({ status: 'candidate' }));
  expect(screen.getByText('Unclaimed')).toBeInTheDocument();
});

const ROWS = [brand(), brand({ id: 'b2', name: 'Zz Birch Bars', owner_hint: 'pete' }), brand({ id: 'b3', name: 'Zz Cedar Cola', owner_user_id: 'u-sky' })];
const rowOf = name => screen.getByText(name).closest('tr');

test('Brands rows and phone cards: member / sheet owner / Unclaimed, never Claimed + Unclaimed when a hint exists', async () => {
  const list = { rows: ROWS, total: ROWS.length, facets: null, next: null, loading: false, error: '', loadMore: () => {}, reload: async () => {} };
  const { unmount } = render(<BrandsScreen businessId={HK} shell={shell('owner')} compact={false} canEdit={false} onOpenBrand={() => {}} list={list} />);
  await screen.findByText('Zz Birch Bars');
  expect(within(rowOf('Zz Birch Bars')).getByText('Sheet: Pete · not in Grow yet')).toBeInTheDocument();
  expect(within(rowOf('Zz Birch Bars')).queryByText('Unclaimed')).toBeNull();
  expect(within(rowOf('Zz Cedar Cola')).getByText('Sky')).toBeInTheDocument();
  expect(within(rowOf('Zz Alder Oats')).getByText('Unclaimed')).toBeInTheDocument();
  unmount();
  render(<BrandsScreen businessId={HK} shell={shell('owner')} compact canEdit={false} onOpenBrand={() => {}} list={list} />);
  const card = (await screen.findByText('Zz Birch Bars')).closest('[data-hk-brand]');
  expect(within(card).getByText('Sheet: Pete · not in Grow yet')).toBeInTheDocument();
  expect(within(card).queryByText('Unclaimed')).toBeNull();
});

const card = over => ({ id: 'b1', name: 'Zz Alder Oats', domain: null, category: null, city: null, status: 'claimed', owner_user_id: null, owner_hint: null, heat_band: 'cold', score: 10, why: [], parts: [], score_parts: [{ key: 'website', words: 'has a website', points: 10 }], primary: { kind: 'research', label: 'Research' }, research: null, suggestion: null, research_attempted_at: null, command: 'hk pitch Zz Alder Oats', contact: null, ...over });
const BRIEF = sends => ({ owner: 'me', tiles: { replies_waiting: 0, hot: 0, drafts: 0, followups_due: 0, dms_due: 0, sent_week: 0, reply_rate_week: null, researched_today: { n: 0, cap: 10 } }, send: sends, waiting: [], eligible: 3, research: { on: true, n: 10, cap_usd: 1, time: '06:30', today_calls: 0, today_spend: 0 } });

test('Briefing rows (grow-ui-refresh U4): a suggested website shows beside the name and in the expand as "Website (suggested)" with Yes, save + Wrong site, Undo restores', async () => {
  let suggestion = { domain: 'alderoats.invalid', confidence: 'high' };
  routes[`GET /api/hk/${HK}/briefing`] = () => BRIEF([card({ suggestion })]);
  routes[`GET /api/hk/${HK}/signals`] = { prospects: [], sponsors: [], unseen_hot_warm: 0 };
  routes[`POST /api/hk/${HK}/brands/b1/wrong-site`] = b => { suggestion = b.undo ? { domain: 'alderoats.invalid', confidence: 'high' } : null; return { brand: { id: 'b1' } }; };
  render(<Briefing businessId={HK} shell={shell('owner')} owner="me" canEdit rows={[]} listReady onOpenThread={() => {}} onOpenBrand={() => {}} onGo={() => {}} onLane={() => {}} />);
  const r1 = (await screen.findByText('Zz Alder Oats')).closest('[data-hk-send-row]');
  expect(within(r1).getByText('alderoats.invalid · suggested')).toBeInTheDocument();
  fireEvent.click(within(r1).getByRole('button', { name: 'Expand Zz Alder Oats' }));
  const ex = r1.querySelector('[data-hk-expand]');
  expect(within(ex).getByText(/Website \(suggested\): alderoats.invalid/)).toBeInTheDocument();
  expect(within(ex).getByRole('button', { name: 'Yes, save' })).toBeInTheDocument();
  fireEvent.click(within(ex).getByRole('button', { name: 'Wrong site' }));
  expect(await within(r1).findByText(/alderoats.invalid marked wrong/)).toBeInTheDocument();
  fireEvent.click(within(r1).getByRole('button', { name: 'Undo' }));
  expect(await within(r1).findByText(/Website \(suggested\): alderoats.invalid/)).toBeInTheDocument();
  expect(bodies[`POST /api/hk/${HK}/brands/b1/wrong-site`]).toEqual([{}, { undo: true }]);
});

test('Brand page reach line: low confidence keeps "Possible website" with both buttons; Wrong site keeps the Undo across the reload; Viewer sees no buttons', async () => {
  let suggestion = { domain: 'cedar.invalid', confidence: 'low' };
  routes[`GET /api/hk/${HK}/brands/b1/reach`] = () => ({ eligible: true, score: 5, why: [], research: null, suggestion, research_attempted_at: suggestion ? null : '2026-10-29T15:00:00Z' });
  routes[`POST /api/hk/${HK}/brands/b1/wrong-site`] = b => { suggestion = b.undo ? { domain: 'cedar.invalid', confidence: 'low' } : null; return { brand: { id: 'b1' } }; };
  const onChanged = jest.fn();
  const { unmount } = render(<ReachLine businessId={HK} brandId="b1" canEdit onChanged={onChanged} />);
  expect(await screen.findByText(/Possible website: cedar.invalid\?/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Wrong site' }));
  expect(await screen.findByText(/cedar.invalid marked wrong. Not researched again for 30 days./)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(await screen.findByText(/Possible website: cedar.invalid\?/)).toBeInTheDocument();
  expect(onChanged).not.toHaveBeenCalled();
  unmount();
  render(<ReachLine businessId={HK} brandId="b1" canEdit={false} />);
  await screen.findByText(/Possible website: cedar.invalid\?/);
  expect(screen.queryByRole('button')).toBeNull();
});
