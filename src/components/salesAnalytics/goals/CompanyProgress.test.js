import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CompanyProgress, { progressModel } from './CompanyProgress';
import ProgressBar from '../../../ui/ProgressBar';
import { goalsApi } from './goalsApi';
import { updateOpportunity } from '../pipelineApi';

jest.mock('./goalsApi', () => ({ goalsApi: { partnerSignal: jest.fn(), partnerUndo: jest.fn() } }));
jest.mock('../pipelineApi', () => ({ updateOpportunity: jest.fn() }));
jest.mock('../huddleApi', () => ({ updateProspect: jest.fn() }));

// company-progress-bar-v1 Stage 2 + FIX company-window-subtract-v1 REV2 - the bar alone on its line: a pill is the one
// stage control (confirm when backward), nothing beside it; viewers read it (invented companies).
const EMP = { type: 'employer', id: 'o1', name: 'Zz Elm', stage: 'contacted' };
const PARTNER = { type: 'partner', id: 'p1', name: 'Zz Harbor', stage: 'replied', category: '2. Brokers & PEOs' };
const TARGET = { type: 'target', id: 't1', name: 'Zz Quarry', stage: 'proposed' };
const detail = (stage, extra = {}) => ({ record: { stage, last_touch: null }, stage_history: [], ...extra });
const setup = (row, d, props = {}) => {
  const p = { onPatch: jest.fn(), onChanged: jest.fn(), onToast: jest.fn(), ...props };
  render(<CompanyProgress businessId="b1" row={row} detail={d} canEdit {...p} />);
  return p;
};
const besideBar = () => [...document.querySelectorAll('[data-company-progress] button')].filter(b => !b.closest('[data-progress-bar]'));
afterEach(() => jest.clearAllMocks());

test('ProgressBar: 28 px one-line pills whose names (and tooltips) carry done / now / later, not only color; a read-only bar has no buttons; onStep makes each a button', () => {
  const steps = [{ id: 'a', label: 'Alpha', at: 'Oct 1' }, { id: 'b', label: 'Beta', at: 'Oct 3' }, { id: 'c', label: 'Gamma' }];
  const { rerender } = render(<ProgressBar label="Deal" steps={steps} current={1} />);
  expect(screen.getByLabelText('Alpha, done Oct 1')).toBeInTheDocument();
  expect(screen.getByLabelText('Alpha, done Oct 1')).toHaveAttribute('title', 'Alpha, done Oct 1');
  expect(screen.getByLabelText('Alpha, done Oct 1').textContent).toBe('✓ Alpha');
  expect(screen.getByLabelText('Alpha, done Oct 1').style.height).toBe('28px');
  expect(screen.getByLabelText('Beta, now, since Oct 3')).toBeInTheDocument();
  expect(screen.getByLabelText('Beta, now, since Oct 3').textContent).toBe('Beta');
  expect(screen.getByLabelText('Gamma, not yet')).toBeInTheDocument();
  expect(screen.queryAllByRole('button')).toHaveLength(0);
  expect(document.querySelector('[aria-current="step"]').dataset.step).toBe('b');
  const onStep = jest.fn();
  rerender(<ProgressBar label="Deal" steps={steps} current={1} onStep={onStep} side="Lost" />);
  fireEvent.click(screen.getByRole('button', { name: /Gamma/ }));
  expect(onStep).toHaveBeenCalledWith(2);
  expect(screen.getByText('Lost')).toBeInTheDocument();
});

test('progressModel: employer stages with dates reached; partner workflow (in_sequence = Sent, paused = side lane); a target sits on Target; visitors none', () => {
  const e = progressModel('employer', 'responded', [{ stage: 'target', at: '2026-10-01T18:00:00Z' }, { stage: 'contacted', at: '2026-10-05T18:00:00Z' }]);
  expect([e.current, e.steps[0].at, e.steps[1].at, e.steps[2].at, e.side]).toEqual([2, 'Oct 1', 'Oct 5', null, null]);
  expect(progressModel('employer', 'lost').side).toBe('Lost');
  const p = progressModel('partner', 'in_sequence', [{ stage: 'in_sequence', at: '2026-10-02T18:00:00Z' }]);
  expect([p.current, p.steps[3].at]).toEqual([3, 'Oct 2']);
  expect([progressModel('partner', 'paused').side, progressModel('partner', 'paused').current]).toEqual(['Paused', -1]);
  expect([progressModel('target', 'proposed').current, progressModel('target', 'proposed').stage]).toEqual([0, 'target']);
  expect(progressModel('visitor', null)).toBeNull();
});

