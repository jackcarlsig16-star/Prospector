-- grow-signals-v1 Stage 1 (G1 + G3 + G7) - the signal log and per-brand heat for HumanKind Grow.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste the whole file -> Run. Re-runnable (IF NOT EXISTS).
--
-- hk_signals: one row per thing that happened (a reply, an overdue wait, research, a meeting, a + Target ...). Unique
-- (business_id, kind, ref_type, ref_id) so a re-run of any writer or the backfill never duplicates. brand_id is null
-- only for a sender not yet tracked as a brand (domain set instead); when it becomes a brand its signals move onto it.
-- detail is plain words <= 200, never an address or phone (checked in code). Dismiss / seen / acted are timestamps:
-- nothing is deleted. RLS ENABLED with NO policies; anon + authenticated revoked - server only, service key.
-- hk_brands gains heat (int, the decayed sum - prospect brands only), heat_band, heat_at, and the Targets list
-- (targeted_at / targeted_by). The 952 existing brands start at heat 0 / cold until Stage 2's backfill.

CREATE TABLE IF NOT EXISTS public.hk_signals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  brand_id      uuid REFERENCES public.hk_brands(id) ON DELETE CASCADE,
  domain        text CHECK (domain IS NULL OR length(domain) BETWEEN 3 AND 253),
  kind          text NOT NULL CHECK (kind IN ('reply_interest', 'reply_pricing', 'reply_referral', 'reply_other', 'reply_decline', 'new_person_sender', 'sender_is_candidate', 'research_strong_fit', 'research_possible', 'warm_thread_found', 'follow_up_due', 'waiting_overdue', 'meeting_set', 'sponsor_renewal_due', 'sponsor_lapsed', 'targeted_by_user')),
  points        int NOT NULL CHECK (points BETWEEN -100 AND 100),
  occurred_at   timestamptz NOT NULL,
  source        text NOT NULL CHECK (source IN ('sync', 'daily_check', 'research', 'inbox_open', 'user', 'import')),
  ref_type      text NOT NULL CHECK (length(ref_type) BETWEEN 1 AND 40),
  ref_id        text NOT NULL CHECK (length(ref_id) BETWEEN 1 AND 200),
  detail        text CHECK (detail IS NULL OR length(detail) <= 200),
  owner_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  seen_at       timestamptz,
  dismissed_at  timestamptz,
  acted_at      timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (brand_id IS NOT NULL OR domain IS NOT NULL),
  UNIQUE (business_id, kind, ref_type, ref_id)
);
CREATE INDEX IF NOT EXISTS hk_signals_brand_idx    ON public.hk_signals (business_id, brand_id);
CREATE INDEX IF NOT EXISTS hk_signals_domain_idx   ON public.hk_signals (business_id, domain) WHERE brand_id IS NULL;
CREATE INDEX IF NOT EXISTS hk_signals_occurred_idx ON public.hk_signals (business_id, occurred_at DESC);

ALTER TABLE public.hk_brands ADD COLUMN IF NOT EXISTS heat        int NOT NULL DEFAULT 0 CHECK (heat >= 0);
ALTER TABLE public.hk_brands ADD COLUMN IF NOT EXISTS heat_band   text NOT NULL DEFAULT 'cold' CHECK (heat_band IN ('hot', 'warm', 'cool', 'cold'));
ALTER TABLE public.hk_brands ADD COLUMN IF NOT EXISTS heat_at     timestamptz;
ALTER TABLE public.hk_brands ADD COLUMN IF NOT EXISTS targeted_at timestamptz;
ALTER TABLE public.hk_brands ADD COLUMN IF NOT EXISTS targeted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS hk_brands_business_heat_idx ON public.hk_brands (business_id, heat DESC);
CREATE INDEX IF NOT EXISTS hk_brands_targeted_idx      ON public.hk_brands (business_id, targeted_at) WHERE targeted_at IS NOT NULL;

ALTER TABLE public.hk_signals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hk_signals FROM anon, authenticated;

-- Proof - expect 3 rows:
--   "table" hk_signals: rls=true · policies=0 · rows=0 · anon_select=false · auth_select=false · columns=16
--   "columns" hk_brands: heat,heat_at,heat_band,targeted_at,targeted_by (5 of 5)
--   "brands" hk_brands: all at heat 0 / cold = true (952 live brands today)
SELECT 'table' AS kind, t.relname AS name,
       'rls=' || t.relrowsecurity ||
       ' · policies=' || (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t.relname) ||
       ' · rows=' || (SELECT count(*) FROM public.hk_signals) ||
       ' · anon_select=' || has_table_privilege('anon', t.oid, 'SELECT') ||
       ' · auth_select=' || has_table_privilege('authenticated', t.oid, 'SELECT') ||
       ' · columns=' || (SELECT count(*) FROM information_schema.columns ic WHERE ic.table_schema = 'public' AND ic.table_name = t.relname) AS detail
  FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace
 WHERE n.nspname = 'public' AND t.relkind = 'r' AND t.relname = 'hk_signals'
UNION ALL
SELECT 'columns', 'hk_brands',
       (SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hk_brands' AND column_name IN ('heat', 'heat_band', 'heat_at', 'targeted_at', 'targeted_by')) ||
       ' (' || (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hk_brands' AND column_name IN ('heat', 'heat_band', 'heat_at', 'targeted_at', 'targeted_by')) || ' of 5)'
UNION ALL
SELECT 'brands', 'hk_brands',
       'all at heat 0 / cold = ' || (SELECT bool_and(heat = 0 AND heat_band = 'cold') FROM public.hk_brands) ||
       ' (' || (SELECT count(*) FROM public.hk_brands WHERE archived_at IS NULL) || ' live, all workspaces)'
ORDER BY 1 DESC;
