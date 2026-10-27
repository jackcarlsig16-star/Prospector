import crypto from 'crypto';
import { GOOGLE_FEATURES, PURPOSES, getGrant, grantById } from '../lib/googleGrants.js';
import { redirectUri, STATE_COOKIE, returnPath, withParam } from './oauth.js';

// GET /api/google/connect?feature=calendar&return=/path - sends the signed-in user to Google for just that feature.
// mailbox-connections-v1 REV2 (M4): ?account=new shows Google's account picker (no login_hint); ?grant=<id> steers to
// that one account (adding a scope to it, or reconnecting it); neither = the default account, today's behaviour.
// ?business=<id>&purposes=drafts,inbox asks the callback to tether that workspace to whatever account Google returns
// (member+ only, checked in the callback). The browser only comes here from a "Connect ..." button.
const UUID = /^[0-9a-f-]{36}$/i;
export default async function handler(req, res) {
  const feature = req.query.feature;
  const back = returnPath(req.query.return);
  if (!GOOGLE_FEATURES[feature]) return res.redirect(withParam(back, 'google_error', 'Unknown Google feature'));
  if (!process.env.GMAIL_CLIENT_ID || !process.env.GOOGLE_TOKEN_KEY) {
    return res.redirect(withParam(back, 'google_error', 'Google is not configured on the server'));
  }
  const userId = req.auth.user.id;
  const wantNew = req.query.account === 'new';
  const pinned = !wantNew && UUID.test(String(req.query.grant || '')) ? await grantById(userId, req.query.grant) : null;
  const grant = wantNew || pinned ? pinned : await getGrant(userId);
  const business = UUID.test(String(req.query.business || '')) ? req.query.business : null;
  const purposes = business ? String(req.query.purposes || '').split(',').map(s => s.trim()).filter(p => PURPOSES.includes(p)) : [];

  const nonce = crypto.randomBytes(16).toString('base64url');
  const state = Buffer.from(JSON.stringify({ n: nonce, u: userId, f: feature, r: back, ...(business && purposes.length ? { b: business, p: purposes } : {}), ...(pinned ? { g: pinned.id } : {}), ...(wantNew ? { a: 'new' } : {}) })).toString('base64url');
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${STATE_COOKIE}=${nonce}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax${secure}`);

  const params = new URLSearchParams({
    client_id: process.env.GMAIL_CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: ['openid', 'email', ...GOOGLE_FEATURES[feature].scopes].join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    // Google only hands back a refresh token on a consent screen. select_account first when adding an account, so
    // Google asks which one instead of silently reusing the signed-in session.
    prompt: wantNew ? 'select_account consent' : 'consent',
    state,
  });
  if (!wantNew) params.set('login_hint', grant?.google_email || req.auth.user.email);
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
