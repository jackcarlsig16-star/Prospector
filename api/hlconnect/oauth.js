// homelover-clients-v1 C11 - the OAuth 2.1 authorization server behind the HomeLover Claude connector (/hl/mcp). Its own
// module, client registry, tables (hl_oauth_*) and route prefix; it imports only shared libs and the sales module. Public
// clients, PKCE S256, Claude's Client ID Metadata Document or Dynamic Client Registration; codes + tokens stored only as
// SHA-256 hashes; the browser carries only a request id + allow / deny. Issuer = <origin>/hl, so its metadata sits at
// /.well-known/oauth-authorization-server/hl. Only a member (or above) of exactly one HomeLover sales workspace
// (SALES_ANALYTICS_BUSINESS_IDS) can connect.
import crypto from 'node:crypto';
import { getServiceSupabase, getAccessToken } from '../lib/authUser.js';
import { userForToken } from '../lib/requireAuth.js';
import { roleAtLeast } from '../../src/constants/roles.js';
import { getAllowlistedBusinessIds } from '../sales/allowlist.js';

export const SCOPE = 'hl';
export const PREFIX = '/hl';
export const CLAUDE_CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
export const CIMD_PREFIX = 'https://claude.ai/';
export const REQUEST_TTL_MS = 10 * 60_000, CODE_TTL_MS = 60_000, ACCESS_TTL_MS = 60 * 60_000, REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;
const REGISTER_PER_HOUR = 20;
const CIMD_TIMEOUT_MS = 5000, CIMD_MAX_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = () => crypto.randomBytes(32).toString('base64url');
const s256 = verifier => crypto.createHash('sha256').update(verifier).digest('base64url');

export const oauthDeps = (d = {}) => ({
  supabase: d.supabase || getServiceSupabase(),
  fetch: d.fetch || ((...a) => fetch(...a)),
  now: d.now || (() => new Date()),
  sessionUser: d.sessionUser || (async req => { const t = getAccessToken(req); return t ? userForToken(getServiceSupabase(), t) : null; }),
  workspaceIds: d.workspaceIds || getAllowlistedBusinessIds,
});

export const originOf = req => `${req.protocol}://${req.get('host')}`;
export const issuerOf = req => `${originOf(req)}${PREFIX}`;
export const mcpUrlOf = req => `${originOf(req)}${PREFIX}/mcp`;
export const resourceMetadataUrlOf = req => `${originOf(req)}/.well-known/oauth-protected-resource${PREFIX}/mcp`;

// GET /.well-known/oauth-protected-resource/hl/mcp (RFC 9728) and /hl/.well-known/oauth-protected-resource
export function protectedResourceRoute(req, res) {
  res.json({ resource: mcpUrlOf(req), authorization_servers: [issuerOf(req)], scopes_supported: [SCOPE], bearer_methods_supported: ['header'], resource_name: 'HomeLover Prospector' });
}

// GET /.well-known/oauth-authorization-server/hl (RFC 8414 path form), /hl/.well-known/oauth-authorization-server and
// /.well-known/openid-configuration/hl (clients that try the OIDC name first).
export function authServerMetadataRoute(req, res) {
  const i = issuerOf(req);
  res.json({
    issuer: i, authorization_endpoint: `${i}/oauth/authorize`, token_endpoint: `${i}/oauth/token`, registration_endpoint: `${i}/oauth/register`,
    code_challenge_methods_supported: ['S256'], grant_types_supported: ['authorization_code', 'refresh_token'], response_types_supported: ['code'],
    token_endpoint_auth_methods_supported: ['none'], client_id_metadata_document_supported: true, scopes_supported: [SCOPE, 'offline_access'],
  });
}

