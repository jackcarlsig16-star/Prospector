import { getServiceSupabase, getAccessToken } from './authUser.js';
import { roleAtLeast } from '../../src/constants/roles.js';
import { isAllowlistedBusiness } from '../sales/allowlist.js';

// prospector-auth-v1 Stage 3 - server enforcement. sessionAuth runs on every
// /api and /proxy request (server.js) and attaches req.auth; the gates below
// add per-workspace role checks. Memberships are re-read on every request,
// so a role change applies on the next call.

// Exact method + path only - third parties and pre-sign-in pages.
const EXEMPT = [
  { method: 'POST', path: /^\/api\/zoom\/webhook$/ },  // Zoom signs its own requests
  { method: 'GET', path: /^\/api\/invites\/[^/]+$/ },  // invite page shows the invite before sign-in
];

// Sign-up is open (any Google account gets a profile), so being signed in
// isn't enough: everything else needs a workspace. These are the routes the
// first-run and invite flows hit before a membership exists.
const NO_WORKSPACE_OK = [
  { method: 'GET', path: /^\/api\/me$/ },
  { method: 'POST', path: /^\/api\/me\/welcome$/ },
  { method: 'POST', path: /^\/api\/invites\/[^/]+\/accept$/ },
];

// Verifying with Supabase costs a network round trip, so a verified token is
// trusted for this long. Sign-out/revocation therefore lags by up to a minute.
const TOKEN_TRUST_MS = 60_000;
const verifiedTokens = new Map();

async function userForToken(supabase, token) {
  const hit = verifiedTokens.get(token);
  if (hit && Date.now() - hit.at < TOKEN_TRUST_MS) return hit.user;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) { verifiedTokens.delete(token); return null; }
  if (verifiedTokens.size > 500) verifiedTokens.clear();
  verifiedTokens.set(token, { user: data.user, at: Date.now() });
  return data.user;
}

export async function sessionAuth(req, res, next) {
  const path = req.originalUrl.split('?')[0];
  if (EXEMPT.some(e => e.method === req.method && e.path.test(path))) return next();

  const token = getAccessToken(req);
  if (!token) return res.status(401).json({ error: 'Sign in required' });
  const supabase = getServiceSupabase();
  const user = await userForToken(supabase, token);
  if (!user) return res.status(401).json({ error: 'Your session expired - sign in again' });

  const [{ data: profile, error: pErr }, { data: memberships, error: mErr }] = await Promise.all([
    supabase.from('profiles').select('display_name,is_platform_owner').eq('id', user.id).maybeSingle(),
    supabase.from('business_members').select('business_id,role').eq('user_id', user.id),
  ]);
  if (pErr || mErr) return res.status(500).json({ error: (pErr || mErr).message });
  if (!profile) return res.status(403).json({ error: 'Confirm your email address to finish setting up your account' });

  req.auth = {
    user: { id: user.id, email: (user.email || '').toLowerCase(), name: profile.display_name },
    isPlatformOwner: profile.is_platform_owner,
    roles: new Map(memberships.map(m => [m.business_id, m.role])),
  };
  if (!profile.is_platform_owner && !memberships.length && !NO_WORKSPACE_OK.some(e => e.method === req.method && e.path.test(path))) {
    return res.status(403).json({ error: "You're not in a workspace yet - ask a workspace admin for an invite" });
  }
  next();
}

export function hasRole(req, businessId, minRole) {
  return req.auth.isPlatformOwner || roleAtLeast(req.auth.roles.get(businessId), minRole);
}

function deny(res, minRole) {
  res.status(403).json({ error: `You need ${minRole} access to this workspace` });
}

// Workspace identity/settings edits. Everything else that writes is member-level.
const ADMIN_BUSINESS_PATHS = /^\/(emoji|website-url|social-links)\/?$/;
// Members & Access - admin for every method, reads included (emails, roles).
const ACCESS_PATHS = /^\/(members|invites)(\/|$)/;

// Mounted at /api/businesses/:id (server.js). GET = viewer, write = member,
// settings and member management = admin.
export function businessGate(req, res, next) {
  const minRole = ACCESS_PATHS.test(req.path) ? 'admin'
    : req.method === 'GET' ? 'viewer'
    : ADMIN_BUSINESS_PATHS.test(req.path) ? 'admin' : 'member';
  if (!hasRole(req, req.params.id, minRole)) return deny(res, minRole);
  next();
}

// Mounted at /api/sales/:businessId. The allowlist stays as a FEATURE gate:
// the sync runs on the one APOLLO_API_KEY, so letting any workspace call it
// would copy HomeLover's Apollo data into that workspace.
export function salesGate(req, res, next) {
  if (!isAllowlistedBusiness(req.params.businessId)) {
    return res.status(403).json({ error: 'Sales analytics is not enabled for this workspace' });
  }
  const minRole = req.method === 'GET' ? 'viewer' : 'member';
  if (!hasRole(req, req.params.businessId, minRole)) return deny(res, minRole);
  next();
}

// Mounted at /api/projects/:id and /api/campaigns/:id - the workspace comes
// from the row itself. Rows with no business_id are platform-owner only.
export function parentGate(table) {
  return async (req, res, next) => {
    const { data, error } = await getServiceSupabase().from(table).select('business_id').eq('id', req.params.id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: `${table.slice(0, -1)} not found` });
    const minRole = req.method === 'GET' ? 'viewer' : 'member';
    if (data.business_id ? !hasRole(req, data.business_id, minRole) : !req.auth.isPlatformOwner) return deny(res, minRole);
    next();
  };
}

export function platformOwnerOnly(req, res, next) {
  if (!req.auth.isPlatformOwner) return res.status(403).json({ error: 'Only the platform owner can do this' });
  next();
}

// Per-user cap on the Anthropic proxy so a leaked session can't burn credits
// (REVISABLE). The platform owner gets more room because bulk Assay runs
// through this proxy one or more calls per account.
export const ANTHROPIC_PER_HOUR = { member: 60, platformOwner: 600 };
const anthropicCalls = new Map();

export function anthropicRateLimit(req, res, next, now = Date.now()) {
  const limit = req.auth.isPlatformOwner ? ANTHROPIC_PER_HOUR.platformOwner : ANTHROPIC_PER_HOUR.member;
  const recent = (anthropicCalls.get(req.auth.user.id) || []).filter(t => now - t < 3600e3);
  if (recent.length >= limit) {
    res.set('Retry-After', String(Math.ceil((recent[0] + 3600e3 - now) / 1000)));
    return res.status(429).json({ error: `AI request limit reached (${limit}/hour). Try again later.` });
  }
  recent.push(now);
  anthropicCalls.set(req.auth.user.id, recent);
  next();
}
