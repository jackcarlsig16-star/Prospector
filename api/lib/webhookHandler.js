// Phase 4 (external-api-foundation-v1) - generic inbound-webhook primitive.
// Ack 200 fast, process the payload async: mirrors businesses/retry.js's
// existing ack-then-async shape (flip state / respond synchronously, then
// fire the real work after the response is sent), which already works
// correctly in production. Signature verification and any provider
// handshake (e.g. Zoom's endpoint.url_validation) are pluggable per
// provider, not built as one-offs inside this file.
//
// Requires req.rawBody (raw request bytes as a string) for HMAC signature
// verification - server.js's express.json() captures this via its `verify`
// option so re-serializing req.body can't produce a different byte string
// than what the provider actually signed.
export function createWebhookHandler({ verifySignature, onValidPayload, preProcess }) {
  return async function webhookHandler(req, res) {
    if (preProcess) {
      const handled = await preProcess(req, res);
      if (handled) return; // preProcess already sent a response (e.g. a provider's URL-validation handshake)
    }

    let valid = false;
    try {
      valid = await verifySignature(req);
    } catch (err) {
      console.error('[webhook] signature verification threw:', err.message);
    }

    if (!valid) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    res.status(200).json({ received: true });

    Promise.resolve(onValidPayload(req.body, req)).catch(err => {
      console.error('[webhook] async processing failed:', err.message);
    });
  };
}
