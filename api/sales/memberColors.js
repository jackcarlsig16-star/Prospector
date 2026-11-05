import { getSupabase } from './goalsShared.js';
import { hasRole } from '../lib/requireAuth.js';
import { MEMBER_COLORS } from '../../src/constants/memberColors.js';

// homelover-flow-v1 F1 (ruling F-b) - each member's fixed color: business_members.member_color (hex, seeded for the
// three members in mockup B by the migration). A member without one gets the first MEMBER_COLORS entry no teammate
// holds, by join order, and it is saved then - so a color never shifts when someone joins or leaves. Keyed by user id,
// never by a name in code. REVISABLE in Settings (PATCH below: the person themself, or an owner / admin).
const HEX = /^#[0-9A-Fa-f]{6}$/;
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };

export function assignColors(members) {
  const taken = new Set(members.map(m => m.member_color).filter(Boolean));
  const out = [];
  for (const m of [...members].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))) {
    if (m.member_color) { out.push({ ...m, color: m.member_color, assigned: false }); continue; }
    const color = MEMBER_COLORS.find(c => !taken.has(c)) || MEMBER_COLORS[out.length % MEMBER_COLORS.length];
    taken.add(color);
    out.push({ ...m, color, assigned: true });
  }
  return out;
}

// -> Map user_id -> color (saved when newly assigned). Before the migration ran the column is missing: colors are
// computed by join order and nothing is written.
export async function memberColors(supabase, businessId) {
  const rows = must(await supabase.from('business_members').select('user_id, created_at').eq('business_id', businessId).not('user_id', 'is', null));
  let stored = null;
  try { stored = must(await supabase.from('business_members').select('user_id, member_color').eq('business_id', businessId).not('user_id', 'is', null)); } catch { stored = null; }
  const colorOf = new Map((stored || []).map(m => [m.user_id, m.member_color || null]));
  const list = assignColors(rows.map(m => ({ ...m, member_color: colorOf.get(m.user_id) || null })));
  if (stored) {
    for (const m of list.filter(x => x.assigned)) await supabase.from('business_members').update({ member_color: m.color }).eq('business_id', businessId).eq('user_id', m.user_id);
  }
  return new Map(list.map(m => [m.user_id, m.color]));
}

// PATCH goals/members/:userId/color { color: '#RRGGBB' }
export async function setMemberColorRoute(req, res) {
  const { businessId, userId } = req.params;
  const color = String(req.body?.color || '').trim();
  if (!HEX.test(color)) return res.status(400).json({ error: 'color must be #RRGGBB' });
  if (userId !== req.auth.user.id && !hasRole(req, businessId, 'admin')) return res.status(403).json({ error: 'Only the member themself or an owner / admin can change a color' });
  try {
    const supabase = getSupabase();
    const taken = must(await supabase.from('business_members').select('user_id, member_color').eq('business_id', businessId).eq('member_color', color));
    if (taken.some(m => m.user_id !== userId)) return res.status(409).json({ error: 'A teammate already has that color' });
    const rows = must(await supabase.from('business_members').update({ member_color: color }).eq('business_id', businessId).eq('user_id', userId).select('user_id, member_color'));
    if (!rows.length) return res.status(404).json({ error: 'member not found' });
    res.json({ member: { user_id: userId, color } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
