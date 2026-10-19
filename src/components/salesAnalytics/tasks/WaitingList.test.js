import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WaitingList from './WaitingList';
import { goalsApi } from '../goals/goalsApi';
import { dealLine, latestTerms } from '../goals/partners/PartnerStatus';
import { buildTimeline } from '../goals/partners/activityTimeline';
import { tasksSummary } from '../goals/partners/PartnerDetails';

// call-notes-targets-v1 REV5 - what counterparts owe us: Got it closes the
// row, Nudge makes our own to-do; a Viewer sees the list with no buttons.
jest.mock('../goals/goalsApi', () => ({ goalsApi: { updateWeekGoal: jest.fn(), nudgeWaiting: jest.fn() } }));
jest.mock('../periods', () => ({ laDateString: () => '2026-10-25' }));

const ROWS = [
  { id: 'w1', waiting_on: 'Priya', text: 'Share the API docs', due_date: null, link_id: 'g1', status: 'open', created_at: '2026-10-16T10:00:00Z' },
  { id: 'w2', waiting_on: 'Dana', text: 'Send the pilot employer list', due_date: '2026-10-23', link_id: 'g1', status: 'open', created_at: '2026-10-16T10:00:00Z' },
];
beforeEach(() => { goalsApi.updateWeekGoal.mockResolvedValue({}); goalsApi.nudgeWaiting.mockResolvedValue({ id: 't1' }); });

test('rows sort by due date, show who · partner · what · due (late in words); Got it = status done; Nudge = the nudge route', async () => {
  const onChanged = jest.fn();
  render(<WaitingList businessId="b1" rows={ROWS} partnerName={() => 'Equifax'} canEdit onChanged={onChanged} />);
  const items = screen.getAllByRole('listitem');
  expect(items[0]).toHaveTextContent('Dana · Equifax · Send the pilot employer list');
  expect(items[0]).toHaveTextContent('was due Oct 23');
  expect(items[1]).toHaveTextContent('no date');
  fireEvent.click(screen.getByRole('button', { name: 'Got it: Dana - Send the pilot employer list' }));
  await waitFor(() => expect(goalsApi.updateWeekGoal).toHaveBeenCalledWith('b1', 'w2', { status: 'done' }));
  expect(onChanged).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Nudge Priya' }));
  await waitFor(() => expect(goalsApi.nudgeWaiting).toHaveBeenCalledWith('b1', 'w1'));
  expect(await screen.findByText('Nudge to-do added for today')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Nudge Priya' })).toBeDisabled();
});

test('Viewer: the same rows, no buttons', () => {
  render(<WaitingList businessId="b1" rows={ROWS} partnerName={null} canEdit={false} />);
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(screen.queryAllByRole('button')).toHaveLength(0);
  expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(/^⏳Dana · Send the pilot employer list/);
});

test('a refused write shows its message and changes nothing else', async () => {
  goalsApi.updateWeekGoal.mockRejectedValue(new Error('goal not found'));
  const onChanged = jest.fn();
  render(<WaitingList businessId="b1" rows={ROWS} canEdit onChanged={onChanged} />);
  fireEvent.click(screen.getByRole('button', { name: 'Got it: Priya - Share the API docs' }));
  expect(await screen.findByText('goal not found')).toBeInTheDocument();
  expect(onChanged).not.toHaveBeenCalled();
});

test('card header line: next meeting + the newest Terms line, cut to 60 characters', () => {
  const notes = 'Met at the summit\n(10/9) Terms: old split\n(10/16) Terms: Revenue share: Equifax keeps 20% of subscription revenue from members it refers.';
  expect(latestTerms(notes)).toBe('Revenue share: Equifax keeps 20% of subscription revenue from members it refers.');
  expect(dealLine({ next_meeting_at: '2026-10-26', notes })).toBe('Next meeting Oct 26 · Terms: Revenue share: Equifax keeps 20% of subscription revenue fr…');
  expect(dealLine({ next_meeting_at: null, notes: 'no terms here' })).toBe('');
});

test('timeline: a decision note carries the Decision chip and reads as itself; a plain note does not', () => {
  const items = buildTimeline({ events: [
    { id: 'e1', event: 'note', note: 'Pilot runs with 3 employers', meta: { kind: 'decision' }, at: '2026-10-16T18:00:00Z', by_user: null },
    { id: 'e2', event: 'note', note: 'Called', meta: {}, at: '2026-10-16T17:00:00Z', by_user: null },
  ], lookup: () => ({ first: 'Jack' }) });
  expect(items.map(i => [i.text, i.chip])).toEqual([['Pilot runs with 3 employers', 'Decision'], ['Note: Called', null]]);
});

test('Tasks drawer summary counts waiting-on separately from our to-dos', () => {
  expect(tasksSummary([], () => [], '2026-10-25', 4)).toBe('none this week · waiting on them 4');
  expect(tasksSummary([], () => [], '2026-10-25', 0)).toBe('none this week');
});
