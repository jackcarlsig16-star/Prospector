export const config = { maxDuration: 30 };
import { getSupabase } from './shared.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.params;

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  const [businessRes, entriesRes, profileRes] = await Promise.all([
    supabase.from('businesses').select('*').eq('id', id).single(),
    supabase.from('business_intel_entries').select('*').eq('business_id', id).order('created_at', { ascending: false }),
    supabase.from('business_profiles').select('*').eq('business_id', id).maybeSingle(),
  ]);
  if (businessRes.error) return res.status(404).json({ error: 'Business not found' });

  res.status(200).json({
    business: businessRes.data,
    profile: profileRes.data || null,
    intelEntries: entriesRes.data || [],
  });
}
