// The Actions title and the newest finalized report.

export const dayTitle = (today, short = false) => new Date(`${today}T12:00:00Z`)
  .toLocaleDateString('en-US', { weekday: short ? 'short' : 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });

// reports: [{ week_start, report }] in any order -> the newest final one.
export function pickNewestFinal(reports) {
  return reports.filter(r => r.report?.status === 'final').sort((a, b) => (a.week_start < b.week_start ? 1 : -1))[0] || null;
}
