import { getServiceSupabase } from '../lib/authUser.js';
import { HK_MODULES } from '../../src/constants/hkModules.js';

// hkos-project-shell-v1 S11 - GET /api/hk/:businessId/shell (hkGate already ran). Members for the owner toggle,
// Settings > Members and avatars. Never an email or a phone: business_members.name can hold a typed address, so
// any name with "@" is treated as missing.
const PALETTE_SIZE = 4;

const firstWord = s => (s && !s.includes('@') ? s.trim().split(/\s+/)[0] || null : null);

// rows: business_members ordered by created_at, each with profile { display_name } or null.
export function shellPayload(rows, auth, businessId) {
  const members = rows.map((m, i) => ({
    user_id: m.user_id || null,
    first_name: firstWord(m.profile?.display_name) || firstWord(m.name) || 'Invited member',
    role: m.role,
    signed_up: !!m.user_id,
    palette_index: (i % PALETTE_SIZE) + 1,
  }));
  const mine = members.find(m => m.user_id === auth.user.id);
  const role = auth.roles.get(businessId) || (auth.isPlatformOwner ? 'owner' : 'viewer');
  return {
    me: { user_id: auth.user.id, role, first_name: mine?.first_name || firstWord(auth.user.name) || 'there' },
    members,
    modules: HK_MODULES,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { businessId } = req.params;
  const { data, error } = await getServiceSupabase().from('business_members')
    .select('user_id,name,role,created_at,profile:profiles!business_members_user_id_fkey(display_name)')
    .eq('business_id', businessId).order('created_at');
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json(shellPayload(data, req.auth, businessId));
}
