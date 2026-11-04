import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import CompanyProgress, { progressModel, lastTouchLine } from './CompanyProgress';
import ProgressBar from '../../../ui/ProgressBar';
import { goalsApi } from './goalsApi';
import { updateOpportunity } from '../pipelineApi';

jest.mock('./goalsApi', () => ({ goalsApi: { advanceStage: jest.fn(), partnerSignal: jest.fn(), partnerUndo: jest.fn(), markContacted: jest.fn(), undoContactTarget: jest.fn(), updateWeekGoal: jest.fn() } }));
jest.mock('../pipelineApi', () => ({ updateOpportunity: jest.fn() }));
jest.mock('../huddleApi', () => ({ updateProspect: jest.fn() }));

// company-progress-bar-v1 Stage 2 - the bar, its one primary, the target ruling, viewers (invented companies).
const EMP = { type: 'employer', id: 'o1', name: 'Zz Elm', stage: 'contacted' };
const PARTNER = { type: 'partner', id: 'p1', name: 'Zz Harbor', stage: 'replied', category: '2. Brokers & PEOs' };
const TARGET = { type: 'target', id: 't1', name: 'Zz Quarry', stage: 'proposed' };
const detail = (stage, extra = {}) => ({ record: { stage, last_touch: null }, stage_history: [], ...extra });
const setup = (row, d, props = {}) => {
  const p = { onPatch: jest.fn(), onChanged: jest.fn(), onToast: jest.fn(), onConvert: jest.fn(), ...props };
  render(<CompanyProgress businessId="b1" row={row} detail={d} canEdit {...p} />);
  return p;
};
afterEach(() => jest.clearAllMocks());

