import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MakeClientForm, ClientCard, FilesCard, mdy } from './ClientParts';
import NetworkCard, { cameFromText } from './NetworkCard';
import ClientsView from './ClientsView';
import NetworkTree from './NetworkTree';
import { goalsApi, OPEN_PIPELINE_RECORD } from './goalsApi';

jest.mock('./goalsApi', () => ({
  OPEN_PIPELINE_RECORD: 'prospector:open-pipeline-record',
  goalsApi: {
    partners: jest.fn(), makeClient: jest.fn(), undoClient: jest.fn(), markClient: jest.fn(), clientFiles: jest.fn(), clientUploadUrl: jest.fn(),
    recordClientFile: jest.fn(), clientFileUrl: jest.fn(), archiveClientFile: jest.fn(), restoreClientFile: jest.fn(), referredBy: jest.fn(), clients: jest.fn(), sourcesNetwork: jest.fn(),
  },
}));

// homelover-clients-v1 Stage 2 - the client pieces (invented companies; names and numbers only, no emails or phones).
const EMP = { type: 'employer', id: 'e1', name: 'Zz Momentum' };
const PARTNERS = [{ id: 'p-hub', name: 'Zz Hub' }, { id: 'p-up', name: 'Zz Upside' }];
const made = { client: { id: 'e1', name: 'Zz Momentum', client_status: 'verbal_yes' }, created: false, contacts_stopped: 2, todo_id: 't1', warnings: ['1 person is in Apollo sequences - stop them in Apollo'], event_id: 'ev1' };
beforeEach(() => { goalsApi.partners.mockResolvedValue(PARTNERS); });
afterEach(() => jest.clearAllMocks());

test('Make client: prefilled from the record, sends status + lives + dates + source, toast says what else happened, Undo calls undo', async () => {
  goalsApi.makeClient.mockResolvedValue(made);
  const onDone = jest.fn(), onToast = jest.fn();
  const record = { covered_lives: 390, client: { expected_close: '2026-11-20', launch_date: '2027-01-01' } };
  render(<MakeClientForm businessId="b1" row={EMP} record={record} source={{ source_kind: null }} onDone={onDone} onToast={onToast} onCancel={() => {}} />);
  expect(screen.getByLabelText('Eligible now')).toHaveValue('390');
  expect(screen.getByLabelText('Expected signing')).toHaveValue('2026-11-20');
  fireEvent.change(screen.getByLabelText('Eligible added'), { target: { value: '250' } });
  fireEvent.change(screen.getByLabelText('Added because'), { target: { value: 'acquisition, expected April 2027' } });
  fireEvent.click(screen.getByRole('button', { name: 'Make client' }));
  expect(await screen.findByText('Pick a source - who brought this client in')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'partner_referral' } });
  fireEvent.click(screen.getByRole('button', { name: 'Make client' }));
  expect(await screen.findByText('Partner referral needs the partner picked')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText('Partner')).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText('Partner'), { target: { value: 'p-hub' } });
  fireEvent.click(screen.getByRole('button', { name: 'Make client' }));
  await waitFor(() => expect(goalsApi.makeClient).toHaveBeenCalled());
  expect(goalsApi.makeClient.mock.calls[0][1]).toEqual({
    opportunity_id: 'e1', status: 'verbal_yes', eligible_now: 390, eligible_added: 250, eligible_added_note: 'acquisition, expected April 2027',
    expected_signing_date: '2026-11-20', launch_date: '2027-01-01', source: { source_kind: 'partner_referral', source_partner_id: 'p-hub', source_person: null },
  });
  expect(onDone).toHaveBeenCalledWith(made);
  const toast = onToast.mock.calls[0][0];
  expect(toast.text).toBe('Zz Momentum is a client · Verbal yes · 2 campaign people stopped · "Send agreement" added · 1 person is in Apollo sequences - stop them in Apollo');
  await act(() => toast.undo());
  expect(goalsApi.undoClient).toHaveBeenCalledWith('b1', 'ev1');
});

