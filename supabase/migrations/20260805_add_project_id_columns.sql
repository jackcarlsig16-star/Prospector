-- Prospector - Add project_id to existing tables
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Run this AFTER 20260805_create_projects.sql, BEFORE
-- 20260805_backfill_projects_and_seed_partners.sql.
--
-- Nullable for now - backfill happens in the next migration, NOT NULL is enforced
-- in 20260805_enforce_project_id_not_null.sql only after the backfill confirms zero
-- NULL rows remain.
--
-- plospect_compliance is deliberately excluded: it has no owner_email column and no
-- owner-identifying column at all. Its only link to an owner is transitive, through
-- acc_id -> accounts.id, so it inherits project scope from accounts rather than
-- carrying its own project_id (2026-08-05 direction - do not add a column here).

ALTER TABLE public.accounts        ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id);
ALTER TABLE public.team_users      ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id);
ALTER TABLE public.frontier        ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id);
ALTER TABLE public.bdr_assignments ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id);
ALTER TABLE public.handoff_intel   ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id);

-- sfdc_tokens: added for schema consistency (single global row, id='primary', the
-- org's one SFDC connection - not per-owner data). This column will stay nullable
-- permanently; it is never backfilled and never gets NOT NULL enforced. Keep this
-- table's RLS exactly as-is (service-role-only, no anon policies) - do not loosen it.
ALTER TABLE public.sfdc_tokens     ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id);
