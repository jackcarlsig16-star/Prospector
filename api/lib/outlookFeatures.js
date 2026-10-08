import { getServiceSupabase } from './authUser.js';
import { getAllowlistedBusinessIds } from '../sales/allowlist.js';

// microsoft-connect-v1 Stage 4 - each Outlook use is switched on per workspace
// (Admin > Workspace features, api/businesses/features-save.js). Returns the
// caller's sales workspaces that have the key on; empty = the use is off for them.
export async function workspacesWithFeature(req, feature) {
  const mine = getAllowlistedBusinessIds().filter(id => req.auth.isPlatformOwner || req.auth.roles.has(id));
  if (!mine.length) return [];
  const { data, error } = await getServiceSupabase().from('businesses').select('id, features').in('id', mine);
  if (error) throw new Error(error.message);
  return data.filter(b => b.features?.[feature] === true).map(b => b.id);
}
