// zoom-meet-auto-ingest-v1, Step 5 — manual assignment for an event that
// held unmatched (no auto-attribution resolved). Files it through
// call-log-v1's fileCallLog(), same as the automatic path - not a
// second filing system. Only applies to events that haven't been filed
// yet; an already-filed (wrongly matched) event gets reassigned from the
// business's own Call Log view (call-log-reassign.js), which already
// handles moving an existing business_intel_entries row between
// accounts/projects - this endpoint doesn't duplicate that.
export const config = { maxDuration: 30 };
import { getSupabase } from '../businesses/shared.js';
import { fileCallLog } from '../businesses/call-log.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { eventId } = req.params;
  const { business_id, account_id, created_by } = req.body || {};
  if (!business_id) return res.status(400).json({ error: 'business_id is required' });

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  try {
    const { data: event, error: eventError } = await supabase.from('zoom_webhook_events').select('*').eq('id', eventId).maybeSingle();
    if (eventError) throw eventError;
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.call_log_entry_id) {
      return res.status(409).json({ error: "This event was already filed - reassign it from the business's Call Log view instead." });
    }
    if (!event.transcript_text) {
      return res.status(400).json({ error: 'No transcript text stored for this event yet (still processing, or it failed before the transcript downloaded)' });
    }

    const obj = event.payload_json?.payload?.object || {};
    const result = await fileCallLog(supabase, business_id, {
      transcript: event.transcript_text,
      call_platform: 'zoom',
      call_date: obj.start_time || event.received_at,
      call_duration_seconds: obj.duration ? obj.duration * 60 : null,
      call_participants: event.participants_json || [],
      created_by: created_by || obj.host_email || null,
      preMatchedAccountId: account_id || null,
    });

    await supabase.from('zoom_webhook_events').update({
      matched_business_id: business_id,
      matched_account_id: account_id || null,
      match_reason: 'manual_assignment',
      processed: true,
      call_log_entry_id: result.entry.id,
    }).eq('id', eventId);

    res.status(200).json({ entry: result.entry, accountName: result.accountName });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
