import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import JourneyStrip, { journeyModel } from './JourneyStrip';
import { goalsApi } from './goalsApi';
import { updateOpportunity } from '../pipelineApi';

jest.mock('./goalsApi', () => ({ goalsApi: { partnerSignal: jest.fn(), partnerUndo: jest.fn(), advanceStage: jest.fn() } }));
jest.mock('../pipelineApi', () => ({ updateOpportunity: jest.fn() }));

// company-window-v4 Stage 2 - the journey card over invented companies: eight nodes on one track, done / now / later in
// each node's name (never color alone), a later node = the forward move through the existing handlers with Undo,
// skipping stages asks first, nothing goes backward, viewers read.
const EMP = { type: 'employer', id: 'o1', name: 'Zz Elm', stage: 'contacted' };
const PARTNER = { type: 'partner', id: 'p1', name: 'Zz Harbor', stage: 'replied', category: '2. Brokers & PEOs' };
const TARGET = { type: 'target', id: 't1', name: 'Zz Quarry', stage: 'researching' };
const detail = (stage, history = []) => ({ record: { stage }, stage_history: history });
const setup = (row, d, props = {}) => {
  const p = { onPatch: jest.fn(), onChanged: jest.fn(), onToast: jest.fn(), onResearch: jest.fn(), onAddToPipeline: jest.fn(), onClient: jest.fn(), ...props };
  render(<JourneyStrip businessId="b1" row={row} detail={d} canEdit {...p} />);
  return p;
};
const states = () => [...document.querySelectorAll('[data-node]')].map(li => `${li.dataset.node}:${li.dataset.state}`);
afterEach(() => jest.clearAllMocks());

test('journeyModel: employer = the eight nodes with the dates reached (Researched from the research run, Client from the client status); Contract sits on Verbal; a side lane has no now; partner = its workflow steps (in_sequence on Sent, paused off); a target sits on Target; visitors none', () => {
  const e = journeyModel('employer', 'responded', [{ stage: 'target', at: '2026-10-01T18:00:00Z' }, { stage: 'contacted', at: '2026-10-05T18:00:00Z' }], { research: { created_at: '2026-10-03T18:00:00Z' }, client: null });
  expect(e.nodes.map(n => `${n.id}:${n.state}`)).toEqual(['target:done', 'researched:done', 'contacted:done', 'responded:now', 'meeting:later', 'proposal_pilot:later', 'verbal:later', 'launched:later']);
  expect([e.current, e.nodes[0].at, e.nodes[1].at, e.nodes[2].at, e.nodes[3].at, e.side]).toEqual([3, 'Oct 1', 'Oct 3', 'Oct 5', null, null]);
  expect(journeyModel('employer', 'contacted', [], null).nodes[1]).toEqual({ id: 'researched', label: 'Researched', at: null, state: 'later' });
  const c = journeyModel('employer', 'contract', [], { research: null, client: null });
  expect([c.current, c.nodes[6].state, c.nodes[6].sub, c.nodes[7].state]).toEqual([6, 'now', 'contract', 'later']);
  const client = journeyModel('employer', 'launched', [], { research: null, client: { client_status: 'signed', client_since: '2026-10-20' } });
  expect([client.nodes[7].state, client.nodes[7].at, client.current]).toEqual(['done', 'Oct 20', 7]);
  const lost = journeyModel('employer', 'lost', [{ stage: 'contacted', at: '2026-10-05T18:00:00Z' }]);
  expect([lost.side, lost.current, lost.nodes.every(n => n.state === 'later')]).toEqual(['Lost', -1, true]);
  const p = journeyModel('partner', 'in_sequence', [{ stage: 'in_sequence', at: '2026-10-02T18:00:00Z' }]);
  expect(p.nodes.map(n => n.label)).toEqual(['Not started', 'Researching', 'Drafted', 'Sent', 'Replied', 'Meeting', 'Pilot', 'Live']);
  expect([p.current, p.nodes[3].state, p.nodes[3].at, p.nodes.some(n => n.id === 'researched')]).toEqual([3, 'now', 'Oct 2', false]);
  expect([journeyModel('partner', 'paused').side, journeyModel('partner', 'paused').current]).toEqual(['Paused', -1]);
  const t = journeyModel('target', 'researching', [], { research: { created_at: '2026-11-05T18:00:00Z' }, client: null });
  expect([t.current, t.stage, t.nodes[0].state, t.nodes[1].state, t.nodes[2].state]).toEqual([0, 'target', 'now', 'done', 'later']);
  expect(journeyModel('visitor', null)).toBeNull();
});

