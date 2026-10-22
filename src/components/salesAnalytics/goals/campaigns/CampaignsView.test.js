import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import CampaignsView from './CampaignsView';
import { goalsApi } from '../goalsApi';
import { memberLookup } from '../goalsUi';
import { mergeFields, filterContacts, EMPTY_FILTERS, contactMoves } from './campaignModel';

// seif-campaign-v1 Stage 3 - Pipeline > Campaigns. Made-up people; the server never sends an address and the screen
// never shows one.
jest.mock('../goalsApi', () => ({
  TODOS_CHANGED: 'todos',
  goalsApi: {
    campaigns: jest.fn(), campaign: jest.fn(), createCampaign: jest.fn(), campaignAction: jest.fn(), contactAction: jest.fn(),
    contactDraft: jest.fn(), importCampaign: jest.fn(), updateCampaignStep: jest.fn(),
    companyDetail: jest.fn(() => new Promise(() => {})), pipelineBoard: jest.fn(() => new Promise(() => {})),
  },
}));
jest.mock('../../../../utils/useMediaQuery', () => () => false);

const JACK = 'u-jack', SEIF = 'u-seif';
const members = [{ user_id: JACK, name: 'Jack Carlson' }, { user_id: SEIF, name: 'Seif Nour' }];
const lookup = memberLookup(members);
const counts = { contacts: 2, by_status: { active: 1, queued: 1 }, sent_by_step: { 1: 1 }, sent_contacts: 1, replies: 0, meetings: 0, promoted: 0, reply_rate: 0,
  by_track: [{ track_id: 't1', name: 'Consultants / brokers · knows Seif', contacts: 1, sent: 1, replies: 0, reply_rate: 0 }] };
const CAMPAIGN = { id: 'c1', name: 'Fall campaign', status: 'draft', sender_user_id: SEIF, owner_user_ids: [SEIF], counts };
const step = (n, extra) => ({ id: `s${n}`, track_id: 't1', step_no: n, day_offset: [0, 4, 10][n - 1], subject: '', body: '', updated_at: 'x', ...extra });
const DETAIL = {
  campaign: CAMPAIGN,
  tracks: [{ id: 't1', name: 'Consultants / brokers · knows Seif', segment: 'consultant_broker', warmth: 'warm', sort: 0, steps: [step(1, { subject: 'Idea for {company}', body: 'Hi {first_name},\nas {title} you…' }), step(2), step(3)] }],
  contacts: [
    { id: 'k1', campaign_id: 'c1', name: 'Ana Alder', title: 'Principal', company: 'Alder Consulting', segment: 'consultant_broker', warmth: 'warm', track_id: 't1', owner_user_id: SEIF, status: 'active', current_step: 1, next_due_date: '2026-10-22', last_sent_at: null, replied_at: null, goal_id: 'g1', conflict: 'company already in Pipeline (Alder Consulting)', has_email: true, import_row: 2 },
    { id: 'k3', campaign_id: 'c1', name: 'Cleo Cedar', title: 'CHRO', company: 'Cedar Co', segment: 'consultant_broker', warmth: 'warm', track_id: 't1', owner_user_id: SEIF, status: 'queued', current_step: 1, next_due_date: null, has_email: true, import_row: 4 },
    { id: 'k2', campaign_id: 'c1', name: 'Gus Gale', title: 'Director', company: 'Gale Co', segment: null, warmth: null, track_id: null, owner_user_id: SEIF, status: 'queued', current_step: 1, next_due_date: null, has_email: true, import_row: 3 },
  ],
  counts,
};
const PREVIEW = {
  header_row: 1, headers: ['Name', 'Email'], columns: {}, added: 0, counts: { add: 1, skip: 2, brad: 1 },
  rows: [
    { row: 2, would: 'add', reasons: [], labels: [], name: 'Cleo Cedar', title: 'CHRO', company: 'Cedar Co', track: 'Corporate · knows Seif', has_email: true, match: null },
    { row: 3, would: 'skip', reasons: ['brad', 'in_pipeline'], labels: ["Brad's / Upside's company", 'company already in Pipeline'], name: 'Dev Dune', company: 'Harbor Benefits', has_email: true, match: { type: 'partner', id: 'p1', name: 'Harbor Benefits' } },
    { row: 4, would: 'skip', reasons: ['missing_email'], labels: ['missing email'], name: 'Eli Elm', company: 'Elm Works', has_email: false, match: null },
  ],
};
beforeEach(() => {
  jest.clearAllMocks(); localStorage.clear();
  goalsApi.campaigns.mockResolvedValue([CAMPAIGN]);
  goalsApi.campaign.mockResolvedValue(DETAIL);
});
const openCampaign = async () => { fireEvent.click(await screen.findByRole('button', { name: 'Fall campaign' })); await screen.findByRole('heading', { name: 'Fall campaign' }); };

