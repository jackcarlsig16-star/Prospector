-- sales-goals-v1 REVISION 3 Stage 1 - Goals & Weekly Plan tables.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Workspace-scoped like every sales_* table. Unlike the Apollo sync tables
-- (server-only), these carry member-scoped RLS (prospector-auth-v1 Stage 5
-- standard): read = is_member, write = has_role 'member', nothing for anon.
-- The API (Stage 2) uses the service key and enforces the same roles.
-- Owners are workspace members (profiles), not free text, so the person
-- filter and member colors work.

-- Companies / Partnerships to Land.
CREATE TABLE IF NOT EXISTS public.sales_goals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  goal_type             text NOT NULL CHECK (goal_type IN ('company', 'partnership')),
  name                  text NOT NULL CHECK (length(trim(name)) > 0),
  status                text NOT NULL DEFAULT 'not_started'
                        CHECK (status IN ('not_started', 'in_progress', 'landed', 'paused', 'lost')),
  owner_user_id         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_date           date,
  priority              int,
  est_covered_lives     int CHECK (est_covered_lives IS NULL OR est_covered_lives >= 0),
  company_domain        text,
  notes                 text,
  linked_opportunity_id uuid REFERENCES public.sales_opportunities(id) ON DELETE SET NULL,
  landed_at             timestamptz,
  archived_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_goals_business_idx ON public.sales_goals (business_id, goal_type);

-- Monthly goals. month is always the 1st.
CREATE TABLE IF NOT EXISTS public.sales_month_goals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  month             date NOT NULL CHECK (extract(day FROM month) = 1),
  text              text NOT NULL CHECK (length(trim(text)) > 0),
  owner_user_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  measurable_target text,
  status            text NOT NULL DEFAULT 'not_started'
                    CHECK (status IN ('not_started', 'in_progress', 'done', 'dropped')),
  progress_note     text,
  sort_order        int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_month_goals_business_idx ON public.sales_month_goals (business_id, month);

-- Weekly goals. week_start is always a Monday (America/Los_Angeles week,
-- same helper as Sales Analytics).
CREATE TABLE IF NOT EXISTS public.sales_week_goals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  week_start        date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  text              text NOT NULL CHECK (length(trim(text)) > 0),
  owner_user_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  measurable_target text,
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dropped')),
  why_not_done      text,
  month_goal_id     uuid REFERENCES public.sales_month_goals(id) ON DELETE SET NULL,
  land_goal_id      uuid REFERENCES public.sales_goals(id) ON DELETE SET NULL,
  carried_from_id   uuid REFERENCES public.sales_week_goals(id) ON DELETE SET NULL,
  sort_order        int NOT NULL DEFAULT 0,
  completed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_week_goals_business_idx ON public.sales_week_goals (business_id, week_start);
-- "Carry over unfinished" is idempotent: a goal can be carried into a given
-- week once, so pressing the button twice inserts nothing the second time.
CREATE UNIQUE INDEX IF NOT EXISTS sales_week_goals_carry_once
  ON public.sales_week_goals (business_id, week_start, carried_from_id) WHERE carried_from_id IS NOT NULL;

-- "How the week went" - one note per workspace per week.
CREATE TABLE IF NOT EXISTS public.sales_week_notes (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  week_start  date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  recap       text NOT NULL DEFAULT '',
  updated_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, week_start)
);

-- RLS: members read, Member and up write, anon gets nothing.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_goals', 'sales_month_goals', 'sales_week_goals', 'sales_week_notes'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS s5_read ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS s5_write ON public.%I', t);
    EXECUTE format('CREATE POLICY s5_read ON public.%I FOR SELECT TO authenticated USING (public.is_member(business_id))', t);
    EXECUTE format('CREATE POLICY s5_write ON public.%I FOR ALL TO authenticated USING (public.has_role(business_id, %L)) WITH CHECK (public.has_role(business_id, %L))', t, 'member', 'member');
  END LOOP;
END $$;