// Exactly Claude's callback, or a loopback /callback on any port (Claude Code). The port is ignored when matching.
export function allowedRedirect(uri) {
  if (uri === CLAUDE_CALLBACK) return true;
  let u; try { u = new URL(uri); } catch { return false; }
  return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.pathname === '/callback' && !u.search && !u.hash && !u.username;
}
const portless = uri => { const u = new URL(uri); u.port = ''; return u.toString(); };
export const redirectRegistered = (client, uri) => allowedRedirect(uri) && client.redirect_uris.some(r => r === uri || (r.startsWith('http://') && portless(r) === portless(uri)));
const cleanName = v => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) || null : null);

// A CIMD client_id is fetched on every authorize (Claude may rotate its document); a failed fetch falls back to the stored row.
async function resolveClient(D, clientId) {
  if (typeof clientId !== 'string' || !clientId || clientId.length > 500) return null;
  const { data: stored } = await D.supabase.from('hl_oauth_clients').select('*').eq('client_id', clientId).maybeSingle();
  if (!clientId.startsWith('https://')) return stored || null;
  if (!clientId.startsWith(CIMD_PREFIX)) return null;
  try {
    const r = await D.fetch(clientId, { redirect: 'error', signal: AbortSignal.timeout(CIMD_TIMEOUT_MS), headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`metadata document ${r.status}`);
    const body = await r.text();
    if (body.length > CIMD_MAX_BYTES) throw new Error('metadata document too large');
    const doc = JSON.parse(body);
    if (doc.client_id !== clientId || !Array.isArray(doc.redirect_uris)) throw new Error('metadata document does not describe this client_id');
    const redirect_uris = doc.redirect_uris.filter(u => typeof u === 'string' && allowedRedirect(u)).slice(0, 10);
    if (!redirect_uris.length) throw new Error('metadata document has no allowed redirect_uri');
    const { data, error } = await D.supabase.from('hl_oauth_clients').upsert({ client_id: clientId, kind: 'cimd', redirect_uris, name: cleanName(doc.client_name) || 'Claude' }, { onConflict: 'client_id' }).select().single();
    if (error) throw new Error(error.message);
    return data;
  } catch (e) {
    console.error('[hlconnect/oauth] client metadata:', e.message);
    return stored || null;
  }
}

// POST /hl/oauth/register (RFC 7591) - public clients only.
const registerHits = new Map();
export async function registerRoute(req, res, d = {}) {
  const D = oauthDeps(d), b = req.body || {};
  const bad = msg => res.status(400).json({ error: 'invalid_client_metadata', error_description: msg });
  const ip = req.ip || 'unknown', hour = D.now().getTime() - 60 * 60_000;
  const hits = (registerHits.get(ip) || []).filter(t => t > hour);
  if (hits.length >= REGISTER_PER_HOUR) return res.status(429).json({ error: 'too_many_requests', error_description: 'Too many registrations - try again in an hour' });
  if (!Array.isArray(b.redirect_uris) || !b.redirect_uris.length || b.redirect_uris.length > 10) return res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'send 1 to 10 redirect_uris' });
  if (!b.redirect_uris.every(u => typeof u === 'string' && allowedRedirect(u))) return res.status(400).json({ error: 'invalid_redirect_uri', error_description: `redirect_uris must be ${CLAUDE_CALLBACK} or a loopback /callback` });
  if (b.token_endpoint_auth_method != null && b.token_endpoint_auth_method !== 'none') return bad('only public clients (token_endpoint_auth_method "none")');
  if (b.grant_types != null && (!Array.isArray(b.grant_types) || b.grant_types.some(g => !['authorization_code', 'refresh_token'].includes(g)))) return bad('grant_types must be authorization_code and/or refresh_token');
  if (b.response_types != null && (!Array.isArray(b.response_types) || b.response_types.some(t => t !== 'code'))) return bad('response_types must be code');
  hits.push(D.now().getTime()); registerHits.set(ip, hits);
  const { data, error } = await D.supabase.from('hl_oauth_clients').insert({ client_id: `hlc_${crypto.randomBytes(16).toString('hex')}`, kind: 'dcr', redirect_uris: b.redirect_uris, name: cleanName(b.client_name) }).select().single();
  if (error) return res.status(500).json({ error: 'server_error', error_description: error.message });
  res.status(201).json({ client_id: data.client_id, client_id_issued_at: Math.floor(new Date(data.created_at || D.now()).getTime() / 1000), client_name: data.name, redirect_uris: data.redirect_uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });
}

