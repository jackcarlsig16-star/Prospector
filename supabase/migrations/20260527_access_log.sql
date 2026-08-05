-- Prospector - Create access_log table
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run

CREATE TABLE IF NOT EXISTS public.access_log (
  id           bigserial PRIMARY KEY,
  event        text NOT NULL,  -- 'success' | 'attempt'
  code_partial text,           -- 'GOLD-****' | 'MASTER' | null for attempts
  ip_address   text,
  user_agent   text,
  created_at   timestamptz DEFAULT now()
);

-- Index for fast recent-first queries
CREATE INDEX IF NOT EXISTS access_log_created_at_idx ON public.access_log (created_at DESC);

-- RLS: enabled, no anon policies - only service key can read/write
ALTER TABLE public.access_log ENABLE ROW LEVEL SECURITY;

-- Grants (required for new tables after Oct 30 2026 - safe to include now)
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT ON public.access_log TO anon, authenticated;
