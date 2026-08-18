-- business-intel-smart-upload-v1
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Fix 1 of business-intel-smart-upload-v1 (specs/business-intel-smart-upload-v1.md).
-- Additive only - no existing column touched.
--
-- content_type tags each business_intel_entries row with a lightweight
-- document kind (strategy_doc / marketing_asset / pricing / competitive /
-- other) so the profile synthesis prompt can weight sources appropriately.
-- Nullable - older entries and non-company_intel rows are never
-- retroactively classified.
alter table public.business_intel_entries
  add column if not exists content_type text;

-- Seven new distilled fields on business_profiles, same table as the
-- existing profile (one business = one row already, no new table needed -
-- same reasoning as assay_criteria/outreach_rules living here). jsonb for
-- the array-shaped fields (sub_issues/products/value_props), text for the
-- scalar ones.
alter table public.business_profiles
  add column if not exists industry text,
  add column if not exists core_problem text,
  add column if not exists sub_issues jsonb,
  add column if not exists products jsonb,
  add column if not exists value_props jsonb,
  add column if not exists motto text,
  add column if not exists strategic_philosophy text;

-- field_sources: per-field entry-id citations produced by generateProfile()'s
-- synthesis call, keyed by field name (dot-notation for nested fields like
-- assay_criteria.fit_signals). Diff-check-on-write (Fix 3/4 in the SPEC)
-- keeps an unchanged field's prior sources rather than overwriting with
-- whatever a given run happened to cite - this column is what makes that
-- possible without a separate versioning table.
alter table public.business_profiles
  add column if not exists field_sources jsonb;

-- One edited-manually flag per new field, same pattern as the existing
-- assay_criteria_edited_manually/outreach_rules_edited_manually - lets the
-- next full resynthesis skip overwriting a field a human deliberately
-- edited. Deliberately scoped to only the 7 new fields (see SPEC's
-- "Explicitly out of scope" - the original six fields don't get this
-- protection in this pass).
alter table public.business_profiles
  add column if not exists industry_edited_manually boolean not null default false,
  add column if not exists core_problem_edited_manually boolean not null default false,
  add column if not exists sub_issues_edited_manually boolean not null default false,
  add column if not exists products_edited_manually boolean not null default false,
  add column if not exists value_props_edited_manually boolean not null default false,
  add column if not exists motto_edited_manually boolean not null default false,
  add column if not exists strategic_philosophy_edited_manually boolean not null default false;
