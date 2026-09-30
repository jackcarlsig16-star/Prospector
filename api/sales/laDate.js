// Weeks start Monday 00:00 America/Los_Angeles (sales-analytics-core-v1
// design decision). This is the one shared LA-calendar-date helper every
// sales/* file uses, so "today" agrees everywhere syncs write. Native
// Intl.DateTimeFormat only - no date library (A4f: none exists in this repo).

export function laDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}
