// FIX linkedin-url-normalize L1 - one rule for every LinkedIn link we take in, typed the way people copy it
// ("linkedin.com/in/x", "www.linkedin.com/…", "LinkedIn.com/in/x/", "<https://uk.linkedin.com/in/x?trk=…>"):
// -> "https://www.linkedin.com/<path>" (https, www host, no query / fragment / trailing slash), or null when it isn't a
// LinkedIn link. The host must be linkedin.com itself or a subdomain of it, so "linkedin.com.evil.com" is refused.
export const LINKEDIN_MAX = 300;
export const LINKEDIN_ERROR = "That doesn't look like a LinkedIn link — paste it like linkedin.com/in/name.";

export function normalizeLinkedinUrl(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  while (/^[<"'`].*[>"'`]$/.test(s)) s = s.slice(1, -1).trim();
  if (!s || s.length > LINKEDIN_MAX) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s.replace(/^\/\//, '')}`;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return null;
  const path = u.pathname.replace(/\/+$/, '');
  if (!path) return null;
  const out = `https://www.linkedin.com${path}`;
  return out.length <= LINKEDIN_MAX ? out : null;
}
