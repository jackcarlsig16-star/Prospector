import { authority, scopesFor, grantedScopes, missingScopes, mergeScopes, saveGrant, getGrant, TEAM_EMAIL_SCOPE } from '../lib/microsoftGrants.js';
import { returnPath, withParam } from '../google/oauth.js';
import { redirectUri, STATE_COOKIE, readCookie, idTokenClaims } from './oauth.js';
import { errorFamily, OTHER_ORG_TEXT } from './errorFamily.js';

function parseState(raw) {
  try { return JSON.parse(Buffer.from(String(raw || ''), 'base64url').toString('utf8')); } catch { return null; }
}

const has = (scopes, scope) => scopes.some(s => s.toLowerCase() === scope.toLowerCase());

// What a finished consent becomes: the grant to store, or the sentence to show. Sending is merged into the mailbox
// already connected - a different account on that screen would silently swap whose mail is read.
export function grantFromTokens({ mode, existing, tokens, accountEmail, tid, tenantId }) {
  if (tid && tenantId && tid !== tenantId) return { error: `Microsoft: ${OTHER_ORG_TEXT}` };
  if (!tokens.refresh_token) return { error: 'Microsoft did not return offline access - try again' };
  const granted = grantedScopes(tokens.scope);
  if (mode === 'send') {
    if (!existing) return { error: 'Connect Microsoft first, then enable team email sending' };
    if (existing.account_email !== accountEmail) return { error: 'Enable sending from the same mailbox you connected' };
    if (!has(granted, TEAM_EMAIL_SCOPE)) return { error: `Microsoft didn't grant ${TEAM_EMAIL_SCOPE}` };
  }
  const scopes = mode === 'send' ? mergeScopes(existing.scopes, granted) : granted;
  const missing = missingScopes(scopes);
  if (missing.length) return { error: `Microsoft didn't grant ${missing.join(', ')}` };
  return { grant: { accountEmail, tenantId: tid || tenantId, scopes, refreshToken: tokens.refresh_token } };
}

// GET /api/microsoft/callback - Microsoft's redirect back. Tokens are stored
// server-side against the signed-in user; the browser only gets ?microsoft_connected.
export default async function handler(req, res) {
  // The admin consent link lands here too, with no state and no code.
  if (req.query.admin_consent !== undefined && !req.query.code) {
    return res.redirect(String(req.query.admin_consent).toLowerCase() === 'true' && !req.query.error
      ? withParam('/', 'microsoft_connected', 'admin')
      : withParam('/', 'microsoft_error', 'Microsoft admin consent was not given'));
  }
  const state = parseState(req.query.state);
  const back = returnPath(state?.r);
  const mode = state?.m === 'send' ? 'send' : 'connect';
  const asked = scopesFor(mode);
  const [nonce, verifier] = (readCookie(req, STATE_COOKIE) || '').split('.');
  res.setHeader('Set-Cookie', `${STATE_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
  const fail = msg => res.redirect(withParam(back, 'microsoft_error', msg));
  const failFamily = e => fail(`Microsoft: ${errorFamily(e, asked).text}`);

  // The nonce cookie proves this browser started the flow; the user id proves
  // the same person is still signed in, so a grant can't land on someone else.
  if (!state || !nonce || !verifier || state.n !== nonce || state.u !== req.auth.user.id) {
    return fail('Microsoft sign-in expired or was started in another session - try again');
  }
  if (req.query.error) return failFamily({ error: req.query.error, description: req.query.error_description });
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
        scope: asked.join(' '),
      }),
    });
    const tokens = await tokenRes.json();
    if (tokens.error) return failFamily({ error: tokens.error, description: tokens.error_description, codes: tokens.error_codes });

    const meRes = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const me = await meRes.json();
    if (!meRes.ok) return fail(`Microsoft profile read failed: ${me.error?.code || meRes.status}`);
    const out = grantFromTokens({
      mode, tokens,
      existing: mode === 'send' ? await getGrant(req.auth.user.id) : null,
      accountEmail: String(me.mail || me.userPrincipalName || '').toLowerCase(),
      tid: idTokenClaims(tokens.id_token).tid,
      tenantId: process.env.MICROSOFT_TENANT_ID,
    });
    if (out.error) return fail(out.error);
    await saveGrant(req.auth.user.id, out.grant);
    res.redirect(withParam(back, 'microsoft_connected', mode === 'send' ? 'send' : '1'));
  } catch (err) {
    fail(err.message);
  }
}
