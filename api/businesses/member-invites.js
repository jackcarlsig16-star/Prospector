import crypto from 'crypto';
import { getServiceSupabase } from '../lib/authUser.js';
import { hasRole } from '../lib/requireAuth.js';
import { hashInviteToken } from '../invites.js';
import { ROLES } from '../../src/constants/roles.js';

// prospector-auth-v1 Stage 4 - invite links. businessGate has required admin.
//   POST /api/businesses/:id/invites                     - create { email, name, role }
//   POST /api/businesses/:id/invites/:inviteId/link      - fresh link
//   POST /api/businesses/:id/invites/:inviteId/email     - fresh link, emailed by Supabase
//   POST /api/businesses/:id/invites/:inviteId/revoke
// Only the token's hash is stored, so an existing link can't be shown again:
// "copy link" and "email" issue a new token (and a new 7 days) and the old
// link stops working.

const INVITE_MS = 7 * 24 * 3600e3;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function issueToken() {
  const token = crypto.randomBytes(24).toString('base64url');
  return { token, token_hash: hashInviteToken(token), expires_at: new Date(Date.now() + INVITE_MS).toISOString() };
}

const linkFor = (req, token) => `${req.protocol}://${req.get('host')}/invite/${token}`;

// Supabase's built-in mailer. Its invite email signs them in and lands them
// on the invite page, which then accepts. It can't invite an address that
// already has an account, and the default SMTP only delivers to a few
// addresses an hour - the copyable link always works.
async function sendInviteEmail(supabase, invite, link) {
  const { error } = await supabase.auth.admin.inviteUserByEmail(invite.email, {
    redirectTo: link,
    data: invite.name ? { full_name: invite.name } : undefined,
  });
  if (!error) return null;
  if (/already been registered|already registered|exists/i.test(error.message)) {
    return `${invite.email} already has a Prospector account, so Supabase won't email them. Send them the link instead.`;
  }
  return `Email not sent: ${error.message}. Send them the link instead.`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getServiceSupabase();
  const businessId = req.params.id;
  const actor = req.auth.user.id;

  try {
    if (!req.params.inviteId) {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const name = String(req.body?.name || '').trim().slice(0, 120) || null;
      const role = req.body?.role;
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
      if (!ROLES.includes(role)) return res.status(400).json({ error: 'Pick a role' });
      if (role === 'owner' && !hasRole(req, businessId, 'owner')) return res.status(403).json({ error: 'Only an Owner can invite an Owner' });

      // Rows without a user_id are pre-auth join-code members; inviting them
      // is how they get in, so only a signed-up member blocks a new invite.
      const { data: existing, error: eErr } = await supabase.from('business_members')
        .select('id').eq('business_id', businessId).eq('email', email).not('user_id', 'is', null).maybeSingle();
      if (eErr) throw new Error(eErr.message);
      if (existing) return res.status(409).json({ error: `${email} is already a member here. Change their role instead.` });

      // One live link per person per workspace.
      const now = new Date().toISOString();
      const { error: rErr } = await supabase.from('workspace_invites').update({ revoked_at: now })
        .eq('business_id', businessId).eq('email', email).is('accepted_at', null).is('revoked_at', null);
      if (rErr) throw new Error(rErr.message);

      const { token, ...tokenFields } = issueToken();
      const { data: invite, error: iErr } = await supabase.from('workspace_invites')
        .insert({ business_id: businessId, email, name, role, invited_by: actor, ...tokenFields })
        .select('id,email,name,role,expires_at').single();
      if (iErr) throw new Error(iErr.message);
      await supabase.from('auth_events').insert({ event: 'invite_created', business_id: businessId, actor_id: actor });

      const link = linkFor(req, token);
      const emailError = req.body?.send_email ? await sendInviteEmail(supabase, invite, link) : null;
      return res.json({ invite, link, emailed: !!req.body?.send_email && !emailError, email_error: emailError });
    }

    const { data: invite, error } = await supabase.from('workspace_invites')
      .select('id,email,name,role,accepted_at,revoked_at').eq('id', req.params.inviteId).eq('business_id', businessId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!invite || invite.accepted_at || invite.revoked_at) return res.status(404).json({ error: 'That invite was already used or cancelled' });
    if (invite.role === 'owner' && !hasRole(req, businessId, 'owner')) return res.status(403).json({ error: 'Only an Owner can manage an Owner invite' });

    if (req.params.action === 'revoke') {
      const { error: vErr } = await supabase.from('workspace_invites').update({ revoked_at: new Date().toISOString() }).eq('id', invite.id);
      if (vErr) throw new Error(vErr.message);
      await supabase.from('auth_events').insert({ event: 'invite_revoked', business_id: businessId, actor_id: actor });
      return res.json({ ok: true });
    }
    if (req.params.action !== 'link' && req.params.action !== 'email') return res.status(404).json({ error: 'Unknown invite action' });

    const { token, ...tokenFields } = issueToken();
    const { error: uErr } = await supabase.from('workspace_invites').update(tokenFields).eq('id', invite.id);
    if (uErr) throw new Error(uErr.message);
    const link = linkFor(req, token);
    const emailError = req.params.action === 'email' ? await sendInviteEmail(supabase, invite, link) : null;
    res.json({ link, expires_at: tokenFields.expires_at, emailed: req.params.action === 'email' && !emailError, email_error: emailError });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
