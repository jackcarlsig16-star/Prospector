import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { tokenSealer } from '../lib/tokenCrypto.js';
import { grantedScopes, missingScopes, MICROSOFT_SCOPES } from '../lib/microsoftGrants.js';
import { idTokenClaims } from './oauth.js';

process.env.TEST_KEY_A = crypto.randomBytes(32).toString('base64');
process.env.TEST_KEY_B = crypto.randomBytes(32).toString('base64');

test('only read scopes are ever requested', () => {
  assert.deepEqual(MICROSOFT_SCOPES, ['openid', 'offline_access', 'User.Read', 'Mail.Read', 'Calendars.Read']);
  assert.ok(!MICROSOFT_SCOPES.some(s => /write|send|readwrite/i.test(s)));
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
