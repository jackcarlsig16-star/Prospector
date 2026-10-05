import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.error('[supabase] REACT_APP_SUPABASE_URL and/or REACT_APP_SUPABASE_ANON_KEY are not set — Supabase is disabled, app will run in localStorage-only mode.');
}

// One client: it carries the signed-in session, so every table read/write
// runs as that user under the member-scoped RLS policies (prospector-auth-v1
// Stage 5). The publishable key alone reads nothing.
export const supabase = SUPABASE_URL && SUPABASE_ANON
  ? createClient(SUPABASE_URL, SUPABASE_ANON)
  : null;

export const isSupabaseEnabled = () => !!supabase;
