export const config = { maxDuration: 30 };
import { getSupabase, distillOutreachExamples } from '../businesses/shared.js';

// campaign-layer-v1 — mirrors api/projects/outreach-examples-generate.js
// 1:1, scoped to campaigns instead of projects (see distillOutreachExamples
// in shared.js, parameterized for both).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { id: campaignId } = req.params;

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  try {
    const outreach_examples_distilled = await distillOutreachExamples(supabase, { table: 'campaigns', id: campaignId });
    res.status(200).json({ outreach_examples_distilled });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