test('model: merge fields, filters, which buttons a status allows', () => {
  expect(mergeFields('Hi {first_name} at {company} ({title}) {other}', { name: 'Ana Alder', company: 'Alder', title: '' })).toBe('Hi Ana at Alder () {other}');
  expect(filterContacts(DETAIL.contacts, { ...EMPTY_FILTERS, due: 'today' }, '2026-10-22').map(c => c.id)).toEqual(['k1']);
  expect(filterContacts(DETAIL.contacts, { ...EMPTY_FILTERS, due: 'none' }, '2026-10-22').map(c => c.id)).toEqual(['k3', 'k2']);
  expect(filterContacts(DETAIL.contacts, { ...EMPTY_FILTERS, q: 'gale' }, '2026-10-22').map(c => c.id)).toEqual(['k2']);
  expect(contactMoves({ status: 'active' })).toMatchObject({ send: true, stop: true, skip: true });
  expect(contactMoves({ status: 'replied' })).toEqual({ mark: true, promote: true });
  expect(contactMoves({ status: 'queued', track_id: null })).toMatchObject({ resume: false });
  expect(contactMoves({ status: 'opted_out' })).toEqual({});
});

test('Member: list -> campaign counts, Activate, a contact Sent with Undo; the row detail; no address anywhere', async () => {
  goalsApi.campaignAction.mockResolvedValue({ campaign: { ...CAMPAIGN, status: 'active' }, scheduled: 1, no_track: 1, cap: 40 });
  goalsApi.contactAction.mockImplementation((b, id, action) => Promise.resolve(action === 'undo' ? { contact: { id } } : { contact: { id }, event: { id: 'ev-1' } }));
  render(<CampaignsView businessId="b1" canEdit members={members} lookup={lookup} meId={JACK} />);
  expect(await screen.findByRole('button', { name: 'New campaign' })).toBeInTheDocument();
  await openCampaign();
  const stats = document.querySelector('[data-campaign-counts]');
  expect(stats).toHaveTextContent('Contacts2');
  expect(stats).toHaveTextContent('Step 1: 1');
  expect(stats).toHaveTextContent('Consultants / brokers · knows Seif: 0% (0/1)');
  fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
  await waitFor(() => expect(goalsApi.campaignAction).toHaveBeenCalledWith('b1', 'c1', 'activate'));
  expect(await screen.findByText(/Scheduled 1 contact · 1 still need a segment \/ warmth · up to 40 sends a day/)).toBeInTheDocument();

  const ana = screen.getByRole('group', { name: 'Actions for Ana Alder' });
  fireEvent.click(within(ana).getByRole('button', { name: 'Sent' }));
  await waitFor(() => expect(goalsApi.contactAction).toHaveBeenCalledWith('b1', 'k1', 'sent', { step_no: 1 }));
  fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(goalsApi.contactAction).toHaveBeenCalledWith('b1', 'k1', 'undo', { event_id: 'ev-1' }));
  const gus = screen.getByRole('group', { name: 'Actions for Gus Gale' });
  expect(within(gus).queryByRole('button', { name: 'Sent' })).toBeNull();
  expect(within(gus).getByRole('button', { name: 'Stop' })).toBeInTheDocument();

  fireEvent.click(screen.getAllByRole('button', { name: /Show details|details/i })[0]);
  const detail = await waitFor(() => { const d = document.querySelector('[data-contact-detail]'); expect(d).toBeTruthy(); return d; });
  expect(detail).toHaveTextContent('company already in Pipeline (Alder Consulting)');
  expect(detail).toHaveTextContent('row 2 · email on file');
  expect(document.body.textContent).not.toContain('@');
});