test('ProgressBar: done / now / later carry words, not only color; a read-only bar has no buttons; onStep makes each a button', () => {
  const steps = [{ id: 'a', label: 'Alpha', at: 'Oct 1' }, { id: 'b', label: 'Beta', at: 'Oct 3' }, { id: 'c', label: 'Gamma' }];
  const { rerender } = render(<ProgressBar label="Deal" steps={steps} current={1} />);
  expect(screen.getByLabelText('Alpha, done Oct 1')).toBeInTheDocument();
  expect(screen.getByLabelText('Beta, now, since Oct 3')).toBeInTheDocument();
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

test('lastTouchLine: today · who · what', () => {
  const now = new Date('2026-11-03T20:00:00Z');
  expect(lastTouchLine({ at: '2026-11-03T19:00:00Z', touch_type: 'done', what: 'Contacted Zz Elm', by: 'Jack Carlson' }, now)).toBe('Last touch: today · Jack Carlson · Contacted Zz Elm');
  expect(lastTouchLine({ at: '2026-10-20T19:00:00Z', touch_type: 'email' }, now)).toBe('Last touch: Oct 20 · email touch');
  expect(lastTouchLine(null, now)).toBeNull();
});

test('employer: the one primary is the next verb (Contacted -> Log reply); it advances with expect = the stage shown, patches the row and offers Undo', async () => {
  goalsApi.advanceStage.mockResolvedValue({ before: 'contacted', after: 'responded' });
  const p = setup(EMP, detail('contacted'));
  fireEvent.click(screen.getByRole('button', { name: 'Log reply' }));
  await waitFor(() => expect(goalsApi.advanceStage).toHaveBeenCalledWith('b1', 'employer', 'o1', 'contacted'));
  expect(p.onPatch).toHaveBeenCalledWith(expect.objectContaining({ stage: 'responded' }));
  const toast = p.onToast.mock.calls[0][0];
  expect(toast.text).toBe('Zz Elm: moved to Responded');
  await toast.undo();
  expect(updateOpportunity).toHaveBeenCalledWith('b1', 'o1', { stage: 'contacted', allow_backward: true });
});

test('ruling 2: the bar\'s own Book meeting (Responded) advances the stage', async () => {
  goalsApi.advanceStage.mockResolvedValue({ before: 'responded', after: 'meeting' });
  setup({ ...EMP, stage: 'responded' }, detail('responded'));
  fireEvent.click(screen.getByRole('button', { name: 'Book meeting' }));
  await waitFor(() => expect(goalsApi.advanceStage).toHaveBeenCalledWith('b1', 'employer', 'o1', 'responded'));
});

test('a stale screen (409) says "This changed elsewhere - refresh"', async () => {
  goalsApi.advanceStage.mockRejectedValue(Object.assign(new Error('This changed elsewhere - refresh'), { status: 409 }));
  setup(EMP, detail('contacted'));
  fireEvent.click(screen.getByRole('button', { name: 'Log reply' }));
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

test('More: an employer can go to Lost / Nurture / On hold; a partner can Pause (deprioritize with expect)', async () => {
  updateOpportunity.mockResolvedValue({});
  setup(EMP, detail('contacted'));
  fireEvent.click(screen.getByRole('button', { name: 'More ▾' }));
  expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map(b => b.textContent)).toEqual(['Lost', 'Nurture', 'On hold']);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Nurture' }));
  await waitFor(() => expect(updateOpportunity).toHaveBeenCalledWith('b1', 'o1', { stage: 'nurture' }));
});

test('partner More = Pause', async () => {
  goalsApi.partnerSignal.mockResolvedValue({ event: { id: 'ev9' } });
  setup(PARTNER, detail('replied'));
  fireEvent.click(screen.getByRole('button', { name: 'More ▾' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Paused' }));
  await waitFor(() => expect(goalsApi.partnerSignal).toHaveBeenCalledWith('b1', 'p1', { type: 'deprioritize', expect: 'replied' }));
});

test('ruling 1: a target\'s primary is Mark contacted - it becomes an employer at Contacted, the window follows it, toast "added to pipeline · Contacted", Undo removes it and comes back to the target', async () => {
  const undo = { opportunity_id: 'o9', target_status: 'proposed', target_decided_at: null, runs: [], visits: ['v1'], people: [], todo_id: 'wg9' };
  goalsApi.markContacted.mockResolvedValue({ added: { type: 'employer', id: 'o9', name: 'Zz Quarry' }, stage: { before: 'proposed', after: 'contacted' }, todo: { id: 'wg9' }, undo });
  const p = setup(TARGET, detail('proposed'));
  expect(screen.queryByRole('button', { name: 'More ▾' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Mark contacted' }));
  await waitFor(() => expect(goalsApi.markContacted).toHaveBeenCalledWith('b1', 'target', 't1', { touch_type: 'email' }));
  expect(p.onConvert).toHaveBeenCalledWith({ type: 'employer', id: 'o9', name: 'Zz Quarry' });
  const toast = p.onToast.mock.calls[0][0];
  expect(toast.text).toBe('Zz Quarry added to pipeline · Contacted');
  await toast.undo();
  expect(goalsApi.undoContactTarget).toHaveBeenCalledWith('b1', 't1', undo);
  expect(p.onConvert).toHaveBeenLastCalledWith({ type: 'target', id: 't1', name: 'Zz Quarry' });
});

test('Viewer: the bar and the last touch read; no primary, no More, no segment buttons', () => {
  render(<CompanyProgress businessId="b1" row={EMP} detail={detail('contacted', { record: { stage: 'contacted', last_touch: { at: '2026-10-20T19:00:00Z', touch_type: 'done', what: 'Contacted Zz Elm', by: 'Jack Carlson' } } })} canEdit={false} onToast={jest.fn()} onChanged={jest.fn()} />);
  expect(screen.queryAllByRole('button')).toHaveLength(0);
  expect(document.querySelector('[data-progress-bar]')).toBeInTheDocument();
  expect(document.querySelector('[data-last-touch]')).toHaveTextContent('Last touch: Oct 20 · Jack Carlson · Contacted Zz Elm');
});
