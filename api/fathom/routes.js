import { randomBytes } from 'crypto';
import { getSupabase } from '../sales/goalsShared.js';
import { hasRole } from '../lib/requireAuth.js';
import { laDateString } from '../sales/laDate.js';
import { reviewOf } from '../sales/callNotesRoutes.js';
import { sealer, listMeetings, createWebhook, deleteWebhook } from './client.js';
import { storeRecording, extractStored, extractsLeft } from './extract.js';

// fathom-notes-v1 F1 / F2 / F9 - a member's Fathom connection in one workspace, under /api/sales/:businessId/fathom
// (salesGate: GET needs Viewer, every write Member). The API key and the webhook secret are sealed with
// FATHOM_TOKEN_KEY and never leave the server: no reply here carries either, sealed or not.
// Fathom calls, declared: test 1 · register 1 · disconnect 1 · pull <= 5.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLS = 'id, business_id, user_id, key_enc, webhook_token, fathom_webhook_id, connected_at, last_event_at, backfill_after, backfill_cursor, status';
const PULL_PAGES = 5;
const PULL_DAYS = 30;
const PULLED = 'done';
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };

const shown = c => (!c ? { connected: false } : {
  connected: c.status === 'connected', status: c.status, user_id: c.user_id, connected_at: c.connected_at, last_event_at: c.last_event_at,
  webhook: !!c.fathom_webhook_id, webhook_id_tail: c.fathom_webhook_id ? String(c.fathom_webhook_id).slice(-4) : null,
  pull: { started: !!c.backfill_after, more: !!c.backfill_cursor && c.backfill_cursor !== PULLED, finished: c.backfill_cursor === PULLED },
});

// Whose connection: the caller's own, or (an Owner only) another member of this workspace.
async function subject(req, supabase) {
  const businessId = req.params.businessId;
  const asked = req.body?.user_id ?? req.query?.user_id;
  if (asked == null || asked === req.auth.user.id) return { businessId, userId: req.auth.user.id };
  if (!UUID.test(asked)) return { error: [400, 'user_id is not valid'] };
  if (!hasRole(req, businessId, 'owner')) return { error: [403, 'Only an Owner connects Fathom for another member'] };
  const member = must(await supabase.from('business_members').select('user_id').eq('business_id', businessId).eq('user_id', asked).maybeSingle());
  return member ? { businessId, userId: asked } : { error: [400, 'That person is not a member of this workspace'] };
}
const connection = async (supabase, { businessId, userId }) => must(await supabase.from('sales_fathom_connections').select(COLS).eq('business_id', businessId).eq('user_id', userId).maybeSingle());

// Every route: resolve whose connection, load it, answer Fathom's own failures as 502 with Fathom's reason.
const route = (label, fn, { needs = true } = {}) => async (req, res) => {
  const supabase = getSupabase();
  try {
    const who = await subject(req, supabase);
    if (who.error) return res.status(who.error[0]).json({ error: who.error[1] });
    const conn = await connection(supabase, who);
    if (needs && conn?.status !== 'connected') return res.status(409).json({ error: 'Fathom is not connected - paste an API key first' });
    await fn({ req, res, supabase, conn, ...who });
  } catch (e) {
    if (e.fathomStatus) return res.status(502).json({ error: e.message });
    console.error(`[fathom/${label}]`, e.message);
    res.status(500).json({ error: e.message });
  }
};

