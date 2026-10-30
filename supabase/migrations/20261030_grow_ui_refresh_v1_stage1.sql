-- grow-ui-refresh-v1 REV2 Stage 1 (Oct 30 2026) - Supabase SQL editor: paste -> Run. Idempotent. No existing value changes.
--
-- hk_brands.snoozed_until     NEW. timestamptz, NULL. Snooze (S, J7): out of Send these 10 until this time (14 days).
-- hk_brands.pass_reason       NEW. text, NULL, <= 200 chars. Not a fit (X, J3): the reason kept with status passed.
-- hk_brands.research_context  NEW. text, NULL, <= 300 chars. "Add context for this brand" (U8), scrubbed server-side,
--                             sent with the next research.
-- All three written with the service key only; existing rows stay NULL; RLS, grants, other columns as before.
ALTER TABLE public.hk_brands ADD COLUMN IF NOT EXISTS snoozed_until timestamptz NULL;
ALTER TABLE public.hk_brands ADD COLUMN IF NOT EXISTS pass_reason text NULL;
ALTER TABLE public.hk_brands ADD COLUMN IF NOT EXISTS research_context text NULL;
ALTER TABLE public.hk_brands DROP CONSTRAINT IF EXISTS hk_brands_pass_reason_len;
ALTER TABLE public.hk_brands ADD CONSTRAINT hk_brands_pass_reason_len CHECK (pass_reason IS NULL OR char_length(pass_reason) <= 200);
ALTER TABLE public.hk_brands DROP CONSTRAINT IF EXISTS hk_brands_research_context_len;
ALTER TABLE public.hk_brands ADD CONSTRAINT hk_brands_research_context_len CHECK (research_context IS NULL OR char_length(research_context) <= 300);

-- Proof (expect):
--   1 snoozed_until     timestamp with time zone, nullable=YES
--   2 pass_reason       text, nullable=YES
--   3 research_context  text, nullable=YES
--   4 checks            hk_brands_pass_reason_len, hk_brands_research_context_len
--   5 rows              n rows, n with all three NULL
SELECT 1 AS n, 'snoozed_until' AS what, coalesce((SELECT data_type || ', nullable=' || is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hk_brands' AND column_name = 'snoozed_until'), 'MISSING') AS detail
UNION ALL
SELECT 2, 'pass_reason', coalesce((SELECT data_type || ', nullable=' || is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hk_brands' AND column_name = 'pass_reason'), 'MISSING')
UNION ALL
SELECT 3, 'research_context', coalesce((SELECT data_type || ', nullable=' || is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hk_brands' AND column_name = 'research_context'), 'MISSING')
UNION ALL
SELECT 4, 'checks', coalesce((SELECT string_agg(conname, ', ' ORDER BY conname) FROM pg_constraint WHERE conrelid = 'public.hk_brands'::regclass AND conname IN ('hk_brands_pass_reason_len', 'hk_brands_research_context_len')), 'MISSING')
UNION ALL
SELECT 5, 'rows', (SELECT count(*) || ' rows, ' || count(*) FILTER (WHERE snoozed_until IS NULL AND pass_reason IS NULL AND research_context IS NULL) || ' with all three NULL' FROM public.hk_brands)
ORDER BY n;
