import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import CompanyPanel from './CompanyPanel';
import { goalsApi } from './goalsApi';

jest.mock('./goalsApi', () => ({ goalsApi: { todoEvents: jest.fn(() => Promise.resolve([])), undoTodoEvent: jest.fn(() => Promise.resolve({})), companyDetail: jest.fn(), source: jest.fn(), channelLinks: jest.fn(), fitOf: jest.fn(), flowEvents: jest.fn(), referredBy: jest.fn(), scoreOf: jest.fn(), sourcesNetwork: jest.fn(), bringBack: jest.fn(), undoFlow: jest.fn(), editCompanyFields: jest.fn(), partnerSignal: jest.fn(), clientFiles: jest.fn() }, OPEN_PIPELINE_RECORD: 'x', NeedsMigrationError: class extends Error {} }));
jest.mock('../pipelineApi', () => ({ updateOpportunity: jest.fn() }));
jest.mock('../huddleApi', () => ({ updateProspect: jest.fn(), unlinkProspect: jest.fn() }));
jest.mock('../../../utils/useMediaQuery', () => () => true);

// FIX company-window-subtract-v1 (REV2) / company-window-v4 Stage 1 - the account card over an invented employer and
// an invented target: every fact once, every action once, no empty block; doing above reading: the head = title ·
// Interest (while live) · Actions · facts (Stage is no fact; readiness draws on Owner / Employees, the Intel header) ·
// the journey card (Stage 2: eight nodes, the one stage control). The body opens with Fit (the radar over the Map's ring
// components) beside Intel ("Use n →" fills an empty Employees fact). No SETUP strip, no <select> anywhere. The invented
// live partner (homelover-flow-v1 mockup C) is unchanged.
const MEMBERS = [{ user_id: 'u-jack', name: 'Jack Zz', role: 'owner', color: '#3DBA8C' }, { user_id: 'u-cyrus', name: 'Cyrus Test', role: 'member', color: '#D9A441' }];
const EMP = { type: 'employer', id: 'o1', name: 'Zz Acme Health', stage: 'contacted', owner_user_id: 'u-cyrus', owner: 'Cyrus', owner_team: 'homelover', due: 'week', due_date: '2026-11-07', category: null };
const TGT = { type: 'target', id: 't1', name: 'Zz Fortem', stage: 'researching', owner_user_id: null, owner: null, owner_team: null, category: null };
const HUB = { type: 'partner', id: 'p1', name: 'Zz HUB', stage: 'live', owner_user_id: 'u-jack', owner_team: 'homelover', category: '4. Brokers & PEOs', next_step: 'Submit joint proposal' };
const INTEREST = { show: true, strongest: { text: '3 site visits this week', at: '2026-11-03' }, items: [{ text: '3 site visits this week', at: '2026-11-03' }] };
const detail = (over = {}) => ({ record: { stage: 'contacted', org_type: 'employer', next_step: 'Follow up with the 2 buyers', next_step_due: null, last_touch: { at: '2026-10-29T18:00:00Z', by: 'Cyrus Test', touch_type: 'done', what: 'Contacted Ana' }, site: { domain: 'acmehealth.example', confirmed: false }, employees: 1250, employees_source: 'apollo', client: {}, ...over.record },
  todos: [], waiting: [], visits: [{ id: 'v1', visits_7d: 6, top_paths: ['/employers', '/pricing'], first_visit: '2026-10-28', last_visit: '2026-11-03' }], signals: [], recent: [], people: [], research: { runs: [{ status: 'done', created_at: '2026-10-28T00:00:00Z', result: { summary: 'They do healthcare.', sells_to: 'Healthcare services', hq_city: 'Phoenix, AZ', housing_perk: 'no housing perk found' } }], today: 1, cap: 5 }, decisions: [], terms: [], stage_history: [{ stage: 'target', at: '2026-10-21T00:00:00Z' }, { stage: 'contacted', at: '2026-10-24T00:00:00Z' }], steps: null, interest: { show: false }, timeline: [], decision_makers: [], ...over });
