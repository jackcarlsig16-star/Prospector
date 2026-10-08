-- partner-360-v1 Stage 2 - a partner's web domains, the key that links it to
-- Apollo accounts (and later to Outlook mail).
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- One row per domain per partner (goal). A partner can have several
-- (.ai / .io style); is_primary marks the one the Apollo CSV exports.
-- Suggestions (parsed from the sheet's sources text, or Apollo's account
-- name / domain) are computed live by the API and are NOT stored - a row
-- lands only when someone confirms (confirmed = true), adds one by hand
-- (source 'manual', confirmed), or dismisses a suggestion (confirmed =
-- false, so it stops being offered). Only confirmed rows are used for
-- matching. sales_goals.company_domain stays untouched (Jack, 2026-10-07).
--
-- RLS enabled, ZERO policies - same posture as every other sales_* table:
-- all reads and writes go through Express routes with SUPABASE_SERVICE_KEY.

CREATE TABLE IF NOT EXISTS public.partner_domains (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  goal_id      uuid NOT NULL REFERENCES public.sales_goals(id) ON DELETE CASCADE,
  domain       text NOT NULL CHECK (domain = lower(domain) AND domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' AND length(domain) <= 253),
  is_primary   boolean NOT NULL DEFAULT false,
  source       text NOT NULL CHECK (source IN ('manual', 'sources', 'apollo')),
  confirmed    boolean NOT NULL DEFAULT true,
  created_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One row per domain per partner, whatever the source.
CREATE UNIQUE INDEX IF NOT EXISTS partner_domains_goal_domain_idx ON public.partner_domains (goal_id, domain);
-- At most one primary per partner.
CREATE UNIQUE INDEX IF NOT EXISTS partner_domains_primary_idx ON public.partner_domains (goal_id) WHERE is_primary;
-- Matching reads every confirmed domain in a workspace.
CREATE INDEX IF NOT EXISTS partner_domains_business_idx ON public.partner_domains (business_id, confirmed);

ALTER TABLE public.partner_domains ENABLE ROW LEVEL SECURITY;

-- Check: table exists with 9 columns, rls on, 0 policies, 3 indexes besides the pk
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'partner_domains') AS columns,
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'partner_domains') AS rls_on,
  (SELECT count(*) FROM pg_policies WHERE tablename = 'partner_domains') AS policies,
  (SELECT count(*) FROM pg_indexes WHERE tablename = 'partner_domains' AND indexname <> 'partner_domains_pkey') AS indexes;
