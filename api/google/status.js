import { getGrant } from '../lib/googleGrants.js';

// GET /api/google/status - which Google features the signed-in user has granted.
export default async function handler(req, res) {
  const grant = await getGrant(req.auth.user.id);
  res.json({ email: grant?.google_email || null, features: grant?.features || [] });
}
