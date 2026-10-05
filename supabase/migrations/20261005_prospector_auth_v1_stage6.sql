-- prospector-auth-v1 Stage 6 - drop the pre-auth identity tables.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Nothing to migrate (checked 2026-10-05):
--   team_users      0 rows (saves never worked - audit F5)
--   approved_users  2 rows - Jack (now platform owner via profiles) and one
--                   HumanKind member who already has a business_members row
--                   waiting for an invite
--   access_log      pre-auth gate hits (IP, user agent, partial code);
--                   replaced by auth_events in Stage 5, no longer written
-- No foreign keys, views or triggers reference these tables. RESTRICT (the
-- default) makes the drop fail instead of cascading if that ever changes.

DROP TABLE IF EXISTS public.team_users;
DROP TABLE IF EXISTS public.approved_users;
DROP TABLE IF EXISTS public.access_log;
