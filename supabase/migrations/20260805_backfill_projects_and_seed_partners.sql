-- Prospector - Backfill project_id on existing data + seed HumanKind founding partners
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Run this AFTER 20260805_add_project_id_columns.sql and
-- 20260805_create_prospects_outreach_drafts.sql, BEFORE
-- 20260805_enforce_project_id_not_null.sql.
--
-- Everything below is idempotent - safe to re-run if a step needs to happen twice.
-- Read each comment block before running the statements under it; this file has two
-- deliberate stopping points where you should check a query result before continuing.

-- ============================================================================
-- STEP 1 — accounts: one Default Project per distinct owner_email
-- ============================================================================
BEGIN;

INSERT INTO public.projects (owner_email, name, color)
SELECT DISTINCT a.owner_email, 'Default Project', '#6366f1'
FROM public.accounts a
WHERE a.owner_email IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.projects p WHERE p.owner_email = a.owner_email
  );

UPDATE public.accounts a
SET project_id = p.id
FROM public.projects p
WHERE p.owner_email = a.owner_email
  AND a.project_id IS NULL;

COMMIT;

-- ============================================================================
-- STEP 2 — ensure the HumanKind project exists
-- ============================================================================
-- On a fresh Supabase project (this one - tables were only created 2026-08-05),
-- accounts has zero rows, so Step 1 above creates no projects at all. Create the
-- HumanKind project explicitly if jack@humankindcollective.app doesn't already
-- have one from Step 1 (i.e. if there happened to be existing accounts data for
-- that email).
INSERT INTO public.projects (owner_email, name, color)
SELECT v.owner_email, v.name, v.color
FROM (VALUES ('jack@humankindcollective.app', 'HumanKind', '#6366f1')) AS v(owner_email, name, color)
WHERE NOT EXISTS (
  SELECT 1 FROM public.projects WHERE owner_email = 'jack@humankindcollective.app'
);

-- ============================================================================
-- STOP AND CHECK before Step 3
-- ============================================================================
-- team_users, frontier, bdr_assignments, and handoff_intel have no owner_email
-- column (they're team-wide shared data, not per-user), so per 2026-08-05
-- direction their rows are assigned directly to "the" project rather than
-- matched by owner. That only works if exactly one project exists.
--
-- Run this query and confirm project_count = 1 before running Step 3 below.
-- Expected right now: 1 row, name 'HumanKind' (fresh DB, empty accounts table).
-- If this returns anything other than 1, STOP - do not run Step 3. Report back
-- which projects exist instead of guessing which one should win.
SELECT count(*) AS project_count, array_agg(name) AS project_names FROM public.projects;

-- ============================================================================
-- STEP 3 — team_users / frontier / bdr_assignments / handoff_intel: assign to
-- the single existing project. ONLY RUN AFTER CONFIRMING project_count = 1 ABOVE.
-- ============================================================================
BEGIN;

UPDATE public.team_users
SET project_id = (SELECT id FROM public.projects LIMIT 1)
WHERE project_id IS NULL;

UPDATE public.frontier
SET project_id = (SELECT id FROM public.projects LIMIT 1)
WHERE project_id IS NULL;

UPDATE public.bdr_assignments
SET project_id = (SELECT id FROM public.projects LIMIT 1)
WHERE project_id IS NULL;

UPDATE public.handoff_intel
SET project_id = (SELECT id FROM public.projects LIMIT 1)
WHERE project_id IS NULL;

COMMIT;

-- ============================================================================
-- STEP 4 — seed the 13 HumanKind founding partners into prospects
-- ============================================================================
-- Only the fields the spec actually gave values for are set; everything else
-- (category, website, contact info, etc.) is left NULL rather than guessed.
INSERT INTO public.prospects (project_id, owner_email, name, name_normalized, status, is_founding_partner)
SELECT p.id, 'jack@humankindcollective.app', v.name, lower(trim(v.name)), 'confirmed_partner', true
FROM (VALUES
  ('Chicago White Sox'),
  ('Shred415'),
  ('Barry''s'),
  ('Studio Three'),
  ('Protein Bar & Kitchen'),
  ('WasteNot'),
  ('Augustnoa'),
  ('Paleovalley'),
  ('David (David Bar)'),
  ('SEEQ'),
  ('Lou Malnati''s'),
  ('LOADED'),
  ('SWTHZ'),
  ('Protein Pints')
) AS v(name)
CROSS JOIN LATERAL (
  SELECT id FROM public.projects WHERE owner_email = 'jack@humankindcollective.app' LIMIT 1
) AS p
WHERE NOT EXISTS (
  SELECT 1 FROM public.prospects existing
  WHERE existing.project_id = p.id AND existing.name_normalized = lower(trim(v.name))
);
