import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { IcpChip } from './BrandLabels';
import MoveToPartnerships from './MoveToPartnerships';
import IcpSettings from '../screens/IcpSettings';
import { hkGet, hkPatch } from '../hkApi';

jest.mock('../hkApi', () => ({ hkGet: jest.fn(), hkPatch: jest.fn(), hkPost: jest.fn() }));
beforeEach(() => { hkGet.mockReset(); hkPatch.mockReset(); });

test('ICP chip: the word is always shown, tone by verdict', () => {
  const { container, rerender } = render(<IcpChip icp={{ key: 'retail', label: 'Retail brand', points: 40 }} />);
  expect(container.textContent).toBe('ICP Retail brand');
  expect(container.querySelector('.hk-label--green')).not.toBeNull();
  rerender(<IcpChip icp={{ key: 'media', label: 'Podcast', points: -30 }} />);
  expect(container.querySelector('[data-hk-icp="media"]').textContent).toBe('ICP Podcast');
  rerender(<IcpChip icp={null} />);
  expect(container.textContent).toBe('');
});

test('Move to Partnerships: offers the suggested segment, moves with one click, Undo puts sponsor_brand back; hidden for a Viewer or a retail brand', async () => {
  hkPatch.mockResolvedValue({ brand: {}, changed: ['segment'] });
  const onChanged = jest.fn().mockResolvedValue();
  const brand = { id: 'b1', name: 'Zz Mediaish', segment: 'sponsor_brand' };
  const icp = { key: 'media', label: 'Looks like media', points: -30, looks_like: 'podcast' };
  const { container, rerender } = render(<MoveToPartnerships businessId="hk" brand={brand} icp={icp} canEdit onChanged={onChanged} />);
  expect(screen.getByText('Looks like media · Move to Partnerships')).toBeInTheDocument();
  expect(container.querySelector('[data-hk-move-segment]').value).toBe('podcast');
  fireEvent.click(container.querySelector('[data-hk-move-go]'));
  await waitFor(() => expect(hkPatch).toHaveBeenCalledWith('hk', '/brands/b1', { segment: 'podcast' }));
  rerender(<MoveToPartnerships businessId="hk" brand={{ ...brand, segment: 'podcast' }} icp={{ key: 'media', label: 'Podcast', points: -30 }} canEdit onChanged={onChanged} />);
  expect(await screen.findByText('Zz Mediaish moved to Partnerships (Podcast).')).toBeInTheDocument();
  fireEvent.click(container.querySelector('[data-hk-move-undo]'));
  await waitFor(() => expect(hkPatch).toHaveBeenLastCalledWith('hk', '/brands/b1', { segment: 'sponsor_brand' }));
  await waitFor(() => expect(container.querySelector('[data-hk-move-partnerships]')).toBeNull());
  const v = render(<MoveToPartnerships businessId="hk" brand={brand} icp={icp} canEdit={false} onChanged={onChanged} />);
  expect(v.container.querySelector('[data-hk-move-partnerships]')).toBeNull();
  const r = render(<MoveToPartnerships businessId="hk" brand={brand} icp={{ key: 'retail', label: 'Retail brand', points: 40 }} canEdit onChanged={onChanged} />);
  expect(r.container.querySelector('[data-hk-move-partnerships]')).toBeNull();
});

test('Settings > Pitch > Ideal brand: shows the weights + word list, an owner saves intel.icp; a member sees them read-only', async () => {
  hkGet.mockResolvedValue({ icp: { weights: { retail: 40, media: -30, unknown: 20 }, words: ['media', 'podcast'] } });
  hkPatch.mockResolvedValue({});
  const { container, unmount } = render(<IcpSettings businessId="hk" shell={{ me: { role: 'owner' } }} canEdit />);
  await waitFor(() => expect(container.querySelector('[data-hk-icp-weight="retail"]')).not.toBeNull());
  const retail = container.querySelector('[data-hk-icp-weight="retail"]');
  expect(container.querySelector('[data-hk-icp-words]').textContent).toMatch(/media, podcast/);
  expect(container.querySelector('[data-hk-save-icp]')).toBeDisabled();
  fireEvent.change(retail, { target: { value: '55' } });
  fireEvent.click(container.querySelector('[data-hk-save-icp]'));
  await waitFor(() => expect(hkPatch).toHaveBeenCalledWith('hk', '/settings', { intel: { icp: { retail: 55, media: -30, unknown: 20 } } }));
  unmount();
  const m = render(<IcpSettings businessId="hk" shell={{ me: { role: 'member' } }} canEdit />);
  await waitFor(() => expect(m.container.querySelector('[data-hk-icp-weight="retail"]')).toBeDisabled());
  expect(m.container.querySelector('[data-hk-save-icp]')).toBeNull();
});
