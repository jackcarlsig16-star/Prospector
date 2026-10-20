import { matchesBoardFilters } from '../../../constants/pipelineBoard';

// sales-ia-v2 P1 - Pipeline > Companies: the channel buttons, the one filter
// row and the remembered column / sort choices. Rows come from GET
// goals/pipeline-board; `channels` on each row says which buttons it shows
// under ('all' = partners, employers and targets).
export const CHANNEL_BUTTONS = [
  ['all', 'All'], ['website', 'Website visitors'], ['scout', 'Scout signals'], ['apollo', 'Apollo outbound'],
  ['partners', 'Partners & referrals'], ['call_notes', 'Call notes'], ['targets', 'Targets'],
];
// ?channel= values (salesNav's VISITOR_CHANNEL is the stored channel name).
const CHANNEL_PARAM = { website_visit: 'website' };
export const channelFromParam = p => CHANNEL_PARAM[p] || (CHANNEL_BUTTONS.some(([id]) => id === p) ? p : 'all');

export const TYPE_OPTIONS = [['partner', 'Partner'], ['employer', 'Employer'], ['target', 'Target'], ['apollo', 'Apollo-only'], ['visitor', 'Visitor'], ['signal', 'Scout signal']];
export const EMPTY_FILTERS = { owner: '', ownerTeam: '', type: '', stage: '', priority: '', tier: '', visited: false, hasTodo: false, overdue: false, q: '' };
export const activeFilterCount = f => Object.entries(f).filter(([k, v]) => v && v !== EMPTY_FILTERS[k]).length;

// priority filter: '1'..'4' or 'none'.
export function matchesCompanyFilters(r, f) {
  return matchesBoardFilters(r, { type: f.type, ownerTeam: f.ownerTeam, owner: f.owner, tier: f.tier, q: f.q })
    && (!f.stage || r.stage_label === f.stage)
    && (!f.priority || (f.priority === 'none' ? r.priority == null : r.priority === Number(f.priority)))
    && (!f.visited || !!r.visited)
    && (!f.hasTodo || (r.work?.todos || 0) > 0)
    && (!f.overdue || (r.work?.todos_overdue || 0) + (r.work?.waiting_overdue || 0) > 0);
}

export const inChannel = (r, channel) => (r.channels || []).includes(channel);

// Rows for the table, and the count on every channel button under the same
// filter row (so a button reads what clicking it would show).
export function companiesView(rows, channel, filters) {
  const filtered = rows.filter(r => matchesCompanyFilters(r, filters));
  const counts = Object.fromEntries(CHANNEL_BUTTONS.map(([id]) => [id, filtered.filter(r => inChannel(r, id)).length]));
  return { rows: filtered.filter(r => inChannel(r, channel)), counts };
}

// Filter-row options from what is loaded: owners and stages present.
export const ownersOf = rows => [...new Set(rows.map(r => r.owner).filter(Boolean))].sort();
export const stagesOf = rows => [...new Set(rows.map(r => r.stage_label).filter(Boolean))].sort();

// localStorage keys (per browser, conveniences only):
//   prospector_pipeline_columns - hidden column ids, JSON array
//   prospector_pipeline_sort    - { id, dir } of the last header sort, JSON
const COLUMNS_KEY = 'prospector_pipeline_columns';
const SORT_KEY = 'prospector_pipeline_sort';
export const DEFAULT_HIDDEN = ['record'];
const readJson = (key, fallback, ok) => {
  try { const v = JSON.parse(localStorage.getItem(key)); return ok(v) ? v : fallback; } catch { return fallback; }
};
const writeJson = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } };
export const readHidden = () => readJson(COLUMNS_KEY, DEFAULT_HIDDEN, v => Array.isArray(v) && v.every(x => typeof x === 'string'));
export const writeHidden = ids => writeJson(COLUMNS_KEY, ids);
export const readSort = () => readJson(SORT_KEY, null, v => v === null || (v && typeof v.id === 'string' && ['asc', 'desc'].includes(v.dir)));
export const writeSort = s => writeJson(SORT_KEY, s);

const md = d => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
// "P2 · set by Jack Oct 20" (title and the muted line under the dropdown).
export function prioritySetLabel(r) {
  if (r.priority == null && !r.not_a_fit) return '';
  const p = r.not_a_fit ? 'Not a fit' : `P${r.priority}`;
  if (!r.priority_set_by && !r.priority_set_at) return r.type === 'visitor' ? `${p} · scored by the visitor pull` : p;
  return `${p} · set by ${r.priority_set_by ? r.priority_set_by.split(' ')[0] : 'someone'}${r.priority_set_at ? ` ${md(r.priority_set_at)}` : ''}`;
}