test('nodes: done = ✓ + the date in the name, now = aria-current step with "now" under it, later = its number and a button whose title says Jump to; the green fill reaches the current node; the hint line reads under', () => {
  setup(EMP, detail('contacted', [{ stage: 'target', at: '2026-10-01T18:00:00Z' }, { stage: 'contacted', at: '2026-10-05T18:00:00Z' }]), { flow: { research: { created_at: '2026-10-03T18:00:00Z' }, client: null } });
  const card = screen.getByRole('group', { name: 'Journey' });
  expect(states()).toEqual(['target:done', 'researched:done', 'contacted:now', 'responded:later', 'meeting:later', 'proposal_pilot:later', 'verbal:later', 'launched:later']);
  expect(within(card).getByLabelText('Target, done Oct 1')).toBeInTheDocument();
  expect(card.querySelector('[data-node="target"] [data-journey-dot]').textContent).toBe('✓');
  expect(card.querySelector('[data-node="target"] small').textContent).toBe('Oct 1');
  expect(card.querySelector('[aria-current="step"]').dataset.node).toBe('contacted');
  expect(card.querySelector('[data-node="contacted"] small').textContent).toBe('now');
  expect(card.querySelector('[data-node="contacted"] button')).toBeNull();
  expect(card.querySelector('[data-node="meeting"] [data-journey-dot]').textContent).toBe('5');
  expect(screen.getByRole('button', { name: 'Replied, not yet' })).toHaveAttribute('title', 'Jump to Replied');
  expect(screen.getByRole('button', { name: 'Client, not yet' })).toHaveAttribute('title', 'Make client');
  expect(screen.getAllByRole('button')).toHaveLength(5);
  expect(card.querySelector('[data-journey-fill]').style.width).toBe('25.00%');
  expect(within(card).getByText('Click a later stage to move there · Undo 10 s')).toBeInTheDocument();
  expect(card.nextElementSibling).toBeNull();
});

test('employer: the next node advances with expect = the stage shown and to = the node; patches the row; toasts "moved to" with Undo = the opportunity back with allow_backward', async () => {
  goalsApi.advanceStage.mockResolvedValue({ before: 'contacted', after: 'responded' });
  const p = setup(EMP, detail('contacted'));
  fireEvent.click(screen.getByRole('button', { name: 'Replied, not yet' }));
  await waitFor(() => expect(goalsApi.advanceStage).toHaveBeenCalledWith('b1', 'employer', 'o1', 'contacted', 'responded'));
  expect(p.onPatch).toHaveBeenCalledWith(expect.objectContaining({ stage: 'responded' }));
  expect(p.onChanged).toHaveBeenCalled();
  const toast = p.onToast.mock.calls[0][0];
  expect(toast.text).toBe('Zz Elm: moved to Replied');
  await toast.undo();
  expect(updateOpportunity).toHaveBeenCalledWith('b1', 'o1', { stage: 'contacted', allow_backward: true });
  expect(p.onPatch).toHaveBeenLastCalledWith(expect.objectContaining({ stage: 'contacted' }));
});

test('skipping stages asks first (Jump confirm); No = no write; Yes = one write to the node; Contract → Client goes through advance, not the client sheet', async () => {
  goalsApi.advanceStage.mockResolvedValue({});
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  const p = setup(EMP, detail('contacted'));
  fireEvent.click(screen.getByRole('button', { name: 'Meeting, not yet' }));
  expect(confirm).toHaveBeenCalledWith('Jump Zz Elm from Contacted to Meeting, skipping Replied?');
  expect(goalsApi.advanceStage).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Verbal, not yet' }));
  expect(confirm).toHaveBeenLastCalledWith('Jump Zz Elm from Contacted to Verbal, skipping Replied, Meeting, Pilot?');
  await waitFor(() => expect(goalsApi.advanceStage).toHaveBeenCalledWith('b1', 'employer', 'o1', 'contacted', 'verbal'));
  expect(p.onClient).not.toHaveBeenCalled();
  document.body.innerHTML = '';
  goalsApi.advanceStage.mockClear();
  const q = setup({ ...EMP, stage: 'contract' }, detail('contract'));
  expect(document.querySelector('[data-node="verbal"]').dataset.state).toBe('now');
  expect(document.querySelector('[data-node="verbal"] small').textContent).toBe('contract');
  fireEvent.click(screen.getByRole('button', { name: 'Client, not yet' }));
  await waitFor(() => expect(goalsApi.advanceStage).toHaveBeenCalledWith('b1', 'employer', 'o1', 'contract', 'launched'));
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(q.onClient).not.toHaveBeenCalled();
  confirm.mockRestore();
});

