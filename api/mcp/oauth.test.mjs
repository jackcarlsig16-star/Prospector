// node --test api/mcp/oauth.test.mjs
// hkos-mcp-connector-v1 Stage 2 - the OAuth server + bearer check on the in-memory Supabase. Invented people and
// workspaces; the CIMD fetch is a stub. 0 network, 0 Claude, 0 Gmail, 0 Apollo.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fakeSupabase } from '../sales/testing/fakeSupabase.mjs';
import * as O from './oauth.js';
import { bearerAuth } from './bearer.js';

const HK = '11111111-1111-4111-8111-111111111111', HL = '22222222-2222-4222-8222-222222222222', JACK = 'u-jack', PETE = 'u-pete';
const ORIGIN = 'https://prospector.example', CIMD = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
const NOW0 = new Date('2026-10-28T20:00:00Z');
let now = NOW0;
const fresh = (over = {}) => fakeSupabase({
  hk_oauth_clients: [], hk_oauth_requests: [], hk_oauth_codes: [], hk_oauth_tokens: [],
  profiles: [{ id: JACK, display_name: 'Jack Example', is_platform_owner: false }, { id: PETE, display_name: 'Pete Example', is_platform_owner: false }],
  business_members: [{ business_id: HK, user_id: JACK, role: 'owner' }, { business_id: HL, user_id: JACK, role: 'owner' }, { business_id: HK, user_id: PETE, role: 'viewer' }],
  businesses: [{ id: HK, name: 'HumanKind', features: { hk_sales: true } }, { id: HL, name: 'HomeLover', features: {} }],
  ...over,
}, { now: () => now.getTime() });

const reqOf = ({ method = 'GET', path = '/', query = {}, body = {}, params = {}, user = JACK, headers = {} } = {}) => {
  const qs = new URLSearchParams(query).toString();
  return { method, query, body, params, ip: '203.0.113.9', protocol: 'https', originalUrl: path + (qs ? `?${qs}` : ''), get: h => (h.toLowerCase() === 'host' ? 'prospector.example' : headers[h.toLowerCase()]), auth: { user: { id: user, name: 'Jack Example' }, isPlatformOwner: false, roles: new Map() } };
};
const resOf = () => { const r = { code: 200, body: null, headers: {}, location: null }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; r.type = () => r; r.send = b => { r.body = b; return r; }; r.set = (k, v) => { r.headers[k] = v; return r; }; r.redirect = (c, l) => { r.code = c; r.location = l; return r; }; return r; };
const run = async (route, req, d) => { const res = resOf(); await route(req, res, d); return res; };
const deps = (sb, over = {}) => ({ supabase: sb, now: () => now, sessionUser: async () => ({ id: JACK }), fetch: async () => { throw new Error('no network in tests'); }, ...over });

const verifier = 'v'.repeat(20) + crypto.randomBytes(24).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
const authQuery = (client_id, redirect_uri, over = {}) => ({ response_type: 'code', client_id, redirect_uri, code_challenge: challenge, code_challenge_method: 'S256', state: 'st-1', scope: 'hk', ...over });

async function register(sb, redirect_uris = [O.CLAUDE_CALLBACK]) {
  const r = await run(O.registerRoute, reqOf({ method: 'POST', body: { client_name: 'Claude', redirect_uris, token_endpoint_auth_method: 'none' } }), deps(sb));
  assert.equal(r.code, 201, JSON.stringify(r.body));
  return r.body.client_id;
}
async function codeFor(sb, clientId, redirect = O.CLAUDE_CALLBACK) {
  const a = await run(O.authorizeRoute, reqOf({ path: '/oauth/authorize', query: authQuery(clientId, redirect) }), deps(sb));
  assert.equal(a.code, 302); assert.match(a.location, /^\/oauth\/consent\?id=/);
  const id = new URL(a.location, ORIGIN).searchParams.get('id');
  const p = await run(O.consentPostRoute, reqOf({ method: 'POST', params: { id }, body: { decision: 'allow' } }), deps(sb));
  assert.equal(p.code, 200, JSON.stringify(p.body));
  return { id, url: new URL(p.body.redirect) };
}
const token = (sb, body) => run(O.tokenRoute, reqOf({ method: 'POST', body }), deps(sb));

