export const config = { maxDuration: 15 };
import { getSupabase } from '../businesses/shared.js';

// campaign-layer-v1 — mirrors api/projects/outreach-examples-save.js 1:1,
// scoped to campaigns instead of projects.
export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  const { id: campaignId } = req.params;
  const { outreach_examples_distilled } = req.body || {};

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  try {
    const { data, error } = await supabase.from('campaigns').update({
      outreach_examples_distilled: outreach_examples_distilled || '',
      outreach_examples_distilled_at: new Date().toISOString(),
      outreach_examples_distilled_edited_manually: true,
    }).eq('id', campaignId).select().maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Campaign not found' });
    res.status(200).json({ outreach_examples_distilled: data.outreach_examples_distilled });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
