-- call-notes-to-tasks-v1 - business_anthropic_usage is server-only.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- It now carries user_id + cost_usd. Only the server writes it
-- (callAnthropic, service key - RLS doesn't apply), and nothing in the app
-- reads it from the browser, so every policy goes: RLS on + no policies =
-- no browser read or write. The 2026-08-13 policies may already have been
-- changed since, so this drops whatever is there by name from pg_policies.

ALTER TABLE public.business_anthropic_usage ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'business_anthropic_usage' LOOP
    EXECUTE format('DROP POLICY %I ON public.business_anthropic_usage', p.policyname);
  END LOOP;
END $$;

-- Check: 1 row - rls_on = true, policies = 0
SELECT c.relrowsecurity AS rls_on,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'business_anthropic_usage') AS policies
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'business_anthropic_usage';
