import { addDays } from './goalsShared.js';

// FIX visit-window-v1 W1 / W2 - the window a visitor pull asks Apollo for. Coverage, not "yesterday": lookback_days
// = days since the last ok run's window_end, clamped to [1, LOOKBACK_CAP], so a run after quiet days reaches back over
// them; a backfill ignores history and asks for BACKFILL_DAYS. window_start = today - lookback_days, window_end = today
// (LA dates). Pure: no clock, no DB.
export const LOOKBACK_CAP = 30; // REVISABLE (Apollo's company view goes back 90 d)
export const BACKFILL_DAYS = 14; // REVISABLE (covers Oct 13 onward from Oct 27)
const DAY = 864e5;
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

export function windowFor(lastOkWindowEnd, today, { backfillDays = null, cap = LOOKBACK_CAP } = {}) {
  if (!isDate(today)) throw new Error('windowFor: today must be an LA date (YYYY-MM-DD)');
  const backfill = backfillDays != null;
  let lookback;
  if (backfill) lookback = Math.min(Math.max(Math.trunc(Number(backfillDays)) || 1, 1), cap);
  else if (!isDate(lastOkWindowEnd)) lookback = 1;
  else lookback = Math.min(Math.max(daysBetween(lastOkWindowEnd, today), 1), cap);
  return { kind: backfill ? 'backfill' : 'daily', lookback_days: lookback, window_start: addDays(today, -lookback), window_end: today };
}
