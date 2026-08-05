import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = process.env.REACT_APP_SUPABASE_URL  || "https://tvcziysadlenujiozrno.supabase.co";
const SUPABASE_ANON = process.env.REACT_APP_SUPABASE_ANON_KEY || "sb_publishable_OfWuuMn5P5EKticavmE0qw_H-xKMEON";

export const supabase = SUPABASE_URL && SUPABASE_ANON
  ? createClient(SUPABASE_URL, SUPABASE_ANON)
  : null;

export const isSupabaseEnabled = () => !!supabase;