test('metadata documents are exact', () => {
  const pr = resOf(); O.protectedResourceRoute(reqOf(), pr);
  assert.deepEqual(pr.body, { resource: `${ORIGIN}/mcp`, authorization_servers: [ORIGIN], scopes_supported: ['hk'], bearer_methods_supported: ['header'], resource_name: 'HumanKind Grow' });
  const as = resOf(); O.authServerMetadataRoute(reqOf(), as);
  assert.deepEqual(as.body, {
    issuer: ORIGIN, authorization_endpoint: `${ORIGIN}/oauth/authorize`, token_endpoint: `${ORIGIN}/oauth/token`, registration_endpoint: `${ORIGIN}/oauth/register`,
    code_challenge_methods_supported: ['S256'], grant_types_supported: ['authorization_code', 'refresh_token'], response_types_supported: ['code'],
    token_endpoint_auth_methods_supported: ['none'], client_id_metadata_document_supported: true, scopes_supported: ['hk', 'offline_access'],
  });
});

test('401 shape: no token -> Bearer resource_metadata; bad token -> invalid_token; never a session cookie', async () => {
  const sb = fresh();
  const r = resOf(); assert.equal(await bearerAuth(reqOf(), r, { supabase: sb }), null);
  assert.equal(r.code, 401); assert.equal(r.headers['WWW-Authenticate'], `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`);
  const r2 = resOf(); await bearerAuth(reqOf({ headers: { authorization: 'Bearer ' + 'x'.repeat(43) } }), r2, { supabase: sb });
  assert.equal(r2.code, 401); assert.match(r2.headers['WWW-Authenticate'], /^Bearer error="invalid_token", error_description="[^"]+", resource_metadata="https:\/\/prospector\.example\/\.well-known\/oauth-protected-resource"$/);
  const r3 = resOf(); await bearerAuth({ ...reqOf({ headers: { cookie: 'prospector_at=abc' } }) }, r3, { supabase: sb });
  assert.equal(r3.code, 401);
});

test('full flow: DCR -> authorize -> consent allow -> code; wrong verifier invalid_grant (code not burned); right verifier -> tokens; code reuse refused; codes + tokens stored hashed', async () => {
  const sb = fresh();
  const cid = await register(sb);
  const { url } = await codeFor(sb, cid);
  assert.deepEqual([url.origin + url.pathname, url.searchParams.get('state'), url.searchParams.get('iss')], [O.CLAUDE_CALLBACK, 'st-1', ORIGIN]);
  const code = url.searchParams.get('code');
  const wrong = await token(sb, { grant_type: 'authorization_code', client_id: cid, code, redirect_uri: O.CLAUDE_CALLBACK, code_verifier: 'w'.repeat(43) });
  assert.deepEqual([wrong.code, wrong.body.error], [400, 'invalid_grant']);
  const ok = await token(sb, { grant_type: 'authorization_code', client_id: cid, code, redirect_uri: O.CLAUDE_CALLBACK, code_verifier: verifier });
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
  assert.deepEqual([ok.body.token_type, ok.body.expires_in, ok.body.scope, ok.headers['Cache-Control']], ['Bearer', 3600, 'hk', 'no-store']);
  const again = await token(sb, { grant_type: 'authorization_code', client_id: cid, code, redirect_uri: O.CLAUDE_CALLBACK, code_verifier: verifier });
  assert.deepEqual([again.code, again.body.error], [400, 'invalid_grant']);
  const dump = JSON.stringify(sb.db);
  for (const plain of [code, ok.body.access_token, ok.body.refresh_token]) assert.ok(!dump.includes(plain), 'a plain code / token reached the DB');
  assert.equal(sb.db.hk_oauth_tokens[0].business_id, HK);
  const b = await bearerAuth(reqOf({ headers: { authorization: `Bearer ${ok.body.access_token}` } }), resOf(), { supabase: sb, now: () => now });
  assert.deepEqual([b.businessId, b.auth.user.id, b.auth.roles.get(HK)], [HK, JACK, 'owner']);
});

test('the code is bound to client + redirect URI and lasts 60 s', async () => {
  const sb = fresh();
  const cid = await register(sb), other = await register(sb);
  const c1 = (await codeFor(sb, cid)).url.searchParams.get('code');
  assert.equal((await token(sb, { grant_type: 'authorization_code', client_id: other, code: c1, redirect_uri: O.CLAUDE_CALLBACK, code_verifier: verifier })).body.error, 'invalid_grant');
  const c2 = (await codeFor(sb, cid)).url.searchParams.get('code');
  now = new Date(NOW0.getTime() + 61_000);
  assert.equal((await token(sb, { grant_type: 'authorization_code', client_id: cid, code: c2, redirect_uri: O.CLAUDE_CALLBACK, code_verifier: verifier })).body.error, 'invalid_grant');
  now = NOW0;
});

