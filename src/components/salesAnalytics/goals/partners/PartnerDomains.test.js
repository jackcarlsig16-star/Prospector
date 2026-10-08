import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import PartnerDomains from './PartnerDomains';
import ApolloExport from './ApolloExport';

// partner-360-v1 Stage 2 - Corestream-shaped: the sheet says
// corp.corestream.com, Apollo has corestream.com under the same name.
const partner = { id: 'p5', name: 'Corestream' };
const empty = { domains: [], suggestions: [
  { domain: 'corp.corestream.com', source: 'sources', apollo_account: null },
  { domain: 'corestream.com', source: 'apollo', apollo_account: { id: 'a4', name: 'Corestream', domain: 'corestream.com' } },
], apollo_account: null };
const confirmed = { domains: [{ id: 'd1', domain: 'corestream.com', confirmed: true, is_primary: true, source: 'apollo' }], suggestions: [{ domain: 'corp.corestream.com', source: 'sources', apollo_account: null }], apollo_account: { id: 'a4', name: 'Corestream', domain: 'corestream.com' } };

function setup(data = empty, canEdit = true) {
  const api = { load: jest.fn().mockResolvedValue(data), add: jest.fn().mockResolvedValue(confirmed), update: jest.fn().mockResolvedValue(confirmed), remove: jest.fn().mockResolvedValue(empty) };
  render(<PartnerDomains partner={partner} canEdit={canEdit} api={api} />);
  return api;
}

test('suggestions show with their source; confirm posts the domain and the reply replaces the view', async () => {
  const api = setup();
  const list = await screen.findByRole('list', { name: 'Suggested domains' });
  expect(within(list).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Suggested', expect.stringMatching(/corp\.corestream\.com.*Sheet/), expect.stringMatching(/corestream\.com.*Apollo/)]);
  expect(screen.getByText('none confirmed')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm corestream.com' }));
  await waitFor(() => expect(api.add).toHaveBeenCalledWith('p5', { domain: 'corestream.com' }));
  await screen.findByText('Apollo account: Corestream (corestream.com)');
  expect(screen.getByLabelText('primary')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Confirm corestream.com' })).toBeNull();
});

test('dismiss posts dismiss: true; add domain by hand; edit and remove call the api', async () => {
  const api = setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Dismiss corp.corestream.com' }));
  await waitFor(() => expect(api.add).toHaveBeenCalledWith('p5', { domain: 'corp.corestream.com', dismiss: true }));
  fireEvent.click(screen.getByRole('button', { name: '+ Add domain' }));
  fireEvent.change(screen.getByLabelText('New domain'), { target: { value: 'Corestream.io' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  await waitFor(() => expect(api.add).toHaveBeenCalledWith('p5', { domain: 'Corestream.io' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Edit corestream.com' }));
  fireEvent.change(screen.getByLabelText('Edit domain'), { target: { value: 'corestream.net' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.update).toHaveBeenCalledWith('p5', 'd1', { domain: 'corestream.net' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Remove corestream.com' }));
  await waitFor(() => expect(api.remove).toHaveBeenCalledWith('p5', 'd1'));
});

test('viewer: domains and suggestions as text, no buttons; api error shows', async () => {
  setup(confirmed, false);
  await screen.findByText('corestream.com');
  expect(screen.getByRole('list', { name: 'Suggested domains' })).toBeTruthy();
  expect(within(screen.getByRole('group', { name: 'Domains' })).queryAllByRole('button')).toHaveLength(0);
  const api = { load: jest.fn().mockRejectedValue(new Error('boom')), add: jest.fn(), update: jest.fn(), remove: jest.fn() };
  render(<PartnerDomains partner={{ id: 'p9', name: 'X' }} canEdit api={api} />);
  await screen.findByText('boom');
});

test('ApolloExport: counts + candidate list, download fetches the csv url and saves a blob', async () => {
  const load = jest.fn().mockResolvedValue({ domains: [], candidates: [{ name: 'Justworks', domain: 'justworks.com' }, { name: 'EBG', domain: 'ebgsolutions.com' }], counts: { partners: 75, confirmed: 3, in_apollo: 1 }, snapshot_at: null });
  const blob = new Blob(['Company Name,Website\r\nJustworks,justworks.com\r\n'], { type: 'text/csv' });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob), headers: { get: () => 'attachment; filename="partners-for-apollo-2026-10-07.csv"' } });
  URL.createObjectURL = jest.fn(() => 'blob:x'); URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<ApolloExport load={load} csvUrl="/api/sales/b1/goals/partners/export-apollo.csv" onClose={jest.fn()} />);
  await screen.findByText('2 to export');
  expect(within(screen.getByRole('list', { name: 'Partners to export' })).getAllByRole('listitem')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/sales/b1/goals/partners/export-apollo.csv'));
  await waitFor(() => expect(click).toHaveBeenCalled());
  expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
  click.mockRestore();
});

test('ApolloExport: nothing to export disables the button', async () => {
  render(<ApolloExport load={jest.fn().mockResolvedValue({ domains: [], candidates: [], counts: { partners: 75, confirmed: 0, in_apollo: 0 } })} csvUrl="/x" onClose={jest.fn()} />);
  await screen.findByText(/Nothing to export yet/);
  expect(screen.getByRole('button', { name: 'Download CSV' })).toBeDisabled();
});
