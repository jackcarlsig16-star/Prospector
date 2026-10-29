// hkos-mcp-connector-v1 M5 - Settings › Connections › Claude connector: the caller's own active connections (one per
// token family) and Revoke. Mounted under /api/hk/:businessId (hkGate ran); member+ inside - a viewer has no
// connector. Only the caller's own families are listed or revocable; token hashes never leave the server.
import { getSupabase, HkError, fail, me, logEvent, selectAllPages } from '../hk/hkShared.js';
import { roleAtLeast } from '../../src/constants/roles.js';
import { mcpUrlOf } from './oauth.js';

const memberOnly = req => { if (!req.auth.isPlatformOwner && !roleAtLeast(req.auth.roles.get(req.params.businessId), 'member')) throw new HkError(403, 'The Claude connector is for members - a viewer has none'); };
const familiesOf = (supabase, businessId, userId) => selectAllPages(() => supabase.from('hk_oauth_tokens').select('id, family_id, kind, client_id, expires_at, revoked_at, last_used_at, created_at').eq('business_id', businessId).eq('user_id', userId).order('created_at').order('id'));

// GET /connector -> { mcp_url, connections: [{ family_id, client_name, created_at, last_used_at }], last_call_at }
export async function connectorRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  try {
    memberOnly(req);
    const rows = await familiesOf(supabase, req.params.businessId, me(req));
    const nowIso = now().toISOString(), fams = {};
    for (const t of rows) {
      const f = fams[t.family_id] || (fams[t.family_id] = { family_id: t.family_id, client_id: t.client_id, created_at: t.created_at, last_used_at: null, active: false });
      if (t.created_at < f.created_at) f.created_at = t.created_at;
      if (t.last_used_at && (!f.last_used_at || t.last_used_at > f.last_used_at)) f.last_used_at = t.last_used_at;
      if (t.kind === 'refresh' && !t.revoked_at && t.expires_at > nowIso) f.active = true;
    }
    const active = Object.values(fams).filter(f => f.active);
    const ids = [...new Set(active.map(f => f.client_id))];
    const { data: clients, error } = ids.length ? await supabase.from('hk_oauth_clients').select('client_id, name').in('client_id', ids) : { data: [] };
    if (error) throw new Error(error.message);
    const names = Object.fromEntries((clients || []).map(c => [c.client_id, c.name]));
    const lastCall = Object.values(fams).map(f => f.last_used_at).filter(Boolean).sort().at(-1) || null;
    res.json({ mcp_url: mcpUrlOf(req), connections: active.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(f => ({ family_id: f.family_id, client_name: names[f.client_id] || 'Unnamed client', created_at: f.created_at, last_used_at: f.last_used_at })), last_call_at: lastCall });
  } catch (e) { fail(res, e, 'connector/list'); }
}

// POST /connector/:familyId/revoke - every token of that connection, now. The next /mcp call is a 401.
export async function revokeConnectorRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  try {
    memberOnly(req);
    const businessId = req.params.businessId, uid = me(req);
    const { data: mine, error } = await supabase.from('hk_oauth_tokens').select('id').eq('business_id', businessId).eq('user_id', uid).eq('family_id', req.params.familyId).limit(1);
    if (error) throw new Error(error.message);
    if (!mine?.length) throw new HkError(404, 'That connection was not found');
    const { data: hit, error: e2 } = await supabase.from('hk_oauth_tokens').update({ revoked_at: now().toISOString() }).eq('business_id', businessId).eq('user_id', uid).eq('family_id', req.params.familyId).is('revoked_at', null).select('id');
    if (e2) throw new Error(e2.message);
    await logEvent(supabase, { businessId, actorUserId: uid, entityType: 'connector', action: 'connector.revoked', detail: { via: 'settings', tokens: (hit || []).length } });
    res.json({ revoked: (hit || []).length });
  } catch (e) { fail(res, e, 'connector/revoke'); }
}
