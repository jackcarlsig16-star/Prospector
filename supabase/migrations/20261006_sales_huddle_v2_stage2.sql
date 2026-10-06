-- sales-huddle-v2 REVISION 1 Stage 2 - when a reply was first seen.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Apollo gives no reply timestamp, and the sync rewrites updated_at on every
-- run, so nothing recorded when a reply first showed up. replied_seen_at is
-- set once by this trigger, the first time a row arrives (or flips) with
-- replied = true; later syncs never move it. The Huddle uses it for
-- "replied · seen at <sync time>" and for Hot (7 days from seen) -> Warm.
-- Existing replies are backfilled from first_seen_at (when the sync first
-- stored the message) - the closest time we have.

ALTER TABLE public.sales_email_messages
  ADD COLUMN IF NOT EXISTS replied_seen_at timestamptz;

CREATE OR REPLACE FUNCTION public.sales_messages_reply_seen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.replied_seen_at := COALESCE(OLD.replied_seen_at, NEW.replied_seen_at);
  END IF;
  IF NEW.replied AND NEW.replied_seen_at IS NULL THEN
    NEW.replied_seen_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sales_messages_reply_seen ON public.sales_email_messages;
CREATE TRIGGER sales_messages_reply_seen
  BEFORE INSERT OR UPDATE ON public.sales_email_messages
  FOR EACH ROW EXECUTE FUNCTION public.sales_messages_reply_seen();

-- Backfill. On these rows OLD.replied_seen_at is null, so the trigger keeps
-- the first_seen_at value set here.
UPDATE public.sales_email_messages SET replied_seen_at = first_seen_at
  WHERE replied AND replied_seen_at IS NULL;

-- Check: every replied message has a seen time
SELECT count(*) FILTER (WHERE replied) AS replied, count(*) FILTER (WHERE replied AND replied_seen_at IS NULL) AS missing_seen_at
  FROM public.sales_email_messages;
