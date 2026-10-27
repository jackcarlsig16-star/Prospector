-- intent-score-v1 Stage 3 (S7 Write email) - the per-workspace soft layer and hard-rule knobs. Run in: Supabase
-- Dashboard -> SQL Editor -> New query -> paste -> Run. Idempotent; no existing row changes. The code reads
-- sales_settings with select('*') and falls back to its defaults (composeRoutes.js DEFAULT_COMPOSE_PROMPT,
-- composeLint.js DEFAULT_COMPOSE_RULES, cap 30 / day) while these columns are NULL, so Write email works before and
-- after this runs; the columns exist so Admin can edit them later (FIX score-weights-ui).
--
-- sales_settings + compose_prompt text   the voice / structure / tone prompt (NULL = default)
--               + compose_rules  jsonb  { max_words, ask_minutes, proof_points: [], banned_claims: [], daily_cap }

ALTER TABLE public.sales_settings ADD COLUMN IF NOT EXISTS compose_prompt text CHECK (compose_prompt IS NULL OR length(compose_prompt) <= 4000);
ALTER TABLE public.sales_settings ADD COLUMN IF NOT EXISTS compose_rules jsonb;

-- Proof - expect 2 rows:
--   1 sales_settings columns   compose_prompt,compose_rules
--   2 rows with a custom prompt 0 · rows with rules 0
SELECT 1 AS n, 'sales_settings columns' AS what,
       (SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales_settings' AND column_name IN ('compose_prompt', 'compose_rules')) AS detail
UNION ALL
SELECT 2, 'custom prompts / rules',
       'rows with a custom prompt ' || (SELECT count(*) FROM public.sales_settings WHERE compose_prompt IS NOT NULL) ||
       ' · rows with rules ' || (SELECT count(*) FROM public.sales_settings WHERE compose_rules IS NOT NULL)
ORDER BY 1;