test('redirect URIs: outside the list refused at register and authorize; loopback /callback accepted on any port', async () => {
  const sb = fresh();
  for (const bad of ['https://evil.example/cb', 'https://claude.ai/other', 'http://localhost:3000/elsewhere', 'http://evil.example/callback']) {
    const r = await run(O.registerRoute, reqOf({ method: 'POST', body: { redirect_uris: [bad] } }), deps(sb));
    assert.deepEqual([r.code, r.body.error], [400, 'invalid_redirect_uri'], bad);
  }
  const cid = await register(sb, ['http://localhost:3000/callback', 'http://127.0.0.1/callback']);
  const off = await run(O.authorizeRoute, reqOf({ query: authQuery(cid, O.CLAUDE_CALLBACK) }), deps(sb));
  assert.equal(off.code, 400, 'claude.ai callback not registered for this client');
  const { url } = await codeFor(sb, cid, 'http://localhost:54321/callback');
  assert.equal(url.host, 'localhost:54321');
  const t = await token(sb, { grant_type: 'authorization_code', client_id: cid, code: url.searchParams.get('code'), redirect_uri: 'http://localhost:54321/callback', code_verifier: verifier });
  assert.equal(t.code, 200);
  const pub = await run(O.registerRoute, reqOf({ method: 'POST', body: { redirect_uris: [O.CLAUDE_CALLBACK], token_endpoint_auth_method: 'client_secret_basic' } }), deps(sb));
  assert.deepEqual([pub.code, pub.body.error], [400, 'invalid_client_metadata']);
});

test('PKCE: S256 only - plain method or a missing challenge -> invalid_request back to the client', async () => {
  const sb = fresh(); const cid = await register(sb);
  for (const over of [{ code_challenge_method: 'plain' }, { code_challenge_method: undefined }, { code_challenge: undefined }]) {
    const q = authQuery(cid, O.CLAUDE_CALLBACK, over); for (const k of Object.keys(q)) if (q[k] === undefined) delete q[k];
    const r = await run(O.authorizeRoute, reqOf({ query: q }), deps(sb));
    assert.equal(r.code, 302); const u = new URL(r.location);
    assert.deepEqual([u.searchParams.get('error'), u.searchParams.get('state')], ['invalid_request', 'st-1'], JSON.stringify(over));
  }
  assert.equal(sb.db.hk_oauth_requests.length, 0);
});

test('authorize: no session -> React consent page resumes once; workspace auto-picked only when exactly one; foreign resource refused', async () => {
  const sb = fresh(); const cid = await register(sb);
  const r = await run(O.authorizeRoute, reqOf({ path: '/oauth/authorize', query: authQuery(cid, O.CLAUDE_CALLBACK) }), deps(sb, { sessionUser: async () => null }));
  assert.equal(r.code, 302); assert.match(r.location, /^\/oauth\/consent\?resume=%2Foauth%2Fauthorize%3F.*hk_resume%3D1/);
  const loop = await run(O.authorizeRoute, reqOf({ query: { ...authQuery(cid, O.CLAUDE_CALLBACK), hk_resume: '1' } }), deps(sb, { sessionUser: async () => null }));
  assert.equal(loop.code, 401);
  const none = await run(O.authorizeRoute, reqOf({ query: authQuery(cid, O.CLAUDE_CALLBACK) }), deps(sb, { sessionUser: async () => ({ id: PETE }) }));
  assert.equal(none.location, '/oauth/consent?error=no_workspace', 'a viewer is not member+');
  sb.db.businesses[1].features = { hk_sales: true };
  const many = await run(O.authorizeRoute, reqOf({ query: authQuery(cid, O.CLAUDE_CALLBACK) }), deps(sb));
  assert.equal(many.location, '/oauth/consent?error=many_workspaces');
  sb.db.businesses[1].features = {};
  const res = await run(O.authorizeRoute, reqOf({ query: authQuery(cid, O.CLAUDE_CALLBACK, { resource: 'https://elsewhere.example/mcp' }) }), deps(sb));
  assert.equal(new URL(res.location).searchParams.get('error'), 'invalid_target');
  const unknown = await run(O.authorizeRoute, reqOf({ query: authQuery('hkc_nope', O.CLAUDE_CALLBACK) }), deps(sb));
  assert.equal(unknown.code, 400);
  assert.equal(sb.db.hk_oauth_requests.length, 0);
});

