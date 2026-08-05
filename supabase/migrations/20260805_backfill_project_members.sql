-- Prospector - Backfill project_members: existing owners + HumanKind team
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Run this AFTER 20260805_create_project_members.sql.
-- Idempotent - safe to re-run.

-- ============================================================================
-- STEP 1 — every existing project gets its owner as a member (so RLS changes
-- in a future Supabase Auth SPEC don't lock out anyone currently using the app)
-- ============================================================================
INSERT INTO public.project_members (project_id, user_email, role, accepted_at)
SELECT p.id, p.owner_email, 'owner', now()
FROM public.projects p
WHERE NOT EXISTS (
  SELECT 1 FROM public.project_members pm
  WHERE pm.project_id = p.id AND pm.user_email = p.owner_email
);

-- ============================================================================
-- STEP 2 — add Peter to the HumanKind project
-- ============================================================================
-- accepted_at left NULL: there's no real login/acceptance signal in this app today
-- (see 2026-08-05 Task 1 findings - the invite/master-code system doesn't work
-- cross-device, and team_users.status='approved' is keyed to a random per-browser
-- UUID, not reliably to email, so it's not a safe join to backfill "accepted" from).
INSERT INTO public.project_members (project_id, user_email, role, accepted_at)
SELECT id, 'peter@humankindcollective.app', 'member', NULL
FROM public.projects
WHERE owner_email = 'jack@humankindcollective.app'
ON CONFLICT (project_id, user_email) DO NOTHING;

-- ============================================================================
-- FLAGGED, NOT DONE — Bella
-- ============================================================================
-- Bella's email address isn't on file anywhere in this repo or its history.
-- No row was inserted for her. Once Jack provides her email, run:
--
--   INSERT INTO public.project_members (project_id, user_email, role, accepted_at)
--   SELECT id, '<bella-email-here>', 'member', NULL
--   FROM public.projects
--   WHERE owner_email = 'jack@humankindcollective.app'
--   ON CONFLICT (project_id, user_email) DO NOTHING;
