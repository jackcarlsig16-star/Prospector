import { selectAllPages } from '../lib/selectAllPages.js';
import { normName } from './intakeMatch.js';

// visitor-people-follow-record-v1 - identified visitors follow the company record. V1: a promoted target's sales_people
// move with it (to an employer: re-pointed; to a partner: a partner_contacts row each + the old row archived, never
// deleted). V5: parked people (sales_people company_type 'parked', company name only) whose company name matches a record
// that was just created / promoted / added move onto it - except the ones parked because their company is on the visit
// skip list (V4), which wait for a person's "Add". Every move pushes its own undo onto the caller's list.
export const VISITOR_ROLE = 'Identified website visitor'; // partner_contacts.role_in_notes marker (source allows apollo | manual | outlook only)
export const SKIP_NOTE = 'Company is on the visit skip list';
const must = r => { if (r.error) throw Object.assign(new Error(r.error.message), { status: 500 }); return r.data; };

// rows -> the record. type: employer | target | partner. Returns how many landed (a partner duplicate by name is archived, not counted).
async function moveRows(supabase, { businessId, userId, rows, type, id, undo, now }) {
  if (!rows.length) return 0;
  const stamp = now.toISOString();
  if (type !== 'partner') {
    const patch = { company_type: type, opportunity_id: type === 'employer' ? id : null, target_id: type === 'target' ? id : null, updated_at: stamp };
    must(await supabase.from('sales_people').update(patch).in('id', rows.map(r => r.id)));
    undo?.push(async () => { for (const r of rows) must(await supabase.from('sales_people').update({ company_type: r.company_type, opportunity_id: r.opportunity_id ?? null, target_id: r.target_id ?? null, updated_at: stamp }).eq('id', r.id)); });
    return rows.length;
  }
  const have = new Set(must(await supabase.from('partner_contacts').select('name').eq('business_id', businessId).eq('goal_id', id)).map(c => normName(c.name)).filter(Boolean));
  const inserted = [];
  for (const r of rows) {
    const key = normName(r.name);
    if (!key || have.has(key)) continue;
    const c = must(await supabase.from('partner_contacts').insert({ business_id: businessId, goal_id: id, name: r.name, title: r.title || null, linkedin_url: r.linkedin_url || null, role_in_notes: r.source_kind === 'web_visit' || r.company_type === 'parked' ? VISITOR_ROLE : null, source: 'manual', created_by: userId || null }).select('id').single());
    inserted.push(c.id); have.add(key);
  }
  must(await supabase.from('sales_people').update({ archived_at: stamp, updated_at: stamp }).in('id', rows.map(r => r.id)));
  undo?.push(async () => {
    if (inserted.length) must(await supabase.from('partner_contacts').delete().in('id', inserted));
    must(await supabase.from('sales_people').update({ archived_at: null, updated_at: stamp }).in('id', rows.map(r => r.id)));
  });
  return inserted.length;
}

const PEOPLE_COLS = 'id, name, title, linkedin_url, company_type, company_name, opportunity_id, target_id, source_kind, note';

// V1 - a target's live people onto the record it was promoted to.
export async function moveTargetPeople(supabase, { businessId, userId, targetId, to, id, undo, now = new Date() }) {
  const rows = await selectAllPages(() => supabase.from('sales_people').select(PEOPLE_COLS).eq('business_id', businessId).eq('target_id', targetId).is('archived_at', null).order('id'));
  return moveRows(supabase, { businessId, userId, rows, type: to, id, undo, now });
}

// V5 - parked people whose company name matches `name` onto the record. includeSkipped: the explicit "Add" also takes
// the skip-list ones.
export async function relinkParked(supabase, { businessId, userId, type, id, name, undo, now = new Date(), includeSkipped = false }) {
  const key = normName(name);
  if (!key) return 0;
  const parked = await selectAllPages(() => supabase.from('sales_people').select(PEOPLE_COLS).eq('business_id', businessId).eq('company_type', 'parked').is('archived_at', null).order('id'));
  const rows = parked.filter(p => normName(p.company_name) === key && (includeSkipped || p.note !== SKIP_NOTE));
  return moveRows(supabase, { businessId, userId, rows, type, id, undo, now });
}
