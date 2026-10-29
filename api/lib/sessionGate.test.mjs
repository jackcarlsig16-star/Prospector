// node --test api/lib/sessionGate.test.mjs
// FIX retire-basic-auth-v1 Stage 1 - pins the session gate so the HTTP Basic gate can be switched off: every route
// server.js mounts under /api or /proxy sits behind sessionAuth (mounted first), the only paths that skip it are the
// exact Stage 0 set, and nothing is mounted outside /api and /proxy except the static bundle, the SPA fallback and the
// error handler. Reads server.js + requireAuth.js text and calls sessionAuth with fabricated requests; no DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sessionAuth } from './requireAuth.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const gate = fs.readFileSync(path.join(ROOT, 'api', 'lib', 'requireAuth.js'), 'utf8');
const basic = fs.readFileSync(path.join(ROOT, 'api', 'basicAuth.js'), 'utf8');
const lines = server.split('\n');
const lineOf = needle => lines.findIndex(l => l.includes(needle)) + 1;

// The Stage 0 set, verbatim. Adding an exemption fails this test until it is listed here on purpose.
const EXEMPT = ["{ method: 'POST', path: /^\\/api\\/zoom\\/webhook$/ }", "{ method: 'GET', path: /^\\/api\\/invites\\/[^/]+$/ }"];
const NO_WORKSPACE_OK = ["{ method: 'GET', path: /^\\/api\\/me$/ }", "{ method: 'POST', path: /^\\/api\\/me\\/welcome$/ }", "{ method: 'POST', path: /^\\/api\\/invites\\/[^/]+\\/accept$/ }"];
const CONNECTOR_PATHS = ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server', '/oauth/register', '/oauth/authorize', '/oauth/token', '/mcp'];
const block = name => { const m = gate.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\n\\];`)); assert.ok(m, name); return [...m[1].matchAll(/\{ method: '[A-Z]+', path: \/[^\n]*?\/ \}/g)].map(x => x[0]); };

test('sessionAuth is mounted on /api and /proxy before any route, and its exempt lists are exactly the Stage 0 set', () => {
  const mount = lineOf("app.use(['/api', '/proxy'], authMw('sessionAuth'));");
  assert.ok(mount > 0, 'sessionAuth mount present');
  const routes = lines.map((l, i) => [i + 1, l]).filter(([, l]) => /^app\.(get|post|put|patch|delete|all)\(/.test(l));
  assert.ok(routes.length > 100, `routes found: ${routes.length}`);
  const early = routes.filter(([n]) => n < mount);
  assert.deepEqual(early, [], 'no route is registered above the sessionAuth mount');
  assert.deepEqual(block('EXEMPT'), EXEMPT);
  assert.deepEqual(block('NO_WORKSPACE_OK'), NO_WORKSPACE_OK);
});

test('every route path is under /api or /proxy; the only other mounts are the static bundle, the SPA fallback and the error handler', () => {
  const paths = [...server.matchAll(/^app\.(get|post|put|patch|delete|all)\(\s*(?:\[([^\]]+)\]|'([^']+)')/gm)].flatMap(m => (m[2] ? [...m[2].matchAll(/'([^']+)'/g)].map(x => x[1]) : [m[3]]));
  const outside = paths.filter(p => !/^\/(api|proxy)\//.test(p) && p !== '*');
  // hkos-mcp-connector-v1 M1: the Claude connector's OAuth metadata + endpoints and /mcp sit outside /api on purpose
  // (Claude carries no session cookie; /mcp checks its own bearer token). This exact list, nothing else.
  assert.deepEqual(outside, CONNECTOR_PATHS);
  assert.equal(paths.filter(p => p === '*').length, 1, 'one SPA fallback');
  const uses = [...server.matchAll(/^app\.use\((.*)$/gm)].map(m => m[1]);
  const known = [/^require\('\.\/api\/basicAuth\.js'\)\.basicAuth\)/, /^express\.json\(/, /^\['\/api', '\/proxy'\], authMw\('sessionAuth'\)\)/, /^\['\/api\/sfdc', '\/api\/hunter', '\/api\/databricks'\], authMw\('platformOwnerOnly'\)\)/, /^'\/api\/businesses\/:id', authMw\('businessGate'\)\)/, /^'\/api\/sales\/:businessId', authMw\('salesGate'\)\)/, /^'\/api\/hk\/:businessId', authMw\('hkGate'\)\)/, /^'\/api\/projects\/:id', authMw\('parentGate', 'projects'\)\)/, /^'\/api\/campaigns\/:id', authMw\('parentGate', 'campaigns'\)\)/, /^express\.static\(/, /^\(err, req, res, _next\) =>/];
  const unknown = uses.filter(u => !known.some(k => k.test(u)));
  assert.deepEqual(unknown, []);
  assert.ok(lineOf('app.use(express.static(') > Math.max(...[...server.matchAll(/^app\.(get|post|put|patch|delete)\(\s*'\/(api|proxy)\//gm)].map(m => server.slice(0, m.index).split('\n').length)), 'static bundle is mounted after every API route');
});

test('without a session: an exempt path passes, everything else is 401 (never 503); the Basic gate exempts the same webhook', async () => {
  const run = async (method, url) => {
    const out = { code: 200, next: false, body: null };
    const res = { status(c) { out.code = c; return { json(b) { out.body = b; return out; } }; } };
    await sessionAuth({ method, originalUrl: url, headers: {} }, res, () => { out.next = true; });
    return out;
  };
  assert.deepEqual(await run('POST', '/api/zoom/webhook'), { code: 200, next: true, body: null });
  assert.deepEqual(await run('GET', '/api/invites/some-token'), { code: 200, next: true, body: null });
  for (const [m, u] of [['GET', '/api/me'], ['GET', '/api/hk/x/shell'], ['GET', '/api/sales/x/entities'], ['POST', '/proxy/anthropic/messages'], ['GET', '/api/invites/some-token/accept'], ['GET', '/api/zoom/webhook'], ['POST', '/api/me/welcome'], ['GET', '/api/gmail/callback?code=x&state=y']]) {
    const r = await run(m, u);
    assert.deepEqual([r.code, r.next, r.body?.error], [401, false, 'Sign in required'], `${m} ${u}`);
  }
  assert.match(basic, /const EXEMPT_PATHS = new Set\(\['\/api\/zoom\/webhook'\]\);/);
  assert.match(basic, /if \(process\.env\.BASIC_AUTH_ENABLED === 'false'\) return next\(\);/);
});
