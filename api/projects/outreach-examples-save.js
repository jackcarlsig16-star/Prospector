export const config = { maxDuration: 15 };
import { getSupabase } from '../businesses/shared.js';

// project-scoped-outreach-examples-v1 — "Edit manually" save path for the
// cached distilled summary. Marks outreach_examples_distilled_edited_
// manually=true, same protection-from-silent-overwrite semantics as
// Outreach Rules' manual-edit save path.
export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  const { id: projectId } = req.params;
  const { outreach_examples_distilled } = req.body || {};

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  try {
    const { data, error } = await supabase.from('projects').update({
      outreach_examples_distilled: outreach_examples_distilled || '',
      outreach_examples_distilled_at: new Date().toISOString(),
      outreach_examples_distilled_edited_manually: true,
    }).eq('id', projectId).select().maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Project not found' });
    res.status(200).json({ outreach_examples_distilled: data.outreach_examples_distilled });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
