import { isBotOpen } from './heatScore.js';

// dashboard-v3 Stage 1 (A4 / A9) - the scorecard's two redefined numbers, pure so the route and the tests share them.
// Human open rate = Apollo's open rate for the window (opened ÷ delivered, sales_email_daily_counts) × the human share of
// the tracked opens in that window (1 − bot opens ÷ tracked opens, the ONE bot rule: heatScore.isBotOpen). The same
// product the week strip shows as "human · est." (weekStripData.js), so Pulse, Explorer and Scorecard agree to the digit.
export function humanShare(opens, deliveredAt) {
  if (!opens.length) return null;
  const bots = opens.filter(o => isBotOpen(o, deliveredAt.get(o.apollo_message_id))).length;
  return 1 - bots / opens.length;
}

export function humanOpenRate({ delivered, opened, share }) {
  if (!delivered || share == null) return null;
  return (opened / delivered) * share;
}

// Meetings set (Outlook) = synced calendar events with at least one external domain, booked (Graph's created time) inside
// the week - any external domain, not only confirmed partner domains (handoff A5 / A9). Cancelled events never count; the
// same meeting on two calendars shares an iCalUId and counts once. An event with no created time counts by its start.
const meetingKey = e => e.ical_uid || e.graph_id;
export function countExternalMeetings({ events, weekStartMs, weekEndMs, now = Date.now() }) {
  const seen = new Set();
  let booked = 0, next = null;
  for (const e of events) {
    const key = meetingKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    if (e.is_cancelled || !(e.external_domains || []).length) continue;
    const at = Date.parse(e.created_at_graph || e.start_at || '');
    if (at >= weekStartMs && at < weekEndMs) booked++;
    const start = Date.parse(e.start_at || '');
    if (start >= now && (next == null || start < next)) next = start;
  }
  return { booked, next_at: next == null ? null : new Date(next).toISOString() };
}
