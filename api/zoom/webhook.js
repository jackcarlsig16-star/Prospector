// Reference implementation of the Phase 4 webhook primitive
// (external-api-foundation-v1) - Zoom's recording.completed event. This is
// also the start of zoom-meet-auto-ingest-v1: the handshake and signature
// verification are real and load-bearing now; actual recording
// download/transcription is a separate future spec (see processZoomEvent).
import crypto from 'crypto';
import { createWebhookHandler } from '../lib/webhookHandler.js';

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

async function processZoomEvent(payload) {
  if (payload?.event !== 'recording.completed') {
    console.log(`[zoom-webhook] ignored event: ${payload?.event}`);
    return;
  }
  const obj = payload.payload?.object || {};
  const files = (obj.recording_files || []).map(f => ({ type: f.recording_type, downloadUrl: f.download_url }));
  console.log(`[zoom-webhook] recording.completed: meeting="${obj.topic}" id=${obj.id} files=${files.length}`);
  // zoom-meet-auto-ingest-v1 picks up here: download files, transcribe, file into business_intel_entries.
}

export default createWebhookHandler({
  preProcess: handleZoomUrlValidation,
  verifySignature: verifyZoomSignature,
  onValidPayload: processZoomEvent,
});
