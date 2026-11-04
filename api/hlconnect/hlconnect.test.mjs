// node --test api/hlconnect/hlconnect.test.mjs
// homelover-clients-v1 Stage 3 (C11) - the HomeLover connector on the in-memory Supabase: its OAuth server (own prefix,
// own tables), the bearer check, and the four tools. Invented people and companies; no email or phone anywhere in the
// seed. 0 network, 0 Claude, 0 Apollo.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fakeSupabase, opportunityEventsTrigger } from '../sales/testing/fakeSupabase.mjs';
import * as O from './oauth.js';
import { bearerAuth } from './bearer.js';
import { toolList, runTool, sourceFor, checkArgs } from './tools.js';

const HL = '22222222-2222-4222-8222-222222222222', NOGOALS = '11111111-1111-4111-8111-111111111111', OTHER = '33333333-3333-4333-8333-333333333333';
const JACK = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', PETE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ID = { mom: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', hub: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', up: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', upEmp: 'ffffffff-ffff-4fff-8fff-ffffffffffff', foreign: '99999999-9999-4999-8999-999999999999' };
const NOW = new Date('2026-11-03T22:00:00Z');
const STAMP = '2026-11-02T18:00:00.000Z';
let now = NOW;
const seed = () => fakeSupabase({
  hl_oauth_clients: [], hl_oauth_requests: [], hl_oauth_codes: [], hl_oauth_tokens: [],
  profiles: [{ id: JACK, display_name: 'Jack Example', is_platform_owner: false }, { id: PETE, display_name: 'Pete Example', is_platform_owner: false }],
  business_members: [{ business_id: HL, user_id: JACK, role: 'owner', name: 'Jack Example' }, { business_id: NOGOALS, user_id: JACK, role: 'owner' }, { business_id: HL, user_id: PETE, role: 'viewer', name: 'Pete Example' }, { business_id: OTHER, user_id: PETE, role: 'owner' }],
  businesses: [{ id: HL, name: 'HomeLover', features: { goals_sales: true } }, { id: NOGOALS, name: 'Other workspace', features: {} }, { id: OTHER, name: 'Second workspace', features: { goals_sales: true } }],
  sales_goals: [
    { id: ID.hub, business_id: HL, goal_type: 'partnership', name: 'HUB International', pipeline_status: 'live', owner_team: 'homelover', source_kind: 'partner_referral', source_partner_id: null, archived_at: null },
    { id: ID.up, business_id: HL, goal_type: 'partnership', name: 'Upside', pipeline_status: 'live', owner_team: 'both', archived_at: null },
    { id: randomId(), business_id: OTHER, goal_type: 'partnership', name: 'Other Partner', owner_team: 'upside', archived_at: null },
  ],
  sales_opportunities: [
    { id: ID.mom, business_id: HL, organization: 'Momentum Innovative Disability Services', domain: null, stage: 'verbal', owner: 'Jack', owner_user_id: JACK, covered_lives: 390, expected_launch: '2027-01-01', notes: null, archived_at: null, updated_at: STAMP, created_at: '2026-10-01T00:00:00Z', source_kind: 'partner_referral', source_partner_id: ID.hub, route_in: 'Brad intro at HUB', source_set_by: JACK, source_set_at: STAMP, client_status: 'verbal_yes', client_since: '2026-11-03', eligible_now: 390, eligible_added: 250, eligible_added_note: 'acquisition, expected April 2027', expected_signing_date: '2026-11-20' },
    { id: ID.upEmp, business_id: HL, organization: 'Upside Owned Co', domain: 'upsideowned.example', stage: 'meeting', owner_team: 'upside', archived_at: null, updated_at: STAMP },
    { id: ID.foreign, business_id: OTHER, organization: 'Foreign Co', domain: 'foreign.example', stage: 'meeting', owner_team: 'upside', archived_at: null, updated_at: STAMP },
  ],
  sales_targets: [{ id: randomId(), business_id: HL, name: 'Known Target', domain: 'knowntarget.example', status: 'proposed', owner_team: 'both' }],
  partner_domains: [{ id: randomId(), business_id: HL, goal_id: ID.hub, domain: 'hub.example', confirmed: true }, { id: randomId(), business_id: HL, goal_id: ID.hub, domain: 'hubinternational.example', confirmed: false, source: 'apollo' }],
  sales_week_goals: [{ id: randomId(), business_id: HL, kind: 'todo', status: 'open', text: 'Send agreement', link_type: 'opportunity', link_id: ID.mom }],
  sales_week_report: [], sales_source_events: [], sales_client_events: [], sales_opportunity_events: [], sales_outreach_contacts: [], sales_prospect_state: [], sales_people: [], web_visits: [], research_runs: [],
}, { triggers: { sales_opportunities: opportunityEventsTrigger }, now: () => now.getTime() });
function randomId() { return crypto.randomUUID(); }