test('Add › Client and "Add a client they referred": company + website asked, the partner preset kept; source unchanged is not resent', async () => {
  goalsApi.makeClient.mockResolvedValue({ ...made, created: true });
  render(<MakeClientForm businessId="b1" preset={{ source_kind: 'partner_referral', source_partner_id: 'p-hub' }} onDone={() => {}} onToast={() => {}} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Make client' }));
  expect(await screen.findByText('Company name and website are both needed')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'Zz Nova' } });
  fireEvent.change(screen.getByLabelText('Website'), { target: { value: 'nova.example' } });
  fireEvent.click(screen.getByRole('button', { name: 'Make client' }));
  await waitFor(() => expect(goalsApi.makeClient).toHaveBeenCalled());
  expect(goalsApi.makeClient.mock.calls[0][1]).toMatchObject({ organization: 'Zz Nova', domain: 'nova.example', source: { source_kind: 'partner_referral', source_partner_id: 'p-hub' } });
  goalsApi.makeClient.mockClear();
  const { unmount } = render(<MakeClientForm businessId="b1" row={EMP} source={{ source_kind: 'homelover_outreach' }} onDone={() => {}} onToast={() => {}} onCancel={() => {}} />);
  fireEvent.click(screen.getAllByRole('button', { name: 'Make client' }).at(-1));
  await waitFor(() => expect(goalsApi.makeClient).toHaveBeenCalled());
  expect(goalsApi.makeClient.mock.calls[0][1].source).toBeUndefined();
  unmount();
});

