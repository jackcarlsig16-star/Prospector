export const config = { maxDuration: 30 };
import { getSupabase, segmentProjectOutreachExamples } from '../businesses/shared.js';

// project-scoped-outreach-examples-v1 addendum — "Paste multiple examples"
// bulk entry path. Returns candidate examples only; nothing is saved here.
// The client reviews/dedups/deselects before appending confirmed items to
// outreach_examples via the existing save path (updateProjectGuidance).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { id: projectId } = req.params;
  const { pastedText } = req.body || {};

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  try {
    const examples = await segmentProjectOutreachExamples(supabase, projectId, pastedText);
    res.status(200).json({ examples });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
