-- microsoft-connect-v1 Stage 3 Step 0 - the display name Graph gives for each
-- external address, parallel to external_emails (same order, same length),
-- so an Outlook-sourced partner_contacts row can carry a real name.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Names live in these tables only, like the addresses: never in logs or
-- files. Existing rows get '{}' and fill in on the next sync (the state rows
-- for the mailbox are cleared by the coder's re-sync, the upsert refreshes
-- every row in place).

ALTER TABLE public.microsoft_messages ADD COLUMN IF NOT EXISTS external_names text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.microsoft_events   ADD COLUMN IF NOT EXISTS external_names text[] NOT NULL DEFAULT '{}';

-- Check: both tables carry the column, rls still on, 0 policies
SELECT c.relname AS table_name,
       (SELECT count(*) FROM information_schema.columns k WHERE k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name = 'external_names') AS has_names,
       c.relrowsecurity AS rls_on,
       (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname) AS policies
FROM pg_class c
WHERE c.relname IN ('microsoft_messages', 'microsoft_events')
ORDER BY c.relname;
