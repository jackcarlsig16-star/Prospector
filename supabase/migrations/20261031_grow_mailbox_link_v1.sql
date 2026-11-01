-- grow-mailbox-link-v1 Stage 1 (Oct 31 2026) - Supabase SQL editor: paste -> Run. Idempotent. No existing row changes.
--
-- hk_brand_threads   NEW. One row per Gmail thread linked to a brand, per member mailbox (L3). Derived fields only:
--                    no subject, body, snippet, address or phone is ever stored. Service key only (RLS on, 0 policies,
--                    revoked from anon / authenticated - like every hk_ table).
--   matched_by       domain | contact | name (L1) | suggested_domain (ruling 2: high-confidence domain_suggested, no
--                    auto-actions until the domain is saved) | manual (L7 "Link to brand…").
--   link_state       linked | review | not_this_brand. Name-only matches start at 'review' and never drive an
--                    auto-action (ruling 1); Review > Email links sets 'linked' or 'not_this_brand' (kept, so the
--                    matcher never re-adds a rejected link).
--   waiting_on       them | us | none · deal_stage interested | discussing | confirmed | declined | scheduling | other
--   deal_month       'YYYY-MM' · summary <= 160 chars, derived words only.
-- hk_settings.read_deal_emails        NEW boolean, default true - Settings > Pitch "Read deal emails" (L5).
-- hk_member_prefs.share_deal_status   NEW boolean, default true - "Share my deal status with the team"; false = others
--                                     see existence + founder + date only (L5).
-- The backfill cursor and the one-time $3.00 first-read allowance live on hk_job_runs (counts / job), no column here.

CREATE TABLE IF NOT EXISTS public.hk_brand_threads (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  brand_id           uuid NOT NULL REFERENCES public.hk_brands(id) ON DELETE CASCADE,
  member_user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  gmail_thread_id    text NOT NULL CHECK (length(gmail_thread_id) BETWEEN 1 AND 64),
  matched_by         text NOT NULL CHECK (matched_by IN ('domain', 'contact', 'name', 'suggested_domain', 'manual')),
  link_state         text NOT NULL DEFAULT 'linked' CHECK (link_state IN ('linked', 'review', 'not_this_brand')),
  message_count      int  NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  first_at           timestamptz,
  last_at            timestamptz,
  last_ours_at       timestamptz,
  last_theirs_at     timestamptz,
  waiting_on         text NOT NULL DEFAULT 'none' CHECK (waiting_on IN ('them', 'us', 'none')),
  deal_stage         text NULL CHECK (deal_stage IN ('interested', 'discussing', 'confirmed', 'declined', 'scheduling', 'other')),
  deal_month         text NULL CHECK (deal_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  deal_amount_usd    numeric NULL CHECK (deal_amount_usd >= 0),
  our_question_open  boolean NOT NULL DEFAULT false,
  summary            text NULL CHECK (length(summary) <= 160),
  read_at            timestamptz,
  read_message_count int NULL CHECK (read_message_count >= 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hk_brand_threads_once UNIQUE (business_id, member_user_id, gmail_thread_id)
);
CREATE INDEX IF NOT EXISTS hk_brand_threads_brand ON public.hk_brand_threads (business_id, brand_id, last_at DESC);
CREATE INDEX IF NOT EXISTS hk_brand_threads_member ON public.hk_brand_threads (business_id, member_user_id, last_at DESC);
ALTER TABLE public.hk_brand_threads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hk_brand_threads FROM anon, authenticated;

ALTER TABLE public.hk_settings     ADD COLUMN IF NOT EXISTS read_deal_emails  boolean NOT NULL DEFAULT true;
ALTER TABLE public.hk_member_prefs ADD COLUMN IF NOT EXISTS share_deal_status boolean NOT NULL DEFAULT true;

-- Proof (expect 5 rows):
--   1 table     rls=true · policies=0 · rows=0 · anon_select=false · auth_select=false
--   2 columns   22
--   3 unique    hk_brand_threads_once (business_id, member_user_id, gmail_thread_id)
--   4 settings  read_deal_emails boolean default true · rows true=1
--   5 prefs     share_deal_status boolean default true · rows false=0
SELECT 1 AS n, 'table' AS what,
       'rls=' || c.relrowsecurity || ' · policies=' || (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'hk_brand_threads')
       || ' · rows=' || (SELECT count(*) FROM public.hk_brand_threads)
       || ' · anon_select=' || has_table_privilege('anon', 'public.hk_brand_threads', 'SELECT')
       || ' · auth_select=' || has_table_privilege('authenticated', 'public.hk_brand_threads', 'SELECT') AS detail
FROM pg_class c WHERE c.oid = 'public.hk_brand_threads'::regclass
UNION ALL
SELECT 2, 'columns', count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hk_brand_threads'
UNION ALL
SELECT 3, 'unique', coalesce((SELECT conname || ' ' || pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'hk_brand_threads_once'), 'MISSING')
UNION ALL
SELECT 4, 'settings', coalesce((SELECT 'read_deal_emails ' || data_type || ' default ' || column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hk_settings' AND column_name = 'read_deal_emails'), 'MISSING')
       || ' · rows true=' || (SELECT count(*) FROM public.hk_settings WHERE read_deal_emails)
UNION ALL
SELECT 5, 'prefs', coalesce((SELECT 'share_deal_status ' || data_type || ' default ' || column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hk_member_prefs' AND column_name = 'share_deal_status'), 'MISSING')
       || ' · rows false=' || (SELECT count(*) FROM public.hk_member_prefs WHERE NOT share_deal_status)
ORDER BY n;
