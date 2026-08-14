export const config = { maxDuration: 30 };
import { getSupabase, classifyImportMapping } from './shared.js';

// Proposes a column -> field mapping and (if applicable) an ownership-column
// -> list mapping from CSV headers + a small sample of rows. Never writes
// anything - the client shows this as an editable proposal, the actual
// import commits separately once Jack confirms/adjusts it
// (csv-account-import-v1).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.params;
  const { headers, sampleRows } = req.body || {};
  if (!Array.isArray(headers) || !headers.length) return res.status(400).json({ error: 'headers is required' });

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  try {
    const mapping = await classifyImportMapping(supabase, id, headers, sampleRows || []);
    res.status(200).json(mapping);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