// GET fathom -> the connection's state, how many recordings it has stored, today's extraction allowance.
// members: one row per member who has ever connected here (names only). An Owner also gets `others` - the members
// with no row yet, whom only an Owner connects.
async function storedFor(supabase, businessId, userId) {
  const [n, last] = await Promise.all([
    supabase.from('sales_call_notes').select('id', { count: 'exact', head: true }).eq('business_id', businessId).eq('created_by', userId).not('fathom_recording_id', 'is', null),
    supabase.from('sales_call_notes').select('call_date').eq('business_id', businessId).eq('created_by', userId).not('fathom_recording_id', 'is', null).order('call_date', { ascending: false }).limit(1),
  ]);
  if (n.error) throw new Error(n.error.message);
  return { stored: n.count, last_recording: must(last)[0]?.call_date || null };
}
export const statusRoute = route('status', async ({ req, res, supabase, conn, businessId, userId }) => {
  const [conns, people] = await Promise.all([
    supabase.from('sales_fathom_connections').select(COLS).eq('business_id', businessId).order('connected_at').then(must),
    supabase.from('business_members').select('user_id, name, profile:profiles!business_members_user_id_fkey(display_name)').eq('business_id', businessId).not('user_id', 'is', null).then(must),
  ]);
  const nameOf = id => { const m = people.find(p => p.user_id === id); return ((m?.profile?.display_name || m?.name || '').trim().split(/\s+/)[0] || 'Member').replace(/@.*/, ''); };
  const members = await Promise.all(conns.map(async c => ({ ...shown(c), name: nameOf(c.user_id), ...await storedFor(supabase, businessId, c.user_id) })));
  const owner = hasRole(req, businessId, 'owner');
  const has = new Set(conns.map(c => c.user_id));
  res.json({
    ...shown(conn), stored: members.find(m => m.user_id === userId)?.stored ?? 0,
    me: req.auth.user.id, owner, members, others: owner ? people.filter(p => !has.has(p.user_id)).map(p => ({ user_id: p.user_id, name: nameOf(p.user_id) })) : [],
    extracts: await extractsLeft(supabase, businessId),
  });
}, { needs: false });

// POST fathom/connect { key, user_id? } - seals the key. No Fathom call: Test is its own click.
export const connectRoute = route('connect', async ({ req, res, supabase, conn, businessId, userId }) => {
  const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
  if (key.length < 20 || key.length > 400 || /\s/.test(key)) return res.status(400).json({ error: 'Paste the API key from Fathom › Settings › API Access' });
  const row = { business_id: businessId, user_id: userId, key_enc: sealer.encrypt(key), status: 'connected', connected_at: new Date().toISOString() };
  const saved = conn
    ? must(await supabase.from('sales_fathom_connections').update(row).eq('id', conn.id).select(COLS).single())
    : must(await supabase.from('sales_fathom_connections').insert({ ...row, webhook_token: randomBytes(32).toString('base64url') }).select(COLS).single());
  res.status(conn ? 200 : 201).json(shown(saved));
}, { needs: false });

// POST fathom/test - ONE call: GET /meetings with no includes; the status line reads the first row's date.
export const testRoute = route('test', async ({ res, conn }) => {
  const page = await listMeetings(sealer.decrypt(conn.key_enc));
  const first = page?.items?.[0];
  const at = first && new Date(first.recording_start_time || first.created_at);
  res.json({ ok: true, last_recording: at && !Number.isNaN(at.getTime()) ? laDateString(at) : null });
});

// POST fathom/webhook - ONE call: registers the destination for this member's own recordings and seals the secret
// Fathom returns (it is returned once, here).
export const registerRoute = route('register', async ({ req, res, supabase, conn }) => {
  if (conn.fathom_webhook_id) return res.status(409).json({ error: 'The webhook is already registered' });
  const proto = (req.get('x-forwarded-proto') || req.protocol || '').split(',')[0].trim();
  if (proto !== 'https') return res.status(400).json({ error: 'Register the webhook from the live site - Fathom needs an https address it can reach' });
  const made = await createWebhook(sealer.decrypt(conn.key_enc), `https://${req.get('host')}/api/fathom/webhook/${conn.webhook_token}`);
  if (!made?.id || typeof made.secret !== 'string') return res.status(502).json({ error: 'Fathom did not return a webhook secret' });
  const saved = must(await supabase.from('sales_fathom_connections').update({ fathom_webhook_id: String(made.id), webhook_secret_enc: sealer.encrypt(made.secret) }).eq('id', conn.id).select(COLS).single());
  res.status(201).json(shown(saved));
});

