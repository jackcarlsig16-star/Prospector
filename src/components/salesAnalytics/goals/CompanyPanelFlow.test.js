import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import CompanyPanel from './CompanyPanel';
import { goalsApi } from './goalsApi';

jest.mock('./goalsApi', () => ({ goalsApi: { companyDetail: jest.fn(), source: jest.fn(), channelLinks: jest.fn(), fitOf: jest.fn(), reach: jest.fn(), flowEvents: jest.fn(), replySuggestion: jest.fn(), referredBy: jest.fn(), scoreOf: jest.fn(), sourcesNetwork: jest.fn(), setFit: jest.fn(), bringBack: jest.fn(), undoFlow: jest.fn(), editCompanyFields: jest.fn(), partnerSignal: jest.fn(), clientFiles: jest.fn() }, OPEN_PIPELINE_RECORD: 'x', NeedsMigrationError: class extends Error {} }));
jest.mock('../pipelineApi', () => ({ updateOpportunity: jest.fn() }));
jest.mock('../huddleApi', () => ({ updateProspect: jest.fn(), unlinkProspect: jest.fn() }));
jest.mock('../../../utils/useMediaQuery', () => () => true);

// homelover-flow-v1 Stage 2 - the account card over an invented employer (mockup A) and an invented live partner
// (mockup C): title-row chips, Next step + Reached, Progress, Fit at a glance + Overview, grouped Actions; the live
// partner's Live since chip, Came from, Network + tree, partner actions, and nothing a live partner must not show.
const MEMBERS = [{ user_id: 'u-jack', name: 'Jack Zz', role: 'owner', color: '#3DBA8C' }, { user_id: 'u-cyrus', name: 'Cyrus Test', role: 'member', color: '#D9A441' }];
const EMP = { type: 'employer', id: 'o1', name: 'Zz Acme Health', stage: 'contacted', owner_user_id: 'u-cyrus', owner: 'Cyrus', owner_team: 'homelover', due: 'week', due_date: '2026-11-07', category: null };
const HUB = { type: 'partner', id: 'p1', name: 'Zz HUB', stage: 'live', owner_user_id: 'u-jack', owner_team: 'homelover', category: '4. Brokers & PEOs', next_step: 'Submit joint proposal' };
const detail = (over = {}) => ({ record: { stage: 'contacted', next_step: 'Follow up with the 2 buyers', next_step_due: null, last_touch: { at: '2026-10-29T18:00:00Z', by: 'Cyrus Test', touch_type: 'done', what: 'Contacted Ana' }, site: { domain: 'acmehealth.example', confirmed: false }, employees: 1250, employees_source: 'apollo', client: {}, ...over.record },
  todos: [], waiting: [], visits: [{ id: 'v1', visits_7d: 6, top_paths: ['/employers', '/pricing'], first_visit: '2026-10-28', last_visit: '2026-11-03' }], signals: [], recent: [], people: [], research: { runs: [{ status: 'done', created_at: '2026-10-28T00:00:00Z', result: { summary: 'They do healthcare.', sells_to: 'Healthcare services', hq_city: 'Phoenix, AZ', housing_perk: 'no housing perk found' } }], today: 1, cap: 5 }, decisions: [], terms: [], stage_history: [{ stage: 'target', at: '2026-10-21T00:00:00Z' }, { stage: 'contacted', at: '2026-10-24T00:00:00Z' }], steps: null, interest: { show: false }, timeline: [], decision_makers: [], ...over });
