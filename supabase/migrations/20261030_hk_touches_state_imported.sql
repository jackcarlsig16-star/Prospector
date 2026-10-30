-- FIX hk-imported-drafts-noise Stage 1 (Oct 30 2026) - Supabase SQL editor: paste -> Run. Idempotent. No existing row changes.
--
-- hk_touches.state   CHECK gains 'imported': "the sheet said a draft existed" - a touch with no Gmail draft behind it
--                    (F2 moves the 101 id-less 'drafted' rows here in Stage 2, dry run first). Never counted or listed as
--                    a draft (F1/F4). The inline CHECK from data_foundation_v1.sql:91 is found by its definition, not by
--                    an assumed name, then re-added under the name hk_touches_state_check.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.hk_touches'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%state%'
  LOOP
    EXECUTE format('ALTER TABLE public.hk_touches DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.hk_touches ADD CONSTRAINT hk_touches_state_check CHECK (state IN ('drafted', 'sent', 'discarded', 'imported'));

-- Proof (expect):
--   1 check   hk_touches_state_check | CHECK ((state = ANY (ARRAY['drafted'::text, 'sent'::text, 'discarded'::text, 'imported'::text])))
--   2 states  the same per-state counts as before the run, imported=0
SELECT 1 AS n, 'check' AS what, coalesce((SELECT string_agg(conname || ' | ' || pg_get_constraintdef(oid), '; ') FROM pg_constraint WHERE conrelid = 'public.hk_touches'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%state%'), 'MISSING') AS detail
UNION ALL
SELECT 2, 'states', (SELECT string_agg(state || '=' || n, ' · ' ORDER BY state) FROM (SELECT state, count(*) AS n FROM public.hk_touches GROUP BY state) s) || ' · imported=' || (SELECT count(*) FROM public.hk_touches WHERE state = 'imported');
