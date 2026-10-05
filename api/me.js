import crypto from 'crypto';
import { getServiceSupabase } from './lib/authUser.js';

// A gap this long since the last request counts as a new visit (one
// sign_in event in the access log), not every page load.
const VISIT_GAP_MS = 30 * 60e3;

// prospector-auth-v1 - the signed-in person and their workspaces. sessionAuth
// (api/lib/requireAuth.js) has already verified the session and loaded
// req.auth; 401 there means the client shows /login.
//   GET  /api/me          - profile + memberships
//   POST /api/me/welcome  - { display_name? } closes the one-time Welcome screen
export default async function handler(req, res) {
  const supabase = getServiceSupabase();
  const userId = req.auth.user.id;

  if (req.method === 'POST') {
    const patch = { welcomed_at: new Date().toISOString() };
    const name = String(req.body?.display_name || '').trim().slice(0, 120);
    if (name) patch.display_name = name;
    const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  const [{ data: memberships, error }, { data: profile, error: pErr }] = await Promise.all([
    supabase.from('business_members').select('business_id,role,created_at,businesses(name,color)').eq('user_id', userId),
    supabase.from('profiles').select('welcomed_at,last_seen_at').eq('id', userId).single(),
  ]);
  if (error || pErr) return res.status(500).json({ error: (error || pErr).message });

  // Fire-and-forget: last_seen_at feeds Members & Access, sign_in the access log.
  supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', userId).then(() => {});
  if (!profile.last_seen_at || Date.now() - new Date(profile.last_seen_at) > VISIT_GAP_MS) {
    const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    const ip_hash = ip ? crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16) : null;
    supabase.from('auth_events').insert({ user_id: userId, actor_id: userId, event: 'sign_in', ip_hash }).then(() => {});
  }

  res.status(200).json({
    email: req.auth.user.email,
    profile: { id: userId, display_name: req.auth.user.name, is_platform_owner: req.auth.isPlatformOwner, welcomed_at: profile.welcomed_at },
    memberships: memberships.map(m => ({ business_id: m.business_id, role: m.role, joined_at: m.created_at, name: m.businesses?.name, color: m.businesses?.color })),
  });
}
