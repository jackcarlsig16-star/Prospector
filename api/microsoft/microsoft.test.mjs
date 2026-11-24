import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { tokenSealer } from '../lib/tokenCrypto.js';
import { grantedScopes, missingScopes, mergeScopes, canSendTeamEmail, MICROSOFT_SCOPES, CONNECT_SCOPES, SEND_SCOPES } from '../lib/microsoftGrants.js';
import { idTokenClaims } from './oauth.js';
import { authorizeParams, isOwner } from './connect.js';
import { grantFromTokens } from './callback.js';
import { errorFamily, storedFamily, permissionsOf, OTHER_ORG_TEXT } from './errorFamily.js';
import { statusBody, adminConsentUrl, SEND_NEEDED } from './status.js';

process.env.TEST_KEY_A = crypto.randomBytes(32).toString('base64');
process.env.TEST_KEY_B = crypto.randomBytes(32).toString('base64');

// FIX microsoft-consent M1: Connect asks the reads alone; Mail.Send is the owner's separate consent.
test('known scopes: the five connect scopes + Mail.Send, never a write scope', () => {
  assert.deepEqual(CONNECT_SCOPES, ['openid', 'offline_access', 'User.Read', 'Mail.Read', 'Calendars.Read']);
  assert.deepEqual(MICROSOFT_SCOPES, [...CONNECT_SCOPES, 'Mail.Send']);
  assert.ok(!MICROSOFT_SCOPES.some(s => /write/i.test(s)));
});

const READS = ['User.Read', 'Mail.Read', 'Calendars.Read', 'openid'];
const TENANT = '11111111-2222-3333-4444-55555555d36f';
const urlArgs = mode => authorizeParams({ mode, grant: null, userEmail: 'someone@example.com', redirect: 'https://app.example/api/microsoft/callback', state: 's', verifier: 'v' });

test('M1: the connect URL carries the five scopes only; the send URL asks Mail.Send alone, with prompt=consent', () => {
  const c = urlArgs('connect');
  assert.equal(c.get('scope'), 'openid offline_access User.Read Mail.Read Calendars.Read');
  assert.ok(!/Mail\.Send/.test(c.toString()));
  assert.equal(c.get('prompt'), 'select_account');
  const s = urlArgs('send');
  assert.deepEqual(permissionsOf(s.get('scope').split(' ')), ['Mail.Send']);
  assert.deepEqual(SEND_SCOPES, ['openid', 'offline_access', 'Mail.Send']);
  assert.equal(s.get('prompt'), 'consent');
  assert.equal(s.get('redirect_uri'), c.get('redirect_uri'));
});

test('M1: only an owner (of any workspace) or the platform owner may ask for Mail.Send', () => {
  assert.equal(isOwner({ isPlatformOwner: false, roles: new Map([['b1', 'member']]) }), false);
  assert.equal(isOwner({ isPlatformOwner: false, roles: new Map([['b1', 'member'], ['b2', 'owner']]) }), true);
  assert.equal(isOwner({ isPlatformOwner: true, roles: new Map() }), true);
});

