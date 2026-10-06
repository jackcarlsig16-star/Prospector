-- nav-admin-cleanup-v1 Stage 3 - per-workspace feature switches.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- businesses.features replaces the HomeLover id that was hard-coded in
-- src/constants/businessNav.js. Read by the menu; written only by the
-- platform owner through PUT /api/businesses/:id/features (service key).
-- No RLS change: businesses keeps its single s5_read policy.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS features jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.businesses
  SET features = features || '{"goals_sales": true}'::jsonb
  WHERE id = 'bc69beab-effd-452d-9e81-fd652333bb95';

-- Check: HomeLover true, the other workspaces {}
SELECT name, features FROM public.businesses ORDER BY name;