const FIT = { level: 'strong', source: 'computed', score: 78, used: 6, of: 6, hand_level: null, us_footprint: 'mostly_us', overlay: null, axes: [] };
beforeEach(() => {
  goalsApi.source.mockResolvedValue({ source: { source_kind: 'partner_referral', partner_name: 'HUB' }, history: [], journey: null });
  goalsApi.channelLinks.mockResolvedValue([]);
  goalsApi.fitOf.mockResolvedValue(FIT);
  goalsApi.flowEvents.mockResolvedValue([{ id: 'f1', kind: 'reply_move', text: 'Reply from Zz Acme Health → Replied', at: '2026-11-01T00:00:00Z', by_user: null, undone_at: null }]);
  goalsApi.scoreOf.mockResolvedValue({ row: { score: 37, band: 'P2', source_label: 'website', trend: 'up', band_changed: false, computed_at: '2026-11-05T18:00:00Z', components: { visits: { points: 9 }, people: { points: 0 }, fit: { points: 15 }, research: { points: 10 }, engagement: { points: 3 } } }, lines: [], caps: { visits: 25, people: 15, fit: 15, research: 10, engagement: 10 } });
  goalsApi.referredBy.mockResolvedValue({ total: 1, groups: [], network: { header: { clients: 1, lives: 390, in_pipeline: 0, partners: 0 }, came_from: { kind: 'partner_referral', label: 'Partner referral', partner_not_set: true }, ownership: { team: 'HomeLover', owner: null, co_owner_name: 'Brad' }, groups: [{ key: 'clients', label: 'Clients', total: 1, rows: [{ type: 'employer', id: 'o9', name: 'Momentum', client_status: 'verbal_yes', lives: 390 }], more: 0 }, { key: 'employers', label: 'Employers in pipeline', total: 0, rows: [], more: 0 }] } });
  goalsApi.sourcesNetwork.mockResolvedValue({ roots: [], counts: {} });
  goalsApi.clientFiles.mockResolvedValue([]);
});
afterEach(() => jest.clearAllMocks());
const props = { businessId: 'b1', canEdit: true, members: MEMBERS, meId: 'u-jack', onStar: jest.fn(), onPatch: jest.fn(), onChanged: jest.fn(), onToast: jest.fn(), onConvert: jest.fn(), onClose: jest.fn(), onOpenFull: jest.fn(), onOpenPeople: jest.fn() };

// A label's own text (its direct text nodes, so "Research" ignores the kbd hint and never matches "✓ Research" or "Researched").
const LABELS = { Stage: /^Stage$/, 'Next step': /^Next step$/, Owner: /^Owner$/, Intent: /^Intent$/, 'Mark contacted': /^Mark contacted$/, 'Book meeting': /^Book meeting$/, 'Check Apollo': /^Check Apollo$/, Research: /^Research$/, 'Draft email': /^Draft email$/, Promote: /Promote/, 'Add to pipeline': /^Add to pipeline ▾$/, Deprioritize: /Deprioritize/, Note: /^Note$/, 'To-do': /^To-do$/, Contact: /^Contact$/, Employees: /^Employees$/, Type: /^Type$/, Team: /^Team$/, Recompute: /^Recompute$/ };
const counts = head => Object.fromEntries(Object.entries(LABELS).map(([k, re]) => [k, within(head).queryAllByText(re).length]));
const headOf = dlg => dlg.querySelector('[data-window-head]');
const blocks = head => [...head.children].map(el => el.matches('[data-company-panel]') ? 'title' : el.querySelector('[data-facts-row]') ? 'facts' : el.matches('[data-journey]') ? 'journey' : el.matches('[data-steps]') ? 'setup' : el.matches('[data-interest-band]') ? 'interest' : el.matches('[data-actions-row]') ? 'actions' : el.tagName.toLowerCase());

// todo-events-v1: CRA resets mock implementations before each test - the to-do event reads resolve empty unless a test says otherwise
beforeEach(() => { goalsApi.todoEvents.mockResolvedValue([]); goalsApi.undoTodoEvent.mockResolvedValue({}); });

