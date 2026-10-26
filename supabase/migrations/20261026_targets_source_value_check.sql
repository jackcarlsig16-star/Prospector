-- FIX targets-source-check-v1 - restore the value list on sales_targets.source that 20261022_lead_source_v1.sql
-- dropped by name (its loop re-created <table>_source_check as the source_kind shape on all three tables).
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Naming rule: <table>_source_check is the source_kind shape (lead-source-v1). Never reuse it.
-- Value lists on a column named source use <table>_source_value_check.
--
-- Same four values as 20261019_signals_v1_stage1.sql:56-57 (lead-upload writes 'manual', in the list). The three
-- migrations already run (20261019 / 20261022 / 20261026 lead_upload) stay as they ran.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.sales_targets WHERE source NOT IN ('note', 'scout', 'web_visit', 'manual')) THEN
    RAISE EXCEPTION 'sales_targets.source has values outside note|scout|web_visit|manual - fix rows first';
  END IF;
END $$;
ALTER TABLE public.sales_targets DROP CONSTRAINT IF EXISTS sales_targets_source_value_check;
ALTER TABLE public.sales_targets ADD CONSTRAINT sales_targets_source_value_check
  CHECK (source IN ('note', 'scout', 'web_visit', 'manual'));

-- Proof - expect 2 rows:
--   "value check"  sales_targets_source_value_check  (exactly this one name)
--   "source values"  note=47  (the shared project today; any other value would have raised above)
SELECT 'value check' AS kind,
       coalesce((SELECT string_agg(conname, ', ' ORDER BY conname) FROM pg_constraint
                  WHERE conrelid = 'public.sales_targets'::regclass AND contype = 'c'
                    AND pg_get_constraintdef(oid) ~ '\(source = ANY'), 'MISSING') AS detail
UNION ALL
SELECT 'source values',
       coalesce((SELECT string_agg(source || '=' || n, ' · ' ORDER BY source)
                   FROM (SELECT source, count(*) AS n FROM public.sales_targets GROUP BY source) s), 'no rows')
ORDER BY 1 DESC;
