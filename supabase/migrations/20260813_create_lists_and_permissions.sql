-- Prospector - Lists + member permissions (business-lists-and-permissions-v1)
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Generalizes per-business account grouping into real data (lists + grants)
-- instead of hardcoded per-business-name behavior. Nullable/backfill-safe -
-- accounts.list_id starts null for every existing row, same posture as
-- accounts.business_id in 20260813_add_business_id_to_accounts.sql. Same
-- permissive anon-RLS posture as every other table in this app - real
-- enforcement is app-level until Supabase Auth lands.

ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS access_code text;
UPDATE public.businesses SET access_code = upper(substr(md5(random()::text || id::text), 1, 8))
  WHERE access_code IS NULL;
ALTER TABLE public.businesses ALTER COLUMN access_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS businesses_access_code_idx ON public.businesses (access_code);

CREATE TABLE IF NOT EXISTS public.lists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lists_business_id_idx ON public.lists (business_id);

-- Joining members are identified by email, not a real auth account - no
-- users table exists anywhere in this app (owner_email on businesses is
-- the same pattern: a plain string identity, not an FK). email is always
-- stored lowercased by the app (same convention as owner_email throughout
-- db.js/api/businesses), so the unique index is a plain column pair -
-- keeps it upsert-compatible via onConflict: 'business_id,email'.
CREATE TABLE IF NOT EXISTS public.business_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  email       text NOT NULL,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS business_members_business_email_idx
  ON public.business_members (business_id, email);

CREATE TABLE IF NOT EXISTS public.member_list_permissions (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.business_members(id) ON DELETE CASCADE,
  list_id   uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  can_view  boolean NOT NULL DEFAULT false,
  can_edit  boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS member_list_permissions_member_list_idx
  ON public.member_list_permissions (member_id, list_id);

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS list_id uuid REFERENCES public.lists(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS accounts_list_id_idx ON public.accounts (list_id);

ALTER TABLE public.lists                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_members          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_list_permissions   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_read_lists   ON public.lists;
DROP POLICY IF EXISTS anon_write_lists  ON public.lists;
DROP POLICY IF EXISTS anon_update_lists ON public.lists;
DROP POLICY IF EXISTS anon_delete_lists ON public.lists;
CREATE POLICY anon_read_lists   ON public.lists FOR SELECT TO anon USING (true);
CREATE POLICY anon_write_lists  ON public.lists FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY anon_update_lists ON public.lists FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY anon_delete_lists ON public.lists FOR DELETE TO anon USING (true);

DROP POLICY IF EXISTS anon_read_business_members   ON public.business_members;
DROP POLICY IF EXISTS anon_write_business_members  ON public.business_members;
DROP POLICY IF EXISTS anon_update_business_members ON public.business_members;
DROP POLICY IF EXISTS anon_delete_business_members ON public.business_members;
CREATE POLICY anon_read_business_members   ON public.business_members FOR SELECT TO anon USING (true);
CREATE POLICY anon_write_business_members  ON public.business_members FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY anon_update_business_members ON public.business_members FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY anon_delete_business_members ON public.business_members FOR DELETE TO anon USING (true);

DROP POLICY IF EXISTS anon_read_member_list_permissions   ON public.member_list_permissions;
DROP POLICY IF EXISTS anon_write_member_list_permissions  ON public.member_list_permissions;
DROP POLICY IF EXISTS anon_update_member_list_permissions ON public.member_list_permissions;
DROP POLICY IF EXISTS anon_delete_member_list_permissions ON public.member_list_permissions;
CREATE POLICY anon_read_member_list_permissions   ON public.member_list_permissions FOR SELECT TO anon USING (true);
CREATE POLICY anon_write_member_list_permissions  ON public.member_list_permissions FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY anon_update_member_list_permissions ON public.member_list_permissions FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY anon_delete_member_list_permissions ON public.member_list_permissions FOR DELETE TO anon USING (true);
