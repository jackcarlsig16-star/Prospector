import { tokenSealer } from './tokenCrypto.js';
import { getServiceSupabase } from './authUser.js';

// Each Prospector feature asks Google only for what it needs, the first time
// it's used. One refresh token per user covers every feature they've granted
// (include_granted_scopes), so the grant is a row per user, not per feature.
export const GOOGLE_FEATURES = {
  gmail:    { label: 'Gmail',           scopes: ['https://www.googleapis.com/auth/gmail.modify'] },
  calendar: { label: 'Google Calendar', scopes: ['https://www.googleapis.com/auth/calendar.readonly'] },
  slides:   { label: 'Google Slides',   scopes: ['https://www.googleapis.com/auth/presentations'] },
};

// Google lets people untick individual scopes on the consent screen, so what
// a grant covers comes from the scopes Google actually returned.
export function featuresFromScope(scope) {
  const granted = new Set(String(scope || '').split(' '));
  return Object.keys(GOOGLE_FEATURES).filter(f => GOOGLE_FEATURES[f].scopes.every(s => granted.has(s)));
}

const sealer = tokenSealer('GOOGLE_TOKEN_KEY');
export const encryptToken = sealer.encrypt;
export const decryptToken = sealer.decrypt;

export async function getGrant(userId) {
  const { data, error } = await getServiceSupabase().from('google_grants')
    .select('google_email,features,refresh_token_enc').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// Access tokens live ~1h; minting one per request would add a Google round
// trip to every Gmail/Calendar call.
const accessTokens = new Map();

export async function saveGrant(userId, { googleEmail, features, refreshToken }) {
  const { error } = await getServiceSupabase().from('google_grants').upsert({
    user_id: userId,
    google_email: googleEmail,
    features,
    refresh_token_enc: encryptToken(refreshToken),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
  accessTokens.delete(userId);
}

export async function deleteGrant(userId) {
  accessTokens.delete(userId);
  const { error } = await getServiceSupabase().from('google_grants').delete().eq('user_id', userId);
  if (error) throw new Error(error.message);
}

class NeedsGoogle extends Error {
  constructor(feature) { super(`Connect ${GOOGLE_FEATURES[feature].label} to use this`); this.feature = feature; }
}

async function accessTokenFor(userId, feature) {
  const grant = await getGrant(userId);
  if (!grant?.features.includes(feature)) throw new NeedsGoogle(feature);
  const hit = accessTokens.get(userId);
  if (hit && hit.exp - Date.now() > 60_000) return hit.token;

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: decryptToken(grant.refresh_token_enc),
      grant_type: 'refresh_token',
    }),
  });
  const data = await r.json();
  // invalid_grant = revoked at Google, or unused for 6 months: the stored
  // grant is dead, so drop it and ask again rather than fail on every call.
  if (data.error === 'invalid_grant') { await deleteGrant(userId); throw new NeedsGoogle(feature); }
  if (data.error) throw new Error(`Google token refresh failed: ${data.error_description || data.error}`);
  accessTokens.set(userId, { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 });
  return data.access_token;
}

// For route handlers: the user's Google access token for this feature, or
// null after sending the response. 409 + needs_google tells the browser to
// show a "Connect <feature>" button - never an automatic redirect.
export async function googleTokenFor(req, res, feature) {
  try {
    return await accessTokenFor(req.auth.user.id, feature);
  } catch (err) {
    if (err instanceof NeedsGoogle) res.status(409).json({ error: err.message, needs_google: err.feature });
    else res.status(500).json({ error: err.message });
    return null;
  }
}
