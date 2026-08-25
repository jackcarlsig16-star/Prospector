export const config = { maxDuration: 15 };
import { getSupabase } from './shared.js';

// generation-engine-rebuild-v1 Stage 4 — manual save for the Sales Methodology
// drawer. One pasted text field, no AI generation or distillation step, so
// there is no *_edited_manually flag to carry: every value here is a manual
// edit by definition and nothing automated ever writes this column.
export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  const { id: businessId } = req.params;
  const { sales_methodology } = req.body || {};

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  const value = typeof sales_methodology === 'string' && sales_methodology.trim() ? sales_methodology.trim() : null;

  try {
    const { data, error } = await supabase.from('business_profiles').update({
      sales_methodology: value,
      sales_methodology_updated_at: value ? new Date().toISOString() : null,
    }).eq('business_id', businessId).select('sales_methodology, sales_methodology_updated_at').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'No business profile found for this business yet — run company research first.' });
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
