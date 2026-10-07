import { getGrant, microsoftConfigured } from '../lib/microsoftGrants.js';

// GET /api/microsoft/status - which Microsoft account the signed-in user connected.
export default async function handler(req, res) {
  const grant = await getGrant(req.auth.user.id);
  res.json({
    configured: microsoftConfigured(),
    email: grant?.account_email || null,
    scopes: grant?.scopes || [],
    connected_at: grant?.connected_at || null,
    last_used_at: grant?.last_used_at || null,
    error: grant?.error || null,
  });
}
