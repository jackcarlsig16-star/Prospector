-- assay-engine-generalization-v1
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Distilled, cached per-business Assay scoring criteria - generated once
-- (or on explicit Regenerate) from business_profiles' existing
-- vision/positioning/icp/gtm_strategy/raw_synthesis fields, not
-- re-derived on every clientAssay() call. Same table as the profile
-- itself (one business = one row already), no new table needed.
--
-- assay_criteria is jsonb rather than fixed columns because its shape
-- ({ fit_signals, disqualifiers, tier_guidance }) is generated content,
-- not a rigid schema - keeps this flexible if the shape needs to evolve
-- per-business later without another migration.
--
-- assay_criteria_edited_manually defaults false so a future bulk
-- "regenerate all" pass (if ever built) can tell a human's deliberate
-- manual tuning apart from untouched auto-generated criteria and skip
-- overwriting it.

alter table public.business_profiles
  add column if not exists assay_criteria jsonb,
  add column if not exists assay_criteria_updated_at timestamptz,
  add column if not exists assay_criteria_edited_manually boolean not null default false;
