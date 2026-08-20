export const config = { maxDuration: 10 };
import { getSupabase } from './shared.js';

// research-poll-egress-fix-v1 Stage 1 — the 3s research poll's own
// endpoint. It used to call GET /api/businesses/:id, whose
// business_intel_entries.select('*') pulls every scraped research_site/
// research_web entry for the business: 157.5 KB per tick measured on
// HumanKind, 122.9 KB on HomeLover. The poll only ever reads
// research_status off that payload. Four named columns instead, so a
// status check costs a few hundred bytes rather than re-sending the
// scraped page content every three seconds. detail.js is unchanged and
// still serves the full page load.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.params;

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  const { data, error } = await supabase
    .from('businesses')
    .select('id, research_status, research_error, research_started_at')
    .eq('id', id)
    .single();
  if (error) return res.status(404).json({ error: 'Business not found' });

  res.status(200).json(data);
}