test('an employer (Contacted, setup done, live interest): head = title · Interest · Actions · facts · journey; every label once; no Fit, Due or stage chip in the title; no empty card; no select; nothing glows; the body opens with the solid Fit radar beside Intel', async () => {
  goalsApi.companyDetail.mockResolvedValue(detail({ steps: { next: null, ready: true, last_touch_at: '2026-10-29T18:00:00Z', steps: [] }, interest: INTEREST }));
  render(<CompanyPanel {...props} row={EMP} />);
  const dlg = screen.getByRole('dialog', { name: 'Zz Acme Health' });
  await within(dlg).findByRole('region', { name: 'Interest' });
  await within(dlg).findByText('37 · warm', { exact: false });
  const head = headOf(dlg);
  expect(blocks(head)).toEqual(['title', 'interest', 'actions', 'facts', 'journey']);
  expect(dlg.querySelector('[data-layout]').getAttribute('data-layout')).toBe('classic');
  // Title row: name · type pill · Top · Intent · site - no Owner / Fit / Due chip, no "Employer · Contacted".
  const title = head.querySelector('[data-company-panel]');
  expect(title.querySelectorAll('[data-chip]')).toHaveLength(0);
  expect(within(title).queryByText(/Employer · Contacted/)).toBeNull();
  expect(within(title).getByRole('button', { name: /Top/ })).toBeInTheDocument();
  expect(within(title).getByRole('link', { name: /acmehealth\.example/ })).toBeInTheDocument();
  expect(counts(head)).toEqual({ Stage: 0, 'Next step': 1, Owner: 1, Intent: 1, 'Mark contacted': 0, 'Book meeting': 1, 'Check Apollo': 1, Research: 1, 'Draft email': 1, Promote: 0, 'Add to pipeline': 0, Deprioritize: 1, Note: 1, 'To-do': 1, Contact: 1, Employees: 1, Type: 1, Team: 1, Recompute: 1 }); // Recompute = the scored Intent's breakdown button (closed), not a title link
  expect(head.querySelector('[data-facts-row] select, [data-fact-pop] select, [data-actions-row] select')).toBeNull(); // no select in a fact popover (the Files card's upload form keeps its own)
  expect(dlg.querySelector('[data-need]')).toBeNull();
  expect(head.querySelector('[data-fact="Type"] b').textContent).toBe('Employer');
  expect(within(head).queryByText(/^Fit/)).toBeNull();
  expect(within(head).queryByText(/no score yet|nobody known|nothing yet|^Reached$|^Overview$|^Fit at a glance$|^Next step$/i, { selector: 'section > span' })).toBeNull();
  expect(head.querySelector('[data-section]')).toBeNull();
  // The journey card is the one stage control: eight nodes on one track - Target ✓ Oct 20, Researched ✓ (the research
  // run), Contacted now, the later nodes numbered buttons; nothing beside the track, no "Progress" word, no stage pills.
  const journey = head.querySelector('[data-journey]');
  expect([...journey.querySelectorAll('[data-node]')].map(li => `${li.dataset.node}:${li.dataset.state}`)).toEqual(['target:done', 'researched:done', 'contacted:now', 'responded:later', 'meeting:later', 'proposal_pilot:later', 'verbal:later', 'launched:later']);
  expect(journey.querySelector('[data-node="target"] small').textContent).toBe('Oct 20');
  expect(journey.querySelector('[data-node="researched"] small').textContent).toBe('Oct 27');
  expect(journey.querySelector('[data-node="contacted"] small').textContent).toBe('now');
  expect(within(journey).queryByText('Progress')).toBeNull();
  expect(head.querySelector('[data-progress-bar], [data-step]')).toBeNull();
  expect([...journey.querySelectorAll('button')].filter(b => !b.closest('[data-journey-track]'))).toHaveLength(0);
  expect(within(journey).getAllByRole('button').map(b => b.getAttribute('aria-label'))).toEqual(['Replied, not yet', 'Meeting, not yet', 'Pilot, not yet', 'Verbal, not yet', 'Client, not yet']);
  expect(within(journey).getByText('Click a later stage to move there · Undo 10 s')).toBeInTheDocument();
  // The body opens with Fit (solid: scored 37, the ring numbers) beside Intel, once each; the right column no longer carries Intel.
  const fitIntel = dlg.querySelector('[data-fit-intel]');
  expect([...fitIntel.querySelectorAll('[data-section]')].map(s => s.dataset.section)).toEqual(['fit', 'research']);
  expect(dlg.querySelectorAll('[data-section="research"]')).toHaveLength(1);
  expect(fitIntel.querySelector('[data-fit-radar]').getAttribute('data-fit-radar')).toBe('scored');
  expect([...fitIntel.querySelectorAll('[data-axis]')].map(el => el.textContent)).toEqual(['Visits 9 of 25', 'People 0 of 15', 'Fit 15 of 15', 'Research ✓ 10', 'Engagement 3 of 10']);
  expect(within(fitIntel).getByText('intent components · score 37 · Nov 5')).toBeInTheDocument();
  expect(within(fitIntel).queryByRole('button', { name: /^Use /})).toBeNull(); // Employees is set (1,250): no Use n
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

test('a target (no score, no people, research + size + owner open, no interest): head = title · Actions · facts · journey - no SETUP; every label once; the title reads "no score yet · Recompute"; Owner and Employees glow red with their titles, the Intel header glows; Add to pipeline ▾ is DECIDE\'s primary; the journey sits on Target and its later nodes open Add to pipeline; Fit is dashed', async () => {
  goalsApi.fitOf.mockResolvedValue(null);
  goalsApi.scoreOf.mockResolvedValue(null); // Fortem: no intent score yet
  goalsApi.companyDetail.mockResolvedValue(detail({ record: { stage: 'researching', next_step: null, last_touch: null, site: null, employees: null, employees_source: null, owner_name: null, kind: 'employer' }, research: { runs: [], today: 0, cap: 5 }, stage_history: [], visits: [],
    steps: { next: 'research', ready: false, steps: [{ id: 'research', label: 'Research', status: 'next' }, { id: 'site', label: 'Confirm site', status: 'skip' }, { id: 'size', label: 'Size & type', status: 'todo', reach: false }, { id: 'owner', label: 'Owner', status: 'todo' }, { id: 'add', label: 'Add to pipeline', status: 'todo' }, { id: 'touch', label: 'First touch', status: 'skip' }] } }));
  render(<CompanyPanel {...props} row={TGT} />);
  const dlg = screen.getByRole('dialog', { name: 'Zz Fortem' });
  await within(dlg).findByRole('region', { name: 'Actions' });
  await waitFor(() => expect(dlg.querySelector('[data-fact="Owner"][data-need]')).toBeInTheDocument());
  const head = headOf(dlg);
  expect(blocks(head)).toEqual(['title', 'actions', 'facts', 'journey']);
  expect(head.querySelector('[data-company-panel] [data-chip]')).toBeNull();
  expect(within(head.querySelector('[data-company-panel]')).queryByText(/Target · Researching/)).toBeNull();
  expect(counts(head)).toEqual({ Stage: 0, 'Next step': 0, Owner: 1, Intent: 1, 'Mark contacted': 1, 'Book meeting': 1, 'Check Apollo': 1, Research: 1, 'Draft email': 1, Promote: 0, 'Add to pipeline': 1, Deprioritize: 1, Note: 1, 'To-do': 1, Contact: 1, Employees: 1, Type: 1, Team: 1, Recompute: 1 });
  expect(within(head).queryByText(/^Fit/)).toBeNull();
  expect(within(head.querySelector('[data-company-panel]')).getByText('no score yet')).toBeInTheDocument();
  expect(within(head.querySelector('[data-company-panel]')).getByRole('button', { name: 'Recompute' })).toBeInTheDocument();
  expect(within(dlg).queryByText(/nobody known at this company/i)).toBeNull();
  expect(head.querySelector('[data-section]')).toBeNull();
  expect(head.querySelector('[data-steps]')).toBeNull();
  expect(head.querySelector('[data-facts-row] select, [data-fact-pop] select, [data-actions-row] select')).toBeNull(); // no select in a fact popover (the Files card's upload form keeps its own)
  // F2: readiness on the facts and the Intel header, titles from the steps.
  const owner = head.querySelector('[data-fact="Owner"]'), employees = head.querySelector('[data-fact="Employees"]');
  expect(owner.getAttribute('title')).toBe('Needed before Add to pipeline'); expect(owner.querySelector('b').textContent).toBe('unassigned');
  expect(employees.getAttribute('data-need')).toBe('true'); expect(employees.getAttribute('title')).toBe('Needed before Add to pipeline · Research fills it'); expect(employees.querySelector('b').textContent).toBe('unknown');
  expect(head.querySelector('[data-fact="Team"][data-need]')).toBeNull();
  expect(within(dlg).getByRole('region', { name: 'Intel' }).querySelector('[data-card-head]').getAttribute('data-need')).toBe('true');
  expect(head.querySelector('[data-fact="Type"] b').textContent).toBe('Employer');
  // One click on Owner = the member list with color dots + Unassigned.
  fireEvent.click(owner);
  expect(within(screen.getByRole('listbox', { name: 'Owner' })).getAllByRole('option').map(o => o.textContent)).toEqual(['Jack Zz', 'Cyrus Test', 'Unassigned']);
  fireEvent.pointerDown(document.body);
  expect(within(within(head).getByRole('group', { name: 'Decide' })).getAllByRole('button').map(b => b.textContent)).toEqual(['Add to pipeline ▾', 'Not a fit', '↓ Deprioritize…']);
  expect(within(within(head).getByRole('group', { name: 'Decide' })).getByRole('button', { name: 'Add to pipeline ▾' })).toHaveClass('ui-btn--primary');
  // A target's journey sits on Target (now), Researched later (no run yet); a later stage node opens Add to pipeline
  // (the promote form under Actions) - no stage write; Mark contacted is REACH's.
  const journey = head.querySelector('[data-journey]');
  expect([...journey.querySelectorAll('button')].filter(b => !b.closest('[data-journey-track]'))).toHaveLength(0);
  expect(journey.querySelector('[data-node="target"][data-state="now"]')).toBeInTheDocument();
  expect(journey.querySelector('[data-node="researched"]').dataset.state).toBe('later');
  expect(within(journey).getByRole('button', { name: 'Contacted, not yet' })).toHaveAttribute('title', 'Add to pipeline first');
  fireEvent.click(within(journey).getByRole('button', { name: 'Contacted, not yet' }));
  expect(within(head).getByRole('button', { name: 'Add to pipeline ▾' })).toHaveAttribute('aria-expanded', 'true');
  expect(within(head).getByRole('button', { name: 'Employer' })).toBeInTheDocument();
  expect(within(within(head).getByRole('group', { name: 'Reach' })).getByRole('button', { name: 'Mark contacted' })).toBeInTheDocument();
  // Fit: dashed, no score yet, "— of cap" on every axis, Recompute score for a Member.
  const fit = dlg.querySelector('[data-fit-intel] [data-section="fit"]');
  expect(fit.querySelector('[data-fit-radar]').getAttribute('data-fit-radar')).toBe('none');
  expect(fit.querySelector('[data-fit-polygon]').getAttribute('stroke-dasharray')).toBe('4 3');
  expect(within(fit).getByText('intent components · no score yet')).toBeInTheDocument();
  expect(within(fit).getByRole('button', { name: 'Recompute score' })).toBeInTheDocument();
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
  expect(dlg.querySelector('[data-journey]')).toBeNull();
  expect(dlg.querySelector('[data-fit-intel]')).toBeNull();
  expect(dlg.querySelectorAll('[data-section="research"]')).toHaveLength(1);
  expect(within(dlg).queryByRole('button', { name: 'Mark contacted' })).toBeNull();
  expect(within(dlg).queryByRole('button', { name: 'Confirm site' })).toBeNull();
  expect(dlg.querySelector('[data-facts-row]')).toBeNull();
});

test('a Viewer: plain facts (readiness still reads, no buttons), the journey without buttons or hint, no Actions row, no chips, no Recompute, no Recompute score, no Use n', async () => {
  goalsApi.companyDetail.mockResolvedValue(detail({ interest: INTEREST, record: { employees: null, employees_source: null }, research: { runs: [{ status: 'done', created_at: '2026-10-28T00:00:00Z', result: { summary: 'They do healthcare.', employees_count: 1300 } }], today: 1, cap: 5 } }));
  render(<CompanyPanel {...props} canEdit={false} row={EMP} />);
  const dlg = screen.getByRole('dialog', { name: 'Zz Acme Health' });
  await within(dlg).findByRole('region', { name: 'Interest' });
  const head = headOf(dlg);
  expect(head.querySelectorAll('[data-fact-button], [data-chip], [data-actions-row], [data-interest-band] button, [data-journey] button, [data-journey-hint]')).toHaveLength(0);
  expect(head.querySelector('[data-journey] [data-node="contacted"][data-state="now"]')).toBeInTheDocument();
  expect(within(dlg).getByText(/view access/)).toBeInTheDocument();
  expect(within(head).getByText('Owner')).toBeInTheDocument();
  expect(within(head).queryByRole('button', { name: 'Recompute' })).toBeNull();
  expect(within(dlg).queryByRole('button', { name: 'Recompute score' })).toBeNull();
  expect(dlg.querySelector('[data-use-employees]')).toBeNull();
});

test('Intel "Use n →" (B2): an employer with no Employees and a research headcount offers "Use 1,300 →" on the Size line; the click saves it through the fields route with Undo', async () => {
  goalsApi.editCompanyFields.mockResolvedValue({ fields: { employees: 1300 } });
  goalsApi.companyDetail.mockResolvedValue(detail({ record: { employees: null, employees_source: null }, research: { runs: [{ status: 'done', created_at: '2026-10-28T00:00:00Z', result: { summary: 'They do healthcare.', size: 'approx. 1,300 employees (est.)', employees_count: 1300 } }], today: 1, cap: 5 } }));
  render(<CompanyPanel {...props} row={EMP} />);
  const dlg = screen.getByRole('dialog', { name: 'Zz Acme Health' });
  const intel = await within(dlg).findByRole('region', { name: 'Intel' });
  const use = within(intel).getByRole('button', { name: 'Use 1,300 →' });
  expect(use.closest('[data-fit-intel]')).not.toBeNull();
  expect(within(intel).getByText(/approx\. 1,300 employees/)).toBeInTheDocument();
  fireEvent.click(use);
  await waitFor(() => expect(goalsApi.editCompanyFields).toHaveBeenCalledWith('b1', 'employer', 'o1', { employees: 1300 }));
  const toast = props.onToast.mock.calls.find(c => /size saved/.test(c[0].text))[0];
  expect(toast.text).toBe('Zz Acme Health: size saved');
  await toast.undo();
  expect(goalsApi.editCompanyFields).toHaveBeenLastCalledWith('b1', 'employer', 'o1', { employees: null });
});

// company-window-v4 Stage 3 (B3 / D2 / D3 amended) - everything below Fit / Intel is seven dense drawer rows on the kit
// Drawer, in order, with counts, previews and the section's action link; Signals opens itself while interest is live; a
// click opens the section's card inline (bare) and the choice is remembered per viewer per company; the To-do link opens
// the capture form; a Viewer gets rows without links; the live partner keeps its cards.
const DRAWER_ORDER = ['signals', 'people', 'todos', 'waiting', 'notes', 'client', 'files'];
const rowInfo = (drawers, id) => { const r = drawers.querySelector(`[data-drawer="${id}"]`); return { label: r.querySelector('.ui-drawer__label').textContent, count: r.querySelector('.ui-drawer__count').textContent, warn: r.querySelector('.ui-drawer__count').classList.contains('ui-drawer__count--warn'), preview: r.querySelector('.ui-drawer__summary')?.textContent ?? null, action: r.querySelector('.ui-drawer__action')?.textContent ?? null, open: r.dataset.open, dense: r.classList.contains('ui-drawer--dense') }; };
const richDetail = () => detail({ interest: INTEREST, timeline: [{ id: 't1', kind: 'visited', text: 'Visited /pricing', at: '2026-11-03T18:00:00Z' }], todos: [{ id: 'td1', text: 'Send the one-pager', due_date: '2026-11-07', owner: 'Cyrus Test' }], people: [{ id: 'p1', name: 'Ana Buyer', title: 'VP People' }, { id: 'p2', name: 'Bo Ops', title: null }, { id: 'p3', name: 'Cy Three', title: null }], steps: { next: null, ready: true, steps: [] } });

test('B3 drawers: seven 40 px rows in order with counts, previews, action links; Signals open (interest live); the open body is the bare card; a click opens People and is remembered per viewer per company; + Add opens the to-do form; every drawer label once', async () => {
  localStorage.clear();
  goalsApi.companyDetail.mockResolvedValue(richDetail());
  goalsApi.clientFiles.mockResolvedValue([{ id: 'f1', kind: 'agreement', title: 'MSA draft', type_label: 'PDF', size_bytes: 2048, uploaded_at: '2026-11-01' }]);
  render(<CompanyPanel {...props} row={EMP} />);
  const dlg = screen.getByRole('dialog', { name: 'Zz Acme Health' });
  const drawers = await waitFor(() => { const el = dlg.querySelector('[data-company-drawers]'); if (!el) throw new Error('no drawers yet'); return el; });
  await waitFor(() => expect(drawers.querySelector('[data-drawer="files"] .ui-drawer__count').textContent).toBe('1'));
  expect([...drawers.querySelectorAll('[data-drawer]')].map(r => r.dataset.drawer)).toEqual(DRAWER_ORDER);
  expect(drawers.previousElementSibling.getAttribute('data-fit-intel')).toBe('true');
  expect(dlg.querySelector('[data-panel-body]')).toBeNull();
  expect(rowInfo(drawers, 'signals')).toEqual({ label: 'Signals & visits', count: '1', warn: true, preview: 'Visited /pricing · Nov 3', action: 'Open in People →', open: 'true', dense: true });
  expect(rowInfo(drawers, 'people')).toEqual({ label: 'People', count: '3', warn: false, preview: 'Ana Buyer · Bo Ops · +1', action: '+ Contact', open: 'false', dense: true });
  expect(rowInfo(drawers, 'todos')).toEqual({ label: 'Open to-dos', count: '1', warn: false, preview: 'Send the one-pager · due Nov 7', action: '+ Add', open: 'false', dense: true });
  expect(rowInfo(drawers, 'waiting')).toEqual({ label: 'Waiting on them', count: '0', warn: false, preview: 'Nothing owed', action: null, open: 'false', dense: true });
  const notes = rowInfo(drawers, 'notes');
  expect([notes.label, notes.count, notes.action, notes.open]).toEqual(['Notes & touches', '1', '+ Note', 'false']);
  expect(notes.preview).toMatch(/Reply from Zz Acme Health → Replied · automatic$/);
  expect(rowInfo(drawers, 'client')).toEqual({ label: 'Client', count: '—', warn: false, preview: 'Not a client yet', action: 'Make client', open: 'false', dense: true });
  expect(rowInfo(drawers, 'files')).toEqual({ label: 'Files', count: '1', warn: false, preview: 'MSA draft · Nov 1', action: '+ Upload', open: 'false', dense: true });
  // The open Signals body is the Signals card in bare mode: its content, no second label; the link sits outside the head button.
  const signals = drawers.querySelector('[data-drawer="signals"]');
  expect(signals.querySelector('[data-section="signals"][data-bare]')).toBeInTheDocument();
  expect(within(signals).getAllByText('Signals & visits')).toHaveLength(1);
  expect(within(signals).getByText('Visited /pricing')).toBeInTheDocument();
  expect(signals.querySelector('.ui-drawer__head').contains(signals.querySelector('.ui-drawer__action'))).toBe(false);
  for (const id of DRAWER_ORDER.slice(1)) expect(drawers.querySelector(`[data-drawer="${id}"] .ui-drawer__body`)).toBeNull();
  // Click People = the row opens with the card's rows; remembered under prospector_company_drawers for this company.
  fireEvent.click(within(drawers.querySelector('[data-drawer="people"]')).getByRole('button', { name: /^People/ }));
  const people = drawers.querySelector('[data-drawer="people"]');
  expect(people.dataset.open).toBe('true');
  expect(within(people).getByText('Ana Buyer')).toBeInTheDocument();
  expect(within(people).getByText('Cy Three')).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem('prospector_company_drawers'))['employer-o1']).toMatchObject({ people: true });
  fireEvent.click(within(people).getByRole('button', { name: /^People/ }));
  expect(people.dataset.open).toBe('false');
  expect(JSON.parse(localStorage.getItem('prospector_company_drawers'))['employer-o1'].people).toBe(false);
  // The row's + Add link opens the To-do capture form under Actions (the same form the To-do button opens).
  fireEvent.click(within(drawers.querySelector('[data-drawer="todos"]')).getByRole('button', { name: '+ Add' }));
  expect(within(headOf(dlg)).getByRole('button', { name: /^To-do/ })).toHaveAttribute('aria-expanded', 'true');
  // + Upload opens the Files drawer with the upload control inside.
  fireEvent.click(within(drawers.querySelector('[data-drawer="files"]')).getByRole('button', { name: '+ Upload' }));
  const files = drawers.querySelector('[data-drawer="files"]');
  expect(files.dataset.open).toBe('true');
  expect(within(files).getByLabelText('File kind')).toBeInTheDocument();
  expect(await within(files).findByText('MSA draft')).toBeInTheDocument();
  // Every drawer label once among the rows; the Client row's count is the dash.
  for (const l of ['Signals & visits', 'People', 'Open to-dos', 'Waiting on them', 'Notes & touches', 'Client', 'Files']) expect(within(drawers).getAllByText(l)).toHaveLength(1);
});