const reqOf = ({ method = 'GET', path: p = '/', query = {}, body = {}, params = {}, user = JACK, headers = {} } = {}) => {
  const qs = new URLSearchParams(query).toString();
  return { method, query, body, params, ip: '203.0.113.9', protocol: 'https', originalUrl: p + (qs ? `?${qs}` : ''), get: h => (h.toLowerCase() === 'host' ? 'prospector.example' : headers[h.toLowerCase()]), auth: { user: { id: user, name: 'Jack Example' } } };
};
const resOf = () => { const r = { code: 200, body: null, headers: {}, location: null }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; r.type = () => r; r.send = b => { r.body = b; return r; }; r.set = (k, v) => { r.headers[k] = v; return r; }; r.redirect = (c, l) => { r.code = c; r.location = l; return r; }; return r; };
const run = async (route, req, d) => { const res = resOf(); await route(req, res, d); return res; };
const deps = (sb, over = {}) => ({ supabase: sb, now: () => now, sessionUser: async () => ({ id: JACK }), fetch: async () => { throw new Error('no network in tests'); }, workspaceIds: () => [HL, OTHER], ...over });
const CB = 'https://claude.ai/api/mcp/auth_callback';
const verifier = crypto.randomBytes(40).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

async function connect(sb, d) {
  const reg = await run(O.registerRoute, reqOf({ method: 'POST', body: { redirect_uris: [CB], client_name: 'Claude' } }), d);
  const cid = reg.body.client_id;
  const auth = await run(O.authorizeRoute, reqOf({ query: { client_id: cid, redirect_uri: CB, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 's1', scope: 'hl', resource: 'https://prospector.example/hl/mcp' } }), d);
  const id = new URL(auth.location, 'https://x').searchParams.get('id');
  const consent = await run(O.consentPostRoute, reqOf({ method: 'POST', params: { id }, body: { decision: 'allow' } }), d);
  const code = new URL(consent.body.redirect).searchParams.get('code');
  const tok = await run(O.tokenRoute, reqOf({ method: 'POST', body: { grant_type: 'authorization_code', client_id: cid, code, code_verifier: verifier, redirect_uri: CB } }), d);
  return { cid, auth, consent, tok };
}

// Imports only from this folder, the shared libs, the sales module, src/constants and packages; tables only hl_oauth_*,
// sales_* and the shared core (workspaces, memberships, profiles, partner domains).
const OK_IMPORT = /^(\.\/|\.\.\/lib\/|\.\.\/sales\/|\.\.\/\.\.\/src\/constants\/|node:|@modelcontextprotocol\/sdk\/)/;
const OK_TABLE = /^(hl_oauth_[a-z]+|sales_[a-z_]+|businesses|business_members|profiles|partner_domains)$/;
test('module separation: imports only shared libs + the sales module, tables only hl_oauth_* / sales_* / shared core', () => {
  const dir = path.dirname(new URL(import.meta.url).pathname);
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const [, from] of src.matchAll(/from ['"]([^'"]+)['"]/g)) assert.match(from, OK_IMPORT, `${f} imports ${from}`);
    for (const [, t] of src.matchAll(/\.from\('([a-z_]+)'\)/g)) assert.match(t, OK_TABLE, `${f} reads ${t}`);
  }
});

