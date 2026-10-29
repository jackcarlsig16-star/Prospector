-- hkos-inbox-v2 Stage 1 (L5) - hk_domain_intel: the derived company intel one Analyze click produces, one row per
-- workspace + sender domain (a re-Analyze after 30 days overwrites it). Derived intel ONLY: no body, subject, snippet or
-- address column, ever - the email text goes to Claude and is not kept. The daily Analyze cap is counted from
-- business_anthropic_usage (call_type 'hk_inbox_analyze', user_id), not from this table.
-- business_id -> businesses ON DELETE CASCADE; researched_by -> profiles ON DELETE SET NULL; RLS on, no policies;
-- anon + authenticated revoked (server only, service key).

CREATE TABLE IF NOT EXISTS public.hk_domain_intel (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  domain         text NOT NULL CHECK (domain = lower(domain) AND length(domain) BETWEEN 3 AND 253 AND domain !~ '[@[:space:]]'),
  intel          jsonb NOT NULL CHECK (jsonb_typeof(intel) = 'object'),
  model          text NOT NULL CHECK (length(model) <= 80),
  cost_usd       numeric(10, 6) CHECK (cost_usd IS NULL OR cost_usd >= 0),
  researched_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  researched_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hk_domain_intel_business_domain_key UNIQUE (business_id, domain)
);

ALTER TABLE public.hk_domain_intel ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hk_domain_intel FROM anon, authenticated;

-- Proof - expect 3 rows:
--   "table"  hk_domain_intel: rls=true · policies=0 · rows=0 · anon_select=false · auth_select=false · columns=8
--   "unique" hk_domain_intel_business_domain_key: (business_id, domain)
--   "no_text_columns" hk_domain_intel: none
SELECT 'table' AS kind, t.relname::text AS name,
       'rls=' || t.relrowsecurity ||
       ' · policies=' || (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t.relname) ||
       ' · rows=' || (SELECT count(*) FROM public.hk_domain_intel) ||
       ' · anon_select=' || has_table_privilege('anon', t.oid, 'SELECT') ||
       ' · auth_select=' || has_table_privilege('authenticated', t.oid, 'SELECT') ||
       ' · columns=' || (SELECT count(*) FROM information_schema.columns ic WHERE ic.table_schema = 'public' AND ic.table_name = t.relname) AS detail
  FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace
 WHERE n.nspname = 'public' AND t.relkind = 'r' AND t.relname = 'hk_domain_intel'
UNION ALL
SELECT 'unique', c.conname::text, '(' || (SELECT string_agg(a.attname, ', ' ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) || ')'
  FROM pg_constraint c WHERE c.conname = 'hk_domain_intel_business_domain_key'
UNION ALL
SELECT 'no_text_columns', 'hk_domain_intel',
       coalesce((SELECT string_agg(column_name, ', ') FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'hk_domain_intel'
                    AND column_name ~ '(body|subject|snippet|email|address|from|phone)'), 'none')
ORDER BY 1 DESC;
