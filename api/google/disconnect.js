import { decryptToken, deleteGrant, getGrant } from '../lib/googleGrants.js';

// POST /api/google/disconnect - revokes Prospector's access at Google (all
// features at once: Google revokes per app, not per scope) and forgets it.
export default async function handler(req, res) {
  const grant = await getGrant(req.auth.user.id);
  if (grant) {
    try {
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: decryptToken(grant.refresh_token_enc) }),
      });
    } catch {}
    await deleteGrant(req.auth.user.id);
  }
  res.json({ ok: true });
}
