import { tokenSealer } from './tokenCrypto.js';
import { getServiceSupabase } from './authUser.js';

// Each Prospector feature asks Google only for what it needs, the first time it's used. One refresh token per
// ACCOUNT covers every feature granted on that account (include_granted_scopes). mailbox-connections-v1 REV2: a person
// may connect several Google accounts; exactly one is the default (what every user-level tool uses, unchanged), and a
// workspace may be tethered to one specific account (workspace_mailboxes) - never with a fallback to the default.
export const GOOGLE_FEATURES = {
  gmail:    { label: 'Gmail',           scopes: ['https://www.googleapis.com/auth/gmail.modify'] },
  calendar: { label: 'Google Calendar', scopes: ['https://www.googleapis.com/auth/calendar.readonly'] },
  slides:   { label: 'Google Slides',   scopes: ['https://www.googleapis.com/auth/presentations'] },
};
export const RECONNECT = 'needs_reconnect';
export const PURPOSES = ['drafts', 'inbox', 'calendar'];
export const PURPOSE_FEATURE = { drafts: 'gmail', inbox: 'gmail', calendar: 'calendar' };
const LAST_USED_EVERY_MS = 10 * 60_000;

// Google lets people untick individual scopes on the consent screen, so what a grant covers comes from the scopes
// Google actually returned.
export function featuresFromScope(scope) {
  const granted = new Set(String(scope || '').split(' '));
  return Object.keys(GOOGLE_FEATURES).filter(f => GOOGLE_FEATURES[f].scopes.every(s => granted.has(s)));
}

const sealer = tokenSealer('GOOGLE_TOKEN_KEY');
export const encryptToken = sealer.encrypt;
export const decryptToken = sealer.decrypt;

// Test seam: the client, fetch and the clock. Production never touches it.
export const deps = { supabase: () => getServiceSupabase(), fetch: (...a) => fetch(...a), now: () => Date.now() };
const grants = () => deps.supabase().from('google_grants');
const tethers = () => deps.supabase().from('workspace_mailboxes');
const COLS = 'id,user_id,google_email,features,refresh_token_enc,is_default,error,error_at,last_used_at,created_at,updated_at';
const fail = e => { throw new Error(e.message); };

export async function listGrants(userId) {
  const { data, error } = await grants().select(COLS).eq('user_id', userId).order('is_default', { ascending: false }).order('created_at');
  if (error) fail(error);
  return data || [];
}
// The DEFAULT account - the shape every existing caller relies on (google_email, features, refresh_token_enc).
export async function getGrant(userId) {
  const { data, error } = await grants().select(COLS).eq('user_id', userId).eq('is_default', true).maybeSingle();
  if (error) fail(error);
  return data;
}
export async function grantById(userId, grantId) {
  if (!grantId) return null;
  const { data, error } = await grants().select(COLS).eq('user_id', userId).eq('id', grantId).maybeSingle();
  if (error) fail(error);
  return data;
}

export class OtherLogin extends Error { constructor() { super('This Google account is connected to another Prospector login'); } }

// Access tokens live ~1h; minting one per request would add a Google round trip to every Gmail/Calendar call.
// Keyed by grant id (one person can hold several accounts).
const accessTokens = new Map();
const lastTouched = new Map();

// Upsert on (user_id, google_email): a first account becomes the default, later ones do not; reconnecting an existing
// account updates it in place (default flag + tethers kept) and clears its error. One inbox, one owner: an address
// already connected to another login is refused. Returns { id, google_email, is_default, created }.
export async function saveGrant(userId, { googleEmail, features, refreshToken }) {
  const email = String(googleEmail || '').toLowerCase();
  const now = new Date(deps.now()).toISOString();
  const { data: elsewhere, error: e0 } = await grants().select('id,user_id').eq('google_email', email).neq('user_id', userId);
  if (e0) fail(e0);
  if (elsewhere?.length) throw new OtherLogin();
  const { data: existing, error: e1 } = await grants().select(COLS).eq('user_id', userId).eq('google_email', email).maybeSingle();
  if (e1) fail(e1);
  if (existing) {
    const { error } = await grants().update({ features, refresh_token_enc: encryptToken(refreshToken), error: null, error_at: null, updated_at: now }).eq('id', existing.id);
    if (error) fail(error);
    accessTokens.delete(existing.id);
    return { id: existing.id, google_email: email, is_default: existing.is_default, created: false };
  }
  const mine = await listGrants(userId);
  const { data, error } = await grants().insert({ user_id: userId, google_email: email, features, refresh_token_enc: encryptToken(refreshToken), is_default: mine.length === 0, error: null, error_at: null, updated_at: now }).select(COLS).single();
  if (error) fail(error);
  return { id: data.id, google_email: email, is_default: data.is_default, created: true };
}

// Without an id: the default account (today's Disconnect). With one: that account. Tethers cascade in the DB.
// Nothing is promoted afterwards.
export async function deleteGrant(userId, grantId = null) {
  const target = grantId ? await grantById(userId, grantId) : await getGrant(userId);
  if (!target) return false;
  accessTokens.delete(target.id);
  const { error } = await grants().delete().eq('id', target.id).eq('user_id', userId);
  if (error) fail(error);
  return true;
}

export async function setDefault(userId, grantId) {
  const target = await grantById(userId, grantId);
  if (!target) return null;
  const now = new Date(deps.now()).toISOString();
  const { error: e1 } = await grants().update({ is_default: false, updated_at: now }).eq('user_id', userId).eq('is_default', true);
  if (e1) fail(e1);
  const { error: e2 } = await grants().update({ is_default: true, updated_at: now }).eq('id', target.id);
  if (e2) fail(e2);
  return { ...target, is_default: true };
}

