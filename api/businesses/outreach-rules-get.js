export const config = { maxDuration: 10 };
import { getSupabase } from './shared.js';

// outreach-intelligence-v1 Section 1 — cheap read a generation call hits on
// every use, same shape as assay-criteria-get.js.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { id: businessId } = req.params;

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  try {
    const { data, error } = await supabase.from('business_profiles').select('outreach_rules, outreach_rules_updated_at').eq('business_id', businessId).maybeSingle();
    if (error) throw error;
    res.status(200).json({ outreach_rules: data?.outreach_rules || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
