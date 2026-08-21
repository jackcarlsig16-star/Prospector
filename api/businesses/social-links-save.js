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
// Empty string, whitespace and null all mean "no link" - the popover trims to
// null on save but older stored rows may hold ''. Compares the union of keys
// so a field appearing on only one side still counts as a change.
const normLink = v => (typeof v === 'string' ? v.trim() : v) || null;
const sameLinks = (a, b) => {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) if (normLink(a?.[k]) !== normLink(b?.[k])) return false;
  return true;
};

export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  const { id: businessId } = req.params;
  const { social_links } = req.body || {};
  if (!social_links || typeof social_links !== 'object') return res.status(400).json({ error: 'social_links object is required' });

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  try {
    const { data: existing, error: readError } = await supabase.from('businesses').select('*').eq('id', businessId).single();
    if (readError) throw readError;

    // social-links-save-resynthesis-gate-v1 — the resynthesis below is the
    // expensive part (up to ~3 minutes, see the note above) and it was firing
    // on every save, including re-saving identical links. The popover always
    // submits all four fields whether or not the user touched any of them, so
    // a no-op save was indistinguishable from a real edit at this point.
    // Compare against what's stored and only pay for the resynthesis when a
    // link actually changed.
    const changed = !sameLinks(existing.social_links, social_links);

    let business = existing;
    if (changed) {
      const { data: updated, error } = await supabase.from('businesses').update({ social_links }).eq('id', businessId).select().single();
      if (error) throw error;
      business = updated;
      await generateProfile(supabase, businessId);
    } else {
      console.log(`[social-links] ${businessId}: no link changed, skipping profile resynthesis`);
    }

    const { data: profile, error: profileError } = await supabase.from('business_profiles').select('*').eq('business_id', businessId).maybeSingle();
    if (profileError) throw profileError;
    res.status(200).json({ business, profile });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
