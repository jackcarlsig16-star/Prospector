-- Prospector - drop stale project_id NOT NULL on frontier/bdr_assignments/handoff_intel
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- The audit run 2026-08-14 found every real write path to these three
-- tables (saveFrontier, upsertBdrAssignment, saveHandoffIntel, plus
-- api/handoff.js's server-side DiscoCoach path) has been silently failing
-- since 20260805_enforce_project_id_not_null.sql went live - confirmed via
-- a live service-role insert probe: "null value in column project_id...
-- violates not-null constraint". All three tables have 0 real rows.
--
-- project_id here was added for an abandoned 2026-08-05 per-owner
-- multi-tenancy direction, unrelated to the campaign "projects" concept
-- project-list-linking-v1/project-guidance-and-creation-flow-v1 shipped
-- today. There's no meaningful value to backfill - dropping the
-- constraint (not backfilling a fake project_id) is the correct fix,
-- same posture as leaving accounts.project_id nullable-and-dead rather
-- than forcing a value that wouldn't mean anything.

alter table public.frontier         alter column project_id drop not null;
alter table public.bdr_assignments  alter column project_id drop not null;
alter table public.handoff_intel    alter column project_id drop not null;
