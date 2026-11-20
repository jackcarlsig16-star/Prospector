import { rematchVisits } from './visitMatch.js';
import { logFlow } from './flowEvents.js';

// data-keys-v1 K10 - visits follow the record. The ONE function a promote and a rename call:
//   promote  from = the target, to = the new partner / employer: every web_visits row matched to the target is
//            re-pointed at the new record;
//   rename   from = the record under its old name, to = the same record under its new name: its rows are matched by
//            id, so they stay where they are.
// Either way the still-unmatched rows that carry the record's (new) name or domain join it (rematchVisits).
// company_key is the VISITOR's name as Apollo sends it - the next pull writes that key again - so it is never
// rewritten here: a rewritten key would split one visiting company's history in two.
// -> { ids: the rows re-pointed (for an undo), matched: the unmatched rows that joined }
const TYPES = ['partner', 'employer', 'target'];
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };

export async function restampVisits(supabase, { businessId, from = null, to }) {
  if (!TYPES.includes(to?.type) || !to.id) return { ids: [], matched: 0 };
  const moves = from && TYPES.includes(from.type) && (from.type !== to.type || String(from.id) !== String(to.id));
  const ids = moves ? must(await supabase.from('web_visits').update({ matched_type: to.type, matched_id: to.id })
    .eq('business_id', businessId).eq('matched_type', from.type).eq('matched_id', from.id).select('id')).map(v => v.id) : [];
  const matched = await rematchVisits(supabase, { businessId, type: to.type, id: to.id, name: to.name, domain: to.domain || null });
  return { ids, matched };
}

// The Activity line of a re-stamp. The kind needs 20261121_data_keys_v1_stage1b_flow_kind.sql (the table's CHECK
// lists the kinds); a refused line never fails the rename or the promote it describes.
export async function logRestamp(supabase, { businessId, to, text, moved, matched, meta = {}, byUser = null, now = new Date() }) {
  try {
    return await logFlow(supabase, { businessId, recordType: to.type, recordId: to.id, kind: 'restamp', text, meta: { ...meta, visits_moved: moved, visits_matched: matched }, byUser, now });
  } catch (e) {
    console.warn('[restampVisits] the Activity line was not written:', e.message);
    return null;
  }
}

// A partner or an employer got a new name: its matched rows stay (by id), unmatched rows of the new name join it, and
// the Activity says so. Never throws - the rename itself is already saved.
export async function renamed(supabase, { businessId, type, id, from, to, userId = null, now = new Date() }) {
  try {
    const rec = { type, id, name: to };
    const { matched } = await restampVisits(supabase, { businessId, from: { type, id, name: from }, to: rec });
    return await logRestamp(supabase, { businessId, to: rec, text: `Renamed ${from} → ${to} · ${matched} unmatched visit ${matched === 1 ? 'row' : 'rows'} joined`, moved: 0, matched, meta: { from_name: from, to_name: to }, byUser: userId, now });
  } catch (e) {
    console.warn('[restampVisits] rename follow-up failed:', e.message);
    return null;
  }
}