test('consent: server-held request; another user 404; only { decision } accepted; single-use; expires after 10 min; deny -> access_denied', async () => {
  const sb = fresh(); const cid = await register(sb);
  const auth = async () => new URL((await run(O.authorizeRoute, reqOf({ query: authQuery(cid, O.CLAUDE_CALLBACK) }), deps(sb))).location, ORIGIN).searchParams.get('id');
  const id = await auth();
  const g = await run(O.consentGetRoute, reqOf({ params: { id } }), deps(sb));
  assert.deepEqual(g.body, { client_name: 'Claude', redirect_host: 'claude.ai', workspace_name: 'HumanKind', you: 'Jack Example', expires_at: sb.db.hk_oauth_requests[0].expires_at });
  assert.equal((await run(O.consentGetRoute, reqOf({ params: { id }, user: PETE }), deps(sb))).code, 404);
  assert.equal((await run(O.consentPostRoute, reqOf({ method: 'POST', params: { id }, user: PETE, body: { decision: 'allow' } }), deps(sb))).code, 404);
  for (const body of [{ decision: 'allow', redirect_uri: 'https://evil.example/cb' }, { decision: 'yes' }, {}]) assert.equal((await run(O.consentPostRoute, reqOf({ method: 'POST', params: { id }, body }), deps(sb))).code, 400, JSON.stringify(body));
  assert.equal((await run(O.consentPostRoute, reqOf({ method: 'POST', params: { id }, body: { decision: 'allow' } }), deps(sb))).code, 200);
  assert.equal((await run(O.consentPostRoute, reqOf({ method: 'POST', params: { id }, body: { decision: 'allow' } }), deps(sb))).code, 409);
  assert.equal(sb.db.hk_oauth_codes.length, 1);
  const id2 = await auth();
  now = new Date(NOW0.getTime() + 10 * 60_000 + 1);
  assert.equal((await run(O.consentPostRoute, reqOf({ method: 'POST', params: { id: id2 }, body: { decision: 'allow' } }), deps(sb))).code, 410);
  now = NOW0;
  const id3 = await auth();
  const d = await run(O.consentPostRoute, reqOf({ method: 'POST', params: { id: id3 }, body: { decision: 'deny' } }), deps(sb));
  assert.deepEqual([new URL(d.body.redirect).searchParams.get('error'), new URL(d.body.redirect).searchParams.get('code')], ['access_denied', null]);
  assert.equal(sb.db.hk_oauth_codes.length, 1);
});

test('refresh: rotation; reusing a rotated refresh token revokes the whole family (its newest access token 401s); revoked access -> 401', async () => {
  const sb = fresh(); const cid = await register(sb);
  const code = (await codeFor(sb, cid)).url.searchParams.get('code');
  const t1 = (await token(sb, { grant_type: 'authorization_code', client_id: cid, code, redirect_uri: O.CLAUDE_CALLBACK, code_verifier: verifier })).body;
  const t2 = await token(sb, { grant_type: 'refresh_token', client_id: cid, refresh_token: t1.refresh_token });
  assert.equal(t2.code, 200); assert.notEqual(t2.body.refresh_token, t1.refresh_token);
  const ok = await bearerAuth(reqOf({ headers: { authorization: `Bearer ${t2.body.access_token}` } }), resOf(), { supabase: sb, now: () => now });
  assert.ok(ok);
  const reuse = await token(sb, { grant_type: 'refresh_token', client_id: cid, refresh_token: t1.refresh_token });
  assert.deepEqual([reuse.code, reuse.body.error], [400, 'invalid_grant']);
  assert.ok(sb.db.hk_oauth_tokens.every(t => t.revoked_at), 'family revoked');
  const r = resOf(); await bearerAuth(reqOf({ headers: { authorization: `Bearer ${t2.body.access_token}` } }), r, { supabase: sb, now: () => now });
  assert.equal(r.code, 401);
  assert.equal((await token(sb, { grant_type: 'refresh_token', client_id: cid, refresh_token: t2.body.refresh_token })).body.error, 'invalid_grant');
  assert.equal((await token(sb, { grant_type: 'password', client_id: cid })).body.error, 'unsupported_grant_type');
});

test('bearer re-checks membership + Grow on every call; an expired access token 401s', async () => {
  const sb = fresh(); const cid = await register(sb);
  const code = (await codeFor(sb, cid)).url.searchParams.get('code');
  const t = (await token(sb, { grant_type: 'authorization_code', client_id: cid, code, redirect_uri: O.CLAUDE_CALLBACK, code_verifier: verifier })).body;
  const hdr = { headers: { authorization: `Bearer ${t.access_token}` } };
  sb.db.businesses[0].features = {};
  let r = resOf(); await bearerAuth(reqOf(hdr), r, { supabase: sb, now: () => now }); assert.equal(r.code, 401);
  sb.db.businesses[0].features = { hk_sales: true };
  sb.db.business_members[0].role = 'viewer';
  r = resOf(); await bearerAuth(reqOf(hdr), r, { supabase: sb, now: () => now }); assert.equal(r.code, 401);
  sb.db.business_members[0].role = 'owner';
  r = resOf(); await bearerAuth(reqOf(hdr), r, { supabase: sb, now: () => new Date(NOW0.getTime() + 3600_001) }); assert.equal(r.code, 401);
});

