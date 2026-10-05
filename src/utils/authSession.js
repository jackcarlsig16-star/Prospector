import { authClient } from './supabase';

// Mirrors the Supabase access token into a same-origin cookie so every
// /api and /proxy request carries it without changing any call site
// (server side: api/lib/authUser.js explains why not an Authorization header).
const SESSION_COOKIE = 'prospector_at';

export function syncSessionCookie(session) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  if (session?.access_token) {
    const maxAge = Math.max(60, (session.expires_at || 0) - Math.floor(Date.now() / 1000));
    document.cookie = `${SESSION_COOKIE}=${encodeURIComponent(session.access_token)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
  } else {
    document.cookie = `${SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
  }
}

export async function fetchMe() {
  const res = await fetch('/api/me');
  if (res.status === 401) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Failed to load your account (${res.status})`);
  return data;
}

export async function signOut() {
  try { await authClient.auth.signOut(); } catch {}
  syncSessionCookie(null);
  window.location.assign('/login');
}
