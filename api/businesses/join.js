import { getSupabase } from './shared.js';

// GET  /api/businesses/join/:code        - resolve a code to its business (pre-form lookup)
// POST /api/businesses/join { code, name, email } - complete the join: upsert the
//   business_members row and grant view+edit on every current list in that business.
// Default-view+edit is a deliberate trusted-collaborator convenience, tightened
// later via the permissions settings screen (business-lists-and-permissions-v1).
export default async function handler(req, res) {
  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  if (req.method === 'GET') {
    const code = (req.params.code || '').toUpperCase();
    const { data: business, error } = await supabase
      .from('businesses')
      .select('id, name, tagline, color')
      .eq('access_code', code)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!business) return res.status(404).json({ error: 'Invalid or expired invite link' });
    return res.status(200).json({ business });
  }

  if (req.method === 'POST') {
    const { code, name, email } = req.body || {};
    if (!code || !name || !email) return res.status(400).json({ error: 'code, name, and email are required' });

    const { data: business, error: bizError } = await supabase
      .from('businesses')
      .select('id, name, tagline, color')
      .eq('access_code', String(code).toUpperCase())
      .maybeSingle();
    if (bizError) return res.status(500).json({ error: bizError.message });
    if (!business) return res.status(404).json({ error: 'Invalid or expired invite link' });

    const lowerEmail = email.trim().toLowerCase();
    const { data: member, error: memberError } = await supabase
      .from('business_members')
      .upsert(
        { business_id: business.id, email: lowerEmail, name: name.trim() },
        { onConflict: 'business_id,email' }
      )
      .select()
      .single();
    if (memberError) return res.status(500).json({ error: memberError.message });

    const { data: lists, error: listsError } = await supabase
      .from('lists')
      .select('id')
      .eq('business_id', business.id);
    if (listsError) return res.status(500).json({ error: listsError.message });

    if ((lists || []).length > 0) {
      const { error: permError } = await supabase
        .from('member_list_permissions')
        .upsert(
          lists.map(l => ({ member_id: member.id, list_id: l.id, can_view: true, can_edit: true })),
          { onConflict: 'member_id,list_id' }
        );
      if (permError) return res.status(500).json({ error: permError.message });
    }

    return res.status(200).json({ business, member });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
