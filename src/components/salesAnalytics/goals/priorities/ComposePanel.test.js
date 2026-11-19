import { render, screen, waitFor } from '@testing-library/react';
import ComposePanel from './ComposePanel';
import { goalsApi } from '../goalsApi';

// scout-v3.1 C2 - the Write email panel opened from Scout's inline draft: it shows THAT draft (no second call) and
// says who it is written to; opened the old way it still makes its one call - with the person when there is one.
jest.mock('../goalsApi', () => ({ goalsApi: { compose: jest.fn(), composeLint: jest.fn() } }));
jest.mock('../../../../utils/useMediaQuery', () => () => false);
const DRAFT = { draft: { subject: 'From the call', body: 'Hi there,\n\nWorth 15 minutes?\n\nAna', why: 'w' }, claims: [], lint: { ok: true, issues: [], words: 8 }, cost_usd: 0.02, cap: { used: 2, max: 30 } };
beforeEach(() => { jest.clearAllMocks(); goalsApi.compose.mockResolvedValue(DRAFT); });
const row = extra => ({ type: 'employer', id: 'e1', name: 'Cloudflare', key: 'employer-e1', ...extra });

test('prefilled from Scout: the panel shows that subject and body, makes no compose call, and says the draft is written to the person', async () => {
  render(<ComposePanel businessId="b1" row={row({ to: 'Meagan Earl', person: { person_key: 'prospect:p2', name: 'Meagan Earl', title: 'VP People' }, prefill: { subject: 'A housing benefit', body: 'Hi Meagan,\n\nWorth 15 minutes?\n\nAna', cost: 0.0182, cap: { used: 4, max: 30 } } })} onClose={() => {}} onToast={() => {}} />);
  await waitFor(() => expect(screen.getByDisplayValue('A housing benefit')).toBeInTheDocument());
  expect(screen.getByDisplayValue(/^Hi Meagan,/)).toBeInTheDocument();
  expect(goalsApi.compose).not.toHaveBeenCalled();
  expect(document.querySelector('[data-compose-to]').textContent).toBe('For Meagan Earl at Cloudflare. The draft is written to Meagan Earl; nothing is sent from here.');
});

test('opened without a draft: one compose call - for a person row, with the person; for a company, without', async () => {
  const person = { person_key: 'prospect:p2', name: 'Meagan Earl', title: 'VP People' };
  const first = render(<ComposePanel businessId="b1" row={row({ to: 'Meagan Earl', person })} onClose={() => {}} onToast={() => {}} />);
  await waitFor(() => expect(screen.getByDisplayValue('From the call')).toBeInTheDocument());
  expect(goalsApi.compose).toHaveBeenCalledTimes(1);
  expect(goalsApi.compose).toHaveBeenCalledWith('b1', 'employer', 'e1', person);
  first.unmount();
  render(<ComposePanel businessId="b1" row={row({ to: 'Dana Mayer' })} onClose={() => {}} onToast={() => {}} />);
  await waitFor(() => expect(goalsApi.compose).toHaveBeenCalledTimes(2));
  expect(goalsApi.compose).toHaveBeenLastCalledWith('b1', 'employer', 'e1', null);
  expect(document.querySelector('[data-compose-to]').textContent).toBe('For Dana Mayer at Cloudflare. The draft is written to the company; address it to Dana Mayer in your mail app.');
});
