export const config = { maxDuration: 30 };
import { getSupabase, runResearch } from './shared.js';

// Not an endpoint the SPEC explicitly named - it says "Retry Research" should
// "re-run the async research flow from POST handler" without giving that a
// route of its own. Re-POSTing to /api/businesses would create a second
// business row, which is wrong, so this re-runs runResearch() against the
// existing id instead. Flagged in the summary rather than guessed silently.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.params;

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  const { data: business, error } = await supabase.from('businesses').select('*').eq('id', id).single();
  if (error) return res.status(404).json({ error: 'Business not found' });
  if (business.research_status === 'researching') {
    return res.status(409).json({ error: 'Research is already running for this business' });
  }

  // Flip status synchronously before responding, not inside runResearch()'s
  // first async step - closes the window where a fast double-click could fire
  // two concurrent research runs before the client's next poll sees the change.
  const { error: statusError } = await supabase.from('businesses').update({ research_status: 'researching' }).eq('id', id);
  if (statusError) return res.status(500).json({ error: statusError.message });

  res.status(200).json({ ok: true });

  runResearch(supabase, { ...business, research_status: 'researching' }).catch(e => console.error('[businesses] retry research crashed:', e));
}
