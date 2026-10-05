import { getServiceSupabase } from './lib/authUser.js';

// prospector-auth-v1 Stage 5 - GET /api/access-log: the last 50 auth_events
// (sign-ins, invites, role changes), platform owner only (server.js).
export default async function handler(req, res) {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase.from('auth_events')
    .select('id,event,at,user:profiles!auth_events_user_id_fkey(display_name,email),actor:profiles!auth_events_actor_id_fkey(display_name),business:businesses(name)')
    .order('at', { ascending: false }).limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json({
    entries: data.map(e => ({
      id: e.id,
      event: e.event,
      at: e.at,
      who: e.user?.display_name || e.user?.email || null,
      actor: e.actor?.display_name || null,
      workspace: e.business?.name || null,
    })),
  });
}