const plain = (res, status, msg) => res.status(status).type('text/plain').send(msg);
const back = (res, redirectUri, params) => { const u = new URL(redirectUri); for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v); res.redirect(302, u.toString()); };

// The HomeLover workspaces this person may connect: an allowlisted sales workspace with Goals on, where they're member+.
export async function connectorWorkspaces(D, userId) {
  const allow = new Set(D.workspaceIds());
  const { data: ms, error } = await D.supabase.from('business_members').select('business_id,role').eq('user_id', userId);
  if (error) throw new Error(error.message);
  const ids = (ms || []).filter(m => allow.has(m.business_id) && roleAtLeast(m.role, 'member')).map(m => m.business_id);
  if (!ids.length) return [];
  const { data: bs, error: e2 } = await D.supabase.from('businesses').select('id,name,features').in('id', ids);
  if (e2) throw new Error(e2.message);
  return (bs || []).filter(b => b.features?.goals_sales);
}

// GET /hl/oauth/authorize - validates, stores the request, sends the browser to the consent page with only its id.
export async function authorizeRoute(req, res, d = {}) {
  const D = oauthDeps(d), q = req.query || {};
  try {
    const client = await resolveClient(D, q.client_id);
    if (!client) return plain(res, 400, 'Unknown client. Add the connector again from claude.ai.');
    if (typeof q.redirect_uri !== 'string' || !redirectRegistered(client, q.redirect_uri)) return plain(res, 400, 'That redirect address is not registered for this client.');
    const state = typeof q.state === 'string' ? q.state.slice(0, 500) : null;
    const err = (error, error_description) => back(res, q.redirect_uri, { error, error_description, state, iss: issuerOf(req) });
    if (q.response_type !== 'code') return err('unsupported_response_type', 'response_type must be code');
    if (q.code_challenge_method !== 'S256' || typeof q.code_challenge !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(q.code_challenge)) return err('invalid_request', 'PKCE with code_challenge_method S256 is required');
    if (q.resource != null && q.resource !== mcpUrlOf(req)) return err('invalid_target', 'resource must be this MCP server');
    const scopes = String(q.scope || SCOPE).split(/\s+/).filter(Boolean);
    if (scopes.some(s => s !== SCOPE && s !== 'offline_access')) return err('invalid_scope', `scope must be ${SCOPE}`);
    const user = await D.sessionUser(req);
    if (!user) {
      if (q.hl_resume === '1') return plain(res, 401, 'Signing in did not stick. Open Prospector, sign in, then connect again from claude.ai.');
      const again = new URL(req.originalUrl, originOf(req)); again.searchParams.set('hl_resume', '1');
      return res.redirect(302, `${PREFIX}/oauth/consent?resume=${encodeURIComponent(again.pathname + again.search)}`);
    }
    const spaces = await connectorWorkspaces(D, user.id);
    if (spaces.length !== 1) return res.redirect(302, `${PREFIX}/oauth/consent?error=${spaces.length ? 'many_workspaces' : 'no_workspace'}`);
    await D.supabase.from('hl_oauth_requests').delete().lt('expires_at', new Date(D.now().getTime() - 24 * 60 * 60_000).toISOString());
    const { data: row, error } = await D.supabase.from('hl_oauth_requests').insert({ client_id: client.client_id, user_id: user.id, business_id: spaces[0].id, redirect_uri: q.redirect_uri, code_challenge: q.code_challenge, state, scope: SCOPE, expires_at: new Date(D.now().getTime() + REQUEST_TTL_MS).toISOString() }).select().single();
    if (error) throw new Error(error.message);
    res.redirect(302, `${PREFIX}/oauth/consent?id=${encodeURIComponent(row.id)}`);
  } catch (e) {
    console.error('[hlconnect/oauth] authorize:', e.message);
    plain(res, 500, 'Something went wrong. Try connecting again.');
  }
}