test('Researched opens Run research, Client (before Contract) the client sheet; a target\'s later stage opens Add to pipeline; none of them writes a stage', () => {
  const p = setup(EMP, detail('contacted'));
  fireEvent.click(screen.getByRole('button', { name: 'Researched, not yet' }));
  expect(p.onResearch).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Client, not yet' }));
  expect(p.onClient).toHaveBeenCalled();
  document.body.innerHTML = '';
  const t = setup(TARGET, detail('researching'), { flow: { research: null, client: null } });
  expect(states().slice(0, 3)).toEqual(['target:now', 'researched:later', 'contacted:later']);
  fireEvent.click(screen.getByRole('button', { name: 'Contacted, not yet' }));
  expect(t.onAddToPipeline).toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Meeting, not yet' })).toHaveAttribute('title', 'Add to pipeline first');
  expect(goalsApi.advanceStage).not.toHaveBeenCalled();
  expect(updateOpportunity).not.toHaveBeenCalled();
});

test('partner: a later node sends the status signal with expect = the stage shown; Undo = the partner undo; no Researched node', async () => {
  goalsApi.partnerSignal.mockResolvedValue({ event: { id: 'ev9' } });
  const p = setup(PARTNER, detail('replied'));
  expect(states()).toEqual(['not_started:done', 'researching:done', 'first_email_drafted:done', 'first_email_sent:done', 'replied:now', 'meeting_set:later', 'proposal_pilot:later', 'live:later']);
  fireEvent.click(screen.getByRole('button', { name: 'Meeting, not yet' }));
  await waitFor(() => expect(goalsApi.partnerSignal).toHaveBeenCalledWith('b1', 'p1', { type: 'status', to: 'meeting_set', expect: 'replied' }));
  expect(p.onPatch).toHaveBeenCalledWith(expect.objectContaining({ stage: 'meeting_set' }));
  await p.onToast.mock.calls[0][0].undo();
  expect(goalsApi.partnerUndo).toHaveBeenCalledWith('b1', 'p1', 'ev9');
});

test('a stale screen (409) says "This changed elsewhere - refresh"; a side lane reads only with its word in the hint; a Viewer gets no buttons and no hint', async () => {
  goalsApi.advanceStage.mockRejectedValue(Object.assign(new Error('This changed elsewhere - refresh'), { status: 409 }));
  setup(EMP, detail('contacted'));
  fireEvent.click(screen.getByRole('button', { name: 'Replied, not yet' }));
  expect(await screen.findByText(/This changed elsewhere - refresh/)).toBeInTheDocument();
  document.body.innerHTML = '';
  setup({ ...EMP, stage: 'lost' }, detail('lost'));
  expect(screen.queryAllByRole('button')).toHaveLength(0);
  expect(document.querySelector('[aria-current="step"]')).toBeNull();
  expect(screen.getByText('Lost · ⋯ › Jump to stage brings it back')).toBeInTheDocument();
  document.body.innerHTML = '';
  render(<JourneyStrip businessId="b1" row={EMP} detail={detail('contacted')} canEdit={false} onToast={jest.fn()} onChanged={jest.fn()} />);
  expect(screen.queryAllByRole('button')).toHaveLength(0);
  expect(screen.getByRole('group', { name: 'Journey' })).toBeInTheDocument();
  expect(document.querySelector('[data-journey-hint]')).toBeNull();
  expect(screen.getByLabelText('Replied, not yet')).toBeInTheDocument();
});
