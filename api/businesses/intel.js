export const config = { maxDuration: 30 };
import { getSupabase, generateProfile } from './shared.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.params;
  const { content, created_by } = req.body || {};
  if (!content) return res.status(400).json({ error: 'content is required' });

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  const { error: insertError } = await supabase
    .from('business_intel_entries')
    .insert({ business_id: id, source: 'manual', content, created_by: created_by || null });
  if (insertError) return res.status(500).json({ error: insertError.message });

  try {
    await generateProfile(supabase, id);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  const { data: profile, error: profileError } = await supabase
    .from('business_profiles')
    .select('*')
    .eq('business_id', id)
    .maybeSingle();
  if (profileError) return res.status(500).json({ error: profileError.message });

  res.status(200).json({ profile });
}
