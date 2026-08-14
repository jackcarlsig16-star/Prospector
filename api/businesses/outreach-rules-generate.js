export const config = { maxDuration: 30 };
import { getSupabase, generateOutreachRules } from './shared.js';

// outreach-intelligence-v1 Section 1 — "Generate"/"Regenerate from pasted
// doc" on the Outreach Rules card. Overwrites any manual edit
// (outreach_rules_edited_manually reset to false) - explicit user-initiated
// override, same as Assay Criteria's Regenerate.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { id: businessId } = req.params;
  const { pastedText } = req.body || {};

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  try {
    const outreach_rules = await generateOutreachRules(supabase, businessId, pastedText);
    res.status(200).json({ outreach_rules });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
