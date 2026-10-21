import { laWeekStart } from '../periods';
import { addDays } from './goalsUi';
import { pickNewestFinal, pipelineMoves, dayTitle } from './todayModel';

// sales-ia-v1 Stage 2 pure pieces that outlive Today (sales-ia-v2 Stage 6
// moves them to the Dashboard's Goals section). No names, emails or phones.
const WEEK = laWeekStart();

test('the newest finalized report is picked when the latest week is not final', () => {
  const r = w => ({ week_start: w, report: { status: w === WEEK ? 'draft' : 'final' } });
  expect(pickNewestFinal([r(WEEK), r(addDays(WEEK, -7)), r(addDays(WEEK, -14))]).week_start).toBe(addDays(WEEK, -7));
  expect(pickNewestFinal([r(addDays(WEEK, -14)), r(addDays(WEEK, -7))]).week_start).toBe(addDays(WEEK, -7));
  expect(pickNewestFinal([r(WEEK)])).toBeNull();
  expect(pickNewestFinal([])).toBeNull();
});

test('pipeline moves: partner events become rows only when they change the stage; movement buckets join them, newest first', () => {
  const partnersById = new Map([['p1', { id: 'p1', name: 'Lakeshore Mutual' }]]);
  const events = [
    { id: 'e1', goal_id: 'p1', event: 'status', from_status: 'first_email_sent', to_status: 'meeting_set', at: '2026-10-15T09:00:00Z' },
    { id: 'e2', goal_id: 'p1', event: 'note', at: '2026-10-15T10:00:00Z' },
    { id: 'e3', goal_id: 'p1', event: 'touch', from_status: 'meeting_set', to_status: 'meeting_set', at: '2026-10-15T11:00:00Z' },
    { id: 'e4', goal_id: 'gone', event: 'status', from_status: 'replied', to_status: 'meeting_set', at: '2026-10-15T12:00:00Z' },
  ];
  const movement = { moved_forward: [{ id: 'o1', organization: 'Northwind Benefits', stage: 'meeting', updated_at: '2026-10-14T10:00:00Z' }], added: [{ id: 'o2', organization: 'Old Mill Union', stage: 'target', updated_at: '2026-10-16T10:00:00Z' }] };
  expect(pipelineMoves({ events, partnersById, movement }).map(m => `${m.name} → ${m.to}`)).toEqual(['Lakeshore Mutual → Meeting', 'Northwind Benefits → Meeting']);
  expect(dayTitle('2026-10-21')).toBe('Wednesday, Oct 21');
  expect(dayTitle('2026-10-21', true)).toBe('Wed, Oct 21');
});
