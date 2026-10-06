-- sales-goals-v1 REVISION 4 Stage 3 - weekly report, scorecard, to-dos,
-- partners, companies. Adds to Stage 1 (ac298fe); REV3's sales_month_goals
-- and sales_week_notes stay.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Same RLS as Stage 1: members read, Member and up write, anon nothing.
-- Exceptions: sales_mailbox_owners and sales_sequenced_accounts are written
-- by the server (sync / API with the service key), so signed-in users only
-- read them.

-- ── Week goals become commitments or to-dos ─────────────────────────────────
-- link_target: 'view:<report|this_week|partners|companies>' or 'section:s1'..'s14'.
-- metric_key: one of the scorecard metrics, for live progress on a commitment.
ALTER TABLE public.sales_week_goals
  ADD COLUMN IF NOT EXISTS kind         text NOT NULL DEFAULT 'todo',
  ADD COLUMN IF NOT EXISTS category     text,
  ADD COLUMN IF NOT EXISTS contacts     text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS link_target  text,
  ADD COLUMN IF NOT EXISTS metric_key   text,
  ADD COLUMN IF NOT EXISTS target_value numeric;
DO $$ BEGIN
  ALTER TABLE public.sales_week_goals ADD CONSTRAINT sales_week_goals_kind_check CHECK (kind IN ('commitment', 'todo'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.sales_week_goals ADD CONSTRAINT sales_week_goals_link_target_check
    CHECK (link_target IS NULL OR link_target ~ '^(view:(report|this_week|partners|companies)|section:s([1-9]|1[0-4]))$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.sales_week_goals ADD CONSTRAINT sales_week_goals_metric_key_check
    CHECK (metric_key IS NULL OR metric_key IN ('outbound_audience', 'total_in_sequence', 'sequences_running', 'meetings_set', 'open_rate'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- To-do steps (tick boxes).
CREATE TABLE IF NOT EXISTS public.sales_week_goal_steps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  goal_id     uuid NOT NULL REFERENCES public.sales_week_goals(id) ON DELETE CASCADE,
  text        text NOT NULL CHECK (length(trim(text)) > 0),
  done        boolean NOT NULL DEFAULT false,
  sort_order  int NOT NULL DEFAULT 0,
  done_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_week_goal_steps_goal_idx ON public.sales_week_goal_steps (goal_id);

-- ── Partners (sales_goals rows with goal_type 'partnership') ────────────────
-- first_email_note isn't in the REV4 column list; the seed file carries it
-- for 5 partners, so it gets a column rather than being dropped on import.
ALTER TABLE public.sales_goals
  ADD COLUMN IF NOT EXISTS meeting_status   text,
  ADD COLUMN IF NOT EXISTS champion         text,
  ADD COLUMN IF NOT EXISTS angle            text,
  ADD COLUMN IF NOT EXISTS motto            text,
  ADD COLUMN IF NOT EXISTS watch_outs       text,
  ADD COLUMN IF NOT EXISTS first_email      text,
  ADD COLUMN IF NOT EXISTS first_email_note text,
  ADD COLUMN IF NOT EXISTS sources          text;
DO $$ BEGIN
  ALTER TABLE public.sales_goals ADD CONSTRAINT sales_goals_priority_check CHECK (priority IS NULL OR priority BETWEEN 1 AND 3);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Scorecard goals (actuals are computed, never stored here) ───────────────
CREATE TABLE IF NOT EXISTS public.sales_metric_targets (
  business_id  uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  period       text NOT NULL CHECK (period IN ('week', 'month')),
  period_start date NOT NULL,
  metric_key   text NOT NULL CHECK (metric_key IN ('outbound_audience', 'total_in_sequence', 'sequences_running', 'meetings_set', 'open_rate')),
  goal         numeric CHECK (goal IS NULL OR goal >= 0),
  updated_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, period, period_start, metric_key),
  CHECK ((period = 'week' AND extract(isodow FROM period_start) = 1)
      OR (period = 'month' AND extract(day FROM period_start) = 1))
);

-- ── Planned cadences per future week ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sales_cadence_plan (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  week_start    date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  name          text NOT NULL CHECK (length(trim(name)) > 0),
  owner_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_cadence_plan_business_idx ON public.sales_cadence_plan (business_id, week_start);

-- ── Weekly report (Seif) ────────────────────────────────────────────────────
-- snapshot freezes scorecard actuals, KPI table and commitment progress on
-- finalize; a final week is read-only until reopened.
CREATE TABLE IF NOT EXISTS public.sales_week_report (
  business_id  uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  week_start   date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final')),
  snapshot     jsonb,
  finalized_at timestamptz,
  finalized_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reopened_at  timestamptz,
  reopened_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, week_start)
);

CREATE TABLE IF NOT EXISTS public.sales_week_report_sections (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  week_start  date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  section_key text NOT NULL CHECK (section_key ~ '^s([1-9]|1[0-4])$'),
  notes       text NOT NULL DEFAULT '',
  updated_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, week_start, section_key)
);

-- Seif section 2 status list, carried forward weekly. carried_from_id makes
-- carry-forward idempotent the same way as week goals.
CREATE TABLE IF NOT EXISTS public.sales_infra_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  week_start      date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  component       text NOT NULL CHECK (length(trim(component)) > 0),
  status          text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('completed', 'in_progress', 'blocked')),
  note            text,
  sort_order      int NOT NULL DEFAULT 0,
  carried_from_id uuid REFERENCES public.sales_infra_items(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_infra_items_business_idx ON public.sales_infra_items (business_id, week_start);
CREATE UNIQUE INDEX IF NOT EXISTS sales_infra_items_carry_once
  ON public.sales_infra_items (business_id, week_start, carried_from_id) WHERE carried_from_id IS NOT NULL;

-- ── Discovery additions (Stage 3, 2026-10-06) ───────────────────────────────
-- Which Apollo mailbox belongs to which member ("sequenced-by", scorecard
-- owner split). Mailbox addresses don't match sign-in emails, so the map is
-- explicit (Jack 2026-10-06: jack@homelover.ai = Jack, cyrus@ = Cyrus).
CREATE TABLE IF NOT EXISTS public.sales_mailbox_owners (
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  mailbox_email text NOT NULL CHECK (mailbox_email = lower(mailbox_email)),
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (business_id, mailbox_email)
);
INSERT INTO public.sales_mailbox_owners (business_id, mailbox_email, user_id)
SELECT m.business_id, v.mailbox, m.user_id
FROM (VALUES ('jack@homelover.ai', 'Jack Carlson'), ('cyrus@homelover.ai', 'Cyrus Radjoo')) AS v(mailbox, member_name)
JOIN public.business_members m
  ON m.business_id = 'bc69beab-effd-452d-9e81-fd652333bb95' AND m.name = v.member_name AND m.user_id IS NOT NULL
ON CONFLICT (business_id, mailbox_email) DO UPDATE SET user_id = EXCLUDED.user_id;

-- One row per Apollo account that entered a sequence: first step-1 send
-- (from emailer_messages/search, 0 credits). Apollo has no free headcount
-- field (re-confirmed 2026-10-06), so employees is typed in by a member and
-- the sync never overwrites it.
CREATE TABLE IF NOT EXISTS public.sales_sequenced_accounts (
  business_id          uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  account_id           text NOT NULL,
  name                 text,
  first_sequenced_at   timestamptz NOT NULL,
  week_start           date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  sequence_id          text,
  mailbox_email        text,
  employees            int CHECK (employees IS NULL OR employees >= 0),
  employees_updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  employees_updated_at timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, account_id)
);
CREATE INDEX IF NOT EXISTS sales_sequenced_accounts_week_idx ON public.sales_sequenced_accounts (business_id, week_start);

-- ── RLS ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_week_goal_steps', 'sales_metric_targets', 'sales_cadence_plan', 'sales_week_report',
                           'sales_week_report_sections', 'sales_infra_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS s5_read ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS s5_write ON public.%I', t);
    EXECUTE format('CREATE POLICY s5_read ON public.%I FOR SELECT TO authenticated USING (public.is_member(business_id))', t);
    EXECUTE format('CREATE POLICY s5_write ON public.%I FOR ALL TO authenticated USING (public.has_role(business_id, %L)) WITH CHECK (public.has_role(business_id, %L))', t, 'member', 'member');
  END LOOP;
  FOREACH t IN ARRAY ARRAY['sales_mailbox_owners', 'sales_sequenced_accounts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS s5_read ON public.%I', t);
    EXECUTE format('CREATE POLICY s5_read ON public.%I FOR SELECT TO authenticated USING (public.is_member(business_id))', t);
  END LOOP;
END $$;
