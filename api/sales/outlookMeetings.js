import { selectAllPages } from '../lib/selectAllPages.js';
import { buildIndex, matchPartner } from './partnerOutlookTouches.js';
import { addDays, laStartOfDayMs } from './goalsShared.js';

// microsoft-connect-v1 Stage 4b - "Meetings held" / "New meetings booked"
// counted from the synced calendar (microsoft_events), shown beside the typed
// number; the typed number stays the override and nothing here is written.
// A meeting counts only when exactly one partner owns an attendee's domain
// among the confirmed partner_domains (Jack, 2026-10-08: never guessed - no
// contact-email fallback, two partners on one meeting = ambiguous, skipped).
// Held = ended inside the week (LA days) and already over; booked = Graph's
// created time inside the week (null = never counted). Cancelled meetings
// count for neither. The same meeting on two calendars shares an iCalUId and
// counts once.

const meetingKey = e => e.ical_uid || e.graph_id;

export function countOutlookMeetings({ events, domains, weekStart, now = new Date() }) {
  const index = buildIndex({ domains, contacts: [] });
  const startMs = laStartOfDayMs(weekStart), endMs = laStartOfDayMs(addDays(weekStart, 7));
  const inWeek = iso => { const t = Date.parse(iso || ''); return t >= startMs && t < endMs; };
  const seen = new Set();
  const counts = { held: 0, booked: 0, cancelled: 0, ambiguous: 0, unmatched: 0, no_created_time: 0 };
  const held = [], booked = [];
  for (const e of events) {
    const key = meetingKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    if (e.is_cancelled) { counts.cancelled++; continue; }
    const match = matchPartner({ external_domains: e.external_domains }, index);
    if (!match) { counts.unmatched++; continue; }
    if (match.ambiguous) { counts.ambiguous++; continue; }
    const item = { key, goal_id: match.goal_id, domain: match.matched, subject: e.subject || null, start_at: e.start_at, end_at: e.end_at, created_at: e.created_at_graph || null };
    if (inWeek(e.end_at) && Date.parse(e.end_at) <= now.getTime()) { counts.held++; held.push(item); }
    if (!e.created_at_graph) counts.no_created_time++;
    else if (inWeek(e.created_at_graph)) { counts.booked++; booked.push(item); }
  }
  return { week_start: weekStart, counts, held, booked };
}

export async function loadOutlookMeetingInputs(supabase, businessId) {
  const [events, domains] = await Promise.all([
    selectAllPages(() => supabase.from('microsoft_events').select('graph_id, ical_uid, external_domains, subject, start_at, end_at, is_cancelled, created_at_graph')
      .eq('business_id', businessId).order('start_at').order('id')),
    selectAllPages(() => supabase.from('partner_domains').select('goal_id, domain, confirmed').eq('business_id', businessId).eq('confirmed', true).order('id')),
  ]);
  return { events, domains };
}

// Map week -> { meetings_held, meetings_set } for the KPI table and the scorecard.
export async function outlookMeetingsByWeek(supabase, businessId, weeks, now = new Date()) {
  const inputs = await loadOutlookMeetingInputs(supabase, businessId);
  return new Map(weeks.map(w => {
    const r = countOutlookMeetings({ ...inputs, weekStart: w, now });
    return [w, { meetings_held: r.counts.held, meetings_set: r.counts.booked }];
  }));
}
