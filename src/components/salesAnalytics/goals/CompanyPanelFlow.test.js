import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import CompanyPanel from './CompanyPanel';
import { goalsApi } from './goalsApi';

jest.mock('./goalsApi', () => ({ goalsApi: { companyDetail: jest.fn(), source: jest.fn(), channelLinks: jest.fn(), fitOf: jest.fn(), flowEvents: jest.fn(), referredBy: jest.fn(), scoreOf: jest.fn(), sourcesNetwork: jest.fn(), bringBack: jest.fn(), undoFlow: jest.fn(), editCompanyFields: jest.fn(), partnerSignal: jest.fn(), clientFiles: jest.fn() }, OPEN_PIPELINE_RECORD: 'x', NeedsMigrationError: class extends Error {} }));
jest.mock('../pipelineApi', () => ({ updateOpportunity: jest.fn() }));
jest.mock('../huddleApi', () => ({ updateProspect: jest.fn(), unlinkProspect: jest.fn() }));
jest.mock('../../../utils/useMediaQuery', () => () => true);

// FIX company-window-subtract-v1 - the account card over an invented employer and an invented target: every fact
// once, every action once, no empty block; the head = title · facts · stage strip · SETUP (while incomplete) ·
// Interest (while live) · Actions. The invented live partner (homelover-flow-v1 mockup C) is unchanged.
const MEMBERS = [{ user_id: 'u-jack', name: 'Jack Zz', role: 'owner', color: '#3DBA8C' }, { user_id: 'u-cyrus', name: 'Cyrus Test', role: 'member', color: '#D9A441' }];
const EMP = { type: 'employer', id: 'o1', name: 'Zz Acme Health', stage: 'contacted', owner_user_id: 'u-cyrus', owner: 'Cyrus', owner_team: 'homelover', due: 'week', due_date: '2026-11-07', category: null };
const TGT = { type: 'target', id: 't1', name: 'Zz Fortem', stage: 'researching', owner_user_id: null, owner: null, owner_team: null, category: null };
const HUB = { type: 'partner', id: 'p1', name: 'Zz HUB', stage: 'live', owner_user_id: 'u-jack', owner_team: 'homelover', category: '4. Brokers & PEOs', next_step: 'Submit joint proposal' };
const INTEREST = { show: true, strongest: { text: '3 site visits this week', at: '2026-11-03' }, items: [{ text: '3 site visits this week', at: '2026-11-03' }] };
const detail = (over = {}) => ({ record: { stage: 'contacted', next_step: 'Follow up with the 2 buyers', next_step_due: null, last_touch: { at: '2026-10-29T18:00:00Z', by: 'Cyrus Test', touch_type: 'done', what: 'Contacted Ana' }, site: { domain: 'acmehealth.example', confirmed: false }, employees: 1250, employees_source: 'apollo', client: {}, ...over.record },
  todos: [], waiting: [], visits: [{ id: 'v1', visits_7d: 6, top_paths: ['/employers', '/pricing'], first_visit: '2026-10-28', last_visit: '2026-11-03' }], signals: [], recent: [], people: [], research: { runs: [{ status: 'done', created_at: '2026-10-28T00:00:00Z', result: { summary: 'They do healthcare.', sells_to: 'Healthcare services', hq_city: 'Phoenix, AZ', housing_perk: 'no housing perk found' } }], today: 1, cap: 5 }, decisions: [], terms: [], stage_history: [{ stage: 'target', at: '2026-10-21T00:00:00Z' }, { stage: 'contacted', at: '2026-10-24T00:00:00Z' }], steps: null, interest: { show: false }, timeline: [], decision_makers: [], ...over });
