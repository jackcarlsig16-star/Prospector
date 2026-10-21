-- FIX company-panel-promote-research-v1 Part A3 - one-off backfill, HomeLover only.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Research runs made on a target before Promote stayed keyed to the target
-- (entity_type 'target'), so the new partner's panel found none. This moves
-- them to the partner the target became (sales_targets.promoted_goal_id).
-- Targets promoted to an employer keep no link to their opportunity, so their
-- runs are only counted here (follow-on: link_type opportunity +
-- promoted_opportunity_id). Idempotent: a second run moves 0 rows.
--
-- Result: one row per moved run (what = 'moved': target, partner, run id,
-- run date) plus one 'employer-promoted (not repaired)' row with the count.

WITH hl AS (
  SELECT id FROM public.businesses WHERE name = 'HomeLover'
),
promoted AS (
  SELECT t.id AS target_id, t.name AS target_name, g.id AS goal_id, g.name AS partner_name
  FROM public.sales_targets t
  JOIN hl ON t.business_id = hl.id
  JOIN public.sales_goals g ON g.id = t.promoted_goal_id AND g.business_id = hl.id AND g.goal_type = 'partnership'
  WHERE t.status = 'accepted' AND t.promoted_goal_id IS NOT NULL
),
moved AS (
  UPDATE public.research_runs r
  SET entity_type = 'partner', entity_id = p.goal_id
  FROM promoted p, hl
  WHERE r.business_id = hl.id AND r.entity_type = 'target' AND r.entity_id = p.target_id
  RETURNING p.target_name, p.partner_name, r.id AS run_id, r.entity_id AS new_entity_id, r.created_at
),
unlinked AS (
  SELECT count(DISTINCT t.id) AS targets, count(r.id) AS runs
  FROM public.sales_targets t
  JOIN hl ON t.business_id = hl.id
  JOIN public.research_runs r ON r.business_id = t.business_id AND r.entity_type = 'target' AND r.entity_id = t.id
  WHERE t.status = 'accepted' AND t.promoted_goal_id IS NULL
)
SELECT 'moved' AS what, target_name, partner_name, run_id::text AS run_id, new_entity_id::text AS new_entity_id, created_at
FROM moved
UNION ALL
SELECT 'employer-promoted (not repaired)', NULL, NULL, runs::text || ' runs on ' || targets::text || ' targets', NULL, NULL
FROM unlinked
ORDER BY what, target_name, created_at;
