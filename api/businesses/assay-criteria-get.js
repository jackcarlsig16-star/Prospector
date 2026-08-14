export const config = { maxDuration: 10 };
import { getSupabase } from './shared.js';

// assay-engine-generalization-v1 — the cheap read clientAssay() hits on
// every real call (single/bulk reassay, CSV import, pool scoring). Deliberately
// minimal — just the cached criteria, not the full business/profile/intel
// payload /api/businesses/:id returns, since this runs far more often than
// a business detail page load.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { id: businessId } = req.params;

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  try {
    const { data, error } = await supabase.from('business_profiles').select('assay_criteria, assay_criteria_updated_at').eq('business_id', businessId).maybeSingle();
    if (error) throw error;
    res.status(200).json({ assay_criteria: data?.assay_criteria || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
