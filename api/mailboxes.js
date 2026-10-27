import { getServiceSupabase } from './lib/authUser.js';
import { listGrants, grantById, listTethers, setTether, removeTether, setDefault, deleteGrant, decryptToken, PURPOSES, purposesCovered, RECONNECT, deps as googleDeps } from './lib/googleGrants.js';
import { getGrant as getMicrosoftGrant } from './lib/microsoftGrants.js';
import { roleAtLeast } from '../src/constants/roles.js';

// mailbox-connections-v1 REV2 (M5) - /api/mailboxes, the caller's own accounts, tethers and workspaces, under
// sessionAuth. The only address returned is the caller's OWN connected one; teammates' addresses and Apollo mailbox
// addresses never leave the server (Apollo = a count). Nothing here sends mail or talks to Apollo.
//   GET    /api/mailboxes
//   PUT    /api/mailboxes/link      { business_id, account_id, purposes }   member+ on the workspace, own account
//   DELETE /api/mailboxes/link      { business_id }                         member+
//   POST   /api/mailboxes/default   { account_id }                          own account
//   DELETE /api/mailboxes/accounts/:id                                      own account: revoke at Google + delete (tethers cascade)
const OUTLOOK_PURPOSES = [['outlook_voice', 'voice'], ['outlook_meetings', 'calendar'], ['outlook_reply_times', 'sync']];
const UUID = /^[0-9a-f-]{36}$/i;
const fail = e => { throw new Error(e.message); };
const canLink = (req, businessId) => req.auth.isPlatformOwner || roleAtLeast(req.auth.roles.get(businessId), 'member');

export async function mailboxesView(req, { supabase, microsoftGrant }) {
  const userId = req.auth.user.id;
  const [accounts, tethersMine, ms] = await Promise.all([listGrants(userId), listTethers(userId), microsoftGrant(userId)]);
  const { data: memberships, error: e1 } = await supabase.from('business_members').select('business_id, role').eq('user_id', userId);
  if (e1) fail(e1);
  const ids = [...new Set((memberships || []).map(m => m.business_id))];
  const { data: businesses, error: e2 } = ids.length ? await supabase.from('businesses').select('id, name, color, features').in('id', ids) : { data: [] };
  if (e2) fail(e2);
  const salesIds = (businesses || []).filter(b => b.features?.goals_sales).map(b => b.id);
  let owners = [];
  if (ms && salesIds.length) { const { data } = await supabase.from('sales_mailbox_owners').select('business_id, user_id').in('business_id', salesIds); owners = (data || []).filter(o => o.user_id === userId); }
  const apollo = [];
  for (const id of salesIds) {
    const { data } = await supabase.from('sales_raw_snapshots').select('payload, captured_at').eq('business_id', id).eq('entity', 'mailboxes').order('captured_at', { ascending: false }).limit(1);
    const payload = data?.[0]?.payload;
    apollo.push({ business_id: id, mailbox_count: Array.isArray(payload) ? payload.length : 0 });
  }
  const tetherByBusiness = Object.fromEntries(tethersMine.map(t => [t.business_id, t]));
  const grantState = g => (g.error ? RECONNECT : 'ok');
  return {
    accounts: accounts.map(g => ({ id: g.id, provider: 'google', email: g.google_email, is_default: !!g.is_default, features: g.features || [], state: grantState(g), error_at: g.error_at || null, last_used_at: g.last_used_at || null, linked_business_ids: tethersMine.filter(t => t.google_grant_id === g.id).map(t => t.business_id) })),
    microsoft: ms ? { email: ms.account_email, features: (ms.scopes || []).filter(s => !/^(openid|offline_access)$/i.test(s)), state: ms.error ? RECONNECT : 'ok', business_ids: owners.map(o => o.business_id) } : null,
    apollo,
    workspaces: (businesses || []).map(b => {
      const t = tetherByBusiness[b.id];
      const g = t ? accounts.find(a => a.id === t.google_grant_id) : null;
      const outlook = ms && owners.some(o => o.business_id === b.id) ? OUTLOOK_PURPOSES.filter(([flag]) => b.features?.[flag] === true).map(([, p]) => p) : [];
      return {
        id: b.id, name: b.name, color: b.color || null, role: (memberships || []).find(m => m.business_id === b.id)?.role || null,
        google_link: t && g ? { account_id: g.id, purposes: t.purposes, state: grantState(g) } : null,
        microsoft_derived: outlook,
        apollo_derived: apollo.some(a => a.business_id === b.id && a.mailbox_count > 0),
      };
    }),
  };
}

export default async function handler(req, res, { supabase = getServiceSupabase(), microsoftGrant = getMicrosoftGrant, fetchFn = googleDeps.fetch } = {}) {
  const userId = req.auth.user.id;
  const path = (req.path || req.url || '').split('?')[0].replace(/^\/api\/mailboxes/, '') || '/';
  try {
    if (req.method === 'GET' && path === '/') return res.json(await mailboxesView(req, { supabase, microsoftGrant }));
    if (req.method === 'PUT' && path === '/link') {
      const { business_id, account_id, purposes } = req.body || {};
      if (!UUID.test(String(business_id || '')) || !UUID.test(String(account_id || ''))) return res.status(400).json({ error: 'business_id and account_id are required' });
      if (!canLink(req, business_id)) return res.status(403).json({ error: 'You need member access to this workspace to link a mailbox' });
      const grant = await grantById(userId, account_id);
      if (!grant) return res.status(404).json({ error: 'That Google account is not one of yours' });
      const wanted = Array.isArray(purposes) ? purposes.filter(p => PURPOSES.includes(p)) : [];
      if (!wanted.length) return res.status(400).json({ error: `purposes must include at least one of ${PURPOSES.join(', ')}` });
      const covered = purposesCovered(wanted, grant.features);
      if (!covered.length) return res.status(409).json({ error: 'That account has not granted the access those purposes need', needs_feature: wanted.map(p => p === 'calendar' ? 'calendar' : 'gmail')[0] });
      const link = await setTether(business_id, userId, grant.id, covered);
      return res.json({ link: { business_id, account_id: grant.id, purposes: covered, skipped: wanted.filter(p => !covered.includes(p)), state: grant.error ? RECONNECT : 'ok' }, saved: !!link });
    }
    if (req.method === 'DELETE' && path === '/link') {
      const { business_id } = req.body || {};
      if (!UUID.test(String(business_id || ''))) return res.status(400).json({ error: 'business_id is required' });
      if (!canLink(req, business_id)) return res.status(403).json({ error: 'You need member access to this workspace to unlink a mailbox' });
      await removeTether(business_id, userId);
      return res.json({ ok: true });
    }
    if (req.method === 'POST' && path === '/default') {
      const { account_id } = req.body || {};
      if (!UUID.test(String(account_id || ''))) return res.status(400).json({ error: 'account_id is required' });
      const g = await setDefault(userId, account_id);
      if (!g) return res.status(404).json({ error: 'That Google account is not one of yours' });
      return res.json({ ok: true, default_id: g.id });
    }
    const m = /^\/accounts\/([0-9a-f-]{36})$/i.exec(path);
    if (req.method === 'DELETE' && m) {
      const grant = await grantById(userId, m[1]);
      if (!grant) return res.status(404).json({ error: 'That Google account is not one of yours' });
      try { await fetchFn('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: decryptToken(grant.refresh_token_enc) }) }); } catch {}
      await deleteGrant(userId, grant.id);
      return res.json({ ok: true });
    }
    return res.status(404).json({ error: 'Not found' });
  } catch (e) {
    console.error('[mailboxes]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
