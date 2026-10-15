-- master-pipeline-import-v1 REV3 Stage 1 - record ids, employer side lanes, tier.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- record_id: the master sheet's stable Record ID (HLU-0001...), so a re-import
-- matches by id instead of by name. Unique per workspace where set.
-- sales_opportunities.stage gains the side lanes 'nurture' and 'on_hold'
-- (like 'lost': off the linear path, probability 0 in app code). The original
-- stage CHECK (20261001_sales_pipeline_v1.sql) was declared inline with no
-- name, so it is found by its definition, dropped, and re-added as
-- sales_opportunities_stage_check. Re-running this file is safe.
-- tier: the sheet's Priority Tier for employers. apollo_account_id: stored
-- for later specs, nothing reads it yet.

ALTER TABLE public.sales_goals         ADD COLUMN IF NOT EXISTS record_id text;
ALTER TABLE public.sales_opportunities ADD COLUMN IF NOT EXISTS record_id text;
ALTER TABLE public.sales_targets       ADD COLUMN IF NOT EXISTS record_id text;

CREATE UNIQUE INDEX IF NOT EXISTS sales_goals_business_record_id_idx
  ON public.sales_goals (business_id, record_id) WHERE record_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sales_opportunities_business_record_id_idx
  ON public.sales_opportunities (business_id, record_id) WHERE record_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sales_targets_business_record_id_idx
  ON public.sales_targets (business_id, record_id) WHERE record_id IS NOT NULL;

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.sales_opportunities'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ~ '\mstage\M'
      AND pg_get_constraintdef(oid) LIKE '%''proposal_pilot''%'
  LOOP
    EXECUTE format('ALTER TABLE public.sales_opportunities DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.sales_opportunities ADD CONSTRAINT sales_opportunities_stage_check CHECK (stage IN (
  'target', 'contacted', 'responded', 'meeting', 'proposal_pilot', 'verbal', 'contract', 'launched',
  'lost', 'nurture', 'on_hold'
));

ALTER TABLE public.sales_opportunities
  ADD COLUMN IF NOT EXISTS tier text,
  ADD COLUMN IF NOT EXISTS apollo_account_id text;
ALTER TABLE public.sales_opportunities DROP CONSTRAINT IF EXISTS sales_opportunities_tier_check;
ALTER TABLE public.sales_opportunities ADD CONSTRAINT sales_opportunities_tier_check
  CHECK (tier IS NULL OR tier IN ('1', '2', '3', '4'));

-- Check: 11 rows -
--   sales_goals          record_id                                  text
--   sales_goals          index sales_goals_business_record_id_idx
--   sales_opportunities  apollo_account_id                          text
--   sales_opportunities  record_id                                  text
--   sales_opportunities  stage checks on the table                  1
--   sales_opportunities  stage check allows nurture + on_hold       true
--   sales_opportunities  tier                                       text
--   sales_opportunities  index sales_opportunities_business_record_id_idx
--   sales_opportunities  tier check named                           true
--   sales_targets        record_id                                  text
--   sales_targets        index sales_targets_business_record_id_idx
SELECT table_name AS tbl, column_name AS item, data_type AS detail FROM information_schema.columns
  WHERE table_schema = 'public' AND (
    (table_name IN ('sales_goals', 'sales_opportunities', 'sales_targets') AND column_name = 'record_id')
    OR (table_name = 'sales_opportunities' AND column_name IN ('tier', 'apollo_account_id')))
UNION ALL
SELECT tablename, 'index ' || indexname, '' FROM pg_indexes
  WHERE schemaname = 'public' AND indexname IN ('sales_goals_business_record_id_idx',
    'sales_opportunities_business_record_id_idx', 'sales_targets_business_record_id_idx')
UNION ALL
SELECT 'sales_opportunities', 'stage checks on the table', count(*)::text FROM pg_constraint
  WHERE conrelid = 'public.sales_opportunities'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) ~ '\mstage\M' AND pg_get_constraintdef(oid) LIKE '%''proposal_pilot''%'
UNION ALL
SELECT 'sales_opportunities', 'stage check allows nurture + on_hold',
  (pg_get_constraintdef(oid) LIKE '%''nurture''%' AND pg_get_constraintdef(oid) LIKE '%''on_hold''%')::text
  FROM pg_constraint WHERE conname = 'sales_opportunities_stage_check'
UNION ALL
SELECT 'sales_opportunities', 'tier check named', 'true'
  FROM pg_constraint WHERE conname = 'sales_opportunities_tier_check'
ORDER BY 1, 2;
