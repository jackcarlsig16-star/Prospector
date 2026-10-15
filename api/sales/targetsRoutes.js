import { getSupabase } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';

// call-notes-targets-v1 - companies named in notes that aren't a partner or
// an employer yet. Read here (Viewer+); written only by Intake's Accept.

// GET /goals/prospect-targets -> { targets } (rejected ones included: they are the
// "never again" memory).
export async function listProspectTargetsRoute(req, res) {
  try {
    const targets = await selectAllPages(() => getSupabase().from('sales_targets')
      .select('id, name, kind, status, suggested_category, owner_team, co_owner_name, no_double_touch, source_note_id, created_at, decided_at')
      .eq('business_id', req.params.businessId).order('created_at', { ascending: false }).order('id'));
    res.json({ targets });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
