export const config = { maxDuration: 200 };
import { getSupabase, generateProfile } from './shared.js';

// business-profile-refresh-v1 - the "just resynthesize from what we
// already have" path that was missing all session (confirmed: the only
// two existing ways to trigger generateProfile() were the full
// runResearch() pipeline, or faking a placeholder intel note to force
// it). Reuses generateProfile() as-is, no duplicated logic - no new
// entry inserted, no site fetch, no web_research call. One real trigger,
// used both by the manual "Refresh profile" button and automatically
// after a social-links save (see social-links-save.js).
//
// Note for whoever builds delta-synthesis later: this is the natural
// swap point - once a delta-synthesis function exists, this handler is
// where the full generateProfile() call gets swapped for it. Kept as a
// single call to a single function on purpose so that swap is a
// one-line change here, not a hunt across multiple trigger sites.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { id: businessId } = req.params;

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  try {
    await generateProfile(supabase, businessId);
    const { data: profile, error } = await supabase.from('business_profiles').select('*').eq('business_id', businessId).maybeSingle();
    if (error) throw error;
    res.status(200).json({ profile });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