const FIT = { level: 'strong', source: 'computed', score: 78, used: 6, of: 6, hand_level: null, us_footprint: 'mostly_us', overlay: null, axes: [] };
beforeEach(() => {
  goalsApi.source.mockResolvedValue({ source: { source_kind: 'partner_referral', partner_name: 'HUB' }, history: [], journey: null });
  goalsApi.channelLinks.mockResolvedValue([]);
  goalsApi.fitOf.mockResolvedValue(FIT);
  goalsApi.flowEvents.mockResolvedValue([{ id: 'f1', kind: 'reply_move', text: 'Reply from Zz Acme Health → Replied', at: '2026-11-01T00:00:00Z', by_user: null, undone_at: null }]);
  goalsApi.scoreOf.mockResolvedValue({ row: { score: 37, band: 'P2', source_label: 'website', trend: 'up', band_changed: false }, lines: [] });
  goalsApi.referredBy.mockResolvedValue({ total: 1, groups: [], network: { header: { clients: 1, lives: 390, in_pipeline: 0, partners: 0 }, came_from: { kind: 'partner_referral', label: 'Partner referral', partner_not_set: true }, ownership: { team: 'HomeLover', owner: null, co_owner_name: 'Brad' }, groups: [{ key: 'clients', label: 'Clients', total: 1, rows: [{ type: 'employer', id: 'o9', name: 'Momentum', client_status: 'verbal_yes', lives: 390 }], more: 0 }, { key: 'employers', label: 'Employers in pipeline', total: 0, rows: [], more: 0 }] } });
  goalsApi.sourcesNetwork.mockResolvedValue({ roots: [], counts: {} });
  goalsApi.clientFiles.mockResolvedValue([]);
});
afterEach(() => jest.clearAllMocks());
const props = { businessId: 'b1', canEdit: true, members: MEMBERS, meId: 'u-jack', onStar: jest.fn(), onPatch: jest.fn(), onChanged: jest.fn(), onToast: jest.fn(), onConvert: jest.fn(), onClose: jest.fn(), onOpenFull: jest.fn(), onOpenPeople: jest.fn() };

// A label's own text (its direct text nodes, so "Research" ignores the kbd hint and never matches "✓ Research" or "Researched").
const LABELS = { Stage: /^Stage$/, 'Next step': /^Next step$/, Owner: /^Owner$/, Intent: /^Intent$/, 'Mark contacted': /^Mark contacted$/, 'Book meeting': /^Book meeting$/, 'Check Apollo': /^Check Apollo$/, Research: /^Research$/, 'Draft email': /^Draft email$/, Promote: /Promote/, Deprioritize: /Deprioritize/, Note: /^Note$/, 'To-do': /^To-do$/, Contact: /^Contact$/, Employees: /^Employees$/ };
const counts = head => Object.fromEntries(Object.entries(LABELS).map(([k, re]) => [k, within(head).queryAllByText(re).length]));
const headOf = dlg => dlg.querySelector('[data-window-head]');
const blocks = head => [...head.children].map(el => el.matches('[data-company-panel]') ? 'title' : el.querySelector('[data-facts-row]') ? 'facts' : el.matches('[data-company-progress]') ? 'strip' : el.matches('[data-steps]') ? 'setup' : el.matches('[data-interest-band]') ? 'interest' : el.matches('[data-actions-row]') ? 'actions' : el.tagName.toLowerCase());

