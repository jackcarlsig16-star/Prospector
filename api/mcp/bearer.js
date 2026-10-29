// hkos-mcp-connector-v1 M2 - the /mcp bearer check. The token alone says who the caller is and which workspace: it
// builds the same req.auth sessionAuth builds, then re-checks member+ and hk_sales on every call, so removing someone
// from HumanKind or turning Grow off cuts the connector on the next call. Tokens are never logged.
import { getServiceSupabase } from '../lib/authUser.js';
import { authForUser } from '../lib/requireAuth.js';
import { roleAtLeast } from '../../src/constants/roles.js';
import { sha256, resourceMetadataUrlOf } from './oauth.js';

export async function bearerAuth(req, res, d = {}) {
  const supabase = d.supabase || getServiceSupabase(), now = (d.now || (() => new Date()))();
  const deny = (desc, error = 'invalid_token') => {
    const meta = `resource_metadata="${resourceMetadataUrlOf(req)}"`;
    res.set('WWW-Authenticate', error ? `Bearer error="${error}", error_description="${desc}", ${meta}` : `Bearer ${meta}`);
    res.status(401).json({ error: error || 'unauthorized', error_description: desc });
    return null;
  };
  const m = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(req.get('authorization') || '');
  if (!m) return deny('Sign in required', null);
  const { data: t, error } = await supabase.from('hk_oauth_tokens').select('*').eq('token_hash', sha256(m[1])).eq('kind', 'access').maybeSingle();
  if (error) { res.status(500).json({ error: 'server_error' }); return null; }
  if (!t || t.revoked_at || new Date(t.expires_at) <= now) return deny('The access token is invalid, expired or revoked');
  const a = await authForUser(supabase, { id: t.user_id, email: '' });
  if (a.status) return deny(a.error);
  if (!roleAtLeast(a.auth.roles.get(t.business_id), 'member')) return deny('You are no longer a member of this workspace');
  const { data: biz } = await supabase.from('businesses').select('features').eq('id', t.business_id).maybeSingle();
  if (!biz?.features?.hk_sales) return deny('HumanKind Grow is not enabled for this workspace');
  await supabase.from('hk_oauth_tokens').update({ last_used_at: now.toISOString() }).eq('id', t.id);
  return { auth: a.auth, businessId: t.business_id, tokenId: t.id, familyId: t.family_id, clientId: t.client_id };
}
