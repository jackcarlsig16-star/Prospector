import { getGrant, microsoftConfigured, canSendTeamEmail } from '../lib/microsoftGrants.js';

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
    // homelover-team-emails-v1: a grant from before Mail.Send was added still reads mail + calendar; only team emails wait.
    team_email: grant ? (canSendTeamEmail(grant) ? 'ready' : 'Reconnect to allow team emails') : null,
  });
}
