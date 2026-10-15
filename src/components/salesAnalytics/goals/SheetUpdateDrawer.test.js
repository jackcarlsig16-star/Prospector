import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SheetUpdateDrawer from './SheetUpdateDrawer';
import PipelineView from './PipelineView';
import { goalsApi } from './goalsApi';

// pipeline-board-v1 Stage 4 - Update from sheet.
jest.mock('./goalsApi', () => ({ ...jest.requireActual('./goalsApi'), goalsApi: { ...jest.requireActual('./goalsApi').goalsApi, sheetUpdatePreview: jest.fn(), sheetUpdateApply: jest.fn(), pipelineBoard: jest.fn() } }));
jest.mock('../pipelineApi', () => ({ fetchOpportunities: jest.fn(), createOpportunity: jest.fn(), updateOpportunity: jest.fn(), archiveOpportunity: jest.fn() }));

const item = (key, group, name, extra = {}) => ({ key, group, type: 'partner', name, record_id: null, changes: [], tickable: true, note: null, sig: `sig-${key}`, ...extra });
const PREVIEW = {
  rows: 4,
  items: [
    item('stage:partner:p1', 'stage', 'Gallagher', { from_label: 'Replied', to_label: 'Meeting set' }),
    item('stage:partner:p4', 'stage', 'Aon', { from_label: 'Proposal / pilot', to_label: 'Replied', tickable: false, note: 'Prospector is ahead' }),
    item('new:employer:fresh', 'new', 'Fresh Employer', { type: 'employer', to_label: 'Contacted', changes: [{ field: 'tier', label: 'Tier', value: '2' }] }),
  ],
  info: { differences: [], skipped: [{ name: 'Gone Co', record_id: '', reason: 'Prospector ID not found' }], invalid: [], ignored: ['Top', 'Status'], stage_mismatches: [], kind_mismatches: [], multi_person: [] },
};
const upload = async (name = 'joint.csv') => {
  const f = new File(['Account,Type\nX,Partner'], name, { type: 'text/csv' });
  fireEvent.change(screen.getByLabelText('Sheet file'), { target: { files: [f] } });
};

beforeEach(() => { goalsApi.sheetUpdatePreview.mockResolvedValue(PREVIEW); goalsApi.sheetUpdateApply.mockResolvedValue({ applied: 1, failed: [] }); });

test('preview: forward moves + new rows ticked, a backward move greyed with "Prospector is ahead"; Apply sends only ticked keys + sigs', async () => {
  const onApplied = jest.fn();
  render(<SheetUpdateDrawer businessId="b1" onClose={jest.fn()} onApplied={onApplied} />);
  await upload();
  const gal = await screen.findByLabelText('Gallagher: Replied → Meeting set');
  expect(goalsApi.sheetUpdatePreview).toHaveBeenCalledWith('b1', { name: 'joint.csv', data: expect.any(String) });
  expect(gal.checked).toBe(true);
  const aon = screen.getByLabelText('Aon: Proposal / pilot → Replied');
  expect(aon.disabled).toBe(true);
  expect(aon.checked).toBe(false);
  expect(screen.getByText(/Prospector is ahead/)).toBeTruthy();
  expect(screen.getByText(/Not matched \/ skipped \(1\)/)).toBeTruthy();
  expect(screen.getByText(/Ignored columns \(1\)/)).toBeTruthy();
  fireEvent.click(screen.getByLabelText(/^Fresh Employer:/));
  fireEvent.click(screen.getByRole('button', { name: 'Apply 1' }));
  await waitFor(() => expect(goalsApi.sheetUpdateApply).toHaveBeenCalledWith('b1', { name: 'joint.csv', data: expect.any(String) }, [{ key: 'stage:partner:p1', sig: 'sig-stage:partner:p1' }]));
  expect(await screen.findByText('Updated 1.')).toBeTruthy();
  expect(onApplied).toHaveBeenCalledWith({ applied: 1, failed: [] });
});

test('nothing to update: says so, no Apply button', async () => {
  goalsApi.sheetUpdatePreview.mockResolvedValue({ ...PREVIEW, items: [PREVIEW.items[1]] });
  render(<SheetUpdateDrawer businessId="b1" onClose={jest.fn()} onApplied={jest.fn()} />);
  await upload();
  expect(await screen.findByText(/Nothing to update/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Apply/ })).toBeNull();
});

test('a refused file shows the server message; a failed row is listed after apply', async () => {
  goalsApi.sheetUpdatePreview.mockRejectedValueOnce(new Error('File refused: row 3 (HLU-0003, Notes): contains an "@" - remove it and re-export'));
  render(<SheetUpdateDrawer businessId="b1" onClose={jest.fn()} onApplied={jest.fn()} />);
  await upload();
  expect(await screen.findByText(/File refused: row 3/)).toBeTruthy();
  goalsApi.sheetUpdateApply.mockResolvedValue({ applied: 1, failed: [{ key: 'new:employer:fresh', name: 'Fresh Employer', error: 'changed since the preview' }] });
  await upload('joint.xlsx');
  fireEvent.click(await screen.findByRole('button', { name: 'Apply 2' }));
  expect(await screen.findByText('Fresh Employer: changed since the preview')).toBeTruthy();
});

test('Pipeline view: Update from sheet is Member+ only and reloads the board after apply', async () => {
  goalsApi.pipelineBoard.mockResolvedValue([]);
  const { unmount } = render(<PipelineView businessId="b1" canEdit={false} onOpenPartner={jest.fn()} onOpenCompanies={jest.fn()} />);
  await waitFor(() => expect(goalsApi.pipelineBoard).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: 'Update from sheet' })).toBeNull();
  unmount();
  render(<PipelineView businessId="b1" canEdit onOpenPartner={jest.fn()} onOpenCompanies={jest.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Update from sheet' }));
  await upload();
  fireEvent.click(await screen.findByRole('button', { name: 'Apply 2' }));
  expect(await screen.findByText('Updated 1')).toBeTruthy();
  await waitFor(() => expect(goalsApi.pipelineBoard).toHaveBeenCalledTimes(3));
});
