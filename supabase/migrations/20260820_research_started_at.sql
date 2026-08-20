-- research-poll-egress-fix-v1 Stage 2
-- runResearch() writes a terminal research_status only inside its
-- try/catch (shared.js:1187/1190). A process death - the OOM kill at
-- 2026-08-20 12:55 UTC - runs neither branch, leaving research_status
-- stuck at 'researching' permanently, which re-arms a 210s polling run
-- on every subsequent page visit. There is no way to guarantee the
-- terminal write, so this column lets the read side reconcile a stuck
-- row on its own instead of waiting for a dead process to come back.
alter table public.businesses
  add column if not exists research_started_at timestamptz;

-- Backfill: any row currently claiming to be researching has no known
-- start time. Stamping them now would hide a genuinely stuck row for a
-- full staleness window, so stamp them into the past instead - they are
-- by definition already stale.
update public.businesses
  set research_started_at = now() - interval '1 day'
  where research_status = 'researching' and research_started_at is null;
