// zoom-meet-auto-ingest-v1, Step 5 — read side of the reconciliation view.
export const config = { maxDuration: 20 };
import { getSupabase } from '../businesses/shared.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  try {
    const { data: events, error } = await supabase.from('zoom_webhook_events')
      .select('id, event_type, zoom_meeting_uuid, payload_json, received_at, processed, processing_error, matched_business_id, matched_account_id, match_reason, call_log_entry_id, transcript_text')
      .order('received_at', { ascending: false })
      .limit(200);
    if (error) throw error;

    const businessIds = [...new Set((events || []).map(e => e.matched_business_id).filter(Boolean))];
    const accountIds = [...new Set((events || []).map(e => e.matched_account_id).filter(Boolean))];

    const [{ data: matchedBusinesses }, { data: matchedAccounts }, { data: allBusinesses }] = await Promise.all([
      businessIds.length ? supabase.from('businesses').select('id, name').in('id', businessIds) : Promise.resolve({ data: [] }),
      accountIds.length ? supabase.from('accounts').select('id, data').in('id', accountIds) : Promise.resolve({ data: [] }),
      supabase.from('businesses').select('id, name').order('name'),
    ]);
    const businessName = Object.fromEntries((matchedBusinesses || []).map(b => [b.id, b.name]));
    const accountName = Object.fromEntries((matchedAccounts || []).map(a => [a.id, a.data?.name || '(unnamed)']));

    const enriched = (events || []).map(e => ({
      id: e.id,
      eventType: e.event_type,
      zoomMeetingUuid: e.zoom_meeting_uuid,
      receivedAt: e.received_at,
      processed: e.processed,
      processingError: e.processing_error,
      matchedBusinessId: e.matched_business_id,
      matchedBusinessName: e.matched_business_id ? (businessName[e.matched_business_id] || null) : null,
      matchedAccountId: e.matched_account_id,
      matchedAccountName: e.matched_account_id ? (accountName[e.matched_account_id] || null) : null,
      matchReason: e.match_reason,
      callLogEntryId: e.call_log_entry_id,
      hasTranscript: !!e.transcript_text,
      transcriptText: e.transcript_text,
      topic: e.payload_json?.payload?.object?.topic || null,
      hostEmail: e.payload_json?.payload?.object?.host_email || null,
    }));

    res.status(200).json({ events: enriched, businesses: allBusinesses || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
