export const config = { maxDuration: 30 };
import { getSupabase, generateAssayCriteria } from './shared.js';

// assay-engine-generalization-v1 — "Regenerate from latest intel" on the
// Assay Criteria card. Overwrites any manual edit (assay_criteria_edited_manually
// reset to false) - that's the explicit, user-initiated override the SPEC calls for.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { id: businessId } = req.params;

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  try {
    const assay_criteria = await generateAssayCriteria(supabase, businessId);
    res.status(200).json({ assay_criteria });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