test('an employer (Contacted, setup done, live interest): head = title · facts · strip · Interest · Actions; every label once; no Fit, Due or stage chip in the title; no empty card', async () => {
  goalsApi.companyDetail.mockResolvedValue(detail({ steps: { next: null, ready: true, last_touch_at: '2026-10-29T18:00:00Z', steps: [] }, interest: INTEREST }));
  render(<CompanyPanel {...props} row={EMP} />);
  const dlg = screen.getByRole('dialog', { name: 'Zz Acme Health' });
  await within(dlg).findByRole('region', { name: 'Interest' });
  await within(dlg).findByText('37 · warm', { exact: false });
  const head = headOf(dlg);
  expect(blocks(head)).toEqual(['title', 'facts', 'strip', 'interest', 'actions']);
  expect(dlg.querySelector('[data-layout]').getAttribute('data-layout')).toBe('classic');
  // Title row: name · type pill · Top · Intent · site - no Owner / Fit / Due chip, no "Employer · Contacted".
  const title = head.querySelector('[data-company-panel]');
  expect(title.querySelectorAll('[data-chip]')).toHaveLength(0);
  expect(within(title).queryByText(/Employer · Contacted/)).toBeNull();
  expect(within(title).getByRole('button', { name: /Top/ })).toBeInTheDocument();
  expect(within(title).getByRole('link', { name: /acmehealth\.example/ })).toBeInTheDocument();
  expect(counts(head)).toEqual({ Stage: 1, 'Next step': 1, Owner: 1, Intent: 1, 'Mark contacted': 0, 'Book meeting': 1, 'Check Apollo': 1, Research: 1, 'Draft email': 1, Promote: 0, Deprioritize: 1, Note: 1, 'To-do': 1, Contact: 1, Employees: 1 });
  expect(within(head).queryByText(/^Fit/)).toBeNull();
  expect(within(head).queryByText(/no score yet|nobody known|nothing yet|^Reached$|^Overview$|^Fit at a glance$|^Next step$/i, { selector: 'section > span' })).toBeNull();
  expect(head.querySelector('[data-section]')).toBeNull();
  // The stage strip is the one stage control: 28 px pills, no "Progress" label column, no primary that duplicates REACH; the sentence is its tooltip.
  const strip = head.querySelector('[data-company-progress]');
  expect(within(strip).queryByText('Progress')).toBeNull();
  expect(within(strip).queryByText(/click a stage to jump/)).toBeNull();
  expect(strip.getAttribute('title')).toBe('Click a stage to jump · Undo 10 s');
  expect(strip.querySelector('[data-last-touch]')).toBeNull();
  expect(within(strip).getByRole('button', { name: 'Log reply' })).toBeInTheDocument();
  expect(strip.querySelector('[data-step="contacted"] button').style.height).toBe('28px');
  // SETUP is gone once every step is done; the Interest band has Follow up + Not now only.
  expect(head.querySelector('[data-steps]')).toBeNull();
  expect(head.querySelector('[data-steps-ready]')).toBeNull();
  expect(within(head.querySelector('[data-interest-band]')).getAllByRole('button').map(b => b.textContent)).toEqual(['Follow up: draft reply', 'Not now']);
  // Actions: one row in flow order; DECIDE has no Owner and no Next: button; the generated tag is the row's last child.
  const actions = within(head).getByRole('region', { name: 'Actions' });
  expect(within(actions).getAllByRole('group').filter(g => g.hasAttribute('data-action-group')).map(g => g.getAttribute('aria-label'))).toEqual(['Reach', 'Decide', 'Capture', 'Learn']);
  expect(within(within(actions).getByRole('group', { name: 'Decide' })).getAllByRole('button').map(b => b.textContent)).toEqual(['↓ Deprioritize…']);
  expect(within(actions).queryByText(/^Owner:/)).toBeNull();
  const row = actions.firstElementChild;
  expect(row.lastElementChild.textContent).toBe('✦ generated');
  // The flow Activity still reads in Notes & touches.
  expect(within(within(dlg).getByRole('region', { name: 'Notes & touches' })).getByText(/Reply from Zz Acme Health → Replied · automatic/)).toBeInTheDocument();
  // Deprioritize… opens the reason sheet under Actions.
  fireEvent.click(within(actions).getByRole('button', { name: '↓ Deprioritize…' }));
  expect(screen.getByRole('group', { name: 'Deprioritize' })).toBeInTheDocument();
});

