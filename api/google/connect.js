import crypto from 'crypto';
import { GOOGLE_FEATURES, getGrant } from '../lib/googleGrants.js';
import { redirectUri, STATE_COOKIE, returnPath, withParam } from './oauth.js';

// GET /api/google/connect?feature=calendar&return=/path - sends the signed-in
// user to Google for just that feature. The browser only comes here from a
// "Connect ..." button, after the server said the feature isn't granted.
export default async function handler(req, res) {
  const feature = req.query.feature;
  const back = returnPath(req.query.return);
  if (!GOOGLE_FEATURES[feature]) return res.redirect(withParam(back, 'google_error', 'Unknown Google feature'));
  if (!process.env.GMAIL_CLIENT_ID || !process.env.GOOGLE_TOKEN_KEY) {
    return res.redirect(withParam(back, 'google_error', 'Google is not configured on the server'));
  }
  const grant = await getGrant(req.auth.user.id);

  const nonce = crypto.randomBytes(16).toString('base64url');
  const state = Buffer.from(JSON.stringify({ n: nonce, u: req.auth.user.id, f: feature, r: back })).toString('base64url');
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${STATE_COOKIE}=${nonce}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax${secure}`);

  const params = new URLSearchParams({
    client_id: process.env.GMAIL_CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: ['openid', 'email', ...GOOGLE_FEATURES[feature].scopes].join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    // Google only hands back a refresh token on a consent screen. People only
    // reach this route for a scope they haven't granted, which shows one anyway.
    prompt: 'consent',
    login_hint: grant?.google_email || req.auth.user.email,
    state,
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