test('Client card: Make client when not one (Members only); a client shows status, lives, dates and the next mark with Undo', async () => {
  const onMake = jest.fn();
  const { rerender } = render(<ClientCard businessId="b1" row={EMP} detail={{ record: { client: {} } }} canEdit onMake={onMake} onChanged={() => {}} onToast={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Make client' }));
  expect(onMake).toHaveBeenCalled();
  rerender(<ClientCard businessId="b1" row={EMP} detail={{ record: { client: {} } }} canEdit={false} onMake={onMake} onChanged={() => {}} onToast={() => {}} />);
  expect(screen.queryByRole('region', { name: 'Client' })).toBeNull();
  goalsApi.markClient.mockResolvedValue({ event_id: 'ev2' });
  const onToast = jest.fn(), onChanged = jest.fn();
  const c = { client_status: 'verbal_yes', eligible_now: 390, eligible_added: 250, eligible_added_note: 'acquisition', client_since: `${new Date().getFullYear()}-11-03`, expected_signing_date: '2026-11-20', launch_date: '2027-01-01' };
  rerender(<ClientCard businessId="b1" row={EMP} detail={{ record: { client: c } }} canEdit onMake={onMake} onChanged={onChanged} onToast={onToast} />);
  const card = screen.getByRole('region', { name: 'Client' });
  expect(within(card).getByText('Verbal yes')).toBeInTheDocument();
  expect(card.textContent).toContain('390 (+250) eligible');
  expect(card.textContent).toContain('Launch Jan 1, 2027');
  expect(card.textContent).toContain('Apollo stage to match by hand: Negotiation');
  fireEvent.click(within(card).getByRole('button', { name: 'Mark signed' }));
  await waitFor(() => expect(goalsApi.markClient).toHaveBeenCalledWith('b1', 'e1', 'signed', { expect_status: 'verbal_yes' }));
  await act(() => onToast.mock.calls[0][0].undo());
  expect(goalsApi.undoClient).toHaveBeenCalledWith('b1', 'ev2');
  rerender(<ClientCard businessId="b1" row={EMP} detail={{ record: { client: { ...c, client_status: 'launched' } } }} canEdit={false} onMake={onMake} onChanged={onChanged} onToast={onToast} />);
  expect(within(screen.getByRole('region', { name: 'Client' })).queryAllByRole('button')).toHaveLength(0);
});

test('Files: upload = signed url -> PUT to storage -> record; refuses a wrong type before any call; open + archive with Undo', async () => {
  goalsApi.clientFiles.mockResolvedValue([]);
  goalsApi.clientUploadUrl.mockResolvedValue({ file_id: 'f1', upload_url: 'https://storage.test/up?token=t' });
  goalsApi.recordClientFile.mockResolvedValue({ id: 'f1', title: 'msa', kind: 'agreement' });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  const onToast = jest.fn();
  render(<FilesCard businessId="b1" row={EMP} canEdit version={0} onToast={onToast} />);
  expect(await screen.findByText(/No agreements or financials yet/)).toBeInTheDocument();
  const input = screen.getByLabelText('Upload a file');
  fireEvent.change(input, { target: { files: [new File(['x'], 'notes.zip', { type: 'application/zip' })] } });
  expect(await screen.findByText('Only PDF / DOCX / XLSX / PNG / JPG files')).toBeInTheDocument();
  expect(goalsApi.clientUploadUrl).not.toHaveBeenCalled();
  const pdf = new File(['%PDF-1.4'], 'msa.pdf', { type: 'application/pdf' });
  fireEvent.change(input, { target: { files: [pdf] } });
  await waitFor(() => expect(goalsApi.recordClientFile).toHaveBeenCalledWith('b1', 'e1', { file_id: 'f1', kind: 'agreement', title: 'msa' }));
  expect(goalsApi.clientUploadUrl).toHaveBeenCalledWith('b1', 'e1', { kind: 'agreement', title: 'msa', mime: 'application/pdf', size_bytes: pdf.size });
  expect(global.fetch).toHaveBeenCalledWith('https://storage.test/up?token=t', expect.objectContaining({ method: 'PUT', body: pdf }));
  expect(onToast.mock.calls[0][0].text).toBe('msa filed under Zz Momentum');
  goalsApi.clientFiles.mockResolvedValue([{ id: 'f1', kind: 'agreement', title: 'msa', type_label: 'PDF', size_bytes: 52000, uploaded_at: '2026-11-03T20:00:00Z' }]);
  await act(() => onToast.mock.calls[0][0].undo());
  expect(goalsApi.archiveClientFile).toHaveBeenCalledWith('b1', 'f1');
  const row = await screen.findByText('msa');
  goalsApi.clientFileUrl.mockResolvedValue({ url: 'https://storage.test/sign/x', expires_in: 60 });
  const tab = { location: { href: '' }, close: jest.fn() };
  window.open = jest.fn(() => tab);
  fireEvent.click(row);
  expect(window.open).toHaveBeenCalledWith('', '_blank');
  await waitFor(() => expect(tab.location.href).toBe('https://storage.test/sign/x'));
  fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
  await waitFor(() => expect(onToast).toHaveBeenCalledTimes(2));
  await act(() => onToast.mock.calls[1][0].undo());
  expect(goalsApi.restoreClientFile).toHaveBeenCalledWith('b1', 'f1');
});

const NET = {
  partner: { id: 'p-hub', name: 'Zz Hub' }, total: 1,
  groups: [{ person: null, office: null, rows: [{ type: 'employer', id: 'e1', name: 'Zz Momentum', stage_label: 'Verbal', owner: 'Jack', covered_lives: 390, client_status: 'verbal_yes' }] }],
  network: {
    header: { clients: 1, lives: 390, in_pipeline: 0, partners: 0, targets: 0 },
    groups: [
      { key: 'clients', label: 'Clients', total: 1, more: 0, rows: [{ type: 'employer', id: 'e1', name: 'Zz Momentum', client_status: 'verbal_yes', lives: 390 }] },
      { key: 'employers', label: 'Employers in pipeline', total: 0, more: 0, rows: [] }, { key: 'partners', label: 'Partners', total: 0, more: 0, rows: [] }, { key: 'targets', label: 'Targets', total: 0, more: 0, rows: [] },
    ],
    came_from: { kind: 'partner_referral', label: 'Partner referral', partner_id: null, partner_name: null, person: null, partner_not_set: true },
    ownership: { owner: 'Seif', team: 'HomeLover', co_owner_name: 'Rep Name' },
  },
};

test('Network card (mock C): real counts, Clients with status + lives, empty pipeline copy, Came from "partner not set — Set it", by rep toggle, a row opens its window', async () => {
  goalsApi.referredBy.mockResolvedValue(NET);
  const onSetSource = jest.fn(), onAddClient = jest.fn(), opened = jest.fn();
  window.addEventListener(OPEN_PIPELINE_RECORD, opened);
  render(<NetworkCard businessId="b1" row={{ type: 'partner', id: 'p-hub', name: 'Zz Hub' }} version={0} canEdit onSetSource={onSetSource} onAddClient={onAddClient} />);
  const card = await screen.findByRole('region', { name: 'Network' });
  await waitFor(() => expect(card.querySelector('[data-network-header]').textContent).toBe('1 client · 390 lives · 0 in pipeline · 0 partners'));
  const clients = card.querySelector('[data-network-group="clients"]');
  expect(clients.textContent).toContain('Zz Momentum'); expect(clients.textContent).toContain('Verbal yes'); expect(clients.textContent).toContain('390');
  expect(card.querySelector('[data-network-group="employers"]').textContent).toContain('None yet — add one with "Add a client they referred" or set Source on the employer.');
  expect(card.querySelector('[data-network-group="partners"]')).toBeNull();
  expect(card.querySelector('[data-came-from]').textContent).toBe('Came from: Partner referral · partner not set — Set itOwnership: HomeLover · Seif · co-owner set');
  expect(card.textContent).not.toContain('Rep Name');
  fireEvent.click(within(card).getByRole('button', { name: 'Set it' }));
  expect(onSetSource).toHaveBeenCalled();
  fireEvent.click(within(card).getByRole('button', { name: '+ Add a client they referred' }));
  expect(onAddClient).toHaveBeenCalled();
  fireEvent.click(within(clients).getByRole('button', { name: 'Zz Momentum' }));
  expect(opened.mock.calls[0][0].detail).toEqual({ key: 'employer-e1' });
  fireEvent.click(within(card).getByRole('button', { name: 'by rep' }));
  expect(card.querySelector('[data-referred-group]').textContent).toContain('No rep named (1)');
  window.removeEventListener(OPEN_PIPELINE_RECORD, opened);
  expect(cameFromText({ kind: 'partner_referral', label: 'Partner referral', partner_name: 'Zz Upside', person: 'Pat' })).toEqual({ text: 'Partner referral · Zz Upside · Pat', missing: false });
  expect(cameFromText(null)).toEqual({ text: 'Source not set', missing: true });
});

test('Viewer Network card: no Set it, no Add a client', async () => {
  goalsApi.referredBy.mockResolvedValue(NET);
  render(<NetworkCard businessId="b1" row={{ type: 'partner', id: 'p-hub', name: 'Zz Hub' }} version={0} canEdit={false} onSetSource={() => {}} onAddClient={() => {}} />);
  const card = await screen.findByRole('region', { name: 'Network' });
  await waitFor(() => expect(card.querySelector('[data-network-header]')).not.toBeNull());
  expect(within(card).queryByRole('button', { name: 'Set it' })).toBeNull();
  expect(within(card).queryByRole('button', { name: '+ Add a client they referred' })).toBeNull();
});

test('Clients view: totals by status, rows with Referred by (or "Partner not set"), years shown when not this year', async () => {
  goalsApi.clients.mockResolvedValue({
    clients: [
      { id: 'e1', name: 'Zz Momentum', client_status: 'verbal_yes', eligible_now: 390, eligible_added: 250, launch_date: '2027-01-01', signed_date: null, referred_by: { id: 'p-hub', name: 'Zz Hub' }, owner: 'Jack', files: 1 },
      { id: 'e2', name: 'Zz Other', client_status: 'signed', eligible_now: 100, eligible_added: null, launch_date: null, signed_date: '2026-11-18', referred_by: { id: null, name: null }, owner: null, files: 0 },
    ],
    totals: { clients: 2, by_status: { verbal_yes: 1, agreement_sent: 0, signed: 1, launched: 0 }, eligible_now: 490, eligible_added: 250 },
  });
  render(<ClientsView businessId="b1" />);
  const view = await screen.findByRole('region', { name: 'Clients' });
  expect(view.querySelector('[data-clients-totals]').textContent).toBe('2 clients · 490 eligible lives (+250 coming)Verbal yes 1 · Agreement sent 0 · Signed 1 · Launched 0');
  const r1 = view.querySelector('[data-client-row="e1"]');
  expect(r1.textContent).toContain('390 (+250)'); expect(r1.textContent).toContain('Jan 1, 2027'); expect(r1.textContent).toContain('Zz Hub');
  expect(view.querySelector('[data-client-row="e2"]').textContent).toContain('Partner not set');
  expect(mdy(null)).toBe('—');
});

test('Network tree: roots, rollup, ↻ see above, and n more', async () => {
  goalsApi.sourcesNetwork.mockResolvedValue({ partners_with_none: 3, roots: [
    { type: 'partner', id: 'p-up', name: 'Zz Upside', depth: 1, rollup: { clients: 1, lives: 390, in_pipeline: 220 }, more: 204, children: [
      { type: 'partner', id: 'p-hub', name: 'Zz Hub', depth: 2, rollup: { clients: 1, lives: 390, in_pipeline: 0 }, more: 0, children: [{ type: 'employer', id: 'e1', name: 'Zz Momentum', client_status: 'verbal_yes', lives: 390, depth: 3 }] },
      { type: 'partner', id: 'p-x', name: 'Zz Ring', depth: 2, repeat: true },
    ] },
  ] });
  render(<NetworkTree businessId="b1" />);
  const tree = await screen.findByRole('region', { name: 'Network' });
  await waitFor(() => expect(tree.querySelector('[data-network-node="partner:p-up"]')).not.toBeNull());
  expect(tree.querySelector('[data-network-node="partner:p-up"]').textContent).toContain('1 client · 390 lives · 220 in pipeline');
  expect(tree.querySelector('[data-network-node="employer:e1"]').textContent).toContain('390 lives');
  expect(tree.querySelector('[data-network-node="partner:p-x"]').textContent).toContain('↻ see above');
  expect(tree.textContent).toContain('and 204 more');
  expect(tree.textContent).toContain("3 partners haven't brought anything in yet.");
});
