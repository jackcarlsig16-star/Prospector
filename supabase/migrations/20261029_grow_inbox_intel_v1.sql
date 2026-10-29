-- grow-inbox-intel-v1 REV3 Stage 1 (B4 + B3a + M2 + R1) - settings and suggested-domain storage for HumanKind Grow.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste the whole file -> Run. Re-runnable (IF NOT EXISTS).
--
-- hk_settings.intel: one jsonb for the B4 weights, the B3a target categories and the M2 research-sweep controls
-- (on / N / dollar cap / time). '{}' means "use the code defaults"; the server merges, never replaces.
-- hk_brands gains R1's suggested domain (domain_suggested + when + high | low confidence; never auto-used when low) and
-- research_attempted_at (set when research found nothing, so the sweep skips the brand inside its window). All NULL on
-- the existing rows. hk_settings and hk_brands keep their RLS as they are; nothing else changes.

ALTER TABLE public.hk_settings ADD COLUMN IF NOT EXISTS intel jsonb NOT NULL DEFAULT '{}';

ALTER TABLE public.hk_brands ADD COLUMN IF NOT EXISTS domain_suggested      text;
ALTER TABLE public.hk_brands ADD COLUMN IF NOT EXISTS domain_suggested_at   timestamptz;
ALTER TABLE public.hk_brands ADD COLUMN IF NOT EXISTS domain_confidence     text CHECK (domain_confidence IN ('high', 'low'));
ALTER TABLE public.hk_brands ADD COLUMN IF NOT EXISTS research_attempted_at timestamptz;

-- Proof - expect 3 rows:
--   "settings" hk_settings: intel jsonb not null default '{}'::jsonb · rows with intel = '{}': all (1 of 1 today)
--   "columns" hk_brands: domain_confidence,domain_suggested,domain_suggested_at,research_attempted_at (4 of 4)
--   "brands" hk_brands: all four NULL on every row = true
SELECT 'settings' AS kind, 'hk_settings' AS name,
       (SELECT data_type || ' ' || CASE WHEN is_nullable = 'NO' THEN 'not null' ELSE 'nullable' END || ' default ' || coalesce(column_default, 'none')
          FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hk_settings' AND column_name = 'intel') ||
       ' · rows with intel = ''{}'': ' || (SELECT count(*) FROM public.hk_settings WHERE intel = '{}'::jsonb) ||
       ' of ' || (SELECT count(*) FROM public.hk_settings) AS detail
UNION ALL
SELECT 'columns', 'hk_brands',
       (SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hk_brands' AND column_name IN ('domain_suggested', 'domain_suggested_at', 'domain_confidence', 'research_attempted_at')) ||
       ' (' || (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hk_brands' AND column_name IN ('domain_suggested', 'domain_suggested_at', 'domain_confidence', 'research_attempted_at')) || ' of 4)'
UNION ALL
SELECT 'brands', 'hk_brands',
       'all four NULL on every row = ' || (SELECT coalesce(bool_and(domain_suggested IS NULL AND domain_suggested_at IS NULL AND domain_confidence IS NULL AND research_attempted_at IS NULL), true) FROM public.hk_brands) ||
       ' (' || (SELECT count(*) FROM public.hk_brands) || ' rows, all workspaces)'
ORDER BY 1 DESC;
