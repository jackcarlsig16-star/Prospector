-- microsoft-connect-v1 Stage 4a - real reply times from Outlook.
-- Apollo never says when a reply arrived; replied_seen_at is only when the
-- sync first noticed it. A reply that sits in the synced Outlook inbox gives
-- the exact time - but matching it to a sequenced prospect needs that
-- prospect's address, which the Apollo payload carries and the sync drops.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Addresses live in the DB only, never in logs or files (same rule as
-- partner_contacts.email and microsoft_messages). Existing prospects fill in
-- on the next Apollo activity sync (the snapshot upsert refreshes rows in
-- place); nothing is backfilled here and no Apollo call is made.

ALTER TABLE public.sales_prospect_state ADD COLUMN IF NOT EXISTS email text
  CHECK (email IS NULL OR (email = lower(email) AND length(email) <= 254 AND position('@' IN email) > 1));

-- replied_at: the exact time the reply landed in the inbox (Outlook
-- receivedDateTime), set once and never moved; replied_message_id: the
-- Outlook internet message id it came from, so a re-run recognises its own
-- work and the feed can say where the time came from. replied_seen_at and
-- its trigger stay as they are - the fallback when no Outlook reply matches.
ALTER TABLE public.sales_email_messages
  ADD COLUMN IF NOT EXISTS replied_at timestamptz,
  ADD COLUMN IF NOT EXISTS replied_message_id text;

CREATE INDEX IF NOT EXISTS sales_email_messages_replied_at_idx
  ON public.sales_email_messages (business_id, replied_at) WHERE replied_at IS NOT NULL;

-- Check: 3 columns present, index present, rls still on both tables, every row NULL for now
SELECT c.relname AS table_name,
       (SELECT count(*) FROM information_schema.columns k WHERE k.table_schema = 'public' AND k.table_name = c.relname
          AND k.column_name IN ('email', 'replied_at', 'replied_message_id')) AS new_columns,
       (SELECT count(*) FROM pg_indexes i WHERE i.tablename = c.relname AND i.indexname = 'sales_email_messages_replied_at_idx') AS has_index,
       c.relrowsecurity AS rls_on,
       CASE c.relname
         WHEN 'sales_prospect_state' THEN (SELECT count(*) FROM public.sales_prospect_state WHERE email IS NOT NULL)
         ELSE (SELECT count(*) FROM public.sales_email_messages WHERE replied_at IS NOT NULL) END AS filled_rows
FROM pg_class c
WHERE c.relname IN ('sales_prospect_state', 'sales_email_messages')
ORDER BY c.relname;
