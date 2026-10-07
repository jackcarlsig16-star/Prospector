import { authority, MICROSOFT_SCOPES, grantedScopes, missingScopes, saveGrant } from '../lib/microsoftGrants.js';
import { returnPath, withParam } from '../google/oauth.js';
import { redirectUri, STATE_COOKIE, readCookie, idTokenClaims } from './oauth.js';

function parseState(raw) {
  try { return JSON.parse(Buffer.from(String(raw || ''), 'base64url').toString('utf8')); } catch { return null; }
}

// GET /api/microsoft/callback - Microsoft's redirect back. Tokens are stored
// server-side against the signed-in user; the browser only gets ?microsoft_connected.
export default async function handler(req, res) {
  const state = parseState(req.query.state);
  const back = returnPath(state?.r);
  const [nonce, verifier] = (readCookie(req, STATE_COOKIE) || '').split('.');
  res.setHeader('Set-Cookie', `${STATE_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
  const fail = msg => res.redirect(withParam(back, 'microsoft_error', msg));

  // The nonce cookie proves this browser started the flow; the user id proves
  // the same person is still signed in, so a grant can't land on someone else.
  if (!state || !nonce || !verifier || state.n !== nonce || state.u !== req.auth.user.id) {
    return fail('Microsoft sign-in expired or was started in another session - try again');
  }
  if (req.query.error) return fail(req.query.error === 'access_denied' ? 'Microsoft access was not granted' : String(req.query.error_description || req.query.error).split('\n')[0].slice(0, 200));
  if (!req.query.code) return fail('Microsoft returned no code');

  try {
    const tokenRes = await fetch(`${authority()}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET,
        code: req.query.code,
        redirect_uri: redirectUri(req),
        grant_type: 'authorization_code',
        code_verifier: verifier,
        scope: MICROSOFT_SCOPES.join(' '),
      }),
    });
    const tokens = await tokenRes.json();
    if (tokens.error) return fail(String(tokens.error_description || tokens.error).split('\n')[0].slice(0, 200));

    const scopes = grantedScopes(tokens.scope);
    const missing = missingScopes(scopes);
    if (missing.length) return fail(`Microsoft didn't grant ${missing.join(', ')}`);
    if (!tokens.refresh_token) return fail('Microsoft did not return offline access - try again');

    const meRes = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const me = await meRes.json();
    if (!meRes.ok) return fail(`Microsoft profile read failed: ${me.error?.code || meRes.status}`);
    const claims = idTokenClaims(tokens.id_token);
    await saveGrant(req.auth.user.id, {
      accountEmail: String(me.mail || me.userPrincipalName || '').toLowerCase(),
      tenantId: claims.tid || process.env.MICROSOFT_TENANT_ID,
      scopes,
      refreshToken: tokens.refresh_token,
    });
    res.redirect(withParam(back, 'microsoft_connected', '1'));
  } catch (err) {
    fail(err.message);
  }
}
