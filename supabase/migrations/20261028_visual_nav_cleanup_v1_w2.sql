-- visual-nav-cleanup-v1 W2 (Oct 28 2026) - Supabase SQL editor: paste -> Run. Idempotent. No existing row changes.
--
-- hk_member_prefs.last_seen_at  NEW. Stamped by GET /api/hk/:businessId/shell on every Grow load (one write per load per
--                               member, service key). Feeds the word-of-the-day "Check in with <founder>" nudge after 3
--                               days without a load. Read by the same route only; the column is nullable (never seen).
ALTER TABLE public.hk_member_prefs ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- Proof (expect):
--   1 column   hk_member_prefs.last_seen_at timestamptz, nullable
--   2 rows     the existing member rows, last_seen_at null until each next loads Grow
SELECT 1 AS n, 'column' AS what, coalesce((SELECT data_type || ', nullable=' || is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hk_member_prefs' AND column_name = 'last_seen_at'), 'MISSING') AS detail
UNION ALL
SELECT 2, 'rows', (SELECT count(*) || ' rows, ' || count(last_seen_at) || ' stamped' FROM public.hk_member_prefs)
ORDER BY n;
