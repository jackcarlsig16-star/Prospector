import { featuresFromScope, saveGrant } from '../lib/googleGrants.js';
import { redirectUri, STATE_COOKIE, returnPath, withParam } from './oauth.js';

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function parseState(raw) {
  try { return JSON.parse(Buffer.from(String(raw || ''), 'base64url').toString('utf8')); } catch { return null; }
}

// GET /api/gmail/callback - Google's redirect back. Tokens are stored
// server-side against the signed-in user; the browser only gets ?google_connected.
export default async function handler(req, res) {
  const state = parseState(req.query.state);
  const back = returnPath(state?.r);
  const nonce = readCookie(req, STATE_COOKIE);
  res.setHeader('Set-Cookie', `${STATE_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);

  // The nonce cookie proves this browser started the flow; the user id proves
  // the same person is still signed in, so a grant can't land on someone else.
  if (!state || !nonce || state.n !== nonce || state.u !== req.auth.user.id) {
    return res.redirect(withParam(back, 'google_error', 'Google sign-in expired or was started in another session - try again'));
  }
  if (req.query.error) return res.redirect(withParam(back, 'google_error', req.query.error === 'access_denied' ? 'Google access was not granted' : req.query.error));
  if (!req.query.code) return res.redirect(withParam(back, 'google_error', 'Google returned no code'));

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: req.query.code,
        client_id: process.env.GMAIL_CLIENT_ID,
        client_secret: process.env.GMAIL_CLIENT_SECRET,
        redirect_uri: redirectUri(req),
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (tokens.error) return res.redirect(withParam(back, 'google_error', tokens.error_description || tokens.error));

    const features = featuresFromScope(tokens.scope);
    if (!features.includes(state.f)) return res.redirect(withParam(back, 'google_error', 'Google access was not granted'));

    if (!tokens.refresh_token) return res.redirect(withParam(back, 'google_error', 'Google did not return offline access - try again'));

    const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();
    await saveGrant(req.auth.user.id, {
      googleEmail: (profile.email || '').toLowerCase(),
      features,
      refreshToken: tokens.refresh_token,
    });
    res.redirect(withParam(back, 'google_connected', state.f));
  } catch (err) {
    res.redirect(withParam(back, 'google_error', err.message));
  }
}
