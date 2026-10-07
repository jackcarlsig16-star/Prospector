import { deleteGrant } from '../lib/microsoftGrants.js';

// POST /api/microsoft/disconnect - Microsoft has no per-app token revoke for
// delegated access, so the stored refresh token (the only copy) is deleted.
export default async function handler(req, res) {
  await deleteGrant(req.auth.user.id);
  res.json({ ok: true });
}
