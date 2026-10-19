import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import PartnerResearch, { appendAi, stampDate } from './PartnerResearch';

// partner-add-research-v1 Stage 2 - the research card against a fake api:
// Researching… then the result; Confirm site writes the domain + fills
// company_domain; Wrong site writes nothing; Use appends "(M/D) AI: " to the
// mapped field; Set category only when empty; Viewer sees no buttons.
const result = { website: 'https://www.bbinsurance.com/', domain: 'bbinsurance.com', website_confidence: 'high', source_urls: ['https://www.bbinsurance.com/about'], summary: 'Insurance broker for mid-market employers.', mission: '"We help people."', positioning: null, size: '16,000 employees', hq_city: 'Daytona Beach, FL', recent_news: null, housing_perk: 'no housing perk found', suggested_category: '4. Mid-Market Benefits Brokers', why_homelover: 'Clients ask for financial wellness.', first_angle: 'Brokers win renewals with a benefit nobody else has.', watch_outs: 'Slow procurement.', titles: 'VP Benefits', web_searches: 2 };
const done = { id: 'r1', status: 'done', created_at: '2026-10-16T17:00:00Z', cost_usd: 0.0425, result };
const partner = { id: 'p1', name: 'Brown & Brown', category: null, company_domain: null, angle: 'old angle', watch_outs: null, first_email: null, target_titles: null };

const FOUND = { status: 'found', people: [{ name: 'Dana Zz', title: 'VP Partnerships' }, { name: 'Lee Zz', title: null }], calls: 1, todo: null, todo_created: false };
function setup({ runs = [done], today = 1, canEdit = true, over = {}, confirmedDomains = [], apollo = FOUND } = {}) {
  const api = { load: jest.fn().mockResolvedValue({ runs, today, cap: 5 }), run: jest.fn().mockResolvedValue({ run: { status: 'running' } }), checkApollo: jest.fn().mockResolvedValue(apollo), csvUrl: () => '/api/sales/b1/goals/partners/export-apollo.csv' };
  const domains = { add: jest.fn().mockResolvedValue({ domains: [{ domain: 'bbinsurance.com', confirmed: true }] }) };
  const onUpdate = jest.fn().mockResolvedValue({}), onDomainData = jest.fn();
  const onPeopleChanged = jest.fn();
  render(<PartnerResearch partner={{ ...partner, ...over }} canEdit={canEdit} api={api} domains={domains} onDomainData={onDomainData} onUpdate={onUpdate} confirmedDomains={confirmedDomains} onPeopleChanged={onPeopleChanged} />);
  return { api, domains, onUpdate, onDomainData, onPeopleChanged };
}

test('result: site line with confidence + source, fields, suggested category; Confirm site writes the domain and fills company_domain', async () => {
  const { domains, onUpdate, onDomainData } = setup();
  await screen.findByText('bbinsurance.com');
  expect(screen.getByText('· high')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'source 1 ↗' })).toHaveAttribute('href', 'https://www.bbinsurance.com/about');
  expect(screen.getByText('Insurance broker for mid-market employers.')).toBeInTheDocument();
  expect(screen.getByText(/Oct 16 · \$0\.043 · 2 searches/)).toBeInTheDocument();
  expect(screen.queryByText('Positioning')).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm site' })); });
  expect(domains.add).toHaveBeenCalledWith('p1', { domain: 'bbinsurance.com' });
  expect(onDomainData).toHaveBeenCalled();
  expect(onUpdate).toHaveBeenCalledWith('p1', { company_domain: 'bbinsurance.com' });
});

test('Wrong site saves nothing; Use appends the stamped line to the mapped column; Set category only when empty; Re-run calls the api', async () => {
  const { api, domains, onUpdate } = setup();
  await screen.findByText('bbinsurance.com');
  fireEvent.click(screen.getByRole('button', { name: 'Wrong site' }));
  expect(screen.getByText('marked wrong · nothing saved')).toBeInTheDocument();
  expect(domains.add).not.toHaveBeenCalled(); expect(onUpdate).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use Summary' })); });
  expect(onUpdate).toHaveBeenCalledWith('p1', { angle: `old angle\n(${stampDate()}) AI: Insurance broker for mid-market employers.` });
  expect(screen.getByText('Used ✓')).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use First angle' })); });
  expect(onUpdate).toHaveBeenCalledWith('p1', { first_email: `(${stampDate()}) AI: Brokers win renewals with a benefit nobody else has.` });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Set category' })); });
  expect(onUpdate).toHaveBeenCalledWith('p1', { category: '4. Mid-Market Benefits Brokers' });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Re-run' })); });
  expect(api.run).toHaveBeenCalledWith('p1');
  expect(api.load).toHaveBeenCalledTimes(2);
});

