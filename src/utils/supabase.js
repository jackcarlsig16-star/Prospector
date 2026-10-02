import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.error('[supabase] REACT_APP_SUPABASE_URL and/or REACT_APP_SUPABASE_ANON_KEY are not set — Supabase is disabled, app will run in localStorage-only mode.');
}

// prospector-auth-v1: two clients until the Stage 5 cutover. Today's table
// policies are granted TO anon only, so a data client carrying the user's
// session would run as `authenticated` and every read/write would fail.
// The data client therefore never picks up a session; authClient owns
// sign-in. Stage 5 switches data to the session together with the new
// member-scoped policies.
export const supabase = SUPABASE_URL && SUPABASE_ANON
  ? createClient(SUPABASE_URL, SUPABASE_ANON, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'prospector-data' },
    })
  : null;

export const authClient = SUPABASE_URL && SUPABASE_ANON
  ? createClient(SUPABASE_URL, SUPABASE_ANON)
  : null;

export const isSupabaseEnabled = () => !!supabase;