test('REV2: the bar is alone on its line - no primary, no More ▾ - and scrolls sideways (nowrap) for every record type', () => {
  setup(EMP, detail('contacted'));
  expect(besideBar()).toHaveLength(0);
  expect(screen.queryByRole('button', { name: /Log reply|More ▾|Mark contacted|Book meeting/ })).toBeNull();
  expect(document.querySelector('[data-progress-bar]').getAttribute('data-nowrap')).toBe('true');
  expect(screen.getByRole('region', { name: 'Progress' }).getAttribute('title')).toBe('Click a stage to jump · Undo 10 s');
  document.body.innerHTML = '';
  setup(PARTNER, detail('replied'));
  expect(besideBar()).toHaveLength(0);
  expect(document.querySelector('[data-progress-bar]').getAttribute('data-nowrap')).toBe('true');
  document.body.innerHTML = '';
  setup(TARGET, detail('proposed'));
  expect(screen.queryByRole('button')).toBeNull();
  expect(document.querySelector('[data-step="target"][data-state="now"]')).toBeInTheDocument();
  expect(screen.queryByText('Progress')).toBeNull();
  expect(screen.queryByText(/Last touch/)).toBeNull();
});

test('employer: the next pill moves the stage (PATCH with no allow_backward), patches the row, toasts "moved to" with Undo', async () => {
  updateOpportunity.mockResolvedValue({});
  const p = setup(EMP, detail('contacted'));
  fireEvent.click(screen.getByRole('button', { name: /^Responded, not yet/ }));
  await waitFor(() => expect(updateOpportunity).toHaveBeenCalledWith('b1', 'o1', { stage: 'responded' }));
  expect(p.onPatch).toHaveBeenCalledWith(expect.objectContaining({ stage: 'responded' }));
  const toast = p.onToast.mock.calls[0][0];
  expect(toast.text).toBe('Zz Elm: moved to Responded');
  await toast.undo();
  expect(updateOpportunity).toHaveBeenLastCalledWith('b1', 'o1', { stage: 'contacted', allow_backward: true });
});

test('partner: a pill sends the status signal with expect = the stage shown; Undo = the partner undo', async () => {
  goalsApi.partnerSignal.mockResolvedValue({ event: { id: 'ev9' } });
  const p = setup(PARTNER, detail('replied'));
  fireEvent.click(screen.getByRole('button', { name: /^Meeting, not yet/ }));
  await waitFor(() => expect(goalsApi.partnerSignal).toHaveBeenCalledWith('b1', 'p1', { type: 'status', to: 'meeting_set', expect: 'replied' }));
  await p.onToast.mock.calls[0][0].undo();
  expect(goalsApi.partnerUndo).toHaveBeenCalledWith('b1', 'p1', 'ev9');
});

test('a stale screen (409) says "This changed elsewhere - refresh"', async () => {
  updateOpportunity.mockRejectedValue(Object.assign(new Error('This changed elsewhere - refresh'), { status: 409 }));
  setup(EMP, detail('contacted'));
  fireEvent.click(screen.getByRole('button', { name: /^Responded, not yet/ }));
  expect(await screen.findByText(/This changed elsewhere - refresh/)).toBeInTheDocument();
});

test('jump: a later segment moves forward; an earlier one asks first and sends allow_backward', async () => {
  updateOpportunity.mockResolvedValue({});
  setup({ ...EMP, stage: 'meeting' }, detail('meeting'));
  fireEvent.click(screen.getByRole('button', { name: /^Verbal,/ }));
  await waitFor(() => expect(updateOpportunity).toHaveBeenCalledWith('b1', 'o1', { stage: 'verbal' }));
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
  fireEvent.click(await screen.findByRole('button', { name: /^Contacted,/ }));
  await waitFor(() => expect(updateOpportunity).toHaveBeenCalledWith('b1', 'o1', { stage: 'contacted', allow_backward: true }));
  expect(confirm).toHaveBeenCalled();
  confirm.mockRestore();
});

test('Viewer: the bar reads; no pill buttons, no tooltip sentence', () => {
  render(<CompanyProgress businessId="b1" row={EMP} detail={detail('contacted', { record: { stage: 'contacted', last_touch: { at: '2026-10-20T19:00:00Z', touch_type: 'done', what: 'Contacted Zz Elm', by: 'Jack Carlson' } } })} canEdit={false} onToast={jest.fn()} onChanged={jest.fn()} />);
  expect(screen.queryAllByRole('button')).toHaveLength(0);
  expect(document.querySelector('[data-progress-bar]')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Progress' }).getAttribute('title')).toBeNull();
});
