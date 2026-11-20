import { getSupabase } from '../sales/goalsShared.js';
import { sealer, verifySignature } from './client.js';
import { storeRecording, extractStored } from './extract.js';

// fathom-notes-v1 F3 - POST /api/fathom/webhook/:token. The token in the URL names the connection (one member, one
// workspace); the Standard-Webhooks signature made with that connection's secret is the gate - this path is exempt
// from sign-in. The only read before the signature is checked is the connection row the secret lives on; an unknown
// token and a bad signature get the same 401. Then: one event row per webhook-id (a resend does no work), 200, and
// only after the reply the note + the extraction. The payload itself is never stored and never logged.

const TOKEN = /^[A-Za-z0-9_-]{32,64}$/;
const deny = res => res.status(401).json({ error: 'Invalid signature' });

// Returns the promise of the work done after the reply (a suite awaits it; the server does not).
export async function receive(req, res, { supabase = getSupabase(), now = new Date() } = {}) {
  const token = req.params?.token;
  if (!TOKEN.test(token || '')) return deny(res);
  const { data: conn } = await supabase.from('sales_fathom_connections').select('id, business_id, user_id, webhook_secret_enc')
    .eq('webhook_token', token).eq('status', 'connected').maybeSingle();
  if (!conn?.webhook_secret_enc) return deny(res);
  const webhookId = req.headers['webhook-id'];
  let ok = false;
  try {
    ok = verifySignature({ secret: sealer.decrypt(conn.webhook_secret_enc), id: webhookId, timestamp: req.headers['webhook-timestamp'], signature: req.headers['webhook-signature'], rawBody: req.rawBody, now: now.getTime() });
  } catch (e) { console.error('[fathom/webhook] verify failed:', e.message); }
  if (!ok) return deny(res);

  const recordingId = Number.isSafeInteger(Number(req.body?.recording_id)) ? Number(req.body.recording_id) : null;
  const { error } = await supabase.from('sales_fathom_events').insert({ webhook_id: String(webhookId).slice(0, 200), business_id: conn.business_id, recording_id: recordingId, status: 'received' });
  if (error?.code === '23505') return res.status(200).json({ received: true, duplicate: true });
  if (error) { console.error('[fathom/webhook] event row:', error.message); return res.status(500).json({ error: 'not stored' }); }
  res.status(200).json({ received: true });
  return work(supabase, conn, String(webhookId).slice(0, 200), req.body, now);
}

async function work(supabase, conn, webhookId, meeting, now) {
  const mark = (status, error = null) => supabase.from('sales_fathom_events').update({ status, error: error ? String(error).slice(0, 500) : null }).eq('webhook_id', webhookId);
  try {
    await supabase.from('sales_fathom_connections').update({ last_event_at: now.toISOString() }).eq('id', conn.id);
    const stored = await storeRecording(supabase, { businessId: conn.business_id, userId: conn.user_id, meeting });
    if (stored.skipped) return void await mark('skipped', stored.skipped);
    if (stored.duplicate) return void await mark('duplicate');
    await mark('stored');
    const { status } = await extractStored(supabase, { businessId: conn.business_id, userId: conn.user_id, note: stored.note, now });
    await mark(status);
  } catch (e) {
    console.error('[fathom/webhook] processing failed:', e.message);
    await mark('error', e.message);
  }
}

export default function handler(req, res) {
  receive(req, res).catch(e => {
    console.error('[fathom/webhook]', e.message);
    if (!res.headersSent) res.status(500).json({ error: 'webhook failed' });
  });
}
