-- top-targets-v1 Stage 1, second file - Supabase SQL editor: paste -> Run. Idempotent. No existing row changes.
--
-- sales_flow_events.kind gains 'pin', 'pin_renew' and 'unpin': the Activity + Undo rows of a pin on an employer or a
-- target (a partner's pin is the 'hot' partner event, already allowed). The table's CHECK lists the kinds, so until
-- this runs a Pin / Renew / Unpin on an employer or target is refused by the database and nothing is written.
-- Found while building Stage 1 - the first file (pin columns + backfill) did not need it.
ALTER TABLE public.sales_flow_events DROP CONSTRAINT IF EXISTS sales_flow_events_kind_check;
ALTER TABLE public.sales_flow_events ADD CONSTRAINT sales_flow_events_kind_check
  CHECK (kind IN ('deprioritize', 'bring_back', 'fit_set', 'assign', 'reply_move', 'meeting_move', 'they_replied', 'pin', 'pin_renew', 'unpin', 'undo'));

-- Proof (expect):
--   1 check allows the three pin kinds     true
--   2 check keeps the eight old kinds      true
--   3 rows outside the check               0
--   4 rows by kind                         (whatever is there - unchanged by this file)
SELECT 1 AS n, 'check allows the three pin kinds' AS what, (SELECT bool_and(pg_get_constraintdef(c.oid) LIKE '%''' || k || '''%') FROM pg_constraint c, unnest(ARRAY['pin', 'pin_renew', 'unpin']) k WHERE c.conname = 'sales_flow_events_kind_check' AND c.conrelid = 'public.sales_flow_events'::regclass)::text AS det
UNION ALL
SELECT 2, 'check keeps the eight old kinds', (SELECT bool_and(pg_get_constraintdef(c.oid) LIKE '%''' || k || '''%') FROM pg_constraint c, unnest(ARRAY['deprioritize', 'bring_back', 'fit_set', 'assign', 'reply_move', 'meeting_move', 'they_replied', 'undo']) k WHERE c.conname = 'sales_flow_events_kind_check' AND c.conrelid = 'public.sales_flow_events'::regclass)::text
UNION ALL
SELECT 3, 'rows outside the check', (SELECT count(*) FROM public.sales_flow_events WHERE kind NOT IN ('deprioritize', 'bring_back', 'fit_set', 'assign', 'reply_move', 'meeting_move', 'they_replied', 'pin', 'pin_renew', 'unpin', 'undo'))::text
UNION ALL
SELECT 4, 'rows by kind', (SELECT coalesce(string_agg(k || ' ' || n, ' · ' ORDER BY n DESC, k), 'none') FROM (SELECT kind AS k, count(*) AS n FROM public.sales_flow_events GROUP BY 1) t)
ORDER BY n;
