import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import DomainReview from './DomainReview';

// partner-domains-bulk-review-v1 - 4 pending rows across 3 partners, 1 Both.
const suggestions = [
  { goal_id: 'p4', partner_name: 'Corestream', domain: 'corp.corestream.com', source: 'sources', both: false },
  { goal_id: 'p4', partner_name: 'Corestream', domain: 'corestream.com', source: 'apollo', both: false },
  { goal_id: 'p1', partner_name: 'Justworks', domain: 'justworks.com', source: 'sources', both: false },
  { goal_id: 'p2', partner_name: 'PerkSpot', domain: 'perkspot.com', source: 'sources', both: true },
];
const rowText = () => within(screen.getByRole('list', { name: 'Pending domain suggestions' })).getAllByRole('listitem').map(li => li.textContent);

test('one row per suggestion with Sheet / Apollo / Both badges; Confirm all posts each sequentially and rows leave as they land', async () => {
  const onAdd = jest.fn().mockResolvedValue({});
  const onChanged = jest.fn();
  render(<DomainReview suggestions={suggestions} onAdd={onAdd} onChanged={onChanged} onClose={jest.fn()} />);
  expect(rowText()).toEqual([
    expect.stringMatching(/^Corestreamcorp\.corestream\.comSheet/), expect.stringMatching(/^Corestreamcorestream\.comApollo/),
    expect.stringMatching(/^Justworksjustworks\.comSheet/), expect.stringMatching(/^PerkSpotperkspot\.comBoth/),
  ]);
  expect(screen.getByText('4 pending')).toBeTruthy();
  expect(screen.getByRole('button', { name: "Confirm all 'Both' (1)" })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm all (4)' }));
  await screen.findByText('4 of 4 confirmed');
  expect(onAdd.mock.calls).toEqual([['p4', { domain: 'corp.corestream.com' }], ['p4', { domain: 'corestream.com' }], ['p1', { domain: 'justworks.com' }], ['p2', { domain: 'perkspot.com' }]]);
  expect(screen.queryByRole('list', { name: 'Pending domain suggestions' })).toBeNull();
  expect(screen.getByText('Nothing pending')).toBeTruthy();
  expect(onChanged).toHaveBeenCalledTimes(1);
});

test("dismiss one, then Confirm all 'Both' only posts the Both row; a failed row stays with 'failed'", async () => {
  const onAdd = jest.fn(async (goalId, body) => { if (body.domain === 'corp.corestream.com' && !body.dismiss) throw new Error('500'); return {}; });
  const onChanged = jest.fn();
  render(<DomainReview suggestions={suggestions} onAdd={onAdd} onChanged={onChanged} onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss justworks.com for Justworks' }));
  await waitFor(() => expect(onAdd).toHaveBeenCalledWith('p1', { domain: 'justworks.com', dismiss: true }));
  await screen.findByText('3 pending');
  expect(onChanged).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: "Confirm all 'Both' (1)" }));
  await screen.findByText('1 of 1 confirmed');
  expect(onAdd).toHaveBeenLastCalledWith('p2', { domain: 'perkspot.com' });
  expect(rowText()).toHaveLength(2);
  expect(screen.queryByRole('button', { name: /Confirm all 'Both'/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm all (2)' }));
  await screen.findByText(/1 of 2 confirmed · 1 failed/);
  expect(rowText()).toEqual([expect.stringMatching(/corp\.corestream\.comfailedSheet/)]);
  expect(screen.getByText(/2 confirmed, 1 dismissed this session/)).toBeTruthy();
});