test('D2: a stored choice reopens on the next visit; the live Interest band opens Signals even when it was stored closed; a Viewer gets the rows without action links; the live partner keeps its cards (no drawers)', async () => {
  localStorage.setItem('prospector_company_drawers', JSON.stringify({ 'employer-o1': { signals: false, todos: true, _at: 1 } }));
  goalsApi.companyDetail.mockResolvedValue(richDetail());
  goalsApi.clientFiles.mockResolvedValue([]);
  const { unmount } = render(<CompanyPanel {...props} row={EMP} />);
  let dlg = screen.getByRole('dialog', { name: 'Zz Acme Health' });
  let drawers = await waitFor(() => { const el = dlg.querySelector('[data-company-drawers]'); if (!el) throw new Error('no drawers yet'); return el; });
  expect(drawers.querySelector('[data-drawer="signals"]').dataset.open).toBe('true');
  expect(drawers.querySelector('[data-drawer="todos"]').dataset.open).toBe('true');
  expect(within(drawers.querySelector('[data-drawer="todos"]')).getByText('Send the one-pager')).toBeInTheDocument();
  expect(drawers.querySelector('[data-drawer="people"]').dataset.open).toBe('false');
  unmount();
  render(<CompanyPanel {...props} canEdit={false} row={EMP} />);
  dlg = screen.getByRole('dialog', { name: 'Zz Acme Health' });
  drawers = await waitFor(() => { const el = dlg.querySelector('[data-company-drawers]'); if (!el) throw new Error('no drawers yet'); return el; });
  expect([...drawers.querySelectorAll('[data-drawer]')].map(r => r.dataset.drawer)).toEqual(DRAWER_ORDER);
  expect(drawers.querySelectorAll('.ui-drawer__action')).toHaveLength(0);
  expect(within(drawers).queryByRole('button', { name: /Make client|\+ Upload|\+ Contact|\+ Add|\+ Note|Open in People/ })).toBeNull();
  expect(rowInfo(drawers, 'client').preview).toBe('Not a client yet');
  fireEvent.click(within(drawers.querySelector('[data-drawer="client"]')).getByRole('button', { name: /^Client/ }));
  expect(within(drawers.querySelector('[data-drawer="client"]')).getByText('Not a client yet.')).toBeInTheDocument();
  expect(within(drawers.querySelector('[data-drawer="client"]')).queryByRole('button', { name: 'Make client' })).toBeNull();
});

test('mockup C still: the live partner window has no drawers - its cards stay', async () => {
  goalsApi.companyDetail.mockResolvedValue(detail({ record: { stage: 'live', next_step: 'Submit joint proposal', next_step_due: '2026-11-04', last_touch: null, site: null }, stage_history: [{ stage: 'live', at: '2026-11-03T20:00:00Z' }], steps: { steps: [], next: null, ready: true } }));
  render(<CompanyPanel {...props} row={HUB} />);
  const dlg = screen.getByRole('dialog', { name: 'Zz HUB' });
  await within(dlg).findByText('Live since Nov 3');
  expect(dlg.querySelector('[data-company-drawers]')).toBeNull();
  expect(dlg.querySelector('[data-panel-body] [data-section="signals"]:not([data-bare])')).toBeInTheDocument();
  expect(dlg.querySelector('[data-panel-body] [data-section="people"]')).toBeInTheDocument();
});
