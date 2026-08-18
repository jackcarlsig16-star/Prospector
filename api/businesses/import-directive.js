export const config = { maxDuration: 30 };
import { getSupabase, classifyImportDirective } from './shared.js';

// generation-engine-consolidation-v1 Stage 5 - translates a free-text bulk
// directive ("assign all these as Partners") into a uniform field:value
// override applied to every row of the current CSV import. Never writes
// anything itself - the client applies the returned fieldOverrides on top
// of the column-mapped fields before the real commit, same review-first
// shape as import-classify.js.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.params;
  const { directive } = req.body || {};

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  try {
    const result = await classifyImportDirective(supabase, id, directive);
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
