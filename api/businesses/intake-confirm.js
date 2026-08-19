export const config = { maxDuration: 30 };
import { getSupabase, fileCompanyIntel, fileProjectIntel, recordAccountActivity, insertCompanyIntelEntry, insertProjectIntelEntry, beginProfileSync, runProfileSync, beginStrategySync, runStrategySync } from './shared.js';

// Commits the confirm-required intake cases (new_project, new_account) after
// Jack has confirmed/adjusted them client-side, plus two escape hatches:
// redirecting a "new project" proposal to an existing project instead, and
// falling back to plain company-level intel if the routing doesn't fit
// (smart-intake-and-intelligence-v1).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.params;
  const { action, text, created_by } = req.body || {};
  if (!action?.type) return res.status(400).json({ error: 'action.type is required' });

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  try {
    if (action.type === 'new_project') {
      if (!action.name?.trim()) return res.status(400).json({ error: 'action.name is required' });
      const { data: business, error: bizErr } = await supabase.from('businesses').select('owner_email').eq('id', id).single();
      if (bizErr) throw bizErr;

      const { data: project, error: projErr } = await supabase.from('projects')
        .insert({ name: action.name.trim(), color: '#D4A96A', owner_email: business.owner_email, business_id: id, list_id: action.listId || null })
        .select().single();
      if (projErr) throw projErr;

      const finalProject = text?.trim() ? await fileProjectIntel(supabase, project.id, text.trim(), created_by) : project;
      return res.status(200).json({ project: finalProject });
    }

    if (action.type === 'redirect_to_project') {
      if (!action.projectId) return res.status(400).json({ error: 'action.projectId is required' });
      const project = await fileProjectIntel(supabase, action.projectId, (text || '').trim(), created_by);
      return res.status(200).json({ project });
    }

    if (action.type === 'new_accounts') {
      const names = (action.names || []).map(n => n.trim()).filter(Boolean);
      if (!names.length) return res.status(400).json({ error: 'action.names must have at least one entry' });
      const rows = names.map(name => {
        const acctId = `intake_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        return {
          id: acctId,
          owner_email: '',
          business_id: id,
          data: { id: acctId, name, addedSource: 'intake', addedAt: new Date().toISOString(), handoffNotes: (text || '').trim() || null },
          updated_at: new Date().toISOString(),
        };
      });
      const { data: accounts, error: insErr } = await supabase.from('accounts').insert(rows).select();
      if (insErr) throw insErr;
      // Real account_lists row, not just data.listId - this path predated
      // accounts-lists-and-activity-model-v1's join-table migration and was
      // never updated, so a list picked here never actually took effect.
      // Fixed in passing while touching this exact function
      // (smart-intake-classification-confirm-v1).
      if (action.listId) {
        const { error: linkErr } = await supabase.from('account_lists').insert(rows.map(r => ({ account_id: r.id, list_id: action.listId })));
        if (linkErr) throw linkErr;
      }
      return res.status(200).json({ accounts: accounts.map(a => a.data) });
    }

    if (action.type === 'existing_account') {
      if (!action.accountId) return res.status(400).json({ error: 'action.accountId is required' });
      const { data: account, error: accErr } = await supabase.from('accounts').select('id, data').eq('id', action.accountId).eq('business_id', id).maybeSingle();
      if (accErr) throw accErr;
      if (!account) return res.status(404).json({ error: 'Account not found on this business' });
      const accountName = await recordAccountActivity(supabase, account.id, created_by, 'smart_intake', (text || '').trim());
      return res.status(200).json({ accountName });
    }

    // intake-confirm-proxy-timeout-v1 - this was the literal reported 502
    // (real generateProfile() latency measured live at 27-68s, against a
    // route this app can't guarantee stays under). Insert is fast and
    // stays synchronous; generateProfile() moves to the background exactly
    // like runResearch() already does for the full pipeline - respond once
    // the entry is filed and intel_sync_status flipped to 'syncing', not
    // once resynthesis finishes. Client polls GET /api/businesses/:id
    // (already returns intel_sync_status via `select('*')`, no new route).
    if (action.type === 'company_intel') {
      await insertCompanyIntelEntry(supabase, id, (text || '').trim(), created_by);
      await beginProfileSync(supabase, id);
      res.status(200).json({ status: 'syncing', businessId: id });
      runProfileSync(supabase, id);
      return;
    }

    // smart-intake-internal-meeting-v1 - the one real multi-target case in
    // this router. Composes the two existing insert primitives rather than
    // a new storage mechanism; whichever destination(s) were confirmed
    // client-side are written, independently - never both required, never
    // neither (client disables the submit button on zero-selected, this is
    // the real guard).
    // intake-confirm-proxy-timeout-v1 - same synchronous-insert/background-
    // resynthesis split as company_intel above, for both possible
    // destinations independently. This is the exact dual-write path that
    // motivated this fix - two generateProfile()/generateProjectStrategy()
    // calls on one request was double the timeout exposure of company_intel
    // alone.
    if (action.type === 'internal_meeting') {
      if (!action.confirmCompanyIntel && !action.projectId) return res.status(400).json({ error: 'At least one destination must be selected' });
      let projectBusinessId = null;
      if (action.confirmCompanyIntel) {
        await insertCompanyIntelEntry(supabase, id, (text || '').trim(), created_by, 'internal_meeting');
        await beginProfileSync(supabase, id);
      }
      if (action.projectId) {
        const { data: project, error: projErr } = await supabase.from('projects').select('business_id').eq('id', action.projectId).single();
        if (projErr) throw projErr;
        projectBusinessId = project.business_id;
        await insertProjectIntelEntry(supabase, action.projectId, projectBusinessId, (text || '').trim(), created_by);
        await beginStrategySync(supabase, action.projectId);
      }
      res.status(200).json({ status: 'syncing', businessId: action.confirmCompanyIntel ? id : null, projectId: action.projectId || null });
      if (action.confirmCompanyIntel) runProfileSync(supabase, id);
      if (action.projectId) runStrategySync(supabase, action.projectId);
      return;
    }

    return res.status(400).json({ error: `Unknown action.type: ${action.type}` });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
