-- prospector-auth-v1 Stage 5a - member-scoped policies for signed-in users.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Additive only: the old anon policies stay until 5b, so the deployed app
-- (anon data client) keeps working while the new build (session data client)
-- rolls out. Run 5a -> deploy -> run 5b.
--
-- Rules (platform owner passes everything via is_member/has_role):
--   read  = any member of the row's workspace (viewer and up)
--   write = member and up; workspace identity + list permissions = admin
--   accounts with no workspace = personal territory, owner_email only

CREATE OR REPLACE FUNCTION public.jwt_email() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

-- accounts: workspace rows by role, personal territory rows by owner.
CREATE OR REPLACE FUNCTION public.can_access_account_row(bid uuid, owner text, min_role text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN bid IS NULL THEN public.is_platform_owner() OR lower(coalesce(owner, '')) = public.jwt_email()
              ELSE public.has_role(bid, min_role) END
$$;

-- Child rows follow their account. SECURITY DEFINER so the lookup isn't
-- itself filtered by accounts' RLS.
CREATE OR REPLACE FUNCTION public.can_access_account(aid text, min_role text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_platform_owner() OR EXISTS (
    SELECT 1 FROM public.accounts a
    WHERE a.id = aid AND public.can_access_account_row(a.business_id, a.owner_email, min_role))
$$;

CREATE OR REPLACE FUNCTION public.list_business_id(lid uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT business_id FROM public.lists WHERE id = lid
$$;

-- accounts
DROP POLICY IF EXISTS s5_read ON public.accounts;
DROP POLICY IF EXISTS s5_insert ON public.accounts;
DROP POLICY IF EXISTS s5_update ON public.accounts;
DROP POLICY IF EXISTS s5_delete ON public.accounts;
CREATE POLICY s5_read   ON public.accounts FOR SELECT TO authenticated USING (public.can_access_account_row(business_id, owner_email, 'viewer'));
CREATE POLICY s5_insert ON public.accounts FOR INSERT TO authenticated WITH CHECK (public.can_access_account_row(business_id, owner_email, 'member'));
CREATE POLICY s5_update ON public.accounts FOR UPDATE TO authenticated USING (public.can_access_account_row(business_id, owner_email, 'member')) WITH CHECK (public.can_access_account_row(business_id, owner_email, 'member'));
CREATE POLICY s5_delete ON public.accounts FOR DELETE TO authenticated USING (public.can_access_account_row(business_id, owner_email, 'member'));

-- account child tables
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['account_business_details', 'account_influencer_details', 'account_lists'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS s5_read ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS s5_write ON public.%I', t);
    EXECUTE format('CREATE POLICY s5_read ON public.%I FOR SELECT TO authenticated USING (public.can_access_account(account_id, %L))', t, 'viewer');
    EXECUTE format('CREATE POLICY s5_write ON public.%I FOR ALL TO authenticated USING (public.can_access_account(account_id, %L)) WITH CHECK (public.can_access_account(account_id, %L))', t, 'member', 'member');
  END LOOP;
END $$;

-- workspace tables keyed by business_id
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['business_profiles', 'business_intel_entries', 'lists', 'projects', 'campaigns'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS s5_read ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS s5_write ON public.%I', t);
    EXECUTE format('CREATE POLICY s5_read ON public.%I FOR SELECT TO authenticated USING (public.is_member(business_id))', t);
    EXECUTE format('CREATE POLICY s5_write ON public.%I FOR ALL TO authenticated USING (public.has_role(business_id, %L)) WITH CHECK (public.has_role(business_id, %L))', t, 'member', 'member');
  END LOOP;
END $$;

-- businesses: read only from the browser; create/settings go through the server.
DROP POLICY IF EXISTS s5_read ON public.businesses;
CREATE POLICY s5_read ON public.businesses FOR SELECT TO authenticated USING (public.is_member(id));

-- business_members: your own rows, plus the workspace's admins. Writes are server-only.
DROP POLICY IF EXISTS s5_read ON public.business_members;
CREATE POLICY s5_read ON public.business_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(business_id, 'admin'));

-- member_list_permissions: follow the list's workspace; changing them is admin.
DROP POLICY IF EXISTS s5_read ON public.member_list_permissions;
DROP POLICY IF EXISTS s5_write ON public.member_list_permissions;
CREATE POLICY s5_read ON public.member_list_permissions FOR SELECT TO authenticated USING (public.is_member(public.list_business_id(list_id)));
CREATE POLICY s5_write ON public.member_list_permissions FOR ALL TO authenticated
  USING (public.has_role(public.list_business_id(list_id), 'admin'))
  WITH CHECK (public.has_role(public.list_business_id(list_id), 'admin'));

-- outreach_doctrine: platform-wide rules, everyone signed in reads them.
DROP POLICY IF EXISTS s5_read ON public.outreach_doctrine;
DROP POLICY IF EXISTS s5_write ON public.outreach_doctrine;
CREATE POLICY s5_read ON public.outreach_doctrine FOR SELECT TO authenticated USING (true);
CREATE POLICY s5_write ON public.outreach_doctrine FOR ALL TO authenticated USING (public.is_platform_owner()) WITH CHECK (public.is_platform_owner());

-- voice_profiles: your own voice only.
DROP POLICY IF EXISTS s5_own ON public.voice_profiles;
CREATE POLICY s5_own ON public.voice_profiles FOR ALL TO authenticated
  USING (lower(user_email) = public.jwt_email() OR public.is_platform_owner())
  WITH CHECK (lower(user_email) = public.jwt_email() OR public.is_platform_owner());

-- plospect_compliance: legacy territory tool, no owner column.
DROP POLICY IF EXISTS s5_owner ON public.plospect_compliance;
CREATE POLICY s5_owner ON public.plospect_compliance FOR ALL TO authenticated
  USING (public.is_platform_owner()) WITH CHECK (public.is_platform_owner());
