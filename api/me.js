import { getServiceSupabase } from './lib/authUser.js';

// prospector-auth-v1 - GET /api/me: the signed-in person and their
// workspaces. sessionAuth (api/lib/requireAuth.js) has already verified the
// session and loaded req.auth; 401 there means the client shows /login.
export default async function handler(req, res) {
  const supabase = getServiceSupabase();
  const { data: memberships, error } = await supabase.from('business_members')
    .select('business_id,role,businesses(name,color)').eq('user_id', req.auth.user.id);
  if (error) return res.status(500).json({ error: error.message });

  // Fire-and-forget: last_seen_at feeds Members & Access (Stage 4).
  supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', req.auth.user.id).then(() => {});

  res.status(200).json({
    email: req.auth.user.email,
    profile: { id: req.auth.user.id, display_name: req.auth.user.name, is_platform_owner: req.auth.isPlatformOwner },
    memberships: memberships.map(m => ({ business_id: m.business_id, role: m.role, name: m.businesses?.name, color: m.businesses?.color })),
  });
}
