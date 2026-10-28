import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import JourneyLine from './JourneyLine';
import { goalsApi } from './goalsApi';

jest.mock('./goalsApi', () => ({ goalsApi: { markStage: jest.fn(), unmarkStage: jest.fn() } }));

// brad-attribution-v1 Stage 2 - the company window's Journey line + Mark stage (invented company, names + dates only).
const ROW = { type: 'employer', id: 'e1', name: 'Zz Elm Health' };
const SOURCE = { source_kind: 'partner_referral', source_person: 'Brad', partner_name: 'Upside' };
const journey = (over = {}) => ({
  funnel: { referred: '2026-10-22', visited: '2026-10-24', replied: null, meeting: null, pilot: null, lost: null, src: { referred: 'source_set_at', visited: 'web_visits (matched)' } },
  journey: 'Referred by Brad (Upside) Oct 22 → Visited Oct 24 → Replied — → Meeting — → Pilot —', marks: [], locked: false, ...over,
});
const setup = (props = {}) => {
  const onMarked = jest.fn(), onToast = jest.fn();
  render(<JourneyLine businessId="b1" row={ROW} journey={journey()} source={SOURCE} canEdit onMarked={onMarked} onToast={onToast} {...props} />);
  return { onMarked, onToast };
};
afterEach(() => jest.clearAllMocks());

test('the chain: reached stages dated (title = what dated it), missing ones greyed with what sets them; Lost only once it happened', () => {
  setup();
  const line = screen.getByRole('group', { name: 'Journey' }).querySelector('[data-journey-line]');
  expect(line.textContent.replace(/\s+/g, ' ').trim()).toBe('Referred by Brad (Upside) Oct 22 → Visited Oct 24 → Replied — → Meeting — → Pilot —');
  const stage = s => line.querySelector(`[data-journey-stage="${s}"]`);
  expect(stage('visited')).toHaveAttribute('data-reached', 'true');
  expect(stage('visited').getAttribute('title')).toBe('Oct 24 · web_visits (matched)');
  expect(stage('meeting')).toHaveAttribute('data-reached', 'false');
  expect(stage('meeting').getAttribute('title')).toBe('Set when the stage moves to Meeting, or a meeting touch or to-do is logged - or Mark stage');
  expect(stage('lost')).toBeNull();
});

test('Viewers see the line, no Mark stage; an Upside-owned + no double touch chain is read-only', () => {
  const { unmount } = render(<JourneyLine businessId="b1" row={ROW} journey={journey({ marks: [{ stage: 'meeting', at: '2026-10-12', note: null, reason: 'manual', by: 'Jack' }] })} source={SOURCE} canEdit={false} onMarked={jest.fn()} onToast={jest.fn()} />);
  expect(screen.queryByRole('button', { name: 'Mark stage' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Remove the meeting mark' })).toBeNull();
  expect(screen.getByText(/Meeting marked Oct 12 by Jack/)).toBeInTheDocument();
  unmount();
  setup({ journey: journey({ locked: true }) });
  expect(screen.queryByRole('button', { name: 'Mark stage' })).toBeNull();
  expect(screen.getByText(/read-only/)).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Journey' }).querySelector('[data-journey-stage="meeting"]').getAttribute('title')).not.toMatch(/Mark stage/);
});

test('Mark stage: pick stage + date + note -> PUT, reload, Undo deletes a first mark / restores the one it replaced; ✕ removes a mark with Undo', async () => {
  goalsApi.markStage.mockResolvedValueOnce({ previous: null, ...journey() });
  goalsApi.unmarkStage.mockResolvedValue(journey());
  const { onMarked, onToast } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Mark stage' }));
  const form = screen.getByRole('group', { name: 'Mark stage' });
  fireEvent.change(within(form).getByLabelText('Stage'), { target: { value: 'meeting' } });
  fireEvent.change(within(form).getByLabelText('Date it happened'), { target: { value: '2026-10-12' } });
  fireEvent.change(within(form).getByLabelText('Note'), { target: { value: 'Coffee with their HR lead' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Save mark' }));
  await waitFor(() => expect(goalsApi.markStage).toHaveBeenCalledWith('b1', 'employer', 'e1', { stage: 'meeting', at: '2026-10-12', note: 'Coffee with their HR lead' }));
  await waitFor(() => expect(onMarked).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('group', { name: 'Mark stage' })).toBeNull();
  expect(onToast.mock.calls[0][0].text).toBe('Zz Elm Health: Meeting marked Oct 12');
  await onToast.mock.calls[0][0].undo();
  expect(goalsApi.unmarkStage).toHaveBeenCalledWith('b1', 'employer', 'e1', 'meeting');

  goalsApi.markStage.mockResolvedValueOnce({ previous: { stage: 'meeting', at: '2026-10-12', note: null }, ...journey() });
  fireEvent.click(screen.getByRole('button', { name: 'Mark stage' }));
  fireEvent.click(within(screen.getByRole('group', { name: 'Mark stage' })).getByRole('button', { name: 'Save mark' }));
  await waitFor(() => expect(onToast).toHaveBeenCalledTimes(2));
  goalsApi.markStage.mockResolvedValueOnce({ previous: null, ...journey() });
  await onToast.mock.calls[1][0].undo();
  expect(goalsApi.markStage).toHaveBeenLastCalledWith('b1', 'employer', 'e1', { stage: 'meeting', at: '2026-10-12', note: null });
});

test('a refused mark shows the server\'s reason and keeps the form', async () => {
  goalsApi.markStage.mockRejectedValue(new Error("note can't hold an email address or phone number"));
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Mark stage' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save mark' }));
  expect(await screen.findByText(/can't hold an email address/)).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Mark stage' })).toBeInTheDocument();
});

test('✕ on a mark removes it, Undo puts it back', async () => {
  goalsApi.unmarkStage.mockResolvedValue(journey());
  goalsApi.markStage.mockResolvedValue({ previous: null, ...journey() });
  const { onMarked, onToast } = setup({ journey: journey({ marks: [{ stage: 'meeting', at: '2026-10-12', note: 'Coffee', reason: 'manual', by: 'Jack' }] }) });
  fireEvent.click(screen.getByRole('button', { name: 'Remove the meeting mark' }));
  await waitFor(() => expect(goalsApi.unmarkStage).toHaveBeenCalledWith('b1', 'employer', 'e1', 'meeting'));
  await waitFor(() => expect(onMarked).toHaveBeenCalled());
  await onToast.mock.calls[0][0].undo();
  expect(goalsApi.markStage).toHaveBeenCalledWith('b1', 'employer', 'e1', { stage: 'meeting', at: '2026-10-12', note: 'Coffee' });
});

test('axe: the Journey line with a mark and the open Mark stage form has 0 violations', async () => {
  const axe = require('axe-core');
  const { container } = render(<JourneyLine businessId="b1" row={ROW} journey={journey({ marks: [{ stage: 'meeting', at: '2026-10-12', note: 'Coffee', reason: 'manual', by: 'Jack' }] })} source={SOURCE} canEdit onMarked={jest.fn()} onToast={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Mark stage' }));
  const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false } }, resultTypes: ['violations'] });
  expect(r.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 2).join(' | ')}`)).toEqual([]);
});
