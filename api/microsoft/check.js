import { accessTokenFor, NeedsMicrosoft } from '../lib/microsoftGrants.js';
import { GRAPH_URL, BACKFILL_DAYS } from './graphSync.js';
import { storedFamily } from './errorFamily.js';

// POST /api/microsoft/check - asks Microsoft for a fresh access token (even when the grant row holds an error: an
// admin may have approved since), reads /me, then what Graph says each mail folder holds (total, and inside the
// sync's 90-day window) so the sync's "seen" counts can be checked against the mailbox. Read-only; domain only.
async function graph(token, path, headers = {}) {
  const r = await fetch(`${GRAPH_URL()}${path}`, { headers: { Authorization: `Bearer ${token}`, ...headers } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Microsoft Graph ${r.status}: ${data.error?.code || 'request failed'}`);
  return data;
}

async function folderCounts(token, folder, since) {
  const out = { folder };
  try { out.total = (await graph(token, `/me/mailFolders/${folder}?$select=totalItemCount`)).totalItemCount ?? null; } catch (err) { out.total_error = err.message; }
  try {
    const d = await graph(token, `/me/mailFolders/${folder}/messages?$filter=${encodeURIComponent(`receivedDateTime ge ${since}`)}&$count=true&$top=1&$select=id`, { ConsistencyLevel: 'eventual' });
    out.window = d['@odata.count'] ?? null;
  } catch (err) { out.window_error = err.message; }
  return out;
}

export default async function handler(req, res) {
  let token;
  try { token = await accessTokenFor(req.auth.user.id, { retry: true }); } catch (err) {
    if (err instanceof NeedsMicrosoft) return res.status(409).json({ error: err.message, needs_microsoft: true, problem: storedFamily(err.message) });
    return res.status(502).json({ error: err.message });
  }
  let me;
  try { me = await graph(token, '/me?$select=mail,userPrincipalName'); } catch (err) { return res.status(502).json({ error: err.message }); }
  const since = new Date(Date.now() - BACKFILL_DAYS * 864e5).toISOString();
  const folders = [await folderCounts(token, 'inbox', since), await folderCounts(token, 'sentitems', since)];
  res.json({ ok: true, domain: String(me.mail || me.userPrincipalName || '').toLowerCase().split('@')[1] || null, checked_at: new Date().toISOString(), window_since: since, folders });
}
