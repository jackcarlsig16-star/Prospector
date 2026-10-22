import { addDays } from './goalsShared.js';

// seif-campaign-v1 D6 (REVISABLE) - when each campaign step is due. Sends go
// out Monday-Thursday only, and step offsets count those send days. A day
// holds at most DAILY_CAP due sends per sender: a start or a next step that
// lands on a full day moves to the next send day with room. The cap is
// measured when a date is set (no cron re-balances later).

export const SEND_DAYS = [1, 2, 3, 4]; // Mon-Thu (getUTCDay)
export const DAILY_CAP = 40;
export const STEP_OFFSETS = [0, 4, 10]; // steps 1-3, in send days from step 1
export const STOP_STATUSES = ['replied', 'meeting', 'not_interested', 'bounced', 'opted_out', 'done'];

const weekday = day => new Date(`${day}T12:00:00Z`).getUTCDay();
export const isSendDay = day => SEND_DAYS.includes(weekday(day));

// The day itself when it's a send day, else the next one.
export function onOrNextSendDay(day) {
  let d = day;
  while (!isSendDay(d)) d = addDays(d, 1);
  return d;
}

// n send days after day (n = 0 -> onOrNextSendDay).
export function addSendDays(day, n) {
  let d = onOrNextSendDay(day);
  for (let i = 0; i < n; i++) d = onOrNextSendDay(addDays(d, 1));
  return d;
}

// load: Map day -> sends already due that day for this sender. Takes the
// first send day on or after day with room, and books it.
export function bookDay(day, load, cap = DAILY_CAP) {
  let d = onOrNextSendDay(day);
  while ((load.get(d) || 0) >= cap) d = onOrNextSendDay(addDays(d, 1));
  load.set(d, (load.get(d) || 0) + 1);
  return d;
}

// Steps of a track, sorted -> the send-day gap from step n to step n+1, or
// null when n is the last step.
export function gapAfter(steps, n) {
  const sorted = [...steps].sort((a, b) => a.step_no - b.step_no);
  const i = sorted.findIndex(s => s.step_no === n);
  if (i < 0 || i === sorted.length - 1) return null;
  return Math.max(0, sorted[i + 1].day_offset - sorted[i].day_offset);
}

// The next step's number after n, or null when n is the last.
export function stepAfter(steps, n) {
  const next = steps.map(s => s.step_no).filter(s => s > n).sort((a, b) => a - b)[0];
  return next ?? null;
}

// Contacts (in order) -> { id: due day }, each booked from `from`.
export function spreadStarts(contacts, from, load, cap = DAILY_CAP) {
  return Object.fromEntries(contacts.map(c => [c.id, bookDay(from, load, cap)]));
}