const FIT = { level: 'strong', source: 'computed', score: 78, used: 6, of: 6, hand_level: null, us_footprint: 'mostly_us', overlay: { n: 1, axes: { intent: 50, industry: 90, size: 80, us_footprint: 100, buyers: 40, warm_path: 70 } }, axes: [{ id: 'intent', value: 62, why: 'w' }, { id: 'industry', value: 85, why: 'w' }, { id: 'size', value: 80, why: 'w' }, { id: 'us_footprint', value: 90, why: 'w' }, { id: 'buyers', value: 55, why: 'w' }, { id: 'warm_path', value: 88, why: 'w' }] };
beforeEach(() => {
  goalsApi.source.mockResolvedValue({ source: { source_kind: 'partner_referral', partner_name: 'HUB' }, history: [], journey: null });
  goalsApi.channelLinks.mockResolvedValue([]);
  goalsApi.fitOf.mockResolvedValue(FIT);
  goalsApi.reach.mockResolvedValue({ known: 11, reached: 3, buyers: 6, buyers_reached: 2, buyers_not_yet: 4, replies: 0, people: [] });
  goalsApi.flowEvents.mockResolvedValue([{ id: 'f1', kind: 'reply_move', text: 'Reply from Zz Acme Health → Replied', at: '2026-11-01T00:00:00Z', by_user: null, undone_at: null }]);
  goalsApi.replySuggestion.mockResolvedValue({ suggestion: { text: 'Book the meeting', action: 'book_meeting', source: 'apollo' } });
  goalsApi.scoreOf.mockResolvedValue({ row: { score: 37, band: 'P2', source_label: 'website', trend: 'up', band_changed: false }, lines: [] });
  goalsApi.referredBy.mockResolvedValue({ total: 1, groups: [], network: { header: { clients: 1, lives: 390, in_pipeline: 0, partners: 0 }, came_from: { kind: 'partner_referral', label: 'Partner referral', partner_not_set: true }, ownership: { team: 'HomeLover', owner: null, co_owner_name: 'Brad' }, groups: [{ key: 'clients', label: 'Clients', total: 1, rows: [{ type: 'employer', id: 'o9', name: 'Momentum', client_status: 'verbal_yes', lives: 390 }], more: 0 }, { key: 'employers', label: 'Employers in pipeline', total: 0, rows: [], more: 0 }] } });
  goalsApi.sourcesNetwork.mockResolvedValue({ roots: [], counts: {} });
  goalsApi.clientFiles.mockResolvedValue([]);
});
afterEach(() => jest.clearAllMocks());
const props = { businessId: 'b1', canEdit: true, members: MEMBERS, meId: 'u-jack', onStar: jest.fn(), onPatch: jest.fn(), onChanged: jest.fn(), onToast: jest.fn(), onConvert: jest.fn(), onClose: jest.fn(), onOpenFull: jest.fn(), onOpenPeople: jest.fn() };

