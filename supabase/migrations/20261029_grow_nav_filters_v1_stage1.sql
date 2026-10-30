-- grow-nav-filters-v1 Stage 1 (Oct 29 2026) - Supabase SQL editor: paste -> Run. Idempotent. No existing value changes.
--
-- hk_member_prefs.saved_views  NEW. jsonb array, default []. A member's own saved views (N7): { id, name <= 40, space,
--                              filters, sort, layout }, <= 30 per member. Validated server-side by PUT /me/prefs (S3);
--                              written with the service key only. Deleting a view removes a preference, never a record.
-- hk_member_prefs.rail         NEW. jsonb object, default {}. Rail state (N2): collapsed buckets per space. Same route.
-- Existing rows get the defaults ([] and {}); nothing else on the table changes (RLS, grants, other columns as before).
ALTER TABLE public.hk_member_prefs ADD COLUMN IF NOT EXISTS saved_views jsonb NOT NULL DEFAULT '[]';
ALTER TABLE public.hk_member_prefs ADD COLUMN IF NOT EXISTS rail jsonb NOT NULL DEFAULT '{}';

-- Proof (expect):
--   1 saved_views  jsonb, nullable=NO, default '[]'::jsonb
--   2 rail         jsonb, nullable=NO, default '{}'::jsonb
--   3 rows         every existing member row: saved_views = [] and rail = {} (n rows, n defaults)
SELECT 1 AS n, 'saved_views' AS what, coalesce((SELECT data_type || ', nullable=' || is_nullable || ', default ' || column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hk_member_prefs' AND column_name = 'saved_views'), 'MISSING') AS detail
UNION ALL
SELECT 2, 'rail', coalesce((SELECT data_type || ', nullable=' || is_nullable || ', default ' || column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hk_member_prefs' AND column_name = 'rail'), 'MISSING')
UNION ALL
SELECT 3, 'rows', (SELECT count(*) || ' rows, ' || count(*) FILTER (WHERE saved_views = '[]'::jsonb AND rail = '{}'::jsonb) || ' at the defaults' FROM public.hk_member_prefs)
ORDER BY n;