test('Templates: live preview on a real contact of the track; Save sends only that step', async () => {
  goalsApi.updateCampaignStep.mockResolvedValue({});
  render(<CampaignsView businessId="b1" canEdit members={members} lookup={lookup} meId={JACK} />);
  await openCampaign();
  fireEvent.click(screen.getByRole('button', { name: 'Templates' }));
  const preview = await screen.findByLabelText('Step 1 preview');
  expect(preview).toHaveTextContent('Preview · Ana Alder, Alder Consulting');
  expect(preview).toHaveTextContent('Idea for Alder Consulting');
  expect(preview).toHaveTextContent('Hi Ana, as Principal you…');
  const editor = document.querySelector('[data-step="1"]');
  fireEvent.change(within(editor).getByLabelText('Subject'), { target: { value: 'New idea for {company}' } });
  expect(preview).toHaveTextContent('New idea for Alder Consulting');
  fireEvent.click(within(editor).getByRole('button', { name: 'Save step 1' }));
  await waitFor(() => expect(goalsApi.updateCampaignStep).toHaveBeenCalledWith('b1', 'c1', 's1', { subject: 'New idea for {company}', body: 'Hi {first_name},\nas {title} you…' }));
  expect(screen.getByRole('button', { name: 'Save step 2' })).toBeDisabled();
});

test('Import: preview flags, Add anyway re-previews with that row, Add commits', async () => {
  goalsApi.importCampaign.mockImplementation((b, c, body) => Promise.resolve(body.dryRun ? PREVIEW : { ...PREVIEW, added: 1 }));
  render(<CampaignsView businessId="b1" canEdit members={members} lookup={lookup} meId={JACK} />);
  await openCampaign();
  fireEvent.click(screen.getByRole('button', { name: 'Import contacts' }));
  const file = new File(['Name,Email\n'], 'contacts.csv', { type: 'text/csv' });
  fireEvent.change(screen.getByLabelText('Contact sheet'), { target: { files: [file] } });
  await waitFor(() => expect(goalsApi.importCampaign).toHaveBeenCalledWith('b1', 'c1', expect.objectContaining({ dryRun: true, include: [], file: expect.objectContaining({ name: 'contacts.csv' }) })));
  const rows = await screen.findAllByText(/Left out|Add$/);
  expect(rows.length).toBeGreaterThan(0);
  expect(document.querySelector('[data-import-row="3"]')).toHaveTextContent("Brad's / Upside's company");
  expect(document.querySelector('[data-import-row="4"]')).not.toHaveTextContent('email ✓');
  expect(document.querySelector('[data-import-row="4"]').querySelector('input[type=checkbox]')).toBeNull();
  fireEvent.click(within(document.querySelector('[data-import-row="3"]')).getByLabelText('Add anyway'));
  await waitFor(() => expect(goalsApi.importCampaign).toHaveBeenLastCalledWith('b1', 'c1', expect.objectContaining({ dryRun: true, include: [3] })));
  const add = screen.getByRole('button', { name: 'Add 1 contact' });
  await waitFor(() => expect(add).not.toBeDisabled());
  fireEvent.click(add);
  await waitFor(() => expect(goalsApi.importCampaign).toHaveBeenLastCalledWith('b1', 'c1', expect.objectContaining({ dryRun: false, include: [3] })));
  expect(await screen.findByText('Added 1 contact')).toBeInTheDocument();
  expect(document.body.textContent).not.toContain('@');
});

test('Viewer: reads the campaign and its templates - no New, Import, Activate, row buttons or editors', async () => {
  render(<CampaignsView businessId="b1" canEdit={false} members={members} lookup={lookup} meId={SEIF} />);
  await openCampaign();
  expect(screen.queryByRole('button', { name: 'Import contacts' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull();
  expect(screen.queryByRole('group', { name: 'Actions for Ana Alder' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Templates' }));
  expect(await screen.findByText('Idea for {company}')).toBeInTheDocument();
  expect(screen.queryByLabelText('Subject')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '← All campaigns' }));
  expect(await screen.findByRole('button', { name: 'Fall campaign' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'New campaign' })).toBeNull();
});
