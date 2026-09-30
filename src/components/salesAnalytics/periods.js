// Weeks start Monday 00:00 America/Los_Angeles (SPEC design decision) -
// matches api/sales/laDate.js's server-side convention exactly, duplicated
// here for the same CRA src/-boundary reason noted in metrics.registry.js.
// Native Intl.DateTimeFormat only - no date library (A4f: none exists in
// this repo). Every date arithmetic step goes through a UTC-noon
// Date (never ambiguous across any real timezone's DST transition)
// re-rendered through the LA formatter, rather than adding/subtracting
// raw milliseconds against a local Date - that's what keeps this correct
// across a DST boundary without needing a library.

export function laDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function laParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(date);
  const get = t => parts.find(p => p.type === t).value;
  const dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[get('weekday')];
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), dow };
}

function shiftLaDate(date, days) {
  const { y, m, d } = laParts(date);
  const noon = new Date(Date.UTC(y, m - 1, d, 12));
  noon.setUTCDate(noon.getUTCDate() + days);
  return noon;
}

export function laWeekStart(date = new Date()) {
  const { dow } = laParts(date);
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  return laDateString(shiftLaDate(date, mondayOffset));
}

export const PERIOD_PRESETS = [
  { id: 'this_week', label: 'This Week' },
  { id: 'last_week', label: 'Last Week' },
  { id: 'mtd', label: 'MTD' },
  { id: 'last_30d', label: 'Last 30d' },
  { id: 'custom', label: 'Custom' },
];

// Returns { from, to } as laDateString()s. `to` is inclusive.
export function periodRange(preset, customFrom, customTo) {
  const today = new Date();
  const todayStr = laDateString(today);

  if (preset === 'custom') return { from: customFrom || todayStr, to: customTo || todayStr };

  if (preset === 'last_week') {
    const thisWeekStartStr = laWeekStart(today);
    const thisWeekStartNoon = new Date(thisWeekStartStr + 'T12:00:00Z');
    const lastWeekEnd = shiftLaDate(thisWeekStartNoon, -1);
    const lastWeekStart = shiftLaDate(lastWeekEnd, -6);
    return { from: laDateString(lastWeekStart), to: laDateString(lastWeekEnd) };
  }

  if (preset === 'mtd') {
    const { y, m } = laParts(today);
    return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: todayStr };
  }

  if (preset === 'last_30d') {
    return { from: laDateString(shiftLaDate(today, -29)), to: todayStr };
  }

  // 'this_week' and any unrecognized preset fall back to the current week.
  return { from: laWeekStart(today), to: todayStr };
}

// The immediately-preceding period of equal length, for the compare
// toggle - e.g. "This Week" compares to the 7 days right before it.
export function previousPeriodRange({ from, to }) {
  const fromNoon = new Date(from + 'T12:00:00Z');
  const toNoon = new Date(to + 'T12:00:00Z');
  const lengthDays = Math.round((toNoon - fromNoon) / 86400000) + 1;
  const prevTo = shiftLaDate(fromNoon, -1);
  const prevFrom = shiftLaDate(prevTo, -(lengthDays - 1));
  return { from: laDateString(prevFrom), to: laDateString(prevTo) };
}
