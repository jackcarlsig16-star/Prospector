-- partner-touch-log-v1 Stage 1 - logged touches on the partner history.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- A touch is one sales_partner_events row (event 'touch') written through
-- applyPartnerSignal, dated on the day it happened (at), not the day it was
-- typed in. recorded_at is when the row was written: undo means "the last
-- thing someone did", so it orders by recorded_at - a touch backdated to
-- Sep 30 is still the latest change when it's undone.
-- source: who logged it - manual now; Outlook (microsoft-connect-v1 Stage 3)
-- and Apollo later write the same rows.

ALTER TABLE public.sales_partner_events DROP CONSTRAINT IF EXISTS sales_partner_events_event_check;
ALTER TABLE public.sales_partner_events ADD CONSTRAINT sales_partner_events_event_check
  CHECK (event IN ('status', 'assign', 'hot', 'snooze', 'deprioritize', 'note', 'undo', 'touch'));

ALTER TABLE public.sales_partner_events
  ADD COLUMN IF NOT EXISTS touch_type    text CHECK (touch_type IS NULL OR touch_type IN ('email', 'call', 'linkedin', 'meeting', 'event', 'other')),
  ADD COLUMN IF NOT EXISTS contact_names text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS source        text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'outlook', 'apollo')),
  ADD COLUMN IF NOT EXISTS recorded_at   timestamptz NOT NULL DEFAULT now();

-- Existing rows were written when they happened.
UPDATE public.sales_partner_events SET recorded_at = at WHERE recorded_at <> at;

CREATE INDEX IF NOT EXISTS sales_partner_events_goal_recorded_idx ON public.sales_partner_events (goal_id, recorded_at);

-- Check: 4 new columns, every row's recorded_at = at, constraint allows 'touch'
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_partner_events'
     AND column_name IN ('touch_type', 'contact_names', 'source', 'recorded_at')) AS new_columns,
  (SELECT count(*) FROM public.sales_partner_events) AS events,
  (SELECT count(*) FROM public.sales_partner_events WHERE recorded_at <> at) AS mismatched,
  (SELECT pg_get_constraintdef(oid) LIKE '%touch%' FROM pg_constraint WHERE conname = 'sales_partner_events_event_check') AS touch_allowed;
