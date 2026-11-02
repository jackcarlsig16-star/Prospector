-- grow-sponsor-deals-v1 Stage 1 (S1 + S8 + ruling 2, Nov 2 2026) - Supabase SQL editor: paste -> Run. Idempotent.
-- No row values change: the 132 existing periods (all sheet-imported, 0 sponsor.period_added events) take the defaults
-- state 'confirmed' · paid false · source 'sheet' · archived_at NULL. The S3 re-import corrects the yellow rows later.
--
-- hk_sponsor_periods
--   state            confirmed | discussing | declined
--   amount_usd       dollars, NULL = not set (the money view shows "—")
--   paid / paid_at   paid_at only while paid
--   deal_type        the sheet's Type column, e.g. "Challenge / Reward"
--   details          the tab's deal columns by sheet column name (challenge, reward, code ...), an object <= 2 KB.
--                    Contact names, addresses and phones are never stored here.
--   source           sheet | user | email - an email (thread deal facts) only ever creates a row; it never changes a
--                    sheet or user row
--   state_changed_*  last state change
--   archived_*       ruling 2: a period is never deleted. The Sponsors-screen remove archives it (Undo clears both);
--                    archived rows are hidden from every read. UNIQUE (brand_id, period, kind) stays, so adding an
--                    archived month again un-archives that row.
-- hk_brands.instagram_handle  handle only, no URL and no @: a-z 0-9 . _, 1-30 characters.

ALTER TABLE public.hk_sponsor_periods
  ADD COLUMN IF NOT EXISTS state            text NOT NULL DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS amount_usd       numeric(10,2) NULL,
  ADD COLUMN IF NOT EXISTS paid             boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_at          timestamptz NULL,
  ADD COLUMN IF NOT EXISTS deal_type        text NULL,
  ADD COLUMN IF NOT EXISTS details          jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS source           text NOT NULL DEFAULT 'sheet',
  ADD COLUMN IF NOT EXISTS state_changed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS state_changed_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_at      timestamptz NULL,
  ADD COLUMN IF NOT EXISTS archived_by      uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.hk_sponsor_periods DROP CONSTRAINT IF EXISTS hk_sponsor_periods_state_check;
ALTER TABLE public.hk_sponsor_periods ADD CONSTRAINT hk_sponsor_periods_state_check CHECK (state IN ('confirmed', 'discussing', 'declined'));
ALTER TABLE public.hk_sponsor_periods DROP CONSTRAINT IF EXISTS hk_sponsor_periods_source_check;
ALTER TABLE public.hk_sponsor_periods ADD CONSTRAINT hk_sponsor_periods_source_check CHECK (source IN ('sheet', 'user', 'email'));
ALTER TABLE public.hk_sponsor_periods DROP CONSTRAINT IF EXISTS hk_sponsor_periods_amount_check;
ALTER TABLE public.hk_sponsor_periods ADD CONSTRAINT hk_sponsor_periods_amount_check CHECK (amount_usd IS NULL OR amount_usd >= 0);
ALTER TABLE public.hk_sponsor_periods DROP CONSTRAINT IF EXISTS hk_sponsor_periods_paid_at_check;
ALTER TABLE public.hk_sponsor_periods ADD CONSTRAINT hk_sponsor_periods_paid_at_check CHECK (paid OR paid_at IS NULL);
ALTER TABLE public.hk_sponsor_periods DROP CONSTRAINT IF EXISTS hk_sponsor_periods_details_check;
ALTER TABLE public.hk_sponsor_periods ADD CONSTRAINT hk_sponsor_periods_details_check CHECK (jsonb_typeof(details) = 'object' AND octet_length(details::text) <= 2048);
ALTER TABLE public.hk_sponsor_periods DROP CONSTRAINT IF EXISTS hk_sponsor_periods_archived_check;
ALTER TABLE public.hk_sponsor_periods ADD CONSTRAINT hk_sponsor_periods_archived_check CHECK (archived_at IS NOT NULL OR archived_by IS NULL);

CREATE INDEX IF NOT EXISTS hk_sponsor_periods_live_idx ON public.hk_sponsor_periods (business_id, period) WHERE archived_at IS NULL;

ALTER TABLE public.hk_brands ADD COLUMN IF NOT EXISTS instagram_handle text NULL;
ALTER TABLE public.hk_brands DROP CONSTRAINT IF EXISTS hk_brands_instagram_handle_check;
ALTER TABLE public.hk_brands ADD CONSTRAINT hk_brands_instagram_handle_check CHECK (instagram_handle IS NULL OR instagram_handle ~ '^[a-z0-9._]{1,30}$');

-- Proof 1 - expect 7 rows: hk_brands_instagram_handle_check + the 6 hk_sponsor_periods_*_check constraints above
-- (amount, archived, details, paid_at, source, state).
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conname IN ('hk_sponsor_periods_state_check', 'hk_sponsor_periods_source_check', 'hk_sponsor_periods_amount_check', 'hk_sponsor_periods_paid_at_check',
                  'hk_sponsor_periods_details_check', 'hk_sponsor_periods_archived_check', 'hk_brands_instagram_handle_check')
ORDER BY conname;

-- Proof 2 - expect 1 row: 132 | 132 | 132 | 0 | 0 | 0 (every existing period confirmed, from the sheet, live, unpaid, no amount, no handle set).
SELECT count(*) AS periods,
       count(*) FILTER (WHERE state = 'confirmed' AND source = 'sheet') AS confirmed_sheet,
       count(*) FILTER (WHERE archived_at IS NULL) AS live,
       count(*) FILTER (WHERE paid) AS paid,
       count(*) FILTER (WHERE amount_usd IS NOT NULL) AS with_amount,
       (SELECT count(*) FROM public.hk_brands WHERE instagram_handle IS NOT NULL) AS handles
FROM public.hk_sponsor_periods;
