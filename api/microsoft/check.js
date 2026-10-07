import { microsoftTokenFor } from '../lib/microsoftGrants.js';

// POST /api/microsoft/check - mints a fresh access token from the stored
// refresh token and reads the signed-in mailbox's address. Read-only.
export default async function handler(req, res) {
  const token = await microsoftTokenFor(req, res);
  if (!token) return;
  const r = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', { headers: { Authorization: `Bearer ${token}` } });
  const me = await r.json();
  if (!r.ok) return res.status(502).json({ error: `Microsoft Graph: ${me.error?.code || r.status}` });
  res.json({ ok: true, email: String(me.mail || me.userPrincipalName || '').toLowerCase(), checked_at: new Date().toISOString() });
}
