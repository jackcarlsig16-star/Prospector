export const config = { maxDuration: 30 };
import { getSupabase, fileCompanyIntel } from './shared.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.params;
  const { content, created_by } = req.body || {};
  if (!content) return res.status(400).json({ error: 'content is required' });

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  try {
    const profile = await fileCompanyIntel(supabase, id, content, created_by);
    res.status(200).json({ profile });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
