// Shared by connect.js + callback.js.

export const STATE_COOKIE = 'prospector_microsoft_oauth';

// Must match a redirect URI registered on the Entra app.
export function redirectUri(req) {
  return process.env.MICROSOFT_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/microsoft/callback`;
}

export function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

// The id token comes straight from Microsoft's token endpoint over TLS, so
// its claims are read without re-verifying the signature.
export function idTokenClaims(idToken) {
  try { return JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8')); } catch { return {}; }
}