test('a target (no score, no people, setup incomplete): head = title · facts · strip · SETUP · Actions; every label once; SETUP done steps carry no value; nothing says "no score yet"', async () => {
  goalsApi.fitOf.mockResolvedValue(null);
  goalsApi.companyDetail.mockResolvedValue(detail({ record: { stage: 'researching', next_step: null, last_touch: null, site: null, employees: null, employees_source: null, owner_name: null }, research: { runs: [], today: 0, cap: 5 }, stage_history: [], visits: [],
    steps: { next: 'size', ready: false, steps: [{ id: 'research', label: 'Research', status: 'done', value: 'Researched 2026-11-05' }, { id: 'site', label: 'Confirm site', status: 'skip' }, { id: 'size', label: 'Size & type', status: 'next', reach: false }, { id: 'owner', label: 'Owner', status: 'todo' }, { id: 'add', label: 'Add to pipeline', status: 'todo' }, { id: 'touch', label: 'First touch', status: 'skip' }] } }));
  render(<CompanyPanel {...props} row={TGT} />);
  const dlg = screen.getByRole('dialog', { name: 'Zz Fortem' });
  await within(dlg).findByRole('region', { name: 'Setup' });
  await within(dlg).findByRole('region', { name: 'Actions' });
  const head = headOf(dlg);
  expect(blocks(head)).toEqual(['title', 'facts', 'strip', 'setup', 'actions']);
  expect(head.querySelector('[data-company-panel] [data-chip]')).toBeNull();
  expect(within(head.querySelector('[data-company-panel]')).queryByText(/Target · Researching/)).toBeNull();
  expect(counts(head)).toEqual({ Stage: 1, 'Next step': 0, Owner: 1, Intent: 1, 'Mark contacted': 1, 'Book meeting': 1, 'Check Apollo': 1, Research: 1, 'Draft email': 1, Promote: 1, Deprioritize: 1, Note: 1, 'To-do': 1, Contact: 1, Employees: 1 });
  expect(within(head).queryByText(/^Fit/)).toBeNull();
  expect(within(dlg).queryByText(/no score yet|nobody known at this company/i)).toBeNull();
  expect(head.querySelector('[data-section]')).toBeNull();
  const setup = head.querySelector('[data-steps]');
  expect(setup.querySelector('[data-step="research"]').textContent).toBe('✓ Research');
  expect(setup.querySelector('[data-step="research"]').getAttribute('title')).toBeNull();
  expect(setup.querySelector('[data-setup-count]').textContent).toBe('Setup 1/4');
  // A target's strip has no primary and no More (Mark contacted is REACH's); its pills still read.
  const strip = head.querySelector('[data-company-progress]');
  expect(within(strip).queryByRole('button', { name: /Mark contacted|More ▾/ })).toBeNull();
  expect(strip.querySelector('[data-step="target"][data-state="now"]')).toBeInTheDocument();
  expect(within(within(head).getByRole('group', { name: 'Reach' })).getByRole('button', { name: 'Mark contacted' })).toBeInTheDocument();
});

test('a deprioritized employer: Decide shows Bring back, no Deprioritize…, no Fit chip anywhere', async () => {
  goalsApi.companyDetail.mockResolvedValue(detail());
  goalsApi.fitOf.mockResolvedValue({ ...FIT, level: 'deprioritized', source: 'deprioritized', reason: 'mostly_outside_us', note: null });
  render(<CompanyPanel {...props} row={EMP} />);
  const dlg = screen.getByRole('dialog', { name: 'Zz Acme Health' });
  const decide = await within(dlg).findByRole('group', { name: 'Decide' });
  await within(decide).findByRole('button', { name: 'Bring back' });
  expect(within(decide).queryByRole('button', { name: /Deprioritize/ })).toBeNull();
  expect(within(dlg).queryByText(/Deprioritized · Mostly outside US/)).toBeNull();
});

test('mockup C: a live partner card is unchanged - Partner · category, Live since, owner chip; Next step with Add a client they referred; Came from (partner not set — Set it); Network + the tree; partner actions; no Setup strip, no progress bar, no Mark contacted, no Confirm site', async () => {
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
  expect(within(within(actions).getByRole('group', { name: 'Decide' })).getAllByRole('button').map(b => b.textContent)).toEqual(['Owner: Me ▾', 'Pause…']);
  expect(dlg.querySelector('[data-steps]')).toBeNull();
  expect(dlg.querySelector('[data-company-progress]')).toBeNull();
  expect(within(dlg).queryByRole('button', { name: 'Mark contacted' })).toBeNull();
  expect(within(dlg).queryByRole('button', { name: 'Confirm site' })).toBeNull();
  expect(dlg.querySelector('[data-facts-row]')).toBeNull();
});

test('a Viewer: plain facts, the strip without buttons, no Actions row, no chips', async () => {
  goalsApi.companyDetail.mockResolvedValue(detail({ interest: INTEREST }));
  render(<CompanyPanel {...props} canEdit={false} row={EMP} />);
  const dlg = screen.getByRole('dialog', { name: 'Zz Acme Health' });
  await within(dlg).findByRole('region', { name: 'Interest' });
  const head = headOf(dlg);
  expect(head.querySelectorAll('[data-fact-button], [data-chip], [data-actions-row], [data-interest-band] button, [data-company-progress] button')).toHaveLength(0);
  expect(within(dlg).getByText(/view access/)).toBeInTheDocument();
  expect(within(head).getByText('Owner')).toBeInTheDocument();
});