test('already confirmed domain shows confirmed, no site buttons; a set category shows current; cap reached disables Re-run', async () => {
  setup({ today: 5, over: { category: '6. Enterprise Benefits Consultants' }, confirmedDomains: ['bbinsurance.com'] });
  await screen.findByText('confirmed ✓');
  expect(screen.queryByRole('button', { name: 'Confirm site' })).toBeNull();
  expect(screen.getByText('current: 6. Enterprise Benefits Consultants')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Set category' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Re-run' })).toBeDisabled();
  expect(screen.getByText('cap reached · 5/day')).toBeInTheDocument();
});

test('viewer: result visible, no buttons at all; running shows Researching…; error shows the message with Research offered', async () => {
  setup({ canEdit: false });
  await screen.findByText('bbinsurance.com');
  expect(screen.queryAllByRole('button')).toHaveLength(0);
});

test('running then failed states', async () => {
  const { unmount } = render(<PartnerResearch partner={partner} canEdit api={{ load: jest.fn().mockResolvedValue({ runs: [{ id: 'r2', status: 'running', created_at: '2026-10-16T17:00:00Z' }], today: 1, cap: 5 }), run: jest.fn() }} domains={{ add: jest.fn() }} onUpdate={jest.fn()} />);
  await screen.findByText('Researching…');
  expect(screen.queryByRole('button')).toBeNull();
  unmount();
  render(<PartnerResearch partner={partner} canEdit api={{ load: jest.fn().mockResolvedValue({ runs: [{ id: 'r3', status: 'error', error: 'Could not read the AI reply', created_at: '2026-10-16T17:00:00Z' }], today: 1, cap: 5 }), run: jest.fn() }} domains={{ add: jest.fn() }} onUpdate={jest.fn()} />);
  await screen.findByText(/Research failed: Could not read the AI reply/);
  expect(screen.getByRole('button', { name: 'Re-run' })).toBeEnabled();
  expect(appendAi(null, 'x', '2026-10-04')).toBe('(10/4) AI: x');
  expect(appendAi('a', 'b', '2026-11-12')).toBe('a\n(11/12) AI: b');
});

// Stage 3 - the Apollo people check.
test('Confirm site runs the Apollo check: "Apollo: 2 people" with names + titles, People refreshed', async () => {
  const { api, onPeopleChanged } = setup();
  await screen.findByText('bbinsurance.com');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm site' })); });
  expect(api.checkApollo).toHaveBeenCalledWith('p1');
  expect(screen.getByText('Apollo: 2 people')).toBeInTheDocument();
  expect(screen.getByRole('list', { name: 'Apollo people found' })).toHaveTextContent('Dana Zz · VP PartnershipsLee Zz');
  expect(onPeopleChanged).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('link', { name: 'Export to Apollo (CSV)' })).toBeNull();
});

test('no account: the enrich to-do line + Export to Apollo (CSV); "Check Apollo" re-runs; already-open to-do says so', async () => {
  const todo = { id: 't1', text: 'Enrich Brown & Brown in Apollo: not in Apollo yet', due_date: '2026-10-21' };
  const { api } = setup({ confirmedDomains: ['bbinsurance.com'], apollo: { status: 'no_account', people: [], calls: 0, todo, todo_created: true } });
  await screen.findByText('bbinsurance.com');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check Apollo' })); });
  expect(screen.getByText('Brown & Brown is not in Apollo yet · to-do added: Enrich Brown & Brown in Apollo: not in Apollo yet (due Oct 21)')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Export to Apollo (CSV)' })).toHaveAttribute('href', '/api/sales/b1/goals/partners/export-apollo.csv');
  api.checkApollo.mockResolvedValue({ status: 'no_people', people: [], calls: 1, todo, todo_created: false });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check again' })); });
  expect(screen.getByText('Brown & Brown is in Apollo with no people · to-do already open: Enrich Brown & Brown in Apollo: not in Apollo yet (due Oct 21)')).toBeInTheDocument();
  expect(api.checkApollo).toHaveBeenCalledTimes(2);
});

test('Viewer: no Check Apollo button even with a confirmed site; no check is ever made', async () => {
  const { api } = setup({ canEdit: false, confirmedDomains: ['bbinsurance.com'] });
  await screen.findByText('bbinsurance.com');
  expect(screen.queryByRole('button', { name: /Check Apollo|Check again/ })).toBeNull();
  expect(api.checkApollo).not.toHaveBeenCalled();
});
