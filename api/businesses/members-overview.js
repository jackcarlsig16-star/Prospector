import { getServiceSupabase } from '../lib/authUser.js';

// prospector-auth-v1 Stage 4 - GET /api/workspaces/members: every workspace
// with its members and open invites. Platform owner only (server.js).
export default async function handler(req, res) {
  const supabase = getServiceSupabase();
  const [b, m, i] = await Promise.all([
    supabase.from('businesses').select('id,name,color').order('name'),
    supabase.from('business_members').select('business_id,email,name,role,user_id,profile:profiles!business_members_user_id_fkey(display_name,last_seen_at)'),
    supabase.from('workspace_invites').select('business_id').is('accepted_at', null).is('revoked_at', null).gt('expires_at', new Date().toISOString()),
  ]);
  const err = b.error || m.error || i.error;
  if (err) return res.status(500).json({ error: err.message });
  res.json({
    workspaces: b.data.map(ws => ({
      ...ws,
      open_invites: i.data.filter(x => x.business_id === ws.id).length,
      members: m.data.filter(x => x.business_id === ws.id).map(x => ({
        email: x.email,
        name: x.profile?.display_name || x.name || x.email,
        role: x.role,
        signed_up: !!x.user_id,
        last_seen_at: x.profile?.last_seen_at || null,
      })),
    })),
  });
}
