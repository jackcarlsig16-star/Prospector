import { getServiceSupabase, getSessionUser } from './lib/authUser.js';

// prospector-auth-v1 Stage 2 - GET /api/me: the signed-in person and their
// workspaces. 401 when there's no valid session (the client shows /login).
export default async function handler(req, res) {
  const supabase = getServiceSupabase();
  const user = await getSessionUser(req, supabase);
  if (!user) return res.status(401).json({ error: 'Not signed in' });

  const [{ data: profile, error: pErr }, { data: memberships, error: mErr }] = await Promise.all([
    supabase.from('profiles').select('id,email,display_name,is_platform_owner').eq('id', user.id).maybeSingle(),
    supabase.from('business_members').select('business_id,role,businesses(name,color)').eq('user_id', user.id),
  ]);
  if (pErr || mErr) return res.status(500).json({ error: (pErr || mErr).message });

  // Fire-and-forget: last_seen_at feeds Members & Access (Stage 4).
  if (profile) supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', user.id).then(() => {});

  res.status(200).json({
    email: user.email,
    email_confirmed: !!user.email_confirmed_at,
    profile,
    memberships: (memberships || []).map(m => ({ business_id: m.business_id, role: m.role, name: m.businesses?.name, color: m.businesses?.color })),
  });
}
