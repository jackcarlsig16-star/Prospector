export const config = { maxDuration: 15 };
import { getSupabase } from './shared.js';

// nav-admin-cleanup-v1 Stage 3 - per-workspace feature switches (platform
// owner only, enforced in server.js). Merges one key at a time so a stale
// browser can't wipe switches it didn't know about.
// microsoft-connect-v1 Stage 4 (Jack, 2026-10-08): one key per Outlook use,
// all off until switched on here.
const FEATURES = ['goals_sales', 'outlook_voice', 'outlook_meetings', 'outlook_reply_times'];

export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  const { id: businessId } = req.params;
  const { feature, enabled } = req.body || {};
  if (!FEATURES.includes(feature) || typeof enabled !== 'boolean') {
    return res.status(400).json({ error: `feature must be one of ${FEATURES.join(', ')} and enabled a boolean` });
  }

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  try {
    const { data: current, error: readErr } = await supabase.from('businesses').select('features').eq('id', businessId).maybeSingle();
    if (readErr) throw readErr;
    if (!current) return res.status(404).json({ error: 'Workspace not found' });
    const { data, error } = await supabase.from('businesses')
      .update({ features: { ...current.features, [feature]: enabled } })
      .eq('id', businessId)
      .select('id, features')
      .single();
    if (error) throw error;
    res.status(200).json({ business: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
