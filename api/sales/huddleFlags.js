import { createClient } from '@supabase/supabase-js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { laDateString } from './laDate.js';
import { addDays, weekIsFinal, FINAL_ERROR } from './goalsShared.js';

// sales-huddle-v2 REV1 Stage 3 - "Flag for ...": hand a prospect to a
// teammate as a Goals to-do (Huddle follow-ups) with a checklist. Flagging
// never sends anything; the person does the email / LinkedIn themselves.
// The only direct writes to sales_prospect_events outside its trigger are
// the 'flagged' / 'unflagged' entries here (flags aren't a prospect field).
export const FLAG_CATEGORY = 'Huddle follow-ups';
const MAX_STEPS = 6;

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}
function laMonday() {
  const today = laDateString();
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  return addDays(today, -((dow + 6) % 7));
}
// Huddle owners are still the jack / cyrus / unassigned slugs.
const ownerSlug = name => {
  const first = (name || '').split(' ')[0].toLowerCase();
  return ['jack', 'cyrus'].includes(first) ? first : null;
};

// POST /prospects/:contactId/flag { assignee_user_id, steps: [text], note? }
export async function flagProspectRoute(req, res) {
  const { businessId, contactId } = req.params;
  const { assignee_user_id: assignee, steps, note = null } = req.body || {};
  if (typeof assignee !== 'string') return res.status(400).json({ error: 'assignee_user_id is required' });
  if (!Array.isArray(steps) || !steps.length || steps.length > MAX_STEPS || !steps.every(s => typeof s === 'string' && s.trim() && s.length <= 200)) {
    return res.status(400).json({ error: `steps must be 1-${MAX_STEPS} non-empty lines of up to 200 characters` });
  }
  if (note !== null && (typeof note !== 'string' || note.length > 500)) return res.status(400).json({ error: 'note must be text up to 500 characters' });
  const supabase = getSupabase();
  try {
    const [{ data: p, error: pErr }, { data: member, error: mErr }] = await Promise.all([
      supabase.from('sales_prospect_state').select('*').eq('business_id', businessId).eq('contact_id', contactId).maybeSingle(),
      supabase.from('business_members').select('user_id, name').eq('business_id', businessId).eq('user_id', assignee).maybeSingle(),
    ]);
    if (pErr || mErr) throw new Error((pErr || mErr).message);
    if (!p) return res.status(404).json({ error: 'prospect not found' });
    if (!member) return res.status(400).json({ error: 'assignee is not a member of this workspace' });
    const week = laMonday();
    if (await weekIsFinal(supabase, businessId, week)) return res.status(409).json({ error: FINAL_ERROR });

    const { data: todo, error: tErr } = await supabase.from('sales_week_goals').insert({
      business_id: businessId, week_start: week, kind: 'todo', category: FLAG_CATEGORY,
      text: `Follow up: ${p.name || 'prospect'}${p.company ? ` · ${p.company}` : ''}`,
      owner_user_id: assignee, contacts: [p.name, p.company].filter(Boolean),
      prospect_contact_id: contactId, flag_note: note && note.trim() ? note.trim() : null, flagged_by: req.auth.user.id,
    }).select().single();
    if (tErr) throw new Error(tErr.message);
    const { data: stepRows, error: sErr } = await supabase.from('sales_week_goal_steps')
      .insert(steps.map((text, i) => ({ business_id: businessId, goal_id: todo.id, text: text.trim(), sort_order: i }))).select();
    if (sErr) { await supabase.from('sales_week_goals').delete().eq('id', todo.id); throw new Error(sErr.message); }

    let prospect = p;
    const slug = ownerSlug(member.name);
    if (p.owner === 'unassigned' && slug) {
      const { data, error } = await supabase.from('sales_prospect_state')
        .update({ owner: slug, updated_by: req.auth.user.email, updated_at: new Date().toISOString() })
        .eq('business_id', businessId).eq('contact_id', contactId).select().single();
      if (error) throw new Error(error.message);
      prospect = data;
    }
    await supabase.from('sales_prospect_events').insert({ business_id: businessId, contact_id: contactId, field: 'flagged', to_value: member.name, changed_by: req.auth.user.email });
    res.status(201).json({ todo: { ...todo, steps: stepRows.sort((a, b) => a.sort_order - b.sort_order) }, prospect, prev_owner: p.owner });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// DELETE /flags/:goalId?restore_owner=<jack|cyrus|unassigned> - undo a flag:
// removes the to-do (steps cascade) and, when given, puts the prospect's
// owner back if the flag had set it.
export async function unflagRoute(req, res) {
  const { businessId, goalId } = req.params;
  const restore = req.query.restore_owner;
  if (restore && !['jack', 'cyrus', 'unassigned'].includes(restore)) return res.status(400).json({ error: 'restore_owner must be jack|cyrus|unassigned' });
  const supabase = getSupabase();
  try {
    const { data: todo, error } = await supabase.from('sales_week_goals').select('*').eq('business_id', businessId).eq('id', goalId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!todo || !todo.prospect_contact_id) return res.status(404).json({ error: 'flag not found' });
    if (await weekIsFinal(supabase, businessId, todo.week_start)) return res.status(409).json({ error: FINAL_ERROR });
    const { error: dErr } = await supabase.from('sales_week_goals').delete().eq('id', todo.id);
    if (dErr) throw new Error(dErr.message);
    let prospect = null;
    if (restore) {
      const { data, error: uErr } = await supabase.from('sales_prospect_state')
        .update({ owner: restore, updated_by: req.auth.user.email, updated_at: new Date().toISOString() })
        .eq('business_id', businessId).eq('contact_id', todo.prospect_contact_id).select().maybeSingle();
      if (uErr) throw new Error(uErr.message);
      prospect = data;
    }
    await supabase.from('sales_prospect_events').insert({ business_id: businessId, contact_id: todo.prospect_contact_id, field: 'unflagged', from_value: todo.id, changed_by: req.auth.user.email });
    res.json({ deleted: todo.id, prospect });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// GET /huddle/flags - open flags (to-dos linked to a prospect, not done or
// dropped), newest copy only when a flag was carried to a later week.
export async function listFlagsRoute(req, res) {
  const supabase = getSupabase();
  try {
    const rows = await selectAllPages(() => supabase.from('sales_week_goals').select('*, steps:sales_week_goal_steps(*)')
      .eq('business_id', req.params.businessId).not('prospect_contact_id', 'is', null).order('week_start', { ascending: false }).order('id'));
    const carried = new Set(rows.map(r => r.carried_from_id).filter(Boolean));
    const flags = rows.filter(r => !carried.has(r.id) && !['done', 'dropped'].includes(r.status));
    for (const f of flags) f.steps.sort((a, b) => a.sort_order - b.sort_order);
    res.json({ flags });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
