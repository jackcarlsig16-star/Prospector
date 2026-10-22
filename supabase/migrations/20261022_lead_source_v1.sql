-- lead-source-v1 Stage 1 - who / what originated each lead, kept apart from channel.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- channel (20261020_sales_ia_v2_stage1.sql) stays as it is: how a record ENTERED Prospector. The new source_* fields
-- say who ORIGINATED the lead - the attribution a channel partner gets credit for (D1). One primary source per company
-- (D2), the same nine columns on partners (sales_goals), employers (sales_opportunities) and targets (sales_targets):
--   source_kind        homelover_outreach | partner_referral | person_referral | campaign | website | scout | event |
--                      inbound | unknown; NULL = never set (the Stage 2 backfill and the create paths fill it, and a
--                      source a person set is never overwritten - source_set_at tells them apart)
--   source_partner_id  the referring channel partner (e.g. Upside)        -> sales_goals, on delete set null
--   source_person      that partner's rep or the person who referred it  (names only, never an address)
--   source_office      the partner's office / branch / region            (office-level reporting)
--   source_campaign_id an outreach campaign (seif-campaign-v1)           -> sales_outreach_campaigns, on delete set null
--   route_in           how we got in, free text (the master sheet's Route in; brokers stay here)
--   source_note, source_set_by, source_set_at
-- Partner exports never read route_in or source_note (free text).
-- sales_source_events (D4): every change, from_source -> to_source (the spec's from / to; "from" is reserved in SQL).
-- No backfill here: Stage 2's preview / apply writes the fields and one 'backfill' event per record.
-- RLS: the three tables keep their policies; sales_source_events gets s5_read like every Goals table and is
-- written by the API with the service key.
-- Re-runnable: IF NOT EXISTS / DROP ... IF EXISTS everywhere.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_goals', 'sales_opportunities', 'sales_targets'] LOOP
    EXECUTE format('ALTER TABLE public.%I
      ADD COLUMN IF NOT EXISTS source_kind        text,
      ADD COLUMN IF NOT EXISTS source_partner_id  uuid REFERENCES public.sales_goals(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS source_person      text,
      ADD COLUMN IF NOT EXISTS source_office      text,
      ADD COLUMN IF NOT EXISTS source_campaign_id uuid REFERENCES public.sales_outreach_campaigns(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS route_in           text,
      ADD COLUMN IF NOT EXISTS source_note        text,
      ADD COLUMN IF NOT EXISTS source_set_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS source_set_at      timestamptz', t);
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_source_check');
    EXECUTE format($c$ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
      (source_kind IS NULL OR source_kind IN ('homelover_outreach', 'partner_referral', 'person_referral', 'campaign', 'website', 'scout', 'event', 'inbound', 'unknown'))
      AND (source_person IS NULL OR length(source_person) <= 120)
      AND (source_office IS NULL OR length(source_office) <= 120)
      AND (route_in IS NULL OR length(route_in) <= 300)
      AND (source_note IS NULL OR length(source_note) <= 500))$c$, t, t || '_source_check');
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (business_id, source_partner_id) WHERE source_partner_id IS NOT NULL', t || '_source_partner_idx', t);
  END LOOP;
END $$;

-- A partner can't be its own source.
ALTER TABLE public.sales_goals DROP CONSTRAINT IF EXISTS sales_goals_source_not_self;
ALTER TABLE public.sales_goals ADD CONSTRAINT sales_goals_source_not_self CHECK (source_partner_id IS NULL OR source_partner_id <> id);

CREATE TABLE IF NOT EXISTS public.sales_source_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  record_type  text NOT NULL CHECK (record_type IN ('partner', 'employer', 'target')),
  record_id    uuid NOT NULL,
  from_source  jsonb,
  to_source    jsonb NOT NULL,
  reason       text NOT NULL CHECK (reason IN ('create', 'edit', 'backfill', 'promote', 'import')),
  by_user      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_source_events_record_idx
  ON public.sales_source_events (business_id, record_type, record_id, at DESC);

ALTER TABLE public.sales_source_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS s5_read ON public.sales_source_events;
CREATE POLICY s5_read ON public.sales_source_events FOR SELECT TO authenticated USING (public.is_member(business_id));
REVOKE ALL ON public.sales_source_events FROM anon;

-- Proof - expect:
--   sales_goals / sales_opportunities / sales_targets   9 source columns · source_check true · partner index true
--   sales_goals                                          source_not_self true
--   sales_source_events                                  rls true · policy s5_read SELECT (the only one) · 0 rows
SELECT t AS tbl,
       (SELECT count(*) FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = t
          AND c.column_name IN ('source_kind', 'source_partner_id', 'source_person', 'source_office', 'source_campaign_id', 'route_in', 'source_note', 'source_set_by', 'source_set_at'))::text AS source_columns,
       EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_source_check')::text AS source_check,
       EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = t || '_source_partner_idx')::text AS partner_index,
       CASE WHEN t = 'sales_goals' THEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_goals_source_not_self')::text END AS not_self
  FROM unnest(ARRAY['sales_goals', 'sales_opportunities', 'sales_targets']) AS t
UNION ALL
SELECT 'sales_source_events',
       'rls ' || (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sales_source_events'::regclass)::text,
       'policies ' || (SELECT string_agg(policyname || ' ' || cmd, ', ') FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sales_source_events'),
       'rows ' || (SELECT count(*) FROM public.sales_source_events)::text,
       NULL
ORDER BY 1;