async function pendingRequest(D, req) {
  if (!UUID.test(req.params.id || '')) return { status: 404, error: 'That connection request was not found' };
  const { data: r, error } = await D.supabase.from('hl_oauth_requests').select('*').eq('id', req.params.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!r || r.user_id !== req.auth.user.id) return { status: 404, error: 'That connection request was not found' };
  if (r.decided_at) return { status: 409, error: 'This connection request was already answered. Connect again from claude.ai.' };
  if (new Date(r.expires_at) <= D.now()) return { status: 410, error: 'This connection request expired. Connect again from claude.ai.' };
  return { r };
}

// GET /api/hl-oauth/consent/:id (signed in) - what the consent page shows, all from the stored request.
export async function consentGetRoute(req, res, d = {}) {
  const D = oauthDeps(d);
  try {
    const p = await pendingRequest(D, req);
    if (!p.r) return res.status(p.status).json({ error: p.error });
    const [{ data: client }, { data: biz }] = await Promise.all([
      D.supabase.from('hl_oauth_clients').select('name').eq('client_id', p.r.client_id).maybeSingle(),
      D.supabase.from('businesses').select('name').eq('id', p.r.business_id).maybeSingle(),
    ]);
    res.json({ client_name: client?.name || 'An unnamed client', redirect_host: new URL(p.r.redirect_uri).host, workspace_name: biz?.name || null, you: req.auth.user.name || null, expires_at: p.r.expires_at });
  } catch (e) { console.error('[hlconnect/oauth] consent get:', e.message); res.status(500).json({ error: e.message }); }
}

// POST /api/hl-oauth/consent/:id { decision: 'allow' | 'deny' } -> { redirect }. Nothing else is read from the browser.
export async function consentPostRoute(req, res, d = {}) {
  const D = oauthDeps(d), b = req.body || {};
  try {
    if (typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some(k => k !== 'decision') || !['allow', 'deny'].includes(b.decision)) return res.status(400).json({ error: 'send only { decision: "allow" | "deny" }' });
    const p = await pendingRequest(D, req);
    if (!p.r) return res.status(p.status).json({ error: p.error });
    const { data: won, error } = await D.supabase.from('hl_oauth_requests').update({ decided_at: D.now().toISOString(), decision: b.decision }).eq('id', p.r.id).eq('user_id', req.auth.user.id).is('decided_at', null).select();
    if (error) throw new Error(error.message);
    if (!won?.length) return res.status(409).json({ error: 'This connection request was already answered. Connect again from claude.ai.' });
    const u = new URL(p.r.redirect_uri);
    if (p.r.state != null) u.searchParams.set('state', p.r.state);
    u.searchParams.set('iss', issuerOf(req));
    if (b.decision === 'deny') { u.searchParams.set('error', 'access_denied'); return res.json({ redirect: u.toString() }); }
    const code = randomToken();
    const { error: e2 } = await D.supabase.from('hl_oauth_codes').insert({ code_hash: sha256(code), client_id: p.r.client_id, user_id: p.r.user_id, business_id: p.r.business_id, redirect_uri: p.r.redirect_uri, code_challenge: p.r.code_challenge, scope: p.r.scope, expires_at: new Date(D.now().getTime() + CODE_TTL_MS).toISOString() });
    if (e2) throw new Error(e2.message);
    u.searchParams.set('code', code);
    res.json({ redirect: u.toString() });
  } catch (e) { console.error('[hlconnect/oauth] consent post:', e.message); res.status(500).json({ error: e.message }); }
}

