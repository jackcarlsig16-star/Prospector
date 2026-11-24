import crypto from 'crypto';
import { scopesFor, microsoftConfigured, authority, getGrant } from '../lib/microsoftGrants.js';
import { returnPath, withParam } from '../google/oauth.js';
import { redirectUri, STATE_COOKIE } from './oauth.js';

export const isOwner = auth => !!auth.isPlatformOwner || [...auth.roles.values()].includes('owner');

export function authorizeParams({ mode, grant, userEmail, redirect, state, verifier }) {
  return new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    redirect_uri: redirect,
    response_type: 'code',
    response_mode: 'query',
    scope: scopesFor(mode).join(' '),
    // select_account lets Reconnect pick a different mailbox; sending is added to the mailbox already connected.
    prompt: mode === 'send' ? 'consent' : 'select_account',
    login_hint: grant?.account_email || userEmail,
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state,
  });
}

// GET /api/microsoft/connect?return=/path[&scope=send] - sends the signed-in user to Microsoft's consent screen: the
// mail + calendar reads, or (owner only, scope=send) Mail.Send alone for the internal team emails.
export default async function handler(req, res) {
  const back = returnPath(req.query.return);
  const fail = msg => res.redirect(withParam(back, 'microsoft_error', msg));
  if (!microsoftConfigured()) return fail('Microsoft is not configured on the server');
  const mode = req.query.scope === 'send' ? 'send' : 'connect';
  const grant = await getGrant(req.auth.user.id);
  if (mode === 'send' && !isOwner(req.auth)) return fail('Only the owner enables team email sending');
  if (mode === 'send' && (!grant || grant.error)) return fail('Connect Microsoft first, then enable team email sending');

  const nonce = crypto.randomBytes(16).toString('base64url');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const state = Buffer.from(JSON.stringify({ n: nonce, u: req.auth.user.id, r: back, m: mode })).toString('base64url');
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${STATE_COOKIE}=${nonce}.${verifier}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax${secure}`);
  res.redirect(`${authority()}/authorize?${authorizeParams({ mode, grant, userEmail: req.auth.user.email, redirect: redirectUri(req), state, verifier })}`);
}
