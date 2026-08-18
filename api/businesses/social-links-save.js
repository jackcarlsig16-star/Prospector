export const config = { maxDuration: 200 };
import { getSupabase, generateProfile } from './shared.js';

// business-social-links-v1 + business-profile-refresh-v1 - saving new
// social links now also triggers a real resynthesis synchronously (same
// generateProfile() call the "Refresh profile" button uses), closing the
// staleness gap this was originally flagged with: previously the saved
// links just sat there until something else happened to trigger a
// resynthesis. This does mean the save can now take as long as a full
// profile refresh (up to ~3 minutes on a dense business) - the popover's
// Save button needs the same loading-state treatment as everywhere else
// that calls generateProfile().
export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  const { id: businessId } = req.params;
  const { social_links } = req.body || {};
  if (!social_links || typeof social_links !== 'object') return res.status(400).json({ error: 'social_links object is required' });

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  try {
    const { data: business, error } = await supabase.from('businesses').update({ social_links }).eq('id', businessId).select().single();
    if (error) throw error;
    await generateProfile(supabase, businessId);
    const { data: profile, error: profileError } = await supabase.from('business_profiles').select('*').eq('business_id', businessId).maybeSingle();
    if (profileError) throw profileError;
    res.status(200).json({ business, profile });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
