-- prospector-auth-v1 Stage 1 - data model for real logins, workspaces, invites, roles.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Workspace = businesses row. Membership = business_members, upgraded in place
-- (Jack, 2026-10-02) rather than a parallel table, so member_list_permissions
-- (FK member_id) and the existing Members tab keep working.
-- Nothing here changes what the app does today: nothing reads profiles/roles yet
-- (server enforcement is Stage 3, RLS lockdown Stage 5). Basic Auth stays on.
-- team_users / approved_users are untouched (retired in Stage 6).

-- ============================================================================
-- profiles - one row per signed-in person, id = auth.users.id
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id                uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email             text NOT NULL UNIQUE CHECK (email = lower(email)),
  display_name      text NOT NULL,
  -- Set once by hand after Jack's first Google sign-in (Jack, 2026-10-02) -
  -- never derived from an email match, so no sign-up path can grant it.
  is_platform_owner boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz
);

-- ============================================================================
-- business_members - upgraded into the membership table
-- ============================================================================
ALTER TABLE public.business_members
  ADD COLUMN IF NOT EXISTS user_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS role       text NOT NULL DEFAULT 'member',
  ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE public.business_members
    ADD CONSTRAINT business_members_role_check CHECK (role IN ('owner', 'admin', 'member', 'viewer'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- email stays the pre-sign-up key (UNIQUE business_id+email already exists);
-- once linked, one membership per person per workspace.
CREATE UNIQUE INDEX IF NOT EXISTS business_members_business_user_idx
  ON public.business_members (business_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS business_members_user_idx ON public.business_members (user_id);

-- Existing rows keep role 'member' via the column default (Jack: keep both as Member).
-- Jack = Owner on every current workspace (he is owner_email on all four). Linked
-- to his user on first verified sign-in by the trigger below. name fixes "Calrson".
INSERT INTO public.business_members (business_id, email, name, role)
SELECT id, 'jackcarlsig16@gmail.com', 'Jack Carlson', 'owner' FROM public.businesses
ON CONFLICT (business_id, email) DO UPDATE SET role = 'owner', name = 'Jack Carlson';

-- With a role column, browser writes would let the publishable key promote
-- itself. The app only READS business_members from the browser (src/utils/db.js);
-- every write goes through the server (api/businesses/join.js, service key).
-- Read stays open until the Stage 5 lockdown.
DROP POLICY IF EXISTS anon_write_business_members  ON public.business_members;
DROP POLICY IF EXISTS anon_update_business_members ON public.business_members;
DROP POLICY IF EXISTS anon_delete_business_members ON public.business_members;

-- ============================================================================
-- workspace_invites - single-use, email-bound, 7-day links. Only a hash of
-- the token is stored; the raw token exists only in the copied link.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.workspace_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  email       text NOT NULL CHECK (email = lower(email)),
  role        text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '7 days',
  invited_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  accepted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workspace_invites_business_idx ON public.workspace_invites (business_id);

-- ============================================================================
-- auth_events - sign-in and membership audit log (replaces access_log in Stage 5)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.auth_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  event       text NOT NULL CHECK (event IN ('sign_in', 'sign_out', 'invite_created', 'invite_accepted', 'role_changed', 'member_removed')),
  business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  actor_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  ip_hash     text
);
CREATE INDEX IF NOT EXISTS auth_events_user_idx ON public.auth_events (user_id, at DESC);

-- ============================================================================
-- Helpers for RLS (Stage 5) and server checks (Stage 3). SECURITY DEFINER so
-- policies can call them without recursing through business_members' own RLS.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.role_rank(r text) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE r WHEN 'viewer' THEN 1 WHEN 'member' THEN 2 WHEN 'admin' THEN 3 WHEN 'owner' THEN 4 ELSE 0 END
$$;

CREATE OR REPLACE FUNCTION public.is_platform_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT is_platform_owner FROM public.profiles WHERE id = auth.uid()), false)
$$;

CREATE OR REPLACE FUNCTION public.is_member(bid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_platform_owner()
      OR EXISTS (SELECT 1 FROM public.business_members WHERE business_id = bid AND user_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.has_role(bid uuid, min_role text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_platform_owner()
      OR EXISTS (SELECT 1 FROM public.business_members
                 WHERE business_id = bid AND user_id = auth.uid()
                   AND public.role_rank(role) >= public.role_rank(min_role))
$$;

-- ============================================================================
-- On verified sign-up: create the profile and link any memberships already
-- waiting under that email. Only fires once the email is confirmed (Google
-- arrives confirmed; email+password after the confirmation link), so signing
-- up with someone else's address can't claim their memberships.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_verified_auth_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.email_confirmed_at IS NULL OR NEW.email IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    NEW.id,
    lower(NEW.email),
    coalesce(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), NULLIF(NEW.raw_user_meta_data->>'name', ''), split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  UPDATE public.business_members SET user_id = NEW.id
  WHERE user_id IS NULL AND lower(email) = lower(NEW.email);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_verified ON auth.users;
CREATE TRIGGER on_auth_user_verified
  AFTER INSERT OR UPDATE OF email_confirmed_at, email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_verified_auth_user();

-- ============================================================================
-- RLS on the new tables. Writes go through the server (service key) only.
-- ============================================================================
ALTER TABLE public.profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_events       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_read_own ON public.profiles;
CREATE POLICY profiles_read_own ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_platform_owner());

DROP POLICY IF EXISTS auth_events_read_own ON public.auth_events;
CREATE POLICY auth_events_read_own ON public.auth_events FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_owner());

-- workspace_invites: no policies on purpose - token lookups and acceptance are
-- server-side only, so the hash table is never readable from a browser.
