-- account-taxonomy-and-creation-upgrade-v1 Stage 1
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Field-shape groundwork for future per-business industry-list
-- customization (Company Settings, not built yet) - this migration only
-- adds the column, nothing reads or writes it today. NULL means "use the
-- universal default list" (src/constants/industries.js); a populated
-- array means this business has customized its own list. Same table/
-- pattern as assay_criteria and outreach_rules - one business = one row
-- already, jsonb because the shape (an ordered array of strings) doesn't
-- need a rigid schema or a separate join table.
--
-- Not consumed by any code yet - Company Settings UI is explicitly out of
-- scope for this SPEC. Shipping the column now means that future work is
-- additive (build the UI, read this column) rather than needing its own
-- migration + a backfill decision later.

alter table public.business_profiles
  add column if not exists industries jsonb;
