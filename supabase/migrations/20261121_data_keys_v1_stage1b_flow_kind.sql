-- data-keys-v1 Stage 1, second file - Supabase SQL editor: paste -> Run. Idempotent. No existing row changes.
--
-- sales_flow_events.kind gains 'restamp': the Activity line a rename or a promote writes when its visit rows follow
-- the record (K10). The table's CHECK lists the kinds, so until this runs the line is refused by the database and
-- skipped - the rename / promote itself and the re-stamp of the visit rows already work.
-- Found while building the Stage 1 code - the first file (20261121_data_keys_v1_stage1.sql) did not carry it.
BEGIN;
ALTER TABLE public.sales_flow_events DROP CONSTRAINT IF EXISTS sales_flow_events_kind_check;
ALTER TABLE public.sales_flow_events ADD CONSTRAINT sales_flow_events_kind_check
  CHECK (kind IN ('deprioritize', 'bring_back', 'fit_set', 'assign', 'reply_move', 'meeting_move', 'they_replied', 'pin', 'pin_renew', 'unpin', 'restamp', 'undo'));
COMMIT;

-- Proof (expect):
--   1 check allows restamp                 true
--   2 check keeps the eleven old kinds     true
--   3 rows outside the check               0
--   4 rows by kind                         (whatever is there - unchanged by this file)
SELECT 1 AS n, 'check allows restamp' AS what, (SELECT pg_get_constraintdef(c.oid) LIKE '%''restamp''%' FROM pg_constraint c WHERE c.conname = 'sales_flow_events_kind_check' AND c.conrelid = 'public.sales_flow_events'::regclass)::text AS det
UNION ALL
SELECT 2, 'check keeps the eleven old kinds', (SELECT bool_and(pg_get_constraintdef(c.oid) LIKE '%''' || k || '''%') FROM pg_constraint c, unnest(ARRAY['deprioritize', 'bring_back', 'fit_set', 'assign', 'reply_move', 'meeting_move', 'they_replied', 'pin', 'pin_renew', 'unpin', 'undo']) k WHERE c.conname = 'sales_flow_events_kind_check' AND c.conrelid = 'public.sales_flow_events'::regclass)::text
UNION ALL
SELECT 3, 'rows outside the check', (SELECT count(*) FROM public.sales_flow_events WHERE kind NOT IN ('deprioritize', 'bring_back', 'fit_set', 'assign', 'reply_move', 'meeting_move', 'they_replied', 'pin', 'pin_renew', 'unpin', 'restamp', 'undo'))::text
UNION ALL
SELECT 4, 'rows by kind', (SELECT coalesce(string_agg(k || ' ' || n, ' · ' ORDER BY n DESC, k), 'none') FROM (SELECT kind AS k, count(*) AS n FROM public.sales_flow_events GROUP BY 1) t)
ORDER BY n;
