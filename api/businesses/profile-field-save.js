export const config = { maxDuration: 15 };
import { getSupabase } from './shared.js';

const EDITABLE_FIELDS = ['industry', 'core_problem', 'sub_issues', 'products', 'value_props', 'motto', 'strategic_philosophy'];

// business-intel-smart-upload-v1 Fix 6 — manual per-field edit. Mirrors
// assay-criteria-save.js's plain-field-save pattern, but scoped to one of
// the 7 new profile fields at a time (each has its own *_edited_manually
// column, unlike assay_criteria's single blob). Clears any pending
// field_conflicts entry for this field - a fresh manual edit supersedes
// whatever the last resynthesis proposed, so there's nothing left to
// review.
export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  const { id: businessId } = req.params;
  const { field, value } = req.body || {};
  if (!EDITABLE_FIELDS.includes(field)) return res.status(400).json({ error: `field must be one of: ${EDITABLE_FIELDS.join(', ')}` });

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  try {
    const { data: current, error: readError } = await supabase.from('business_profiles').select('field_conflicts').eq('business_id', businessId).maybeSingle();
    if (readError) throw readError;
    if (!current) return res.status(404).json({ error: 'No business profile found for this business yet — run company research first.' });

    const nextConflicts = { ...(current.field_conflicts || {}) };
    delete nextConflicts[field];

    const { data, error } = await supabase.from('business_profiles').update({
      [field]: value ?? null,
      [`${field}_edited_manually`]: true,
      field_conflicts: nextConflicts,
    }).eq('business_id', businessId).select().single();
    if (error) throw error;
    res.status(200).json({ profile: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
