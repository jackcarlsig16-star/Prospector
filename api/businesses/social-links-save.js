export const config = { maxDuration: 15 };
import { getSupabase } from './shared.js';

// business-social-links-v1 - plain field save, no LLM call. social_links is
// just { instagram, linkedin, twitter, facebook } context/seed hints for
// generateProfile()/runResearch()'s web_research - never a fetch target.
export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  const { id: businessId } = req.params;
  const { social_links } = req.body || {};
  if (!social_links || typeof social_links !== 'object') return res.status(400).json({ error: 'social_links object is required' });

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  try {
    const { data, error } = await supabase.from('businesses').update({ social_links }).eq('id', businessId).select().single();
    if (error) throw error;
    res.status(200).json({ business: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
