// zoom-meet-auto-ingest-v1 - receives recording.completed and
// recording.transcript_completed only (no other event type is handled, per
// spec). The handshake and signature verification came from
// external-api-foundation-v1's reference implementation; this file now also
// stores every raw event, resolves business/account attribution for
// transcript-complete events, downloads and parses the real transcript, and
// files it through call-log-v1's existing fileCallLog() - not a parallel
// filing system.
import crypto from 'crypto';
import { createWebhookHandler } from '../lib/webhookHandler.js';
import { getSupabase } from '../businesses/shared.js';
import { fileCallLog } from '../businesses/call-log.js';
import { getZoomMeetingParticipants } from './client.js';
import { downloadZoomTranscript, parseVttToTranscript } from '../lib/zoomTranscript.js';
import { resolveZoomAttribution } from '../lib/zoomAttribution.js';

function verifyZoomSignature(req) {
  const secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
  if (!secret) return false;

  const timestamp = req.headers['x-zm-request-timestamp'];
  const signatureHeader = req.headers['x-zm-signature'];
  if (!timestamp || !signatureHeader || !req.rawBody) return false;

  const message = `v0:${timestamp}:${req.rawBody}`;
  const hash = crypto.createHmac('sha256', secret).update(message).digest('hex');
  const expected = `v0=${hash}`;

  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Zoom's endpoint.url_validation handshake arrives without a real signature
// by design - Zoom sends a plainToken and expects it echoed back HMAC'd with
// the same secret, within 3 seconds, before it will send any signed events.
// Runs before signature verification, not as a special case inside it.
function handleZoomUrlValidation(req, res) {
  if (req.body?.event !== 'endpoint.url_validation') return false;
  const secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
  const plainToken = req.body?.payload?.plainToken;
  if (!secret || !plainToken) {
    res.status(400).json({ error: 'Missing webhook secret or plainToken' });
    return true;
  }
  const encryptedToken = crypto.createHmac('sha256', secret).update(plainToken).digest('hex');
  res.status(200).json({ plainToken, encryptedToken });
  return true;
}

// zoom-meet-auto-ingest-v1, Steps 1/2/3/4 - store raw event first (nothing
// lost if downstream steps fail), then process. Only recording.completed
// and recording.transcript_completed are handled - every other event is
// dropped without being stored, per spec ("don't build handling for any
// other event type").
async function processZoomEvent(payload) {
  const eventType = payload?.event;
  if (eventType !== 'recording.completed' && eventType !== 'recording.transcript_completed') {
    console.log(`[zoom-webhook] ignored event: ${eventType}`);
    return;
  }

  const supabase = getSupabase();
  if (!supabase) { console.error('[zoom-webhook] Supabase not configured, dropping event'); return; }

  const obj = payload.payload?.object || {};
  const { data: eventRow, error: insertError } = await supabase.from('zoom_webhook_events').insert({
    event_type: eventType,
    zoom_meeting_uuid: obj.uuid || null,
    payload_json: payload,
  }).select().single();
  if (insertError) {
    console.error('[zoom-webhook] failed to store raw event:', insertError.message);
    return;
  }

  if (eventType === 'recording.completed') {
    // Media files only (confirmed live: MP4/M4A/TIMELINE, no transcript) -
    // nothing to file. Stored for audit/correlation with the matching
    // transcript_completed event; nothing else to do.
    await supabase.from('zoom_webhook_events').update({ processed: true }).eq('id', eventRow.id);
    return;
  }

  // recording.transcript_completed
  try {
    const files = obj.recording_files || [];
    const transcriptFile = files.find(f => f.file_type === 'TRANSCRIPT');
    if (!transcriptFile) throw new Error('No TRANSCRIPT file in recording_files');

    const vtt = await downloadZoomTranscript(transcriptFile.download_url, payload.download_token);
    const transcript = parseVttToTranscript(vtt);
    if (!transcript.trim()) throw new Error('Parsed transcript is empty');

    // Persisted immediately, before attribution - download_token expires in
    // 24h, so an unmatched event held for manual assignment can't re-fetch
    // this later if attribution takes longer than that to resolve.
    await supabase.from('zoom_webhook_events').update({ transcript_text: transcript }).eq('id', eventRow.id);

    const meetingId = obj.uuid || obj.id;
    const participantsRes = await getZoomMeetingParticipants(meetingId);
    if (!participantsRes.ok) throw new Error(`Zoom participants report failed: ${participantsRes.error}`);
    const participants = (participantsRes.data?.participants || [])
      .map(p => ({ name: p.name || p.user_name || '', email: (p.user_email || p.email || '').toLowerCase() }))
      .filter(p => p.email);

    const { businessId, accountId, matchReason } = await resolveZoomAttribution(supabase, participants);

    await supabase.from('zoom_webhook_events').update({
      participants_json: participants,
      matched_business_id: businessId,
      matched_account_id: accountId,
      match_reason: matchReason,
    }).eq('id', eventRow.id);

    if (!businessId) {
      console.log(`[zoom-webhook] transcript_completed for meeting ${meetingId} held unmatched: ${matchReason}`);
      return; // stays processed:false, held for Step 5's manual assignment
    }

    const filingOptions = {
      transcript,
      call_platform: 'zoom',
      call_date: obj.start_time || new Date().toISOString(),
      call_duration_seconds: obj.duration ? obj.duration * 60 : null,
      call_participants: participants,
      created_by: obj.host_email || null,
    };
    // Tier 2 already resolved the exact account via its own domain - don't
    // re-derive a match that's already known (confirmed design).
    if (matchReason === 'tier2_account_domain_match') filingOptions.preMatchedAccountId = accountId;

    const result = await fileCallLog(supabase, businessId, filingOptions);

    await supabase.from('zoom_webhook_events').update({
      processed: true,
      call_log_entry_id: result.entry.id,
    }).eq('id', eventRow.id);

    console.log(`[zoom-webhook] filed call log entry ${result.entry.id} for business ${businessId} (${matchReason})`);
  } catch (e) {
    console.error('[zoom-webhook] processing failed:', e.message);
    await supabase.from('zoom_webhook_events').update({ processing_error: e.message }).eq('id', eventRow.id);
  }
}

export default createWebhookHandler({
  preProcess: handleZoomUrlValidation,
  verifySignature: verifyZoomSignature,
  onValidPayload: processZoomEvent,
});
