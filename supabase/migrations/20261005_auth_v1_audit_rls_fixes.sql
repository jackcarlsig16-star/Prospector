-- prospector-auth-v1-audit FIX-7 (M3, L1, L2) - small RLS tightening.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run

-- M3: s5_update lets a Member set business_id = NULL with owner_email = self,
-- which moves a team account into their personal territory (gone from the
-- team, visible only to them). Signed-in users can no longer do that unless
-- they're an Admin of the workspace it leaves. Service-key writes (no
-- auth.uid()) are server code and pass.
CREATE OR REPLACE FUNCTION public.guard_account_leaving_workspace() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND OLD.business_id IS NOT NULL AND NEW.business_id IS NULL
     AND NOT public.has_role(OLD.business_id, 'admin') THEN
    RAISE EXCEPTION 'Only a workspace admin can move an account out of the workspace' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS accounts_guard_leaving_workspace ON public.accounts;
CREATE TRIGGER accounts_guard_leaving_workspace
  BEFORE UPDATE OF business_id ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_leaving_workspace();

-- L1: the RLS helpers are SECURITY DEFINER and were executable with the
-- public key (list_business_id returned any list's workspace id). Only
-- signed-in users' policies call them.
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.is_platform_owner()', 'public.is_member(uuid)', 'public.has_role(uuid, text)',
    'public.can_access_account_row(uuid, text, text)', 'public.can_access_account(text, text)',
    'public.list_business_id(uuid)', 'public.guard_account_leaving_workspace()'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;

-- L2: account_lists checked only the account, so a Member could attach their
-- account to another workspace's list. The list must be writable too.
DROP POLICY IF EXISTS s5_write ON public.account_lists;
CREATE POLICY s5_write ON public.account_lists FOR ALL TO authenticated
  USING (public.can_access_account(account_id, 'member'))
  WITH CHECK (public.can_access_account(account_id, 'member')
              AND public.has_role(public.list_business_id(list_id), 'member'));
