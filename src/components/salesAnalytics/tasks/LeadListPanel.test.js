import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import CallNotesPanel from './CallNotesPanel';
import { goalsApi } from '../goals/goalsApi';

// lead-upload-v1 Stage 3 - the Lead list side of Intake. SYNTHETIC rows (invented names); the routes are mocked.
jest.mock('../goals/goalsApi', () => ({ goalsApi: { extractCallNotes: jest.fn(), createFromCallNotes: jest.fn(), appendToSection: jest.fn(), extractLeads: jest.fn(), fileLeads: jest.fn(), partners: jest.fn() } }));

const JACK = 'u-jack', CY = 'u-cy';
const members = [{ user_id: JACK, name: 'Jack Test', role: 'owner' }, { user_id: CY, name: 'Cyrus Temp', role: 'member' }, { user_id: 'u-v', name: 'Viewer Test', role: 'viewer' }];
const lookup = id => ({ [JACK]: { first: 'Jack', color: '#6F8CF0' }, [CY]: { first: 'Cyrus', color: '#C97626' } }[id] || { first: 'Unassigned', color: '#888' });
const links = { options: {}, load: jest.fn(), labelFor: (t, id) => `${t}: ${id}` };
const person = (name, extra = {}) => ({ name, title: 'VP Human Resources', location: 'Chicago, IL', linkedin_url: null, why: 'Recently changed roles', already_in: false, ...extra });
const company = (key, name, extra = {}) => ({ key, name, domain: null, employees: null, hq: null, kind_guess: 'employer', category: null, evidence: name, status: 'new', kind: 'employer', action: 'create', reason: null, chip: null, match: null, apollo_account_id: null, existing_source: null, possible: [], people: [], ...extra });
const REVIEW = {
  people_count: 5, source: { source_kind: 'apollo' }, text_hash: 'h', earlier: null, usage: {},
  companies: [
    company('c0', 'Acme Widgets', { employees: 12500, people: [person('Pat Roe'), person('Lee Moe', { title: 'Director HR' })] }),
    company('c1', 'Harbor Benefits Consulting', { kind_guess: 'partner', kind: 'partner', category: '4. Brokers', people: [person('Alex Doe')] }),
    company('c2', 'Bluefin Retail', { status: 'employer', action: 'skip', reason: 'Upside owns this (Rob Example)', chip: { text: 'Upside owns this (Rob Example)', tone: 'warn', skip: true }, match: { type: 'opportunity', id: 'o1', name: 'Bluefin Retail', stage: 'contacted' }, people: [person('Ann One')] }),
    company('c3', 'Copperleaf Foods', { status: 'employer', action: 'add_people', chip: { text: 'Shared with Upside', tone: 'info', skip: false }, match: { type: 'opportunity', id: 'o2', name: 'Copperleaf Foods', stage: 'target' }, existing_source: 'Partner referral · Referral Partners LLC', people: [person('Ben Two'), person('Old Hand', { already_in: true })] }),
  ],
};

const setup = props => render(<CallNotesPanel businessId="b1" members={members} lookup={lookup} links={links} onClose={jest.fn()} onCreated={jest.fn()} onShowCalls={jest.fn()} onFiled={jest.fn()} {...props} />);
const toLeads = () => fireEvent.click(screen.getByRole('button', { name: 'Lead list' }));
const pickSource = v => fireEvent.change(screen.getByLabelText('Where did these leads come from?'), { target: { value: v } });
const paste = text => fireEvent.change(screen.getByRole('textbox', { name: 'Lead list' }), { target: { value: text } });
const row = name => within(document.querySelector(`[data-lead-company="${name}"]`));

afterEach(() => jest.clearAllMocks());