test('mockup A: an employer card - chips, Next step with the suggestion as the primary, Reached 3 of 11, Progress, Fit radar, Overview, grouped Actions; no facts row, no Setup strip', async () => {
  goalsApi.companyDetail.mockResolvedValue(detail());
  render(<CompanyPanel {...props} row={EMP} />);
  await screen.findByText('3');
  const dlg = screen.getByRole('dialog', { name: 'Zz Acme Health' });
  expect(dlg.querySelector('[data-layout]').getAttribute('data-layout')).toBe('flow');
  expect(within(dlg).getByText('Employer · Contacted')).toBeInTheDocument();
  expect(within(dlg).getByRole('button', { name: /^Cyrus/ })).toBeInTheDocument();
  await within(dlg).findByRole('button', { name: /Strong fit · 78/ });
  expect(within(dlg).getByText('Due this week')).toBeInTheDocument();
  expect(within(dlg).getByText(/37 · warm/)).toBeInTheDocument();
  expect(dlg.querySelector('[data-facts-row]')).toBeNull();
  expect(dlg.querySelector('[data-steps]')).toBeNull();
  await waitFor(() => expect(dlg.querySelector('[data-next-step-text]').textContent).toBe('Book the meeting'));
  expect(dlg.querySelector('[data-flow-primary]').getAttribute('data-flow-primary')).toBe('book');
  expect(dlg.querySelector('[data-next-step-sub]').textContent).toMatch(/Last touch Oct 29 · Cyrus · Contacted Ana · 6 visits \/ 7 d/);
  expect(dlg.querySelector('[data-reached]').textContent).toBe('3of 11 people');
  expect(within(dlg).getByRole('region', { name: 'Progress' })).toBeInTheDocument();
  expect(dlg.querySelector('[data-fit-radar]')).toBeInTheDocument();
  expect(dlg.querySelectorAll('[data-axis-row]')).toHaveLength(6);
  const overview = within(dlg).getByRole('region', { name: 'Overview' });
  expect(within(overview).getByText('1,250')).toBeInTheDocument();
  expect(within(overview).getByText('Mostly US')).toBeInTheDocument();
  expect(within(overview).getByText('Healthcare services')).toBeInTheDocument();
  expect(within(overview).getByText('Partner referral · HUB')).toBeInTheDocument();
  const actions = within(dlg).getByRole('region', { name: 'Actions' });
  expect(within(actions).getAllByRole('group').filter(g => g.hasAttribute('data-action-group')).map(g => g.getAttribute('aria-label'))).toEqual(['Reach', 'Decide', 'Capture', 'Learn']);
  expect(within(actions).queryByRole('button', { name: 'Mark contacted' })).toBeNull();
  expect(within(actions).getByRole('button', { name: '↩ They replied…' })).toBeInTheDocument();
  // The flow Activity reads in Notes & touches, marked automatic.
  expect(within(within(dlg).getByRole('region', { name: 'Notes & touches' })).getByText(/Reply from Zz Acme Health → Replied · automatic/)).toBeInTheDocument();
  // The Fit chip opens its menu; Deprioritize… opens the reason sheet under Actions.
  fireEvent.click(within(dlg).getByRole('button', { name: /Strong fit · 78/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Deprioritize…' }));
  expect(screen.getByRole('group', { name: 'Deprioritize' })).toBeInTheDocument();
});

test('a deprioritized employer: the Fit chip carries the reason, the primary is Bring back, Decide shows Bring back', async () => {
  goalsApi.companyDetail.mockResolvedValue(detail());
  goalsApi.fitOf.mockResolvedValue({ ...FIT, level: 'deprioritized', source: 'deprioritized', reason: 'mostly_outside_us', note: null });
  render(<CompanyPanel {...props} row={EMP} />);
  const dlg = screen.getByRole('dialog', { name: 'Zz Acme Health' });
  await within(dlg).findByRole('button', { name: /Deprioritized · Mostly outside US/ });
  await waitFor(() => expect(dlg.querySelector('[data-flow-primary]').getAttribute('data-flow-primary')).toBe('bring_back'));
  expect(within(within(dlg).getByRole('group', { name: 'Decide' })).getByRole('button', { name: 'Bring back' })).toBeInTheDocument();
});

test('mockup C: a live partner card - Partner · category, Live since, owner chip; Next step with Add a client they referred; Came from (partner not set — Set it); Network + the tree; partner actions; no Setup strip, no progress bar, no Mark contacted, no Confirm site', async () => {
  goalsApi.companyDetail.mockResolvedValue(detail({ record: { stage: 'live', next_step: 'Submit joint proposal', next_step_due: '2026-11-04', last_touch: { at: '2026-11-04T18:00:00Z', touch_type: 'meeting', by: 'Jack Zz' }, site: { domain: 'hub.example', confirmed: false } }, stage_history: [{ stage: 'replied', at: '2026-10-20T00:00:00Z' }, { stage: 'live', at: '2026-11-03T20:00:00Z' }], steps: { steps: [{ id: 'research', status: 'next', label: 'Research' }], next: 'research', ready: false } }));
  render(<CompanyPanel {...props} row={HUB} />);
  const dlg = screen.getByRole('dialog', { name: 'Zz HUB' });
  await within(dlg).findByText('Live since Nov 3');
  expect(dlg.querySelector('[data-layout]').getAttribute('data-layout')).toBe('live-partner');
  expect(within(dlg).getByText('Partner · Brokers & PEOs')).toBeInTheDocument();
  expect(within(dlg).getByRole('button', { name: /^Me/ })).toBeInTheDocument();
  await waitFor(() => expect(dlg.querySelector('[data-next-step-text]').textContent).toBe('Submit joint proposal'));
  expect(within(dlg).getByRole('button', { name: '+ Add a client they referred' })).toBeInTheDocument();
  await within(dlg).findByText('partner not set');
  expect(within(within(dlg).getByRole('region', { name: 'Came from' })).getByRole('button', { name: 'Set it' })).toBeInTheDocument();
  expect(within(dlg).getAllByRole('region', { name: 'Network' }).length).toBeGreaterThanOrEqual(1);
  expect(within(dlg).getByRole('region', { name: 'Network view' })).toBeInTheDocument();
  const actions = within(dlg).getByRole('region', { name: 'Actions' });
  expect(within(actions).getAllByRole('group').filter(g => g.hasAttribute('data-action-group')).map(g => g.getAttribute('aria-label'))).toEqual(['Partner', 'Capture', 'Decide']);
  expect(dlg.querySelector('[data-steps]')).toBeNull();
  expect(dlg.querySelector('[data-company-progress]')).toBeNull();
  expect(within(dlg).queryByRole('button', { name: 'Mark contacted' })).toBeNull();
  expect(within(dlg).queryByRole('button', { name: 'Confirm site' })).toBeNull();
  expect(dlg.querySelector('[data-facts-row]')).toBeNull();
});

test('a Viewer sees the chips as plain text and no primary / actions', async () => {
  goalsApi.companyDetail.mockResolvedValue(detail());
  render(<CompanyPanel {...props} canEdit={false} row={EMP} />);
  const dlg = screen.getByRole('dialog', { name: 'Zz Acme Health' });
  await within(dlg).findByText('Strong fit · 78');
  expect(within(dlg).queryByRole('button', { name: /Strong fit/ })).toBeNull();
  await waitFor(() => expect(dlg.querySelector('[data-next-step-text]')).toBeInTheDocument());
  expect(dlg.querySelector('[data-flow-primary]')).toBeNull();
  expect(within(dlg).getByText(/view access/)).toBeInTheDocument();
});
