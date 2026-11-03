import { render, screen } from '@testing-library/react';
import { buildActionContext } from './ActionItemsTab';
import { buildContext } from './DealTimeline';
import CallPrepModal from './CallPrepModal';
import AccountCardComms from './AccountCardComms';
import { clearLegacyPricingKeys, LEGACY_PRICING_KEYS } from '../utils/storage';

const SENTINEL = 'ZZ_LEGACY_PRICING_SENTINEL';
const acc = { id: 'a1', name: 'Acme Test', stage: 'Active Deal', vert: 'Retail', calls: [], prods: [] };
const seed = () => {
  const row = { a1: { products: [{ name: SENTINEL, included: true }], monthlyUsers: [9999], commitFee: 4242, convRate: 77, pfTier: SENTINEL } };
  localStorage.setItem('prospector_pricing_files', JSON.stringify(row));
  localStorage.setItem('prospector_pricing_intel', JSON.stringify(row));
  localStorage.setItem('prospector_pricing_snapshots', JSON.stringify({ a1: [{ id: 's1', name: SENTINEL, savedAt: 'x' }] }));
};
let getItem;
beforeEach(() => { localStorage.clear(); seed(); getItem = jest.spyOn(Storage.prototype, 'getItem'); global.fetch = jest.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })); });
afterEach(() => { getItem.mockRestore(); });
const legacyReads = () => getItem.mock.calls.filter(([k]) => LEGACY_PRICING_KEYS.includes(k));

test('Action Items prompt context carries nothing from the old pricing keys and never reads them', () => {
  const ctx = buildActionContext(acc, []);
  expect(ctx).not.toMatch(SENTINEL);
  expect(ctx).not.toMatch(/PRICING|Quote exists|4242/);
  expect(legacyReads()).toEqual([]);
});

test('Deal Timeline prompt context carries nothing from the old pricing keys and never reads them', () => {
  const ctx = buildContext(acc);
  expect(ctx).not.toMatch(SENTINEL);
  expect(ctx).not.toMatch(/PRICING & QUOTE|Pricing intelligence|4242|77%/);
  expect(legacyReads()).toEqual([]);
});

test('Call Prep renders with the keys present and shows no pricing source or Deal Snapshot', () => {
  render(<CallPrepModal acc={acc} tasks={[]} onClose={() => {}} />);
  expect(screen.queryByText('Pricing intel')).toBeNull();
  expect(screen.queryByText('Deal Snapshot')).toBeNull();
  expect(document.body.textContent).not.toMatch(SENTINEL);
  expect(legacyReads()).toEqual([]);
});

test('Comms renders with the keys present and shows nothing from them', () => {
  render(<AccountCardComms acc={acc} tasks={[]} activeUser={{ name: 'Jack' }} onUpdate={() => {}} />);
  expect(document.body.textContent).not.toMatch(SENTINEL);
  expect(legacyReads()).toEqual([]);
});

test('load cleanup removes exactly the three legacy keys', () => {
  localStorage.setItem('prospector_compliance', '{}');
  localStorage.setItem('prospector_deal_review_a1', 'keep');
  localStorage.setItem('sb-ref-auth-token', 'keep');
  clearLegacyPricingKeys();
  for (const k of LEGACY_PRICING_KEYS) expect(localStorage.getItem(k)).toBeNull();
  expect(Object.keys(localStorage).sort()).toEqual(['prospector_compliance', 'prospector_deal_review_a1', 'sb-ref-auth-token']);
  clearLegacyPricingKeys();
  expect(localStorage.length).toBe(3);
});
