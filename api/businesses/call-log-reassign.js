// call-log-v1, Phase 5 — manual override for a call-log row's matched
// account/project. Reassigning to a real account is still a real logged
// human contact, same as an auto-match in call-log.js - recordAccountActivity()
// fires here too, not just on the auto-match path.
export const config = { maxDuration: 15 };
import { getSupabase, recordAccountActivity } from './shared.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { id: businessId, entryId } = req.params;
  const { account_id, project_id, created_by } = req.body || {};

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  try {
    const { data: entry, error: entryError } = await supabase.from('business_intel_entries')
      .select('id, source_type, content, call_duration_seconds, call_platform')
      .eq('id', entryId).eq('business_id', businessId).maybeSingle();
    if (entryError) throw entryError;
    if (!entry) return res.status(404).json({ error: 'Call log entry not found' });
    if (entry.source_type !== 'call') return res.status(400).json({ error: 'Entry is not a call log row' });

    if (account_id) {
      const { data: account, error: accountError } = await supabase.from('accounts').select('id').eq('id', account_id).eq('business_id', businessId).maybeSingle();
      if (accountError) throw accountError;
      if (!account) return res.status(404).json({ error: 'Account not found on this business' });
    }
    if (project_id) {
      const { data: project, error: projectError } = await supabase.from('projects').select('id').eq('id', project_id).eq('business_id', businessId).maybeSingle();
      if (projectError) throw projectError;
      if (!project) return res.status(404).json({ error: 'Project not found on this business' });
    }

    const { data: updated, error: updateError } = await supabase.from('business_intel_entries')
      .update({ account_id: account_id || null, project_id: project_id || null })
      .eq('id', entryId).select().single();
    if (updateError) throw updateError;

    let accountName = null;
    if (account_id) {
      const durationNote = entry.call_duration_seconds ? `${Math.round(entry.call_duration_seconds / 60)} min` : null;
      const note = [`Call log manually reassigned (${entry.call_platform || 'manual'}${durationNote ? `, ${durationNote}` : ''})`].join(' ');
      accountName = await recordAccountActivity(supabase, account_id, created_by, 'call_log_reassign', note);
    }

    return res.status(200).json({ entry: updated, accountName });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
