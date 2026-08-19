export const config = { maxDuration: 30 };
import { getSupabase, distillOutreachExamples } from '../businesses/shared.js';

// project-scoped-outreach-examples-v1 — "Distill examples" on the project
// guidance card. Reads the project's own outreach_examples array (already
// saved via the plain guidance-update path) and caches a compact summary.
// Overwrites any manual edit (outreach_examples_distilled_edited_manually
// reset to false) - explicit user-initiated action, same semantics as
// Outreach Rules' Generate/Regenerate.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { id: projectId } = req.params;

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  try {
    const outreach_examples_distilled = await distillOutreachExamples(supabase, { table: 'projects', id: projectId });
    res.status(200).json({ outreach_examples_distilled });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
