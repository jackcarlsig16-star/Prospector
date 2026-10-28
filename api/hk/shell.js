import { getServiceSupabase } from '../lib/authUser.js';
import { HK_MODULES } from '../../src/constants/hkModules.js';
import { ROLES } from '../../src/constants/roles.js';
import { assignOwnerHint } from './importRoutes.js';

// hkos-project-shell-v1 S11 - GET /api/hk/:businessId/shell (hkGate already ran). Members for the owner toggle,
// Settings > Members and avatars. Never an email or a phone: business_members.name can hold a typed address, so
// any name with "@" is treated as missing.
const PALETTE_SIZE = 4;

const firstWord = s => (s && !s.includes('@') ? s.trim().split(/\s+/)[0] || null : null);

// List order: role (owner first), then signed up before invited, then join date. Palette slot: hk_member_prefs.avatar_slot
// when the member has one (hkos-data-foundation-v1); members without a stored slot take the free slots in list order,
// so the order-only fallback (hkos-avatar-order-v1) still holds for a workspace with no prefs rows.
const rank = m => { const i = ROLES.indexOf(m.role); return i < 0 ? ROLES.length : i; };
const byPaletteOrder = (a, b) => rank(a) - rank(b) || !!b.user_id - !!a.user_id || String(a.created_at).localeCompare(String(b.created_at));

// rows: business_members (any order), each with created_at and profile { display_name } or null.
// prefs: hk_member_prefs rows [{ user_id, avatar_slot }] for the workspace.
export function shellPayload(rows, auth, businessId, prefs = []) {
  const stored = new Map(prefs.filter(p => p.user_id && p.avatar_slot).map(p => [p.user_id, p.avatar_slot]));
  const taken = new Set(stored.values());
  const seen = new Map(prefs.filter(p => p.user_id && p.last_seen_at).map(p => [p.user_id, p.last_seen_at]));
  let next = 0;
  const freeSlot = () => { for (let k = 0; k < PALETTE_SIZE; k++) { const slot = (next++ % PALETTE_SIZE) + 1; if (!taken.has(slot)) return slot; } return (next++ % PALETTE_SIZE) + 1; };
  const members = [...rows].sort(byPaletteOrder).map(m => ({
    user_id: m.user_id || null,
    first_name: firstWord(m.profile?.display_name) || firstWord(m.name) || 'Invited member',
    role: m.role,
    signed_up: !!m.user_id,
    palette_index: (m.user_id && stored.get(m.user_id)) || freeSlot(),
    last_seen_at: (m.user_id && seen.get(m.user_id)) || null,
  }));
  const mine = members.find(m => m.user_id === auth.user.id);
  const role = auth.roles.get(businessId) || (auth.isPlatformOwner ? 'owner' : 'viewer');
  const myPrefs = prefs.find(p => p.user_id === auth.user.id);
  return {
    me: { user_id: auth.user.id, role, first_name: mine?.first_name || firstWord(auth.user.name) || 'there', owner_filter: myPrefs?.owner_filter || 'me', avatar_slot: myPrefs?.avatar_slot || null },
    members,
    modules: HK_MODULES,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { businessId } = req.params;
  const supabase = getServiceSupabase();
  const { data, error } = await supabase.from('business_members')
    .select('user_id,name,role,created_at,profile:profiles!business_members_user_id_fkey(display_name)')
    .eq('business_id', businessId).order('created_at');
  if (error) return res.status(500).json({ error: error.message });
  const prefs = await memberPrefs(supabase, businessId, data, req.auth.user.id);
  await stampSeen(supabase, businessId, req.auth.user.id);
  res.status(200).json(shellPayload(data, req.auth, businessId, prefs));
}

// The caller's first visit seeds their prefs row with the lowest free slot (the migration seeded the owner only; the
// second member has no profile until they sign in). A lost race on the slot is harmless - the next read sees the row.
// visual-nav-cleanup-v1 W2: last_seen_at feeds the word-of-the-day check-in nudge; until its migration runs the column is
// absent (42703) and the read / stamp quietly skip it.
const MISSING_COLUMN = '42703';
export async function stampSeen(supabase, businessId, userId, now = new Date()) {
  const { error } = await supabase.from('hk_member_prefs').update({ last_seen_at: now.toISOString() }).eq('business_id', businessId).eq('user_id', userId);
  if (error && error.code !== MISSING_COLUMN) console.error('[hk/shell] last_seen_at stamp failed:', error.message);
}
export async function memberPrefs(supabase, businessId, members, userId) {
  const read = cols => supabase.from('hk_member_prefs').select(cols).eq('business_id', businessId);
  let { data: prefs, error } = await read('user_id, avatar_slot, owner_filter, last_seen_at');
  if (error?.code === MISSING_COLUMN) ({ data: prefs, error } = await read('user_id, avatar_slot, owner_filter'));
  if (error) throw new Error(error.message);
  const rows = prefs || [];
  if (!members.some(m => m.user_id === userId) || rows.some(p => p.user_id === userId)) return rows;
  const taken = new Set(rows.map(p => p.avatar_slot));
  const slot = [1, 2, 3, 4].find(s => !taken.has(s)) || null;
  const { data: created } = await supabase.from('hk_member_prefs').upsert({ business_id: businessId, user_id: userId, avatar_slot: slot }, { onConflict: 'business_id,user_id', ignoreDuplicates: true }).select();
  // hkos-sheet-import-v1 S2 - the same first load resolves imported brands hinted to this member (owner_hint 'pete')
  // to their id. A failure here never blocks the shell.
  const mine = members.find(m => m.user_id === userId);
  await assignOwnerHint(supabase, businessId, userId, mine?.profile?.display_name || mine?.name).catch(e => console.error('[hk/shell] owner_hint assign failed:', e.message));
  return created?.length ? [...rows, ...created] : rows;
}