async function issueTokens(D, { familyId, clientId, userId, businessId }) {
  const access = randomToken(), refresh = randomToken(), t = D.now().getTime();
  const base = { family_id: familyId, client_id: clientId, user_id: userId, business_id: businessId, scope: SCOPE };
  const { error } = await D.supabase.from('hl_oauth_tokens').insert([
    { ...base, kind: 'access', token_hash: sha256(access), expires_at: new Date(t + ACCESS_TTL_MS).toISOString() },
    { ...base, kind: 'refresh', token_hash: sha256(refresh), expires_at: new Date(t + REFRESH_TTL_MS).toISOString() },
  ]);
  if (error) throw new Error(error.message);
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_MS / 1000, refresh_token: refresh, scope: SCOPE };
}
const revokeFamily = (D, familyId) => D.supabase.from('hl_oauth_tokens').update({ revoked_at: D.now().toISOString() }).eq('family_id', familyId).is('revoked_at', null);

// POST /hl/oauth/token (application/x-www-form-urlencoded) - authorization_code + PKCE, and refresh_token with rotation.
export async function tokenRoute(req, res, d = {}) {
  const D = oauthDeps(d), b = req.body || {};
  res.set('Cache-Control', 'no-store');
  const no = (error, error_description, status = 400) => res.status(status).json({ error, error_description });
  try {
    if (typeof b.client_id !== 'string' || !b.client_id) return no('invalid_client', 'client_id is required', 401);
    const { data: client } = await D.supabase.from('hl_oauth_clients').select('client_id').eq('client_id', b.client_id).maybeSingle();
    if (!client) return no('invalid_client', 'unknown client', 401);
    const now = D.now();
    if (b.grant_type === 'authorization_code') {
      if (typeof b.code !== 'string' || typeof b.code_verifier !== 'string' || typeof b.redirect_uri !== 'string') return no('invalid_request', 'code, code_verifier and redirect_uri are required');
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(b.code_verifier)) return no('invalid_grant', 'code_verifier is malformed');
      const hash = sha256(b.code);
      const { data: c } = await D.supabase.from('hl_oauth_codes').select('*').eq('code_hash', hash).maybeSingle();
      if (!c || c.client_id !== b.client_id || c.redirect_uri !== b.redirect_uri || new Date(c.expires_at) <= now || s256(b.code_verifier) !== c.code_challenge) return no('invalid_grant', 'the code is invalid, expired or does not match');
      const { data: won } = await D.supabase.from('hl_oauth_codes').update({ used_at: now.toISOString() }).eq('code_hash', hash).is('used_at', null).select();
      if (!won?.length) return no('invalid_grant', 'the code was already used');
      return res.json(await issueTokens(D, { familyId: crypto.randomUUID(), clientId: c.client_id, userId: c.user_id, businessId: c.business_id }));
    }
    if (b.grant_type === 'refresh_token') {
      if (typeof b.refresh_token !== 'string' || !b.refresh_token) return no('invalid_request', 'refresh_token is required');
      const hash = sha256(b.refresh_token);
      const { data: t } = await D.supabase.from('hl_oauth_tokens').select('*').eq('token_hash', hash).eq('kind', 'refresh').maybeSingle();
      if (!t || t.client_id !== b.client_id) return no('invalid_grant', 'the refresh token is invalid');
      if (t.revoked_at) { await revokeFamily(D, t.family_id); return no('invalid_grant', 'the refresh token was already used or revoked'); }
      if (new Date(t.expires_at) <= now) return no('invalid_grant', 'the refresh token expired');
      const { data: won } = await D.supabase.from('hl_oauth_tokens').update({ revoked_at: now.toISOString(), last_used_at: now.toISOString() }).eq('id', t.id).is('revoked_at', null).select();
      if (!won?.length) { await revokeFamily(D, t.family_id); return no('invalid_grant', 'the refresh token was already used'); }
      return res.json(await issueTokens(D, { familyId: t.family_id, clientId: t.client_id, userId: t.user_id, businessId: t.business_id }));
    }
    return no('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token');
  } catch (e) {
    console.error('[hlconnect/oauth] token:', e.message);
    no('server_error', 'try again', 500);
  }
}
