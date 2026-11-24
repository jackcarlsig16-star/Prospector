-- fathom-notes-v1 REV 2 Stage 3, second file - Supabase SQL editor: paste -> Run. Idempotent. No existing row changes.
--
-- sales_flow_events.kind gains 'call_link' and 'call_unlink': the Activity line on a company when a call note is
-- mapped to it (F12 - the member's pick in the review or on the Calls tab, or the store-time domain match "linked by
-- domain") and when that mapping is taken off. The table's CHECK lists the kinds, so until this runs the line is
-- refused by the database and the mapping is not written.
-- Found while building the Stage 3 code - the first file (20261124_fathom_notes_v1_stage3.sql) did not carry it.
BEGIN;
ALTER TABLE public.sales_flow_events DROP CONSTRAINT IF EXISTS sales_flow_events_kind_check;
ALTER TABLE public.sales_flow_events ADD CONSTRAINT sales_flow_events_kind_check
  CHECK (kind IN ('deprioritize', 'bring_back', 'fit_set', 'assign', 'reply_move', 'meeting_move', 'they_replied', 'pin', 'pin_renew', 'unpin', 'restamp', 'call_link', 'call_unlink', 'undo'));
COMMIT;

-- Proof (expect):
--   1 check allows call_link + call_unlink  true
--   2 check keeps the twelve old kinds      true
--   3 rows outside the check                0
--   4 rows by kind                          (whatever is there - unchanged by this file)
SELECT 1 AS n, 'check allows call_link + call_unlink' AS what, (SELECT pg_get_constraintdef(c.oid) LIKE '%''call_link''%' AND pg_get_constraintdef(c.oid) LIKE '%''call_unlink''%' FROM pg_constraint c WHERE c.conname = 'sales_flow_events_kind_check' AND c.conrelid = 'public.sales_flow_events'::regclass)::text AS det
UNION ALL
SELECT 2, 'check keeps the twelve old kinds', (SELECT bool_and(pg_get_constraintdef(c.oid) LIKE '%''' || k || '''%') FROM pg_constraint c, unnest(ARRAY['deprioritize', 'bring_back', 'fit_set', 'assign', 'reply_move', 'meeting_move', 'they_replied', 'pin', 'pin_renew', 'unpin', 'restamp', 'undo']) k WHERE c.conname = 'sales_flow_events_kind_check' AND c.conrelid = 'public.sales_flow_events'::regclass)::text
UNION ALL
SELECT 3, 'rows outside the check', (SELECT count(*) FROM public.sales_flow_events WHERE kind NOT IN ('deprioritize', 'bring_back', 'fit_set', 'assign', 'reply_move', 'meeting_move', 'they_replied', 'pin', 'pin_renew', 'unpin', 'restamp', 'call_link', 'call_unlink', 'undo'))::text
UNION ALL
SELECT 4, 'rows by kind', (SELECT coalesce(string_agg(k || ' ' || n, ' · ' ORDER BY n DESC, k), 'none') FROM (SELECT kind AS k, count(*) AS n FROM public.sales_flow_events GROUP BY 1) t)
ORDER BY n;
