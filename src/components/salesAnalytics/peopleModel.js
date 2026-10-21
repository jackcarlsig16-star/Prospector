import { STATUS_OPTIONS, CLOSED_STATUSES, statusKey } from '../../constants/prospectStatus';

// sales-ia-v2 P5 - Pipeline > People: the filter row, the closed-row rule,
// the remembered sort and the masked name, as pure functions over the rows
// GET huddle/live returns (show_closed=1, one page of up to 1,000).
export const OWNER_OPTIONS = [['', 'Team'], ['jack', 'Jack'], ['cyrus', 'Cyrus'], ['unassigned', 'Unassigned']];
export const ACTIVITY_OPTIONS = [['reply', 'Replied'], ['click', 'Clicked'], ['open', 'Opened']];
export { STATUS_OPTIONS };
export const EMPTY_FILTERS = { owner: '', sequence: '', activity: '', status: '', q: '' };
export const activeFilterCount = f => Object.values(f).filter(Boolean).length;

// Closed and snoozed rows hide unless Show closed is on - or the Status filter
// names a closed status (then those rows are what the filter asks for).
export function matchesPeopleFilters(r, f, showClosed) {
  if (r.closed && !showClosed && !(CLOSED_STATUSES.includes(f.status) && statusKey(r.status) === f.status)) return false;
  const needle = f.q.trim().toLowerCase();
  return (!f.owner || r.owner === f.owner)
    && (!f.sequence || (r.sequence_ids || []).includes(f.sequence))
    && (!f.activity || r.last_activity_kind === f.activity)
    && (!f.status || statusKey(r.status) === f.status)
    && (!needle || `${r.name || ''} ${r.company || ''} ${r.title || ''}`.toLowerCase().includes(needle));
}

export function peopleView(rows, f, showClosed) {
  return { rows: rows.filter(r => matchesPeopleFilters(r, f, showClosed)), closed: rows.filter(r => r.closed).length };
}

// "Sam R." until the person is saved on a Pipeline record (in_pipeline);
// the full name sits in the cell's title either way (L1: no emails, no phones).
export function displayName(r) {
  if (!r.name) return 'Unknown contact';
  if (r.in_pipeline) return r.name;
  const parts = r.name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
}

export const DEFAULT_SORT = { id: 'activity', dir: 'desc' };
// localStorage key (per browser): prospector_people_sort - { id, dir } of the last header sort, JSON
const SORT_KEY = 'prospector_people_sort';
export function readSort() {
  try {
    const v = JSON.parse(localStorage.getItem(SORT_KEY));
    return v === null ? DEFAULT_SORT : v && typeof v.id === 'string' && ['asc', 'desc'].includes(v.dir) ? v : DEFAULT_SORT;
  } catch { return DEFAULT_SORT; }
}
export const writeSort = s => { try { localStorage.setItem(SORT_KEY, JSON.stringify(s)); } catch { /* private mode */ } };

// The Pipeline board row behind a person's company: the linked opportunity
// first, else the record (partner / employer / target / Apollo-only / visitor)
// whose name matches. null = nothing in the Pipeline yet.
const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(inc|llc|ltd|co|corp|corporation|company)\b/g, '').trim();
export function companyRowFor(person, boardRows) {
  // sales-ia-v2 A1: an Actions item names its row outright ({ type, id }).
  if (person.link?.type && person.link.id) {
    const row = boardRows.find(r => r.type === person.link.type && r.id === person.link.id);
    if (row) return row;
  }
  if (person.opportunity_id) {
    const opp = boardRows.find(r => r.type === 'employer' && r.id === person.opportunity_id);
    if (opp) return opp;
  }
  const key = norm(person.company);
  if (!key) return null;
  const order = ['partner', 'employer', 'target', 'apollo', 'visitor'];
  return boardRows.filter(r => order.includes(r.type) && norm(r.name) === key).sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))[0] || null;
}
