export const config = { maxDuration: 30 };
import { getSupabase, beginFieldExtractionSync, runFieldExtractionSync } from '../businesses/shared.js';

// intake-field-extraction-and-bulk-split-v1 Stage 4 — mirrors
// api/projects/extract-fields.js 1:1, scoped to campaigns instead of
// projects (see extractEntityFields in shared.js, parameterized for
// both).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { id: campaignId } = req.params;
  const { rawText } = req.body || {};
  if (!rawText?.trim()) return res.status(400).json({ error: 'rawText is required' });

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  try {
    await beginFieldExtractionSync(supabase, { table: 'campaigns', id: campaignId });
    res.status(200).json({ status: 'syncing', campaignId });
    runFieldExtractionSync(supabase, { table: 'campaigns', id: campaignId }, rawText.trim());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
