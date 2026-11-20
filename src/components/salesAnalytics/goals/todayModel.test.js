import { laWeekStart } from '../periods';
import { addDays } from './goalsUi';
import { pickNewestFinal, dayTitle } from './todayModel';

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

test('dayTitle: the long and the short day', () => {
  expect(dayTitle('2026-10-21')).toBe('Wednesday, Oct 21');
  expect(dayTitle('2026-10-21', true)).toBe('Wed, Oct 21');
});