test('M1: the callback merges Mail.Send into the grant it already holds; another mailbox or no Mail.Send is refused', () => {
  const existing = { account_email: 'a@example.com', scopes: READS };
  const tokens = { refresh_token: 'rt', scope: 'https://graph.microsoft.com/Mail.Send openid profile' };
  const ok = grantFromTokens({ mode: 'send', existing, tokens, accountEmail: 'a@example.com', tid: TENANT, tenantId: TENANT });
  assert.deepEqual(ok.grant.scopes, ['User.Read', 'Mail.Read', 'Calendars.Read', 'openid', 'Mail.Send']);
  assert.equal(ok.grant.refreshToken, 'rt');
  assert.equal(canSendTeamEmail({ scopes: ok.grant.scopes, error: null }), true);
  assert.deepEqual(mergeScopes(['mail.send', 'User.Read'], ['Mail.Send']), ['Mail.Send', 'User.Read']);
  assert.match(grantFromTokens({ mode: 'send', existing, tokens, accountEmail: 'b@example.com', tid: TENANT, tenantId: TENANT }).error, /same mailbox/);
  assert.match(grantFromTokens({ mode: 'send', existing, tokens: { refresh_token: 'rt', scope: 'openid' }, accountEmail: 'a@example.com', tid: TENANT, tenantId: TENANT }).error, /didn't grant Mail\.Send/);
  assert.match(grantFromTokens({ mode: 'send', existing: null, tokens, accountEmail: 'a@example.com', tid: TENANT, tenantId: TENANT }).error, /Connect Microsoft first/);
});

test('M1: a connect stores what Microsoft granted (replacing the old row); reads missing or another organization refuse', () => {
  const tokens = { refresh_token: 'rt', scope: 'User.Read Mail.Read Calendars.Read openid' };
  const ok = grantFromTokens({ mode: 'connect', existing: null, tokens, accountEmail: 'a@example.com', tid: TENANT, tenantId: TENANT });
  assert.deepEqual(ok.grant, { accountEmail: 'a@example.com', tenantId: TENANT, scopes: ['User.Read', 'Mail.Read', 'Calendars.Read', 'openid'], refreshToken: 'rt' });
  assert.equal(canSendTeamEmail({ scopes: ok.grant.scopes, error: null }), false);
  assert.match(grantFromTokens({ mode: 'connect', tokens: { refresh_token: 'rt', scope: 'User.Read openid' }, accountEmail: 'a@example.com', tid: TENANT, tenantId: TENANT }).error, /didn't grant Mail\.Read, Calendars\.Read/);
  assert.equal(grantFromTokens({ mode: 'connect', tokens, accountEmail: 'a@example.com', tid: 'other-tenant', tenantId: TENANT }).error, `Microsoft: ${OTHER_ORG_TEXT}`);
  assert.match(grantFromTokens({ mode: 'connect', tokens: { scope: tokens.scope }, accountEmail: 'a@example.com', tid: TENANT, tenantId: TENANT }).error, /offline access/);
});

test('M2: Microsoft errors map to a family in words, and the description (which can quote an address) is never passed on', () => {
  const fam = (e, asked) => errorFamily(e, asked);
  assert.deepEqual(fam({ error: 'invalid_grant', description: 'AADSTS700082: The refresh token has expired due to inactivity.' }), { family: 'expired', text: 'expired (90 days unused / revoked)', code: 'AADSTS700082' });
  assert.deepEqual(fam({ error: 'invalid_grant', description: 'AADSTS65001: The user or administrator has not consented' }, SEND_SCOPES), { family: 'needs_admin', text: 'needs admin approval for: Mail.Send', code: 'AADSTS65001' });
  assert.equal(fam({ error: 'consent_required' }, CONNECT_SCOPES).text, 'needs admin approval for: User.Read, Mail.Read, Calendars.Read');
  assert.equal(fam({ error: 'interaction_required', error_codes: [90094], codes: [90094] }, SEND_SCOPES).family, 'needs_admin');
  assert.equal(fam({ error: 'interaction_required', description: 'AADSTS50076: multi-factor' }).family, 'sign_in');
  const other = fam({ error: 'invalid_request', description: "AADSTS50020: User account 'secret.person@elsewhere.com' from identity provider does not exist in tenant" });
  assert.deepEqual([other.family, other.text], ['other_org', OTHER_ORG_TEXT]);
  assert.match(fam({ error: 'invalid_client', description: 'AADSTS7000222: The provided client secret keys are expired.' }).text, /setup is wrong on the server \(the client secret expired\)/);
  assert.match(fam({ error: 'invalid_request', description: 'AADSTS50011: redirect' }).text, /redirect address is not registered/);
  assert.equal(fam({ error: 'access_denied', description: 'AADSTS65004: User declined to consent' }).family, 'declined');
  const unknown = fam({ error: 'server_error', description: "AADSTS99999: something about secret.person@elsewhere.com" });
  assert.deepEqual([unknown.family, unknown.text], ['unknown', 'Microsoft error AADSTS99999']);
  for (const f of [other, unknown]) assert.ok(!/@|secret\.person/.test(JSON.stringify(f)));
});

test('M2/M4: a stored grant error reads back as its family - the pre-fix wording included', () => {
  assert.deepEqual(storedFamily('Microsoft access expired or was revoked - reconnect'), { family: 'expired', text: 'expired (90 days unused / revoked)' });
  assert.deepEqual(storedFamily('Microsoft access needs admin approval for: Mail.Send - reconnect'), { family: 'needs_admin', text: 'needs admin approval for: Mail.Send' });
  assert.equal(storedFamily('Microsoft access Microsoft wants a fresh sign-in (password or sign-in rules changed) - reconnect').family, 'sign_in');
  assert.equal(storedFamily(null), null);
});

test('M2: the status the card reads - domain and short organization, never a local part outside the legacy email field', () => {
  const env = { configured: true, tenantId: TENANT, clientId: 'client-1', redirect: 'https://app.example/api/microsoft/callback' };
  const grant = { account_email: 'secret.person@example.com', tenant_id: TENANT, scopes: READS, connected_at: '2026-11-20T18:00:00Z', last_used_at: '2026-11-20T18:40:00Z', updated_at: '2026-11-20T19:27:00Z', error: null };
  const member = statusBody({ ...env, grant, owner: false });
  assert.deepEqual([member.connected, member.domain, member.organization, member.problem, member.can_send, member.team_email, member.admin_consent], [true, 'example.com', '…d36f', null, false, null, null]);
  assert.deepEqual(member.last_refresh, { ok: true, at: '2026-11-20T18:40:00Z' });
  const { email, ...shown } = member;
  assert.equal(email, 'secret.person@example.com');
  assert.ok(!/secret\.person|@/.test(JSON.stringify(shown)));

  const owner = statusBody({ ...env, grant, owner: true });
  assert.equal(owner.team_email, SEND_NEEDED);
  assert.equal(SEND_NEEDED, 'Sending needs the owner\'s Mail.Send grant');
  const u = new URL(owner.admin_consent.url);
  assert.equal(u.origin + u.pathname, `https://login.microsoftonline.com/${TENANT}/v2.0/adminconsent`);
  assert.deepEqual([u.searchParams.get('client_id'), u.searchParams.get('redirect_uri')], ['client-1', env.redirect]);
  assert.equal(u.searchParams.get('scope'), ['User.Read', 'Mail.Read', 'Calendars.Read', 'Mail.Send'].map(s => 'https://graph.microsoft.com/' + s).join(' '));
  assert.equal(adminConsentUrl(env), owner.admin_consent.url);
  assert.equal(statusBody({ ...env, grant: { ...grant, scopes: [...READS, 'Mail.Send'] }, owner: true }).team_email, 'ready');

  const expired = statusBody({ ...env, grant: { ...grant, error: 'Microsoft access expired or was revoked - reconnect' }, owner: true });
  assert.deepEqual([expired.problem.family, expired.last_refresh, expired.can_send], ['expired', { ok: false, at: '2026-11-20T19:27:00Z' }, false]);
  assert.equal(statusBody({ ...env, grant: { ...grant, tenant_id: 'aaaa-bbbb' }, owner: false }).problem.family, 'other_org');
  assert.deepEqual([statusBody({ ...env, grant: null, owner: false }).connected, statusBody({ ...env, grant: null, owner: false }).team_email], [false, null]);
});

test('canSendTeamEmail is false without Mail.Send, and with an error on the grant', () => {
  assert.equal(canSendTeamEmail({ scopes: READS, error: null }), false);
  assert.equal(canSendTeamEmail({ scopes: [...READS, 'Mail.Send'], error: null }), true);
  assert.equal(canSendTeamEmail({ scopes: [...READS, 'Mail.Send'], error: 'Microsoft access expired (90 days unused / revoked) - reconnect' }), false);
  assert.equal(canSendTeamEmail(null), false);
});

test('granted scopes: prefix stripped, extras dropped, missing named', () => {
  const s = grantedScopes('https://graph.microsoft.com/Mail.Read Calendars.Read User.Read profile openid email');
  assert.deepEqual(s, ['Mail.Read', 'Calendars.Read', 'User.Read', 'openid']);
  assert.deepEqual(missingScopes(s), []);
  assert.deepEqual(missingScopes(grantedScopes('User.Read openid')), ['Mail.Read', 'Calendars.Read']);
  assert.deepEqual(missingScopes(grantedScopes('')), ['User.Read', 'Mail.Read', 'Calendars.Read']);
});

test('sealer round-trips, and a token sealed with one key never opens with another', () => {
  const a = tokenSealer('TEST_KEY_A'), b = tokenSealer('TEST_KEY_B');
  const enc = a.encrypt('refresh-token-value');
  assert.match(enc, /^v1:[^:]+:[^:]+:[^:]+$/);
  assert.ok(!enc.includes('refresh-token-value'));
  assert.equal(a.decrypt(enc), 'refresh-token-value');
  assert.throws(() => b.decrypt(enc));
  const [v, iv, tag, ct] = enc.split(':');
  const flipped = Buffer.from(ct, 'base64'); flipped[0] ^= 1;
  assert.throws(() => a.decrypt([v, iv, tag, flipped.toString('base64')].join(':')));
});

test('unset key refuses to encrypt', () => {
  assert.throws(() => tokenSealer('NOT_SET_KEY_XYZ').encrypt('x'), /NOT_SET_KEY_XYZ is not configured/);
});

test('id token claims read, junk tolerated', () => {
  const body = Buffer.from(JSON.stringify({ tid: 't-1' })).toString('base64url');
  assert.equal(idTokenClaims(`h.${body}.s`).tid, 't-1');
  assert.deepEqual(idTokenClaims(undefined), {});
});
