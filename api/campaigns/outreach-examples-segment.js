export const config = { maxDuration: 30 };
import { getSupabase, segmentOutreachExamples } from '../businesses/shared.js';

// campaign-layer-v1 — mirrors api/projects/outreach-examples-segment.js
// 1:1, scoped to campaigns instead of projects. Returns candidate examples
// only; nothing is saved here. The client reviews/dedups/deselects before
// appending confirmed items via the existing campaign save path.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { id: campaignId } = req.params;
  const { pastedText } = req.body || {};

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  try {
    const examples = await segmentOutreachExamples(supabase, { table: 'campaigns', id: campaignId }, pastedText);
    res.status(200).json({ examples });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
