-- Prospector - Project-scoped intel + per-project strategy (smart-intake-and-intelligence-v1, part 1)
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Nullable/backfill-safe, no data loss. project_id null on business_intel_entries
-- means "company-level" (every existing row stays company-level, unchanged).
-- list_id null on projects means "no list assigned yet" (every existing project
-- stays unassigned until set). No RLS changes needed - both tables already have
-- anon policies (20260812_create_businesses_intel.sql, 20260805_create_projects.sql)
-- and RLS is table-level, not column-level.

ALTER TABLE public.business_intel_entries
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS business_intel_entries_project_id_idx ON public.business_intel_entries (project_id);

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS list_id uuid REFERENCES public.lists(id) ON DELETE SET NULL;
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS strategy_synthesis text;
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS strategy_generated_at timestamptz;