test('metadata: issuer <origin>/hl, every endpoint under /hl, the resource is /hl/mcp', async () => {
  const m = await run(O.authServerMetadataRoute, reqOf());
  assert.deepEqual([m.body.issuer, m.body.authorization_endpoint, m.body.token_endpoint, m.body.registration_endpoint], ['https://prospector.example/hl', 'https://prospector.example/hl/oauth/authorize', 'https://prospector.example/hl/oauth/token', 'https://prospector.example/hl/oauth/register']);
  assert.deepEqual(m.body.code_challenge_methods_supported, ['S256']);
  const pr = await run(O.protectedResourceRoute, reqOf());
  assert.deepEqual([pr.body.resource, pr.body.authorization_servers], ['https://prospector.example/hl/mcp', ['https://prospector.example/hl']]);
});

test('OAuth: register -> authorize (consent page under /hl) -> allow -> code -> tokens (hashed only) -> refresh rotates; reuse revokes the family', async () => {
  const sb = seed(), d = deps(sb, { workspaceIds: () => [HL] });
  const { cid, auth, consent, tok } = await connect(sb, d);
  assert.match(cid, /^hlc_/);
  assert.match(auth.location, /^\/hl\/oauth\/consent\?id=/);
  assert.equal(sb.db.hl_oauth_requests[0].business_id, HL);
  assert.equal(new URL(consent.body.redirect).searchParams.get('iss'), 'https://prospector.example/hl');
  assert.equal(tok.code, 200, JSON.stringify(tok.body));
  assert.ok(tok.body.access_token && tok.body.refresh_token);
  const dbText = JSON.stringify(sb.db);
  assert.ok(!dbText.includes(tok.body.access_token) && !dbText.includes(tok.body.refresh_token), 'tokens are stored only as hashes');
  const r1 = await run(O.tokenRoute, reqOf({ method: 'POST', body: { grant_type: 'refresh_token', client_id: cid, refresh_token: tok.body.refresh_token } }), d);
  assert.equal(r1.code, 200);
  const again = await run(O.tokenRoute, reqOf({ method: 'POST', body: { grant_type: 'refresh_token', client_id: cid, refresh_token: tok.body.refresh_token } }), d);
  assert.equal(again.body.error, 'invalid_grant');
  assert.ok(sb.db.hl_oauth_tokens.every(t => t.revoked_at), 'reusing a refresh token revokes the whole family');
  const wrong = await run(O.tokenRoute, reqOf({ method: 'POST', body: { grant_type: 'authorization_code', client_id: cid, code: 'x'.repeat(43), code_verifier: verifier, redirect_uri: CB } }), d);
  assert.equal(wrong.body.error, 'invalid_grant');
});

