import { createClient } from '@supabase/supabase-js';

// prospector-auth-v1 - the session travels in a same-origin cookie, not an
// Authorization header: Basic Auth owns that header until the Stage 5
// cutover (an explicit Bearer would replace the browser's Basic credentials
// and 401 every call), and a cookie reaches all ~134 existing fetch call
// sites without touching them. Set by src/utils/authSession.js.
export const SESSION_COOKIE = 'prospector_at';

export function getServiceSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
}

export function getAccessToken(req) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === SESSION_COOKIE) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}
