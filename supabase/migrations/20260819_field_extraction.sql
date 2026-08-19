-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
-- intake-field-extraction-and-bulk-split-v1 Stage 3/4 — background AI
-- field extraction from pasted text (deck/notes), for both projects and
-- campaigns. Mirrors the exact status/error column pattern already
-- confirmed live for businesses.intel_sync_status/intel_sync_error and
-- projects.strategy_sync_status/strategy_sync_error (beginProfileSync/
-- runProfileSync, shared.js:773-783) - same fire-and-forget-then-poll
-- mechanism, not a new one.
--
-- field_extraction_result holds the raw extracted {field: value, ...}
-- object once status flips to 'ready' - a staging area the client reads
-- to render a diff-preview (extracted vs. current) with per-field
-- accept/reject. Extraction NEVER writes directly into objective/
-- target_type/etc (or recipient_description/doctrine on campaigns) -
-- only an explicit per-field Accept, followed by the existing Save
-- button (updateProjectGuidance / updateCampaign), does that, per
-- decision #1 (diff-preview, not auto-overwrite).
alter table projects
  add column if not exists field_extraction_status text,
  add column if not exists field_extraction_error text,
  add column if not exists field_extraction_result jsonb;

alter table campaigns
  add column if not exists field_extraction_status text,
  add column if not exists field_extraction_error text,
  add column if not exists field_extraction_result jsonb;
