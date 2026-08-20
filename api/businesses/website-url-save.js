export const config = { maxDuration: 15 };
import { getSupabase } from './shared.js';

// business-website-url-editable-v1 — plain field save, no cascade. Mirrors
// emoji-save.js's shape (validate, update, return), not social-links-
// save.js's (which triggers a full generateProfile() resynthesis) - see
// BusinessWebsiteUrlPopover.js for why that's deliberate.
export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  const { id: businessId } = req.params;
  const { website_url } = req.body || {};
  if (typeof website_url !== 'string' || !website_url.trim() || !/^https?:\/\//i.test(website_url.trim())) {
    return res.status(400).json({ error: 'website_url must be a non-empty URL starting with http:// or https://' });
  }

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  try {
    const { data: business, error } = await supabase.from('businesses').update({ website_url: website_url.trim() }).eq('id', businessId).select().single();
    if (error) throw error;
    res.status(200).json({ business });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
