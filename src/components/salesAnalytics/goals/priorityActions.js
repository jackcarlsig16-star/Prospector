import { goalsApi } from './goalsApi';
import { fetchOpportunities, updateOpportunity } from '../pipelineApi';

// sales-ia-v2 P3 - the one priority write for every row type, shared by the
// Companies table's dropdown and the company panel. Not a fit = the skip list
// for a visitor, P4 + a "Not a fit" note for a record. Undo puts back exactly
// what was there (a visitor with no override goes back to the pull's score).
export const NOT_A_FIT = 'not_a_fit';
export const priorityValue = r => (r.not_a_fit ? NOT_A_FIT : r.priority == null ? '' : String(r.priority));
export const priorityText = value => (value === NOT_A_FIT ? 'Not a fit' : value ? `P${value}` : 'no priority');
const md = d => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export async function writePriority(businessId, r, value) {
  if (r.type === 'visitor') {
    const body = value === NOT_A_FIT ? { company_key: r.id, not_a_fit: true } : { company_key: r.id, priority: value ? Number(value) : null };
    await goalsApi.setVisitPriority(businessId, body);
    return;
  }
  const priority = value === NOT_A_FIT ? 4 : value ? Number(value) : null;
  if (r.type === 'partner') {
    await goalsApi.updatePartner(businessId, r.id, { priority });
    if (value === NOT_A_FIT) await goalsApi.partnerSignal(businessId, r.id, { type: 'note', note: 'Not a fit (set to P4 from Pipeline)' });
  } else {
    const extra = {};
    if (value === NOT_A_FIT) {
      const opp = (await fetchOpportunities(businessId)).find(o => o.id === r.id);
      const line = `(${md(new Date().toISOString())}) Not a fit (set to P4 from Pipeline)`;
      extra.notes = opp?.notes ? `${opp.notes}\n${line}` : line;
    }
    await updateOpportunity(businessId, r.id, { priority, ...extra });
  }
}

// The value Undo writes back: a visitor the pull scored (no override) goes
// back to '' = the pull's score, not to the P the row happened to show.
export const undoValue = r => (r.type === 'visitor' && !r.priority_set_at ? '' : priorityValue(r));
