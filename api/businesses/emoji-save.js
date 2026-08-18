export const config = { maxDuration: 15 };
import { getSupabase } from './shared.js';

// business-emoji-manual-picker-v1 — replaces the AI-picked emoji
// (generateProfile() no longer writes this field at all, see shared.js).
// Purely a UI selection, no conflict/manual-edit tracking needed since
// nothing else can overwrite it anymore.
export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  const { id: businessId } = req.params;
  const { emoji } = req.body || {};
  if (typeof emoji !== 'string' || !emoji.trim() || emoji.trim().length > 16) {
    return res.status(400).json({ error: 'emoji must be a non-empty string' });
  }

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  try {
    // Upsert, not update - a business can get its emoji picked before it
    // has ever had company research run (no business_profiles row yet).
    const { data, error } = await supabase.from('business_profiles')
      .upsert({ business_id: businessId, emoji: emoji.trim() }, { onConflict: 'business_id' })
      .select()
      .single();
    if (error) throw error;
    res.status(200).json({ profile: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