// invalid_grant = revoked at Google, expired (External + Testing apps: 7 days) or unused for 6 months. The row and its
// tethers stay; the account is flagged so the map shows Reconnect and a workspace stops instead of falling back.
export async function flagReconnect(grantId) {
  accessTokens.delete(grantId);
  const now = new Date(deps.now()).toISOString();
  const { error } = await grants().update({ error: RECONNECT, error_at: now, updated_at: now }).eq('id', grantId);
  if (error) fail(error);
}

export class NeedsGoogle extends Error {
  constructor(feature, reconnectGrant = null) { super(reconnectGrant ? 'Reconnect this Google account to use this' : `Connect ${GOOGLE_FEATURES[feature].label} to use this`); this.feature = feature; this.reconnectGrant = reconnectGrant; }
}

async function touchLastUsed(grant) {
  const t = deps.now();
  if (t - (lastTouched.get(grant.id) || 0) < LAST_USED_EVERY_MS) return;
  lastTouched.set(grant.id, t);
  await grants().update({ last_used_at: new Date(t).toISOString() }).eq('id', grant.id);
}

export async function accessTokenForGrant(grant, feature) {
  if (!grant || !grant.features?.includes(feature)) throw new NeedsGoogle(feature);
  if (grant.error) throw new NeedsGoogle(feature, grant);
  const hit = accessTokens.get(grant.id);
  if (hit && hit.exp - deps.now() > 60_000) { await touchLastUsed(grant); return hit.token; }
  const r = await deps.fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GMAIL_CLIENT_ID, client_secret: process.env.GMAIL_CLIENT_SECRET, refresh_token: decryptToken(grant.refresh_token_enc), grant_type: 'refresh_token' }),
  });
  const data = await r.json();
  if (data.error === 'invalid_grant') { await flagReconnect(grant.id); throw new NeedsGoogle(feature, { ...grant, error: RECONNECT }); }
  if (data.error) throw new Error(`Google token refresh failed: ${data.error_description || data.error}`);
  accessTokens.set(grant.id, { token: data.access_token, exp: deps.now() + (data.expires_in || 3600) * 1000 });
  await touchLastUsed(grant);
  return data.access_token;
}

async function accessTokenFor(userId, feature) {
  return accessTokenForGrant(await getGrant(userId), feature);
}

// For route handlers: the user's DEFAULT account's token for this feature, or null after sending the response.
// 409 + needs_google tells the browser to show a "Connect <feature>" button - never an automatic redirect. A flagged
// default reads exactly like "no grant" to these callers.
export async function googleTokenFor(req, res, feature) {
  try {
    return await accessTokenFor(req.auth.user.id, feature);
  } catch (err) {
    if (err instanceof NeedsGoogle) res.status(409).json({ error: err.message, needs_google: err.feature });
    else res.status(500).json({ error: err.message });
    return null;
  }
}

// Tethers. One Google mailbox per person per workspace; a purpose counts only when the account's features cover it.
export const purposesCovered = (purposes, features) => (purposes || []).filter(p => PURPOSES.includes(p) && features?.includes(PURPOSE_FEATURE[p]));
export async function listTethers(userId) {
  const { data, error } = await tethers().select('business_id,user_id,provider,google_grant_id,purposes,created_at,updated_at').eq('user_id', userId);
  if (error) fail(error);
  return data || [];
}
export async function setTether(businessId, userId, grantId, purposes) {
  const now = new Date(deps.now()).toISOString();
  const { data, error } = await tethers().upsert({ business_id: businessId, user_id: userId, provider: 'google', google_grant_id: grantId, purposes, updated_at: now }, { onConflict: 'business_id,user_id,provider' }).select();
  if (error) fail(error);
  return data?.[0] || null;
}
export async function removeTether(businessId, userId) {
  const { error } = await tethers().delete().eq('business_id', businessId).eq('user_id', userId).eq('provider', 'google');
  if (error) fail(error);
}

// The exact mailbox a workspace uses for a purpose - or null. NO fallback to the default, ever.
export async function mailboxFor(businessId, userId, purpose) {
  const { data, error } = await tethers().select('business_id,user_id,provider,google_grant_id,purposes').eq('business_id', businessId).eq('user_id', userId).eq('provider', 'google').maybeSingle();
  if (error) fail(error);
  if (!data || !data.purposes?.includes(purpose)) return null;
  const grant = await grantById(userId, data.google_grant_id);
  if (!grant) return null;
  return { grant, tether: data, state: grant.error ? RECONNECT : 'ok' };
}

// For workspace routes: the tethered account's token, or null after sending 409 { needs_mailbox } (no tether) /
// 409 { needs_reconnect, email } (the tethered account is flagged, or just failed to refresh).
export async function tokenForMailbox(req, res, businessId, purpose) {
  const userId = req.auth.user.id;
  try {
    const m = await mailboxFor(businessId, userId, purpose);
    if (!m) { res.status(409).json({ error: `Link a Google mailbox to this workspace for ${purpose} first`, needs_mailbox: purpose }); return null; }
    if (m.state === RECONNECT) { res.status(409).json({ error: 'Reconnect this Google account', needs_reconnect: m.grant.id, email: m.grant.google_email }); return null; }
    return await accessTokenForGrant(m.grant, PURPOSE_FEATURE[purpose]);
  } catch (err) {
    if (err instanceof NeedsGoogle && err.reconnectGrant) res.status(409).json({ error: 'Reconnect this Google account', needs_reconnect: err.reconnectGrant.id, email: err.reconnectGrant.google_email });
    else if (err instanceof NeedsGoogle) res.status(409).json({ error: err.message, needs_google: err.feature });
    else res.status(500).json({ error: err.message });
    return null;
  }
}