// POST fathom/pull - "Pull my last 30 days": at most 5 pages a click, each recording stored as a note with NO
// extraction (0 model calls). The window and the cursor are kept on the connection, so the next click continues
// where this one stopped and a finished window is never read again.
export const pullRoute = route('pull', async ({ res, supabase, conn, businessId, userId }) => {
  if (conn.backfill_cursor === PULLED) return res.status(409).json({ error: `The last ${PULL_DAYS} days were already pulled` });
  const key = sealer.decrypt(conn.key_enc);
  const after = conn.backfill_after || new Date(Date.now() - PULL_DAYS * 86400e3).toISOString();
  const out = { stored: 0, already: 0, skipped: 0, pages: 0, page_size: null, more: true, stopped: null };
  let cursor = conn.backfill_cursor || null;
  while (out.pages < PULL_PAGES) {
    let page;
    try { page = await listMeetings(key, { cursor, createdAfter: after, full: true }); } catch (e) {
      if (!e.fathomStatus || !out.pages) throw e;
      out.stopped = e.message;
      break;
    }
    out.pages++;
    const items = Array.isArray(page?.items) ? page.items : [];
    out.page_size ??= page?.limit ?? items.length;
    for (const meeting of items) {
      const r = await storeRecording(supabase, { businessId, userId, meeting });
      out[r.note ? 'stored' : r.duplicate ? 'already' : 'skipped']++;
    }
    cursor = page?.next_cursor || null;
    must(await supabase.from('sales_fathom_connections').update({ backfill_after: after, backfill_cursor: cursor || PULLED }).eq('id', conn.id).select('id'));
    if (!cursor) { out.more = false; break; }
  }
  res.json(out);
});

// POST fathom/disconnect - ONE call (the Fathom webhook is deleted); the connection row and every note stay.
export const disconnectRoute = route('disconnect', async ({ res, supabase, conn }) => {
  let webhook_deleted = !conn.fathom_webhook_id;
  if (conn.fathom_webhook_id) {
    try { await deleteWebhook(sealer.decrypt(conn.key_enc), conn.fathom_webhook_id); webhook_deleted = true; } catch (e) { console.error('[fathom/disconnect] webhook delete:', e.message); }
  }
  const saved = must(await supabase.from('sales_fathom_connections').update({ status: 'disconnected', fathom_webhook_id: null, webhook_secret_enc: null }).eq('id', conn.id).select(COLS).single());
  res.json({ ...shown(saved), webhook_deleted });
});

// PUT fathom/cap { cap } - Owner: automatic extractions per day for this workspace (0 = never automatic).
export async function capRoute(req, res) {
  const businessId = req.params.businessId;
  if (!hasRole(req, businessId, 'owner')) return res.status(403).json({ error: 'Only an Owner changes the daily cap' });
  const cap = req.body?.cap;
  if (!Number.isInteger(cap) || cap < 0 || cap > 200) return res.status(400).json({ error: 'cap must be a whole number from 0 to 200' });
  const supabase = getSupabase();
  const { error } = await supabase.from('sales_settings').upsert({ business_id: businessId, fathom_extract_cap: cap }, { onConflict: 'business_id' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ extracts: await extractsLeft(supabase, businessId) });
}

// POST fathom/notes/:id/extract - "Extract" on a stored recording that has none (past the cap, or pulled): ONE model
// call under the same daily cap, stored on the note as a proposal, and the review comes back.
export async function extractNoteRoute(req, res) {
  const businessId = req.params.businessId;
  const supabase = getSupabase();
  try {
    if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'note not found' });
    const note = must(await supabase.from('sales_call_notes').select('id, title, call_date, source_type, source_label, text, transcript, attendees, fathom_recording_id, fathom_url, extract, accepted_at, created_at')
      .eq('business_id', businessId).eq('id', req.params.id).maybeSingle());
    if (!note || note.fathom_recording_id == null) return res.status(404).json({ error: 'note not found' });
    if (note.accepted_at) return res.status(409).json({ error: 'These notes were already accepted' });
    if (note.extract) return res.status(409).json({ error: 'These notes already hold an extract - open the review' });
    const done = await extractStored(supabase, { businessId, userId: req.auth.user.id, note });
    if (done.status === 'capped') return res.status(429).json({ error: "Today's extractions for this workspace are used - an Owner can raise the daily cap" });
    const { text, transcript, extract, ...pub } = note;
    res.json({ note: pub, call_date: note.call_date, ...await reviewOf(supabase, businessId, done.raw, done.ctx, note.call_date), usage: done.usage });
  } catch (e) {
    if (e.status === 502) return res.status(502).json({ error: e.message });
    console.error('[fathom/extract]', e.message);
    res.status(500).json({ error: e.message });
  }
}
