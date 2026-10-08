-- partner-360-v1 Stage 1 - people we know at a partner.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- One row per person per partner (goal). Stage 1 writes manual rows only
-- (the "+ Add person" form); the Apollo columns (apollo_contact_id,
-- last_activity_*) are here now so Stage 3's read-only Apollo sync needs no
-- second migration. Outlook (microsoft-connect-v1 Stage 3) writes the same
-- rows with source 'outlook'.
--
-- RLS enabled, ZERO policies - same posture as every other sales_* table:
-- all reads and writes go through Express routes with SUPABASE_SERVICE_KEY.
-- email lives in this table only (Jack, 2026-10-07): never in files, logs or
-- commits. No phone column, permanently (Apollo phone reveals cost credits).

CREATE TABLE IF NOT EXISTS public.partner_contacts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  goal_id            uuid NOT NULL REFERENCES public.sales_goals(id) ON DELETE CASCADE,
  apollo_contact_id  text,
  name               text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  title              text CHECK (title IS NULL OR length(title) <= 160),
  email              text CHECK (email IS NULL OR (length(email) <= 254 AND position('@' IN email) > 1)),
  linkedin_url       text CHECK (linkedin_url IS NULL OR linkedin_url ~* '^https?://([a-z0-9-]+\.)*linkedin\.com/'),
  source             text NOT NULL CHECK (source IN ('apollo', 'manual', 'outlook')),
  first_seen         timestamptz NOT NULL DEFAULT now(),
  last_activity_at   timestamptz,
  last_activity_type text CHECK (last_activity_type IS NULL OR last_activity_type IN ('sent', 'open', 'click', 'reply', 'bounce', 'unsub', 'call', 'meeting', 'linkedin', 'email', 'event', 'other')),
  created_by         uuid,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- A synced Apollo contact lands once per partner; re-syncs upsert on this.
CREATE UNIQUE INDEX IF NOT EXISTS partner_contacts_apollo_idx
  ON public.partner_contacts (goal_id, apollo_contact_id) WHERE apollo_contact_id IS NOT NULL;
-- One row per address per partner, whatever the source.
CREATE UNIQUE INDEX IF NOT EXISTS partner_contacts_email_idx
  ON public.partner_contacts (goal_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS partner_contacts_goal_idx ON public.partner_contacts (business_id, goal_id);

ALTER TABLE public.partner_contacts ENABLE ROW LEVEL SECURITY;

-- Check: table exists with 14 columns, rls on, 0 policies, 3 indexes besides the pk
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'partner_contacts') AS columns,
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'partner_contacts') AS rls_on,
  (SELECT count(*) FROM pg_policies WHERE tablename = 'partner_contacts') AS policies,
  (SELECT count(*) FROM pg_indexes WHERE tablename = 'partner_contacts' AND indexname <> 'partner_contacts_pkey') AS indexes;
