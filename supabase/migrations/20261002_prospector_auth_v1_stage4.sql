-- prospector-auth-v1 Stage 4 - Members & Access.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- The admin types the invitee's name with the invite; it pre-fills their
-- sign-up and becomes their member name on accept.
ALTER TABLE public.workspace_invites ADD COLUMN IF NOT EXISTS name text;

-- Revocations go in the audit log alongside the other membership events.
ALTER TABLE public.auth_events DROP CONSTRAINT IF EXISTS auth_events_event_check;
ALTER TABLE public.auth_events ADD CONSTRAINT auth_events_event_check CHECK (event IN (
  'sign_in', 'sign_out', 'invite_created', 'invite_accepted', 'invite_revoked', 'role_changed', 'member_removed'
));
