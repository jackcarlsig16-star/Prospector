import { tokenSealer } from './tokenCrypto.js';
import { getServiceSupabase } from './authUser.js';
import { errorFamily } from '../microsoft/errorFamily.js';

// One Microsoft 365 grant per user. openid is sign-in only (the id token carries the tenant). Connect asks for the
// reads alone: a tenant that gates Mail.Send behind an admin bounces the WHOLE consent screen when it rides along, so
// sending (the internal team emails only) is the owner's separate consent, merged into the same grant.
export const TEAM_EMAIL_SCOPE = 'Mail.Send';
export const CONNECT_SCOPES = ['openid', 'offline_access', 'User.Read', 'Mail.Read', 'Calendars.Read'];
export const SEND_SCOPES = ['openid', 'offline_access', TEAM_EMAIL_SCOPE];
export const MICROSOFT_SCOPES = [...CONNECT_SCOPES, TEAM_EMAIL_SCOPE];
export const scopesFor = mode => (mode === 'send' ? SEND_SCOPES : CONNECT_SCOPES);
export const mergeScopes = (held, granted) => [...new Map([...(held || []), ...granted].map(s => [s.toLowerCase(), s])).values()];
const REQUIRED = ['User.Read', 'Mail.Read', 'Calendars.Read'];
export const canSendTeamEmail = grant => !!grant && !grant.error && (grant.scopes || []).some(s => s.toLowerCase() === TEAM_EMAIL_SCOPE.toLowerCase());
// A refresh asks for exactly what the grant already holds: asking for a scope the person never consented to fails
// with interaction_required, which would mark a working grant "reconnect" the day a scope is added.
export const refreshScopes = grant => [...new Set(['offline_access', ...(grant.scopes || [])])];
// The families a reconnect fixes; anything else (server setup, a Microsoft outage) is not the grant's fault.
const GRANT_FAMILIES = new Set(['expired', 'sign_in', 'needs_admin']);

export const microsoftConfigured = () =>
  !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET && process.env.MICROSOFT_TENANT_ID && process.env.MICROSOFT_TOKEN_KEY);

export const authority = () => process.env.MICROSOFT_AUTHORITY || `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0`;

// Graph returns its scopes without the resource prefix; anything we didn't
// ask for (profile, email) isn't worth keeping.
export function grantedScopes(scope) {
  const asked = new Set(MICROSOFT_SCOPES.map(s => s.toLowerCase()));
  return String(scope || '').split(' ').map(s => s.replace(/^https:\/\/graph\.microsoft\.com\//i, '')).filter(s => asked.has(s.toLowerCase()));
}
export const missingScopes = scopes => REQUIRED.filter(r => !scopes.some(s => s.toLowerCase() === r.toLowerCase()));

const sealer = tokenSealer('MICROSOFT_TOKEN_KEY');
const db = () => getServiceSupabase().from('microsoft_grants');

export async function getGrant(userId) {
  const { data, error } = await db().select('account_email,tenant_id,scopes,refresh_token_enc,connected_at,last_used_at,updated_at,error').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// Access tokens live ~1h; minting one per request would add a Microsoft
// round trip to every Graph call.
const accessTokens = new Map();
const refreshing = new Map();

export async function saveGrant(userId, { accountEmail, tenantId, scopes, refreshToken }) {
  const now = new Date().toISOString();
  const { error } = await db().upsert({
    user_id: userId, account_email: accountEmail, tenant_id: tenantId, scopes,
    refresh_token_enc: sealer.encrypt(refreshToken), connected_at: now, last_used_at: null, error: null, updated_at: now,
  }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
  accessTokens.delete(userId);
}

export async function deleteGrant(userId) {
  accessTokens.delete(userId);
  const { error } = await db().delete().eq('user_id', userId);
  if (error) throw new Error(error.message);
}

export class NeedsMicrosoft extends Error {
  constructor(message = 'Connect Microsoft to use this') { super(message); }
}

export const refreshBody = (grant, refreshToken) => new URLSearchParams({
  client_id: process.env.MICROSOFT_CLIENT_ID,
  client_secret: process.env.MICROSOFT_CLIENT_SECRET,
  refresh_token: refreshToken,
  grant_type: 'refresh_token',
  scope: refreshScopes(grant).join(' '),
});

async function refresh(userId, grant) {
  const r = await fetch(`${authority()}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: refreshBody(grant, sealer.decrypt(grant.refresh_token_enc)),
  });
  const data = await r.json();
  const now = new Date().toISOString();
  if (data.error) {
    const f = errorFamily({ error: data.error, description: data.error_description, codes: data.error_codes }, grant.scopes);
    if (!GRANT_FAMILIES.has(f.family)) throw new Error(`Microsoft token refresh failed: ${f.text}`);
    // The row stays so the screen can say which account needs reconnecting, and why.
    const message = `Microsoft access ${f.text} - reconnect`;
    await db().update({ error: message, updated_at: now }).eq('user_id', userId);
    throw new NeedsMicrosoft(message);
  }
  // Microsoft hands back a new refresh token each time; store it so the
  // 90-day inactivity clock keeps resetting.
  const patch = { last_used_at: now, error: null, updated_at: now };
  if (data.refresh_token) patch.refresh_token_enc = sealer.encrypt(data.refresh_token);
  const { error } = await db().update(patch).eq('user_id', userId);
  if (error) throw new Error(error.message);
  accessTokens.set(userId, { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 });
  return data.access_token;
}

// retry = Check connection: ask Microsoft again even though the row holds an error (an admin may have approved since).
export async function accessTokenFor(userId, { retry = false } = {}) {
  const hit = accessTokens.get(userId);
  if (!retry && hit && hit.exp - Date.now() > 60_000) return hit.token;
  const grant = await getGrant(userId);
  if (!grant) throw new NeedsMicrosoft();
  if (grant.error && !retry) throw new NeedsMicrosoft(grant.error);
  // Two Graph calls at once would otherwise both spend the same refresh token.
  if (!refreshing.has(userId)) refreshing.set(userId, refresh(userId, grant).finally(() => refreshing.delete(userId)));
  return refreshing.get(userId);
}

// For route handlers: the user's Graph access token, or null after sending
// the response. 409 + needs_microsoft tells the browser to show Connect.
export async function microsoftTokenFor(req, res) {
  try {
    return await accessTokenFor(req.auth.user.id);
  } catch (err) {
    if (err instanceof NeedsMicrosoft) res.status(409).json({ error: err.message, needs_microsoft: true });
    else res.status(500).json({ error: err.message });
    return null;
  }
}
