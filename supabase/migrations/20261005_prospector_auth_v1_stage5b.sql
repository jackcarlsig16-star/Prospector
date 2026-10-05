-- prospector-auth-v1 Stage 5b - lock out the public key + orphans.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
-- ONLY after 5a ran AND the Stage 5 build is live on Render.
--
-- Drops every policy granted to anon/public on the business-data tables, so
-- the publishable key alone reads and writes nothing. Signed-in users keep
-- the s5_* policies from 5a; the server uses the service key (bypasses RLS).
-- Tables left with no policy at all are server-only: business_anthropic_usage,
-- prospects, outreach_drafts, approved_users, team_users.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (ARRAY[
        'accounts', 'account_business_details', 'account_influencer_details', 'account_lists',
        'lists', 'member_list_permissions', 'businesses', 'business_profiles', 'business_members',
        'business_intel_entries', 'business_anthropic_usage', 'projects', 'campaigns',
        'outreach_doctrine', 'voice_profiles', 'plospect_compliance', 'prospects', 'outreach_drafts',
        'approved_users', 'team_users'])
      AND (roles && ARRAY['anon', 'public']::name[])
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

ALTER TABLE public.accounts                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_business_details   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_influencer_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_lists              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lists                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_list_permissions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.businesses                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_members           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_intel_entries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_anthropic_usage   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_doctrine          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_profiles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plospect_compliance        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospects                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_drafts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approved_users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_users                 ENABLE ROW LEVEL SECURITY;

-- Orphans (confirmed by Jack 2026-10-02). Ids are pinned so a re-run can't
-- touch anything else.
UPDATE public.projects SET business_id = '981b790c-a3b0-4265-b32e-1f701d5731ff'  -- HumanKind
WHERE id = 'd21f2e8c-31fd-416a-9cbd-7f513b675124' AND business_id IS NULL;

DELETE FROM public.projects
WHERE id IN ('7b80d2d8-df7c-4840-9d4f-6009f8eeb1d1', '885698ae-4413-412c-adad-15729594274f')
  AND name = 'test' AND business_id IS NULL;

DELETE FROM public.accounts WHERE id = 'test-nudge-acc-1' AND business_id IS NULL;
