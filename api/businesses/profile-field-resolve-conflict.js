export const config = { maxDuration: 15 };
import { getSupabase } from './shared.js';

const EDITABLE_FIELDS = ['industry', 'core_problem', 'sub_issues', 'products', 'value_props', 'motto', 'strategic_philosophy'];

// business-intel-smart-upload-v1 Fix 6 — resolves a pending field_conflicts
// entry (Fix 4's diff-check holding back a resynthesis that disagreed with
// a manual edit, per the "New intel conflicts with 1 manual edit - Review"
// banner). "keep" just dismisses the banner - the manual edit and its
// edited_manually flag are untouched, so the next resynthesis will hold
// back on this field again if it still disagrees. "accept" takes the
// resynthesis's candidate value, releases edited_manually protection (the
// next resynthesis can freely update it again), and adopts its candidate
// field_sources.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { id: businessId } = req.params;
  const { field, action } = req.body || {};
  if (!EDITABLE_FIELDS.includes(field)) return res.status(400).json({ error: `field must be one of: ${EDITABLE_FIELDS.join(', ')}` });
  if (!['keep', 'accept'].includes(action)) return res.status(400).json({ error: 'action must be "keep" or "accept"' });

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  try {
    const { data: current, error: readError } = await supabase.from('business_profiles').select('field_conflicts, field_sources').eq('business_id', businessId).maybeSingle();
    if (readError) throw readError;
    if (!current?.field_conflicts?.[field]) return res.status(404).json({ error: 'No pending conflict for this field' });

    const conflict = current.field_conflicts[field];
    const nextConflicts = { ...current.field_conflicts };
    delete nextConflicts[field];

    const patch = { field_conflicts: nextConflicts };
    if (action === 'accept') {
      patch[field] = conflict.candidate_value;
      patch[`${field}_edited_manually`] = false;
      patch.field_sources = { ...(current.field_sources || {}), [field]: conflict.candidate_sources || [] };
    }

    const { data, error } = await supabase.from('business_profiles').update(patch).eq('business_id', businessId).select().single();
    if (error) throw error;
    res.status(200).json({ profile: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