test('CIMD: a claude.ai client_id is fetched and stored; other https client_ids are refused; a failed refetch falls back to the stored row', async () => {
  const sb = fresh();
  const doc = { client_id: CIMD, client_name: 'Claude', redirect_uris: [O.CLAUDE_CALLBACK, 'https://evil.example/cb'] };
  const fetchOk = async url => { assert.equal(url, CIMD); return { ok: true, text: async () => JSON.stringify(doc) }; };
  const r = await run(O.authorizeRoute, reqOf({ query: authQuery(CIMD, O.CLAUDE_CALLBACK) }), deps(sb, { fetch: fetchOk }));
  assert.match(r.location, /^\/oauth\/consent\?id=/);
  assert.deepEqual([sb.db.hk_oauth_clients[0].kind, sb.db.hk_oauth_clients[0].redirect_uris], ['cimd', [O.CLAUDE_CALLBACK]]);
  const r2 = await run(O.authorizeRoute, reqOf({ query: authQuery(CIMD, O.CLAUDE_CALLBACK) }), deps(sb));
  assert.match(r2.location, /^\/oauth\/consent\?id=/, 'stored row used when the fetch fails');
  const foreign = await run(O.authorizeRoute, reqOf({ query: authQuery('https://evil.example/client.json', O.CLAUDE_CALLBACK) }), deps(sb, { fetch: fetchOk }));
  assert.equal(foreign.code, 400);
  const lying = await run(O.authorizeRoute, reqOf({ query: authQuery('https://claude.ai/other-client', O.CLAUDE_CALLBACK) }), deps(sb, { fetch: async () => ({ ok: true, text: async () => JSON.stringify(doc) }) }));
  assert.equal(lying.code, 400, 'document must describe its own client_id');
});

test('a platform owner\'s connector token is scoped: isPlatformOwner false, roles = the token\'s workspace only -> refused on an owner-only action and on another workspace', async () => {
  const { patchBrandRoute } = await import('../hk/brandsRoutes.js');
  const { hasRole, makeHkGate, authForUser } = await import('../lib/requireAuth.js');
  const BRAND = '33333333-3333-4333-8333-333333333333';
  const sb = fresh({ hk_brands: [{ id: BRAND, business_id: HK, name: 'Bluefin Run Club', normalized_name: 'bluefin run club', aliases: [], status: 'candidate', relationship: 'prospect', owner_user_id: null, owner_unclear: false, archived_at: null }], hk_events: [] });
  sb.db.profiles[0].is_platform_owner = true;
  sb.db.business_members[0].role = 'member';
  const session = (await authForUser(sb, { id: JACK, email: '' })).auth;
  assert.ok(session.isPlatformOwner && hasRole({ auth: session }, HL, 'owner'), 'the session view passes everywhere - which is why the token view must not');
  const cid = await register(sb);
  const code = (await codeFor(sb, cid)).url.searchParams.get('code');
  const t = (await token(sb, { grant_type: 'authorization_code', client_id: cid, code, redirect_uri: O.CLAUDE_CALLBACK, code_verifier: verifier })).body;
  const b = await bearerAuth(reqOf({ headers: { authorization: `Bearer ${t.access_token}` } }), resOf(), { supabase: sb, now: () => now });
  assert.deepEqual([b.auth.isPlatformOwner, [...b.auth.roles.entries()]], [false, [[HK, 'member']]]);
  const asToken = (businessId, method = 'PATCH') => ({ method, params: { businessId, id: BRAND }, query: {}, body: { relationship: 'sponsor' }, auth: b.auth });
  const owner = resOf(); await patchBrandRoute(asToken(HK), owner, { supabase: sb, now: () => now });
  assert.equal(owner.code, 403, 'marking a sponsor is owner-only');
  assert.equal(sb.db.hk_brands[0].relationship, 'prospect');
  assert.equal(hasRole({ auth: b.auth }, HL, 'viewer'), false);
  const gate = makeHkGate(async () => ({ hk_sales: true }));
  const g = resOf(); let passed = false; await gate(asToken(HL, 'GET'), g, () => { passed = true; });
  assert.deepEqual([passed, g.code], [false, 403], 'another workspace\'s businessId is refused');
});
