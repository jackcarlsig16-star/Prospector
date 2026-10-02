import crypto from 'crypto';
import { getServiceSupabase } from './lib/authUser.js';
import { ROLE_LABELS } from '../src/constants/roles.js';

// prospector-auth-v1 Stage 2 - invite lookup + acceptance. Invites are
// created in Stage 4 (Members & Access); only the token's sha256 is stored.
//   GET  /api/invites/:token         - what this link is for (no session needed)
//   POST /api/invites/:token/accept  - signed-in, email-matched acceptance

export function hashInviteToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function inviteStatus(invite) {
  if (invite.revoked_at) return 'revoked';
  if (invite.accepted_at) return 'used';
  if (new Date(invite.expires_at) <= new Date()) return 'expired';
  return 'valid';
}

async function loadInvite(supabase, token) {
  const { data, error } = await supabase.from('workspace_invites')
    .select('id,business_id,email,role,expires_at,accepted_at,revoked_at,invited_by,businesses(name,color),inviter:profiles!workspace_invites_invited_by_fkey(display_name)')
    .eq('token_hash', hashInviteToken(token)).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export default async function handler(req, res) {
  const token = req.params.token || '';
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return res.status(404).json({ error: 'This invite link is not valid.' });
  const supabase = getServiceSupabase();
  const invite = await loadInvite(supabase, token);
  if (!invite) return res.status(404).json({ error: 'This invite link is not valid.' });
  const status = inviteStatus(invite);

  if (req.method === 'GET') {
    return res.status(200).json({
      status,
      email: invite.email,
      role: invite.role,
      role_label: ROLE_LABELS[invite.role],
      business: { id: invite.business_id, name: invite.businesses?.name || 'a workspace', color: invite.businesses?.color || null },
      invited_by: invite.inviter?.display_name || null,
      expires_at: invite.expires_at,
    });
  }

  if (status !== 'valid') return res.status(410).json({ error: `This invite is ${status}.`, status });
  // sessionAuth already required a signed-in user with a profile, which only
  // exists once their email is confirmed.
  const user = req.auth.user;
  if (user.email !== invite.email) {
    return res.status(403).json({ error: `This invite is for ${invite.email}. You're signed in as ${user.email}.` });
  }

  // Claim first, conditionally, so two tabs can't both accept the same link.
  const now = new Date().toISOString();
  const { data: claimed, error: cErr } = await supabase.from('workspace_invites')
    .update({ accepted_at: now, accepted_by: user.id })
    .eq('id', invite.id).is('accepted_at', null).is('revoked_at', null).gt('expires_at', now)
    .select('id');
  if (cErr) return res.status(500).json({ error: cErr.message });
  if (!claimed.length) return res.status(410).json({ error: 'This invite was just used or revoked.', status: 'used' });

  const { error: mErr } = await supabase.from('business_members').upsert({
    business_id: invite.business_id,
    email: invite.email,
    name: user.name,
    user_id: user.id,
    role: invite.role,
    invited_by: invite.invited_by,
  }, { onConflict: 'business_id,email' });
  if (mErr) return res.status(500).json({ error: `Invite accepted but membership failed: ${mErr.message}` });

  await supabase.from('auth_events').insert({ user_id: user.id, event: 'invite_accepted', business_id: invite.business_id, actor_id: user.id });
  return res.status(200).json({ business_id: invite.business_id });
}
