-- call-notes-targets-v1 REV3 Stage 1 - Intake: targets, ownership, any-source notes.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- sales_targets: a company named in notes that isn't a partner or an
-- employer yet (proposed -> researching -> accepted | rejected). A rejected
-- row stays as the "never again" memory, so the name is unique per
-- workspace whatever the status.
-- Ownership (owner_team / co_owner_name / no_double_touch) lives on partners
-- (sales_goals), employers (sales_opportunities - REV3, not
-- sales_sequenced_accounts) and targets. owner_team null = unset; 'upside'
-- is hard-named because it is the only joint partner today.
-- partner_contacts.role_in_notes: the person's role as the notes describe
-- it. Rows added from notes carry no email, so (goal_id, name) is their key
-- (checked 2026-10-14: 1 row without an email, no name collisions).
-- RLS: sales_targets gets s5_read like every Goals table; the API writes
-- with the service key. The other tables keep their policies.

CREATE TABLE IF NOT EXISTS public.sales_targets (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name               text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  kind               text NOT NULL CHECK (kind IN ('partner', 'employer')),
  status             text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'researching', 'accepted', 'rejected')),
  source_note_id     uuid REFERENCES public.sales_call_notes(id) ON DELETE SET NULL,
  evidence           text CHECK (evidence IS NULL OR length(evidence) <= 400),
  research_prompt    text,
  research_notes     text,
  promoted_goal_id   uuid REFERENCES public.sales_goals(id) ON DELETE SET NULL,
  suggested_category text,
  owner_team         text CHECK (owner_team IS NULL OR owner_team IN ('homelover', 'upside', 'both')),
  co_owner_name      text CHECK (co_owner_name IS NULL OR length(co_owner_name) <= 120),
  no_double_touch    boolean NOT NULL DEFAULT false,
  created_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_targets_business_name_idx
  ON public.sales_targets (business_id, lower(btrim(name)));

ALTER TABLE public.sales_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS s5_read ON public.sales_targets;
CREATE POLICY s5_read ON public.sales_targets FOR SELECT TO authenticated USING (public.is_member(business_id));
REVOKE ALL ON public.sales_targets FROM anon;

ALTER TABLE public.sales_call_notes
  ADD COLUMN IF NOT EXISTS source_type  text NOT NULL DEFAULT 'call'
    CHECK (source_type IN ('call', 'partner_update', 'email_thread', 'doc', 'other')),
  ADD COLUMN IF NOT EXISTS source_label text CHECK (source_label IS NULL OR length(source_label) <= 120);

ALTER TABLE public.sales_goals
  ADD COLUMN IF NOT EXISTS owner_team      text CHECK (owner_team IS NULL OR owner_team IN ('homelover', 'upside', 'both')),
  ADD COLUMN IF NOT EXISTS co_owner_name   text CHECK (co_owner_name IS NULL OR length(co_owner_name) <= 120),
  ADD COLUMN IF NOT EXISTS no_double_touch boolean NOT NULL DEFAULT false;

ALTER TABLE public.sales_opportunities
  ADD COLUMN IF NOT EXISTS owner_team      text CHECK (owner_team IS NULL OR owner_team IN ('homelover', 'upside', 'both')),
  ADD COLUMN IF NOT EXISTS co_owner_name   text CHECK (co_owner_name IS NULL OR length(co_owner_name) <= 120),
  ADD COLUMN IF NOT EXISTS no_double_touch boolean NOT NULL DEFAULT false;

ALTER TABLE public.sales_week_goals DROP CONSTRAINT IF EXISTS sales_week_goals_link_check;
ALTER TABLE public.sales_week_goals ADD CONSTRAINT sales_week_goals_link_check CHECK (
  (link_type IS NULL AND link_id IS NULL)
  OR (link_type IN ('commitment', 'metric', 'partner', 'company', 'target') AND length(trim(link_id)) > 0)
);

ALTER TABLE public.partner_contacts
  ADD COLUMN IF NOT EXISTS role_in_notes text
    CHECK (role_in_notes IS NULL OR role_in_notes IN ('champion', 'blocker', 'referrer', 'counterpart', 'other'));
CREATE UNIQUE INDEX IF NOT EXISTS partner_contacts_name_no_email_idx
  ON public.partner_contacts (goal_id, lower(btrim(name))) WHERE email IS NULL;

-- Check: 14 rows -
--   partner_contacts     role_in_notes                    text
--   partner_contacts     index partner_contacts_name_no_email_idx
--   sales_call_notes     source_label / source_type       text
--   sales_goals          co_owner_name / no_double_touch / owner_team
--   sales_opportunities  co_owner_name / no_double_touch / owner_team
--   sales_targets        (18 columns)
--   sales_targets        index sales_targets_business_name_idx
--   sales_targets        policy s5_read SELECT (the only policy)
--   sales_week_goals     link check allows target         true
SELECT table_name AS tbl, column_name AS item, data_type AS detail FROM information_schema.columns
  WHERE table_schema = 'public' AND (
    (table_name = 'sales_call_notes' AND column_name IN ('source_type', 'source_label'))
    OR (table_name IN ('sales_goals', 'sales_opportunities') AND column_name IN ('owner_team', 'co_owner_name', 'no_double_touch'))
    OR (table_name = 'partner_contacts' AND column_name = 'role_in_notes'))
UNION ALL
SELECT 'sales_targets', '(' || count(*) || ' columns)', '' FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'sales_targets'
UNION ALL
SELECT tablename, 'index ' || indexname, '' FROM pg_indexes
  WHERE schemaname = 'public' AND indexname IN ('sales_targets_business_name_idx', 'partner_contacts_name_no_email_idx')
UNION ALL
SELECT tablename, 'policy ' || policyname, cmd FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'sales_targets'
UNION ALL
SELECT 'sales_week_goals', 'link check allows target', (pg_get_constraintdef(oid) LIKE '%''target''%')::text
  FROM pg_constraint WHERE conname = 'sales_week_goals_link_check'
ORDER BY 1, 2;
