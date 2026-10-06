-- sales-partners-pipeline-v1 Stage 1 - partner pipeline fields + status events.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Partners stay sales_goals rows with goal_type 'partnership'. priority (P1-P3,
-- urgency) stays; tier is value. pipeline_status is separate from the goal's
-- own status column.
-- sales_partner_events is written only by the server (service key, through
-- applyPartnerSignal), so signed-in members read it and nobody writes it from
-- the browser. Anon: nothing.

ALTER TABLE public.sales_goals
  ADD COLUMN IF NOT EXISTS category        text,
  ADD COLUMN IF NOT EXISTS tier            text,
  ADD COLUMN IF NOT EXISTS partner_role    text,
  ADD COLUMN IF NOT EXISTS pipeline_status text,
  ADD COLUMN IF NOT EXISTS known_contacts  text,
  ADD COLUMN IF NOT EXISTS target_titles   text,
  ADD COLUMN IF NOT EXISTS sequence_to_use text,
  ADD COLUMN IF NOT EXISTS next_step       text,
  ADD COLUMN IF NOT EXISTS do_not_say      text,
  ADD COLUMN IF NOT EXISTS first_email_at  date,
  ADD COLUMN IF NOT EXISTS last_touch_at   timestamptz,
  ADD COLUMN IF NOT EXISTS hot             boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS snoozed_until   date;
DO $$ BEGIN
  ALTER TABLE public.sales_goals ADD CONSTRAINT sales_goals_tier_check
    CHECK (tier IS NULL OR tier IN ('1', '2', '3', '4', 'active'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.sales_goals ADD CONSTRAINT sales_goals_pipeline_status_check
    CHECK (pipeline_status IS NULL OR pipeline_status IN ('not_started', 'researching', 'first_email_drafted',
      'first_email_sent', 'in_sequence', 'replied', 'meeting_set', 'proposal_pilot', 'live', 'paused'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One row per button click or note: the partner history. meta carries what
-- undo needs that from/to_status can't (e.g. previous owner, previous hot).
CREATE TABLE IF NOT EXISTS public.sales_partner_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  goal_id     uuid NOT NULL REFERENCES public.sales_goals(id) ON DELETE CASCADE,
  event       text NOT NULL CHECK (event IN ('status', 'assign', 'hot', 'snooze', 'deprioritize', 'note', 'undo')),
  from_status text,
  to_status   text,
  note        text,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  by_user     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_partner_events_business_at_idx ON public.sales_partner_events (business_id, at);
CREATE INDEX IF NOT EXISTS sales_partner_events_goal_at_idx ON public.sales_partner_events (goal_id, at);

ALTER TABLE public.sales_partner_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS s5_read ON public.sales_partner_events;
CREATE POLICY s5_read ON public.sales_partner_events FOR SELECT TO authenticated USING (public.is_member(business_id));
REVOKE ALL ON public.sales_partner_events FROM anon;

-- Check: 13 new columns, events table with 1 policy
SELECT count(*) AS new_columns FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'sales_goals'
    AND column_name IN ('category', 'tier', 'partner_role', 'pipeline_status', 'known_contacts', 'target_titles',
      'sequence_to_use', 'next_step', 'do_not_say', 'first_email_at', 'last_touch_at', 'hot', 'snoozed_until');
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'sales_partner_events';