test('the switch: Call notes stays the default; Lead list swaps the notes dropdown for the required source picker, keeps the pasted text, hides .vtt', () => {
  setup();
  expect(screen.getByRole('button', { name: 'Call notes' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByLabelText('What these notes are')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Call notes'), { target: { value: 'Pat Roe\nVP HR @Acme Widgets' } });
  toLeads();
  expect(screen.queryByLabelText('What these notes are')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Where did these leads come from?')).toBeRequired();
  expect(screen.getByRole('textbox', { name: 'Lead list' })).toHaveValue('Pat Roe\nVP HR @Acme Widgets');
  expect(screen.getByLabelText('Upload lead list file')).toHaveAttribute('accept', '.txt,.md,.docx');
  expect(screen.getByRole('button', { name: 'Read list' })).toBeDisabled();
  pickSource('apollo');
  expect(screen.getByRole('button', { name: 'Read list' })).toBeEnabled();
  // Partner referral needs a partner from Pipeline; person referral a name.
  goalsApi.partners.mockResolvedValue([{ id: 'p2', name: 'Zeta Brokers' }, { id: 'p1', name: 'Alpha Benefits', archived_at: null }]);
  pickSource('partner_referral');
  expect(screen.getByRole('button', { name: 'Read list' })).toBeDisabled();
  return waitFor(() => expect(screen.getByLabelText('Which partner referred these leads?')).toBeEnabled()).then(() => {
    expect(within(screen.getByLabelText('Which partner referred these leads?')).getAllByRole('option').map(o => o.textContent)).toEqual(['Pick the partner', 'Alpha Benefits', 'Zeta Brokers']);
    fireEvent.change(screen.getByLabelText('Which partner referred these leads?'), { target: { value: 'p1' } });
    expect(screen.getByRole('button', { name: 'Read list' })).toBeEnabled();
    pickSource('person_referral');
    expect(screen.getByRole('button', { name: 'Read list' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Who referred these leads?'), { target: { value: 'Rob Example' } });
    expect(screen.getByRole('button', { name: 'Read list' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Call notes' }));
    expect(screen.getByLabelText('Call notes')).toHaveValue('Pat Roe\nVP HR @Acme Widgets');
  });
});

test('Read list: one extract with the picked source; the review groups people by company with the S4 defaults; Cancel files nothing', async () => {
  goalsApi.extractLeads.mockResolvedValue(REVIEW);
  const onClose = jest.fn();
  setup({ onClose });
  toLeads(); pickSource('apollo');
  fireEvent.change(screen.getByLabelText('Upload note'), { target: { value: 'Apollo recommended, Oct 26' } });
  paste('Pat Roe\nVP HR @Acme Widgets');
  fireEvent.click(screen.getByRole('button', { name: 'Read list' }));
  await screen.findByText('Review · nothing is saved until File leads');
  expect(goalsApi.extractLeads).toHaveBeenCalledTimes(1);
  expect(goalsApi.extractLeads).toHaveBeenCalledWith('b1', { text: 'Pat Roe\nVP HR @Acme Widgets', source: { pick: 'apollo', partner_id: null, person: null, note: 'Apollo recommended, Oct 26' } });
  expect(screen.queryByRole('button', { name: 'Lead list' })).not.toBeInTheDocument();

  // New + not owned -> Create, with kind / Owner (me) / Research now; two people grouped under one company, why lines shown.
  const acme = row('Acme Widgets');
  expect(acme.getByText('New · 12,500 employees')).toBeInTheDocument();
  expect(acme.getByRole('button', { name: 'Create' })).toHaveAttribute('aria-pressed', 'true');
  expect(acme.getByLabelText('Kind of Acme Widgets')).toHaveValue('employer');
  expect(acme.getByLabelText('Owner')).toHaveValue('');
  expect(acme.getByLabelText('Research now for Acme Widgets')).not.toBeChecked();
  expect(within(acme.getByRole('list', { name: 'People at Acme Widgets' })).getAllByRole('listitem')).toHaveLength(2);
  expect(acme.getAllByText('“Recently changed roles”')).toHaveLength(2);
  expect(within(acme.getByLabelText('Owner')).getAllByRole('option').map(o => o.textContent)).toEqual(['Me', 'Jack', 'Cyrus']);
  // A broker guessed as a partner.
  expect(row('Harbor Benefits Consulting').getByLabelText('Kind of Harbor Benefits Consulting')).toHaveValue('partner');
  expect(row('Harbor Benefits Consulting').getByText('4. Brokers')).toBeInTheDocument();
  // Upside owns it -> Skip with the reason; the chip shows; Create is not offered on a matched company.
  const blue = row('Bluefin Retail');
  expect(blue.getByText('In Pipeline · Employer · contacted')).toBeInTheDocument();
  expect(blue.getByText('Upside owns this (Rob Example)', { selector: '.ui-tag' })).toBeInTheDocument();
  expect(blue.getByRole('button', { name: 'Skip' })).toHaveAttribute('aria-pressed', 'true');
  expect(blue.getByText('Skipped: Upside owns this (Rob Example)')).toBeInTheDocument();
  expect(blue.queryByRole('button', { name: 'Create' })).not.toBeInTheDocument();
  // 'both' -> Add people with the chip; the existing source is shown as kept; the stored person is "Already in".
  const copper = row('Copperleaf Foods');
  expect(copper.getByRole('button', { name: 'Add people' })).toHaveAttribute('aria-pressed', 'true');
  expect(copper.getByText('Shared with Upside')).toBeInTheDocument();
  expect(copper.getByText(/Source already set: Partner referral · Referral Partners LLC - kept/)).toBeInTheDocument();
  expect(copper.getByText('Already in')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Create 2 companies · add 4 people · skip 1');

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onClose).toHaveBeenCalled();
  expect(goalsApi.fileLeads).not.toHaveBeenCalled();
});

test('File leads sends every row with its action, kind, owner, research and people; the override of a Skip default counts; the toast line comes back', async () => {
  goalsApi.extractLeads.mockResolvedValue(REVIEW);
  goalsApi.fileLeads.mockResolvedValue({ upload_id: 'up1', created: [{ type: 'employer', id: 'e1', name: 'Acme Widgets' }, { type: 'partner', id: 'p9', name: 'Harbor Benefits Consulting' }], people_added: 5, already_in: 1, skipped: [], overrides: ['Bluefin Retail'], research: [{ name: 'Acme Widgets', ok: true }] });
  const onFiled = jest.fn();
  setup({ onFiled });
  toLeads(); pickSource('apollo'); paste('list');
  fireEvent.click(screen.getByRole('button', { name: 'Read list' }));
  await screen.findByText('Review · nothing is saved until File leads');
  const acme = row('Acme Widgets');
  fireEvent.change(acme.getByLabelText('Owner'), { target: { value: CY } });
  fireEvent.click(acme.getByLabelText('Research now for Acme Widgets'));
  fireEvent.change(row('Harbor Benefits Consulting').getByLabelText('Kind of Harbor Benefits Consulting'), { target: { value: 'target' } });
  fireEvent.click(row('Bluefin Retail').getByRole('button', { name: 'Add people' }));
  expect(row('Bluefin Retail').getByText('Filing anyway - the override is kept on the upload')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Create 2 companies · add 5 people · skip 0');
  fireEvent.click(screen.getByRole('button', { name: 'File leads' }));
  await waitFor(() => expect(onFiled).toHaveBeenCalledWith('Filed from the lead list: 2 companies created · 5 people added · 1 already in · 0 skipped', expect.anything()));
  const body = goalsApi.fileLeads.mock.calls[0][1];
  expect(body.source).toEqual({ pick: 'apollo', partner_id: null, person: null, note: null });
  expect(body.companies.map(c => [c.name, c.action, c.kind, c.owner_user_id, c.research, c.people.length])).toEqual([
    ['Acme Widgets', 'create', 'employer', CY, true, 2], ['Harbor Benefits Consulting', 'create', 'target', null, false, 1], ['Bluefin Retail', 'add_people', 'employer', null, false, 1], ['Copperleaf Foods', 'add_people', 'employer', null, false, 2],
  ]);
  expect(body.companies[0].people[0]).toEqual({ name: 'Pat Roe', title: 'VP Human Resources', location: 'Chicago, IL', linkedin_url: null, why: 'Recently changed roles' });
  expect(JSON.stringify(body)).not.toMatch(/[^\s@"]+@[^\s@"]+\.[a-z]{2,}/i);
});

test('a refused read (too many people) shows the error and keeps the list; File leads is off when everything is skipped', async () => {
  goalsApi.extractLeads.mockRejectedValueOnce(new Error('The list has 31 people - split the list (up to 30 people per upload)'));
  setup();
  toLeads(); pickSource('event'); paste('a long list');
  fireEvent.click(screen.getByRole('button', { name: 'Read list' }));
  expect(await screen.findByText(/split the list/)).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Lead list' })).toHaveValue('a long list');
  goalsApi.extractLeads.mockResolvedValueOnce({ ...REVIEW, companies: [REVIEW.companies[2]], earlier: { id: 'u0', created_at: '2026-10-20T18:00:00Z', counts: { companies_created: 3, people_added: 7 } } });
  fireEvent.click(screen.getByRole('button', { name: 'Read list' }));
  await screen.findByText('Review · nothing is saved until File leads');
  expect(screen.getByRole('note')).toHaveTextContent('This list was filed before on Oct 20 (3 created · 7 people added)');
  expect(screen.getByRole('button', { name: 'File leads' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '← Back to list' }));
  expect(screen.getByRole('textbox', { name: 'Lead list' })).toHaveValue('a long list');
  expect(goalsApi.fileLeads).not.toHaveBeenCalled();
});
