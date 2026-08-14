export const config = { maxDuration: 30 };
import { getSupabase, classifyIntake, fileCompanyIntel, fileProjectIntel, recordAccountActivity } from './shared.js';

// High-confidence cases (company intel, existing project, existing account,
// and the ambiguous fallback) file immediately and return status:'filed'.
// new_project/new_account never write here - they return status:'confirm'
// with a proposal for the client to confirm/adjust via intake-confirm.js
// (smart-intake-and-intelligence-v1).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.params;
  const { text, created_by } = req.body || {};
  if (!text?.trim()) return res.status(400).json({ error: 'text is required' });

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  let classification;
  try {
    classification = await classifyIntake(supabase, id, text.trim());
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  try {
    if (classification.classification === 'existing_project' && classification.project_id) {
      const { data: project, error: projErr } = await supabase.from('projects').select('id').eq('id', classification.project_id).eq('business_id', id).maybeSingle();
      if (projErr) throw projErr;
      if (!project) throw new Error('Classified project not found on this business');

      const updatedProject = await fileProjectIntel(supabase, project.id, text.trim(), created_by);
      return res.status(200).json({ status: 'filed', classification: 'existing_project', project: updatedProject });
    }

    if (classification.classification === 'existing_account' && classification.account_id) {
      const { data: account, error: accErr } = await supabase.from('accounts').select('id, data').eq('id', classification.account_id).eq('business_id', id).maybeSingle();
      if (accErr) throw accErr;
      if (!account) throw new Error('Classified account not found on this business');

      const accountName = await recordAccountActivity(supabase, account.id, created_by, 'smart_intake', text.trim());
      return res.status(200).json({ status: 'filed', classification: 'existing_account', accountName });
    }

    if (classification.classification === 'new_project') {
      return res.status(200).json({ status: 'confirm', classification: 'new_project', proposal: { inferredName: classification.inferred_project_name || 'New Project' } });
    }

    if (classification.classification === 'new_account') {
      return res.status(200).json({ status: 'confirm', classification: 'new_account', proposal: { names: (classification.new_account_names || []).filter(Boolean), relatedProjectId: classification.related_project_id || null } });
    }

    // company_intel or ambiguous - safe fallback, files as company-level intel
    const profile = await fileCompanyIntel(supabase, id, text.trim(), created_by);
    return res.status(200).json({ status: 'filed', classification: 'company_intel', profile });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