test('authorize: not signed in -> the /hl consent page resumes; no HomeLover membership or two of them -> refused; viewers are not members', async () => {
  const sb = seed();
  const reg = await run(O.registerRoute, reqOf({ method: 'POST', body: { redirect_uris: [CB] } }), deps(sb));
  const q = { client_id: reg.body.client_id, redirect_uri: CB, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256' };
  const anon = await run(O.authorizeRoute, reqOf({ path: '/hl/oauth/authorize', query: q }), deps(sb, { sessionUser: async () => null }));
  assert.match(anon.location, /^\/hl\/oauth\/consent\?resume=%2Fhl%2Foauth%2Fauthorize/);
  const two = await run(O.authorizeRoute, reqOf({ query: q }), deps(sb, { workspaceIds: () => [HL, NOGOALS] }));
  assert.match(two.location, /^\/hl\/oauth\/consent\?id=/, 'the other workspace has no Goals, so Jack has exactly one HomeLover workspace');
  const pete = await run(O.authorizeRoute, reqOf({ query: q }), deps(sb, { workspaceIds: () => [HL], sessionUser: async () => ({ id: PETE }) }));
  assert.equal(pete.location, '/hl/oauth/consent?error=no_workspace', 'a viewer is not a member');
  const none = await run(O.authorizeRoute, reqOf({ query: q }), deps(sb, { workspaceIds: () => [], sessionUser: async () => ({ id: JACK }) }));
  assert.equal(none.location, '/hl/oauth/consent?error=no_workspace');
  sb.db.business_members.push({ business_id: OTHER, user_id: JACK, role: 'member' });
  const many = await run(O.authorizeRoute, reqOf({ query: q }), deps(sb, { workspaceIds: () => [HL, OTHER] }));
  assert.equal(many.location, '/hl/oauth/consent?error=many_workspaces');
  const bad = await run(O.authorizeRoute, reqOf({ query: { ...q, resource: 'https://prospector.example/mcp' } }), deps(sb));
  assert.match(bad.location, /error=invalid_target/, 'a resource outside /hl is refused');
});

test('bearer: a valid token is the caller in its one workspace at its real role; expired, non-allowlisted or removed member -> 401 with the /hl resource metadata', async () => {
  const sb = seed(), d = deps(sb, { workspaceIds: () => [HL] });
  const { tok } = await connect(sb, d);
  const hdr = { authorization: `Bearer ${tok.body.access_token}` };
  const res = resOf();
  const caller = await bearerAuth(reqOf({ headers: hdr }), res, d);
  assert.equal(caller.businessId, HL);
  assert.equal(caller.auth.isPlatformOwner, false);
  assert.deepEqual([...caller.auth.roles], [[HL, 'owner']]);
  const off = resOf();
  assert.equal(await bearerAuth(reqOf({ headers: hdr }), off, { ...d, workspaceIds: () => [] }), null);
  assert.equal(off.code, 401); assert.match(off.headers['WWW-Authenticate'], /resource_metadata="https:\/\/prospector\.example\/\.well-known\/oauth-protected-resource\/hl\/mcp"/);
  sb.db.business_members = sb.db.business_members.filter(m => !(m.user_id === JACK && m.business_id === HL));
  const gone = resOf();
  assert.equal(await bearerAuth(reqOf({ headers: hdr }), gone, d), null); assert.match(gone.body.error_description, /no longer a member/);
  now = new Date(NOW.getTime() + 2 * 60 * 60_000);
  const late = resOf();
  assert.equal(await bearerAuth(reqOf({ headers: hdr }), late, d), null); assert.match(late.body.error_description, /expired/);
  now = NOW;
  const none = resOf();
  await bearerAuth(reqOf({}), none, d); assert.equal(none.code, 401);
});

const ctx = sb => ({ auth: { user: { id: JACK, name: 'Jack Example' }, roles: new Map([[HL, 'owner']]) }, businessId: HL, origin: 'https://prospector.example', d: { supabase: sb, now: () => now } });
const call = async (sb, name, args) => { const r = await runTool(ctx(sb), name, args); return { ...r, data: JSON.parse(r.content[0].text) }; };

test('tool list: exactly add_client, mark_signed, add_lookalikes, check_upside_owned; only check_upside_owned is read-only', () => {
  assert.deepEqual(toolList().map(t => [t.name, t.annotations.readOnlyHint]), [['add_client', false], ['mark_signed', false], ['add_lookalikes', false], ['check_upside_owned', true]]);
  for (const t of toolList()) assert.equal(t.inputSchema.additionalProperties, false);
});

test('add_client on Momentum (no domain stored, matched by exact name): "updated", nothing duplicated, nothing written, the HUB source + route in kept', async () => {
  const sb = seed();
  const before = JSON.stringify(sb.db.sales_opportunities);
  const r = await call(sb, 'add_client', { company_name: 'Momentum Innovative Disability Services', status: 'verbal_yes', eligible_now: 390, eligible_added: 250, eligible_added_note: 'acquisition, expected April 2027', expected_signing_date: '2026-11-20', launch_date: '2027-01-01', source_type: 'partner', referred_by_partner: 'HUB International' });
  assert.equal(r.isError, undefined, JSON.stringify(r.data));
  assert.equal(r.data.result, 'updated'); assert.equal(r.data.unchanged, true); assert.equal(r.data.company_id, ID.mom); assert.equal(r.data.matched_by, 'name');
  assert.equal(r.data.url, `https://prospector.example/?tab=pipeline&view=companies&open=employer-${ID.mom}`);
  assert.equal(r.data.contacts_suppressed, 0); assert.equal(r.data.todo_id, null); assert.deepEqual(r.data.warnings, []);
  assert.equal(JSON.stringify(sb.db.sales_opportunities), before);
  assert.equal(sb.db.sales_opportunities.filter(o => /Momentum/.test(o.organization)).length, 1);
  assert.equal(sb.db.sales_week_goals.length, 1); assert.equal(sb.db.sales_client_events.length, 0); assert.equal(sb.db.sales_source_events.length, 0);
  const dom = await call(sb, 'add_client', { company_name: 'Momentum Innovative Disability Services', domain: 'momentum.example', status: 'verbal_yes', source_type: 'partner', referred_by_partner: 'HUB International' });
  assert.equal(dom.data.result, 'updated'); assert.equal(dom.data.unchanged, false);
  const m = sb.db.sales_opportunities.find(o => o.id === ID.mom);
  assert.deepEqual([m.domain, m.route_in, m.source_partner_id], ['momentum.example', 'Brad intro at HUB', ID.hub], 'the domain fills in; a source field not sent is kept');
  assert.equal(sb.db.sales_client_events.at(-1).via, 'connector');
  const byDomain = await call(sb, 'add_client', { company_name: 'Momentum (renamed)', domain: 'https://www.momentum.example/', status: 'verbal_yes', source_type: 'partner', referred_by_partner: 'HUB International' });
  assert.equal(byDomain.data.company_id, ID.mom); assert.equal(byDomain.data.matched_by, 'domain');
});

test('add_client creates once on a domain; source mapping (partner found / not found, intro, inbound, direct); no address accepted; another workspace never matched', async () => {
  const sb = seed();
  const a = { company_name: 'Nova Health', domain: 'nova.example', status: 'agreement_sent', source_type: 'broker', referred_by_partner: 'Gallagher Benefits', source_name: 'Sam Rep', eligible_now: 1200 };
  const r1 = await call(sb, 'add_client', a);
  assert.equal(r1.data.result, 'created'); assert.equal(r1.data.stage, 'contract'); assert.deepEqual(r1.data.warnings, ['partner not found']);
  const nova = sb.db.sales_opportunities.find(o => o.organization === 'Nova Health');
  assert.deepEqual([nova.source_kind, nova.source_partner_id, nova.source_person, nova.source_note], ['partner_referral', null, 'Sam Rep', 'Referred by Gallagher Benefits (not in Prospector yet)']);
  const r2 = await call(sb, 'add_client', a);
  assert.equal(r2.data.result, 'updated'); assert.equal(sb.db.sales_opportunities.filter(o => o.organization === 'Nova Health').length, 1);
  assert.deepEqual(sourceFor({ source_type: 'partner', source_name: 'hub international' }, [{ id: ID.hub, name: 'HUB International' }]), { source: { source_kind: 'partner_referral', source_partner_id: ID.hub, source_person: null }, warning: null });
  assert.equal(sourceFor({ source_type: 'intro', source_name: 'Pat Q' }, []).source.source_kind, 'person_referral');
  assert.equal(sourceFor({ source_type: 'inbound' }, []).source.source_kind, 'inbound');
  assert.equal(sourceFor({ source_type: 'direct' }, []).source.source_kind, 'homelover_outreach');
  for (const bad of [{ primary_contact_name: 'pat@nova.example' }, { notes: 'call 312-555-0199' }, { source_name: 'x@y.example' }]) {
    const r = await call(sb, 'add_client', { ...a, ...bad });
    assert.equal(r.isError, true); assert.match(r.data.error, /email address or phone/);
  }
  const foreign = await call(sb, 'add_client', { company_name: 'Foreign Co', domain: 'foreign.example', status: 'verbal_yes', source_type: 'direct' });
  assert.equal(foreign.data.result, 'created', 'a company in another workspace is invisible here');
  assert.equal(sb.db.sales_opportunities.find(o => o.id === ID.foreign).client_status, undefined);
  assert.match((await call(sb, 'add_client', { company_name: 'Zz Unknown', status: 'verbal_yes', source_type: 'direct' })).data.error, /give its website domain/);
  const up = await call(sb, 'add_client', { company_name: 'Upside Owned Co', domain: 'upsideowned.example', status: 'verbal_yes', source_type: 'direct' });
  assert.ok(up.data.warnings.includes('Upside-owned account'));
  assert.match((await call(sb, 'add_client', { ...a, phone: '1' })).data.error, /unknown field "phone"/);
});

test('mark_signed: by company_id or domain, stage to contract, idempotent once signed', async () => {
  const sb = seed();
  const r = await call(sb, 'mark_signed', { company_id: ID.mom, signed_date: '2026-11-18' });
  assert.equal(r.isError, undefined, JSON.stringify(r.data));
  assert.deepEqual([r.data.status, r.data.signed_date, r.data.stage, r.data.unchanged], ['signed', '2026-11-18', 'contract', false]);
  assert.equal(sb.db.sales_client_events.at(-1).via, 'connector');
  const again = await call(sb, 'mark_signed', { company_id: ID.mom });
  assert.equal(again.data.unchanged, true);
  assert.match((await call(sb, 'mark_signed', { domain: 'upsideowned.example' })).data.error, /isn't a client yet/);
  assert.match((await call(sb, 'mark_signed', { company_id: ID.foreign })).data.error, /no such company/);
  assert.match((await call(sb, 'mark_signed', {})).data.error, /company_id or domain/);
});

test('add_lookalikes: targets with source lookalike + "Lookalike of <client>", skips known domains and names, lists Upside-owned apart', async () => {
  const sb = seed();
  sb.db.sales_opportunities.find(o => o.id === ID.mom).domain = 'momentum.example';
  const r = await call(sb, 'add_lookalikes', { client_domain: 'momentum.example', companies: [
    { name: 'Alpha Care', domain: 'alphacare.example', employees: 800, industries: 'Disability services', hq_city: 'Chicago', hq_state: 'IL', why: 'Same model', apollo_org_id: 'org1' },
    { name: 'Upside Owned Co', domain: 'upsideowned.example' }, { name: 'Known Target', domain: 'knowntarget.example' }, { name: 'Hub Again', domain: 'hub.example' },
    { name: 'Known Target' },
  ] });
  assert.equal(r.isError, undefined, JSON.stringify(r.data));
  assert.deepEqual(r.data.added.map(x => x.name), ['Alpha Care']);
  assert.deepEqual(r.data.upside_owned.map(x => x.domain), ['upsideowned.example']);
  assert.deepEqual(r.data.skipped_existing.map(x => x.name), ['Known Target', 'Hub Again', 'Known Target']);
  const t = sb.db.sales_targets.find(x => x.name === 'Alpha Care');
  assert.deepEqual([t.source_kind, t.source_note, t.domain, t.employees, t.employees_source], ['lookalike', 'Lookalike of Momentum Innovative Disability Services', 'alphacare.example', 800, 'apollo']);
  assert.match(t.evidence, /Lookalike of Momentum Innovative Disability Services \(via connector\) · Same model · Disability services · Chicago, IL/);
  assert.equal(sb.db.sales_source_events.filter(e => e.reason === 'create').length, 1);
  assert.match((await call(sb, 'add_lookalikes', { client_domain: 'nobody.example', companies: [{ name: 'X' }] })).data.error, /add_client first/);
  assert.match((await call(sb, 'add_lookalikes', { client_domain: 'momentum.example', companies: Array.from({ length: 26 }, (_, i) => ({ name: `C${i}` })) })).data.error, /1 to 25 items/);
});

test('check_upside_owned: read-only, upside / joint / unknown, only this workspace', async () => {
  const sb = seed();
  const before = JSON.stringify(sb.db);
  const r = await call(sb, 'check_upside_owned', { domains: ['upsideowned.example', 'https://www.knowntarget.example/x', 'nobody.example', 'foreign.example'] });
  assert.deepEqual(r.data.results.map(x => [x.domain, x.upside_owned, x.joint, x.in_prospector]), [
    ['upsideowned.example', true, false, true], ['knowntarget.example', false, true, true], ['nobody.example', false, false, false], ['foreign.example', false, false, false],
  ]);
  assert.equal(JSON.stringify(sb.db), before, 'nothing written');
  assert.ok(!JSON.stringify(r.data).includes('Foreign Co'), 'nothing names another workspace');
  assert.throws(() => checkArgs(toolList()[3].inputSchema, { domains: [] }), /1 to 50 items/);
});

test('domain matching (planner add-on): every kind\'s domain field, normalized - an unconfirmed Apollo partner domain, a partner\'s company_domain, stored mixed case / www', async () => {
  const sb = seed();
  sb.db.sales_goals.find(g => g.id === ID.up).company_domain = 'WWW.UpsidePartner.example/about';
  sb.db.sales_targets[0].domain = 'knowntarget.example';
  const r = await call(sb, 'check_upside_owned', { domains: ['hubinternational.example', 'https://upsidepartner.example', 'KnownTarget.example'] });
  assert.deepEqual(r.data.results.map(x => [x.domain, x.in_prospector, x.record?.type, x.joint]), [
    ['hubinternational.example', true, 'partner', false], ['upsidepartner.example', true, 'partner', true], ['knowntarget.example', true, 'target', true],
  ]);
});

test('add_lookalikes: no domain match -> an exact normalized-name match is skipped too (never a second record)', async () => {
  const sb = seed();
  sb.db.sales_opportunities.find(o => o.id === ID.mom).domain = 'momentum.example';
  const before = sb.db.sales_targets.length;
  const r = await call(sb, 'add_lookalikes', { client_domain: 'momentum.example', companies: [
    { name: 'known target', domain: 'brand-new-domain.example' }, { name: 'HUB  International' }, { name: 'Upside Owned Co.', domain: 'other.example' }, { name: 'Fresh Lookalike', domain: 'fresh.example' }, { name: 'fresh lookalike' },
  ] });
  assert.equal(r.isError, undefined, JSON.stringify(r.data));
  assert.deepEqual(r.data.skipped_existing.map(x => [x.name, x.matched_by, x.type]), [['known target', 'name', 'target'], ['HUB  International', 'name', 'partner'], ['fresh lookalike', 'name', 'target']]);
  assert.deepEqual(r.data.upside_owned.map(x => [x.name, x.matched_by]), [['Upside Owned Co.', 'name']]);
  assert.deepEqual(r.data.added.map(x => x.name), ['Fresh Lookalike']);
  assert.equal(sb.db.sales_targets.length, before + 1);
});
