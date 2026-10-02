// Shared by connect.js + callback.js.

export const STATE_COOKIE = 'prospector_google_oauth';

// Stays /api/gmail/callback: it's the redirect URI registered in Google Cloud.
export function redirectUri(req) {
  return process.env.GMAIL_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/gmail/callback`;
}

// Same-origin paths only, so the callback can't be used as an open redirect.
export function returnPath(raw) {
  return typeof raw === 'string' && /^\/(?![/\\])/.test(raw) ? raw.slice(0, 512) : '/';
}

export function withParam(path, key, value) {
  const url = new URL(path, 'http://x');
  url.searchParams.set(key, value);
  return url.pathname + url.search + url.hash;
}
