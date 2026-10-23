import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import InterestBand from './InterestBand';
import CompanyActions from './CompanyActions';
import { goalsApi } from './goalsApi';

// FIX loop-quickfixes-v1 Q3 - rows with no record: Draft email asks the kind (the band's Add to pipeline copy went in company-workflow-v1).
// Made-up names only; no emails or phones.
jest.mock('./goalsApi', () => ({ goalsApi: { addToPipeline: jest.fn(), copyBundle: jest.fn() } }));
jest.mock('../pipelineApi', () => ({ updateOpportunity: jest.fn() }));
jest.mock('../huddleApi', () => ({ updateProspect: jest.fn() }));
jest.mock('./partners/PartnerResearch', () => ({ apolloLine: () => '' }));

const interest = { show: true, strongest: { text: '3 site visits this week', at: '2026-10-20' }, items: [{ text: '3 site visits this week', at: '2026-10-20' }] };
const band = row => render(<InterestBand businessId="b1" row={row} interest={interest} canEdit onChanged={jest.fn()} onToast={jest.fn()} />);
const bandButtons = () => [...document.querySelectorAll('[data-interest-band] button')].map(b => b.textContent);

// company-workflow-v1 W2: one Add to pipeline in the window - the Actions row's; the band shows the signal only.
test.each([['apollo'], ['visitor']])('band on a %s row: the signal only, no Add to pipeline copy', type => {
  band({ type, id: 'x1', name: 'ZZ Acme' });
  expect(screen.getByText('3 site visits this week')).toBeInTheDocument();
  expect(bandButtons()).toEqual([]);
});

test.each([['partner', 4], ['employer', 4], ['target', 4]])('band on a %s row keeps its buttons', (type, n) => {
  band({ type, id: 'r1', name: 'ZZ Lakeshore' });
  expect(bandButtons()).toHaveLength(n);
  expect(bandButtons()).not.toContain('Add to pipeline ▾');
});

test('Draft email on an Apollo-only row asks employer or partner, then makes the target with that kind and copies', async () => {
  goalsApi.addToPipeline.mockResolvedValue({ created: { type: 'target', id: 't9', name: 'ZZ Acme' } });
  goalsApi.copyBundle.mockResolvedValue('# ZZ Acme — target (partner)\n');
  const writeText = jest.fn(() => Promise.resolve());
  Object.assign(navigator, { clipboard: { writeText } });
  const confirm = jest.spyOn(window, 'confirm');
  const Wrap = () => { const [form, setForm] = require('react').useState(null); return <CompanyActions businessId="b1" row={{ type: 'apollo', id: 'acc-1', name: 'ZZ Acme', stage: 'sequenced' }} members={[]} meId="u1" form={form} setForm={setForm} bandShown onPatch={jest.fn()} onChanged={jest.fn()} onToast={jest.fn()} onConvert={jest.fn()} onClose={jest.fn()} />; };
  render(<Wrap />);
  expect(screen.getByRole('button', { name: 'Add to pipeline ▾' })).toHaveClass('ui-btn--secondary'); // the band holds the primary
  fireEvent.click(screen.getByRole('button', { name: 'Draft email in Claude' }));
  expect(goalsApi.addToPipeline).not.toHaveBeenCalled();
  expect(screen.getByRole('group', { name: 'Add ZZ Acme as a target first' })).toHaveTextContent('employer or partner?');
  fireEvent.click(screen.getByRole('button', { name: 'Partner' }));
  await waitFor(() => expect(writeText).toHaveBeenCalled());
  expect(goalsApi.addToPipeline).toHaveBeenCalledWith('b1', { type: 'apollo', id: 'acc-1', to: 'target', kind: 'partner' });
  expect(goalsApi.copyBundle).toHaveBeenCalledWith('b1', 'target', 't9');
  expect(confirm).not.toHaveBeenCalled();
});
