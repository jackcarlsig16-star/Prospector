export const config = { maxDuration: 15 };
import { getSupabase } from './shared.js';

// assay-engine-generalization-v1 — "Edit manually" save path on the Assay
// Criteria card. Marks assay_criteria_edited_manually=true so a future bulk
// "regenerate all" pass (if ever built) knows to skip this business rather
// than silently overwriting deliberate human tuning.
export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  const { id: businessId } = req.params;
  const { fit_signals, disqualifiers, tier_guidance } = req.body || {};

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  const assay_criteria = { fit_signals: fit_signals || '', disqualifiers: disqualifiers || '', tier_guidance: tier_guidance || '' };

  try {
    const { data, error } = await supabase.from('business_profiles').update({
      assay_criteria,
      assay_criteria_updated_at: new Date().toISOString(),
      assay_criteria_edited_manually: true,
    }).eq('business_id', businessId).select().maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'No business profile found for this business yet — run company research first.' });
    res.status(200).json({ assay_criteria: data.assay_criteria });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
