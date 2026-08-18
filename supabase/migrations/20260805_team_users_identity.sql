-- Prospector - team_users identity fix (prep for real Supabase Auth)
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- team_users.id today is a random client-side UUID (localStorage['prospector_user_id']),
-- not a real identity - the same person on two devices gets two unrelated rows with no
-- link between them. This migration doesn't try to fix that retroactively (there's
-- nothing reliable to backfill an auth identity from). Instead:
--   - supabase_auth_id is added nullable, and only gets populated once each person
--     actually logs in via real Supabase Auth for the first time (a later task).
--   - email becomes the real join key in the meantime, so it needs to be unique -
--     but only after confirming there are no existing duplicate/blank rows to collide.

-- ============================================================================
-- STEP 1 — check for duplicate (including blank '') emails before adding the
-- UNIQUE constraint. If this returns any rows, STOP - resolve the duplicates
-- manually (merge or delete the stale row) before running Step 2. Do not guess
-- which row should win.
-- ============================================================================
SELECT email, count(*)
FROM public.team_users
GROUP BY email
HAVING count(*) > 1;

-- ============================================================================
-- STEP 2 — only run once Step 1 returns zero rows.
-- ============================================================================
ALTER TABLE public.team_users ADD COLUMN IF NOT EXISTS supabase_auth_id uuid REFERENCES auth.users(id);
ALTER TABLE public.team_users ADD CONSTRAINT team_users_email_key UNIQUE (email);
