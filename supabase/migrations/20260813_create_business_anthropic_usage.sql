-- Prospector - Track Anthropic API usage per call, for real cost accounting
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Append-only audit log - insert + read only, no update/delete policies.
-- business_id uses ON DELETE SET NULL (not CASCADE) so historical cost data
-- survives even if a business row is later removed.

CREATE TABLE IF NOT EXISTS public.business_anthropic_usage (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  call_type     text NOT NULL, -- 'web_search' | 'profile_light' | 'profile_full'
  input_tokens  integer,
  output_tokens integer,
  model         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS business_anthropic_usage_business_id_idx ON public.business_anthropic_usage (business_id);
CREATE INDEX IF NOT EXISTS business_anthropic_usage_created_at_idx ON public.business_anthropic_usage (created_at);

ALTER TABLE public.business_anthropic_usage ENABLE ROW LEVEL SECURITY;

-- 2026-08-13: USING(true) for anon, same deferral convention as every other
-- table this session. Written server-side only in practice (via the
-- service-role connection inside callAnthropic()).
DROP POLICY IF EXISTS "anon_read_business_anthropic_usage"  ON public.business_anthropic_usage;
DROP POLICY IF EXISTS "anon_write_business_anthropic_usage" ON public.business_anthropic_usage;
CREATE POLICY "anon_read_business_anthropic_usage"  ON public.business_anthropic_usage FOR SELECT TO anon USING (true);
CREATE POLICY "anon_write_business_anthropic_usage" ON public.business_anthropic_usage FOR INSERT TO anon WITH CHECK (true);
