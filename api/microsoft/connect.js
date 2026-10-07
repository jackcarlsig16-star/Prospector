import crypto from 'crypto';
import { MICROSOFT_SCOPES, microsoftConfigured, authority, getGrant } from '../lib/microsoftGrants.js';
import { returnPath, withParam } from '../google/oauth.js';
import { redirectUri, STATE_COOKIE } from './oauth.js';

// GET /api/microsoft/connect?return=/path - sends the signed-in user to
// Microsoft's consent screen (read-only mail + calendar).
export default async function handler(req, res) {
  const back = returnPath(req.query.return);
  if (!microsoftConfigured()) return res.redirect(withParam(back, 'microsoft_error', 'Microsoft is not configured on the server'));
  const grant = await getGrant(req.auth.user.id);

  const nonce = crypto.randomBytes(16).toString('base64url');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const state = Buffer.from(JSON.stringify({ n: nonce, u: req.auth.user.id, r: back })).toString('base64url');
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${STATE_COOKIE}=${nonce}.${verifier}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax${secure}`);

  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    response_mode: 'query',
    scope: MICROSOFT_SCOPES.join(' '),
    // Lets Reconnect pick a different mailbox (the .ai -> .io switch).
    prompt: 'select_account',
    login_hint: grant?.account_email || req.auth.user.email,
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state,
  });
  res.redirect(`${authority()}/authorize?${params}`);
}
