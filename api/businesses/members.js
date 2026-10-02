import { getServiceSupabase } from '../lib/authUser.js';
import { hasRole } from '../lib/requireAuth.js';
import { ROLES } from '../../src/constants/roles.js';

// prospector-auth-v1 Stage 4 - Members & Access. businessGate (requireAuth.js)
// has already required admin on this workspace.
//   GET    /api/businesses/:id/members            - members + pending invites
//   PATCH  /api/businesses/:id/members/:memberId  - change role
//   DELETE /api/businesses/:id/members/:memberId  - remove
// Only an owner can make or unmake an owner, and a workspace always keeps one.

async function listMembers(supabase, businessId) {
  const [members, invites] = await Promise.all([
    supabase.from('business_members')
      .select('id,email,name,role,user_id,created_at,profile:profiles!business_members_user_id_fkey(display_name,last_seen_at)')
      .eq('business_id', businessId).order('created_at'),
    supabase.from('workspace_invites')
      .select('id,email,name,role,expires_at,created_at,inviter:profiles!workspace_invites_invited_by_fkey(display_name)')
      .eq('business_id', businessId).is('accepted_at', null).is('revoked_at', null).order('created_at', { ascending: false }),
  ]);
  if (members.error || invites.error) throw new Error((members.error || invites.error).message);
  return {
    members: members.data.map(m => ({
      id: m.id,
      email: m.email,
      name: m.profile?.display_name || m.name || m.email,
      role: m.role,
      signed_up: !!m.user_id,
      last_seen_at: m.profile?.last_seen_at || null,
    })),
    invites: invites.data.map(i => ({
      id: i.id, email: i.email, name: i.name, role: i.role,
      expires_at: i.expires_at, created_at: i.created_at,
      expired: new Date(i.expires_at) <= new Date(),
      invited_by: i.inviter?.display_name || null,
    })),
  };
}

async function ownerCount(supabase, businessId) {
  const { count, error } = await supabase.from('business_members')
    .select('id', { count: 'exact', head: true }).eq('business_id', businessId).eq('role', 'owner');
  if (error) throw new Error(error.message);
  return count;
}

export default async function handler(req, res) {
  const supabase = getServiceSupabase();
  const businessId = req.params.id;
  try {
    if (req.method === 'GET') return res.json(await listMembers(supabase, businessId));

    const { data: member, error } = await supabase.from('business_members')
      .select('id,role,user_id').eq('id', req.params.memberId).eq('business_id', businessId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!member) return res.status(404).json({ error: 'That member is not in this workspace' });

    const isOwner = hasRole(req, businessId, 'owner');
    const newRole = req.method === 'PATCH' ? req.body?.role : null;
    if (req.method === 'PATCH' && !ROLES.includes(newRole)) return res.status(400).json({ error: 'Unknown role' });
    if ((member.role === 'owner' || newRole === 'owner') && !isOwner) {
      return res.status(403).json({ error: 'Only an Owner can add or remove Owners' });
    }
    if (member.role === 'owner' && newRole !== 'owner' && await ownerCount(supabase, businessId) <= 1) {
      return res.status(409).json({ error: 'A workspace needs at least one Owner. Make someone else Owner first.' });
    }

    const event = { business_id: businessId, actor_id: req.auth.user.id, user_id: member.user_id };
    if (req.method === 'PATCH') {
      const { error: uErr } = await supabase.from('business_members').update({ role: newRole }).eq('id', member.id);
      if (uErr) throw new Error(uErr.message);
      await supabase.from('auth_events').insert({ ...event, event: 'role_changed' });
    } else if (req.method === 'DELETE') {
      const { error: dErr } = await supabase.from('business_members').delete().eq('id', member.id);
      if (dErr) throw new Error(dErr.message);
      await supabase.from('auth_events').insert({ ...event, event: 'member_removed' });
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    res.json(await listMembers(supabase, businessId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
