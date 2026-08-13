-- Prospector - Nest projects under businesses (navigation-restructure-v1)
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Nullable by design: existing projects predate this relationship and may
-- not map to any business. Unmapped rows stay as-is and are surfaced as
-- "Unassigned" in the UI rather than forced to a guessed business.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.businesses(id);

CREATE INDEX IF NOT EXISTS projects_business_id_idx ON public.projects (business_id);
