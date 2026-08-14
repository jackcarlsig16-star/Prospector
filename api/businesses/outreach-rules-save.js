export const config = { maxDuration: 15 };
import { getSupabase } from './shared.js';

// outreach-intelligence-v1 Section 1 — "Edit manually" save path on the
// Outreach Rules card. Marks outreach_rules_edited_manually=true, same
// protection-from-silent-overwrite semantics as Assay Criteria's save path.
export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  const { id: businessId } = req.params;
  const { tone, structure, key_points, dos, donts, example_snippets } = req.body || {};

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  const outreach_rules = {
    tone: tone || '', structure: structure || '', key_points: key_points || '',
    dos: dos || '', donts: donts || '', example_snippets: example_snippets || '',
  };

  try {
    const { data, error } = await supabase.from('business_profiles').update({
      outreach_rules,
      outreach_rules_updated_at: new Date().toISOString(),
      outreach_rules_edited_manually: true,
    }).eq('business_id', businessId).select().maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'No business profile found for this business yet — run company research first.' });
    res.status(200).json({ outreach_rules: data.outreach_rules });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
