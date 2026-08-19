-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
-- intake-confirm-proxy-timeout-v1 — status/error columns for the two
-- resynthesis operations this SPEC moves off the synchronous request path
-- (generateProfile via intake-confirm's company_intel/internal_meeting
-- actions, generateProjectStrategy via internal_meeting's project side).
--
-- Deliberately NOT reusing businesses.research_status - that field drives
-- the full research pipeline's UI (BusinessDetailPage's "researching"
-- banner, BusinessesHomePage's status pills) and reusing it here would
-- make a quick company-intel filing incorrectly trigger that full-pipeline
-- UI. New, narrowly-scoped fields instead, same enum shape/discipline as
-- research_status/research_error ('syncing' while in flight, 'ready' or
-- 'error' on completion, never left stuck - see runProfileSync/
-- runStrategySync in api/businesses/shared.js).
alter table businesses
  add column if not exists intel_sync_status text,
  add column if not exists intel_sync_error text;

alter table projects
  add column if not exists strategy_sync_status text,
  add column if not exists strategy_sync_error text;
